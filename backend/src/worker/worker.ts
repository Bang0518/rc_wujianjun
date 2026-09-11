import type { NotificationRecord } from '@notify/common';
import type { NotificationStore } from '../db/store.js';
import type { AppConfig } from '../config.js';
import { deliver as defaultDeliver, type DeliveryOptions } from './delivery.js';
import { backoff, classify, type DeliveryResult } from './retry.js';

/** worker 只依赖日志的这两个方法，便于测试注入。 */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export type DeliverFn = (
  rec: NotificationRecord,
  opts: DeliveryOptions,
) => Promise<DeliveryResult>;

export interface WorkerDeps {
  store: NotificationStore;
  config: AppConfig;
  logger: Logger;
  /** 可注入的投递实现（测试时替换为 stub）。 */
  deliver?: DeliverFn;
  /** 可注入的时钟（测试用）。 */
  now?: () => number;
}

/**
 * 投递 worker：单实例、单循环。
 *
 * 每个 tick：reap 超时记录 → claim 一批 → 受并发上限地并行投递 → 逐条结算。
 * 用递归 setTimeout（而非 setInterval）串行 tick，避免上一轮未结束时重入堆叠。
 */
export class Worker {
  private readonly store: NotificationStore;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly deliver: DeliverFn;
  private readonly now: () => number;

  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;

  constructor(deps: WorkerDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.logger = deps.logger;
    this.deliver = deps.deliver ?? defaultDeliver;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  /** 停止循环，并等待正在进行的 tick 结束（优雅退出用）。 */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ticking) await this.ticking;
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.ticking = this.tick()
        .catch((err) => this.logger.error({ err }, 'worker tick failed'))
        .finally(() => {
          this.ticking = null;
          this.scheduleNext(this.config.worker.pollIntervalMs);
        });
    }, delayMs);
  }

  /** 执行一个投递周期。导出为公有方法便于测试单步驱动。 */
  async tick(): Promise<void> {
    const now = this.now();

    const reaped = this.store.reapStale(now, this.config.worker.visibilityTimeoutMs);
    if (reaped > 0) {
      this.logger.info({ reaped }, 'reclaimed stale delivering records');
    }

    const batch = this.store.claimBatch(now, this.config.worker.batchSize);
    if (batch.length === 0) return;

    await runWithConcurrency(batch, this.config.worker.concurrency, (rec) =>
      this.deliverOne(rec),
    );
  }

  /** 投递单条并根据结果结算状态。 */
  private async deliverOne(rec: NotificationRecord): Promise<void> {
    let result: DeliveryResult;
    try {
      result = await this.deliver(rec, { timeoutMs: this.config.delivery.timeoutMs });
    } catch (err) {
      // deliver 理论上自己兜住异常；这里再兜一层，当作可重试的网络错误。
      result = { kind: 'network', error: err instanceof Error ? err.message : String(err) };
    }

    const now = this.now();
    const statusCode = result.kind === 'http' ? result.statusCode : null;
    const errorText =
      result.kind === 'network' ? result.error : `unexpected status ${result.statusCode}`;

    switch (classify(result)) {
      case 'success':
        this.store.markSucceeded(rec.id, result.kind === 'http' ? result.statusCode : 0, now);
        break;

      case 'permanent':
        this.store.markFailed(rec.id, statusCode, errorText, now);
        this.logger.info({ id: rec.id, statusCode }, 'delivery permanently failed');
        break;

      case 'retryable': {
        const attempts = rec.attempts + 1;
        if (attempts >= rec.maxAttempts) {
          this.store.markDeadLetter(rec.id, statusCode, errorText, now);
          this.logger.info({ id: rec.id, attempts }, 'moved to dead_letter');
        } else {
          const delay = backoff(attempts, this.config.retry);
          this.store.markRetry(rec.id, now + delay, errorText, statusCode, now);
        }
        break;
      }
    }
  }
}

/**
 * 以固定并发上限运行一组异步任务。
 * 简单的「工人拉取」模型：启动 min(limit, n) 个 worker，各自循环取下一个索引。
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await fn(current);
    }
  });
  await Promise.all(workers);
}
