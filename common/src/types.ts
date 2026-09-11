/**
 * 前后端共享的领域类型。
 *
 * 这里只放「契约」——请求/响应 DTO 与投递记录的形状，
 * 不含任何运行时逻辑，避免前端被后端实现细节耦合。
 */

/** 通知投递的生命周期状态机。 */
export const NOTIFICATION_STATUSES = [
  'pending', // 已受理、等待或到期待投递
  'delivering', // worker 已取件、正在投递
  'succeeded', // 外部返回 2xx，终态
  'failed', // 永久性错误（非可重试的 4xx），终态
  'dead_letter', // 可重试错误但已耗尽重试次数，终态
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** 允许投递的 HTTP 方法。 */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** 业务系统提交通知时的请求体（POST /notifications）。 */
export interface NotificationRequest {
  /** 目标地址，必须是 http/https。 */
  url: string;
  /** HTTP 方法，缺省 POST。 */
  method?: HttpMethod;
  /** 附加请求头（会与默认 content-type 合并）。 */
  headers?: Record<string, string>;
  /** 请求体，对象会被序列化为 JSON；字符串原样发送。 */
  body?: unknown;
  /** 覆盖默认最大重试次数。 */
  maxAttempts?: number;
}

/** POST /notifications 的受理响应（202，或幂等命中时 200）。 */
export interface CreateNotificationResponse {
  id: string;
  status: NotificationStatus;
  createdAt: number;
}

/** 一条通知的完整记录（GET /notifications/:id 与列表项）。 */
export interface NotificationRecord {
  id: string;
  idempotencyKey: string | null;
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body: unknown;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  /** 下次可被取件投递的时间（epoch ms）。 */
  nextAttemptAt: number;
  /** 进入 delivering 的时间，用于超时回收；非 delivering 时为 null。 */
  lockedAt: number | null;
  lastError: string | null;
  lastStatusCode: number | null;
  createdAt: number;
  updatedAt: number;
}

/** GET /notifications 列表响应。 */
export interface ListResponse {
  items: NotificationRecord[];
  total: number;
}

/** GET /stats 各状态计数。 */
export type StatsResponse = Record<NotificationStatus, number>;

/** 统一错误响应体。 */
export interface ErrorResponse {
  error: string;
  message?: string;
}
