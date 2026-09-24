"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 桌面端本地导入面板：扫描 → 后台执行 → 轮询进度 → 完成/失败重试 → 复制模式询问删源。
 * 仅在 Tauri WebView 内由 GalleryClient 挂载。
 */

interface ImportFileResult {
  path: string;
  status: "pending" | "done" | "failed";
  photoId?: string;
  duplicate?: boolean;
  sourceDeleted?: boolean;
  warning?: string;
  error?: string;
}

interface Progress {
  state: "ready" | "running" | "finished";
  mode: "copy" | "move";
  total: number;
  done: number;
  success: number;
  failed: number;
  current: { path: string; bytes: number; totalSize: number } | null;
  failures: { path: string; error: string }[];
  results: ImportFileResult[];
}

export default function ImportDesktop({
  paths,
  onClose,
  onDone,
}: {
  paths: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"copy" | "move">("copy");
  const [importId, setImportId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");
  const tokenRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const token = useCallback(async () => {
    if (!tokenRef.current) {
      const { getDesktopToken } = await import("./desktop");
      tokenRef.current = (await getDesktopToken()) ?? "";
    }
    return tokenRef.current;
  }, []);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const start = useCallback(
    async (retryPaths?: string[]) => {
      setError("");
      const headers = {
        "Content-Type": "application/json",
        "X-LPV-Desktop": (await token()) || "",
      };
      let id = importId;
      if (!id || retryPaths) {
        const scan = await fetch("/api/photos/import/scan", {
          method: "POST",
          headers,
          body: JSON.stringify({ paths: retryPaths ?? paths, mode }),
        }).then((r) => r.json());
        if (scan.error) {
          setError(scan.error);
          return;
        }
        id = scan.importId;
        setImportId(id);
      }
      const run = await fetch("/api/photos/import/run", {
        method: "POST",
        headers,
        body: JSON.stringify({ importId: id, ...(retryPaths ? { paths: retryPaths } : {}) }),
      }).then((r) => r.json());
      if (run.error) {
        setError(run.error);
        return;
      }
      stopPoll();
      pollRef.current = setInterval(async () => {
        const p = await fetch(`/api/photos/import/progress?importId=${id}`).then((r) => r.json());
        setProgress(p);
        if (p.state === "finished") {
          stopPoll();
          onDone();
          if (p.mode === "copy" && p.success > 0) setAskDelete(true);
        }
      }, 500);
    },
    [importId, mode, paths, token, onDone]
  );

  useEffect(() => {
    return stopPoll;
  }, []);

  async function confirmDeleteSources(yes: boolean) {
    setAskDelete(false);
    if (!yes || !importId) return;
    const r = await fetch("/api/photos/import/deletesources", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LPV-Desktop": (await token()) || "" },
      body: JSON.stringify({ importId }),
    }).then((r) => r.json());
    setDeleteMsg(
      r.errors?.length
        ? `已删除 ${r.deleted} 个源文件；${r.errors.length} 个删除失败：${r.errors[0].error}`
        : `已删除 ${r.deleted} 个源文件`
    );
  }

  const p = progress;
  const failedItems = p?.results.filter((r) => r.status === "failed") ?? [];
  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="card w-full max-w-2xl">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-lg font-semibold">本地导入</h2>
          <div className="flex-1" />
          <button className="btn-secondary !px-3 !py-1 !text-sm" onClick={() => { stopPoll(); onClose(); }}>
            关闭
          </button>
        </div>

        {/* 第一步：选择模式 */}
        {!importId && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              已选择 {paths.length} 个拖入项。导入将逐个校验 SHA-256，原图无损落库。
            </p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={mode === "copy"} onChange={() => setMode("copy")} className="accent-amber-500" />
                复制（保留源文件，完成后可再决定删除）
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={mode === "move"} onChange={() => setMode("move")} className="accent-amber-500" />
                移动（校验通过后删除源文件）
              </label>
            </div>
            <button className="btn w-full" onClick={() => start()}>
              开始导入
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        {/* 进度 */}
        {p && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>
                {p.state === "running" ? "导入中…" : "导入完成"} · 成功 {p.success} / {p.total}
                {p.failed > 0 && <span className="text-red-400"> · 失败 {p.failed}</span>}
              </span>
              {p.mode === "move" && <span className="text-xs text-zinc-500">移动模式：校验通过后删除源</span>}
            </div>
            <div className="h-2 rounded bg-zinc-800">
              <div
                className="h-2 rounded bg-amber-500 transition-all"
                style={{ width: `${Math.round((p.done / Math.max(1, p.total)) * 100)}%` }}
              />
            </div>
            {p.state === "running" && p.current && (
              <p className="truncate text-xs text-zinc-500">当前：{fileName(p.current.path)}</p>
            )}

            {/* 失败列表 + 重试 */}
            {failedItems.length > 0 && p.state === "finished" && (
              <div className="rounded-lg border border-red-900/50 bg-zinc-950 p-3">
                <p className="mb-2 text-sm text-red-300">失败 {failedItems.length} 项（源文件未受影响）：</p>
                <ul className="mb-2 max-h-40 space-y-1 overflow-auto text-xs text-zinc-400">
                  {failedItems.map((f) => (
                    <li key={f.path} className="truncate">
                      {fileName(f.path)} — {f.error}
                    </li>
                  ))}
                </ul>
                <button
                  className="btn-secondary !py-1 !text-xs"
                  onClick={() => start(failedItems.map((f) => f.path))}
                >
                  重试失败项
                </button>
              </div>
            )}

            {/* 警告（如内存卡只读） */}
            {p.results.some((r) => r.warning) && (
              <div className="rounded-lg border border-amber-700/50 bg-zinc-950 p-3 text-xs text-amber-300">
                {p.results.filter((r) => r.warning).map((r) => (
                  <p key={r.path} className="truncate">{fileName(r.path)} — {r.warning}</p>
                ))}
              </div>
            )}

            {/* 复制模式：询问是否删除源文件 */}
            {askDelete && (
              <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
                <p className="mb-2 text-sm">
                  已成功导入 {p.success} 张（均已通过 SHA-256 校验）。是否删除这些源文件？
                </p>
                <div className="flex gap-2">
                  <button className="btn !py-1 !text-sm" onClick={() => confirmDeleteSources(true)}>
                    删除源文件
                  </button>
                  <button className="btn-secondary !py-1 !text-sm" onClick={() => confirmDeleteSources(false)}>
                    保留源文件
                  </button>
                </div>
              </div>
            )}
            {deleteMsg && <p className="text-sm text-emerald-400">{deleteMsg}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
