import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type {
  CreateNotificationResponse,
  HttpMethod,
  NotificationRequest,
  NotificationStatus,
} from '@notify/common';
import type { NotificationStore } from '../../db/store.js';
import type { AppConfig } from '../../config.js';
import { createNotificationSchema, idParamsSchema, listQuerySchema } from '../schemas.js';

interface RouteDeps extends FastifyPluginOptions {
  store: NotificationStore;
  config: AppConfig;
}

export async function notificationRoutes(
  app: FastifyInstance,
  opts: RouteDeps,
): Promise<void> {
  const { store, config } = opts;

  // 提交通知：先落地再返回，保证 at-least-once 的「先持久化」前提。
  app.post<{ Body: NotificationRequest }>(
    '/notifications',
    { schema: createNotificationSchema },
    async (req, reply) => {
      const idempotencyKey = (req.headers['idempotency-key'] as string | undefined) ?? null;

      // 提交侧去重：命中已有记录则幂等复放，不重复创建。
      // 注意这与投递侧的 at-least-once 是不同层面的问题。
      if (idempotencyKey) {
        const existing = store.findByIdempotencyKey(idempotencyKey);
        if (existing) {
          const res: CreateNotificationResponse = {
            id: existing.id,
            status: existing.status,
            createdAt: existing.createdAt,
          };
          return reply.code(200).send(res);
        }
      }

      const now = Date.now();
      const id = randomUUID();
      const body = req.body.body;

      try {
        store.insert({
          id,
          idempotencyKey,
          url: req.body.url,
          method: (req.body.method ?? 'POST') as HttpMethod,
          headers: req.body.headers ?? {},
          body: body == null ? null : typeof body === 'string' ? body : JSON.stringify(body),
          maxAttempts: req.body.maxAttempts ?? config.delivery.maxAttempts,
          now,
        });
      } catch (err) {
        // 幂等键 UNIQUE 冲突的竞态：并发同 key，复放已有记录。
        if (idempotencyKey && isUniqueViolation(err)) {
          const existing = store.findByIdempotencyKey(idempotencyKey);
          if (existing) {
            return reply
              .code(200)
              .send({ id: existing.id, status: existing.status, createdAt: existing.createdAt });
          }
        }
        throw err;
      }

      const res: CreateNotificationResponse = { id, status: 'pending', createdAt: now };
      return reply.code(202).send(res);
    },
  );

  // 查询单条状态。
  app.get<{ Params: { id: string } }>(
    '/notifications/:id',
    { schema: idParamsSchema },
    async (req, reply) => {
      const rec = store.getById(req.params.id);
      if (!rec) return reply.code(404).send({ error: 'not_found' });
      return rec;
    },
  );

  // 列表（面板用）。
  app.get<{ Querystring: { status?: NotificationStatus; limit: number; offset: number } }>(
    '/notifications',
    { schema: listQuerySchema },
    async (req) => {
      const { status, limit, offset } = req.query;
      return store.list({ status, limit, offset });
    },
  );

  // 手动重放：把 failed / dead_letter 重置为 pending。
  app.post<{ Params: { id: string } }>(
    '/notifications/:id/retry',
    { schema: idParamsSchema },
    async (req, reply) => {
      const ok = store.requeue(req.params.id, Date.now());
      if (!ok) {
        return reply
          .code(409)
          .send({ error: 'not_requeuable', message: '记录不存在或不处于 failed/dead_letter 状态' });
      }
      return store.getById(req.params.id);
    },
  );
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
