import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { NotificationStore } from '../db/store.js';
import type { AppConfig } from '../config.js';
import { notificationRoutes } from './routes/notifications.js';
import { statsRoutes } from './routes/stats.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  store: NotificationStore;
  config: AppConfig;
  /** 是否开启日志（测试时可关闭）。 */
  logger?: boolean;
  /** 是否托管前端静态资源（默认在 dist 存在时开启）。 */
  serveFrontend?: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
// 编译后位于 backend/dist/server/app.js → 前端在 <repo>/frontend/dist
const frontendDist = join(here, '..', '..', '..', 'frontend', 'dist');

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? false,
    // body 里允许任意 JSON，关闭多余的类型强制。
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true } },
  });

  app.register(notificationRoutes, { store: opts.store, config: opts.config });
  app.register(statsRoutes, { store: opts.store });
  app.register(healthRoutes);

  // 生产：单进程托管前端构建产物，同源访问面板，无需 CORS。
  const shouldServe = opts.serveFrontend ?? existsSync(frontendDist);
  if (shouldServe && existsSync(frontendDist)) {
    app.register(fastifyStatic, { root: frontendDist });
    // SPA 兜底：非 API 路径回退到 index.html。
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/notifications') && !req.url.startsWith('/stats')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: 'validation', message: err.message });
    }
    app.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'internal', message: 'internal server error' });
  });

  return app;
}
