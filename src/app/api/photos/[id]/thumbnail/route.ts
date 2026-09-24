export const dynamic = "force-dynamic";

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { resolveStoredPath } from "@/lib/storage";
import { ensureThumbnail } from "@/lib/thumb";

type Params = { params: { id: string } };

/** GET /api/photos/[id]/thumbnail — 缩略图 WebP（缺失时按需生成） */
export async function GET(_req: NextRequest, { params }: Params) {
  const denied = guardApi(_req);
  if (denied) return denied;

  const photo = await getDb().photo.findUnique({
    where: { id: params.id },
    select: { sha256: true, storedName: true, kind: true, originalName: true },
  });
  if (!photo) {
    return NextResponse.json({ error: "照片不存在" }, { status: 404 });
  }

  let path: string;
  try {
    path = await ensureThumbnail(
      resolveStoredPath(photo.storedName),
      photo.sha256,
      photo.kind,
      photo.originalName
    );
  } catch {
    return NextResponse.json({ error: "缩略图生成失败" }, { status: 500 });
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(path);
  } catch {
    return NextResponse.json({ error: "缩略图读取失败" }, { status: 500 });
  }
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable", // 按 sha256 寻址，内容不变
      "Content-Length": String(buf.length),
    },
  });
}
