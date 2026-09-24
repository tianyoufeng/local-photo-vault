import { PrismaClient } from "@prisma/client";
import { readBootConfig, sqliteUrlFor } from "./paths";

/**
 * Prisma 单例。
 * 数据库位置来自引导配置（初始化向导确定后固定）；
 * 未初始化时不创建连接（页面守卫会把用户导向 /setup）。
 */
let prisma: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (prisma) return prisma;
  const cfg = readBootConfig();
  if (!cfg) {
    throw new Error("NOT_INITIALIZED");
  }
  prisma = new PrismaClient({
    datasources: { db: { url: sqliteUrlFor(cfg.dbPath) } },
  });
  // SQLite WAL：读查询不阻塞写（上传与浏览并发更顺），同一连接内生效
  void prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch(() => null);
  void prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000").catch(() => null);
  return prisma;
}

export function isDbConnected(): boolean {
  return prisma !== null;
}
