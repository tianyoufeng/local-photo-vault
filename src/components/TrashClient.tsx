"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface TrashItem {
  id: string;
  originalName: string;
  kind: string;
  rating: number;
  favorite: boolean;
  sizeBytes: string;
  deletedAt: string;
  expiresAt: string;
  thumbUrl: string;
}

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
}

export default function TrashClient() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trash");
      const data = await res.json();
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function restore(id: string) {
    const res = await fetch(`/api/photos/${id}/restore`, { method: "POST" });
    if (res.ok) {
      setMsg("已恢复");
      load();
    }
  }

  async function purge(id: string) {
    if (!confirm("彻底删除后原文件将从磁盘移除，不可恢复。确定？")) return;
    const res = await fetch(`/api/trash?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setMsg("已彻底删除");
      load();
    }
  }

  async function purgeAll() {
    if (!confirm(`清空回收站将彻底删除 ${items.length} 张照片的原文件，不可恢复。确定？`)) return;
    const res = await fetch("/api/trash?all=1", { method: "DELETE" });
    if (res.ok) {
      setMsg("回收站已清空");
      load();
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">← 返回图库</Link>
        <h1 className="text-2xl font-bold">回收站</h1>
        <span className="text-sm text-zinc-500">{items.length} 项 · 保留 30 天</span>
        <div className="flex-1" />
        {items.length > 0 && (
          <button className="btn-secondary !border-red-900/60 !text-red-300" onClick={purgeAll}>
            清空回收站
          </button>
        )}
      </div>
      {msg && <p className="mb-4 text-sm text-emerald-400">{msg}</p>}

      {loading ? (
        <p className="text-zinc-500">加载中…</p>
      ) : items.length === 0 ? (
        <div className="card text-center text-zinc-400">回收站是空的</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((p) => (
            <div
              key={p.id}
              className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl} alt={p.originalName} loading="lazy" className="aspect-square w-full object-cover opacity-70" />
              <div className="space-y-1.5 p-2">
                <p className="truncate text-xs text-zinc-300">{p.originalName}</p>
                <p className="text-[11px] text-red-400/80">{daysLeft(p.expiresAt)} 天后自动清除</p>
                <div className="flex gap-1.5">
                  <button className="btn-secondary flex-1 !px-2 !py-1 !text-xs" onClick={() => restore(p.id)}>
                    恢复
                  </button>
                  <button
                    className="btn-secondary flex-1 !border-red-900/60 !px-2 !py-1 !text-xs !text-red-300"
                    onClick={() => purge(p.id)}
                  >
                    彻底删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
