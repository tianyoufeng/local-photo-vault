"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

const CHUNK = 4 * 1024 * 1024;
const TOKEN_KEY = "lpv_upload_token";

interface UploadItem {
  name: string;
  done: number;
  total: number;
  status: "running" | "ok" | "failed";
  error?: string;
  duplicate?: boolean;
}

export default function UploadMobile() {
  const [tokenRequired, setTokenRequired] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [recent, setRecent] = useState<{ id: string; originalName: string; thumbUrl: string }[]>([]);
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([]);
  const [albumId, setAlbumId] = useState("");
  const [newAlbum, setNewAlbum] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAlbums = useCallback(async () => {
    const d = await fetch("/api/albums").then((r) => r.json()).catch(() => ({ albums: [] }));
    setAlbums(d.albums ?? []);
  }, []);

  const loadRecent = useCallback(async () => {
    const d = await fetch("/api/photos?pageSize=8").then((r) => r.json()).catch(() => ({ items: [] }));
    setRecent(
      (d.items ?? []).map((p: { id: string; originalName: string; thumbUrl: string }) => ({
        id: p.id,
        originalName: p.originalName,
        thumbUrl: p.thumbUrl,
      }))
    );
  }, []);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY) ?? "");
    fetch("/api/upload-token/required")
      .then((r) => r.json())
      .then((d) => setTokenRequired(d.required))
      .catch(() => setTokenRequired(false));
    loadRecent();
    loadAlbums();
  }, [loadAlbums, loadRecent]);

  function saveToken(v: string) {
    setToken(v);
    localStorage.setItem(TOKEN_KEY, v);
  }

  async function uploadOne(file: File, idx: number): Promise<void> {
    const mark = (patch: Partial<UploadItem>) =>
      setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    try {
      const init = await fetch("/api/photos/upload/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Upload-Token": token } : {}),
        },
        body: JSON.stringify({ fileName: file.name, size: file.size }),
      });
      const initData = await init.json().catch(() => ({}));
      if (!init.ok) {
        mark({ status: "failed", error: initData.error ?? "初始化失败" });
        if (initData.needToken) setTokenRequired(true);
        return;
      }
      const total = Math.ceil(file.size / CHUNK);
      for (let i = 0; i < total; i++) {
        const blob = file.slice(i * CHUNK, Math.min(i * CHUNK + CHUNK, file.size));
        const r = await fetch(
          `/api/photos/upload/chunk?uploadId=${initData.uploadId}&index=${i}`,
          { method: "PUT", body: await blob.arrayBuffer() }
        );
        if (!r.ok) {
          mark({ status: "failed", error: `分片 ${i} 失败` });
          return;
        }
        mark({ done: i + 1 });
      }
      const fin = await fetch("/api/photos/upload/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: initData.uploadId,
          // 上传时归入指定相册（下拉选择）；相册不存在时由服务端按名称自动创建
          ...(albumId ? { albumId } : newAlbum.trim() ? { albumName: newAlbum.trim() } : {}),
        }),
      });
      const finData = await fin.json().catch(() => ({}));
      if (!fin.ok) {
        mark({ status: "failed", error: finData.error ?? "导入失败" });
        return;
      }
      mark({ status: "ok", duplicate: finData.duplicate });
      if (newAlbum.trim()) {
        setNewAlbum("");
        loadAlbums(); // 刷新相册下拉
      }
    } catch {
      mark({ status: "failed", error: "网络错误" });
    }
  }

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    const base = items.length;
    setItems((prev) => [
      ...prev,
      ...list.map((f) => ({
        name: f.name,
        done: 0,
        total: Math.ceil(f.size / CHUNK),
        status: "running" as const,
      })),
    ]);
    for (let i = 0; i < list.length; i++) {
      await uploadOne(list[i], base + i);
    }
    loadRecent();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-4 py-6">
      <h1 className="mb-1 text-2xl font-bold">上传照片</h1>
      <p className="mb-4 text-sm text-zinc-400">LocalPhotoVault · 手机端</p>

      {tokenRequired === true && (
        <div className="card mb-4">
          <p className="mb-2 text-sm font-medium text-amber-300">需要上传令牌</p>
          <p className="mb-2 text-xs text-zinc-500">在电脑设置页「上传令牌」中查看，输入一次后本机会记住。</p>
          <input
            className="input"
            type="password"
            value={token}
            onChange={(e) => saveToken(e.target.value)}
            placeholder="输入上传令牌"
            autoComplete="off"
          />
        </div>
      )}

      {/* 目标相册选择 */}
      <div className="card mb-4">
        <p className="label">上传到相册（可选）</p>
        <select
          className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-sm text-zinc-200"
          value={albumId}
          onChange={(e) => {
            setAlbumId(e.target.value);
            if (e.target.value) setNewAlbum("");
          }}
        >
          <option value="">不指定（仅进图库）</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input
          className="input"
          value={newAlbum}
          onChange={(e) => {
            setNewAlbum(e.target.value);
            if (e.target.value) setAlbumId("");
          }}
          placeholder="或输入新相册名（上传时自动创建）"
          disabled={Boolean(albumId)}
          spellCheck={false}
        />
      </div>

      {/* iOS / 能力差异提示 */}
      <div className="card mb-4 space-y-1.5 text-xs text-zinc-400">
        <p>📱 手机端不支持文件夹拖拽，请从相册或「文件」App 选择。</p>
        <p>
          🍎 iPhone 提示：从系统相册选择的照片可能被转码压缩，
          建议选择「原图/实际大小」，或从「文件」App 里选择实际文件。
        </p>
      </div>

      <button
        className="btn mb-4 w-full !py-4 !text-lg"
        onClick={() => fileRef.current?.click()}
        disabled={tokenRequired === null}
      >
        选择照片上传
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* 上传列表 */}
      {items.length > 0 && (
        <div className="card mb-4 space-y-2">
          {items.map((it, i) => (
            <div key={i}>
              <div className="flex items-center justify-between text-xs">
                <span className="truncate">{it.name}</span>
                <span className={it.status === "failed" ? "text-red-400" : it.status === "ok" ? "text-emerald-400" : "text-zinc-400"}>
                  {it.status === "running" && `${it.done}/${it.total}`}
                  {it.status === "ok" && (it.duplicate ? "✔（内容相同，已去重）" : "✔")}
                  {it.status === "failed" && `失败`}
                </span>
              </div>
              {it.status === "running" && (
                <div className="mt-1 h-1.5 rounded bg-zinc-800">
                  <div
                    className="h-1.5 rounded bg-amber-500 transition-all"
                    style={{ width: `${Math.round((it.done / Math.max(1, it.total)) * 100)}%` }}
                  />
                </div>
              )}
              {it.error && <p className="mt-0.5 text-xs text-red-400">{it.error}</p>}
            </div>
          ))}
        </div>
      )}

      {/* 最近上传 */}
      {recent.length > 0 && (
        <div className="mb-4">
          <p className="label">最近照片</p>
          <div className="grid grid-cols-4 gap-2">
            {recent.map((p) => (
              <Link key={p.id} href={`/photo/${p.id}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumbUrl} alt={p.originalName} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link href="/" className="mb-6 text-sm text-amber-400 hover:underline">
        打开完整图库 →
      </Link>

      {/* 手机端限制说明 */}
      <div className="mt-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
        <p>· 局域网 HTTP 下 PWA/Service Worker 不可用（需 HTTPS），请直接收藏本页地址</p>
        <p>· 手机浏览器无法删除系统相册里的照片，只能在系统相册 App 中操作</p>
      </div>
    </main>
  );
}
