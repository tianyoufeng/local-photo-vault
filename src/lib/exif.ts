import path from "node:path";

/**
 * 文件类型判定与 EXIF 提取（exifr 纯 JS，覆盖 JPEG/HEIC/RAW 等格式）
 */

const RAW_EXTENSIONS = new Set([
  "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng",
  "raf", "orf", "rw2", "pef", "ptx", "srw", "x3f", "3fr", "erf",
  "mef", "mos", "iiq", "kdc", "dcr", "rwl", "fff", "gpr",
]);

const SHARP_IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "tiff", "tif", "avif", "gif", "svg",
]);

const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

export function fileExt(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export type PhotoKind = "image" | "heic" | "raw" | "unknown";

export function detectKind(fileName: string): PhotoKind {
  const ext = fileExt(fileName);
  if (SHARP_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (HEIC_EXTENSIONS.has(ext)) return "heic";
  if (RAW_EXTENSIONS.has(ext)) return "raw";
  return "unknown";
}

/** exifr 的懒加载句柄（server 端动态 import，避免影响打包分析） */
async function loadExifr() {
  return (await import("exifr")) as typeof import("exifr");
}

export interface ExifResult {
  takenAt: Date | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  focalLength: number | null;
  fNumber: number | null;
  exposureTime: string | null;
  iso: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
}

function toStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // 部分写入器（如 sharp withExif）会把数值写成 ASCII 字符串
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 快门：exifr 给秒数，展示为 "1/250" 或 "2\"" 形式 */
function formatExposure(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
    return null;
  if (seconds >= 1) return `${Math.round(seconds)}"`;
  const denom = Math.round(1 / seconds);
  return `1/${denom}`;
}

/** 从文件提取 EXIF；失败返回全空结果（绝不因 EXIF 失败阻断导入） */
export async function extractExif(filePath: string): Promise<ExifResult> {
  const empty: ExifResult = {
    takenAt: null, cameraMake: null, cameraModel: null, lensModel: null,
    focalLength: null, fNumber: null, exposureTime: null, iso: null,
    gpsLat: null, gpsLon: null,
  };
  try {
    const exifr = await loadExifr();
    const parsed = (await exifr.parse(filePath, {
      tiff: true, exif: true, gps: true, ifd0: {},
      translateValues: false, reviveValues: true,
    })) as Record<string, unknown> | undefined;
    if (!parsed) return empty;

    const dt =
      (parsed.DateTimeOriginal as Date | undefined) ??
      (parsed.CreateDate as Date | undefined) ??
      (parsed.DateTime as Date | undefined);
    const takenAt =
      dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt : null;

    const lat = toNum(parsed.latitude);
    const lon = toNum(parsed.longitude);
    const gpsLat = lat !== null && Math.abs(lat) <= 90 ? lat : null;
    const gpsLon = lon !== null && Math.abs(lon) <= 180 ? lon : null;

    return {
      takenAt,
      cameraMake: toStr(parsed.Make),
      cameraModel: toStr(parsed.Model),
      lensModel: toStr(parsed.LensModel) ?? toStr(parsed.LensMake),
      focalLength: toNum(parsed.FocalLength),
      fNumber: toNum(parsed.FNumber),
      exposureTime: formatExposure(parsed.ExposureTime),
      iso: toNum(parsed.ISO),
      gpsLat,
      gpsLon,
    };
  } catch {
    return empty;
  }
}

/** 完整 EXIF JSON（详情页备用展示），失败返回 null */
export async function extractExifRaw(filePath: string): Promise<string | null> {
  try {
    const exifr = await loadExifr();
    const parsed = await exifr.parse(filePath, { tiff: true, exif: true, gps: true, ifd0: {} });
    return parsed ? JSON.stringify(parsed) : null;
  } catch {
    return null;
  }
}

export function extLabel(fileName: string): string {
  return path.extname(fileName).replace(".", "").toUpperCase() || "FILE";
}
