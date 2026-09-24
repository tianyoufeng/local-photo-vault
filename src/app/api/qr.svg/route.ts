export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import QRCode from "qrcode";

/** GET /api/qr.svg?text=... — 生成 SVG 二维码（内容为纯 URL，不含 token） */
export async function GET(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const text = req.nextUrl.searchParams.get("text") ?? "";
  if (!text || text.length > 200 || !/^https?:\/\//.test(text)) {
    return NextResponse.json({ error: "text 参数无效" }, { status: 400 });
  }
  const svg = await QRCode.toString(text, {
    type: "svg",
    margin: 2,
    width: 280,
    color: { dark: "#18181b", light: "#f4f4f5" },
  });
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
