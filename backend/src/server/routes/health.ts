import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // 存活探测。
  app.get('/healthz', async () => ({ status: 'ok' }));
}
