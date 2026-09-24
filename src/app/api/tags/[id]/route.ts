export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

type Params = { params: { id: string } };

/** PATCH /api/tags/[id] {name} — 重命名（照片关联自动跟随） */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 50) {
    return NextResponse.json({ error: "标签名不能为空且不超过 50 字" }, { status: 400 });
  }
  const db = getDb();
  const dup = await db.tag.findFirst({
    where: { name, id: { not: params.id } },
  });
  if (dup) {
    return NextResponse.json({ error: "已存在同名标签" }, { status: 409 });
  }
  const tag = await db.tag.update({ where: { id: params.id }, data: { name } });
  return NextResponse.json({ ok: true, tag });
}

/** DELETE /api/tags/[id] — 删除标签（自动从所有照片摘除） */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = guardApi(_req);
  if (denied) return denied;
  await getDb().tag.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
