import crypto from "node:crypto";
import { getDb } from "./db";

/**
 * 可选上传令牌（UPLOAD_TOKEN）：
 * - Setting 表 uploadToken；为空字符串/不存在 = 关闭（不加校验）
 * - 启用后，上传类接口必须携带 x-upload-token 请求头（绝不放 URL）
 * - 手机端通过登录页输入获取并保存到 localStorage
 */

export const UPLOAD_TOKEN_HEADER = "x-upload-token";

export async function getUploadToken(): Promise<string | null> {
  const row = await getDb().setting.findUnique({ where: { key: "uploadToken" } });
  const t = row?.value?.trim();
  return t ? t : null;
}

export async function setUploadToken(token: string | null): Promise<void> {
  const db = getDb();
  const value = token?.trim() ?? "";
  await db.setting.upsert({
    where: { key: "uploadToken" },
    update: { value },
    create: { key: "uploadToken", value },
  });
}

export function generateUploadToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** 上传接口校验：token 未启用时直接放行 */
export async function verifyUploadToken(headerValue: string | null): Promise<boolean> {
  const expected = await getUploadToken();
  if (!expected) return true; // 未启用
  return !!headerValue && headerValue === expected;
}
