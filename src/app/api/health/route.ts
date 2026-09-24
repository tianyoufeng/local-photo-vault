export const dynamic = "force-dynamic";

import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * GET /api/health — 桌面壳握手探针（无需登录）。
 * 返回应用标识 + 本次构建的 BUILD_ID，供 LocalPhotoVault.exe 判断
 * 8787 端口上跑的是不是「自己这一版」的服务：
 *   - buildId 相同 → 复用（避免重复启动）
 *   - buildId 不同 / 不是本应用 → 视为僵尸旧进程，由壳层清理后重启
 */
export async function GET() {
  let buildId = "";
  const candidates = [
    path.join(process.cwd(), ".next", "BUILD_ID"),
    path.join(__dirname, "..", "..", "..", "..", "BUILD_ID"),
  ];
  for (const p of candidates) {
    try {
      buildId = fs.readFileSync(p, "utf-8").trim();
      if (buildId) break;
    } catch {
      /* 继续尝试下一个 */
    }
  }
  return NextResponse.json(
    { app: "LocalPhotoVault", version: "1.0.0", buildId, pid: process.pid, time: Date.now() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
