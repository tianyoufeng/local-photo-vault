export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/guard";
import { getDb } from "@/lib/db";

/**
 * POST /api/photos/batch — 批量操作（上限 1000 张，逐项容错）
 * {action, photoIds[], payload?}
 *   tag-add / tag-remove   payload.tags: string[]
 *   rating                 payload.rating: 0-5（0=清除评分）
 *   favorite               payload.favorite: boolean
 *   delete                 软删除进回收站
 *   restore                从回收站恢复
 *   album-add / album-remove  payload.albumId
 *   album-remove-all          移除照片的全部相册归属（用于"移动"语义）
 */
export async function POST(req: NextRequest) {
  const denied = guardApi(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  const ids: string[] = Array.isArray(body?.photoIds)
    ? body.photoIds.filter((x: unknown) => typeof x === "string").slice(0, 1000)
    : [];
  const payload = body?.payload ?? {};
  const VALID = new Set([
    "tag-add", "tag-remove", "rating", "favorite",
    "delete", "restore", "album-add", "album-remove", "album-remove-all",
  ]);
  if (!VALID.has(action) || ids.length === 0) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  const db = getDb();
  let ok = 0;
  const failures: { id: string; error: string }[] = [];

  // 预处理：标签与相册按名字/ID 做 connectOrCreate
  if (action === "tag-add" || action === "tag-remove") {
    const names: string[] = Array.isArray(payload.tags)
      ? payload.tags.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim())
      : [];
    if (names.length === 0) {
      return NextResponse.json({ error: "缺少 tags" }, { status: 400 });
    }
    if (action === "tag-add") {
      await Promise.all(
        names.map((name) => db.tag.upsert({ where: { name }, update: {}, create: { name } }))
      );
    }
    for (const id of ids) {
      try {
        await db.photo.update({
          where: { id },
          data: {
            tags: action === "tag-add"
              ? { connect: names.map((name) => ({ name })) }
              : { disconnect: names.map((name) => ({ name })) },
          },
        });
        ok++;
      } catch (e) {
        failures.push({ id, error: (e as Error).message });
      }
    }
  } else if (action === "album-add" || action === "album-remove") {
    const albumId = typeof payload.albumId === "string" ? payload.albumId : "";
    const album = await db.album.findUnique({ where: { id: albumId } });
    if (!album) {
      return NextResponse.json({ error: "相册不存在" }, { status: 404 });
    }
    for (const id of ids) {
      try {
        await db.photo.update({
          where: { id },
          data: {
            albums: action === "album-add"
              ? { connect: { id: album.id } }
              : { disconnect: { id: album.id } },
          },
        });
        ok++;
      } catch (e) {
        failures.push({ id, error: (e as Error).message });
      }
    }
  } else if (action === "album-remove-all") {
    for (const id of ids) {
      try {
        await db.photo.update({
          where: { id },
          data: { albums: { set: [] } },
        });
        ok++;
      } catch (e) {
        failures.push({ id, error: (e as Error).message });
      }
    }
  } else {
    // 逐项简单字段操作
    if (action === "rating") {
      const r = Number(payload.rating);
      if (!(Number.isInteger(r) && r >= 0 && r <= 5)) {
        return NextResponse.json({ error: "rating 需为 0-5 整数" }, { status: 400 });
      }
    }
    const data =
      action === "rating"
        ? { rating: Number(payload.rating) }
        : action === "favorite"
          ? { favorite: Boolean(payload.favorite) }
          : action === "delete"
            ? { deletedAt: new Date() }
            : { deletedAt: null };
    for (const id of ids) {
      try {
        await db.photo.update({ where: { id }, data });
        ok++;
      } catch (e) {
        failures.push({ id, error: (e as Error).message });
      }
    }
  }

  return NextResponse.json({ ok: true, total: ids.length, succeeded: ok, failures });
}
