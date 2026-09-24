import fs from "node:fs";
import { getDb } from "./db";
import { resolveStoredPath } from "./storage";

/**
 * 回收站：软删除保留 30 天（宪法第 5 条）。
 * 物理删除前按 storedName 做引用计数——
 * 「盘一份、图库多条」策略下，最后一条记录删除时才真正删文件。
 */

export const RETENTION_DAYS = 30;

function refCount(storedName: string, excludeId?: string): Promise<number> {
  return getDb().photo.count({
    where: {
      storedName,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/** 删除单条记录并按需清理物理文件；返回 {fileDeleted} */
export async function purgePhotoRecord(id: string): Promise<{ fileDeleted: boolean }> {
  const db = getDb();
  const row = await db.photo.findUnique({ where: { id } });
  if (!row) return { fileDeleted: false };
  await db.photo.delete({ where: { id } });
  const refs = await refCount(row.storedName);
  if (refs === 0) {
    try {
      fs.unlinkSync(resolveStoredPath(row.storedName));
      return { fileDeleted: true };
    } catch {
      return { fileDeleted: false };
    }
  }
  return { fileDeleted: false };
}

/** 清理超过保留期的回收站记录；返回清理条数 */
export async function purgeExpired(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await db.photo.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true },
    take: 200,
  });
  let n = 0;
  for (const { id } of expired) {
    await purgePhotoRecord(id);
    n++;
  }
  return n;
}

/** 惰性清理入口：列表/回收站请求时先跑一次（有乐观短路，无过期项时开销极小） */
export async function lazyPurge(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const has = await getDb().photo.findFirst({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
    });
    if (has) await purgeExpired();
  } catch {
    /* 清理失败不影响主流程 */
  }
}
