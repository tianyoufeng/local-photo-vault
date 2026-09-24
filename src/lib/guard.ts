import { NextResponse } from "next/server";
import { isInitialized } from "./paths";
import { isAuthenticated, isAuthenticatedFromHeader } from "./auth";

/**
 * 页面守卫：阶段一的路由保护在服务端组件层完成
 * （未初始化 → /setup；未登录 → /login），不走 edge middleware，
 * 因为 scrypt/引导配置读取都依赖 Node 运行时。
 */
export type GuardResult =
  | { ok: true }
  | { ok: false; redirect: "/setup" | "/login" };

export function guardPage(): GuardResult {
  if (!isInitialized()) return { ok: false, redirect: "/setup" };
  if (!isAuthenticated()) return { ok: false, redirect: "/login" };
  return { ok: true };
}

/** API 守卫：已初始化 + 已登录才放行。
 *  会话从 req.headers 的 Cookie 头解析（standalone 模式下
 *  next/headers 的 cookies() 读不到请求作用域，会抛 500） */
export function guardApi(req?: { headers: { get(name: string): string | null } }): NextResponse | null {
  if (!isInitialized()) {
    return NextResponse.json({ error: "未初始化" }, { status: 428 });
  }
  const cookieHeader = req?.headers?.get("cookie") ?? null;
  if (!isAuthenticatedFromHeader(cookieHeader)) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  return null;
}
