import type Database from 'better-sqlite3';

/**
 * 数据库迁移。
 *
 * MVP 只有单表：使用幂等 DDL（IF NOT EXISTS），启动时无脑执行即可，
 * 不引入迁移框架（对单表演进是过度设计）。
 *
 * `notifications` 表同时充当业务记录与事务型 outbox——通知请求本身
 * 就是待投递项，没有独立于投递项之外的领域实体需要分离，故不拆两张表。
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id               TEXT    PRIMARY KEY,
      idempotency_key  TEXT    UNIQUE,
      url              TEXT    NOT NULL,
      method           TEXT    NOT NULL,
      headers          TEXT    NOT NULL DEFAULT '{}',
      body             TEXT,
      status           TEXT    NOT NULL,
      attempts         INTEGER NOT NULL DEFAULT 0,
      max_attempts     INTEGER NOT NULL,
      next_attempt_at  INTEGER NOT NULL,
      locked_at        INTEGER,
      last_error       TEXT,
      last_status_code INTEGER,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );

    -- worker 取件热路径：按 (status, next_attempt_at) 找到期的 pending
    CREATE INDEX IF NOT EXISTS idx_notifications_claim
      ON notifications (status, next_attempt_at);

    -- 面板列表 / 状态过滤
    CREATE INDEX IF NOT EXISTS idx_notifications_status_created
      ON notifications (status, created_at DESC);
  `);
}
