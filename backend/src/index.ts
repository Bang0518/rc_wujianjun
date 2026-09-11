import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { NotificationStore } from './db/store.js';
import { buildApp } from './server/app.js';
import { Worker } from './worker/worker.js';

/**
 * 组合根：装配配置、数据库、HTTP server 与投递 worker，
 * 并在收到终止信号时优雅退出（先停 worker，再关 server 与数据库）。
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const store = new NotificationStore(db);

  const app = buildApp({ store, config, logger: true });
  const worker = new Worker({ store, config, logger: app.log });

  worker.start();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    { port: config.port, dbPath: config.dbPath },
    'notification delivery service started',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await worker.stop(); // 先停止取新件，并等待在途 tick 结束
      await app.close(); // 停止接收新请求
      db.close();
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('failed to start service:', err);
  process.exit(1);
});
