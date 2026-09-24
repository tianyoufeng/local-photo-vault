"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登录失败");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("网络错误，请确认服务正在运行");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="card">
        <h1 className="mb-1 text-2xl font-bold">LocalPhotoVault</h1>
        <p className="mb-6 text-sm text-zinc-400">输入密码进入相册</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="password">
              密码
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn w-full" disabled={loading}>
            {loading ? "验证中…" : "登录"}
          </button>
        </form>
      </div>
    </main>
  );
}
