export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import {
  pauseBackup,
  resumeBackup,
  cancelBackup,
  retryBackup,
} from "@/lib/backup";

/**
 * POST /api/backup/control {jobId, op}
 * op: pause | resume | cancel | retry
 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const op = typeof body?.op === "string" ? body.op : "";
  let ok = false;
  let newJobId: string | null = null;
  if (op === "pause") ok = pauseBackup(jobId);
  else if (op === "resume") ok = resumeBackup(jobId);
  else if (op === "cancel") ok = cancelBackup(jobId);
  else if (op === "retry") {
    const j = retryBackup(jobId);
    ok = Boolean(j);
    newJobId = j?.id ?? null;
  } else {
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }
  return NextResponse.json({ ok, jobId: newJobId ?? jobId });
}
