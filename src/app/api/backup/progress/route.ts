export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getBackupJob } from "@/lib/backup";

/** GET /api/backup/progress?jobId= — 备份进度轮询 */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const jobId = req.nextUrl.searchParams.get("jobId") ?? "";
  const job = getBackupJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({
    id: job.id,
    state: job.state,
    fileName: job.fileName,
    filesDone: job.filesDone,
    filesTotal: job.filesTotal,
    bytesDone: job.bytesDone,
    bytesTotal: job.bytesTotal,
    currentFile: job.currentFile ?? null,
    error: job.error ?? null,
    archiveSha256: job.archiveSha256 ?? null,
  });
}
