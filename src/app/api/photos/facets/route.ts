export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

/** GET /api/photos/facets — 筛选栏聚合数据（相机/镜头/标签，仅未删除照片） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const db = getDb();
  const where = { deletedAt: null };

  const [cameras, lenses, tags] = await Promise.all([
    db.photo.groupBy({
      by: ["cameraModel"],
      where: { ...where, cameraModel: { not: null } },
      _count: { cameraModel: true },
      orderBy: { _count: { cameraModel: "desc" } },
    }),
    db.photo.groupBy({
      by: ["lensModel"],
      where: { ...where, lensModel: { not: null } },
      _count: { lensModel: true },
      orderBy: { _count: { lensModel: "desc" } },
    }),
    db.tag.findMany({
      where: { photos: { some: where } },
      include: { _count: { select: { photos: { where } } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    cameras: cameras
      .filter((c) => c.cameraModel)
      .map((c) => ({ name: c.cameraModel as string, count: c._count.cameraModel })),
    lenses: lenses
      .filter((l) => l.lensModel)
      .map((l) => ({ name: l.lensModel as string, count: l._count.lensModel })),
    tags: tags.map((t) => ({ name: t.name, count: t._count.photos })),
  });
}
