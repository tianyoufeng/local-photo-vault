export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

/** GET /api/tags — 标签列表（含未删除照片计数） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const where = { deletedAt: null };
  const tags = await getDb().tag.findMany({
    include: { _count: { select: { photos: { where } } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    tags: tags.map((t) => ({ id: t.id, name: t.name, count: t._count.photos })),
  });
}

/** POST /api/tags {name} — 新建标签 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 50) {
    return NextResponse.json({ error: "标签名不能为空且不超过 50 字" }, { status: 400 });
  }
  const exists = await getDb().tag.findUnique({ where: { name } });
  if (exists) {
    return NextResponse.json({ error: "标签已存在" }, { status: 409 });
  }
  const tag = await getDb().tag.create({ data: { name } });
  return NextResponse.json({ ok: true, tag });
}
