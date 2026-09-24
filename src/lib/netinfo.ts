import os from "node:os";

/** 局域网信息：本机 IPv4 地址列表与访问 URL */
export interface NetInfo {
  port: number;
  interfaces: { name: string; address: string }[];
  urls: string[];
}

/** 常见虚拟/隧道网卡名称片段（这些地址手机通常不可达，排序时降权） */
const VIRTUAL_HINTS = [
  "vmware",
  "virtualbox",
  "vethernet",
  "hyper-v",
  "loopback",
  "wsl",
  "docker",
  "tap",
  "tun",
  "tailscale",
  "zerotier",
  "bluetooth",
  "蓝牙",
  "npcap",
  "radmin",
  "openvpn",
  "wireguard",
];

/** 真实物理网卡优先关键字 */
const PHYSICAL_HINTS = ["wi-fi", "wifi", "wlan", "无线", "ethernet", "以太网", "en0", "eth"];

function score(name: string): number {
  const n = name.toLowerCase();
  if (VIRTUAL_HINTS.some((h) => n.includes(h))) return 100; // 虚拟网卡排最后
  const idx = PHYSICAL_HINTS.findIndex((h) => n.includes(h));
  if (idx >= 0) return idx; // 命中的物理关键字越靠前越优先
  return 50; // 其它未知网卡居中
}

export function getNetInfo(): NetInfo {
  const port = Number(process.env.PORT) || 8787;
  const interfaces: { name: string; address: string }[] = [];
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs ?? []) {
      // 仅 IPv4 且非回环（os.NetworkInterfaceInfo.family 在新版 Node 中为字符串）
      if (String(a.family) === "IPv4" && !a.internal) {
        // 排除 169.254.x.x 自动私有地址（未拿到 DHCP 时出现，不可用）
        if (a.address.startsWith("169.254.")) continue;
        interfaces.push({ name, address: a.address });
      }
    }
  }
  // 真实物理网卡优先；同优先级按名称稳定排序
  interfaces.sort((a, b) => score(a.name) - score(b.name) || a.name.localeCompare(b.name));
  const urls = interfaces.map((i) => `http://${i.address}:${port}`);
  return { port, interfaces, urls };
}
