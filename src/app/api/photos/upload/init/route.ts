export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { createUpload } from "@/lib/uploadSession";
import { ensureVaultSubDirs } from "@/lib/storage";
import { verifyUploadToken, UPLOAD_TOKEN_HEADER } from "@/lib/uploadToken";
import { getDiskStatus } from "@/lib/disk";
import { logWarn } from "@/lib/logger";

/** POST /api/photos/upload/init {fileName,size} → {uploadId, chunkSize} */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  // 可选上传令牌：启用后必须携带 x-upload-token 头（chunk/finalize 凭会话间接校验）
  if (!(await verifyUploadToken(req.headers.get(UPLOAD_TOKEN_HEADER)))) {
    return NextResponse.json(
      { error: "需要上传令牌（x-upload-token）", needToken: true },
      { status: 401 }
    );
  }
  const body = await req.json().catch(() => null);
  const fileName = typeof body?.fileName === "string" ? body.fileName : "";
  const size = Number(body?.size);
  if (!fileName || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }
  // 磁盘空间阈值守护：剩余空间不足则拒绝上传（宪法：磁盘满有提示）
  const disk = await getDiskStatus();
  if (!disk.ok) {
    const freeGB = (disk.freeBytes / (1 << 30)).toFixed(1);
    const minGB = (disk.minFreeBytes / (1 << 30)).toFixed(1);
    logWarn("disk", "low_space_reject_upload", { fileName, freeGB, minGB });
    return NextResponse.json(
      { error: `磁盘剩余空间不足（剩余 ${freeGB} GB，低于阈值 ${minGB} GB），请清理后再上传`, diskFull: true },
      { status: 507 }
    );
  }
  ensureVaultSubDirs();
  const { uploadId, chunkSize } = createUpload(fileName, size);
  return NextResponse.json({ uploadId, chunkSize });
}
