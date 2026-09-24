"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface SetupStatus {
  initialized: boolean;
  photoRoot?: string;
  defaultPhotoRoot?: string;
  dDriveReady?: boolean;
  rootWritable?: boolean;
}

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [photoRoot, setPhotoRoot] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((data: SetupStatus) => {
        if (data.initialized) {
          router.replace("/login");
          return;
        }
        setStatus(data);
        setPhotoRoot(data.photoRoot ?? "");
      })
      .catch(() => setError("无法连接服务"));
  }, [router]);

  const dReady = status?.dDriveReady ?? false;
  const pwOk = password.length >= 4 && password === confirm;

  async function runSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!pwOk) {
      setError("两次输入的密码不一致，或不足 4 位");
      return;
    }
    setLoading(true);
    setLog([`① 目标位置：${photoRoot}`]);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoRoot, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "初始化失败");
        return;
      }
      setLog((l) => [
        ...l,
        "② 目录创建完成",
        "③ 数据库初始化完成",
        "✔ 全部完成，正在进入…",
      ]);
      router.replace("/");
      router.refresh();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <div className="card">
        <h1 className="mb-1 text-2xl font-bold">欢迎使用 LocalPhotoVault</h1>
        <p className="mb-6 text-sm text-zinc-400">
          首次启动向导：检测磁盘 → 创建照片库 → 设置密码
        </p>

        {/* 步骤一：磁盘检测（只读展示） */}
        <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm">
          <div className="mb-2 font-medium text-zinc-300">① 磁盘检测</div>
          {!status ? (
            <p className="text-zinc-500">正在检测…</p>
          ) : dReady ? (
            <p className="text-emerald-400">
              ✔ 照片盘就绪，将使用默认位置：
              <code className="ml-1 text-amber-400">{status.photoRoot}</code>
            </p>
          ) : (
            <p className="text-red-400">
              ✘ 未检测到可用的照片盘（{status.photoRoot} 不可用），
              可在下方改为其他路径。
            </p>
          )}
        </div>

        <form onSubmit={runSetup} className="space-y-4">
          <div>
            <label className="label" htmlFor="root">
              ② 照片根目录（原图将无损存放于此）
            </label>
            <input
              id="root"
              className="input"
              value={photoRoot}
              onChange={(e) => setPhotoRoot(e.target.value)}
              placeholder="D:\picture"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-zinc-500">
              将自动创建该目录及配置目录 <code>.lpvault</code>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="pw">
                ③ 设置登录密码
              </label>
              <input
                id="pw"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={4}
              />
            </div>
            <div>
              <label className="label" htmlFor="pw2">
                确认密码
              </label>
              <input
                id="pw2"
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {log.length > 0 && (
            <pre className="rounded-lg bg-zinc-950 p-3 text-xs text-zinc-400">
              {log.join("\n")}
            </pre>
          )}

          <button
            className="btn w-full"
            disabled={loading || !status || password.length < 4}
          >
            {loading ? "正在初始化…" : "开始初始化"}
          </button>
        </form>
      </div>
    </main>
  );
}
