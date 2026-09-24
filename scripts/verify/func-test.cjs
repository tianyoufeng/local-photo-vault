// 非破坏性功能测试：登录 → 上传1张 → 列表 → 缩略图 → 原图哈希 → 删除测试照片
const BASE = process.env.LPV_BASE || "http://127.0.0.1:8788";
const PW = process.env.LPV_PW || "test-1234";
const crypto = require("node:crypto");
let cookie = "";
const res = [];
const ok = (n, c, d = "") => { res.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  | " + d : ""}`); };

async function req(method, url, body, headers = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h["Cookie"] = cookie;
  const r = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
  // 健康检查
  const h = await fetch(BASE + "/api/health").then(r => r.json()).catch(() => null);
  ok("健康检查返回本应用标识", h?.app === "LocalPhotoVault", `buildId=${h?.buildId}`);

  // 登录
  const login = await req("POST", "/api/auth", { password: PW });
  ok("登录成功（拿到会话）", !!cookie, `status=${login.status}`);

  // 上传一张测试照片（唯一字节，避免命中已有去重）
  const buf = Buffer.concat([Buffer.from([255, 216, 255, 0xEE]), crypto.randomBytes(600), Buffer.from([0xFF, 0xD9])]);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const name = `功能自测-${Date.now()}.jpg`;
  const init = await req("POST", "/api/photos/upload/init", { fileName: name, size: buf.length });
  ok("分片上传 init", init.status === 200 && !!init.json?.uploadId, `status=${init.status}`);
  if (init.json?.uploadId) {
    await fetch(BASE + `/api/photos/upload/chunk?uploadId=${init.json.uploadId}&index=0`, {
      method: "PUT", headers: { Cookie: cookie }, body: buf,
    });
    const fin = await req("POST", "/api/photos/upload/finalize", { uploadId: init.json.uploadId });
    const pid = fin.json?.photo?.id;
    ok("上传 finalize 成功", fin.status === 200 && !!pid, `status=${fin.status}`);

    if (pid) {
      // 列表能看到
      const list = await req("GET", "/api/photos?pageSize=5");
      ok("图库列表可查询", Array.isArray(list.json?.items), `total=${list.json?.total}`);
      // 详情
      const detail = await req("GET", `/api/photos/${pid}`);
      ok("详情可查询", detail.status === 200 && detail.json?.sha256 === sha, `sha=${String(detail.json?.sha256).slice(0, 12)}`);
      // 原图字节一致
      const raw = await fetch(BASE + `/api/photos/${pid}/original`, { headers: { Cookie: cookie } });
      const rawSha = crypto.createHash("sha256").update(Buffer.from(await raw.arrayBuffer())).digest("hex");
      ok("原图下载字节一致（无损）", rawSha === sha);
      // 缩略图
      const th = await fetch(BASE + `/api/photos/${pid}/thumbnail`, { headers: { Cookie: cookie } });
      ok("缩略图可生成", th.status === 200, `status=${th.status} type=${th.headers.get("content-type")}`);
      // 清理：删到回收站再彻底删
      await req("DELETE", `/api/photos/${pid}`);
      await req("DELETE", `/api/trash?id=${pid}`);
      const after = await req("GET", `/api/photos/${pid}`);
      ok("测试照片已清理", after.status === 404, `status=${after.status}`);
    }
  }

  const fail = res.filter(x => !x).length;
  console.log(`\n通过 ${res.length - fail}/${res.length}`);
  process.exit(fail ? 1 : 0);
})();
