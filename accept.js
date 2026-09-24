/* LocalPhotoVault 阶段一验收脚本（node accept.js） */
const BASE = "http://127.0.0.1:8787";
const fs = require("fs");

let cookie = "";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
}

async function req(method, path, body, useCookie = true) {
  const headers = { "Content-Type": "application/json" };
  if (useCookie && cookie) headers["Cookie"] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

async function main() {
  // 0. 服务可达
  try {
    await req("GET", "/api/auth", null, false);
    check("Web 服务已启动并响应 (8787)", true);
  } catch (e) {
    check("Web 服务已启动并响应 (8787)", false, e.message);
    return;
  }

  // 1. 首次启动状态
  const s0 = await req("GET", "/api/setup", null, false);
  check(
    "首次启动状态接口正常",
    s0.status === 200 && s0.json && s0.json.initialized === false,
    JSON.stringify(s0.json)
  );
  check("检测到 D 盘可用", s0.json?.dDriveReady === true);

  // 2. 未登录访问受保护 API 应 401/428
  const sGuard = await req("GET", "/api/settings", null, false);
  check("未登录访问设置 API 被拒", sGuard.status === 401 || sGuard.status === 428, `status=${sGuard.status}`);

  // 3. 向导初始化：创建 D:\picture 与 .lpvault、建库、设密码
  const pw = "test-1234";
  const s1 = await req(
    "POST",
    "/api/setup",
    { photoRoot: "D:\\picture", password: pw },
    false
  );
  check(
    "向导初始化成功（建目录+建库+设密码）",
    s1.status === 200 && s1.json?.ok === true,
    JSON.stringify(s1.json)
  );

  // 4. 文件系统验收
  const dPic = fs.existsSync("D:\\picture");
  const vault = fs.existsSync("D:\\picture\\.lpvault");
  const db = fs.existsSync("D:\\picture\\.lpvault\\lpvault.db");
  check("D:\\picture 已自动创建", dPic);
  check("D:\\picture\\.lpvault 已自动创建", vault);
  check("SQLite 数据库位于 .lpvault 下", db, db ? `${fs.statSync("D:\\picture\\.lpvault\\lpvault.db").size} bytes` : "文件不存在");

  // 5. 初始化后状态翻转
  const s2 = await req("GET", "/api/setup", null, false);
  check("初始化状态已持久化", s2.json?.initialized === true);

  // 6. 错误密码被拒
  const badCookie = cookie;
  cookie = "";
  const s3 = await req("POST", "/api/auth", { password: "wrong-pass" }, false);
  check("错误密码被拒绝(401)", s3.status === 401, `status=${s3.status}`);
  cookie = badCookie;

  // 7. 正确密码登录
  const s4 = await req("POST", "/api/auth", { password: pw }, false);
  check("登录页登录成功并下发会话", s4.status === 200 && s4.json?.ok === true && !!cookie, cookie ? "cookie 已签发" : "无 cookie");

  // 8. 已登录可读设置
  const s5 = await req("GET", "/api/settings");
  check(
    "设置 API 可读取照片根目录",
    s5.status === 200 && s5.json?.photoRoot === "D:\\picture",
    JSON.stringify(s5.json)
  );

  // 9. 页面渲染（服务端守卫跳转）
  const page = async (p, expectStatus) => {
    const r = await fetch(BASE + p, { redirect: "manual", headers: { Cookie: cookie } });
    return { status: r.status };
  };
  const loginPage = await fetch(BASE + "/login", { redirect: "manual" });
  check("登录页可打开(HTTP 200)", loginPage.status === 200, `status=${loginPage.status}`);
  const home = await page("/");
  check("登录后首页可打开(HTTP 200)", home.status === 200, `status=${home.status}`);
  const settingsPage = await page("/settings");
  check("设置页可打开(HTTP 200)", settingsPage.status === 200, `status=${settingsPage.status}`);

  // 10. 修改照片根目录并保存（改到测试目录，验证后改回并清理）
  const testRoot = "D:\\picture-move-test";
  const s6 = await req("PUT", "/api/settings", { photoRoot: testRoot });
  const moved = s6.status === 200 && s6.json?.photoRoot?.toLowerCase() === testRoot.toLowerCase();
  const testDirCreated = fs.existsSync(testRoot) && fs.existsSync(testRoot + "\\.lpvault");
  check("修改照片根目录保存成功", moved, JSON.stringify(s6.json));
  check("新根目录及 .lpvault 已自动创建", testDirCreated);
  const s7 = await req("GET", "/api/settings");
  check("重新读取返回新路径", s7.json?.photoRoot?.toLowerCase() === testRoot.toLowerCase(), s7.json?.photoRoot);

  // 改回默认并清理测试目录
  const s8 = await req("PUT", "/api/settings", { photoRoot: "D:\\picture" });
  const reverted = s8.status === 200;
  check("根目录改回 D:\\picture", reverted);
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
    check("测试目录已清理", !fs.existsSync(testRoot));
  } catch (e) {
    check("测试目录已清理", false, e.message);
  }

  // 11. 退出登录
  const s9 = await req("DELETE", "/api/auth");
  check("退出登录成功", s9.status === 200);
  cookie = "";
  const s10 = await req("GET", "/api/settings");
  check("退出后受保护 API 再次被拒", s10.status === 401, `status=${s10.status}`);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(2);
});
