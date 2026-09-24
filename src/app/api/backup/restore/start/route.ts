export const dynamic = "force-dynamic";

import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { verifyDesktopToken, DESKTOP_TOKEN_HEADER } from "@/lib/desktopToken";
import { startRestore } from "@/lib/restore";

/** POST /api/backup/restore/start {archivePath, mode, newPhotoRoot?} — 仅桌面端 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  if (!verifyDesktopToken(req.headers.get(DESKTOP_TOKEN_HEADER))) {
    return NextResponse.json({ error: "恢复操作仅桌面端可用" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const archivePath =
    typeof body?.archivePath === "string" && body.archivePath.trim()
      ? path.resolve(body.archivePath.trim())
      : "";
  const mode = body?.mode === "overwrite" ? "overwrite" : "merge";
  const newPhotoRoot =
    typeof body?.newPhotoRoot === "string" && body.newPhotoRoot.trim()
      ? path.resolve(body.newPhotoRoot.trim())
      : undefined;
  if (!archivePath || !archivePath.toLowerCase().endsWith(".lpvbackup")) {
    return NextResponse.json({ error: "请提供 .lpvbackup 备份文件路径" }, { status: 400 });
  }
  const job = startRestore(archivePath, mode, newPhotoRoot);
  if (!job) {
    return NextResponse.json({ error: "备份文件不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, jobId: job.id });
}
