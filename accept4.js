/* LocalPhotoVault 阶段四验收（node accept4.js）
 * 覆盖：标签 CRUD、照片加删标签、评分/收藏、相册 CRUD 与加移照片、
 * 批量操作（标签/评分/删除/恢复/加相册）、四类筛选与计数、相册封面。
 */
const BASE = "http://127.0.0.1:8787";
const PW = process.env.LPV_PW || "test-1234";
let cookie = "";
const results = [];

function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
}
async function req(method, url, body) {
  const h = {};
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h["Cookie"] = cookie;
  const res = await fetch(BASE + url, {
    method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function makePhoto(name, color) {
  const sharp = (await import("sharp")).default;
  const buf = await sharp({ create: { width: 320, height: 240, channels: 3, background: color } })
    .jpeg().toBuffer();
  const init = await req("POST", "/api/photos/upload/init", { fileName: name, size: buf.length });
  await fetch(BASE + `/api/photos/upload/chunk?uploadId=${init.json.uploadId}&index=0`, {
    method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/octet-stream" }, body: buf,
  });
  const fin = await req("POST", "/api/photos/upload/finalize", { uploadId: init.json.uploadId });
  return fin.json.photo.id;
}

async function main() {
  // 登录 + 清场（照片、标签、相册）
  await req("POST", "/api/auth", { password: PW });
  for (const t of ["", "&trash=1"]) {
    const all = await req("GET", `/api/photos?pageSize=100${t}`);
    for (const p of all.json?.items ?? []) {
      await req("DELETE", `/api/photos/${p.id}`);
      await req("DELETE", `/api/trash?id=${p.id}`);
    }
  }
  const oldTags = (await req("GET", "/api/tags")).json.tags ?? [];
  for (const t of oldTags) await req("DELETE", `/api/tags/${t.id}`);
  const oldAlbums = (await req("GET", "/api/albums")).json.albums ?? [];
  for (const a of oldAlbums) await req("DELETE", `/api/albums/${a.id}`);

  // 准备 4 张测试照片
  const p1 = await makePhoto("标签测试A.jpg", { r: 255, g: 0, b: 0 });
  const p2 = await makePhoto("标签测试B.jpg", { r: 0, g: 255, b: 0 });
  const p3 = await makePhoto("标签测试C.jpg", { r: 0, g: 0, b: 255 });
  const p4 = await makePhoto("标签测试D.jpg", { r: 255, g: 255, b: 0 });

  // ===== 1. 标签 CRUD =====
  const tCreate = await req("POST", "/api/tags", { name: "风景" });
  check("新建标签", tCreate.status === 200);
  const tDup = await req("POST", "/api/tags", { name: "风景" });
  check("重名标签被拒(409)", tDup.status === 409);
  const t2 = await req("POST", "/api/tags", { name: "旧名" });
  const tRename = await req("PATCH", `/api/tags/${t2.json.tag.id}`, { name: "人像" });
  check("重命名标签", tRename.status === 200 && tRename.json.tag.name === "人像");
  // 照片加标签（经 PATCH 单张 + 批量）
  await req("PATCH", `/api/photos/${p1}`, { tags: ["风景", "人像"] });
  const d1 = await req("GET", `/api/photos/${p1}`);
  check("照片添加标签", d1.json.tags.includes("风景") && d1.json.tags.includes("人像"));
  // 标签重命名后照片关联跟随
  const tagsAfter = (await req("GET", "/api/tags")).json.tags;
  check(
    "标签计数正确",
    tagsAfter.find((t) => t.name === "风景")?.count === 1 &&
      tagsAfter.find((t) => t.name === "人像")?.count === 1,
    JSON.stringify(tagsAfter)
  );

  // ===== 2/3. 评分与收藏 =====
  await req("PATCH", `/api/photos/${p1}`, { rating: 5, favorite: true });
  const d1b = await req("GET", `/api/photos/${p1}`);
  check("评分 5 星 + 收藏", d1b.json.rating === 5 && d1b.json.favorite === true);
  await req("PATCH", `/api/photos/${p1}`, { rating: 0, favorite: false });
  const d1c = await req("GET", `/api/photos/${p1}`);
  check("清除评分 / 取消收藏", d1c.json.rating === 0 && d1c.json.favorite === false);

  // ===== 4. 相册 CRUD =====
  const aCreate = await req("POST", "/api/albums", { name: "2024 精选" });
  check("新建相册", aCreate.status === 200);
  const aDup = await req("POST", "/api/albums", { name: "2024 精选" });
  check("重名相册被拒(409)", aDup.status === 409);
  const albumId = aCreate.json.album.id;
  const aRename = await req("PATCH", `/api/albums/${albumId}`, { name: "年度精选" });
  check("重命名相册", aRename.status === 200 && aRename.json.album.name === "年度精选");
  // 加照片
  await req("POST", `/api/albums/${albumId}/photos`, { photoIds: [p1, p2, p3] });
  const albList = (await req("GET", "/api/albums")).json.albums;
  const alb = albList.find((a) => a.id === albumId);
  check("相册加入 3 张照片且计数正确", alb?.count === 3, `count=${alb?.count}`);
  check("相册封面缩略图 URL 正确", typeof alb?.coverThumbUrl === "string" && alb.coverThumbUrl.includes("/thumbnail"));
  // 移除照片
  await req("DELETE", `/api/albums/${albumId}/photos`, { photoIds: [p3] });
  const albAfter = (await req("GET", "/api/albums")).json.albums.find((a) => a.id === albumId);
  check("从相册移除照片", albAfter?.count === 2);
  // 删除相册不动照片
  await req("POST", `/api/albums/${albumId}/photos`, { photoIds: [p4] });
  const delAlbum = await req("DELETE", `/api/albums/${albumId}`);
  const p4d = await req("GET", `/api/photos/${p4}`);
  check("删除相册后照片本体仍在", delAlbum.status === 200 && p4d.status === 200);

  // ===== 5. 批量操作 =====
  const b1 = await req("POST", "/api/photos/batch", { action: "tag-add", photoIds: [p1, p2, p4], payload: { tags: ["批量标签"] } });
  check("批量加标签", b1.json?.succeeded === 3, JSON.stringify(b1.json));
  const b2 = await req("POST", "/api/photos/batch", { action: "rating", photoIds: [p1, p2], payload: { rating: 3 } });
  check("批量评分", b2.json?.succeeded === 2);
  const b3 = await req("POST", "/api/photos/batch", { action: "favorite", photoIds: [p1], payload: { favorite: true } });
  check("批量收藏", b3.json?.succeeded === 1);
  const b4 = await req("POST", "/api/photos/batch", { action: "delete", photoIds: [p1, p2] });
  check("批量软删除", b4.json?.succeeded === 2);
  const trashAfter = (await req("GET", "/api/trash")).json;
  check(
    "回收站出现批量删除的照片",
    trashAfter.items.filter((i) => ["标签测试A.jpg", "标签测试B.jpg"].includes(i.originalName)).length === 2
  );
  const b5 = await req("POST", "/api/photos/batch", { action: "restore", photoIds: [p1, p2] });
  check("批量恢复", b5.json?.succeeded === 2);
  const b6 = await req("POST", "/api/photos/batch", { action: "tag-remove", photoIds: [p1, p2, p4], payload: { tags: ["批量标签"] } });
  const dAfter = await req("GET", `/api/photos/${p1}`);
  check("批量移除标签", b6.json?.succeeded === 3 && !dAfter.json.tags.includes("批量标签"));

  // ===== 6. 四类筛选 =====
  // 先清理 p1 的历史状态（前面步骤给它加过"风景"标签和收藏），保证断言确定性
  await req("PATCH", `/api/photos/${p1}`, { tags: [], favorite: false, rating: 0 });
  await req("POST", "/api/photos/batch", { action: "rating", photoIds: [p2, p3], payload: { rating: 4 } });
  await req("POST", "/api/photos/batch", { action: "favorite", photoIds: [p3], payload: { favorite: true } });
  await req("POST", "/api/photos/batch", { action: "tag-add", photoIds: [p2], payload: { tags: ["风景"] } });
  // 新建相册并加入 p1/p4 用于相册筛选
  const alb2 = await req("POST", "/api/albums", { name: "筛选测试" });
  await req("POST", `/api/albums/${alb2.json.album.id}/photos`, { photoIds: [p1, p4] });

  const fTag = await req("GET", "/api/photos?tag=风景");
  check("筛选：标签", fTag.json.items.length === 1 && fTag.json.items[0].id === p2, `${fTag.json.items.length} 条`);
  const fRate = await req("GET", "/api/photos?rating=4");
  check("筛选：评分≥4", fRate.json.items.length === 2 && fRate.json.items.every((p) => p.rating >= 4));
  const fFav = await req("GET", "/api/photos?fav=1");
  check("筛选：收藏", fFav.json.items.length === 1 && fFav.json.items[0].id === p3);
  const fAlbum = await req("GET", "/api/photos?album=筛选测试");
  check(
    "筛选：相册",
    fAlbum.json.items.length === 2 && fAlbum.json.items.every((p) => ["标签测试A.jpg", "标签测试D.jpg"].includes(p.originalName)),
    `${fAlbum.json.items.length} 条`
  );
  const fAlbum2 = await req("GET", "/api/photos?album=年度精选");
  check("删除相册后不再出现在筛选", fAlbum2.status === 200 && fAlbum2.json.items.length === 0);

  // ===== 7. 页面渲染 =====
  for (const [name, url] of [["相册管理页", "/albums"], ["图库首页", "/"]]) {
    const r = await fetch(BASE + url, { headers: { Cookie: cookie }, redirect: "manual" });
    check(`${name}可打开(HTTP 200)`, r.status === 200, `status=${r.status}`);
  }

  const pass = results.filter(Boolean).length;
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(2);
});
