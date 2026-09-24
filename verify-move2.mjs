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
const colors = [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 }];
for (let i = 0; i < colors.length; i++) {
  const buf = Buffer.concat([Buffer.from([255, 216, 255, i]), crypto.randomBytes(300)]);
  const init = await (await fetch(BASE + "/api/photos/upload/init", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ fileName: "剪切测试" + (i + 1) + ".jpg", size: buf.length }) })).json();
  await fetch(BASE + "/api/photos/upload/chunk?uploadId=" + init.uploadId + "&index=0", { method: "PUT", headers: { Cookie: ck }, body: buf });
  await fetch(BASE + "/api/photos/upload/finalize", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ uploadId: init.uploadId }) });
}
for (const name of ["相册甲", "相册乙"]) {
  await fetch(BASE + "/api/albums", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ name }) });
}
const albums = (await (await fetch(BASE + "/api/albums", { headers: { Cookie: ck } })).json()).albums;
const jia = albums.find(a => a.name === "相册甲");
const yi = albums.find(a => a.name === "相册乙");
const ids = (await (await fetch(BASE + "/api/photos?pageSize=100", { headers: { Cookie: ck } })).json()).items.map(p => p.id);
// 前 3 张属于 相册甲（其中前 2 张还同时属于 相册乙，制造"多归属"场景）
for (const id of ids.slice(0, 3)) await fetch(BASE + "/api/albums/" + jia.id + "/photos", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ photoIds: [id] }) });
for (const id of ids.slice(0, 2)) await fetch(BASE + "/api/albums/" + yi.id + "/photos", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ photoIds: [id] }) });

// ===== 全库视图：多选第 1、2 张（同时在甲+乙）→ 移动到 相册乙 =====
// 期望：剪切语义 → 从甲移除，保留在乙；第 3 张仍在甲
await page.goto(BASE + "/");
await page.waitForLoadState("networkidle");
await page.click("button:has-text('多选')");
await page.waitForTimeout(300);
await page.locator("main .grid button").nth(0).click();
await page.locator("main .grid button").nth(1).click();
const moveSel = page.locator("select").filter({ hasText: "移动到相册…" });
const moveVisible = await moveSel.count();
check("全库视图下「移动到相册」可见", moveVisible === 1, "count=" + moveVisible);
await moveSel.selectOption({ label: "相册乙" });
await page.waitForTimeout(1500);
const exited = await page.evaluate(() => !document.body.innerText.includes("已选"));
check("操作完成后自动退出多选", exited);
const counts = {};
for (const name of ["相册甲", "相册乙"]) {
  counts[name] = (await (await fetch(BASE + "/api/photos?album=" + encodeURIComponent(name), { headers: { Cookie: ck } })).json()).total;
}
check("相册甲只剩 1 张（第 1、2 张被剪走）", counts["相册甲"] === 1, "count=" + counts["相册甲"]);
check("相册乙仍有 2 张（剪切目标不变）", counts["相册乙"] === 2, "count=" + counts["相册乙"]);
const totalPhotos = (await (await fetch(BASE + "/api/photos?pageSize=100", { headers: { Cookie: ck } })).json()).total;
check("照片本体仍在图库（4 张）", totalPhotos === 4, "total=" + totalPhotos);
await browser.close();
const pass = results.filter(Boolean).length;
console.log("===== 结果: " + pass + "/" + results.length + " 通过 =====");
process.exit(pass === results.length ? 0 : 1);
