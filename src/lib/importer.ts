import fs from "node:fs";
import path from "node:path";
import { getVaultPaths, ensureVaultSubDirs } from "./storage";
import { sha256File } from "./hash";
import { extractExif } from "./exif";
import { placeOriginal, resolveStoredPath } from "./storage";
import { ensureThumbnail } from "./thumb";
import { detectKind } from "./exif";
import { getDb } from "./db";

/**
 * 阶段三：桌面端本地拖拽导入（复制/移动）流水线。
 * 安全流程（逐文件）：
 *   复制源→tmp → 双端 SHA-256 校验 → （去重判定）→ 原子重命名落盘
 *   → 落盘复核 → （移动模式）删源 → 入库 → 缩略图。
 * 任一步失败：删 tmp / 回滚落盘，源文件保证原样。
 */

const IMPORTABLE_EXT = new Set([
  "jpg", "jpeg", "png", "webp", "heic", "heif", "avif", "gif", "tif", "tiff",
  "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "raf",
  "orf", "rw2", "pef", "srw", "x3f", "3fr", "erf", "mef", "mos", "iiq",
  "kdc", "dcr", "rwl", "fff", "gpr",
]);

export type ImportFileStatus = "pending" | "done" | "failed";

export interface ImportFileItem {
  path: string;
  size: number;
  status: ImportFileStatus;
  error?: string;
  photoId?: string;
  duplicate?: boolean;
  /** move 模式删除源、或复制模式事后确认删源后置 true */
  sourceDeleted?: boolean;
  /** 源删除失败的警告（如内存卡只读） */
  warning?: string;
}

export interface ImportJob {
  id: string;
  mode: "copy" | "move";
  state: "ready" | "running" | "finished";
  files: ImportFileItem[];
  current?: string;
  totalSize: number;
  copiedBytes: number;
  createdAt: number;
}

const jobs: Map<string, ImportJob> = ((globalThis as Record<string, unknown>).__lpvImports ??=
  new Map()) as Map<string, ImportJob>;

export function getJob(id: string): ImportJob | null {
  return jobs.get(id) ?? null;
}

/** 递归扫描：目录展开为可导入文件清单；跳过 .lpvault 内部 */
export function scanPaths(paths: string[]): {
  files: { path: string; size: number }[];
  skipped: string[];
} {
  const files: { path: string; size: number }[] = [];
  const skipped: string[] = [];
  const { vaultDir } = getVaultPaths();

  const walk = (p: string, depth: number) => {
    if (depth > 12) return;
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      skipped.push(p);
      return;
    }
    if (st.isDirectory()) {
      // 不允许把照片库自身目录当导入源
      if (path.resolve(p).toLowerCase() === path.resolve(vaultDir).toLowerCase()) {
        skipped.push(p);
        return;
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(p, { withFileTypes: true });
      } catch {
        skipped.push(p);
        return;
      }
      for (const e of entries) {
        walk(path.join(p, e.name), depth + 1);
      }
      return;
    }
    const ext = p.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    if (!IMPORTABLE_EXT.has(ext)) {
      skipped.push(p);
      return;
    }
    files.push({ path: p, size: st.size });
  };

  for (const p of paths) walk(p, 0);
  return { files, skipped };
}

export function createJob(
  mode: "copy" | "move",
  files: { path: string; size: number }[]
): ImportJob {
  const id = crypto.randomUUID().replace(/-/g, "");
  const job: ImportJob = {
    id,
    mode,
    state: "ready",
    files: files.map((f) => ({ ...f, status: "pending" as const })),
    totalSize: files.reduce((s, f) => s + f.size, 0),
    copiedBytes: 0,
    createdAt: Date.now(),
  };
  // 只保留最近 5 个任务，防内存累积
  const keys = [...jobs.keys()];
  while (keys.length >= 5) {
    const old = keys.shift()!;
    if (jobs.get(old)?.state !== "running") jobs.delete(old);
    else break;
  }
  jobs.set(id, job);
  return job;
}

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", tiff: "image/tiff", tif: "image/tiff",
  avif: "image/avif", heic: "image/heic", heif: "image/heif",
  dng: "image/x-adobe-dng", cr2: "image/x-canon-cr2", cr3: "image/x-canon-cr3",
  nef: "image/x-nikon-nef", arw: "image/x-sony-arw", raf: "image/x-fuji-raf",
  orf: "image/x-olympus-orf", rw2: "image/x-panasonic-rw2",
};

