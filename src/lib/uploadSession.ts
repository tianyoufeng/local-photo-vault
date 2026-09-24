import fs from "node:fs";
import path from "node:path";
import { ensureVaultSubDirs, assertInside, cleanStaleTmp } from "./storage";

/**
 * 上传会话（内存态，进程级单例）。
 * 分片按偏移量随机写入（支持乱序/并发到达），每片完成位图跟踪；
 * finalize 要求全部位图就位；abort 删除临时文件。
 * 服务重启后残留的 .part 由 cleanStaleTmp 兜底清理（>24h）。
 */

export interface UploadSession {
  fileName: string;
  size: number;
  tmpPath: string;
  fd: number;
  expectedChunks: number;
  chunkBits: Uint8Array;
  receivedChunks: number;
  createdAt: number;
}

const uploads: Map<string, UploadSession> = ((globalThis as Record<string, unknown>).__lpvUploads ??=
  new Map()) as Map<string, UploadSession>;

export const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

export function createUpload(fileName: string, size: number): {
  uploadId: string;
  chunkSize: number;
} {
  ensureVaultSubDirs();
  cleanStaleTmp();
  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const { tmpDir } = ensureVaultSubDirs();
  const tmpPath = path.join(tmpDir, `${uploadId}.part`);
  assertInside(tmpDir, tmpPath);
  fs.writeFileSync(tmpPath, Buffer.alloc(0));
  const expectedChunks = Math.ceil(size / CHUNK_SIZE);
  uploads.set(uploadId, {
    fileName,
    size,
    tmpPath,
    fd: fs.openSync(tmpPath, "r+"),
    expectedChunks,
    chunkBits: new Uint8Array(expectedChunks),
    receivedChunks: 0,
    createdAt: Date.now(),
  });
  return { uploadId, chunkSize: CHUNK_SIZE };
}

export function getUpload(uploadId: string): UploadSession | null {
  if (!/^[a-f0-9]{32}$/.test(uploadId)) return null;
  return uploads.get(uploadId) ?? null;
}

/** 按偏移写入分片（乱序/并发安全：单线程事件循环内顺序执行） */
export function writeChunkAt(uploadId: string, index: number, chunk: Buffer): number | null {
  const s = uploads.get(uploadId);
  if (!s) return null;
  if (!Number.isInteger(index) || index < 0 || index >= s.expectedChunks) return null;
  if (chunk.length > CHUNK_SIZE) return null;
  if (s.chunkBits[index] === 1) return s.receivedChunks; // 重复片，幂等忽略
  const offset = index * CHUNK_SIZE;
  if (offset + chunk.length > s.size) return null;
  fs.writeSync(s.fd, chunk, 0, chunk.length, offset);
  s.chunkBits[index] = 1;
  s.receivedChunks++;
  return s.receivedChunks;
}

export function isUploadComplete(s: UploadSession): boolean {
  return s.receivedChunks === s.expectedChunks;
}

export function finishUpload(uploadId: string): UploadSession | null {
  const s = uploads.get(uploadId);
  if (!s) return null;
  uploads.delete(uploadId);
  try {
    fs.closeSync(s.fd);
  } catch { /* 已关闭 */ }
  return s;
}

export function abortUpload(uploadId: string): boolean {
  const s = uploads.get(uploadId);
  if (!s) return false;
  try {
    fs.closeSync(s.fd);
  } catch { /* 已关闭 */ }
  try {
    fs.unlinkSync(s.tmpPath);
  } catch { /* 文件可能已被清理 */ }
  uploads.delete(uploadId);
  return true;
}
