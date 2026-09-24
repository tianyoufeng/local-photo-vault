export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { verifyDesktopToken, DESKTOP_TOKEN_HEADER } from "@/lib/desktopToken";
import { deleteImportedSources } from "@/lib/importer";

/** POST /api/photos/import/deletesources {importId} — 复制模式下确认删除已导入的源文件 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  if (!verifyDesktopToken(req.headers.get(DESKTOP_TOKEN_HEADER))) {
    return NextResponse.json({ error: "仅桌面端可使用本地导入" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const importId = typeof body?.importId === "string" ? body.importId : "";
  const r = await deleteImportedSources(importId);
  return NextResponse.json({ ok: true, ...r });
}
