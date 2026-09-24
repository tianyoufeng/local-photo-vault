export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

type Params = { params: { id: string } };

/** PATCH /api/albums/[id] {name} — 重命名 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 50) {
    return NextResponse.json({ error: "相册名不能为空且不超过 50 字" }, { status: 400 });
  }
  const db = getDb();
  const dup = await db.album.findFirst({
    where: { name, id: { not: params.id } },
  });
  if (dup) {
    return NextResponse.json({ error: "已存在同名相册" }, { status: 409 });
  }
  const album = await db.album.update({ where: { id: params.id }, data: { name } });
  return NextResponse.json({ ok: true, album });
}

/** DELETE /api/albums/[id] — 删除相册（仅解除关联，不动照片） */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = guardApi(_req);
  if (denied) return denied;
  await getDb().album.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
