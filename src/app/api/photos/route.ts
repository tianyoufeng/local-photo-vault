export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { lazyPurge } from "@/lib/trash";

/**
 * GET /api/photos — 图库列表（分页 + 筛选）
 * 参数：q 关键词 / from,to 拍摄日期 / camera / lens / tag / rating(≥) / fav / trash / page / pageSize
 */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const trash = sp.get("trash") === "1";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 50));
  void lazyPurge().catch(() => null); // 惰性清理过期回收站

  const where: Record<string, unknown> = {
    deletedAt: trash ? { not: null } : null,
  };
  const q = sp.get("q")?.trim();
  if (q) {
    where.OR = [
      { originalName: { contains: q } },
      { tags: { some: { name: { contains: q } } } },
    ];
  }
  const from = sp.get("from");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.takenAt = { ...(where.takenAt as object), gte: new Date(from) };
  }
  const to = sp.get("to");
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1); // 含当天
    where.takenAt = { ...(where.takenAt as object), lt: end };
  }
  const camera = sp.get("camera");
  if (camera) where.cameraModel = camera;
  const lens = sp.get("lens");
  if (lens) where.lensModel = lens;
  const tag = sp.get("tag");
  if (tag) where.tags = { some: { name: tag } };
  const album = sp.get("album");
  if (album) where.albums = { some: { name: album } };
  const rating = Number(sp.get("rating"));
  if (rating >= 1 && rating <= 5) where.rating = { gte: rating };
  if (sp.get("fav") === "1") where.favorite = true;

  const db = getDb();
  // 游标分页（万级数据流畅翻页）：cursor=base64url({takenAt, id})；
  // 未传 page 时即使无 cursor 也走游标式取数（首页），始终返回 nextCursor
  const cursorRaw = sp.get("cursor");
  const useCursor = cursorRaw !== null || !sp.get("page");
  let items;
  let nextCursor: string | null = null;
  if (useCursor) {
    let cur: { takenAt: string | null; id: string } | null = null;
    if (cursorRaw) {
      try {
        cur = JSON.parse(Buffer.from(cursorRaw, "base64url").toString("utf-8"));
      } catch {
        cur = null;
      }
    }
    const cursorWhere =
      cur && (typeof cur.id === "string" || typeof cur.id === "number")
        ? {
            AND: [
              where,
              cur.takenAt === null
                ? { takenAt: null, id: { lt: cur.id } }
                : {
                    OR: [
                      { takenAt: { lt: new Date(cur.takenAt) } },
                      {
                        AND: [
                          { takenAt: { equals: new Date(cur.takenAt) } },
                          { id: { lt: cur.id } },
                        ],
                      },
                      { takenAt: null },
                    ],
                  },
            ],
          }
        : where;
    const fetched = await db.photo.findMany({
      where: cursorWhere,
      orderBy: [{ takenAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: pageSize + 1,
      include: { tags: { select: { name: true } } },
    });
    items = fetched.slice(0, pageSize);
    if (fetched.length > pageSize && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ takenAt: last.takenAt, id: last.id }),
        "utf-8"
      ).toString("base64url");
    }
  } else {
    items = await db.photo.findMany({
      where,
      orderBy: [{ takenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { tags: { select: { name: true } } },
    });
  }
  const total = await db.photo.count({ where });

  return NextResponse.json({
    total,
    page,
    pageSize,
    nextCursor,
    items: items.map((p) => ({
      id: p.id,
      originalName: p.originalName,
      kind: p.kind,
      rating: p.rating,
      favorite: p.favorite,
      takenAt: p.takenAt,
      createdAt: p.createdAt,
      sizeBytes: p.sizeBytes.toString(),
      width: p.width,
      height: p.height,
      deletedAt: p.deletedAt,
      tags: p.tags.map((t) => t.name),
      thumbUrl: `/api/photos/${p.id}/thumbnail`,
      detailUrl: `/photo/${p.id}`,
    })),
  });
}
