export const dynamic = "force-dynamic";

import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { resolveStoredPath } from "@/lib/storage";

type Params = { params: { id: string } };

/**
 * GET /api/photos/[id]/original — 原图流式下载
 * 宪法第 1/8 条：不转码、不压缩、支持 Range 断点与 Content-Disposition。
 */
export async function GET(req: NextRequest, { params }: Params) {
  const denied = guardApi(req);
  if (denied) return denied;

  const photo = await getDb().photo.findUnique({
    where: { id: params.id },
    select: { storedName: true, originalName: true, mimeType: true },
  });
  if (!photo) {
    return NextResponse.json({ error: "照片不存在" }, { status: 404 });
  }

  const filePath = resolveStoredPath(photo.storedName);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return NextResponse.json({ error: "原文件已丢失" }, { status: 410 });
  }

  const asciiFallback = photo.originalName.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(photo.originalName);
  const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
  const baseHeaders: Record<string, string> = {
    "Content-Type": photo.mimeType,
    "Accept-Ranges": "bytes",
    "Content-Disposition": disposition,
    "Cache-Control": "no-store",
  };

  // ---- Range 处理（bytes=start-end 或 bytes=start- 或 bytes=-suffix） ----
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (m[1] === "" && m[2] === "")) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    let start: number;
    let end: number;
    if (m[1] === "") {
      // bytes=-N：末尾 N 字节
      const suffix = Number(m[2]);
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1);
    }
    if (start > end || start >= stat.size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(stat.size) },
  });
}
