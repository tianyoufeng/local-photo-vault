export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

type Params = { params: { id: string } };

/** POST /api/photos/[id]/restore — 从回收站恢复 */
export async function POST(_req: NextRequest, { params }: Params) {
  const denied = guardApi(_req);
  if (denied) return denied;
  const photo = await getDb().photo.update({
    where: { id: params.id },
    data: { deletedAt: null },
    select: { id: true, deletedAt: true },
  });
  return NextResponse.json({ ok: true, ...photo });
}
