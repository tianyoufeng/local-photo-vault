export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getUpload, writeChunkAt } from "@/lib/uploadSession";

/** PUT /api/photos/upload/chunk?uploadId=&index= （二进制 body，按偏移写入，支持并发乱序） */
export async function PUT(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const uploadId = req.nextUrl.searchParams.get("uploadId") ?? "";
  const index = Number(req.nextUrl.searchParams.get("index"));
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "index 无效" }, { status: 400 });
  }
  const session = getUpload(uploadId);
  if (!session) {
    return NextResponse.json({ error: "上传会话不存在或已过期" }, { status: 404 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  const received = writeChunkAt(uploadId, index, buf);
  if (received === null) {
    return NextResponse.json({ error: "分片写入失败" }, { status: 400 });
  }
  return NextResponse.json({ received });
}
