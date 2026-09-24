import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { Parser } from "tar";
import { PrismaClient } from "@prisma/client";
import { getVaultPaths, ensureVaultSubDirs } from "./storage";
import { sha256File } from "./hash";
import { writeBootConfig, readBootConfig } from "./paths";
import { ensureThumbnail } from "./thumb";
import { getDb } from "./db";

/**
 * 阶段六：备份恢复（合并去重 / 全量覆盖），仅桌面端（令牌门控）。
 * DB 恢复采用数据级操作（通过快照库读写记录），不替换在线 DB 文件，
 * 避免与运行中的 Prisma 连接冲突；失败时数据级回滚。
 * 文件级回滚：恢复前把将被覆盖的原图复制到 restore-rollback-<id>\photos\，
 * 提取的新文件若中途失败则删除。
 */

export interface RestoreJob {
  id: string;
  state: "running" | "finished" | "failed";
  mode: "merge" | "overwrite";
  archivePath: string;
  stage: string;
  filesDone: number;
  filesTotal: number;
  currentFile?: string;
  error?: string;
  rolledBack?: boolean;
  summary?: {
    merged: number;
    skippedExisting: number;
    extracted: number;
    failures: { path: string; error: string }[];
  };
  createdAt: number;
}

const jobs: Map<string, RestoreJob> = ((globalThis as Record<string, unknown>).__lpvRestores ??=
  new Map()) as Map<string, RestoreJob>;

export function getRestoreJob(id: string): RestoreJob | null {
  return jobs.get(id) ?? null;
}

function shaTransform(): { t: Transform; hex: () => string } {
  const hash = crypto.createHash("sha256");
  const t = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  return { t, hex: () => hash.digest("hex") };
}

interface ManifestPhoto {
  storedName: string;
  sha256: string;
  size: number;
}

interface ParsedManifest {
  format: string;
  version: number;
  db: { path: string; sha256: string; size: number };
  photos: ManifestPhoto[];
  thumbnails?: string[];
}

/** 读 tar 流：抓取 manifest.json，统计条目，计算整个归档哈希 */
async function scanArchive(
  archivePath: string
): Promise<{ manifest: ParsedManifest; entryNames: Set<string>; archiveSha: string }> {
  let manifestBuf: Buffer | null = null;
  const entryNames = new Set<string>();
  const hash = crypto.createHash("sha256");
  const t = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const parse = new Parser();
  parse.on("entry", (e: any) => {
    entryNames.add(e.path);
    if (e.path === "manifest.json") {
      const chunks: Buffer[] = [];
      e.on("data", (c: Buffer) => chunks.push(c));
      e.on("end", () => {
        manifestBuf = Buffer.concat(chunks);
      });
    } else {
      e.resume();
    }
  });
  await pipeline(fs.createReadStream(archivePath), t, parse);
  if (!manifestBuf) throw new Error("归档中缺少 manifest.json");
  const manifest = JSON.parse((manifestBuf as Buffer).toString("utf-8")) as ParsedManifest;
  if (manifest.format !== "lpvbackup") throw new Error("不是 LocalPhotoVault 备份文件");
  if (manifest.version !== 1) throw new Error(`不支持的备份格式版本：${manifest.version}`);
  if (!manifest.db || !Array.isArray(manifest.photos)) throw new Error("manifest 结构不完整");
  return { manifest, entryNames, archiveSha: hash.digest("hex") };
}

/** 打开快照库 */
function openSnapshotClient(dbFile: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: `file:${dbFile.replace(/\\/g, "/")}` } },
  });
}

