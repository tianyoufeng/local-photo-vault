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

// 登录 + 清场
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

// 上传 4 张

const colors = [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 }];
for (let i = 0; i < colors.length; i++) {
  const buf = Buffer.concat([Buffer.from([255,216,255]), crypto.randomBytes(500)]);
  const init = await (await fetch(BASE + "/api/photos/upload/init", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ fileName: "移动测试" + (i + 1) + ".jpg", size: buf.length }) })).json();
  await fetch(BASE + "/api/photos/upload/chunk?uploadId=" + init.uploadId + "&index=0", { method: "PUT", headers: { Cookie: ck }, body: buf });
  await fetch(BASE + "/api/photos/upload/finalize", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ uploadId: init.uploadId }) });
}

// 建两个相册：相册甲（放入前 2 张）、相册乙（移动目标）
for (const name of ["相册甲", "相册乙"]) {
  await fetch(BASE + "/api/albums", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ name }) });
}
const albums = (await (await fetch(BASE + "/api/albums", { headers: { Cookie: ck } })).json()).albums;
const jia = albums.find(a => a.name === "相册甲");
const yi = albums.find(a => a.name === "相册乙");
const ids = (await (await fetch(BASE + "/api/photos?pageSize=100", { headers: { Cookie: ck } })).json()).items.map(p => p.id);
for (const id of ids.slice(0, 2)) {
  await fetch(BASE + "/api/albums/" + jia.id + "/photos", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ photoIds: [id] }) });
}

// ===== 浏览器操作：进入 相册甲 视图 → 多选 → 选 2 张 → 移动到 相册乙 =====
await page.goto(BASE + "/?album=" + encodeURIComponent("相册甲"));
await page.waitForLoadState("networkidle");
await page.click("button:has-text('多选')");
await page.waitForTimeout(300);
const cards = await page.locator("main .grid button").count();
check("相册甲视图下有 2 张照片可选", cards === 2, "cards=" + cards);
await page.locator("main .grid button").nth(0).click();
await page.locator("main .grid button").nth(1).click();
const selText = await page.evaluate(() => document.body.innerText);
const selMatch = selText.match(/已选 (\d+) 张/);
check("多选选中 2 张", selMatch && selMatch[1] === "2", "selected=" + (selMatch ? selMatch[1] : "?"));
// 移动到相册乙（相册视图下工具条第一个下拉 = 移动到相册…）
await page.locator("select").filter({ hasText: "移动到相册…" }).selectOption({ label: "相册乙" });
await page.waitForTimeout(1500);
const exited = await page.evaluate(() => !document.body.innerText.includes("已选"));
check("操作完成后自动退出多选", exited);
const jiaCount = (await (await fetch(BASE + "/api/photos?album=相册甲", { headers: { Cookie: ck } })).json()).total;
check("相册甲已无照片（被移走）", jiaCount === 0, "count=" + jiaCount);
const yiCount = (await (await fetch(BASE + "/api/photos?album=相册乙", { headers: { Cookie: ck } })).json()).total;
check("相册乙有 2 张（移动目标）", yiCount === 2, "count=" + yiCount);
const totalPhotos = (await (await fetch(BASE + "/api/photos?pageSize=100", { headers: { Cookie: ck } })).json()).total;
check("照片本体仍在图库（4 张）", totalPhotos === 4, "total=" + totalPhotos);

// ===== 复制到相册：全库视图 → 多选 2 张 → 复制到 相册甲 =====
await page.goto(BASE + "/");
await page.waitForLoadState("networkidle");
await page.click("button:has-text('多选')");
await page.waitForTimeout(300);
await page.locator("main .grid button").nth(0).click();
await page.locator("main .grid button").nth(1).click();
const copySelect = page.locator("select").filter({ hasText: "复制到相册…" });
await copySelect.selectOption({ label: "相册甲" });
await page.waitForTimeout(1500);
const exited2 = await page.evaluate(() => !document.body.innerText.includes("已选"));
check("复制操作后自动退出多选", exited2);
const jiaCount2 = (await (await fetch(BASE + "/api/photos?album=相册甲", { headers: { Cookie: ck } })).json()).total;
check("复制后相册甲有 2 张", jiaCount2 === 2, "count=" + jiaCount2);

await browser.close();
const pass = results.filter(Boolean).length;
console.log("===== 结果: " + pass + "/" + results.length + " 通过 =====");
process.exit(pass === results.length ? 0 : 1);
