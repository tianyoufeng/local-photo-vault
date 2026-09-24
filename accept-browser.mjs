// LocalPhotoVault 阶段二浏览器验收（playwright-core + 系统 Edge）
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8787";
const PW = "test-1234";
const FILES_DIR = "C:/Users/q2764/WorkBuddy/2026-09-20-17-32-59/LocalPhotoVault/.accept-files";
const OUT_DIR = "C:/Users/q2764/WorkBuddy/2026-09-20-17-32-59/LocalPhotoVault/.accept-shots";
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
}
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  // ---- 1. 浏览器登录 ----
  await page.goto(BASE + "/login");
  await page.fill("#password", PW);
  await page.click("button:has-text('登录')");
  await page.waitForURL(BASE + "/");
  check("浏览器登录成功进入图库", page.url() === BASE + "/");

  // 清场：删掉库中已有照片（含回收站），保证顺序断言从零开始
  await page.evaluate(async () => {
    const h = { Cookie: document.cookie };
    for (const t of ["", "&trash=1"]) {
      const list = await (await fetch(`/api/photos?pageSize=100${t}`, { headers: h })).json();
      for (const p of list.items ?? []) {
        await fetch(`/api/photos/${p.id}`, { method: "DELETE", headers: h });
        await fetch(`/api/trash?id=${p.id}`, { method: "DELETE", headers: h });
      }
    }
  });

  // ---- 2. 通过页面控件上传 4 张（3 EXIF JPEG + 1 RAW）----
  const files = [
    path.join(FILES_DIR, "雪山_2024a.jpg"),
    path.join(FILES_DIR, "晚霞_2024b.jpg"),
    path.join(FILES_DIR, "巷子_2023c.jpg"),
    path.join(FILES_DIR, "DSC_20240701.CR2"),
  ];
  await page.setInputFiles("input[accept]", files);
  // 等待导入完成提示出现
  await page.waitForFunction(
    () => document.body.innerText.includes("导入完成"),
    null,
    { timeout: 120_000 }
  );
  const msg = await page.evaluate(() =>
    (document.body.innerText.match(/导入完成[^\n]*/) ?? [""])[0]
  );
  check("页面上传 4 张照片全部成功", msg.includes("成功 4"), msg);

  // 等网格刷新完成
  await page.waitForFunction(
    () => document.querySelectorAll("main .grid a").length >= 4,
    null,
    { timeout: 30_000 }
  );

  // ---- 3. 图库按拍摄时间倒序 ----
  const ordered = await page.evaluate(() =>
    [...document.querySelectorAll("main .grid a")].map((a) => ({
      href: a.getAttribute("href"),
      name: a.querySelector("p")?.textContent ?? "",
      date: a.querySelectorAll("p")[1]?.textContent ?? "",
    }))
  );
  const names = ordered.map((o) => o.name);
  const expected = ["DSC_20240701.CR2", "晚霞_2024b.jpg", "雪山_2024a.jpg", "巷子_2023c.jpg"];
  // RAW 无 EXIF → 回退文件修改时间（今天），应排最前
  check(
    "图库按拍摄时间倒序展示",
    names.length >= 4 && expected.every((n, i) => names[i] === n),
    JSON.stringify(names.slice(0, 4))
  );
  await page.screenshot({ path: path.join(OUT_DIR, "gallery.png"), fullPage: false });

  // ---- 4. 详情页：大图 + EXIF + 下载原图（晚霞_2024b） ----
  const sunsetHref = ordered.find((o) => o.name === "晚霞_2024b.jpg")?.href;
  await page.goto(BASE + sunsetHref);
  await page.waitForLoadState("networkidle");
  const previewVisible = await page.locator("main img").first().isVisible();
  const imgSrc = await page.locator("main img").first().getAttribute("src");
  check("详情页预览图可见（原图流）", previewVisible && imgSrc.includes("/original"), imgSrc);
  const detailText = await page.evaluate(() => document.body.innerText);
  check(
    "详情页 EXIF 面板完整",
    detailText.includes("Fujifilm X-T5") &&
      detailText.includes("XF56mmF1.2") &&
      detailText.includes("f/1.2") &&
      detailText.includes("1/250") &&
      detailText.includes("400") &&
      detailText.includes("56mm") &&
      detailText.includes("640 × 480"),
    "相机/镜头/光圈/快门/ISO/焦距/尺寸"
  );
  await page.screenshot({ path: path.join(OUT_DIR, "detail.png"), fullPage: true });

  // 下载原图（浏览器下载事件），校验哈希与源文件一致
  const srcSha = sha256(path.join(FILES_DIR, "晚霞_2024b.jpg"));
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.click("a:has-text('下载原图')"),
  ]);
  const dlPath = path.join(OUT_DIR, "downloaded_晚霞.jpg");
  await download.saveAs(dlPath);
  check("原图下载 SHA-256 与源文件一致", sha256(dlPath) === srcSha);
  fs.unlinkSync(dlPath);

  // ---- 5. RAW 详情：占位图 + RAW 原图可下载 ----
  const rawHref = ordered.find((o) => o.name === "DSC_20240701.CR2")?.href;
  await page.goto(BASE + rawHref);
  await page.waitForLoadState("networkidle");
  const rawImgSrc = await page.locator("main img").first().getAttribute("src");
  check("RAW 详情页降级为占位图（缩略图）", rawImgSrc.includes("/thumbnail"), rawImgSrc);
  const rawSha = sha256(path.join(FILES_DIR, "DSC_20240701.CR2"));
  const [rawDl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.click("a:has-text('下载原图')"),
  ]);
  const rawDlPath = path.join(OUT_DIR, "downloaded_raw.CR2");
  await rawDl.saveAs(rawDlPath);
  check("RAW 原图可下载且二进制一致", sha256(rawDlPath) === rawSha);
  fs.unlinkSync(rawDlPath);

  // ---- 6. 搜索与筛选（浏览器操作）----
  await page.goto(BASE + "/");
  await page.waitForLoadState("networkidle");
  await page.fill("input[placeholder='搜索…']", "晚霞");
  await page.waitForFunction(
    () => {
      const links = [...document.querySelectorAll("main .grid a")];
      return links.length > 0 && links.every((a) => (a.querySelector("p")?.textContent ?? "").includes("晚霞"));
    },
    null,
    { timeout: 15_000 }
  );
  const searchCount = await page.evaluate(() => document.querySelectorAll("main .grid a").length);
  check("搜索：关键词过滤生效", searchCount === 1, `结果 ${searchCount} 条`);

  // 评分筛选：先给晚霞打 4 星
  await page.goto(BASE + sunsetHref);
  await page.waitForLoadState("networkidle");
  await page.click("button:has-text('★') >> nth=3"); // 第4颗星
  await page.waitForTimeout(500);
  await page.goto(BASE + "/");
  await page.waitForLoadState("networkidle");
  await page.selectOption("select >> nth=3", "4");
  await page.waitForTimeout(800);
  const ratedCount = await page.evaluate(() => document.querySelectorAll("main .grid a").length);
  check("筛选：评分≥4 只剩打分的 1 张", ratedCount === 1, `结果 ${ratedCount} 条`);

  // ---- 7. 重复照片不重复占空间 ----
  const dupFile = path.join(FILES_DIR, "雪山_2024a_副本.jpg");
  fs.copyFileSync(path.join(FILES_DIR, "雪山_2024a.jpg"), dupFile);
  const dupeSrc = "D:/picture/2024/01/雪山_2024a.jpg";
  const sizeBefore = fs.existsSync(dupeSrc) ? fs.statSync(dupeSrc).size : -1;
  const dupRes = await fetch(BASE + "/api/photos/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: (await page.context().cookies())[0].name + "=" + (await page.context().cookies())[0].value },
    body: JSON.stringify({ fileName: "雪山_2024a_副本.jpg", size: fs.statSync(dupFile).size }),
  });
  const { uploadId } = await dupRes.json();
  await fetch(BASE + `/api/photos/upload/chunk?uploadId=${uploadId}&index=0`, {
    method: "PUT",
    headers: { Cookie: (await page.context().cookies())[0].name + "=" + (await page.context().cookies())[0].value },
    body: fs.readFileSync(dupFile),
  });
  const fin = await (
    await fetch(BASE + "/api/photos/upload/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: (await page.context().cookies())[0].name + "=" + (await page.context().cookies())[0].value },
      body: JSON.stringify({ uploadId }),
    })
  ).json();
  const sizeAfter = fs.existsSync(dupeSrc) ? fs.statSync(dupeSrc).size : -1;
  check(
    "重复照片：返回 duplicate 标记且复用已有原图（不重复占空间）",
    fin.duplicate === true && sizeBefore === sizeAfter && fin.photo.storedName.includes("雪山_2024a.jpg"),
    `duplicate=${fin.duplicate} newId=${fin.photo?.id} 存储名=${fin.photo?.storedName}`
  );
  fs.unlinkSync(dupFile);

  // ---- 8. 删除进回收站并恢复（浏览器操作）----
  await page.goto(BASE + sunsetHref);
  await page.waitForLoadState("networkidle");
  page.once("dialog", (d) => d.accept());
  await page.click("button:has-text('删除（移入回收站）')");
  await page.waitForURL(BASE + "/");
  await page.goto(BASE + "/trash");
  await page.waitForLoadState("networkidle");
  const inTrash = await page.evaluate(() => document.body.innerText.includes("晚霞_2024b.jpg"));
  check("删除后照片出现在回收站", inTrash);
  // 恢复
  const trashCards = await page.evaluate(() =>
    [...document.querySelectorAll("main .grid > div")].map((d) => d.textContent)
  );
  const idx = trashCards.findIndex((t) => t.includes("晚霞_2024b.jpg"));
  await page.click(`main .grid > div >> nth=${idx} >> button:has-text('恢复')`);
  await page.waitForTimeout(800);
  await page.goto(BASE + "/");
  await page.waitForLoadState("networkidle");
  const backHome = await page.evaluate(() => document.body.innerText.includes("晚霞_2024b.jpg"));
  check("从回收站恢复后回到图库", backHome);
  await page.screenshot({ path: path.join(OUT_DIR, "final-gallery.png") });
} catch (e) {
  check("流程异常中断", false, e.message);
  try {
    await page.screenshot({ path: path.join(OUT_DIR, "error.png") });
  } catch {}
} finally {
  await browser.close();
}

const pass = results.filter(Boolean).length;
console.log(`\n===== 浏览器验收: ${pass}/${results.length} 通过 =====`);
process.exit(pass === results.length ? 0 : 1);
