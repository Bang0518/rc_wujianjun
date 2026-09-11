/**
 * 前后端共享的常量。
 *
 * 后端用于「结果分类」，前端用于「状态展示」，共用同一份真相源，
 * 避免两端对「哪些状态码可重试」产生分歧。
 */

/**
 * 可重试的 HTTP 状态码：
 * - 408 Request Timeout / 429 Too Many Requests：外部要求稍后重试
 * - 5xx：外部服务端错误，通常是暂时性的
 * 其余 4xx 视为永久性错误（请求本身有问题，重试无益）。
 */
export const RETRYABLE_STATUS_CODES = new Set<number>([408, 429]);

/** 判定一个 HTTP 状态码是否应当重试。 */
export function isRetryableStatus(status: number): boolean {
  if (status >= 500 && status <= 599) return true;
  return RETRYABLE_STATUS_CODES.has(status);
}

/** 判定是否为成功（2xx）。 */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

/** 默认配置常量（configs/*.yaml 缺省时的兜底）。 */
export const DEFAULTS = {
  /** 服务监听端口。 */
  port: 8080,
  /** SQLite 数据库文件路径。 */
  dbPath: 'data/notifications.db',
  worker: {
    /** 轮询间隔（ms）。 */
    pollIntervalMs: 1000,
    /** 单次 tick 取件数量上限。 */
    batchSize: 20,
    /** 并发投递上限。 */
    concurrency: 5,
    /** delivering 记录的可见性超时（ms）；超过则回收重投。须 > delivery.timeoutMs。 */
    visibilityTimeoutMs: 30000,
  },
  delivery: {
    /** 单次投递的超时（ms）。 */
    timeoutMs: 10000,
    /** 默认最大投递尝试次数。 */
    maxAttempts: 8,
  },
  retry: {
    /** 退避基数（ms）。 */
    baseMs: 1000,
    /** 退避指数因子。 */
    factor: 2,
    /** 退避上限（ms），默认 1 小时。 */
    capMs: 60 * 60 * 1000,
  },
} as const;
