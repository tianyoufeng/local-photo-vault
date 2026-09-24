/* 验证：上传照片时指定目标相册（albumId / albumName 新建两条路径） */
const crypto = require("crypto");
const BASE = "http://127.0.0.1:8787";
const PW = "test-1234";
let cookie = "";
const results = [];
function check(n, ok, d = "") { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " | " + d : ""}`); }
async function req(method, url, body, headers = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h["Cookie"] = cookie;
  const res = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function uploadTo(name, seed, albumParam) {
  const buf = Buffer.concat([Buffer.from([255, 216, 255, seed]), crypto.randomBytes(300)]);
  const init = await req("POST", "/api/photos/upload/init", { fileName: name, size: buf.length });
  await fetch(BASE + `/api/photos/upload/chunk?uploadId=${init.json.uploadId}&index=0`, { method: "PUT", headers: { Cookie: cookie }, body: buf });
  return req("POST", "/api/photos/upload/finalize", { uploadId: init.json.uploadId, ...albumParam });
}

async function main() {
  await req("POST", "/api/auth", { password: PW });
  // 清场（循环删到空）
  for (const t of ["", "&trash=1"]) {
    for (let r = 0; r < 50; r++) {
      const all = await req("GET", `/api/photos?pageSize=100${t}`);
      if ((all.json?.items ?? []).length === 0) break;
      for (const p of all.json.items) { await req("DELETE", `/api/photos/${p.id}`); await req("DELETE", `/api/trash?id=${p.id}`); }
    }
  }
  for (const a of (await req("GET", "/api/albums")).json.albums ?? []) await req("DELETE", `/api/albums/${a.id}`);

  // 建一个已有相册
  await req("POST", "/api/albums", { name: "已存在相册" });
  const albums = (await req("GET", "/api/albums")).json.albums;
  const target = albums.find((a) => a.name === "已存在相册");

  // 路径 1：albumId 指定已有相册
  const r1 = await uploadTo("上传到已有相册.jpg", 1, { albumId: target.id });
  const alb1 = (await req("GET", `/api/photos?album=${encodeURIComponent("已存在相册")}`)).json;
  check("albumId 指定已有相册：照片直接归入", r1.status === 200 && alb1.total === 1, `total=${alb1.total}`);

  // 路径 2：albumName 指定新相册（自动创建）
  const r2 = await uploadTo("上传到新相册.jpg", 2, { albumName: "自动创建的相册" });
  const alb2 = (await req("GET", "/api/photos?album=" + encodeURIComponent("自动创建的相册"))).json;
  const albumsAfter = (await req("GET", "/api/albums")).json.albums;
  check("albumName 新相册：自动创建并归入", r2.status === 200 && alb2.total === 1 && albumsAfter.some((a) => a.name === "自动创建的相册"), `total=${alb2.total}`);

  // 路径 3：不指定 → 只进图库
  const r3 = await uploadTo("不指定相册.jpg", 3, {});
  const inAlbums = (await req("GET", "/api/photos?album=" + encodeURIComponent("已存在相册"))).json.total
    + (await req("GET", "/api/photos?album=" + encodeURIComponent("自动创建的相册"))).json.total;
  check("不指定相册：仅进图库", r3.status === 200 && inAlbums === 2, `inAlbums=${inAlbums}`);

  // 详情页归属验证
  const det = await req("GET", `/api/photos/${r1.json.photo.id}`);
  check("详情接口返回归属相册", det.json.albums?.some((a) => a.name === "已存在相册"), JSON.stringify(det.json.albums));

  console.log(`\n===== 结果: ${results.filter(Boolean).length}/${results.length} 通过 =====`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
main().catch((e) => { console.error("异常:", e); process.exit(2); });
