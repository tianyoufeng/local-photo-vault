import { ensureThumbnail } from "./thumb";
import { logWarn } from "./logger";

/**
 * 缩略图异步队列：上传/导入只入队不等待，后台 worker 逐个生成（并发 2）。
 * 缩略图路由缺失时按需生成仍是兜底，队列主要保证热点内容提前就绪。
 */

interface ThumbTask {
  filePath: string;
  sha256: string;
  kind: string;
  fileName: string;
}

const queue: ThumbTask[] = [];
const inFlight = new Set<string>(); // 按 sha256 去重
const queued = new Set<string>();
let running = 0;
const CONCURRENCY = 2;

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const task = queue.shift()!;
    queued.delete(task.sha256);
    running++;
    void ensureThumbnail(task.filePath, task.sha256, task.kind, task.fileName)
      .catch((e) =>
        logWarn("thumb", "generate_failed", { sha256: task.sha256, error: (e as Error).message })
      )
      .finally(() => {
        inFlight.delete(task.sha256);
        running--;
        pump();
      });
    inFlight.add(task.sha256);
  }
}

export function enqueueThumbnail(
  filePath: string,
  sha256: string,
  kind: string,
  fileName: string
): void {
  if (inFlight.has(sha256) || queued.has(sha256)) return;
  queued.add(sha256);
  queue.push({ filePath, sha256, kind, fileName });
  setImmediate(pump);
}

/** 队列状态（调试用） */
export function thumbQueueState(): { pending: number; running: number } {
  return { pending: queue.length, running };
}
