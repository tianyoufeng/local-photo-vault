export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

type Params = { params: { id: string } };

/** GET /api/photos/[id] — 照片详情（含 EXIF 与标签） */
export async function GET(_req: NextRequest, { params }: Params) {
  const denied = guardApi(_req);
  if (denied) return denied;
  const photo = await getDb().photo.findUnique({
    where: { id: params.id },
    include: {
      tags: { select: { name: true } },
      albums: { select: { id: true, name: true } },
    },
  });
  if (!photo) {
    return NextResponse.json({ error: "照片不存在" }, { status: 404 });
  }
  return NextResponse.json({
    ...photo,
    sizeBytes: photo.sizeBytes.toString(),
    tags: photo.tags.map((t) => t.name),
    albums: photo.albums.map((a) => ({ id: a.id, name: a.name })),
  });
}

/** PATCH /api/photos/[id] {rating?, favorite?, tags?} */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const db = getDb();
  const existing = await db.photo.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "照片不存在" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (body && Number.isInteger(body.rating) && body.rating >= 0 && body.rating <= 5) {
    data.rating = body.rating;
  }
  if (body && typeof body.favorite === "boolean") {
    data.favorite = body.favorite;
  }
  if (body && Array.isArray(body.tags)) {
    const names = [
      ...new Set(
        (body.tags as unknown[])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
      ),
    ].slice(0, 20);
    data.tags = {
      set: [], // 先清空再挂新集合
      connectOrCreate: names.map((name: string) => ({
        where: { name },
        create: { name },
      })),
    };
  }

  const photo = await db.photo.update({
    where: { id: params.id },
    data,
    include: { tags: { select: { name: true } } },
  });
  return NextResponse.json({
    ...photo,
    sizeBytes: photo.sizeBytes.toString(),
    tags: photo.tags.map((t) => t.name),
  });
}

/** DELETE /api/photos/[id] — 软删除进回收站 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = guardApi(_req);
  if (denied) return denied;
  const photo = await getDb().photo.update({
    where: { id: params.id },
    data: { deletedAt: new Date() },
    select: { id: true, deletedAt: true },
  });
  return NextResponse.json({ ok: true, ...photo });
}
