import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { NotificationStore } from '../src/db/store.js';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';

describe('HTTP API', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    const store = new NotificationStore(db);
    // 传入不存在的配置路径 → 回落到默认配置。
    const config = loadConfig('__no_such_config__.yaml');
    app = buildApp({ store, config, logger: false, serveFrontend: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('POST /notifications 受理返回 202 + id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/notifications',
      payload: { url: 'https://example.com/hook', body: { event: 'x' } },
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.id).toBeTruthy();
    expect(json.status).toBe('pending');
  });

  it('缺少 url → 400 校验失败', async () => {
    const res = await app.inject({ method: 'POST', url: '/notifications', payload: { body: {} } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
  });

  it('非 http(s) url → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/notifications',
      payload: { url: 'ftp://example.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /notifications/:id 返回记录 / 未知 id 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/notifications',
      payload: { url: 'https://example.com/hook' },
    });
    const { id } = created.json();

    const got = await app.inject({ method: 'GET', url: `/notifications/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(id);

    const missing = await app.inject({ method: 'GET', url: '/notifications/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('Idempotency-Key：重复提交返回同一 id、不新增记录', async () => {
    const payload = { url: 'https://example.com/hook', body: { a: 1 } };
    const headers = { 'idempotency-key': 'key-123' };

    const first = await app.inject({ method: 'POST', url: '/notifications', payload, headers });
    expect(first.statusCode).toBe(202);
    const id1 = first.json().id;

    const second = await app.inject({ method: 'POST', url: '/notifications', payload, headers });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(id1);

    const list = await app.inject({ method: 'GET', url: '/notifications' });
    expect(list.json().total).toBe(1);
  });

  it('GET /stats 返回计数', async () => {
    await app.inject({ method: 'POST', url: '/notifications', payload: { url: 'https://e.com/h' } });
    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pending).toBe(1);
  });

  it('retry：对 pending 记录返回 409', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/notifications',
      payload: { url: 'https://example.com/hook' },
    });
    const { id } = created.json();
    const res = await app.inject({ method: 'POST', url: `/notifications/${id}/retry` });
    expect(res.statusCode).toBe(409);
  });
});
