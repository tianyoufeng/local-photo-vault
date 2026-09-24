export const dynamic = "force-dynamic";

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getUpload, finishUpload, isUploadComplete } from "@/lib/uploadSession";
import { sha256File } from "@/lib/hash";
import { detectKind, extractExif, extractExifRaw } from "@/lib/exif";
import { placeOriginal, resolveStoredPath } from "@/lib/storage";
import { enqueueThumbnail } from "@/lib/thumbQueue";
import { logInfo, logError } from "@/lib/logger";
import { getDb } from "@/lib/db";

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", tiff: "image/tiff", tif: "image/tiff",
  avif: "image/avif", heic: "image/heic", heif: "image/heif",
  dng: "image/x-adobe-dng", cr2: "image/x-canon-cr2", cr3: "image/x-canon-cr3",
  nef: "image/x-nikon-nef", arw: "image/x-sony-arw", raf: "image/x-fuji-raf",
  orf: "image/x-olympus-orf", rw2: "image/x-panasonic-rw2",
};

function mimeFor(fileName: string): string {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return MIME_MAP[ext] ?? "application/octet-stream";
}

/**
 * POST /api/photos/upload/finalize {uploadId}
 * 流程：校验大小 → SHA-256 → 库内去重（盘一份图库多条）→ 落盘 → 复核哈希
 * → EXIF → 缩略图 → 入库 → 清理 tmp（finally 兜底）
 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";
  // 可选：上传时直接归入指定相册（桌面图库与手机上传页均可传 albumId / albumName）
  const albumId = typeof body?.albumId === "string" ? body.albumId.trim() : "";
  const albumName = typeof body?.albumName === "string" ? body.albumName.trim() : "";
  const session = getUpload(uploadId);
  if (!session) {
    return NextResponse.json({ error: "上传会话不存在" }, { status: 404 });
  }
  if (!isUploadComplete(session)) {
    return NextResponse.json(
      { error: "分片未传完", received: session.receivedChunks, expected: session.expectedChunks },
      { status: 409 }
    );
  }

  const db = getDb();
  try {
    const sha256 = await sha256File(session.tmpPath);

    // ---- 库内去重：同内容磁盘只存一份，图库新建一条记录 ----
    const dup = await db.photo.findFirst({
      where: { sha256 },
      select: { storedName: true },
    });

    const kind = detectKind(session.fileName);
    const exif = await extractExif(session.tmpPath);
    // takenAt 只存真实 EXIF 拍摄时间（没有就存 null，如实展示）；
    // 目录归位用的回退时间只影响 YYYY\MM 落盘位置，不写入 takenAt
    const dirDate = exif.takenAt ?? new Date(fs.statSync(session.tmpPath).mtimeMs);

    let storedName: string;
    if (dup) {
      storedName = dup.storedName; // 复用磁盘上已有的那份文件
    } else {
      const placed = placeOriginal(
        session.tmpPath,
        session.fileName,
        sha256,
        dirDate
      );
      storedName = placed.storedName;

      // 宪法第 4 条：落盘后复核哈希，与临时文件一致才入库
      const verify = await sha256File(resolveStoredPath(storedName));
      if (verify !== sha256) {
        try {
          fs.unlinkSync(resolveStoredPath(storedName));
        } catch {
          /* 清理失败不掩盖主错误 */
        }
        return NextResponse.json(
          { error: "落盘校验失败：哈希不一致，已回滚" },
          { status: 500 }
        );
      }
    }

    // 宽高（仅 sharp 可解码的 image；RAW/HEIC 留空或后续补）
    let width: number | null = null;
    let height: number | null = null;
    if (kind === "image") {
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(resolveStoredPath(storedName), {
          failOn: "none",
        }).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
      } catch {
        /* 保留 null */
      }
    }

    const exifRaw = await extractExifRaw(session.tmpPath).catch(() => null);

    const photo = await db.photo.create({
      data: {
        sha256,
        storedName,
        originalName: session.fileName,
        mimeType: mimeFor(session.fileName),
        kind,
        sizeBytes: session.size,
        width,
        height,
        takenAt: exif.takenAt,
        cameraMake: exif.cameraMake,
        cameraModel: exif.cameraModel,
        lensModel: exif.lensModel,
        focalLength: exif.focalLength,
        fNumber: exif.fNumber,
        exposureTime: exif.exposureTime,
        iso: exif.iso,
        gpsLat: exif.gpsLat,
        gpsLon: exif.gpsLon,
        exif: exifRaw,
      },
    });

    // 上传时指定目标相册：把新照片（含去重新建的记录）连入相册；相册不存在则自动创建
    if (albumId || albumName) {
      const album =
        (albumId
          ? await db.album.findUnique({ where: { id: albumId } })
          : null) ??
        (albumName ? await db.album.findUnique({ where: { name: albumName } }) : null) ??
        (albumName
          ? await db.album.create({ data: { name: albumName } }).catch(() => null)
          : null);
      if (album) {
        await db.photo
          .update({ where: { id: photo.id }, data: { albums: { connect: { id: album.id } } } })
          .catch(() => null);
      }
    }

    // 缩略图入异步队列（finalize 不再同步等待；路由缺失时按需生成兜底）
    enqueueThumbnail(resolveStoredPath(storedName), sha256, kind, session.fileName);
    logInfo("upload", "photo_imported", {
      id: photo.id,
      name: session.fileName,
      size: session.size,
      sha256,
      duplicate: Boolean(dup),
    });

    return NextResponse.json({
      ok: true,
      duplicate: Boolean(dup),
      photo: { ...photo, sizeBytes: photo.sizeBytes.toString() },
    });
  } catch (e) {
    logError("upload", "photo_import_failed", {
      name: session.fileName,
      error: (e as Error).message,
    });
    return NextResponse.json(
      { error: `导入失败：${(e as Error).message}` },
      { status: 500 }
    );
  } finally {
    // tmp 兜底清理（无论成败）
    finishUpload(uploadId);
    try {
      fs.unlinkSync(session.tmpPath);
    } catch {
      /* 已被 placeOriginal rename 走属正常 */
    }
  }
}
