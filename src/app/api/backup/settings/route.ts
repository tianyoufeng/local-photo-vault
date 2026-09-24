export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { getBackupReminder } from "@/lib/backup";

/** GET /api/backup/settings — 提醒配置 + 上次备份 + 历史记录 */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const reminder = await getBackupReminder();
  const records = await getDb().backupRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({
    ...reminder,
    records: records.map((r) => ({
      id: r.id,
      filePath: r.filePath,
      archiveSha256: r.archiveSha256,
      fileCount: r.fileCount,
      totalSize: r.totalSize.toString(),
      photoCount: r.photoCount,
      status: r.status,
      createdAt: r.createdAt,
    })),
  });
}

/** PUT /api/backup/settings {intervalDays?, disabled?} — 提醒配置 */
export async function PUT(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const db = getDb();
  const upsert = async (key: string, value: string) =>
    db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  if (body?.intervalDays !== undefined) {
    const n = Number(body.intervalDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return NextResponse.json({ error: "intervalDays 需为 1-365" }, { status: 400 });
    }
    await upsert("backupIntervalDays", String(n));
  }
  if (body?.disabled !== undefined) {
    await upsert("backupRemindDisabled", body.disabled ? "1" : "0");
  }
  return NextResponse.json({ ok: true, ...(await getBackupReminder()) });
}
