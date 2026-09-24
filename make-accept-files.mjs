// 生成阶段二浏览器验收用的测试照片
// 3 张不同拍摄时间的 JPEG（带相机 EXIF）+ 1 个伪 RAW（.CR2，TIFF 头 + 随机体）
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const dir = "C:/Users/q2764/WorkBuddy/2026-09-20-17-32-59/LocalPhotoVault/.accept-files";
fs.mkdirSync(dir, { recursive: true });

async function make(name, color, exif) {
  const buf = await sharp({
    create: { width: 640, height: 480, channels: 3, background: color },
  })
    .withExif(exif)
    .jpeg({ quality: 92 })
    .toBuffer();
  fs.writeFileSync(path.join(dir, name), buf);
  return { name, path: path.join(dir, name), sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length };
}

const a = await make("雪山_2024a.jpg", { r: 90, g: 140, b: 220 }, {
  IFD0: { Make: "Fujifilm", Model: "X-T5" },
  IFD2: { DateTimeOriginal: "2024:01:01 08:00:00", LensModel: "XF23mmF1.4", FNumber: "14/10", ExposureTime: "1/500", FocalLength: "23", ISO: "200", ISOSpeedRatings: "200" },
});
const b = await make("晚霞_2024b.jpg", { r: 235, g: 120, b: 60 }, {
  IFD0: { Make: "Fujifilm", Model: "X-T5" },
  IFD2: { DateTimeOriginal: "2024:06:15 19:45:00", LensModel: "XF56mmF1.2", FNumber: "12/10", ExposureTime: "1/250", FocalLength: "56", ISO: "400", ISOSpeedRatings: "400" },
});
const c = await make("巷子_2023c.jpg", { r: 60, g: 170, b: 120 }, {
  IFD0: { Make: "Sony", Model: "A7 IV" },
  IFD2: { DateTimeOriginal: "2023:05:05 12:30:00", LensModel: "FE 35mm F1.8", FNumber: "18/10", ExposureTime: "1/125", FocalLength: "35", ISO: "800", ISOSpeedRatings: "800" },
});

// 伪 RAW：TIFF 头（II*\0）+ 随机体，扩展名 .CR2（服务端按 raw 处理、原图可下载校验哈希）
const raw = Buffer.concat([Buffer.from("II*\u0000\u0008\u0000\u0000\u0000"), crypto.randomBytes(3 * 1024 * 1024)]);
fs.writeFileSync(path.join(dir, "DSC_20240701.CR2"), raw);
const r = { name: "DSC_20240701.CR2", path: path.join(dir, "DSC_20240701.CR2"), sha256: crypto.createHash("sha256").update(raw).digest("hex"), size: raw.length };

console.log(JSON.stringify({ files: [a, b, c, r], dir }, null, 2));
