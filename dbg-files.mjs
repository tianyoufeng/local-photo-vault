import { chromium } from "playwright-core";
import path from "node:path";
const BASE = "http://127.0.0.1:8787";
const F = "C:/Users/q2764/WorkBuddy/2026-09-20-17-32-59/LocalPhotoVault/.accept-files";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
await page.goto(BASE + "/login");
await page.fill("#password", "test-1234");
await page.click("button:has-text('登录')");
await page.waitForURL(BASE + "/");
// 在页面里挂一个探针：记录 onChange 时的 files.length
await page.evaluate(() => {
  const input = document.querySelector("input[accept]");
  input.addEventListener("change", (e) => {
    window.__fl = e.target.files.length;
    console.log("PROBE files.length =", e.target.files.length);
  }, true);
});
await page.setInputFiles("input[accept]", [
  path.join(F, "雪山_2024a.jpg"),
  path.join(F, "晚霞_2024b.jpg"),
  path.join(F, "巷子_2023c.jpg"),
  path.join(F, "DSC_20240701.CR2"),
]);
await page.waitForTimeout(2000);
console.log("probe captured:", await page.evaluate(() => window.__fl));
const logs = [];
page.on("console", (m) => logs.push(m.text()));
await browser.close();
