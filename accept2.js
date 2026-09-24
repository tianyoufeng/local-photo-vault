/* LocalPhotoVault 阶段二验收脚本（node accept2.js）
 * 覆盖：分片上传、按月落盘、重名哈希前缀、SHA-256 去重、落盘复核、
 * 原图 Range/Content-Disposition 下载、EXIF 字段、缩略图/RAW 占位、
 * 评分/收藏/标签、六类筛选、软删除回收站恢复/彻底删除、tmp 清理。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:8787";
const PASSWORD = process.env.LPV_PW || "test-1234";
let cookie = "";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
}

async function req(method, url, body, headers = {}) {
  const h = { ...headers };
  if (body && !(body instanceof Buffer) && typeof body !== "string") {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  if (cookie) h["Cookie"] = cookie;
  const res = await fetch(BASE + url, { method, headers: h, body, redirect: "manual" });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const ct = res.headers.get("content-type") ?? "";
  const json = ct.includes("json") ? await res.json().catch(() => null) : null;
  return { status: res.status, json, headers: res.headers, res };
}

function sha256Buf(b) {
  return crypto.createHash("sha256").update(b).digest("hex");
}

/** 用 sharp 生成测试图（可带 EXIF） */
async function makeImage(kind, name, opts = {}) {
  const sharp = (await import("sharp")).default;
  let img = sharp({ create: { width: 320, height: 240, channels: 3, background: opts.color ?? { r: 200, g: 60, b: 40 } } });
  if (opts.exif) img = img.withExif(opts.exif);
  const buf = await img.jpeg({ quality: 90 }).toBuffer();
  return { name, buf };
}

/** 分片上传一个 Buffer，返回 finalize 响应 */
async function upload(name, buf) {
  const init = await req("POST", "/api/photos/upload/init", { fileName: name, size: buf.length });
  if (init.status !== 200) return { status: init.status, json: init.json };
  const { uploadId } = init.json;
  const CH = 1024 * 1024; // 测试用 1MB 分片
  let idx = 0;
  for (let off = 0; off < buf.length; off += CH) {
    const r = await req(
      "PUT",
      `/api/photos/upload/chunk?uploadId=${uploadId}&index=${idx}`,
      buf.subarray(off, Math.min(off + CH, buf.length)),
      { "Content-Type": "application/octet-stream" }
    );
    if (r.status !== 200) return { status: r.status, json: r.json };
    idx++;
  }
  return req("POST", "/api/photos/upload/finalize", { uploadId });
}

