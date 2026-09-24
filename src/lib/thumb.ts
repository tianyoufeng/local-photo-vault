import fs from "node:fs";
import { extLabel } from "./exif";
import { thumbPathFor } from "./storage";

/**
 * 缩略图生成（512px WebP，按 sha256 存放实现去重）
 * 降级链：sharp 直解 → HEIC 走 wasm 转码 → RAW/失败 → 扩展名占位图
 */

const THUMB_SIZE = 512;

async function loadSharp() {
  return (await import("sharp")).default;
}

/** 生成占位图 WebP（RAW/无法解码时使用） */
async function placeholderWebp(label: string): Promise<Buffer> {
  const sharp = await loadSharp();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" fill="#18181b"/>
  <rect x="1" y="1" width="510" height="510" fill="none" stroke="#3f3f46" stroke-width="2"/>
  <circle cx="256" cy="216" r="56" fill="none" stroke="#f59e0b" stroke-width="8"/>
  <path d="M156 356 L236 268 L292 330 L324 296 L372 356 Z" fill="none" stroke="#a1a1aa" stroke-width="8" stroke-linejoin="round"/>
  <text x="256" y="432" font-family="Segoe UI, sans-serif" font-size="44" font-weight="600"
        fill="#f59e0b" text-anchor="middle">${label}</text>
  <text x="256" y="472" font-family="Segoe UI, sans-serif" font-size="22"
        fill="#71717a" text-anchor="middle">无预览 · 原图可下载</text>
</svg>`;
  return sharp(Buffer.from(svg)).webp().toBuffer();
}

async function sharpThumb(input: Buffer | string): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(input)
    .rotate() // 按 EXIF 方向自动摆正（仅缩略图；原图不动）
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

async function heicToJpegBuffer(filePath: string): Promise<Buffer> {
  const convert = (await import("heic-convert")).default as unknown as (
    opts: Record<string, unknown>
  ) => Promise<ArrayBuffer>;
  const blob = fs.readFileSync(filePath);
  const out = await convert({ buffer: new Uint8Array(blob), format: "jpeg", quality: 0.85 });
  return Buffer.from(out);
}

/**
 * 确保缩略图存在并返回其磁盘路径。
 * 永不抛错：任何失败都落盘占位图，保证 finalize 流程不被阻断。
 */
export async function ensureThumbnail(
  filePath: string,
  sha256: string,
  kind: string,
  fileName: string
): Promise<string> {
  const outPath = thumbPathFor(sha256);
  if (fs.existsSync(outPath)) return outPath;

  let buf: Buffer | null = null;
  try {
    if (kind === "image") {
      buf = await sharpThumb(fs.readFileSync(filePath));
    } else if (kind === "heic") {
      buf = await sharpThumb(await heicToJpegBuffer(filePath));
    }
  } catch {
    buf = null;
  }
  if (!buf) {
    try {
      buf = await placeholderWebp(extLabel(fileName));
    } catch {
      buf = Buffer.from(""); // 极端失败：写空文件占位避免反复重试
    }
  }
  fs.writeFileSync(outPath, buf);
  return outPath;
}
