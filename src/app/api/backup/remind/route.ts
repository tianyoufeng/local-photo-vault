export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getBackupReminder } from "@/lib/backup";
import { getDb } from "@/lib/db";

/** GET /api/backup/remind — 图库横幅用：是否应提醒备份 */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const r = await getBackupReminder();
  // 当天已展示过系统通知则不再重复计数提醒
  const lastShown = (await getDb().setting.findUnique({ where: { key: "lastRemindShownAt" } }))?.value;
  const shownToday =
    lastShown && new Date(lastShown).toDateString() === new Date().toDateString();
  return NextResponse.json({
    ...r,
    daysSinceBackup: r.daysSinceBackup ?? null,
    notifyToday: r.due && !shownToday,
  });
}

/** POST /api/backup/remind — 记录"今日已提醒"（系统通知弹出后调用，每天最多一次） */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  await getDb().setting.upsert({
    where: { key: "lastRemindShownAt" },
    update: { value: new Date().toISOString() },
    create: { key: "lastRemindShownAt", value: new Date().toISOString() },
  });
  return NextResponse.json({ ok: true });
}
