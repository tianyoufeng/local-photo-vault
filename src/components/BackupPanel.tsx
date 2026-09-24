"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "./desktop";

interface BackupRecord {
  id: string;
  filePath: string;
  archiveSha256: string;
  fileCount: number;
  totalSize: string;
  photoCount: number;
  status: string;
  createdAt: string;
}
interface SettingsInfo {
  lastBackupAt: string | null;
  intervalDays: number;
  remindDisabled: boolean;
  daysSinceBackup: number | null;
  due: boolean;
  records: BackupRecord[];
}

function fmtSize(bytes: string | number): string {
  const n = Number(bytes);
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

export default function BackupPanel() {
  const desktop = isTauri();
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [targetDir, setTargetDir] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [prog, setProg] = useState<any>(null);
  const [restorePath, setRestorePath] = useState("");
  const [restoreMode, setRestoreMode] = useState<"merge" | "overwrite">("merge");
  const [newRoot, setNewRoot] = useState("");
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const [rProg, setRProg] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/backup/settings").then((r) => r.json());
    setInfo(r);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (rPollRef.current) clearInterval(rPollRef.current);
    };
  }, []);

  // ---- 备份 ----
  async function startBackup() {
    setMsg("");
    const token = (await import("./desktop")).getDesktopToken;
    const t = (await token()) ?? "";
    const r = await fetch("/api/backup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LPV-Desktop": t },
      body: JSON.stringify({ targetDir }),
    });
    const data = await r.json();
    if (!r.ok) {
      setMsg(data.error ?? "启动失败");
      return;
    }
    setJobId(data.jobId);
    pollRef.current = setInterval(async () => {
      const p = await fetch(`/api/backup/progress?jobId=${data.jobId}`).then((r) => r.json());
      setProg(p);
      if (["finished", "failed", "canceled"].includes(p.state)) {
        if (pollRef.current) clearInterval(pollRef.current);
        load();
      }
    }, 500);
  }
  async function control(op: string) {
    if (!jobId) return;
    const r = await fetch("/api/backup/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, op }),
    }).then((r) => r.json());
    if (op === "retry" && r.jobId) setJobId(r.jobId);
  }
  async function saveSettings(patch: Record<string, unknown>) {
    await fetch("/api/backup/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    load();
  }

  // ---- 恢复 ----
  async function startRestore() {
    setMsg("");
    const token = (await import("./desktop")).getDesktopToken;
    const t = (await token()) ?? "";
    const r = await fetch("/api/backup/restore/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LPV-Desktop": t },
      body: JSON.stringify({
        archivePath: restorePath,
        mode: restoreMode,
        ...(newRoot.trim() ? { newPhotoRoot: newRoot.trim() } : {}),
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      setMsg(data.error ?? "启动恢复失败");
      return;
    }
    setRestoreJobId(data.jobId);
    rPollRef.current = setInterval(async () => {
      const p = await fetch(`/api/backup/restore/progress?jobId=${data.jobId}`).then((r) => r.json());
      setRProg(p);
      if (["finished", "failed"].includes(p.state)) {
        if (rPollRef.current) clearInterval(rPollRef.current);
      }
    }, 500);
  }

  const p = prog;
  const backupPct =
    p && p.bytesTotal > 0 ? Math.round((p.bytesDone / p.bytesTotal) * 100) : 0;

  return (
    <div className="card mb-6">
      <h2 className="mb-4 text-lg font-semibold">备份与恢复</h2>

      {/* 提醒状态 */}
      {info && (
        <div className="mb-4 rounded-lg bg-zinc-950 p-3 text-sm">
          <p>
            上次备份：
            {info.lastBackupAt
              ? `${new Date(info.lastBackupAt).toLocaleString("zh-CN")}（${info.daysSinceBackup ?? 0} 天前）`
              : "从未备份"}
          </p>
          <p className="mt-1 text-zinc-400">
            {info.remindDisabled
              ? "备份提醒已关闭"
              : info.due
                ? `⚠ 已超过 ${info.intervalDays} 天提醒阈值`
                : `提醒间隔 ${info.intervalDays} 天`}
          </p>
        </div>
      )}

      {/* 提醒配置 */}
      {info && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">提醒间隔</label>
            <select
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200"
              value={info.remindDisabled ? "off" : String(info.intervalDays)}
              onChange={(e) =>
                saveSettings(
                  e.target.value === "off"
                    ? { disabled: true }
                    : { disabled: false, intervalDays: Number(e.target.value) }
                )
              }
            >
              <option value="30">每 30 天</option>
              <option value="60">每 60 天</option>
              <option value="90">每 90 天</option>
              <option value="off">关闭提醒</option>
            </select>
          </div>
        </div>
      )}

      {/* 备份（电脑/手机均可发起：任务在服务端电脑执行） */}
      <div className="mb-5">
        <label className="label">备份目标目录（服务端电脑上的路径，建议移动硬盘或其他磁盘）</label>
        <div className="flex gap-2">
          <input
            className="input"
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            placeholder="例如 E:\\LPV_Backup"
            spellCheck={false}
          />
          <button className="btn whitespace-nowrap" onClick={startBackup} disabled={!!jobId && p?.state === "running"}>
            开始备份
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          手机端也可发起备份：任务在电脑上执行，完成后可在下方历史记录中把归档下载到手机。
        </p>
        {p && (
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className={p.state === "failed" ? "text-red-400" : ""}>
                {p.state === "running" && "备份中…"}
                {p.state === "paused" && "已暂停"}
                {p.state === "finished" && "✔ 备份完成"}
                {p.state === "failed" && `失败：${p.error}`}
                {p.state === "canceled" && "已取消"}
              </span>
              <span className="text-xs text-zinc-500">
                {p.filesDone}/{p.filesTotal} · {fmtSize(p.bytesDone)}
              </span>
            </div>
            <div className="h-2 rounded bg-zinc-800">
              <div className="h-2 rounded bg-amber-500 transition-all" style={{ width: `${backupPct}%` }} />
            </div>
            {p.currentFile && <p className="mt-1 truncate text-xs text-zinc-500">{p.currentFile}</p>}
            {p.state === "finished" && (
              <p className="mt-1 truncate text-xs text-emerald-400">
                归档 SHA-256: {p.archiveSha256?.slice(0, 24)}…
              </p>
            )}
            <div className="mt-2 flex gap-2">
              {p.state === "running" && (
                <button className="btn-secondary !py-1 !text-xs" onClick={() => control("pause")}>暂停</button>
              )}
              {p.state === "paused" && (
                <button className="btn-secondary !py-1 !text-xs" onClick={() => control("resume")}>继续</button>
              )}
              {(p.state === "running" || p.state === "paused") && (
                <button className="btn-secondary !py-1 !text-xs" onClick={() => control("cancel")}>取消</button>
              )}
              {(p.state === "failed" || p.state === "canceled") && (
                <button className="btn-secondary !py-1 !text-xs" onClick={() => control("retry")}>重试</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 恢复（改动本机数据，仅桌面端） */}
      <div className="border-t border-zinc-800 pt-4">
        {!desktop && (
          <p className="mb-3 rounded-lg border border-amber-700/50 bg-zinc-950 p-3 text-xs text-amber-300">
            恢复会改写电脑上的照片库，仅支持在桌面应用中操作；手机端可正常发起备份与下载归档。
          </p>
        )}
        <p className="label">恢复备份（.lpvbackup）— 可直接把备份文件拖入桌面窗口自动填入路径</p>
        <div className="mb-3 flex gap-2">
          <input
            className="input"
            value={restorePath}
            onChange={(e) => setRestorePath(e.target.value)}
            placeholder="备份文件完整路径"
            disabled={!desktop}
            spellCheck={false}
          />
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">恢复模式</label>
            <select
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200"
              value={restoreMode}
              onChange={(e) => setRestoreMode(e.target.value as "merge" | "overwrite")}
            >
              <option value="merge">合并去重（保留现有，跳过已有）</option>
              <option value="overwrite">全量覆盖（当前库被替换）</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="label">恢复到新照片根目录（可选）</label>
            <input
              className="input"
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              placeholder="留空则使用当前照片根目录"
              disabled={!desktop}
              spellCheck={false}
            />
          </div>
          <button
            className="btn"
            onClick={startRestore}
            disabled={!desktop || !restorePath.trim()}
          >
            开始恢复
          </button>
        </div>
        {rProg && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
            <p className={rProg.state === "failed" ? "text-red-400" : ""}>
              {rProg.state === "running" && `恢复中：${rProg.stage}`}
              {rProg.state === "finished" &&
                `✔ 恢复完成：合并 ${rProg.summary.merged} 条，跳过已有 ${rProg.summary.skippedExisting} 条，提取 ${rProg.summary.extracted} 个文件`}
              {rProg.state === "failed" && `恢复失败：${rProg.error}`}
            </p>
            {rProg.rolledBack && <p className="mt-1 text-amber-300">已自动回滚到恢复前状态。</p>}
            {rProg.summary?.failures?.length > 0 && (
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-auto text-xs text-zinc-500">
                {rProg.summary.failures.map((f: any, i: number) => (
                  <li key={i} className="truncate">{f.path} — {f.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 历史记录 */}
      {info && info.records.length > 0 && (
        <div className="mt-5">
          <p className="label">备份历史</p>
          <div className="max-h-48 overflow-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-500">
                <tr>
                  <th className="p-2">时间</th>
                  <th className="p-2">状态</th>
                  <th className="p-2">照片数</th>
                  <th className="p-2">大小</th>
                  <th className="p-2">归档哈希</th>
                  <th className="p-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {info.records.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-800/60">
                    <td className="p-2">{new Date(r.createdAt).toLocaleString("zh-CN")}</td>
                    <td className={`p-2 ${r.status === "success" ? "text-emerald-400" : "text-red-400"}`}>
                      {r.status === "success" ? "成功" : r.status}
                    </td>
                    <td className="p-2">{r.photoCount}</td>
                    <td className="p-2">{fmtSize(r.totalSize)}</td>
                    <td className="max-w-[120px] truncate p-2 text-zinc-500">{r.archiveSha256.slice(0, 20)}…</td>
                    <td className="p-2">
                      {r.status === "success" && (
                        <a
                          href={`/api/backup/download?recordId=${r.id}`}
                          className="text-amber-400 hover:underline"
                          download
                        >
                          下载归档
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-red-400">{msg}</p>}
    </div>
  );
}
