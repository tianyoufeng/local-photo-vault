import fs from "node:fs";
import { getVaultPaths } from "./storage";
import { getDb } from "./db";

/**
 * 磁盘空间守护：照片根目录所在盘剩余空间低于阈值则拒绝上传。
 * 阈值存 Setting 表 diskMinFreeGB（默认 2GB）。
 */

export interface DiskStatus {
  freeBytes: number;
  totalBytes: number;
  minFreeBytes: number;
  ok: boolean;
}

export async function getDiskStatus(): Promise<DiskStatus> {
  const { photoRoot } = getVaultPaths();
  let freeBytes = 0;
  let totalBytes = 0;
  try {
    const st = fs.statfsSync(photoRoot);
    freeBytes = Number(st.bavail) * Number(st.bsize);
    totalBytes = Number(st.blocks) * Number(st.bsize);
  } catch { /* statfs 失败时放行（不阻断上传） */ }

  const row = await getDb().setting
    .findUnique({ where: { key: "diskMinFreeGB" } })
    .catch(() => null);
  const minGB = row?.value ? Number(row.value) : 2;
  const minFreeBytes = (Number.isFinite(minGB) ? minGB : 2) * 1024 * 1024 * 1024;
  return {
    freeBytes,
    totalBytes,
    minFreeBytes,
    ok: freeBytes === 0 ? true : freeBytes >= minFreeBytes, // 查不到空间信息不阻断
  };
}
