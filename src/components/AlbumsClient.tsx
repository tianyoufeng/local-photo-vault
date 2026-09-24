"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface AlbumItem {
  id: string;
  name: string;
  count: number;
  coverThumbUrl: string | null;
}

export default function AlbumsClient() {
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/albums").then((r) => r.json());
      setAlbums(r.albums ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!newName.trim()) return;
    const r = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await r.json();
    if (!r.ok) {
      setMsg(data.error ?? "创建失败");
      return;
    }
    setNewName("");
    setMsg("");
    load();
  }

  async function rename(id: string, name: string) {
    const r = await fetch(`/api/albums/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    if (!r.ok) {
      setMsg(data.error ?? "重命名失败");
      return;
    }
    setEditing(null);
    load();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`删除相册「${name}」？照片本体不会被删除，仅解除关联。`)) return;
    await fetch(`/api/albums/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">← 返回图库</Link>
        <h1 className="text-2xl font-bold">相册</h1>
      </div>

      <div className="card mb-6 flex items-end gap-3">
        <div className="flex-1">
          <label className="label">新建相册</label>
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="相册名称，回车创建"
          />
        </div>
        <button className="btn" onClick={create}>创建</button>
      </div>
      {msg && <p className="mb-4 text-sm text-red-400">{msg}</p>}

      {loading ? (
        <p className="text-zinc-500">加载中…</p>
      ) : albums.length === 0 ? (
        <div className="card text-center text-zinc-400">
          还没有相册。创建后可在图库中多选照片批量加入。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {albums.map((a) => (
            <div key={a.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              <Link href={`/?album=${encodeURIComponent(a.name)}`}>
                {a.coverThumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.coverThumbUrl} alt={a.name} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-zinc-800 text-3xl text-zinc-600">🖼</div>
                )}
              </Link>
              <div className="space-y-1.5 p-3">
                {editing?.id === a.id ? (
                  <input
                    className="input"
                    value={editing.name}
                    autoFocus
                    onChange={(e) => setEditing({ id: a.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(a.id, editing.name);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <p className="truncate font-medium">{a.name}</p>
                )}
                <p className="text-xs text-zinc-500">{a.count} 张</p>
                <div className="flex gap-1.5">
                  <button
                    className="btn-secondary flex-1 !px-2 !py-1 !text-xs"
                    onClick={() => setEditing({ id: a.id, name: a.name })}
                  >
                    重命名
                  </button>
                  <button
                    className="btn-secondary flex-1 !border-red-900/60 !px-2 !py-1 !text-xs !text-red-300"
                    onClick={() => remove(a.id, a.name)}
                  >
                    删除
                  </button>
                </div>
                <Link href={`/?album=${encodeURIComponent(a.name)}`} className="block text-xs text-amber-400 hover:underline">
                  查看照片 →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
