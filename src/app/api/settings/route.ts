export const dynamic = "force-dynamic";

import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import {
  ensureVaultDirs,
  getPhotoRoot,
  isDirWritable,
  readBootConfig,
  writeBootConfig,
} from "@/lib/paths";

/** GET /api/settings → 当前照片根目录 */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const cfg = readBootConfig();
  return NextResponse.json({
    photoRoot: getPhotoRoot(),
    initializedAt: null,
    dbPath: cfg?.dbPath ?? null,
  });
}

/**
 * PUT /api/settings { photoRoot }
 * 阶段一范围：校验 → 创建目录与 .lpvault → 更新引导配置。
 * 数据库迁移（把库搬到新位置）属于后续阶段，这里不动 dbPath。
 */
export async function PUT(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const photoRoot =
    typeof body?.photoRoot === "string" ? body.photoRoot.trim() : "";
  if (!photoRoot) {
    return NextResponse.json({ error: "路径不能为空" }, { status: 400 });
  }
  const resolved = path.resolve(photoRoot);
  try {
    ensureVaultDirs(resolved);
  } catch (e) {
    return NextResponse.json(
      { error: `无法创建目录：${(e as Error).message}` },
      { status: 400 }
    );
  }
  if (!isDirWritable(resolved)) {
    return NextResponse.json({ error: "该目录不可写" }, { status: 400 });
  }

  const cfg = readBootConfig();
  if (!cfg) {
    return NextResponse.json({ error: "未初始化" }, { status: 428 });
  }
  writeBootConfig({ ...cfg, photoRoot: resolved });
  return NextResponse.json({ ok: true, photoRoot: resolved });
}
