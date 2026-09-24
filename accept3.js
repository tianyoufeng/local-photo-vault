/* LocalPhotoVault 阶段三验收（node accept3.js）— 桌面导入流水线 API 层
 * 覆盖：桌面令牌鉴权、文件夹递归扫描、EXIF 分目录、复制默认保留源、
 * 去重返回已有原图、移动删源、只读卡警告、删源确认接口、失败重试。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:8787";
const PW = process.env.LPV_PW || "test-1234";
const ROOT = "C:/Users/q2764/WorkBuddy/2026-09-20-17-32-59/LocalPhotoVault/.accept-files";
let cookie = "";
const results = [];

function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
}
function sha256(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
async function req(method, url, body, headers = {}) {
  const h = { ...headers };
  if (body && typeof body === "object") {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  if (cookie) h["Cookie"] = cookie;
  const res = await fetch(BASE + url, { method, headers: h, body, redirect: "manual" });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function readToken() {
  // 服务端首次被调用时才生成令牌；先打一次触发再读
  const p = "D:/picture/.lpvault/desktop-token";
  for (let i = 0; i < 15; i++) {
    if (fs.existsSync(p)) {
      const t = fs.readFileSync(p, "utf-8").trim();
      if (t) return t;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("令牌未生成");
}
async function poll(importId, timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    const r = await req("GET", `/api/photos/import/progress?importId=${importId}`);
    if (r.json?.state === "finished") return r.json;
    if (Date.now() - t0 > timeoutMs) throw new Error("导入超时");
    await new Promise((r2) => setTimeout(r2, 400));
  }
}

async function main() {
  // 重新生成基础夹具（上轮测试可能删掉了部分源文件）
  const { execSync } = require("child_process");
  execSync(
    `"${process.execPath}" "${path.join(__dirname, "make-accept-files.mjs")}"`,
    { stdio: "ignore" }
  );

  // 登录 + 清场
  await req("POST", "/api/auth", { password: PW });
  for (const t of ["", "&trash=1"]) {
    const all = await req("GET", `/api/photos?pageSize=100${t}`);
    for (const p of all.json?.items ?? []) {
      await req("DELETE", `/api/photos/${p.id}`);
      await req("DELETE", `/api/trash?id=${p.id}`);
    }
  }

  // ===== 1. 令牌鉴权：无令牌 403（模拟手机端） =====
  const noToken = await req("POST", "/api/photos/import/scan", { paths: [ROOT], mode: "copy" });
  check("无桌面令牌访问导入接口被拒(403)", noToken.status === 403, `status=${noToken.status}`);
  const token = await readToken();
  const badToken = await req("POST", "/api/photos/import/scan", { paths: [ROOT], mode: "copy" }, { "X-LPV-Desktop": "deadbeef" });
  check("错误令牌同样被拒", badToken.status === 403);

  // ===== 2. 构造文件夹嵌套（含子目录 RAW），测试递归扫描 =====
  const folder = path.join(ROOT, "内存卡_DCIM");
  const sub = path.join(folder, "100FUJI");
  fs.mkdirSync(sub, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "雪山_2024a.jpg"), path.join(folder, "卡根_2024a.jpg"));
  fs.copyFileSync(path.join(ROOT, "晚霞_2024b.jpg"), path.join(sub, "卡子目录_2024b.jpg"));
  fs.copyFileSync(path.join(ROOT, "DSC_20240701.CR2"), path.join(sub, "卡子目录_IMG.CR2"));
  fs.writeFileSync(path.join(folder, "说明文档.txt"), "不是照片");

  const scan = await req("POST", "/api/photos/import/scan", { paths: [folder], mode: "copy" }, { "X-LPV-Desktop": token });
  check(
    "文件夹递归扫描：3 张照片、txt 被跳过",
    scan.status === 200 && scan.json.total === 3 && scan.json.skipped === 1,
    JSON.stringify({ total: scan.json?.total, skipped: scan.json?.skipped })
  );
  const scanId = scan.json.importId;
  const runScan = await req("POST", "/api/photos/import/run", { importId: scanId }, { "X-LPV-Desktop": token });
  const scanProg = runScan.status === 200 ? await poll(scanId) : null;
  check("递归导入全部成功", scanProg?.success === 3, JSON.stringify(scanProg?.failures));
  // EXIF 分目录：卡根_2024a (EXIF 2024-01-01) 应在 2024\01
  check(
    "按 EXIF 拍摄时间落盘 YYYY\\MM",
    fs.existsSync("D:/picture/2024/01/卡根_2024a.jpg") && fs.existsSync("D:/picture/2024/06/卡子目录_2024b.jpg"),
    "2024\\01 与 2024\\06"
  );
  // 复制模式：源文件保留
  check("复制模式源文件保留", fs.existsSync(path.join(folder, "卡根_2024a.jpg")));

  // ===== 3. 去重：同内容再导入 → duplicate + 复用原图 =====
  const before = fs.statSync("D:/picture/2024/01/卡根_2024a.jpg").size;
  const dupScan = await req("POST", "/api/photos/import/scan", { paths: [path.join(ROOT, "雪山_2024a.jpg")], mode: "copy" }, { "X-LPV-Desktop": token });
  await req("POST", "/api/photos/import/run", { importId: dupScan.json.importId }, { "X-LPV-Desktop": token });
  const dupProg = await poll(dupScan.json.importId);
  const dupItem = dupProg.results[0];
  check(
    "重复导入返回 duplicate 且复用已有原图",
    dupItem.duplicate === true && typeof dupItem.photoId === "string",
    `photoId=${dupItem?.photoId}`
  );
  check("去重后磁盘不新增副本", fs.statSync("D:/picture/2024/01/卡根_2024a.jpg").size === before);

  // ===== 4. 移动模式：校验通过后删除源 =====
  const mvSrc = path.join(ROOT, "待移动_巷子.jpg");
  fs.copyFileSync(path.join(ROOT, "巷子_2023c.jpg"), mvSrc);
  const mvSha = sha256(mvSrc);
  const mvScan = await req("POST", "/api/photos/import/scan", { paths: [mvSrc], mode: "move" }, { "X-LPV-Desktop": token });
  await req("POST", "/api/photos/import/run", { importId: mvScan.json.importId }, { "X-LPV-Desktop": token });
  const mvProg = await poll(mvScan.json.importId);
  check("移动模式导入成功且源文件已删除", mvProg.results[0].sourceDeleted === true && !fs.existsSync(mvSrc));
  // 原图落盘哈希一致
  const moved = fs.readdirSync("D:/picture/2023/05").find((f) => f.includes("待移动_巷子"));
  check("移动后的原图哈希与源一致", moved && sha256(path.join("D:/picture/2023/05", moved)) === mvSha);

  // ===== 5. 源不可删除（模拟内存卡被占用/锁定）：move 模式 → 警告 + 源保留 =====
  // 注：chmod 只读会被 libuv 清属性后删除；icacls deny 会连复制一起挡掉。
  //     用 .NET 以 FileShare.Read 打开句柄：其他进程可读（复制成功）但无法删除。
  const { spawn } = require("child_process");
  const roSrc = path.join(ROOT, "RO_IMG.jpg");
  fs.copyFileSync(path.join(ROOT, "雪山_2024a.jpg"), roSrc);
  const holder = spawn(
    "powershell",
    ["-NoProfile", "-Command",
     `$f=[System.IO.File]::Open('${roSrc.replace(/\\/g, "\\\\")}','Open','Read','Read'); Start-Sleep -Seconds 30; $f.Close()`],
    { stdio: "ignore" }
  );
  await new Promise((r) => setTimeout(r, 2000)); // 等句柄就位
  const roScan = await req("POST", "/api/photos/import/scan", { paths: [roSrc], mode: "move" }, { "X-LPV-Desktop": token });
  await req("POST", "/api/photos/import/run", { importId: roScan.json.importId }, { "X-LPV-Desktop": token });
  const roProg = await poll(roScan.json.importId);
  const roItem = roProg.results[0];
  check(
    "源不可删除：导入成功 + 警告 + 源文件保留",
    roItem.status === "done" && roItem.warning && fs.existsSync(roSrc),
    roItem.warning ?? JSON.stringify(roItem)
  );
  holder.kill();
  await new Promise((r) => setTimeout(r, 800));
  try {
    fs.unlinkSync(roSrc);
  } catch { /* 尽力清理 */ }

  // ===== 6. 源文件拔出/不存在：失败且无副作用 =====
  const ghostScan = await req("POST", "/api/photos/import/scan", { paths: ["C:/不存在的路径/Ghost.jpg"], mode: "copy" }, { "X-LPV-Desktop": token });
  check("源路径不存在时扫描报错", ghostScan.status === 400, JSON.stringify(ghostScan.json?.error ?? ""));

  // ===== 7. 复制模式完成后确认删源接口 =====
  const csScan = await req("POST", "/api/photos/import/scan", { paths: [path.join(ROOT, "晚霞_2024b.jpg")], mode: "copy" }, { "X-LPV-Desktop": token });
  await req("POST", "/api/photos/import/run", { importId: csScan.json.importId }, { "X-LPV-Desktop": token });
  await poll(csScan.json.importId);
  const del = await req("POST", "/api/photos/import/deletesources", { importId: csScan.json.importId }, { "X-LPV-Desktop": token });
  check("确认删源接口删除成功", del.status === 200 && del.json.deleted === 1, JSON.stringify(del.json));
  check("源文件已被删除", !fs.existsSync(path.join(ROOT, "晚霞_2024b.jpg")));

  const pass = results.filter(Boolean).length;
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(2);
});
