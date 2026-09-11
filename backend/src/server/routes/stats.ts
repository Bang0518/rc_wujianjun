import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { NotificationStore } from '../../db/store.js';

interface RouteDeps extends FastifyPluginOptions {
  store: NotificationStore;
}

export async function statsRoutes(app: FastifyInstance, opts: RouteDeps): Promise<void> {
  // 各状态计数，供面板 StatsBar 展示与过滤。
  app.get('/stats', async () => opts.store.stats());
}
