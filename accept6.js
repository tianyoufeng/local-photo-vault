/* LocalPhotoVault 阶段六验收（node accept6.js）
 * 覆盖：全量备份（VACUUM INTO 快照+原图字节复制+manifest+归档哈希）、
 * 半成品防护、取消、暂停/继续、备份历史、篡改检测与回滚、
 * 合并去重恢复、全量覆盖恢复、恢复到新照片根目录、30 天提醒。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BASE = "http://127.0.0.1:8787";
const PW = process.env.LPV_PW || "test-1234";
const BACKUP_DIR = "C:/LPV_Backup_Test";
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
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h["Cookie"] = cookie;
  const res = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}
function token() {
  return fs.readFileSync("D:/picture/.lpvault/desktop-token", "utf-8").trim();
}
async function ensureToken() {
  for (let i = 0; i < 20; i++) {
    // 候选位置：当前 boot 配置的根目录 + 默认 D:\picture（根目录可能被恢复流程切换过）
    const cfg = JSON.parse(fs.readFileSync(".lpvault-boot.json", "utf-8"));
    const candidates = [
      path.join(cfg.photoRoot, ".lpvault", "desktop-token"),
      "D:/picture/.lpvault/desktop-token",
    ];
    for (const p of [...new Set(candidates)]) {
      const t = fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : "";
      if (!/^[a-f0-9]{64}$/.test(t)) continue;
      // 探测令牌：restore/start 对不存在的归档返回 404=令牌有效；403=令牌失效
      const probe = await req("POST", "/api/backup/restore/start", { archivePath: "C:/__probe__.lpvbackup" }, { "X-LPV-Desktop": t });
      if (probe.status === 404) return t;
      try { fs.rmSync(p, { force: true }); } catch {}
    }
    // 触发服务端重新生成
    await req("POST", "/api/backup/restore/start", { archivePath: "C:/__trigger__.lpvbackup" }, { "X-LPV-Desktop": "trigger" });
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("令牌未生成");
}
async function makePhoto(name, color) {
  const sharp = (await import("sharp")).default;
  const buf = await sharp({ create: { width: 400, height: 300, channels: 3, background: color } })
    .withExif({ IFD0: { Make: "AccCam", Model: name } }).jpeg().toBuffer();
  const init = await req("POST", "/api/photos/upload/init", { fileName: name, size: buf.length });
  await fetch(BASE + `/api/photos/upload/chunk?uploadId=${init.json.uploadId}&index=0`, {
    method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/octet-stream" }, body: buf,
  });
  const fin = await req("POST", "/api/photos/upload/finalize", { uploadId: init.json.uploadId });
  return fin.json.photo.id;
}
async function poll(url, timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    const r = await req("GET", url);
    if (["finished", "failed", "canceled"].includes(r.json?.state)) return r.json;
    if (Date.now() - t0 > timeoutMs) throw new Error("轮询超时");
    await new Promise((res) => setTimeout(res, 400));
  }
}
async function runPrisma(code) {
  const script = `import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: "file:D:/picture/.lpvault/lpvault.db" } } });
await (async () => { ${code} })();
await db.$disconnect();
`;
  fs.writeFileSync("prisma-tmp.mjs", script);
  execSync(`"${process.execPath}" prisma-tmp.mjs`, { cwd: process.cwd(), stdio: "pipe" });
  fs.unlinkSync("prisma-tmp.mjs");
}

async function main() {
  // 登录 + 清场（照片/标签/相册/备份记录）
  await req("POST", "/api/auth", { password: PW });
  for (const t of ["", "&trash=1"]) {
    const all = await req("GET", `/api/photos?pageSize=100${t}`);
    for (const p of all.json?.items ?? []) {
      await req("DELETE", `/api/photos/${p.id}`);
      await req("DELETE", `/api/trash?id=${p.id}`);
    }
  }
  await runPrisma(`await db.backupRecord.deleteMany({}); await db.setting.deleteMany({ where: { key: { in: ["lastBackupAt","lastRemindShownAt","backupIntervalDays","backupRemindDisabled"] } } });`);

  // 准备 3 张照片
  const p1 = await makePhoto("备份A.jpg", { r: 200, g: 30, b: 30 });
  const p2 = await makePhoto("备份B.jpg", { r: 30, g: 200, b: 30 });
  const p3 = await makePhoto("备份C.jpg", { r: 30, g: 30, b: 200 });
  // 大文件用于暂停/继续/取消测试（要足够大，否则备份瞬间完成）
  const bigBuf = Buffer.concat([Buffer.from("BIGJPG"), crypto.randomBytes(150 * 1024 * 1024)]);
  const bigInit = await req("POST", "/api/photos/upload/init", { fileName: "大文件_暂停测试.jpg", size: bigBuf.length });
  await fetch(BASE + `/api/photos/upload/chunk?uploadId=${bigInit.json.uploadId}&index=0`, {
    method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/octet-stream" }, body: bigBuf,
  });
  await req("POST", "/api/photos/upload/finalize", { uploadId: bigInit.json.uploadId });

  // ===== 1. 全量备份 =====
  const start = await req("POST", "/api/backup/start", { targetDir: BACKUP_DIR }, { "X-LPV-Desktop": await ensureToken() });
  check("启动备份（桌面令牌）", start.status === 200, JSON.stringify(start.json?.error ?? ""));
  const jobId = start.json.jobId;
  const prog = await poll(`/api/backup/progress?jobId=${jobId}`);
  check("备份完成", prog.state === "finished", prog.error ?? "");
  const archivePath = path.join(BACKUP_DIR, prog.fileName);
  check("归档文件存在且无 .part 残留", fs.existsSync(archivePath) && !fs.existsSync(archivePath + ".part"));
  check("归档哈希与记录一致", sha256(archivePath) === prog.archiveSha256);
  const settings1 = (await req("GET", "/api/backup/settings")).json;
  check("备份记录已入库（历史可查）", settings1.records.length === 1 && settings1.records[0].status === "success");
  check("lastBackupAt 已写入（提醒基准）", settings1.lastBackupAt !== null);

  // ===== 2. 归档内容完整性：解包比对原图与 manifest =====
  fs.rmSync("C:/LPV_Extract_Test", { recursive: true, force: true });
  fs.mkdirSync("C:/LPV_Extract_Test", { recursive: true });
  {
    const tar = await import("tar");
    await tar.x({ f: archivePath, cwd: "C:/LPV_Extract_Test" });
  }
  const manifest = JSON.parse(fs.readFileSync("C:/LPV_Extract_Test/manifest.json", "utf-8"));
  check("manifest 包含 4 张照片清单", manifest.photos.length === 4, `photos=${manifest.photos.length}`);
  check("manifest 含数据库快照哈希", /^[a-f0-9]{64}$/.test(manifest.db.sha256));
  const m1 = manifest.photos.find((x) => x.storedName.includes("备份A.jpg"));
  check("manifest 哈希与解包后文件一致", m1 && sha256(path.join("C:/LPV_Extract_Test/photos", m1.storedName.replace(/\\/g, "/"))) === m1.sha256);
  check("DB 快照解包成功", fs.existsSync("C:/LPV_Extract_Test/db/lpvault.db") && fs.statSync("C:/LPV_Extract_Test/db/lpvault.db").size > 0);

  // ===== 3. 取消：不留半成品（150MB 备份需要数秒，来得及取消） =====
  const cancelStart = await req("POST", "/api/backup/start", { targetDir: BACKUP_DIR }, { "X-LPV-Desktop": await ensureToken() });
  await new Promise((r) => setTimeout(r, 600)); // 等进入大文件复制阶段
  await req("POST", "/api/backup/control", { jobId: cancelStart.json.jobId, op: "cancel" }, { "X-LPV-Desktop": await ensureToken() });
  const cancelProg = await poll(`/api/backup/progress?jobId=${cancelStart.json.jobId}`);
  await new Promise((r) => setTimeout(r, 1500)); // 等 destroy 释放句柄
  check("取消备份：状态 canceled 且无半成品", cancelProg.state === "canceled" && !fs.existsSync(path.join(BACKUP_DIR, cancelProg.fileName + ".part")));

  // ===== 4. 暂停/继续（大文件导入中暂停） =====
  const pauseStart = await req("POST", "/api/backup/start", { targetDir: BACKUP_DIR }, { "X-LPV-Desktop": await ensureToken() });
  const pauseId = pauseStart.json.jobId;
  await req("POST", "/api/backup/control", { jobId: pauseId, op: "pause" }, { "X-LPV-Desktop": await ensureToken() });
  const pausedProg = (await req("GET", `/api/backup/progress?jobId=${pauseId}`)).json;
  check("备份可暂停", pausedProg.state === "paused");
  await req("POST", "/api/backup/control", { jobId: pauseId, op: "resume" }, { "X-LPV-Desktop": await ensureToken() });
  const resumedProg = await poll(`/api/backup/progress?jobId=${pauseId}`);
  check("继续后备份完成", resumedProg.state === "finished");

  // ===== 5. 提醒：40 天前备份 → due =====
  await runPrisma(`await db.setting.update({ where: { key: "lastBackupAt" }, data: { value: new Date(Date.now() - 40 * 86400000).toISOString() } });`);
  const remind = (await req("GET", "/api/backup/remind")).json;
  check("提醒计算：40 天前备份 → due=true 且天数正确", remind.due === true && remind.daysSinceBackup === 40, JSON.stringify(remind));
  await runPrisma(`await db.setting.update({ where: { key: "lastBackupAt" }, data: { value: new Date().toISOString() } });`);
  const remind2 = (await req("GET", "/api/backup/remind")).json;
  check("刚备份后不再提醒", remind2.due === false);

  // ===== 6. 合并去重恢复：删除 1 条记录+文件后恢复 =====
  const p1Row = (await req("GET", `/api/photos/${p1}`)).json;
  await req("DELETE", `/api/photos/${p1}`);
  await req("DELETE", `/api/trash?id=${p1}`); // 彻底删除
  check("前置：p1 记录与文件已删除", !fs.existsSync(path.join("D:/picture", p1Row.storedName)));
  const rStart = await req("POST", "/api/backup/restore/start", { archivePath, mode: "merge" }, { "X-LPV-Desktop": await ensureToken() });
  const rProg = await poll(`/api/backup/restore/progress?jobId=${rStart.json.jobId}`);
  check("合并恢复完成", rProg.state === "finished", rProg.error ?? "");
  const p1Back = await req("GET", `/api/photos/${p1}`);
  check("合并恢复：已删记录回到库中", p1Back.status === 200);
  check("合并恢复：原图文件回到原位且哈希一致", fs.existsSync(path.join("D:/picture", p1Row.storedName)) && sha256(path.join("D:/picture", p1Row.storedName)) === manifest.photos.find((x) => x.storedName === p1Row.storedName)?.sha256);

  // ===== 7. 篡改检测：翻转归档中部（大文件数据区）一个字节 → 覆盖模式恢复必失败并回滚 =====
  const tampered = path.join(BACKUP_DIR, "tampered.lpvbackup");
  const srcBuf = Buffer.from(fs.readFileSync(archivePath));
  srcBuf[Math.floor(srcBuf.length * 0.4)] ^= 0xff;
  fs.writeFileSync(tampered, srcBuf);
  const tStart = await req("POST", "/api/backup/restore/start", { archivePath: tampered, mode: "overwrite" }, { "X-LPV-Desktop": await ensureToken() });
  const tProg = await poll(`/api/backup/restore/progress?jobId=${tStart.json.jobId}`);
  console.log("  [debug] tProg:", JSON.stringify({state: tProg.state, error: tProg.error, summary: tProg.summary})); console.log("  [debug] tProg:", JSON.stringify({state: tProg.state, error: tProg.error, summary: tProg.summary})); check("篡改归档被检测：恢复失败", tProg.state === "failed", (tProg.error ?? "").slice(0, 60));
  const photoCountAfterTamper = (await req("GET", "/api/photos?pageSize=100")).json.total;
  check("失败后数据完好（回滚生效）", photoCountAfterTamper === 4, `photos=${photoCountAfterTamper}`);
  fs.rmSync(tampered, { force: true });

  // ===== 8. 全量覆盖恢复：先毁库再恢复 =====
  await req("DELETE", `/api/photos/${p1}`);
  await req("DELETE", `/api/photos/${p2}`);
  await req("DELETE", `/api/photos/${p3}`);
  for (const id of [p1, p2, p3]) await req("DELETE", `/api/trash?id=${id}`);
  const beforeOverwrite = (await req("GET", "/api/photos?pageSize=100")).json.total;
  const oStart = await req("POST", "/api/backup/restore/start", { archivePath, mode: "overwrite" }, { "X-LPV-Desktop": await ensureToken() });
  const oProg = await poll(`/api/backup/restore/progress?jobId=${oStart.json.jobId}`);
  check("全量覆盖恢复完成", oProg.state === "finished", oProg.error ?? "");
  const afterOverwrite = (await req("GET", "/api/photos?pageSize=100")).json;
  check("覆盖恢复后 4 张照片全部回归", afterOverwrite.total === 4, `total=${afterOverwrite.total}`);
  void beforeOverwrite;

  // ===== 9. 恢复到新照片根目录 =====
  const NEW_ROOT = "D:/LPV_NewRoot_Test";
  const nStart = await req("POST", "/api/backup/restore/start", { archivePath, mode: "merge", newPhotoRoot: NEW_ROOT }, { "X-LPV-Desktop": await ensureToken() });
  const nProg = await poll(`/api/backup/restore/progress?jobId=${nStart.json.jobId}`);
  check("指定新根目录恢复完成", nProg.state === "finished", nProg.error ?? "");
  const newRootCfg = JSON.parse(fs.readFileSync(".lpvault-boot.json", "utf-8"));
  check("照片根目录已切换到新位置", newRootCfg.photoRoot === path.resolve(NEW_ROOT), newRootCfg.photoRoot);
  const filesInNewRoot = (function walk(d, acc = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, acc);
      else acc.push(f);
    }
    return acc;
  })(NEW_ROOT).filter((f) => !f.includes(".lpvault"));
  check("原图文件已写入新根目录（YYYY\\MM 结构）", filesInNewRoot.length >= 4, `files=${filesInNewRoot.length}`);

  // ===== 10. 恢复原根目录（用覆盖模式再恢复一次，newPhotoRoot=D:\picture） =====
  const back = await req("POST", "/api/backup/restore/start", { archivePath, mode: "overwrite", newPhotoRoot: "D:\\picture" }, { "X-LPV-Desktop": await ensureToken() });
  await poll(`/api/backup/restore/progress?jobId=${back.json.jobId}`);
  const backCfg = JSON.parse(fs.readFileSync(".lpvault-boot.json", "utf-8"));
  check("照片根目录切回 D:\\picture", backCfg.photoRoot === "D:\\picture");
  // 清理临时目录
  fs.rmSync("C:/LPV_Extract_Test", { recursive: true, force: true });
  fs.rmSync(NEW_ROOT, { recursive: true, force: true });

  // ===== 11. 设置页与提醒横幅接口 =====
  const settingsPage = await fetch(BASE + "/settings", { headers: { Cookie: cookie }, redirect: "manual" });
  check("设置页（含备份面板）可打开", settingsPage.status === 200);
  const remindApi = await req("GET", "/api/backup/remind");
  check("提醒接口返回结构完整", remindApi.status === 200 && typeof remindApi.json.due === "boolean" && remindApi.json.intervalDays >= 1);

  const pass = results.filter(Boolean).length;
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(2);
});
