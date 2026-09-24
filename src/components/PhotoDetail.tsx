"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface PhotoDetail {
  id: string;
  originalName: string;
  kind: string;
  mimeType: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  focalLength: number | null;
  fNumber: number | null;
  exposureTime: string | null;
  iso: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  rating: number;
  favorite: boolean;
  sha256: string;
  deletedAt: string | null;
  createdAt: string;
  tags: string[];
  albums: { id: string; name: string }[];
}

function fmtSize(bytes: string): string {
  const n = Number(bytes);
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

export default function PhotoDetail({ id }: { id: string }) {
  const router = useRouter();
  const [p, setP] = useState<PhotoDetail | null>(null);
  const [error, setError] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/photos/${id}`);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "加载失败");
      return;
    }
    setP(await res.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(data: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) setP(await res.json());
    } finally {
      setSaving(false);
    }
  }

  async function softDelete() {
    if (!confirm("确定把这张照片移入回收站？（保留 30 天，可恢复）")) return;
    const res = await fetch(`/api/photos/${id}`, { method: "DELETE" });
    if (res.ok) {
      alert("已移入回收站");
      router.push("/");
    }
  }

  async function addTag() {
    if (!p || !tagInput.trim()) return;
    const next = [...new Set([...p.tags, tagInput.trim()])];
    setTagInput("");
    await patch({ tags: next });
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 text-zinc-400">
        <p>{error}</p>
        <Link href="/" className="mt-4 inline-block text-amber-400">← 返回图库</Link>
      </main>
    );
  }
  if (!p) {
    return <main className="mx-auto max-w-3xl px-6 py-12 text-zinc-500">加载中…</main>;
  }

  const previewable = p.kind === "image";
  const exifRows: [string, string][] = [
    ["拍摄时间", p.takenAt ? new Date(p.takenAt).toLocaleString("zh-CN") : "—（无 EXIF 拍摄时间）"],
    ["上传时间", new Date(p.createdAt).toLocaleString("zh-CN")],
    ["相机", [p.cameraMake, p.cameraModel].filter(Boolean).join(" ") || "—"],
    ["镜头", p.lensModel ?? "—"],
    ["焦距", p.focalLength != null ? `${Math.round(p.focalLength)}mm` : "—"],
    ["光圈", p.fNumber != null ? `f/${p.fNumber}` : "—"],
    ["快门", p.exposureTime ?? "—"],
    ["ISO", p.iso != null ? String(p.iso) : "—"],
    ["尺寸", p.width && p.height ? `${p.width} × ${p.height}` : "—"],
    ["文件大小", fmtSize(p.sizeBytes)],
    [
      "GPS",
      p.gpsLat != null && p.gpsLon != null
        ? `${p.gpsLat.toFixed(5)}, ${p.gpsLon.toFixed(5)}`
        : "—",
    ],
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">← 返回图库</Link>
        {p.deletedAt && (
          <span className="rounded bg-red-900/50 px-2 py-0.5 text-xs text-red-300">
            回收站中 · {new Date(p.deletedAt).toLocaleString("zh-CN")} 删除
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* 预览区 */}
        <div className="card flex items-center justify-center p-3">
          {previewable ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/photos/${p.id}/original`}
              alt={p.originalName}
              className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/photos/${p.id}/thumbnail`}
              alt={p.originalName}
              className="max-h-[75vh] max-w-full rounded-lg"
            />
          )}
        </div>

        {/* 信息面板 */}
        <div className="space-y-4">
          <div className="card">
            <h1 className="mb-1 break-all text-lg font-semibold">{p.originalName}</h1>
            <p className="mb-3 text-xs text-zinc-500">
              {p.kind.toUpperCase()} · {p.mimeType} · SHA-256 {p.sha256.slice(0, 16)}…
            </p>

            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm text-zinc-400">评分</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  disabled={saving}
                  onClick={() => patch({ rating: p.rating === n ? 0 : n })}
                  className={`text-xl leading-none ${n <= p.rating ? "text-amber-400" : "text-zinc-700"}`}
                >
                  ★
                </button>
              ))}
              <label className="ml-2 flex items-center gap-1 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={p.favorite}
                  disabled={saving}
                  onChange={(e) => patch({ favorite: e.target.checked })}
                  className="accent-amber-500"
                />
                收藏
              </label>
            </div>

            <div className="mb-3">
              <p className="label">标签</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {p.tags.length === 0 && <span className="text-sm text-zinc-500">暂无</span>}
                {p.tags.map((t) => (
                  <button
                    key={t}
                    className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300 hover:border-red-500/60 hover:text-red-300"
                    disabled={saving}
                    title="点击移除"
                    onClick={() => patch({ tags: p.tags.filter((x) => x !== t) })}
                  >
                    {t} ×
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                  placeholder="新标签，回车添加"
                />
                <button className="btn-secondary" onClick={addTag} disabled={saving}>添加</button>
              </div>
            </div>

            <div className="mb-3">
              <p className="label">归属相册</p>
              {p.albums.length === 0 ? (
                <p className="text-sm text-zinc-500">未加入任何相册</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {p.albums.map((a) => (
                    <Link
                      key={a.id}
                      href={`/?album=${encodeURIComponent(a.name)}`}
                      className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300 hover:border-amber-500/60 hover:text-amber-300"
                    >
                      🖼 {a.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <a href={`/api/photos/${p.id}/original`} className="btn mb-2 w-full" download>
              下载原图（不转码不压缩）
            </a>
            {!p.deletedAt ? (
              <button className="btn-secondary w-full !border-red-900/60 !text-red-300" onClick={softDelete}>
                删除（移入回收站）
              </button>
            ) : (
              <button
                className="btn w-full"
                onClick={async () => {
                  await fetch(`/api/photos/${p.id}/restore`, { method: "POST" });
                  load();
                }}
              >
                从回收站恢复
              </button>
            )}
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">EXIF 信息</h2>
            <dl className="space-y-1.5 text-sm">
              {exifRows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-zinc-500">{k}</dt>
                  <dd className="break-all text-right text-zinc-200">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </main>
  );
}
