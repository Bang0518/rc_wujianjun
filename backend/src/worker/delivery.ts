import type { NotificationRecord } from '@notify/common';
import type { DeliveryResult } from './retry.js';

export interface DeliveryOptions {
  /** 单次投递超时（ms）。 */
  timeoutMs: number;
}

/**
 * 执行一次 HTTP 投递。
 *
 * 设计要点：
 * - 用 AbortController 实现超时（原生 fetch 无内建超时）。
 * - `redirect: 'manual'`：出向网关不自动跟随重定向，避免目标返回 3xx 把请求
 *   引到非预期地址而扩大 SSRF 面；3xx 会被当作「非 2xx」按分类规则处理。
 * - 业务方不关心响应体，这里只取状态码、主动不读 body，减少内存与时延。
 */
export async function deliver(
  rec: NotificationRecord,
  opts: DeliveryOptions,
): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  const hasBody = rec.method !== 'GET' && rec.body != null;
  const headers: Record<string, string> = { ...rec.headers };
  let payload: string | undefined;
  if (hasBody) {
    payload = typeof rec.body === 'string' ? rec.body : JSON.stringify(rec.body);
    // 仅在调用方未显式指定时补默认 content-type（大小写不敏感检查）。
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }

  try {
    const res = await fetch(rec.url, {
      method: rec.method,
      headers,
      body: payload,
      signal: controller.signal,
      redirect: 'manual',
    });
    return { kind: 'http', statusCode: res.status };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      kind: 'network',
      error: isAbort ? `timeout after ${opts.timeoutMs}ms` : errorMessage(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // fetch 的底层网络错误常挂在 cause 上，带上更有助于排障。
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg =
      cause instanceof Error ? `: ${cause.message}` : cause ? `: ${String(cause)}` : '';
    return `${err.message}${causeMsg}`;
  }
  return String(err);
}
