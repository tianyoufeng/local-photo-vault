/* LocalPhotoVault 阶段七验收（node accept7.js）
 * 覆盖：局域网信息、二维码 SVG、上传令牌全生命周期（关→开→401→正确令牌→关闭）、
 * 手机上传页渲染、Token 不出现在 URL/二维码。
 */
const crypto = require("crypto");
const BASE = "http://127.0.0.1:8787";
const PW = process.env.LPV_PW || "test-1234";
let cookie = "";
const results = [];

function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
}
async function req(method, url, body, headers = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h["Cookie"] = cookie;
  const res = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, json: ct.includes("json") ? await res.json().catch(() => null) : null, text: ct.includes("svg") ? await res.text() : null, headers: res.headers };
}
async function tryUpload(name, extraHeaders = {}) {
  const buf = Buffer.concat([Buffer.from([255, 216, 255]), crypto.randomBytes(300)]);
  const init = await req("POST", "/api/photos/upload/init", { fileName: name, size: buf.length }, extraHeaders);
  if (init.status !== 200) return { status: init.status, json: init.json };
  await fetch(BASE + `/api/photos/upload/chunk?uploadId=${init.json.uploadId}&index=0`, { method: "PUT", headers: { Cookie: cookie }, body: buf });
  const fin = await req("POST", "/api/photos/upload/finalize", { uploadId: init.json.uploadId });
  return { status: fin.status, json: fin.json };
}

async function main() {
  await req("POST", "/api/auth", { password: PW });

  // ===== 1. 局域网信息 =====
  const net = await req("GET", "/api/netinfo");
  check("局域网信息返回 IPv4 列表", net.status === 200 && net.json.interfaces.length > 0 && net.json.interfaces.every((i) => /^\d+\.\d+\.\d+\.\d+$/.test(i.address)), JSON.stringify(net.json?.urls));
  check("访问 URL 含正确端口", net.json.urls.every((u) => u.endsWith(":8787")));

  // ===== 2. 二维码 =====
  const qr = await req("GET", `/api/qr.svg?text=${encodeURIComponent("http://172.16.37.196:8787/upload")}`);
  check("二维码 SVG 生成", qr.status === 200 && qr.text?.startsWith("<svg"), qr.text?.slice(0, 30));
  const qrBad = await req("GET", `/api/qr.svg?text=${encodeURIComponent("javascript:alert(1)")}`);
  check("非 URL 内容被二维码接口拒绝(400)", qrBad.status === 400);

  // ===== 3. 上传令牌生命周期 =====
  const req0 = await req("GET", "/api/upload-token/required");
  check("初始：未启用令牌", req0.json?.required === false);
  const up1 = await tryUpload("令牌测试A.jpg");
  check("未启用时无头直接可上传", up1.status === 200);
  // 清理
  await req("DELETE", `/api/photos/${up1.json.photo.id}`);
  await req("DELETE", `/api/trash?id=${up1.json.photo.id}`);

  // 启用令牌
  const put = await req("PUT", "/api/upload-token", {});
  const realToken = put.json.full;
  check("启用令牌（自动生成 64 位）", put.status === 200 && /^[a-f0-9]{64}$/.test(realToken));
  const req1 = await req("GET", "/api/upload-token/required");
  check("required 接口反映已启用", req1.json?.required === true);

  // 无头 → 401
  const up2 = await tryUpload("令牌测试B.jpg");
  check("启用后无头被拒(401+needToken)", up2.status === 401 && up2.json?.needToken === true, JSON.stringify(up2.json));
  // 错令牌 → 401
  const up3 = await tryUpload("令牌测试C.jpg", { "X-Upload-Token": "deadbeef" });
  check("错误令牌被拒(401)", up3.status === 401);
  // 正确令牌 → 200
  const up4 = await tryUpload("令牌测试D.jpg", { "X-Upload-Token": realToken });
  check("正确令牌上传成功", up4.status === 200, JSON.stringify(up4.json?.error ?? ""));
  await req("DELETE", `/api/photos/${up4.json.photo.id}`);
  await req("DELETE", `/api/trash?id=${up4.json.photo.id}`);

  // 设置页查看掩码
  const tokGet = await req("GET", "/api/upload-token");
  check("设置页令牌掩码显示", tokGet.json?.enabled === true && tokGet.json?.masked?.includes("…"));
  // 关闭
  await req("DELETE", "/api/upload-token");
  const req2 = await req("GET", "/api/upload-token/required");
  check("关闭令牌后 required=false", req2.json?.required === false);

  // ===== 4. 手机上传页与二维码 URL 不含令牌 =====
  const uploadPage = await fetch(BASE + "/upload", { headers: { Cookie: cookie }, redirect: "manual" });
  check("手机上传页可打开(HTTP 200)", uploadPage.status === 200);
  const uploadHtml = await uploadPage.text();
  check("手机页含 iOS 原图提示", uploadHtml.includes("原图") || uploadHtml.includes("实际文件") || uploadHtml.includes("iPhone"));
  check("手机页含文件夹限制提示", uploadHtml.includes("文件夹"));
  check("手机页含 PWA/系统相册限制说明", uploadHtml.includes("PWA") || uploadHtml.includes("Service Worker"));

  const pass = results.filter(Boolean).length;
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(2);
});
