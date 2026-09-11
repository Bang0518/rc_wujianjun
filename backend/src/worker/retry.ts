import { isRetryableStatus, isSuccessStatus } from '@notify/common';

/** 一次投递尝试的原始结果。 */
export type DeliveryResult =
  | { kind: 'http'; statusCode: number }
  | { kind: 'network'; error: string };

/** 结果分类：决定记录进入哪个终态或是否重试。 */
export type Classification = 'success' | 'retryable' | 'permanent';

/**
 * 把投递结果分类：
 * - 2xx                         → success
 * - 408 / 429 / 5xx / 网络 / 超时 → retryable（外部暂时性问题）
 * - 其他 4xx                     → permanent（请求本身有问题，重试无益，快速止损）
 */
export function classify(result: DeliveryResult): Classification {
  if (result.kind === 'network') return 'retryable';
  if (isSuccessStatus(result.statusCode)) return 'success';
  if (isRetryableStatus(result.statusCode)) return 'retryable';
  return 'permanent';
}

export interface BackoffOptions {
  baseMs: number;
  factor: number;
  capMs: number;
}

/**
 * 指数退避 + full jitter。
 *
 * delay = random(0, min(base * factor^(attempts-1), cap))
 *
 * - 指数增长让偶发抖动快速重试、持续故障拉长间隔；
 * - `capMs` 上限是关键：外部长期不可用时把重试频率压到最坏每小时一次，
 *   避免无限增长的同时也不放大故障；
 * - full jitter 打散多条记录的重试时刻，避免对外部同时打点形成重试潮。
 *
 * @param attempts 本次为第几次重试（从 1 起）。
 */
export function backoff(attempts: number, opts: BackoffOptions): number {
  const raw = opts.baseMs * Math.pow(opts.factor, Math.max(0, attempts - 1));
  const clamped = Math.min(raw, opts.capMs);
  return Math.floor(Math.random() * clamped);
}
