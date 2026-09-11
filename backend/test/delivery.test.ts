import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NotificationRecord } from '@notify/common';
import { deliver } from '../src/worker/delivery.js';

function makeRecord(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'x',
    idempotencyKey: null,
    url: 'https://example.com/hook',
    method: 'POST',
    headers: {},
    body: { a: 1 },
    status: 'delivering',
    attempts: 0,
    maxAttempts: 8,
    nextAttemptAt: 0,
    lockedAt: null,
    lastError: null,
    lastStatusCode: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('deliver', () => {
  it('返回外部响应的状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    const res = await deliver(makeRecord(), { timeoutMs: 1000 });
    expect(res).toEqual({ kind: 'http', statusCode: 200 });
  });

  it('5xx 也照实返回状态码（由 classify 决定是否重试）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    const res = await deliver(makeRecord(), { timeoutMs: 1000 });
    expect(res).toEqual({ kind: 'http', statusCode: 503 });
  });

  it('超时 → network 错误且信息含 timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      }),
    );
    const res = await deliver(makeRecord(), { timeoutMs: 20 });
    expect(res.kind).toBe('network');
    if (res.kind === 'network') expect(res.error).toContain('timeout');
  });

  it('网络异常 → network 错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const res = await deliver(makeRecord(), { timeoutMs: 1000 });
    expect(res.kind).toBe('network');
    if (res.kind === 'network') expect(res.error).toContain('ECONNREFUSED');
  });

  it('POST 带 body 时自动补 content-type', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await deliver(makeRecord({ body: { a: 1 } }), { timeoutMs: 1000 });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });
});
