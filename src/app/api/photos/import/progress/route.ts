export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getJob } from "@/lib/importer";

/** GET /api/photos/import/progress?importId= — 轮询导入进度 */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const importId = req.nextUrl.searchParams.get("importId") ?? "";
  const job = getJob(importId);
  if (!job) {
    return NextResponse.json({ error: "导入任务不存在" }, { status: 404 });
  }
  const done = job.files.filter((f) => f.status !== "pending").length;
  const success = job.files.filter((f) => f.status === "done").length;
  const failed = job.files.filter((f) => f.status === "failed");
  return NextResponse.json({
    state: job.state,
    mode: job.mode,
    total: job.files.length,
    done,
    success,
    failed: failed.length,
    current: job.current
      ? { path: job.current, bytes: job.copiedBytes, totalSize: job.totalSize }
      : null,
    failures: failed.map((f) => ({ path: f.path, error: f.error })),
    results: job.files.map((f) => ({
      path: f.path,
      status: f.status,
      photoId: f.photoId,
      duplicate: f.duplicate,
      sourceDeleted: f.sourceDeleted,
      warning: f.warning,
      error: f.error,
    })),
  });
}
