export const dynamic = "force-dynamic";

import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { startBackup } from "@/lib/backup";

/**
 * POST /api/backup/start {targetDir} — 启动全量备份
 * 电脑/手机均可发起（仅需登录）：备份只写入新归档、不删不改任何现有数据，
 * 目标路径由服务端执行，手机浏览器只是触发方。恢复操作才需要桌面令牌。
 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const targetDir =
    typeof body?.targetDir === "string" && body.targetDir.trim()
      ? path.resolve(body.targetDir.trim())
      : "";
  if (!targetDir) {
    return NextResponse.json({ error: "请指定备份目标目录" }, { status: 400 });
  }
  // 目标目录不能在照片根目录或 .lpvault 内部（防自我吞噬）
  const cfg = (await import("@/lib/paths")).readBootConfig();
  if (cfg) {
    const root = path.resolve(cfg.photoRoot);
    if (targetDir.toLowerCase().startsWith(root.toLowerCase())) {
      return NextResponse.json(
        { error: "备份目标不能位于照片根目录内，请选择其他磁盘或目录" },
        { status: 400 }
      );
    }
  }
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.accessSync(targetDir, fs.constants.W_OK);
  } catch (e) {
    return NextResponse.json(
      { error: `目标目录不可写：${(e as Error).message}` },
      { status: 400 }
    );
  }
  const job = startBackup(targetDir);
  return NextResponse.json({ ok: true, jobId: job.id, fileName: job.fileName });
}
