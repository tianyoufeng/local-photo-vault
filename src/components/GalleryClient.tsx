"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isTauri, onFileDragDrop } from "./desktop";
import ImportDesktop from "./ImportDesktop";

interface PhotoItem {
  id: string;
  originalName: string;
  kind: string;
  rating: number;
  favorite: boolean;
  takenAt: string | null;
  createdAt: string;
  width: number | null;
  height: number | null;
  tags: string[];
  thumbUrl: string;
}
interface Facet {
  name: string;
  count: number;
}
interface Facets {
  cameras: Facet[];
  lenses: Facet[];
  tags: Facet[];
}
interface AlbumItem {
  id: string;
  name: string;
  count: number;
}

const CHUNK = 4 * 1024 * 1024;

/** 分片上传单个文件：init → 3 路并发 PUT 分片（服务端按偏移随机写，乱序到达）→ finalize */
const CHUNK_CONCURRENCY = 3;
async function uploadOne(
  file: File,
  onProgress: (done: number, total: number) => void,
  album?: { albumId?: string; albumName?: string }
): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {  try {
    const initRes = await fetch("/api/photos/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, size: file.size }),
    });
    if (!initRes.ok) return { ok: false, error: (await initRes.json()).error };
    const { uploadId } = await initRes.json();

    const total = Math.ceil(file.size / CHUNK);
    let next = 0;
    let done = 0;
    let failed: string | null = null;
    const workers = Array.from(
      { length: Math.min(CHUNK_CONCURRENCY, Math.max(1, total)) },
      async () => {
        while (next < total && !failed) {
          const i = next++;
          const start = i * CHUNK;
          const blob = file.slice(start, Math.min(start + CHUNK, file.size));
          let retry = 0;
          for (;;) {
            try {
              const res = await fetch(
                `/api/photos/upload/chunk?uploadId=${uploadId}&index=${i}`,
                { method: "PUT", body: await blob.arrayBuffer() }
              );
              if (res.ok) break;
              throw new Error(`chunk ${i}`);
            } catch {
              if (++retry >= 3) {
                failed = `分片上传失败(${i})`;
                return;
              }
              await new Promise((r) => setTimeout(r, 800 * retry));
            }
          }
          done++;
          onProgress(done, total);
        }
      }
    );
    await Promise.all(workers);
    if (failed) {
      await fetch(`/api/photos/upload/abort?uploadId=${uploadId}`, { method: "POST" }).catch(() => null);
      return { ok: false, error: failed };
    }

    const finRes = await fetch("/api/photos/upload/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, ...(album?.albumId ? { albumId: album.albumId } : {}), ...(album?.albumName ? { albumName: album.albumName } : {}) }),
    });
    const data = await finRes.json().catch(() => ({}));
    if (!finRes.ok) return { ok: false, error: data.error ?? "导入失败" };
    return { ok: true, duplicate: data.duplicate };
  } catch {
    return { ok: false, error: "网络错误" };
  }
}

