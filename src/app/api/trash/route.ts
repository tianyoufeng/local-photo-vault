export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { lazyPurge, purgeExpired, purgePhotoRecord, RETENTION_DAYS } from "@/lib/trash";

/** GET /api/trash — 回收站列表（顺带惰性清理过期项） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  await lazyPurge();
  const items = await getDb().photo.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true, originalName: true, kind: true, rating: true,
      favorite: true, sizeBytes: true, deletedAt: true,
    },
  });
  return NextResponse.json({
    retentionDays: RETENTION_DAYS,
    items: items.map((p) => ({
      ...p,
      sizeBytes: p.sizeBytes.toString(),
      expiresAt: new Date(
        (p.deletedAt?.getTime() ?? 0) + RETENTION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      thumbUrl: `/api/photos/${p.id}/thumbnail`,
    })),
  });
}

/**
 * DELETE /api/trash — 彻底删除（物理删除，引用计数归零才删盘上文件）
 * ?id=xxx 删除单条；?all=1 清空回收站；?expired=1 只清过期项
 */
export async function DELETE(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const db = getDb();

  if (sp.get("all") === "1") {
    const rows = await db.photo.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true },
    });
    let filesDeleted = 0;
    for (const { id } of rows) {
      const r = await purgePhotoRecord(id);
      if (r.fileDeleted) filesDeleted++;
    }
    return NextResponse.json({ ok: true, purged: rows.length, filesDeleted });
  }

  if (sp.get("expired") === "1") {
    const n = await purgeExpired();
    return NextResponse.json({ ok: true, purged: n });
  }

  const id = sp.get("id");
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }
  const row = await db.photo.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!row || !row.deletedAt) {
    return NextResponse.json({ error: "记录不在回收站中" }, { status: 400 });
  }
  const r = await purgePhotoRecord(id);
  return NextResponse.json({ ok: true, purged: 1, filesDeleted: r.fileDeleted ? 1 : 0 });
}
