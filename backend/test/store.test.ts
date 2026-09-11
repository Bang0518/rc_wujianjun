import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { NotificationStore } from '../src/db/store.js';

function insert(store: NotificationStore, id: string, now: number, overrides: Partial<{ maxAttempts: number; key: string }> = {}) {
  store.insert({
    id,
    idempotencyKey: overrides.key ?? null,
    url: 'https://example.com/hook',
    method: 'POST',
    headers: { 'x-test': '1' },
    body: JSON.stringify({ hello: 'world' }),
    maxAttempts: overrides.maxAttempts ?? 8,
    now,
  });
}

describe('NotificationStore', () => {
  let db: Database.Database;
  let store: NotificationStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new NotificationStore(db);
  });

  afterEach(() => db.close());

  it('落库后可按 id 查回，初始为 pending', () => {
    const now = Date.now();
    insert(store, 'a', now);
    const rec = store.getById('a');
    expect(rec?.status).toBe('pending');
    expect(rec?.attempts).toBe(0);
    expect(rec?.headers).toEqual({ 'x-test': '1' });
    expect(rec?.body).toEqual({ hello: 'world' });
  });

  it('claimBatch 只取到期的 pending，并置为 delivering', () => {
    const now = Date.now();
    insert(store, 'a', now);
    insert(store, 'b', now);

    const claimed = store.claimBatch(now, 10);
    expect(claimed.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(claimed.every((r) => r.status === 'delivering')).toBe(true);

    // 再次 claim 应为空（都已 delivering）。
    expect(store.claimBatch(now, 10)).toHaveLength(0);
  });

  it('claimBatch 不取未到期的记录', () => {
    const now = Date.now();
    insert(store, 'future', now);
    // 把它推到未来
    store.markRetry('future', now + 60_000, 'retry later', 503, now);
    expect(store.claimBatch(now, 10)).toHaveLength(0);
    expect(store.claimBatch(now + 60_000, 10).map((r) => r.id)).toEqual(['future']);
  });

  it('两次 claim 不会取到同一条（取件互斥）', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) insert(store, `n${i}`, now);
    const first = store.claimBatch(now, 3);
    const second = store.claimBatch(now, 3);
    const ids = new Set([...first, ...second].map((r) => r.id));
    expect(ids.size).toBe(first.length + second.length); // 无重叠
    expect(first.length + second.length).toBeLessThanOrEqual(5);
  });

  it('markSucceeded / markFailed / markDeadLetter 到达终态', () => {
    const now = Date.now();
    insert(store, 's', now);
    insert(store, 'f', now);
    insert(store, 'd', now);
    store.claimBatch(now, 10);

    store.markSucceeded('s', 200, now);
    store.markFailed('f', 404, 'not found', now);
    store.markDeadLetter('d', 500, 'boom', now);

    expect(store.getById('s')?.status).toBe('succeeded');
    expect(store.getById('f')?.status).toBe('failed');
    expect(store.getById('d')?.status).toBe('dead_letter');
    expect(store.getById('d')?.lockedAt).toBeNull();
  });

  it('reapStale 回收超时的 delivering', () => {
    const now = Date.now();
    insert(store, 'stuck', now);
    store.claimBatch(now, 10); // locked_at = now

    // 未超时：不回收
    expect(store.reapStale(now + 1000, 30_000)).toBe(0);
    // 超时：回收为 pending
    expect(store.reapStale(now + 31_000, 30_000)).toBe(1);
    expect(store.getById('stuck')?.status).toBe('pending');
  });

  it('requeue 只对 failed/dead_letter 生效并归零 attempts', () => {
    const now = Date.now();
    insert(store, 'd', now, { maxAttempts: 1 });
    store.claimBatch(now, 10);
    store.markDeadLetter('d', 500, 'boom', now);

    expect(store.requeue('d', now)).toBe(true);
    const rec = store.getById('d');
    expect(rec?.status).toBe('pending');
    expect(rec?.attempts).toBe(0);

    // pending 记录不可 requeue
    expect(store.requeue('d', now)).toBe(false);
  });

  it('list 支持状态过滤与总数', () => {
    const now = Date.now();
    insert(store, 'a', now);
    insert(store, 'b', now);
    store.claimBatch(now, 10);
    store.markSucceeded('a', 200, now);

    const all = store.list({ limit: 50, offset: 0 });
    expect(all.total).toBe(2);

    const succeeded = store.list({ status: 'succeeded', limit: 50, offset: 0 });
    expect(succeeded.total).toBe(1);
    expect(succeeded.items[0]?.id).toBe('a');
  });

  it('stats 返回各状态计数，缺省为 0', () => {
    const now = Date.now();
    insert(store, 'a', now);
    const s = store.stats();
    expect(s.pending).toBe(1);
    expect(s.succeeded).toBe(0);
    expect(s.dead_letter).toBe(0);
  });
});
