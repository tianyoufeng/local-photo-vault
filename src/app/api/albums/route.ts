export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

/** GET /api/albums — 相册列表（计数 + 封面） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const where = { deletedAt: null };
  const albums = await getDb().album.findMany({
    include: {
      _count: { select: { photos: { where } } },
      photos: { where, orderBy: { takenAt: "desc" }, take: 1, select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    albums: albums.map((a) => ({
      id: a.id,
      name: a.name,
      count: a._count.photos,
      coverThumbUrl: a.photos[0] ? `/api/photos/${a.photos[0].id}/thumbnail` : null,
    })),
  });
}

/** POST /api/albums {name} — 新建相册 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 50) {
    return NextResponse.json({ error: "相册名不能为空且不超过 50 字" }, { status: 400 });
  }
  const exists = await getDb().album.findUnique({ where: { name } });
  if (exists) {
    return NextResponse.json({ error: "相册已存在" }, { status: 409 });
  }
  const album = await getDb().album.create({ data: { name } });
  return NextResponse.json({ ok: true, album });
}
