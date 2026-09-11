import { describe, it, expect } from 'vitest';
import { backoff, classify } from '../src/worker/retry.js';

describe('classify', () => {
  it('2xx → success', () => {
    expect(classify({ kind: 'http', statusCode: 200 })).toBe('success');
    expect(classify({ kind: 'http', statusCode: 204 })).toBe('success');
  });

  it('408 / 429 / 5xx → retryable', () => {
    expect(classify({ kind: 'http', statusCode: 408 })).toBe('retryable');
    expect(classify({ kind: 'http', statusCode: 429 })).toBe('retryable');
    expect(classify({ kind: 'http', statusCode: 500 })).toBe('retryable');
    expect(classify({ kind: 'http', statusCode: 503 })).toBe('retryable');
  });

  it('其他 4xx → permanent', () => {
    expect(classify({ kind: 'http', statusCode: 400 })).toBe('permanent');
    expect(classify({ kind: 'http', statusCode: 401 })).toBe('permanent');
    expect(classify({ kind: 'http', statusCode: 404 })).toBe('permanent');
    expect(classify({ kind: 'http', statusCode: 422 })).toBe('permanent');
  });

  it('网络错误/超时 → retryable', () => {
    expect(classify({ kind: 'network', error: 'timeout' })).toBe('retryable');
  });
});

describe('backoff', () => {
  const opts = { baseMs: 1000, factor: 2, capMs: 60_000 };

  it('永远落在 [0, min(base*factor^(n-1), cap)] 区间内', () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const raw = 1000 * Math.pow(2, attempt - 1);
      const upper = Math.min(raw, opts.capMs);
      for (let i = 0; i < 50; i++) {
        const d = backoff(attempt, opts);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(upper);
      }
    }
  });

  it('退避上限生效：大 attempts 不超过 capMs', () => {
    for (let i = 0; i < 100; i++) {
      expect(backoff(20, opts)).toBeLessThanOrEqual(opts.capMs);
    }
  });
});