/** 单文件安全导入；抛错则该文件标记失败（源文件已保证未动） */
async function importOne(job: ImportJob, item: ImportFileItem): Promise<void> {
  const src = item.path;
  let tmpPath: string | null = null;
  let placedRel: string | null = null;
  let duplicate = false;
  try {
    // 源必须仍是普通文件
    const st = fs.statSync(src);
    if (!st.isFile()) throw new Error("源不是常规文件");

    // ① EXIF 拍摄时间 → 目标目录；回退时间仅用于目录归位，不写入 takenAt
    const exif = await extractExif(src);
    const dirDate = exif.takenAt ?? new Date(st.mtimeMs);

    // ② 复制到 tmp（流式，源只读）
    ensureVaultSubDirs();
    const { tmpDir } = getVaultPaths();
    tmpPath = path.join(tmpDir, `${crypto.randomUUID().replace(/-/g, "")}.part`);
    await fs.promises.copyFile(src, tmpPath);

    // ③ 双端哈希校验
    const [srcSha, tmpSha] = await Promise.all([
      sha256File(src),
      sha256File(tmpPath),
    ]);
    if (srcSha !== tmpSha) throw new Error("复制校验失败：源与临时文件哈希不一致");

    // ④ 去重判定
    const db = getDb();
    const dup = await db.photo.findFirst({
      where: { sha256: srcSha },
      select: { storedName: true },
    });

    if (dup) {
      // 去重：不写盘，复用已有原图
      fs.unlinkSync(tmpPath);
      tmpPath = null;
      placedRel = dup.storedName;
      duplicate = true;
    } else {
      // ⑤ 原子重命名落盘（tmp 与目标同盘，rename 原子）
      const placed = placeOriginal(tmpPath, path.basename(src), srcSha, dirDate);
      tmpPath = null; // 已被 rename 走
      placedRel = placed.storedName;

      // ⑥ 落盘复核
      const verify = await sha256File(resolveStoredPath(placedRel));
      if (verify !== srcSha) {
        try {
          fs.unlinkSync(resolveStoredPath(placedRel));
        } catch { /* 清理失败不掩盖主错误 */ }
        throw new Error("落盘复核失败：哈希不一致，已回滚");
      }
    }

    // ⑦ 移动模式：删除源文件（只读卡等失败 → 警告但不回滚，内容已安全入库）
    if (job.mode === "move") {
      try {
        fs.unlinkSync(src);
        item.sourceDeleted = true;
      } catch (e) {
        item.warning = `源文件删除失败（已复制入库，源保留）：${(e as Error).message}`;
      }
    }

    // ⑧ 入库 + 缩略图
    const ext = src.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    let photo;
    try {
      photo = await db.photo.create({
        data: {
          sha256: srcSha,
          storedName: placedRel!,
          originalName: path.basename(src),
          mimeType: MIME_MAP[ext] ?? "application/octet-stream",
          kind: detectKind(src),
          sizeBytes: BigInt(st.size),
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
        },
      });
    } catch (e) {
      // 入库失败 → 回滚落盘（去重复用或盘上已存在同名时不删）
      if (!duplicate && placedRel) {
        try {
          fs.unlinkSync(resolveStoredPath(placedRel));
        } catch { /* 尽力回滚 */ }
      }
      throw new Error(`数据库写入失败：${(e as Error).message}`);
    }

    await ensureThumbnail(
      resolveStoredPath(placedRel!),
      srcSha,
      detectKind(src),
      path.basename(src)
    ).catch(() => null);

    item.status = "done";
    item.photoId = photo.id;
    item.duplicate = duplicate;
  } catch (e) {
    item.status = "failed";
    item.error = (e as Error).message;
    // tmp 兜底清理
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath);
      } catch { /* 尽力清理 */ }
    }
  } finally {
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath);
      } catch { /* 已 rename 或已删 */ }
    }
  }
}

/** 启动后台导入（不等待完成，进度走轮询） */
export function startJob(job: ImportJob, onlyPaths?: string[]): void {
  if (job.state === "running") return;
  const targets = onlyPaths
    ? job.files.filter((f) => onlyPaths.includes(f.path))
    : job.files.filter((f) => f.status === "pending");
  for (const f of targets) {
    f.status = "pending";
    f.error = undefined;
  }
  job.state = "running";
  void (async () => {
    for (const item of targets) {
      if (jobs.get(job.id) !== job) return; // 任务被替换
      job.current = item.path;
      await importOne(job, item);
      job.current = undefined;
    }
    job.state = "finished";
  })().catch(() => {
    job.state = "finished";
  });
}

/** 复制模式完成后按用户确认删除源文件（仅删本次已成功导入的源） */
export async function deleteImportedSources(
  jobId: string
): Promise<{ deleted: number; errors: { path: string; error: string }[] }> {
  const job = jobs.get(jobId);
  const errors: { path: string; error: string }[] = [];
  let deleted = 0;
  if (!job) return { deleted, errors: [{ path: "", error: "任务不存在" }] };
  for (const item of job.files) {
    if (item.status !== "done" || item.sourceDeleted) continue;
    try {
      fs.unlinkSync(item.path);
      item.sourceDeleted = true;
      deleted++;
    } catch (e) {
      errors.push({ path: item.path, error: (e as Error).message });
    }
  }
  return { deleted, errors };
}
