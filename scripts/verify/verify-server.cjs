// 编排：启动服务端 → 等健康检查 → 跑路由探针 → 跑功能测试 → 关闭（含进程树清理）
//
// 用法（用包内自带的 node.exe 跑，避免依赖系统 Node）：
//   <包>/server/node.exe scripts/verify/verify-server.cjs "<包>/server"
// 可选环境变量：LPV_PORT（默认 8788，避开正式 8787）
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");

const SERVER_DIR = process.argv[2];
if (!SERVER_DIR) {
  console.error("用法: node verify-server.cjs <server目录>");
  process.exit(2);
}
const NODE = path.join(SERVER_DIR, "node.exe");
const PORT = Number(process.env.LPV_PORT) || 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const HERE = __dirname;

const child = spawn(NODE, ["server.js"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", NODE_OPTIONS: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let err = "";
child.stderr.on("data", (d) => (err += d));
child.stdout.on("data", () => {});

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((s) => setTimeout(s, 500));
  }
  throw new Error("服务端未在 60s 内就绪");
}

(async () => {
  let code = 0;
  try {
    const h = await waitUp();
    console.log("HEALTH: " + JSON.stringify(h));

    console.log("\n================ 路由探针 ================");
    execFileSync(NODE, [path.join(HERE, "probe-routes.mjs")], {
      stdio: "inherit",
      env: { ...process.env, BASE },
    });

    console.log("\n================ 功能测试（非破坏性）================");
    execFileSync(NODE, [path.join(HERE, "func-test.cjs")], {
      stdio: "inherit",
      env: { ...process.env, LPV_BASE: BASE },
    });
  } catch (e) {
    console.log("\n!! 执行出错: " + e.message);
    code = 1;
  } finally {
    try { child.kill(); } catch {}
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    await new Promise((s) => setTimeout(s, 1000));
    console.log("\n================ 服务端 stderr（若有）================");
    console.log(err.trim() ? err.slice(0, 3000) : "(空)");
    process.exit(code);
  }
})();
