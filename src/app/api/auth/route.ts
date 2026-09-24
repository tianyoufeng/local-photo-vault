export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  getPasswordHash,
  isAuthenticated,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { isInitialized } from "@/lib/paths";

/** GET /api/auth → 当前初始化与登录状态 */
export async function GET() {
  return NextResponse.json({
    initialized: isInitialized(),
    authenticated: isAuthenticated(),
  });
}

/** POST /api/auth { password } → 密码登录 */
export async function POST(req: NextRequest) {
  if (!isInitialized()) {
    return NextResponse.json({ error: "应用尚未初始化" }, { status: 428 });
  }
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json({ error: "请输入密码" }, { status: 400 });
  }
  const stored = await getPasswordHash();
  if (!stored || !verifyPassword(password, stored)) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
  return res;
}

/** DELETE /api/auth → 退出登录 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
