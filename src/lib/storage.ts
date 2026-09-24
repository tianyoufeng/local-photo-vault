import fs from "node:fs";
import path from "node:path";
import { readBootConfig, VAULT_DIR_NAME } from "./paths";

/**
 * 阶段二：原图存储布局与临时文件管理
 * - 原图：<photoRoot>\YYYY\MM\<原始文件名>（重名加 sha256 前 8 位前缀）
 * - 缩略图：<photoRoot>\.lpvault\thumbnails\<sha前2位>\<sha>.webp
 * - 上传临时文件：<photoRoot>\.lpvault\tmp\<uploadId>.part
 */

export interface VaultPaths {
  photoRoot: string;
  vaultDir: string;
  tmpDir: string;
  thumbDir: string;
}

export function getVaultPaths(): VaultPaths {
  const cfg = readBootConfig();
  if (!cfg) throw new Error("NOT_INITIALIZED");
  const vaultDir = path.join(cfg.photoRoot, VAULT_DIR_NAME);
  return {
    photoRoot: cfg.photoRoot,
    vaultDir,
    tmpDir: path.join(vaultDir, "tmp"),
    thumbDir: path.join(vaultDir, "thumbnails"),
  };
}

export function ensureVaultSubDirs(): VaultPaths {
  const p = getVaultPaths();
  for (const dir of [p.photoRoot, p.vaultDir, p.tmpDir, p.thumbDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  return p;
}

/** 文件名净化：去路径分隔符、控制字符、前后空白；空则兜底 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .split(/[/\\]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || "unnamed";
}

/** 拼接路径后必须仍位于 base 内（防穿越最终防线） */
export function assertInside(base: string, target: string): void {
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("PATH_TRAVERSAL");
  }
}

/** 清理超过 maxAgeMs 的 tmp 残留（init 时、启动时调用） */
export function cleanStaleTmp(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const p = getVaultPaths();
  if (!fs.existsSync(p.tmpDir)) return 0;
  let removed = 0;
  const now = Date.now();
  for (const f of fs.readdirSync(p.tmpDir)) {
    if (!f.endsWith(".part")) continue;
    const full = path.join(p.tmpDir, f);
    try {
      if (now - fs.statSync(full).mtimeMs > maxAgeMs) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch {
      /* 单个文件失败不影响其余 */
    }
  }
  return removed;
}

/**
 * 把 tmp 分片文件落到最终位置 <photoRoot>\YYYY\MM\<名>。
 * 重名处理：目标存在且内容不同 → 加 sha256 前 8 位前缀；内容相同 → 直接复用现有文件。
 * 返回 { storedName, reusedDiskFile }（reusedDiskFile=true 表示未发生磁盘写入）。
 */
export function placeOriginal(
  tmpPath: string,
  originalName: string,
  sha256: string,
  takenAt: Date | null
): { storedName: string; reusedDiskFile: boolean } {
  const { photoRoot } = ensureVaultSubDirs();
  const when = takenAt ?? new Date();
  const dir = path.join(
    photoRoot,
    String(when.getFullYear()),
    String(when.getMonth() + 1).padStart(2, "0")
  );
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const safeName = sanitizeFileName(originalName);
  let finalPath = path.join(dir, safeName);
  assertInside(photoRoot, finalPath);

  // 重名：无论内容是否相同，只要目标已存在就换用 sha256 前 8 位前缀的名字
  // （同内容的情况正常会先被数据库去重拦截，走到这里多为库/盘不同步的兜底）
  let n = 0;
  while (fs.existsSync(finalPath)) {
    const prefix = n === 0 ? sha256.slice(0, 8) : `${sha256.slice(0, 8)}_${n}`;
    finalPath = path.join(dir, `${prefix}_${safeName}`);
    assertInside(photoRoot, finalPath);
    n++;
  }

  fs.renameSync(tmpPath, finalPath);
  return { storedName: path.relative(photoRoot, finalPath), reusedDiskFile: false };
}

/** 按 storedName 解析磁盘绝对路径（含防穿越校验） */
export function resolveStoredPath(storedName: string): string {
  const { photoRoot } = getVaultPaths();
  const full = path.join(photoRoot, storedName);
  assertInside(photoRoot, full);
  return full;
}

export function thumbPathFor(sha256: string): string {
  const { thumbDir } = getVaultPaths();
  const dir = path.join(thumbDir, sha256.slice(0, 2));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sha256}.webp`);
}
