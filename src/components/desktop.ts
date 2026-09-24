"use client";

/**
 * 桌面端（Tauri WebView）桥接助手。
 * 浏览器/手机环境里 isTauri() 为 false，所有桌面能力自动降级隐藏。
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 读取桌面令牌；服务端未就绪时自动重试（TOKEN_NOT_READY） */
export async function getDesktopToken(retries = 10): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  for (let i = 0; i < retries; i++) {
    try {
      const t = await invoke<string>("get_desktop_token");
      if (t) return t;
    } catch (e) {
      if (String(e).includes("NOT_INITIALIZED")) return null;
      // TOKEN_NOT_READY：服务端还没生成令牌，稍等重试
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export interface DragPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths: string[];
}

/** 监听 Tauri 拖拽事件（资源管理器/内存卡拖入窗口）；非桌面环境返回空函数 */
export async function onFileDragDrop(
  cb: (p: DragPayload) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload as {
        type: string;
        paths?: string[];
        position?: unknown;
      };
      cb({
        type: p.type as DragPayload["type"],
        paths: p.paths ?? [],
      });
    });
    return unlisten;
  } catch {
    return () => {};
  }
}
