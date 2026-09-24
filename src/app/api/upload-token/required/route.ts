export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getUploadToken } from "@/lib/uploadToken";

/** GET /api/upload-token/required — 是否启用了上传令牌（手机端上传页据此显示输入框） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  return NextResponse.json({ required: Boolean(await getUploadToken()) });
}
