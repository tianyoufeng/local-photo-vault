export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

type Params = { params: { id: string } };

/** POST /api/albums/[id]/photos {photoIds[]} — 批量添加照片到相册 */
export async function POST(req: NextRequest, { params }: Params) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.photoIds)
    ? body.photoIds.filter((x: unknown) => typeof x === "string").slice(0, 1000)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "缺少 photoIds" }, { status: 400 });
  }
  const db = getDb();
  const album = await db.album.findUnique({ where: { id: params.id } });
  if (!album) {
    return NextResponse.json({ error: "相册不存在" }, { status: 404 });
  }
  let added = 0;
  const failures: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      await db.photo.update({
        where: { id },
        data: { albums: { connect: { id: album.id } } },
      });
      added++;
    } catch (e) {
      failures.push({ id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ok: true, added, failures });
}

/** DELETE /api/albums/[id]/photos {photoIds[]} — 从相册批量移除照片 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.photoIds)
    ? body.photoIds.filter((x: unknown) => typeof x === "string").slice(0, 1000)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "缺少 photoIds" }, { status: 400 });
  }
  const db = getDb();
  const album = await db.album.findUnique({ where: { id: params.id } });
  if (!album) {
    return NextResponse.json({ error: "相册不存在" }, { status: 404 });
  }
  let removed = 0;
  const failures: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      await db.photo.update({
        where: { id },
        data: { albums: { disconnect: { id: album.id } } },
      });
      removed++;
    } catch (e) {
      failures.push({ id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ok: true, removed, failures });
}
