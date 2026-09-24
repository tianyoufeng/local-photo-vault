export const dynamic = "force-dynamic";

import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { verifyDesktopToken, DESKTOP_TOKEN_HEADER } from "@/lib/desktopToken";
import { scanPaths, createJob } from "@/lib/importer";

/**
 * POST /api/photos/import/scan {paths[], mode}
 * 桌面令牌 + 登录双重校验；递归扫描文件夹 → 建导入任务
 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  if (!verifyDesktopToken(req.headers.get(DESKTOP_TOKEN_HEADER))) {
    return NextResponse.json(
      { error: "仅桌面端可使用本地导入" },
      { status: 403 }
    );
  }
  const body = await req.json().catch(() => null);
  const rawPaths: unknown = body?.paths;
  const mode = body?.mode === "move" ? "move" : "copy";
  if (!Array.isArray(rawPaths) || rawPaths.length === 0 ||
      !rawPaths.every((p) => typeof p === "string" && p.trim())) {
    return NextResponse.json({ error: "paths 参数错误" }, { status: 400 });
  }
  // 统一为绝对路径；来源是 Tauri 拖拽事件给的本机路径
  const paths = [...new Set(rawPaths.map((p: string) => path.resolve(p.trim())))];
  const { files, skipped } = scanPaths(paths);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "未找到可导入的照片文件", skipped: skipped.length },
      { status: 400 }
    );
  }
  const job = createJob(mode, files);
  return NextResponse.json({
    importId: job.id,
    mode,
    total: job.files.length,
    totalSize: job.totalSize,
    skipped: skipped.length,
  });
}