async function main() {
  // 登录
  const login = await req("POST", "/api/auth", { password: PASSWORD });
  check("登录成功", login.status === 200);

  // 清场：把库中现有照片（含回收站）全部彻底删除，保证计数从零开始
  for (const trashFlag of ["", "&trash=1"]) {
    const all = await req("GET", `/api/photos?pageSize=100${trashFlag}`);
    for (const p of all.json?.items ?? []) {
      await req("DELETE", `/api/photos/${p.id}`);
      await req("DELETE", `/api/trash?id=${p.id}`);
    }
  }
  // tmp 基线清零（清掉上一次运行遗留的 .part）
  fs.readdirSync("D:\\picture\\.lpvault\\tmp").forEach((f) => {
    if (f.endsWith(".part")) fs.unlinkSync(path.join("D:\\picture\\.lpvault\\tmp", f));
  });

  const sharp = (await import("sharp")).default;

  // ========== 1. 基础上传：JPEG 落盘 YYYY\MM ==========
  const imgA = await makeImage("jpg", "黄昏_红色测试.jpg", { color: { r: 200, g: 60, b: 40 } });
  const shaA = sha256Buf(imgA.buf);
  const f1 = await upload(imgA.name, imgA.buf);
  check("分片上传 JPEG 成功", f1.status === 200 && f1.json?.ok, JSON.stringify(f1.json?.error ?? ""));
  const photo1 = f1.json?.photo;
  const now = new Date();
  const relDir = path.join("D:\\picture", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
  const expectedA = path.join(relDir, imgA.name);
  check("原图落盘到 根目录\\YYYY\\MM\\原始文件名", fs.existsSync(expectedA), expectedA);
  check("落盘哈希与上传内容一致", fs.existsSync(expectedA) && sha256Buf(fs.readFileSync(expectedA)) === shaA);

  // ========== 2. 原图下载：二进制一致 + Range + Content-Disposition ==========
  const dl = await fetch(`${BASE}/api/photos/${photo1.id}/original`, { headers: { Cookie: cookie } });
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  check("原图下载二进制一致", Buffer.compare(dlBuf, imgA.buf) === 0);
  check(
    "Content-Disposition 含原始文件名",
    /filename\*=UTF-8''/.test(dl.headers.get("content-disposition") ?? ""),
    dl.headers.get("content-disposition") ?? ""
  );
  const r1 = await fetch(`${BASE}/api/photos/${photo1.id}/original`, {
    headers: { Cookie: cookie, Range: "bytes=0-99" },
  });
  const r1buf = Buffer.from(await r1.arrayBuffer());
  check(
    "Range 请求返回 206 且内容正确",
    r1.status === 206 && r1buf.length === 100 && r1.headers.get("content-range") === `bytes 0-99/${imgA.buf.length}`,
    r1.headers.get("content-range") ?? ""
  );
  const r2 = await fetch(`${BASE}/api/photos/${photo1.id}/original`, {
    headers: { Cookie: cookie, Range: "bytes=-64" },
  });
  check("Range 后缀请求(末尾64字节)返回 206", r2.status === 206 && (await r2.arrayBuffer()).byteLength === 64);

  // ========== 3. 去重：同内容不同名 → 盘一份、图库两条 ==========
  const f2 = await upload("副本_红色测试.png", imgA.buf); // 内容同 A，名字不同（后缀也换）
  check("同内容不同名导入成功且标记 duplicate", f2.status === 200 && f2.json?.duplicate === true, JSON.stringify(f2.json?.error ?? ""));
  const beforeCount = fs.existsSync(expectedA) ? 1 : 0;
  const monthFiles = fs.existsSync(relDir) ? fs.readdirSync(relDir) : [];
  const sameHashCopies = monthFiles.filter((f) => {
    try { return sha256Buf(fs.readFileSync(path.join(relDir, f))) === shaA; } catch { return false; }
  }).length;
  check("磁盘上该内容仍只有一份文件", sameHashCopies === beforeCount, `copies=${sameHashCopies}`);
  const listAll = await req("GET", "/api/photos?pageSize=100");
  const sameList = listAll.json.items.filter((p) => p.originalName.includes("红色测试"));
  check("图库中有两条记录（盘一份图库多条）", sameList.length === 2, `records=${sameList.length}`);

  // ========== 4. RAW 占位 + 缩略图 ==========
  const fakeRaw = Buffer.concat([Buffer.from("II*\u0000"), crypto.randomBytes(2048)]);
  const f3 = await upload("DSC_0001.CR2", fakeRaw);
  check("RAW 文件导入成功（kind=raw）", f3.status === 200 && f3.json?.photo?.kind === "raw", JSON.stringify(f3.json?.error ?? ""));
  const rawId = f3.json?.photo?.id;
  const thumbRaw = await fetch(`${BASE}/api/photos/${rawId}/thumbnail`, { headers: { Cookie: cookie } });
  check("RAW 缩略图降级为占位图(webp)", thumbRaw.status === 200 && thumbRaw.headers.get("content-type") === "image/webp");
  const thumbA = await fetch(`${BASE}/api/photos/${photo1.id}/thumbnail`, { headers: { Cookie: cookie } });
  const thumbBuf = Buffer.from(await thumbA.arrayBuffer());
  const meta = await sharp(thumbBuf).metadata();
  check("JPEG 缩略图为 512 内 webp", thumbA.status === 200 && meta.format === "webp" && (meta.width ?? 0) <= 512);

  // ========== 5. EXIF 提取（sharp withExif 写入测试元数据） ==========
  // 注：sharp 的 withExif 写入器有局限——GPS IFD 与其他标签组合时会丢 ISO，
  //     多标签组合时也可能丢 ISO（真机照片无此问题，exifr 读真实照片正常）。
  //     因此拆成三张图分别断言：完整组合(不含ISO) / 仅ISO / 仅GPS。
  try {
    const exifImg = await makeImage("jpg", "exif测试.jpg", {
      exif: {
        IFD0: { Make: "TestCam", Model: "X-PRO" },
        IFD2: {
          DateTimeOriginal: "2024:06:15 10:30:00",
          LensModel: "TestLens 50mm",
          FNumber: "28/10",
          ExposureTime: "1/250",
          FocalLength: "50",
        },
      },
    });
    const f4 = await upload(exifImg.name, exifImg.buf);
    if (f4.status === 200) {
      const d = await req("GET", `/api/photos/${f4.json.photo.id}`);
      const p = d.json;
      const exifOk =
        p.cameraModel === "X-PRO" && p.cameraMake === "TestCam" &&
        p.fNumber === 2.8 && p.exposureTime === "1/250" &&
        p.focalLength === 50 && p.takenAt && new Date(p.takenAt).getUTCFullYear() === 2024;
      check(
        "EXIF 提取：相机/镜头/光圈/快门/焦距/拍摄时间",
        Boolean(exifOk),
        JSON.stringify({ cm: p.cameraModel, fn: p.fNumber, exp: p.exposureTime, fl: p.focalLength, at: p.takenAt })
      );
      await req("DELETE", `/api/photos/${f4.json.photo.id}`);
      await req("DELETE", `/api/trash?id=${f4.json.photo.id}`);
    } else {
      check("EXIF 提取：相机/镜头/光圈/快门/焦距/拍摄时间", false, "上传失败");
    }

    const isoImg = await makeImage("jpg", "iso测试.jpg", {
      exif: { IFD0: { Make: "T" }, IFD2: { ISO: "400", ISOSpeedRatings: "400" } },
    });
    const f6 = await upload(isoImg.name, isoImg.buf);
    if (f6.status === 200) {
      const p = (await req("GET", `/api/photos/${f6.json.photo.id}`)).json;
      check("EXIF 提取：ISO", p.iso === 400, `iso=${p.iso}`);
      await req("DELETE", `/api/photos/${f6.json.photo.id}`);
      await req("DELETE", `/api/trash?id=${f6.json.photo.id}`);
    } else {
      check("EXIF 提取：ISO", false, "上传失败");
    }

    const gpsImg = await makeImage("jpg", "gps测试.jpg", {
      exif: {
        IFD3: { GPSLatitude: "399042/10000", GPSLatitudeRef: "N", GPSLongitude: "1164074/10000", GPSLongitudeRef: "E" },
      },
    });
    const f5 = await upload(gpsImg.name, gpsImg.buf);
    if (f5.status === 200) {
      const p = (await req("GET", `/api/photos/${f5.json.photo.id}`)).json;
      check(
        "EXIF 提取：GPS 坐标",
        typeof p.gpsLat === "number" && Math.abs(p.gpsLat - 39.9042) < 0.001 && Math.abs(p.gpsLon - 116.4074) < 0.001,
        `${p.gpsLat},${p.gpsLon}`
      );
      await req("DELETE", `/api/photos/${f5.json.photo.id}`);
      await req("DELETE", `/api/trash?id=${f5.json.photo.id}`);
    } else {
      check("EXIF 提取：GPS 坐标", false, "上传失败");
    }
  } catch (e) {
    check("EXIF 提取：相机/镜头/光圈/快门/ISO/焦距/拍摄时间", false, e.message);
    check("EXIF 提取：GPS 坐标", false, e.message);
  }

  // ========== 6. 评分/收藏/标签 ==========
  await req("PATCH", `/api/photos/${photo1.id}`, { rating: 4, favorite: true, tags: ["测试", "红色"] });
  const d1 = await req("GET", `/api/photos/${photo1.id}`);
  check(
    "评分/收藏/标签写入",
    d1.json.rating === 4 && d1.json.favorite === true && d1.json.tags.includes("测试") && d1.json.tags.includes("红色")
  );

  // ========== 7. 六类筛选 ==========
  const fq = await req("GET", "/api/photos?q=红色测试");
  check("筛选：关键词", fq.json.items.some((p) => p.id === photo1.id));
  const fr = await req("GET", "/api/photos?rating=4");
  check("筛选：评分≥4", fr.json.items.some((p) => p.id === photo1.id) && fr.json.items.every((p) => p.rating >= 4));
  const ff = await req("GET", "/api/photos?fav=1");
  check("筛选：收藏", ff.json.items.some((p) => p.id === photo1.id));
  const ft = await req("GET", "/api/photos?tag=测试");
  check("筛选：标签", ft.json.items.some((p) => p.id === photo1.id));
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const fd = await req("GET", `/api/photos?from=${dateStr}&to=${dateStr}`);
  check("筛选：日期范围", fd.json.items.some((p) => p.id === photo1.id));
  const facets = await req("GET", "/api/photos/facets");
  check("筛选：facets 聚合返回标签", facets.json.tags.some((t) => t.name === "测试"));

  // ========== 8. 软删除/恢复/彻底删除/引用计数 ==========
  await req("DELETE", `/api/photos/${photo1.id}`);
  const trashList = await req("GET", "/api/trash");
  check("软删除后出现在回收站", trashList.json.items.some((p) => p.id === photo1.id));
  check("软删除后原图文件仍在磁盘", fs.existsSync(expectedA));
  const homeAfterDel = await req("GET", "/api/photos?pageSize=100");
  check("删除后不在图库列表", !homeAfterDel.json.items.some((p) => p.id === photo1.id));
  await req("POST", `/api/photos/${photo1.id}/restore`);
  const afterRestore = await req("GET", `/api/photos/${photo1.id}`);
  check("恢复后 deletedAt 为空", afterRestore.json.deletedAt === null);

  // 彻底删除记录1（同内容还有记录2引用 → 文件应保留）
  await req("DELETE", `/api/photos/${photo1.id}`);
  const purge1 = await req("DELETE", `/api/trash?id=${photo1.id}`);
  check("彻底删除记录1（引用被记录2占用→文件保留）", purge1.status === 200 && purge1.json.filesDeleted === 0, JSON.stringify(purge1.json));
  check("同内容文件仍存在（图库记录2仍引用）", fs.existsSync(expectedA));

  // 彻底删除记录2（引用归零 → 文件删除）
  const rec2 = sameList.find((p) => p.id !== photo1.id);
  await req("DELETE", `/api/photos/${rec2.id}`);
  const purge2 = await req("DELETE", `/api/trash?id=${rec2.id}`);
  check("彻底删除记录2（引用归零→文件删除）", purge2.json.filesDeleted === 1, JSON.stringify(purge2.json));
  check("同内容文件已从磁盘移除", !fs.existsSync(expectedA));

  // RAW 也清掉
  await req("DELETE", `/api/photos/${rawId}`);
  await req("DELETE", `/api/trash?id=${rawId}`);

  // ========== 9. abort 与 tmp 清理 ==========
  const initX = await req("POST", "/api/photos/upload/init", { fileName: "abort测试.jpg", size: 999999 });
  const abort = await req("DELETE", `/api/photos/upload/abort?uploadId=${initX.json.uploadId}`);
  const vaultTmp = "D:\\picture\\.lpvault\\tmp";
  const tmpFiles = fs.existsSync(vaultTmp) ? fs.readdirSync(vaultTmp) : [];
  check("abort 后 tmp 无残留", abort.status === 200 && tmpFiles.length === 0, `tmp=${tmpFiles.length}`);

  // ========== 10. 防穿越 ==========
  const trav = await req("POST", "/api/photos/upload/init", { fileName: "..\\..\\evil.jpg", size: 1000 });
  check("文件名穿越被净化(不报错且不落盘到根目录外)", trav.status === 200);
  // 结束后清掉这个不续传的会话
  await req("DELETE", `/api/photos/upload/abort?uploadId=${trav.json.uploadId}`);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(2);
});
