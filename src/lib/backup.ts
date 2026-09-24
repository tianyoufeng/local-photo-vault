import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TarWriter } from "./tarWriter";
import { getVaultPaths, ensureVaultSubDirs } from "./storage";
import { sha256File } from "./hash";
import { getDb } from "./db";

/**
 * 阶段六：全量备份（.lpvbackup = 未压缩 TAR 容器）
 * 结构：manifest.json + db/lpvault.db(VACUUM INTO 快照) + photos/<storedName> + thumbnails/**
 * 写入 .part → 成功后原子改名；失败/取消删除 .part，不留半成品。
 */

export interface BackupJob {
  id: string;
  state: "running" | "paused" | "finished" | "failed" | "canceled";
  targetDir: string;
  fileName: string;
  filePath: string; // .part 路径
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  currentFile?: string;
  error?: string;
  archiveSha256?: string;
  createdAt: number;
}

const jobs: Map<string, BackupJob> = ((globalThis as Record<string, unknown>).__lpvBackups ??=
  new Map()) as Map<string, BackupJob>;

export function getBackupJob(id: string): BackupJob | null {
  return jobs.get(id) ?? null;
}

const toSlash = (p: string) => p.replace(/\\/g, "/");

/** 收集全部备份源文件清单 */
async function gatherManifestFiles(): Promise<{
  photos: { storedName: string; abs: string; size: number }[];
  thumbnails: { rel: string; abs: string; size: number }[];
  missing: string[];
}> {
  const db = getDb();
  const { photoRoot, thumbDir } = getVaultPaths();
  const photos: { storedName: string; abs: string; size: number }[] = [];
  const missing: string[] = [];
  const records = await db.photo.findMany({
    select: { storedName: true },
    orderBy: { storedName: "asc" },
  });
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.storedName)) continue;
    seen.add(r.storedName);
    const abs = path.join(photoRoot, r.storedName);
    try {
      const size = fs.statSync(abs).size;
      photos.push({ storedName: r.storedName, abs, size });
    } catch {
      missing.push(r.storedName); // 库里有记录但盘上缺失，跳过并记录
    }
  }
  const thumbnails: { rel: string; abs: string; size: number }[] = [];
  const walkThumbs = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkThumbs(full, depth + 1);
      else if (e.name.endsWith(".webp")) {
        const rel = path.relative(thumbDir, full);
        thumbnails.push({ rel: toSlash(rel), abs: full, size: fs.statSync(full).size });
      }
    }
  };
  walkThumbs(thumbDir, 0);
  return { photos, thumbnails, missing };
}

