import crypto from "node:crypto";
import fs from "node:fs";

/** 流式计算文件 SHA-256（不整读进内存，RAW 大文件安全） */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** 计算内存 Buffer 的 SHA-256（分片场景不用，仅小文件校验） */
export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
