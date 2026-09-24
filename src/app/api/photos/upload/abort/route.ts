export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { abortUpload } from "@/lib/uploadSession";

/** DELETE /api/photos/upload/abort?uploadId= — 取消上传并清理临时文件 */
export async function DELETE(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const uploadId = req.nextUrl.searchParams.get("uploadId") ?? "";
  abortUpload(uploadId);
  return NextResponse.json({ ok: true });
}