export default function GalleryClient() {
  const router = useRouter();
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets>({ cameras: [], lenses: [], tags: [] });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ name: string; done: number; total: number } | null>(null);
  const [uploadAlbumId, setUploadAlbumId] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");

  // 筛选状态
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [camera, setCamera] = useState("");
  const [lens, setLens] = useState("");
  const [tag, setTag] = useState("");
  const [rating, setRating] = useState(0);
  const [fav, setFav] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // 相册筛选 + 多选批量
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [album, setAlbum] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchMsg, setBatchMsg] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  // ---- 桌面端拖拽导入（仅 Tauri WebView 内生效；手机/浏览器自动无此能力） ----
  const [dragOver, setDragOver] = useState(false);
  const [importPaths, setImportPaths] = useState<string[] | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [netinfo, setNetinfo] = useState<{ port: number; interfaces: { name: string; address: string }[]; urls: string[] } | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    onFileDragDrop((p) => {
      if (cancelled || importPaths) return;
      if (p.type === "enter" || p.type === "over") setDragOver(true);
      else if (p.type === "leave") setDragOver(false);
      else if (p.type === "drop" && p.paths.length > 0) {
        setDragOver(false);
        setImportPaths(p.paths);
      }
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importPaths]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (qDebounced) sp.set("q", qDebounced);
    if (camera) sp.set("camera", camera);
    if (lens) sp.set("lens", lens);
    if (tag) sp.set("tag", tag);
    if (album) sp.set("album", album);
    if (rating) sp.set("rating", String(rating));
    if (fav) sp.set("fav", "1");
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    sp.set("pageSize", "60");
    return sp.toString();
  }, [qDebounced, camera, lens, tag, album, rating, fav, from, to]);

  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, fac, alb] = await Promise.all([
        fetch(`/api/photos?${query}`).then((r) => r.json()),
        fetch("/api/photos/facets").then((r) => r.json()),
        fetch("/api/albums").then((r) => r.json()),
      ]);
      setItems(list.items ?? []);
      setTotal(list.total ?? 0);
      setNextCursor(list.nextCursor ?? null);
      setFacets(fac);
      setAlbums(alb.albums ?? []);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  // 无限滚动：游标分页追加（万级照片流畅浏览）
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await fetch(
        `/api/photos?${query}&cursor=${encodeURIComponent(nextCursor)}`
      ).then((r) => r.json());
      setItems((prev) => [...prev, ...(d.items ?? [])]);
      setNextCursor(d.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, query]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMore(),
      { rootMargin: "600px" }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [loadMore]);

  // 支持从相册管理页跳转过来：/?album=名称
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("album");
    if (a) setAlbum(a);
  }, []);

  // ---- 备份提醒横幅 + 系统通知（桌面端每日最多一次） ----
  const [remind, setRemind] = useState<{ due: boolean; daysSinceBackup: number | null; notifyToday: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/backup/remind")
      .then((r) => r.json())
      .then(async (d) => {
        setRemind(d);
        if (d.notifyToday && isTauri()) {
          try {
            const notif = await import("@tauri-apps/plugin-notification");
            let granted = await notif.isPermissionGranted();
            if (!granted) granted = (await notif.requestPermission()) === "granted";
            if (granted) {
              notif.sendNotification({
                title: "LocalPhotoVault 备份提醒",
                body: `已 ${d.daysSinceBackup ?? "?"} 天未备份，建议立即备份照片库`,
              });
            }
          } catch { /* 通知失败不影响横幅 */ }
          fetch("/api/backup/remind", { method: "POST" });
        }
      })
      .catch(() => null);
  }, []);

  // 注意：FileList 是活动对象，input.value="" 会把它清空，
  // 必须先快照成普通数组再进入异步上传循环
  const FILE_CONCURRENCY = 2;
  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setUploadMsg("");
    let okCount = 0;
    let dupCount = 0;
    const failed: string[] = [];
    // 2 路并发文件（每文件内部再 3 路并发分片）
    let next = 0;
    const workers = Array.from({ length: Math.min(FILE_CONCURRENCY, files.length) }, async () => {
      while (next < files.length) {
        const i = next++;
        const f = files[i];
        setUploading({ name: f.name, done: 0, total: Math.ceil(f.size / CHUNK) });
        const r = await uploadOne(f, (done, total) =>
          setUploading({ name: f.name, done, total })
        , uploadAlbumId ? { albumId: uploadAlbumId } : undefined);
        if (r.ok) {
          okCount++;
          if (r.duplicate) dupCount++;
        } else {
          failed.push(`${f.name}: ${r.error}`);
        }
      }
    });
    await Promise.all(workers);
    setUploading(null);
    setUploadMsg(
      `导入完成：成功 ${okCount}${dupCount ? `（其中 ${dupCount} 张与已有照片内容相同，已去重共用原图）` : ""}` +
        (failed.length ? `；失败 ${failed.length}：${failed.join("；")}` : "")
    );
    load();
  }

  // ---- 批量操作 ----
  async function batch(
    action: string,
    payload?: Record<string, unknown>,
    opts?: { exitAfter?: boolean; silent?: boolean }
  ) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const r = await fetch("/api/photos/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, photoIds: ids, payload }),
    });
    const data = await r.json();
    if (!r.ok) {
      setBatchMsg(data.error ?? "批量操作失败");
      return;
    }
    if (!opts?.silent) {
      setBatchMsg(
        `批量${action}: 成功 ${data.succeeded}/${data.total}` +
          (data.failures?.length ? `（失败 ${data.failures.length}）` : "")
      );
    }
    if (action === "delete" || opts?.exitAfter) {
      // 操作完成：结束多选（宪法任务要求：完成后退出多选）
      setSelected(new Set());
      setSelectMode(false);
    }
    load();
  }

  /** 复制到相册：加入目标相册，照片保留在原处 */
  async function copyToAlbum(targetAlbumId: string) {
    await batch("album-add", { albumId: targetAlbumId }, { exitAfter: true });
  }

  /** 移动到相册（剪切语义）：
   *  - 相册筛选视图下：从当前相册移除并加入目标相册
   *  - 全库视图下：照片的相册归属变为仅目标相册（从其他所有相册移除） */
  async function moveToAlbum(targetAlbumId: string) {
    const currentAlbumObj = albums.find((a) => a.name === album);
    // 先移除旧归属，再加入目标（顺序不能反，否则 remove-all 会清掉刚加的目标）
    if (currentAlbumObj && currentAlbumObj.id !== targetAlbumId) {
      await batch("album-remove", { albumId: currentAlbumObj.id }, { silent: true });
    } else if (!album) {
      await batch("album-remove-all", {}, { silent: true });
    }
    await batch("album-add", { albumId: targetAlbumId }, { silent: true });
    setSelected(new Set());
    setSelectMode(false);
    load();
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectCls =
    "rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-500";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* 顶栏 */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">图库</h1>
        <span className="text-sm text-zinc-500">{total} 张</span>
        {remind && (
          <Link
            href="/settings"
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              remind.due
                ? "border-amber-600/60 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
            }`}
            title="前往设置查看备份与恢复"
          >
            备份：{remind.daysSinceBackup !== null ? `${remind.daysSinceBackup} 天前` : "从未备份"}
          </Link>
        )}
        <div className="flex-1" />
        <select
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200"
          value={uploadAlbumId}
          onChange={(e) => setUploadAlbumId(e.target.value)}
          title="上传时归入指定相册（可选）"
        >
          <option value="">上传到：图库</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>上传到：{a.name}</option>
          ))}
        </select>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!uploading}>
          上传照片
        </button>
        <button className="btn-secondary" onClick={() => dirRef.current?.click()} disabled={!!uploading}>
          上传文件夹
        </button>
        <Link href="/albums" className="btn-secondary">
          相册
        </Link>
        <button
          className={selectMode ? "btn" : "btn-secondary"}
          onClick={() => {
            setSelectMode(!selectMode);
            setSelected(new Set());
            setBatchMsg("");
          }}
        >
          {selectMode ? "退出多选" : "多选"}
        </button>
        <Link href="/trash" className="btn-secondary">
          回收站
        </Link>
        <Link href="/settings" className="btn-secondary">
          设置
        </Link>
        <button
          className="btn-secondary"
          onClick={() => {
            if (!netinfo) {
              fetch("/api/netinfo").then((r) => r.json()).then(setNetinfo);
            }
            setShowQr(true);
          }}
        >
          扫码访问
        </button>
      </div>

      <input
        ref={fileRef} type="file" multiple accept="image/*,.heic,.heif,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2"
        className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />      <input
        ref={dirRef} type="file" multiple /* @ts-expect-error 非标准目录上传属性 */
        webkitdirectory="" className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />

      {/* 备份提醒横幅 */}
      {remind?.due && (
        <Link
          href="/settings"
          className="mb-4 block rounded-lg border border-amber-600/60 bg-amber-500/10 px-4 py-3 text-sm text-amber-300 hover:bg-amber-500/20"
        >
          ⚠ 已 {remind.daysSinceBackup ?? 0} 天未备份照片库，建议立即备份 → 前往设置
        </Link>
      )}

      {/* 上传进度 */}
      {uploading && (
        <div className="card mb-4">
          <p className="mb-2 text-sm">
            正在导入：<span className="text-amber-400">{uploading.name}</span>
          </p>
          <div className="h-2 rounded bg-zinc-800">
            <div
              className="h-2 rounded bg-amber-500 transition-all"
              style={{ width: `${Math.round((uploading.done / Math.max(1, uploading.total)) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {uploadMsg && <p className="mb-4 text-sm text-emerald-400">{uploadMsg}</p>}

      {/* 筛选栏 */}
      <div className="card mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <label className="label">关键词（文件名 / 标签）</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索…" />
        </div>
        <div>
          <label className="label">拍摄日期从</label>
          <input type="date" className={selectCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">到</label>
          <input type="date" className={selectCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label">相机</label>
          <select className={selectCls} value={camera} onChange={(e) => setCamera(e.target.value)}>
            <option value="">全部</option>
            {facets.cameras.map((c) => (
              <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">镜头</label>
          <select className={selectCls} value={lens} onChange={(e) => setLens(e.target.value)}>
            <option value="">全部</option>
            {facets.lenses.map((l) => (
              <option key={l.name} value={l.name}>{l.name} ({l.count})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">标签</label>
          <select className={selectCls} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部</option>
            {facets.tags.map((t) => (
              <option key={t.name} value={t.name}>{t.name} ({t.count})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">相册</label>
          <select className={selectCls} value={album} onChange={(e) => setAlbum(e.target.value)}>
            <option value="">全部</option>
            {albums.map((a) => (
              <option key={a.id} value={a.name}>{a.name} ({a.count})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">评分≥</label>
          <select className={selectCls} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n === 0 ? "不限" : `${n} 星`}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 pb-1.5 text-sm text-zinc-300">
          <input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} className="accent-amber-500" />
          仅收藏
        </label>
        <button
          className="btn-secondary"
          onClick={() => { setQ(""); setCamera(""); setLens(""); setTag(""); setAlbum(""); setRating(0); setFav(false); setFrom(""); setTo(""); }}
        >
          重置
        </button>
      </div>

      {/* 扫码访问弹层 */}
      {showQr && netinfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setShowQr(false)}
        >
          <div className="card w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-semibold">手机扫码访问</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/qr.svg?text=${encodeURIComponent(netinfo.urls[0] + "/upload")}`}
              alt="二维码"
              className="mx-auto mb-3 rounded-lg"
            />
            <p className="mb-1 break-all text-sm text-amber-400">
              {netinfo.urls[0]}/upload
            </p>
            <p className="mb-3 text-xs text-zinc-500">
              同一 WiFi 下扫码或手动输入地址即可上传照片。二维码不含任何令牌。
            </p>
            <div className="mb-3 rounded-lg bg-zinc-950 p-2 text-left text-xs text-zinc-400">
              <p className="mb-1 text-zinc-500">本机局域网地址：</p>
              {netinfo.interfaces.map((i) => (
                <p key={i.address} className="truncate">
                  {i.name}：{i.address}
                </p>
              ))}
            </div>
            <button className="btn-secondary" onClick={() => setShowQr(false)}>关闭</button>
          </div>
        </div>
      )}

      {/* 桌面端拖拽覆盖层 */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-dashed border-amber-500/80 bg-zinc-950/70">
          <p className="rounded-xl bg-zinc-900 px-6 py-4 text-xl font-semibold text-amber-400">
            松手导入照片（可选择复制或移动）
          </p>
        </div>
      )}
      {importPaths && (
        <ImportDesktop
          paths={importPaths}
          onClose={() => setImportPaths(null)}
          onDone={load}
        />
      )}

      {/* 照片网格 */}
      {loading ? (
        <p className="text-zinc-500">加载中…</p>
      ) : items.length === 0 ? (
        <div className="card text-center text-zinc-400">
          还没有照片。点击「上传照片」或「上传文件夹」开始导入（支持 JPEG/PNG/WebP/HEIC/常见 RAW）。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((p) => {
            const isSel = selected.has(p.id);
            const inner = (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.thumbUrl}
                  alt={p.originalName}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                {selectMode && (
                  <span
                    className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${
                      isSel ? "border-amber-500 bg-amber-500 text-zinc-950" : "border-zinc-400 bg-zinc-950/60 text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                )}
                {!selectMode && p.favorite && <span className="absolute right-2 top-2 text-amber-400">★</span>}
                {p.kind !== "image" && (
                  <span className="absolute left-2 top-2 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                    {p.kind}
                  </span>
                )}
                <div className="p-2">
                  <p className="truncate text-xs text-zinc-300">{p.originalName}</p>
                  <p className="text-[11px] text-zinc-500">
                    {p.takenAt
                      ? `拍摄 ${new Date(p.takenAt).toLocaleDateString("zh-CN")}`
                      : `上传 ${new Date(p.createdAt).toLocaleDateString("zh-CN")}`}
                    {p.rating > 0 && <span className="ml-1 text-amber-400">{"★".repeat(p.rating)}</span>}
                  </p>
                </div>
              </>
            );
            const cls = `relative block overflow-hidden rounded-xl border bg-zinc-900 transition ${
              isSel ? "border-amber-500" : "border-zinc-800 hover:border-amber-500/60"
            }`;
            return selectMode ? (
              <button key={p.id} className={cls + " text-left"} onClick={() => toggleSelect(p.id)}>
                {inner}
              </button>
            ) : (
              <Link key={p.id} href={`/photo/${p.id}`} className={cls}>
                {inner}
              </Link>
            );
          })}
        </div>
      )}

      {/* 无限滚动哨兵：进入视口自动加载下一页（游标分页） */}
      {items.length > 0 && (
        <div ref={sentinelRef} className="py-6 text-center text-xs text-zinc-500">
          {loadingMore ? "加载更多…" : nextCursor ? `已加载 ${items.length}/${total} 张` : `共 ${total} 张，已全部加载`}
        </div>
      )}

      {/* 批量工具条 */}
      {selectMode && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-900/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
            <span className="text-sm text-amber-400">已选 {selected.size} 张</span>
            <button
              className="btn-secondary !py-1.5 !text-xs"
              onClick={() => setSelected(new Set(items.map((p) => p.id)))}
            >
              全选本页
            </button>
            <button
              className="btn-secondary !py-1.5 !text-xs"
              disabled={selected.size === 0}
              onClick={() => {
                const t = prompt("输入要添加的标签（多个用逗号分隔）：");
                if (t && t.trim())
                  batch("tag-add", { tags: t.split(/[,，]/).map((s) => s.trim()).filter(Boolean) });
              }}
            >
              加标签
            </button>
            <button
              className="btn-secondary !py-1.5 !text-xs"
              disabled={selected.size === 0}
              onClick={() => {
                const r = prompt("设置评分（0-5，0 为清除）：");
                if (r !== null && r.trim() !== "") batch("rating", { rating: Number(r) });
              }}
            >
              评分
            </button>
            <button
              className="btn-secondary !py-1.5 !text-xs"
              disabled={selected.size === 0}
              onClick={() => batch("favorite", { favorite: true })}
            >
              收藏
            </button>
            <button
              className="btn-secondary !py-1.5 !text-xs"
              disabled={selected.size === 0}
              onClick={() => batch("favorite", { favorite: false })}
            >
              取消收藏
            </button>
            <select
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
              disabled={selected.size === 0 || albums.length === 0}
              value=""
              onChange={(e) => e.target.value && copyToAlbum(e.target.value)}
              title="复制到相册：照片同时属于原位置和目标相册"
            >
              <option value="">复制到相册…</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
              disabled={selected.size === 0 || albums.length === 0}
              value=""
              onChange={(e) => e.target.value && moveToAlbum(e.target.value)}
              title={album ? `移动到相册：从「${album}」移除并加入目标相册` : "移动到相册：照片的相册归属将变为仅目标相册"}
            >
              <option value="">移动到相册…</option>
              {albums.filter((a) => a.name !== album).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              className="btn-secondary !border-red-900/60 !py-1.5 !text-xs !text-red-300"
              disabled={selected.size === 0}
              onClick={() => {
                if (confirm(`确定把选中的 ${selected.size} 张移入回收站？（保留 30 天）`))
                  batch("delete");
              }}
            >
              删除
            </button>
            {batchMsg && <span className="text-xs text-emerald-400">{batchMsg}</span>}
          </div>
        </div>
      )}
    </main>
  );
}
