import fs from "node:fs";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform, Writable } from "node:stream";

/**
 * 极简 ustar TAR 写入器（仅满足 .lpvbackup 需求）：
 * - 普通文件条目；文件名超过 100 字节时写 GNU 'L' LongName 条目（tar 各实现通用）
 * - 内容边写边算 SHA-256，支持流式与背压
 * - finish() 写两块 512 零块并补齐到 10240 记录边界
 */
export class TarWriter {
  private stream: fs.WriteStream;
  private ended = false;

  constructor(filePath: string) {
    this.stream = fs.createWriteStream(filePath);
  }

  /** 监听底层写入流的 finish/error */
  streamOn(event: "finish" | "error", cb: (err?: Error) => void): void {
    this.stream.on(event, (err?: Error) => cb(err));
  }

  private write(chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
  }

  private static header(name: string, size: number, typeflag: "0" | "L"): Buffer {
    const buf = Buffer.alloc(512, 0);
    buf.write(name.slice(0, 100), 0, 100, "utf-8");
    buf.write("0000644\0", 100, 8, "utf-8"); // mode
    buf.write("0000000\0", 108, 8, "utf-8"); // uid
    buf.write("0000000\0", 116, 8, "utf-8"); // gid
    buf.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
    buf.write(
      Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0",
      136, 12, "utf-8"
    );
    buf.write("        ", 148, 8, "utf-8"); // 校验和占位（空格）
    buf.write(typeflag, 156, 1, "utf-8");
    buf.write("ustar\0", 257, 6, "utf-8");
    buf.write("00", 263, 2, "utf-8");
    // devmajor/devminor/uname/gname/linkname/prefix 保持 0
    let sum = 0;
    for (const b of buf) sum += b;
    buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");
    return buf;
  }

  private async pad512(written: number): Promise<void> {
    const rest = (512 - (written % 512)) % 512;
    if (rest > 0) await this.write(Buffer.alloc(rest));
  }

  /** 添加文件：返回内容的 SHA-256 */
  async addFile(entryName: string, absPath: string, size: number): Promise<string> {
    // GNU LongName：文件名超长时先写 'L' 条目
    if (Buffer.byteLength(entryName, "utf-8") > 100) {
      const nameBuf = Buffer.concat([Buffer.from(entryName, "utf-8"), Buffer.alloc(1, 0)]);
      await this.write(TarWriter.header(entryName, nameBuf.length, "L"));
      await this.write(nameBuf);
      await this.pad512(nameBuf.length);
      await this.write(TarWriter.header(entryName.split("/").pop() ?? "data", size, "0"));
    } else {
      await this.write(TarWriter.header(entryName, size, "0"));
    }
    const hash = crypto.createHash("sha256");
    const t = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    const sink = new Writable({
      write: (chunk: Buffer, _enc, cb) => {
        this.write(chunk).then(
          () => cb(),
          (e: Error) => cb(e)
        );
      },
    });
    await pipeline(fs.createReadStream(absPath), t, sink);
    await this.pad512(size);
    return hash.digest("hex");
  }

  async addBuffer(entryName: string, data: Buffer): Promise<void> {
    if (Buffer.byteLength(entryName, "utf-8") > 100) {
      const nameBuf = Buffer.concat([Buffer.from(entryName, "utf-8"), Buffer.alloc(1, 0)]);
      await this.write(TarWriter.header(entryName, nameBuf.length, "L"));
      await this.write(nameBuf);
      await this.pad512(nameBuf.length);
      await this.write(TarWriter.header(entryName.split("/").pop() ?? "data", data.length, "0"));
    } else {
      await this.write(TarWriter.header(entryName, data.length, "0"));
    }
    await this.write(data);
    await this.pad512(data.length);
  }

  /** 结束：EOF 零块 + 补齐 10240 记录边界 */
  async finish(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.write(Buffer.alloc(1024));
    // 补齐到 10240 边界需要知道总字节数——用 stream.bytesWritten
    const total = (this.stream as unknown as { bytesWritten: number }).bytesWritten;
    const rest = (10240 - (total % 10240)) % 10240;
    if (rest > 0) await this.write(Buffer.alloc(rest));
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  }

  /** 中止：直接关闭并删除（由调用方负责删除文件） */
  destroy(): void {
    this.stream.destroy();
  }
}