export function startRestore(
  archivePath: string,
  mode: "merge" | "overwrite",
  newPhotoRoot?: string
): RestoreJob | null {
  if (!fs.existsSync(archivePath)) return null;
  ensureVaultSubDirs();
  const job: RestoreJob = {
    id: crypto.randomUUID().replace(/-/g, ""),
    state: "running",
    mode,
    archivePath,
    stage: "校验归档",
    filesDone: 0,
    filesTotal: 0,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  void runRestore(job, newPhotoRoot).catch((e) => {
    job.state = "failed";
    job.error = e.message;
  });
  return job;
}

async function runRestore(job: RestoreJob, newPhotoRoot?: string): Promise<void> {
  const rollbackDir = path.join(
    getVaultPaths().vaultDir,
    `restore-rollback-${job.id}`
  );
  const extractedNew: string[] = []; // 提取出的新文件（回滚时删除）
  const movedOld: { from: string; to: string }[] = []; // 被移入回滚区的旧文件
  let snapClient: PrismaClient | null = null;
  let rollClient: PrismaClient | null = null;

  const fail = async (msg: string): Promise<never> => {
    job.error = msg;
    // ---- 回滚 ----
    try {
      job.stage = "回滚中";
      if (rollClient) {
        // 数据级回滚：清空后从回滚快照恢复
        const db = getDb();
        await db.photo.deleteMany({});
        await db.tag.deleteMany({});
        await db.album.deleteMany({});
        const oldPhotos = await rollClient.photo.findMany({ include: { tags: true, albums: true } });
        for (const t of await rollClient.tag.findMany()) {
          await db.tag.create({ data: { id: t.id, name: t.name } }).catch(() => null);
        }
        for (const a of await rollClient.album.findMany()) {
          await db.album
            .create({ data: { id: a.id, name: a.name, createdAt: a.createdAt } })
            .catch(() => null);
        }
        for (const p of oldPhotos) {
          await db.photo
            .create({
              data: {
                id: p.id, sha256: p.sha256, storedName: p.storedName,
                originalName: p.originalName, mimeType: p.mimeType, kind: p.kind,
                sizeBytes: p.sizeBytes, width: p.width, height: p.height,
                takenAt: p.takenAt, cameraMake: p.cameraMake, cameraModel: p.cameraModel,
                lensModel: p.lensModel, focalLength: p.focalLength, fNumber: p.fNumber,
                exposureTime: p.exposureTime, iso: p.iso, gpsLat: p.gpsLat, gpsLon: p.gpsLon,
                rating: p.rating, favorite: p.favorite, exif: p.exif,
                deletedAt: p.deletedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
              },
            })
            .catch(() => null);
          await db.photo
            .update({
              where: { id: p.id },
              data: {
                tags: { connect: p.tags.map((t) => ({ id: t.id })) },
                albums: { connect: p.albums.map((a) => ({ id: a.id })) },
              },
            })
            .catch(() => null);
        }
        rollClient.$disconnect();
        rollClient = null;
      }
      for (const e of extractedNew) {
        try {
          fs.rmSync(e, { force: true });
        } catch { /* 尽力 */ }
      }
      for (const m of movedOld) {
        try {
          fs.mkdirSync(path.dirname(m.from), { recursive: true });
          fs.renameSync(m.to, m.from);
        } catch { /* 尽力 */ }
      }
      job.rolledBack = true;
    } catch (e) {
      job.error = `${msg}（回滚也失败：${(e as Error).message}）`;
      job.state = "failed";
      return undefined as never;
    }
    job.state = "failed";
    throw new Error(msg);
  };

  try {
    // ① 校验归档：哈希 + manifest
    job.stage = "校验归档（哈希 + manifest）";
    const { manifest, entryNames, archiveSha } = await scanArchive(job.archivePath);

    // 与备份记录比对归档哈希（能找到记录时必须一致）
    const rec = await getDb().backupRecord.findFirst({
      where: { filePath: path.resolve(job.archivePath) },
    });
    if (rec && rec.archiveSha256 !== archiveSha) {
      await fail("归档哈希与备份记录不一致，文件可能已损坏");
      return;
    }

    // ② 提取 DB 快照到临时位置并校验哈希
    job.stage = "提取数据库快照";
    const { tmpDir } = getVaultPaths();
    const snapDb = path.join(tmpDir, `restore-snap-${job.id}.db`);
    {
      const { t, hex } = shaTransform();
      let entryFound = false;
      const parse = new Parser();
      parse.on("entry", (e: any) => {
        if (e.path === "db/lpvault.db") {
          entryFound = true;
          pipeline(e, t, fs.createWriteStream(snapDb)).catch(() => null);
        } else e.resume();
      });
      const done = new Promise<void>((resolve) => parse.on("end", resolve));
      await pipeline(fs.createReadStream(job.archivePath), parse);
      await done;
      if (!entryFound) await fail("归档中缺少数据库快照");
      if (hex() !== manifest.db.sha256) await fail("数据库快照哈希校验失败");
    }
    snapClient = openSnapshotClient(snapDb);

    // ③ 恢复前自动临时备份：当前 DB + 将被影响的文件
    job.stage = "恢复前临时备份（回滚点）";
    const dbRollback = path.join(rollbackDir, "current.db");
    fs.mkdirSync(rollbackDir, { recursive: true });
    fs.rmSync(dbRollback, { force: true });
    await getDb().$executeRawUnsafe(
      `VACUUM INTO '${dbRollback.replace(/'/g, "''")}'`
    );
    rollClient = openSnapshotClient(dbRollback);

    const cfg = readBootConfig()!;
    const targetRoot = newPhotoRoot ? path.resolve(newPhotoRoot) : cfg.photoRoot;
    fs.mkdirSync(targetRoot, { recursive: true });

    const plan = manifest.photos.map((m) => ({
      ...m,
      entryName: `photos/${m.storedName.replace(/\\/g, "/")}`,
      target: path.join(targetRoot, m.storedName),
    }));
    job.filesTotal = plan.length;

    // 把会被覆盖的现有文件复制进回滚区（overwrite 全部；merge 仅同名不同内容）
    for (const item of plan) {
      if (fs.existsSync(item.target)) {
        if (job.mode === "overwrite") {
          const to = path.join(rollbackDir, "photos", item.storedName);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(item.target, to);
          movedOld.push({ from: item.target, to });
        } else {
          try {
            const existingSha = await sha256File(item.target);
            if (existingSha !== item.sha256) {
              const to = path.join(rollbackDir, "photos", item.storedName);
              fs.mkdirSync(path.dirname(to), { recursive: true });
              fs.copyFileSync(item.target, to);
              movedOld.push({ from: item.target, to });
            }
          } catch { /* 读不了就跳过保护 */ }
        }
      }
    }

    // ④ DB 数据级恢复
    job.stage = job.mode === "overwrite" ? "覆盖数据库记录" : "合并数据库记录";
    const liveDb = getDb();
    if (job.mode === "overwrite") {
      await liveDb.photo.deleteMany({});
      await liveDb.tag.deleteMany({});
      await liveDb.album.deleteMany({});
    }

    const storedNameToId = new Map<string, string>();
    const snapPhotos = await snapClient.photo.findMany({
      include: { tags: true, albums: true },
    });
    // 先保证标签/相册存在
    for (const t of await snapClient.tag.findMany()) {
      await liveDb.tag.upsert({ where: { name: t.name }, update: {}, create: { name: t.name } }).catch(() => null);
    }
    for (const a of await snapClient.album.findMany()) {
      await liveDb.album.upsert({ where: { name: a.name }, update: {}, create: { name: a.name } }).catch(() => null);
    }

    let merged = 0;
    let skippedExisting = 0;
    const failures: { path: string; error: string }[] = [];
    for (const sp of snapPhotos) {
      const exist = await liveDb.photo.findFirst({ where: { sha256: sp.sha256 }, select: { id: true } });
      if (exist) {
        storedNameToId.set(sp.storedName, exist.id);
        skippedExisting++;
        continue;
      }
      const baseData = {
        sha256: sp.sha256, storedName: sp.storedName, originalName: sp.originalName,
        mimeType: sp.mimeType, kind: sp.kind, sizeBytes: sp.sizeBytes,
        width: sp.width, height: sp.height, takenAt: sp.takenAt,
        cameraMake: sp.cameraMake, cameraModel: sp.cameraModel, lensModel: sp.lensModel,
        focalLength: sp.focalLength, fNumber: sp.fNumber, exposureTime: sp.exposureTime,
        iso: sp.iso, gpsLat: sp.gpsLat, gpsLon: sp.gpsLon, rating: sp.rating,
        favorite: sp.favorite, exif: sp.exif, deletedAt: sp.deletedAt,
      };
      // 优先保留快照中的原 ID；ID 冲突时退化为新生成
      let created = await liveDb.photo
        .create({ data: { ...baseData, id: sp.id } })
        .catch(() => null);
      if (!created) {
        created = await liveDb.photo
          .create({ data: baseData })
          .catch((e) => {
            failures.push({ path: sp.storedName, error: `记录恢复失败：${(e as Error).message}` });
            return null;
          });
      }
      if (created) {
        storedNameToId.set(sp.storedName, created.id);
        merged++;
        await liveDb.photo
          .update({
            where: { id: created.id },
            data: {
              tags: { connect: sp.tags.map((t) => ({ name: t.name })) },
              albums: { connect: sp.albums.map((a) => ({ name: a.name })) },
            },
          })
          .catch(() => null);
      }
    }

    // ⑤ 提取原图：单遍扫描归档（逐文件哈希复核）。
    // 覆盖模式：全部重提取；合并模式：缺失或哈希不符的才提取（顺带发现现有文件损坏）
    job.stage = "提取原图文件";
    const needed: typeof plan = [];
    for (const item of plan) {
      if (!fs.existsSync(item.target)) {
        needed.push(item);
        continue;
      }
      if (job.mode === "overwrite") {
        needed.push(item);
        continue;
      }
      try {
        if ((await sha256File(item.target)) !== item.sha256) needed.push(item);
      } catch {
        needed.push(item);
      }
    }
    job.filesTotal = needed.length;
    const neededByEntry = new Map<string, (typeof needed)[number] & { tmpFile: string; hash: crypto.Hash }>();
    for (const item of needed) {
      if (!entryNames.has(item.entryName)) {
        failures.push({ path: item.storedName, error: "归档中缺少该文件" });
        job.filesDone++;
        continue;
      }
      const tmpFile = path.join(tmpDir, `restore-${job.id}-${crypto.randomBytes(4).toString("hex")}.part`);
      neededByEntry.set(item.entryName, { ...item, tmpFile, hash: crypto.createHash("sha256") });
    }
    const foundEntries = new Set<string>();
    const parse = new Parser();
    parse.on("entry", (e: any) => {
      const item = neededByEntry.get(e.path);
      if (!item) {
        e.resume();
        return;
      }
      foundEntries.add(e.path);
      const sink = fs.createWriteStream(item.tmpFile);
      const t = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          item.hash.update(chunk);
          cb(null, chunk);
        },
      });
      pipeline(e, t, sink).catch(() => null);
    });
    await pipeline(fs.createReadStream(job.archivePath), parse);

    let extracted = 0;
    for (const [entryName, item] of neededByEntry) {
      job.currentFile = item.storedName;
      try {
        if (!foundEntries.has(entryName)) throw new Error("归档条目缺失");
        const actualSha = item.hash.digest("hex");
        if (actualSha !== item.sha256) {
          // 哈希不一致 = 归档损坏（宪法第 9 条）：立即中止整个恢复并回滚
          throw new Error(`文件哈希与 manifest 不一致：${item.storedName}（归档已损坏）`);
        }
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        try {
          fs.renameSync(item.tmpFile, item.target);
        } catch {
          fs.copyFileSync(item.tmpFile, item.target);
          fs.rmSync(item.tmpFile, { force: true });
        }
        extractedNew.push(item.target);
        extracted++;
        await ensureThumbnail(item.target, item.sha256, "image", path.basename(item.storedName)).catch(() => null);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("归档已损坏")) throw e;
        failures.push({ path: item.storedName, error: msg });
        try {
          fs.rmSync(item.tmpFile, { force: true });
        } catch { /* 忽略 */ }
      }
      job.filesDone++;
    }

    // ⑥ 新照片根目录
    if (newPhotoRoot && path.resolve(newPhotoRoot) !== cfg.photoRoot) {
      writeBootConfig({ ...cfg, photoRoot: path.resolve(newPhotoRoot) });
    }

    job.summary = { merged, skippedExisting, extracted, failures };
    job.stage = "完成";

    // 成功后清理：必须先断开快照连接再删文件；清理失败容错（临时文件由 24h 清理兜底）
    try {
      snapClient?.$disconnect();
      snapClient = null;
    } catch { /* 忽略 */ }
    try {
      fs.rmSync(rollbackDir, { recursive: true, force: true });
    } catch { /* 删不掉就留给下次，不作为失败 */ }
    try {
      fs.rmSync(snapDb, { force: true });
    } catch { /* EBUSY 容错 */ }

    // 全部善后才置为 finished（轮询方看到 finished 时回滚/清理已结束）
    job.state = "finished";
  } catch (e) {
    await fail((e as Error).message);
  } finally {
    try {
      snapClient?.$disconnect();
      rollClient?.$disconnect();
    } catch { /* 忽略 */ }
  }
}
