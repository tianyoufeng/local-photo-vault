const BASE = process.env.BASE || "http://127.0.0.1:8788";

const pages = ["/", "/login", "/setup", "/settings", "/albums", "/trash", "/upload", "/photo/1"];
const apis = [
  "/api/netinfo", "/api/settings", "/api/albums", "/api/photos", "/api/photos/facets",
  "/api/tags", "/api/trash", "/api/auth", "/api/setup", "/api/upload-token",
  "/api/upload-token/required", "/api/qr.svg",
  "/api/backup/settings", "/api/backup/progress", "/api/backup/remind",
  "/api/photos/import/progress", "/api/photos/import/scan",
];

let fail = 0;
const results = [];
for (const p of [...pages, ...apis]) {
  let status = "ERR", note = "";
  try {
    const res = await fetch(BASE + p, { redirect: "manual" });
    status = res.status;
    if (status >= 500) {
      const body = await res.text();
      const m = body.match(/Cannot find module '([^']+)'/);
      note = m ? `MISSING_MODULE: ${m[1]}` : body.slice(0, 120).replace(/\s+/g, " ");
      fail++;
    }
  } catch (e) {
    note = e.message;
    fail++;
  }
  results.push({ p, status, note });
}

const w = Math.max(...results.map(r => r.p.length));
for (const r of results) {
  const bad = (typeof r.status === "number" ? r.status >= 500 : true);
  console.log(`${bad ? "FAIL" : " OK "}  ${String(r.status).padEnd(4)} ${r.p.padEnd(w)} ${r.note}`);
}
console.log(`\n总失败(>=500 或异常): ${fail} / ${results.length}`);
