import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readBootConfig, VAULT_DIR_NAME } from "./paths";

/**
 * 桌面令牌：桌面壳内嵌 WebView 才能拿到的共享密钥。
 * 服务端启动后首次使用时生成 64 位 hex 写入 <照片根目录>\.lpvault\desktop-token；
 * Rust 壳通过 get_desktop_token 命令读取同一文件；
 * import 类接口必须携带 X-LPV-Desktop 头且与文件内容一致——
 * 局域网上的手机拿不到该文件，从而无法诱导服务端读取/导入任意本地路径。
 */

export const DESKTOP_TOKEN_HEADER = "x-lpv-desktop";

export function ensureDesktopToken(): string {
  const cfg = readBootConfig();
  if (!cfg) throw new Error("NOT_INITIALIZED");
  const vaultDir = path.join(cfg.photoRoot, VAULT_DIR_NAME);
  if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
  const tokenPath = path.join(vaultDir, "desktop-token");
  if (fs.existsSync(tokenPath)) {
    const t = fs.readFileSync(tokenPath, "utf-8").trim();
    if (/^[a-f0-9]{64}$/.test(t)) return t;
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenPath, token, "utf-8");
  return token;
}

export function verifyDesktopToken(headerValue: string | null): boolean {
  try {
    // 无论请求是否带令牌，都先确保令牌文件存在（服务端是令牌的生成方）。
    // 注意：必须先执行 ensureDesktopToken 再比较，避免 && 短路跳过生成逻辑。
    const expected = ensureDesktopToken();
    const ok = !!headerValue && headerValue === expected;
    if (!ok) {
      console.error(
        `[desktopToken] 校验失败: header=${headerValue?.slice(0, 8) ?? "null"} expected=${expected.slice(0, 8)}`
      );
    }
    return ok;
  } catch (e) {
    console.error(`[desktopToken] ensure 异常: ${(e as Error).message}`);
    return false;
  }
}

/** 找到 .lpvault 目录（供 Rust 侧提示路径用，服务端调试用） */
export function vaultDirForShell(): string | null {
  const cfg = readBootConfig();
  if (!cfg) return null;
  return path.join(cfg.photoRoot, VAULT_DIR_NAME);
}
