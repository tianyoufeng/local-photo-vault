"use client";

import { useEffect, useState } from "react";
import BackupPanel from "@/components/BackupPanel";
import NetworkPanel from "@/components/NetworkPanel";

interface SettingsInfo {
  photoRoot: string;
  dbPath: string | null;
}

export default function SettingsPage() {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [photoRoot, setPhotoRoot] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "加载失败");
        return r.json();
      })
      .then((data: SettingsInfo) => {
        setInfo(data);
        setPhotoRoot(data.photoRoot);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoRoot }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "保存失败");
        return;
      }
      setInfo((i) => (i ? { ...i, photoRoot: data.photoRoot } : i));
      setMessage("已保存。新目录及 .lpvault 已创建；数据库位置不变（迁移属后续阶段）。");
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-bold">设置</h1>

      <BackupPanel />

      <NetworkPanel />

      <div className="card mb-6">
        <h2 className="mb-4 text-lg font-semibold">照片存储</h2>
        {!info ? (
          <p className="text-zinc-500">{error || "加载中…"}</p>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="label" htmlFor="root">
                照片根目录（原图无损存放位置）
              </label>
              <input
                id="root"
                className="input"
                value={photoRoot}
                onChange={(e) => setPhotoRoot(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="rounded-lg bg-zinc-950 p-3 text-xs text-zinc-500">
              <p>
                数据库位置：<code className="text-zinc-300">{info.dbPath}</code>
              </p>
              <p className="mt-1">
                修改根目录后，新目录与 <code>.lpvault</code> 会自动创建；
                已有照片与数据库不会自动搬运（数据迁移属后续阶段）。
              </p>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {message && <p className="text-sm text-emerald-400">{message}</p>}
            <button className="btn" disabled={loading}>
              {loading ? "保存中…" : "保存"}
            </button>
          </form>
        )}
      </div>

      <a href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← 返回首页
      </a>
    </main>
  );
}
