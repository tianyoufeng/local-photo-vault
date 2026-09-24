export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getNetInfo } from "@/lib/netinfo";

/** GET /api/netinfo — 本机局域网 IPv4 列表与访问 URL（设置页/扫码弹层用） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  return NextResponse.json(getNetInfo());
}
