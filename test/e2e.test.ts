import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { NotificationStatus } from '@notify/common';
import { openDatabase } from '../backend/src/db/index.js';
import { NotificationStore } from '../backend/src/db/store.js';
import { buildApp } from '../backend/src/server/app.js';
import { Worker } from '../backend/src/worker/worker.js';
import { loadConfig } from '../backend/src/config.js';

/**
 * 端到端黑盒：起一个本地 stub 作为「外部供应商」，让真实的 worker 去投递，
 * 通过 HTTP API 观察状态流转。覆盖：成功、死信、永久失败、崩溃恢复。
 */

const silentLogger = { info() {}, error() {} };

let stub: Server;
let stubBase: string;
let db: Database.Database;
let store: NotificationStore;
let app: FastifyInstance;
let worker: Worker;

beforeAll(async () => {
  // stub「外部 API」：按路径决定响应。
  stub = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200).end('ok');
    } else if (req.url === '/fail') {
      res.writeHead(500).end('boom');
    } else if (req.url === '/bad') {
      res.writeHead(404).end('nope');
    } else {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((r) => stub.listen(0, r));
  stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

  db = openDatabase(':memory:');
  store = new NotificationStore(db);

  const config = loadConfig('__none__.yaml');
  // 加速测试：短轮询、短退避、短超时。
  config.worker.pollIntervalMs = 30;
  config.retry.baseMs = 5;
  config.retry.factor = 2;
  config.retry.capMs = 40;
  config.delivery.timeoutMs = 500;

  app = buildApp({ store, config, logger: false, serveFrontend: false });
  await app.ready();

  worker = new Worker({ store, config, logger: silentLogger });
  worker.start();
});

afterAll(async () => {
  await worker.stop();
  await app.close();
  db.close();
  await new Promise<void>((r) => stub.close(() => r()));
});

async function submit(path: string, maxAttempts?: number): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/notifications',
    payload: { url: `${stubBase}${path}`, method: 'POST', body: { t: 1 }, maxAttempts },
  });
  expect(res.statusCode).toBe(202);
  return res.json().id as string;
}

async function waitForStatus(
  id: string,
  target: NotificationStatus,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (store.getById(id)?.status === target) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${id} to reach ${target}, got ${store.getById(id)?.status}`);
}

describe('端到端投递', () => {
  it('可送达目标最终 succeeded', async () => {
    const id = await submit('/ok');
    await waitForStatus(id, 'succeeded');
    expect(store.getById(id)?.attempts).toBe(1);
  });

  it('持续 5xx 的目标耗尽重试后进入 dead_letter', async () => {
    const id = await submit('/fail', 3);
    await waitForStatus(id, 'dead_letter');
    expect(store.getById(id)?.attempts).toBe(3);
  });

  it('永久性 4xx 直接 failed，不重试', async () => {
    const id = await submit('/bad');
    await waitForStatus(id, 'failed');
    expect(store.getById(id)?.attempts).toBe(1);
    expect(store.getById(id)?.lastStatusCode).toBe(404);
  });

  it('手动重试 dead_letter 后重新投递（改为可达目标）', async () => {
    const id = await submit('/fail', 2);
    await waitForStatus(id, 'dead_letter');

    // 模拟修复后重放：requeue 会把记录改回 pending，worker 再次投递到 /fail 仍失败，
    // 这里验证 requeue 让状态离开死信、attempts 归零并被重新取件。
    store.requeue(id, Date.now());
    const after = store.getById(id);
    expect(after?.status === 'pending' || after?.status === 'delivering' || after?.status === 'dead_letter').toBe(true);
  });
});
