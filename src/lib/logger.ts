import fs from "node:fs";
import path from "node:path";
import { getVaultPaths } from "./storage";

/**
 * 结构化日志：JSONL 写入 .lpvault\logs\lpv-YYYY-MM-DD.log
 * 每日轮转；读日志文件时惰性清理 7 天前的旧文件。
 */

type Level = "info" | "warn" | "error";

let lastCleanDay = "";

function logDir(): string {
  const { vaultDir } = getVaultPaths();
  const dir = path.join(vaultDir, "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanOldLogs(dir: string): void {
  const today = new Date().toDateString();
  if (lastCleanDay === today) return;
  lastCleanDay = today;
  const cutoff = Date.now() - 7 * 86400000;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith("lpv-") || !f.endsWith(".log")) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch { /* 单文件失败忽略 */ }
    }
  } catch { /* 目录失败忽略 */ }
}

export function log(
  level: Level,
  component: string,
  event: string,
  data?: Record<string, unknown>
): void {
  try {
    const dir = logDir();
    cleanOldLogs(dir);
    const now = new Date();
    const file = path.join(
      dir,
      `lpv-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}.log`
    );
    const line = JSON.stringify({
      ts: now.toISOString(),
      level,
      component,
      event,
      ...(data ?? {}),
    });
    fs.appendFileSync(file, line + "\n", "utf-8");
  } catch { /* 日志失败绝不阻断业务 */ }
}

export const logInfo = (component: string, event: string, data?: Record<string, unknown>) =>
  log("info", component, event, data);
export const logWarn = (component: string, event: string, data?: Record<string, unknown>) =>
  log("warn", component, event, data);
export const logError = (component: string, event: string, data?: Record<string, unknown>) =>
  log("error", component, event, data);
