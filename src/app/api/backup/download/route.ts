export const dynamic = "force-dynamic";

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

/** GET /api/backup/download?recordId= — 下载备份归档（电脑/手机均可，仅登录） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const recordId = req.nextUrl.searchParams.get("recordId") ?? "";
  const rec = await getDb().backupRecord.findUnique({ where: { id: recordId } });
  if (!rec || rec.status !== "success") {
    return NextResponse.json({ error: "备份记录不存在" }, { status: 404 });
  }
  if (!fs.existsSync(rec.filePath)) {
    return NextResponse.json({ error: "归档文件已被移动或删除" }, { status: 410 });
  }
  const fileName = path.basename(rec.filePath);
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_");
  const stream = fs.createReadStream(rec.filePath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(fs.statSync(rec.filePath).size),
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
