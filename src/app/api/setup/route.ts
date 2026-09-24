export const dynamic = "force-dynamic";

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_PHOTO_ROOT,
  defaultDbPath,
  driveExists,
  ensureVaultDirs,
  getPhotoRoot,
  isDirWritable,
  isInitialized,
  writeBootConfig,
} from "@/lib/paths";
import {
  SESSION_COOKIE,
  createSessionToken,
  hashPassword,
  sessionCookieOptions,
  setPasswordHash,
} from "@/lib/auth";

const execFileAsync = promisify(execFile);

/** GET /api/setup → 向导第一步需要的信息 */
export async function GET() {
  if (isInitialized()) {
    return NextResponse.json({ initialized: true });
  }
  const photoRoot = getPhotoRoot(); // 未初始化时即默认值 D:\picture
  return NextResponse.json({
    initialized: false,
    photoRoot,
    defaultPhotoRoot: DEFAULT_PHOTO_ROOT,
    dDriveReady: driveExists(photoRoot),
    rootWritable: isDirWritable(path.parse(path.resolve(photoRoot)).root),
  });
}

/**
 * POST /api/setup { photoRoot?, password }
 * 向导执行：① 校验盘符 ② 创建 photoRoot 与 .lpvault
 * ③ 在最终位置建库（prisma db push）④ 写引导配置 + 设置密码
 */
export async function POST(req: NextRequest) {
  if (isInitialized()) {
    return NextResponse.json({ error: "已完成初始化" }, { status: 409 });
  }
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const photoRoot =
    typeof body?.photoRoot === "string" && body.photoRoot.trim()
      ? path.resolve(body.photoRoot.trim())
      : DEFAULT_PHOTO_ROOT;

  if (password.length < 4) {
    return NextResponse.json(
      { error: "密码至少 4 位" },
      { status: 400 }
    );
  }
  if (!driveExists(photoRoot)) {
    return NextResponse.json(
      { error: `目标盘不存在或不可写：${path.parse(photoRoot).root}` },
      { status: 400 }
    );
  }
  if (!isDirWritable(path.parse(path.resolve(photoRoot)).root)) {
    return NextResponse.json(
      { error: "目标盘不可写" },
      { status: 400 }
    );
  }

  // ② 创建目录
  let created: string[] = [];
  try {
    created = ensureVaultDirs(photoRoot).created;
  } catch (e) {
    return NextResponse.json(
      { error: `创建目录失败：${(e as Error).message}` },
      { status: 500 }
    );
  }

  const dbPath = defaultDbPath(photoRoot);
  const sessionSecret = crypto.randomBytes(32).toString("hex");

  // ③ 建库：调用 prisma db push（阶段一用 CLI，保证与 schema 一致）
  try {
    const prismaCli = path.join(
      process.cwd(),
      "node_modules",
      "prisma",
      "build",
      "index.js"
    );
    await execFileAsync(process.execPath, [prismaCli, "db", "push", "--skip-generate"], {
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath.replace(/\\/g, "/")}`,
      },
      timeout: 120_000,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `数据库初始化失败：${(e as Error).message}` },
      { status: 500 }
    );
  }

  // ④ 写引导配置 + 密码（密码走 Setting 表，需要先写配置才能连库）
  writeBootConfig({ photoRoot, dbPath, sessionSecret });
  try {
    await setPasswordHash(hashPassword(password));
  } catch (e) {
    // 回滚引导配置，避免留下"半初始化"状态
    fs.rmSync(path.join(process.cwd(), ".lpvault-boot.json"), { force: true });
    return NextResponse.json(
      { error: `写入密码失败：${(e as Error).message}` },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true, created, dbPath });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
  return res;
}
