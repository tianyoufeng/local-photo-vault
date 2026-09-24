export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { verifyDesktopToken, DESKTOP_TOKEN_HEADER } from "@/lib/desktopToken";
import { getJob, startJob } from "@/lib/importer";

/** POST /api/photos/import/run {importId, paths?} — 启动后台导入；paths 用于失败重试 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  if (!verifyDesktopToken(req.headers.get(DESKTOP_TOKEN_HEADER))) {
    return NextResponse.json({ error: "仅桌面端可使用本地导入" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const importId = typeof body?.importId === "string" ? body.importId : "";
  const job = getJob(importId);
  if (!job) {
    return NextResponse.json({ error: "导入任务不存在" }, { status: 404 });
  }
  const onlyPaths = Array.isArray(body?.paths)
    ? body.paths.filter((p: unknown) => typeof p === "string")
    : undefined;
  startJob(job, onlyPaths);
  return NextResponse.json({ ok: true, state: job.state });
}
