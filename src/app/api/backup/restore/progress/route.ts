export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getRestoreJob } from "@/lib/restore";

/** GET /api/backup/restore/progress?jobId= — 恢复进度轮询 */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const jobId = req.nextUrl.searchParams.get("jobId") ?? "";
  const job = getRestoreJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({
    id: job.id,
    state: job.state,
    mode: job.mode,
    stage: job.stage,
    filesDone: job.filesDone,
    filesTotal: job.filesTotal,
    currentFile: job.currentFile ?? null,
    error: job.error ?? null,
    rolledBack: job.rolledBack ?? false,
    summary: job.summary ?? null,
  });
}
