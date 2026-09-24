import fs from "node:fs";
import path from "node:path";

/**
 * 引导配置：存放在应用目录下的 .lpvault-boot.json
 * 为什么需要它：数据库按宪法放在 <照片根目录>\.lpvault 内，
 * 但首次启动时那里什么都还没有，需要一个固定位置记录：
 *  - photoRoot     照片根目录（默认 D:\picture）
 *  - dbPath        数据库实际位置（初始化时确定，改根目录不随之漂移）
 *  - sessionSecret 会话签名密钥（初始化时随机生成）
 * 该文件不提交 git（见 .gitignore）。
 */

export interface BootConfig {
  photoRoot: string;
  dbPath: string;
  sessionSecret: string;
}

export const DEFAULT_PHOTO_ROOT = "D:\\picture";
export const VAULT_DIR_NAME = ".lpvault";
export const DB_FILE_NAME = "lpvault.db";

const appRoot = process.cwd();
const bootConfigPath = path.join(appRoot, ".lpvault-boot.json");

export function defaultDbPath(photoRoot: string): string {
  return path.join(photoRoot, VAULT_DIR_NAME, DB_FILE_NAME);
}

/** 读取引导配置；未初始化时返回 null */
export function readBootConfig(): BootConfig | null {
  try {
    const raw = fs.readFileSync(bootConfigPath, "utf-8");
    const cfg = JSON.parse(raw) as BootConfig;
    if (cfg.photoRoot && cfg.dbPath && cfg.sessionSecret) return cfg;
    return null;
  } catch {
    return null;
  }
}

export function writeBootConfig(cfg: BootConfig): void {
  fs.writeFileSync(bootConfigPath, JSON.stringify(cfg, null, 2), "utf-8");
}

/**
 * 当前生效的照片根目录：
 * 已初始化 → 引导配置里的值；未初始化 → 宪法默认值 D:\picture
 */
export function getPhotoRoot(): string {
  return readBootConfig()?.photoRoot ?? DEFAULT_PHOTO_ROOT;
}

/** 应用内使用 POSIX 风格的 SQLite 连接串 */
export function sqliteUrlFor(dbPath: string): string {
  return `file:${dbPath.replace(/\\/g, "/")}`;
}

/** 检测某个盘符/目录是否存在（用于向导第一步检测 D 盘） */
export function driveExists(rootPath: string): boolean {
  const drive = path.parse(path.resolve(rootPath)).root; // "D:\"
  try {
    fs.accessSync(drive, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 已初始化 = 引导配置存在且数据库文件真实存在 */
export function isInitialized(): boolean {
  const cfg = readBootConfig();
  if (!cfg) return false;
  return fs.existsSync(cfg.dbPath);
}

/** 确保照片根目录与 .lpvault 存在，返回实际创建情况 */
export function ensureVaultDirs(photoRoot: string): { created: string[] } {
  const created: string[] = [];
  const vaultDir = path.join(photoRoot, VAULT_DIR_NAME);
  if (!fs.existsSync(photoRoot)) {
    fs.mkdirSync(photoRoot, { recursive: true });
    created.push(photoRoot);
  }
  if (!fs.existsSync(vaultDir)) {
    fs.mkdirSync(vaultDir, { recursive: true });
    created.push(vaultDir);
  }
  return { created };
}

/** 目录可写性校验（设置页修改根目录前调用） */
export function isDirWritable(dirPath: string): boolean {
  try {
    const probe = path.join(dirPath, `.lpv-write-probe-${Date.now()}`);
    fs.writeFileSync(probe, "lpv");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
