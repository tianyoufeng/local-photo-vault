import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { readBootConfig } from "./paths";

/**
 * 认证方案（阶段一：单用户简单密码登录）
 * - 密码哈希：node:crypto scrypt（不引第三方原生依赖）
 * - 会话：HMAC-SHA256 签名的 HttpOnly Cookie，7 天有效
 */

export const SESSION_COOKIE = "lpv_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// ---------- 密码哈希 ----------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return (
    hash.length === expected.length && crypto.timingSafeEqual(hash, expected)
  );
}

// ---------- 会话令牌 ----------

function getSecret(): string {
  return readBootConfig()?.sessionSecret ?? "lpv-dev-secret";
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
}

export function createSessionToken(): string {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}

// ---------- 服务端会话读取 ----------

export function isAuthenticated(): boolean {
  return verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
}

/** 从 Cookie 请求头解析会话（API 路由用：standalone 下 next/headers 的
 *  cookies() 读不到请求作用域，改走 req.headers 绕开） */
export function isAuthenticatedFromHeader(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  const m = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return m ? verifySessionToken(m[1]) : false;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false, // 局域网 HTTP 访问，不开 secure
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

// ---------- 密码存取（Setting 表） ----------

export async function getPasswordHash(): Promise<string | null> {
  try {
    const row = await getDb().setting.findUnique({
      where: { key: "passwordHash" },
    });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setPasswordHash(hash: string): Promise<void> {
  await getDb().setting.upsert({
    where: { key: "passwordHash" },
    update: { value: hash },
    create: { key: "passwordHash", value: hash },
  });
}
