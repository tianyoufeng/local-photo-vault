import crypto from "node:crypto";
import { chromium } from "playwright-core";
const BASE = "http://127.0.0.1:8787";
const results = [];
const check = (n, ok, d = "") => { results.push(ok); console.log((ok ? "PASS  " : "FAIL  ") + n + (d ? " | " + d : "")); };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
async function getCookie() {
  const r = await fetch(BASE + "/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-1234" }) });
  return r.headers.get("set-cookie").split(";")[0];
}
await page.goto(BASE + "/login");
await page.fill("#password", "test-1234");
await page.click("button:has-text('登录')");
await page.waitForURL(BASE + "/");
await page.waitForLoadState("networkidle");
const ck = await getCookie();
await page.evaluate(async () => {
  const h = { Cookie: document.cookie, "Content-Type": "application/json" };
  for (const t of ["", "&trash=1"]) {
    const list = await (await fetch("/api/photos?pageSize=100" + t, { headers: h })).json();
    for (const p of list.items ?? []) {
      await fetch("/api/photos/" + p.id, { method: "DELETE", headers: h });
      await fetch("/api/trash?id=" + p.id, { method: "DELETE", headers: h });
    }
  }
  for (const a of (await (await fetch("/api/albums", { headers: h })).json()).albums ?? [])
    await fetch("/api/albums/" + a.id, { method: "DELETE", headers: h });
});
// 上传一张无 EXIF 的照片（takenAt 应为 null）+ 一张带拍摄时间的
const bufA = Buffer.concat([Buffer.from([255, 216, 255, 1]), crypto.randomBytes(400)]);
const initA = await (await fetch(BASE + "/api/photos/upload/init", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ fileName: "无EXIF照片.jpg", size: bufA.length }) })).json();
await fetch(BASE + "/api/photos/upload/chunk?uploadId=" + initA.uploadId + "&index=0", { method: "PUT", headers: { Cookie: ck }, body: bufA });
const finA = await (await fetch(BASE + "/api/photos/upload/finalize", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ uploadId: initA.uploadId }) })).json();
const idA = finA.photo.id;
check("无 EXIF 照片的 takenAt 为 null（不再用上传时间冒充）", finA.photo.takenAt === null, "takenAt=" + finA.photo.takenAt);
// 建相册并加入
await fetch(BASE + "/api/albums", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ name: "归属测试" }) });
const alb = (await (await fetch(BASE + "/api/albums", { headers: { Cookie: ck } })).json()).albums.find(a => a.name === "归属测试");
await fetch(BASE + "/api/albums/" + alb.id + "/photos", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ photoIds: [idA] }) });
// 详情页 UI
await page.goto(BASE + "/photo/" + idA);
await page.waitForLoadState("networkidle");
const text = await page.evaluate(() => document.body.innerText);
check("详情页显示「上传时间」行", text.includes("上传时间"));
check("无 EXIF 时拍摄时间如实显示 —", /拍摄时间\n—/.test(text) || text.includes("（无 EXIF 拍摄时间）"));
check("详情页显示归属相册「归属测试」", text.includes("归属测试") && text.includes("归属相册"));
// 列表卡片日期回退上传时间
const listHtml = await (await fetch(BASE + "/api/photos?pageSize=100", { headers: { Cookie: ck } })).json();
check("列表接口返回 createdAt", listHtml.items.every(p => typeof p.createdAt === "string"));
await browser.close();
const pass = results.filter(Boolean).length;
console.log("===== 结果: " + pass + "/" + results.length + " 通过 =====");
process.exit(pass === results.length ? 0 : 1);
