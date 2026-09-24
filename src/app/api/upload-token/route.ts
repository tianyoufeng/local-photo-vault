export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getUploadToken, setUploadToken, generateUploadToken } from "@/lib/uploadToken";

/** GET /api/upload-token — 令牌状态（掩码显示） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const t = await getUploadToken();
  return NextResponse.json({
    enabled: Boolean(t),
    masked: t ? `${t.slice(0, 8)}…${t.slice(-4)}` : null,
    full: t, // 局域网内仅登录用户可见，方便复制到手机
  });
}

/** PUT /api/upload-token {token?} — 生成（不传 token 则随机）或自定义设置 */
export async function PUT(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const custom = typeof body?.token === "string" ? body.token.trim() : "";
  if (custom && (custom.length < 8 || custom.length > 128)) {
    return NextResponse.json({ error: "自定义令牌需 8-128 位" }, { status: 400 });
  }
  const token = custom || generateUploadToken();
  await setUploadToken(token);
  return NextResponse.json({ ok: true, full: token });
}

/** DELETE /api/upload-token — 关闭上传令牌校验 */
export async function DELETE(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  await setUploadToken(null);
  return NextResponse.json({ ok: true });
}
