// 交付包 exe 端到端验证：
//  1) 启动 LocalPhotoVault.exe
//  2) 轮询 127.0.0.1:8787/api/health 与 局域网IP:8787/api/health
//  3) 打印监听 8787 的进程
//  4) 结束 exe，确认 node 子进程一并退出、8787 释放（无僵尸）
const { spawn, execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const DIR = process.argv[2];
if (!DIR) { console.error("缺少交付目录参数"); process.exit(2); }
const EXE = path.join(DIR, "LocalPhotoVault.exe");
const PORT = 8787;

function lanIp() {
  const VIRT = /vmware|virtualbox|vethernet|hyper-v|wsl|docker|tap|tun|tailscale|zerotier|bluetooth|蓝牙|npcap|radmin|openvpn|wireguard/i;
  const PHYS = /wi-?fi|wlan|wireless|无线|ethernet|以太网/i;
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      list.push({ name, ip: a.address, score: VIRT.test(name) ? 100 : PHYS.test(name) ? 0 : 10 });
    }
  }
  list.sort((x, y) => x.score - y.score || x.name.localeCompare(y.name));
  return list[0]?.ip || null;
}

function listeningPids(port) {
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
        const t = line.trim().split(/\s+/);
        pids.add(t[t.length - 1]);
      }
    }
    return [...pids];
  } catch { return []; }
}
function procName(pid) {
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    const m = out.match(/^"([^"]+)"/);
    return m ? m[1] : "?";
  } catch { return "?"; }
}
async function probe(url) {
  try { const r = await fetch(url); return r.status; } catch { return "ERR"; }
}

(async () => {
  const ip = lanIp();
  console.log(`检测到局域网 IP: ${ip}`);
  console.log(`启动: ${EXE}`);
  const exe = spawn(EXE, [], { cwd: DIR, detached: true, stdio: "ignore" });
  exe.unref();

  let local = "ERR", lan = "ERR";
  for (let i = 0; i < 60; i++) {
    local = await probe(`http://127.0.0.1:${PORT}/api/health`);
    if (local === 200) break;
    await new Promise((s) => setTimeout(s, 500));
  }
  if (ip) {
    for (let i = 0; i < 20; i++) {
      lan = await probe(`http://${ip}:${PORT}/api/health`);
      if (lan === 200) break;
      await new Promise((s) => setTimeout(s, 500));
    }
  }

  console.log("\n===== 结果 =====");
  console.log(`本机 127.0.0.1:${PORT}/api/health  -> ${local}`);
  console.log(`局域网 ${ip}:${PORT}/api/health    -> ${lan}`);

  const pids = listeningPids(PORT);
  console.log(`监听 ${PORT} 的进程: ${pids.map((p) => `${procName(p)}(${p})`).join(", ") || "无"}`);

  // 结束 exe
  console.log("\n==> 结束 LocalPhotoVault.exe");
  try { execFileSync("taskkill", ["/IM", "LocalPhotoVault.exe", "/F"], { stdio: "ignore" }); } catch {}
  await new Promise((s) => setTimeout(s, 2500));

  const pids2 = listeningPids(PORT);
  console.log(`结束后监听 ${PORT} 的进程: ${pids2.map((p) => `${procName(p)}(${p})`).join(", ") || "无（已释放）"}`);
  const leftoverNode = pids2.some((p) => /node\.exe/i.test(procName(p)));
  console.log(leftoverNode ? "!! 存在僵尸 node.exe（未随 exe 退出）" : "OK  无僵尸进程，端口已释放");
  process.exit(0);
})();