async function waitWhilePaused(job: BackupJob): Promise<boolean> {
  // 返回 false 表示被取消
  for (;;) {
    if ((job.state as string) === "canceled") return false;
    if (job.state !== "paused") return true;
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** 后台执行备份；job 先由 startBackup 创建 */
async function runBackup(job: BackupJob): Promise<void> {
  const { tmpDir, thumbDir } = ensureVaultSubDirs();
  const partPath = path.join(job.targetDir, job.fileName + ".part");
  let writer: TarWriter | null = null;
  try {
    // 收集清单
    const { photos, thumbnails, missing } = await gatherManifestFiles();
    const db = getDb();
    const rows = await db.photo.findMany({
      select: { storedName: true, sha256: true, sizeBytes: true },
      orderBy: { storedName: "asc" },
    });
    const photoShaMap = new Map<string, string>(
      rows.map((r) => [toSlash(r.storedName), r.sha256])
    );
    const all = [
      ...photos.map((p) => ({ entry: `photos/${toSlash(p.storedName)}`, abs: p.abs, size: p.size })),
      ...thumbnails.map((t) => ({ entry: `thumbnails/${t.rel}`, abs: t.abs, size: t.size })),
    ];
    job.filesTotal = all.length + 1; // + db
    job.bytesTotal = all.reduce((s, f) => s + f.size, 0);

    fs.mkdirSync(job.targetDir, { recursive: true });

    // DB 一致性快照（VACUUM INTO，文件不能已存在）
    job.currentFile = "数据库快照 (VACUUM INTO)";
    const dbSnap = path.join(tmpDir, `backup-snap-${job.id}.db`);
    try {
      fs.rmSync(dbSnap, { force: true });
      await getDb().$executeRawUnsafe(
        `VACUUM INTO '${dbSnap.replace(/'/g, "''")}'`
      );
    } catch (e) {
      throw new Error(`数据库快照失败：${(e as Error).message}`);
    }
    job.filesDone = 1;
    job.bytesDone += fs.statSync(dbSnap).size;

    // 打包（自研 ustar 写入器：流式 + 背压 + 边写边算哈希）
    const w = new TarWriter(partPath);
    writer = w;
    const writerDone = new Promise<void>((resolve, reject) => {
      w.streamOn("finish", () => resolve());
      w.streamOn("error", (err) => reject(err ?? new Error("写入流错误")));
    });

    // db 快照（含哈希）
    const dbSha = await w.addFile("db/lpvault.db", dbSnap, fs.statSync(dbSnap).size);
    job.filesDone = 1;
    job.bytesDone += fs.statSync(dbSnap).size;

    let failedFile: string | null = null;
    for (const f of all) {
      if (!(await waitWhilePaused(job))) break;
      job.currentFile = f.entry;
      try {
        const sha = await w.addFile(f.entry, f.abs, f.size);
        // 校验：备出来的字节与库里登记的 sha256 一致（文件未被中途篡改）
        const dbRow = photoShaMap.get(f.entry.slice("photos/".length));
        if (dbRow && dbRow !== sha) {
          failedFile = failedFile ?? "";
          failedFile += `${f.entry}: 内容与数据库哈希不一致; `;
        }
        job.filesDone++;
        job.bytesDone += f.size;
      } catch (e) {
        if ((job.state as string) === "canceled") break;
        failedFile = failedFile ?? "";
        failedFile += `${f.entry}: ${(e as Error).message}; `;
        job.filesDone++;
      }
    }

    // 取消：中止写入并删除 .part
    if ((job.state as string) === "canceled") {
      w.destroy();
      fs.rmSync(partPath, { force: true });
      return;
    }

    // manifest（含缺失文件与失败文件说明）
    job.currentFile = "manifest.json";
    const manifest = {
      format: "lpvbackup",
      version: 1,
      appVersion: "0.1.0",
      createdAt: new Date().toISOString(),
      db: { path: "db/lpvault.db", sha256: dbSha, size: 0 },
      fileCount: job.filesDone - 1,
      totalSize: job.bytesDone,
      photos: rows.map((r) => ({
        storedName: r.storedName,
        sha256: r.sha256,
        size: Number(r.sizeBytes),
      })),
      thumbnails: thumbnails.map((t) => t.rel),
      missingInSource: missing,
      failedFiles: failedFile ? failedFile.slice(0, -2) : null,
    };
    manifest.db.size = fs.statSync(dbSnap).size;
    await w.addBuffer("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    await w.finish();
    await writerDone;

    fs.rmSync(dbSnap, { force: true });

    // 成功：原子改名 + 计算归档哈希 + 写记录
    const finalPath = path.join(job.targetDir, job.fileName);
    fs.renameSync(partPath, finalPath);
    const archiveSha = await sha256File(finalPath);
    job.archiveSha256 = archiveSha;
    job.filePath = finalPath;
    await getDb().backupRecord.create({
      data: {
        filePath: finalPath,
        archiveSha256: archiveSha,
        fileCount: job.filesDone,
        totalSize: BigInt(job.bytesDone),
        photoCount: photos.length,
        status: "success",
      },
    });
    await db.setting.upsert({
      where: { key: "lastBackupAt" },
      update: { value: new Date().toISOString() },
      create: { key: "lastBackupAt", value: new Date().toISOString() },
    });
    job.state = "finished";
  } catch (e) {
    try {
      writer?.destroy();
    } catch { /* 尽力清理 */ }
    if (job.state === "canceled") {
      try {
        fs.rmSync(partPath, { force: true });
      } catch { /* 尽力清理 */ }
      return;
    }
    job.state = "failed";
    job.error = (e as Error).message;
    try {
      fs.rmSync(partPath, { force: true });
    } catch { /* 尽力清理 */ }
    await getDb()
      .backupRecord.create({
        data: {
          filePath: path.join(job.targetDir, job.fileName),
          archiveSha256: "",
          fileCount: job.filesDone,
          totalSize: BigInt(job.bytesDone),
          photoCount: 0,
          status: "failed",
        },
      })
      .catch(() => null);
  }
}

export function startBackup(targetDir: string): BackupJob {
  ensureVaultSubDirs();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fileName = `LocalPhotoVault_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.lpvbackup`;
  const job: BackupJob = {
    id: crypto.randomUUID().replace(/-/g, ""),
    state: "running",
    targetDir,
    fileName,
    filePath: path.join(targetDir, fileName + ".part"),
    filesDone: 0,
    filesTotal: 0,
    bytesDone: 0,
    bytesTotal: 0,
    createdAt: now.getTime(),
  };
  jobs.set(job.id, job);
  void runBackup(job);
  return job;
}

export function pauseBackup(id: string): boolean {
  const j = jobs.get(id);
  if (j?.state === "running") {
    j.state = "paused";
    return true;
  }
  return false;
}
export function resumeBackup(id: string): boolean {
  const j = jobs.get(id);
  if (j?.state === "paused") {
    j.state = "running";
    return true;
  }
  return false;
}
export function cancelBackup(id: string): boolean {
  const j = jobs.get(id);
  if (j && (j.state === "running" || j.state === "paused")) {
    j.state = "canceled";
    return true;
  }
  return false;
}
export function retryBackup(id: string): BackupJob | null {
  const old = jobs.get(id);
  if (!old || (old.state !== "failed" && old.state !== "canceled")) return null;
  return startBackup(old.targetDir);
}

// ---- 提醒计算 ----
export interface BackupReminder {
  lastBackupAt: string | null;
  intervalDays: number;
  remindDisabled: boolean;
  daysSinceBackup: number | null;
  due: boolean;
}

export async function getBackupReminder(): Promise<BackupReminder> {
  const db = getDb();
  const get = async (key: string) =>
    (await db.setting.findUnique({ where: { key } }))?.value ?? null;
  const lastBackupAt = await get("lastBackupAt");
  const intervalRaw = await get("backupIntervalDays");
  const disabled = (await get("backupRemindDisabled")) === "1";
  const intervalDays = intervalRaw ? Number(intervalRaw) : 30;
  const daysSinceBackup = lastBackupAt
    ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000)
    : null;
  const due = !disabled && (daysSinceBackup === null ? false : daysSinceBackup >= intervalDays);
  return { lastBackupAt, intervalDays, remindDisabled: disabled, daysSinceBackup, due };
}
