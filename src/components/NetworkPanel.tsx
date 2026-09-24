"use client";

import { useEffect, useState } from "react";

interface NetInfo {
  port: number;
  interfaces: { name: string; address: string }[];
  urls: string[];
}
interface TokenInfo {
  enabled: boolean;
  masked: string | null;
  full: string | null;
}

export default function NetworkPanel() {
  const [net, setNet] = useState<NetInfo | null>(null);
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [customToken, setCustomToken] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/netinfo").then((r) => r.json()).then(setNet);
    loadToken();
  }, []);

  async function loadToken() {
    setToken(await fetch("/api/upload-token").then((r) => r.json()));
  }

  async function enableToken() {
    const r = await fetch("/api/upload-token", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customToken.trim() ? { token: customToken.trim() } : {}),
    }).then((r) => r.json());
    if (r.error) {
      setMsg(r.error);
      return;
    }
    setMsg("");
    setCustomToken("");
    loadToken();
  }

  async function disableToken() {
    await fetch("/api/upload-token", { method: "DELETE" });
    setMsg("已关闭上传令牌校验");
    loadToken();
  }

  async function copyToken() {
    if (!token?.full) return;
    await navigator.clipboard.writeText(token.full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card mb-6">
      <h2 className="mb-4 text-lg font-semibold">局域网与访问</h2>

      {/* 局域网地址 */}
      <div className="mb-4">
        <p className="label">本机局域网地址（手机同一 WiFi 下访问）</p>
        {net ? (
          <div className="space-y-1.5">
            {net.interfaces.length === 0 && <p className="text-sm text-zinc-500">未检测到局域网地址</p>}
            {net.interfaces.map((i) => (
              <div key={i.address} className="flex items-center gap-2 rounded-lg bg-zinc-950 px-3 py-2 text-sm">
                <span className="shrink-0 text-xs text-zinc-500">{i.name}</span>
                <code className="text-amber-400">http://{i.address}:{net.port}</code>
              </div>
            ))}
            {net.urls[0] && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">查看手机上传页二维码</summary>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/qr.svg?text=${encodeURIComponent(net.urls[0] + "/upload")}`}
                  alt="二维码"
                  className="mx-auto mt-2 rounded-lg"
                />
              </details>
            )}
          </div>
        ) : (
          <p className="text-zinc-500">加载中…</p>
        )}
      </div>

      {/* 上传令牌 */}
      <div className="mb-4 border-t border-zinc-800 pt-4">
        <p className="label">上传令牌（可选）</p>
        {token && (
          <div className="space-y-2">
            <p className="text-sm">
              状态：{token.enabled ? (
                <span className="text-emerald-400">已启用（上传需携带令牌）</span>
              ) : (
                <span className="text-zinc-500">未启用（任何登录用户可上传）</span>
              )}
            </p>
            {token.enabled && token.full && (
              <div className="flex items-center gap-2 rounded-lg bg-zinc-950 px-3 py-2">
                <code className="flex-1 truncate text-xs text-zinc-300">{token.full}</code>
                <button className="btn-secondary !px-2 !py-1 !text-xs" onClick={copyToken}>
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                className="input flex-1"
                value={customToken}
                onChange={(e) => setCustomToken(e.target.value)}
                placeholder="自定义令牌（留空则随机生成）"
                spellCheck={false}
              />
              <button className="btn" onClick={enableToken}>
                {token.enabled ? "重新生成" : "启用令牌"}
              </button>
              {token.enabled && (
                <button className="btn-secondary !border-red-900/60 !text-red-300" onClick={disableToken}>
                  关闭
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              令牌只通过请求头 <code>x-upload-token</code> 传递，不会出现在 URL 或二维码中。
              手机端首次上传时输入一次即可（本机记忆）。
            </p>
          </div>
        )}
        {msg && <p className="mt-2 text-sm text-emerald-400">{msg}</p>}
      </div>

      {/* Tailscale 远程访问说明 */}
      <details className="border-t border-zinc-800 pt-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-300 hover:text-zinc-100">
          🌐 远程访问：Tailscale 组网说明（推荐，免公网端口映射）
        </summary>
        <div className="mt-3 space-y-2 rounded-lg bg-zinc-950 p-3 text-sm text-zinc-400">
          <p className="text-amber-300/90">为什么不建议直接把 8787 端口映射到公网：局域网认证模型会被暴露到整个互联网，密码暴力破解、未授权访问风险骤增。</p>
          <ol className="list-inside list-decimal space-y-1.5">
            <li>电脑和手机都安装 <b>Tailscale</b>（tailscale.com，免费版足够），用同一账号登录。</li>
            <li>两台设备会组成一个加密 WireGuard 虚拟局域网。</li>
            <li>在电脑查看 Tailscale IP（100.x.x.x 段）：开始菜单搜索 Tailscale 或运行 <code className="text-zinc-300">tailscale ip -4</code>。</li>
            <li>手机浏览器打开 <code className="text-amber-400">http://&lt;Tailscale-IP&gt;:{net?.port ?? 8787}</code>，即可像局域网一样上传浏览。</li>
            <li>如 Windows 提示防火墙拦截，在「允许应用通过防火墙」里放行该端口（私有网络配置）。</li>
            <li>无需任何公网 IP、DDNS 或路由器端口映射，流量全程加密。</li>
          </ol>
        </div>
      </details>
    </div>
  );
}
