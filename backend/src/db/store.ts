import type Database from 'better-sqlite3';
import type {
  HttpMethod,
  NotificationRecord,
  NotificationStatus,
  StatsResponse,
} from '@notify/common';
import { NOTIFICATION_STATUSES } from '@notify/common';

/** 数据库中的原始行（snake_case）。 */
interface Row {
  id: string;
  idempotency_key: string | null;
  url: string;
  method: string;
  headers: string;
  body: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: number;
  locked_at: number | null;
  last_error: string | null;
  last_status_code: number | null;
  created_at: number;
  updated_at: number;
}

/** 新建一条通知所需的入参。 */
export interface InsertParams {
  id: string;
  idempotencyKey: string | null;
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  /** 已序列化的 body 字符串（对象在上层序列化），可空。 */
  body: string | null;
  maxAttempts: number;
  now: number;
}

/** 把数据库行映射为对外的领域记录。 */
function mapRow(row: Row): NotificationRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    url: row.url,
    method: row.method as HttpMethod,
    headers: safeParse<Record<string, string>>(row.headers, {}),
    body: row.body === null ? null : safeParse<unknown>(row.body, row.body),
    status: row.status as NotificationStatus,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedAt: row.locked_at,
    lastError: row.last_error,
    lastStatusCode: row.last_status_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 通知的全部持久化读写。
 *
 * 系统正确性的核心在于 `claimBatch`：它在一个 `BEGIN IMMEDIATE` 事务里
 * 完成「选中到期 pending → 置为 delivering」。因为 better-sqlite3 是同步 API，
 * 事务执行期间没有任何其他 JS 代码交错运行，claim 天然原子——MVP 单进程
 * 单 worker 无需任何应用层锁；`BEGIN IMMEDIATE` 也让它对未来多进程友好。
 */
export class NotificationStore {
  constructor(private readonly db: Database.Database) {}

  /** 落库一条新通知（pending，立即可投递）。 */
  insert(p: InsertParams): void {
    this.db
      .prepare(
        `INSERT INTO notifications
           (id, idempotency_key, url, method, headers, body, status,
            attempts, max_attempts, next_attempt_at, locked_at,
            last_error, last_status_code, created_at, updated_at)
         VALUES
           (@id, @idempotencyKey, @url, @method, @headers, @body, 'pending',
            0, @maxAttempts, @now, NULL, NULL, NULL, @now, @now)`,
      )
      .run({
        id: p.id,
        idempotencyKey: p.idempotencyKey,
        url: p.url,
        method: p.method,
        headers: JSON.stringify(p.headers),
        body: p.body,
        maxAttempts: p.maxAttempts,
        now: p.now,
      });
  }

  getById(id: string): NotificationRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM notifications WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByIdempotencyKey(key: string): NotificationRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM notifications WHERE idempotency_key = ?')
      .get(key) as Row | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * 原子取件：选出到期的 pending 记录并置为 delivering。
   * 返回被本次取走的记录（已是 delivering 状态的快照）。
   */
  claimBatch(now: number, batchSize: number): NotificationRecord[] {
    const tx = this.db.transaction((limit: number): Row[] => {
      const rows = this.db
        .prepare(
          `SELECT * FROM notifications
            WHERE status = 'pending' AND next_attempt_at <= @now
            ORDER BY next_attempt_at ASC
            LIMIT @limit`,
        )
        .all({ now, limit }) as Row[];

      if (rows.length === 0) return [];

      const mark = this.db.prepare(
        `UPDATE notifications
            SET status = 'delivering', locked_at = @now, updated_at = @now
          WHERE id = @id`,
      );
      for (const r of rows) mark.run({ id: r.id, now });
      return rows;
    });

    // better-sqlite3：默认事务用 BEGIN；这里用 immediate 取写锁以对未来多进程安全。
    const rows = tx.immediate(batchSize) as Row[];
    return rows.map((r) => ({ ...mapRow(r), status: 'delivering' as const, lockedAt: now }));
  }

  /** 投递成功（终态）。 */
  markSucceeded(id: string, statusCode: number, now: number): void {
    this.db
      .prepare(
        `UPDATE notifications
            SET status = 'succeeded', attempts = attempts + 1,
                last_status_code = @statusCode, last_error = NULL,
                locked_at = NULL, updated_at = @now
          WHERE id = @id`,
      )
      .run({ id, statusCode, now });
  }

  /** 可重试失败：递增 attempts、安排下次投递时间，退回 pending。 */
  markRetry(
    id: string,
    nextAttemptAt: number,
    lastError: string,
    lastStatusCode: number | null,
    now: number,
  ): void {
    this.db
      .prepare(
        `UPDATE notifications
            SET status = 'pending', attempts = attempts + 1,
                next_attempt_at = @nextAttemptAt, last_error = @lastError,
                last_status_code = @lastStatusCode, locked_at = NULL,
                updated_at = @now
          WHERE id = @id`,
      )
      .run({ id, nextAttemptAt, lastError, lastStatusCode, now });
  }

  /** 永久性失败（非可重试的 4xx，终态）。 */
  markFailed(
    id: string,
    lastStatusCode: number | null,
    lastError: string,
    now: number,
  ): void {
    this.db
      .prepare(
        `UPDATE notifications
            SET status = 'failed', attempts = attempts + 1,
                last_status_code = @lastStatusCode, last_error = @lastError,
                locked_at = NULL, updated_at = @now
          WHERE id = @id`,
      )
      .run({ id, lastStatusCode, lastError, now });
  }

  /** 可重试但已耗尽重试次数（死信，终态）。 */
  markDeadLetter(
    id: string,
    lastStatusCode: number | null,
    lastError: string,
    now: number,
  ): void {
    this.db
      .prepare(
        `UPDATE notifications
            SET status = 'dead_letter', attempts = attempts + 1,
                last_status_code = @lastStatusCode, last_error = @lastError,
                locked_at = NULL, updated_at = @now
          WHERE id = @id`,
      )
      .run({ id, lastStatusCode, lastError, now });
  }

  /**
   * 回收「僵死」的 delivering 记录：worker 崩溃或投递超时后，
   * locked_at 早于 (now - visibilityTimeoutMs) 的记录被退回 pending 重投。
   * 这是 at-least-once 语义在 crash 后的恢复手段。返回被回收的数量。
   */
  reapStale(now: number, visibilityTimeoutMs: number): number {
    const info = this.db
      .prepare(
        `UPDATE notifications
            SET status = 'pending', locked_at = NULL, updated_at = @now,
                last_error = 'reclaimed after visibility timeout'
          WHERE status = 'delivering' AND locked_at < @threshold`,
      )
      .run({ now, threshold: now - visibilityTimeoutMs });
    return info.changes;
  }

  /**
   * 手动重放：把 failed / dead_letter 记录重置为 pending 立即重投。
   * attempts 归零，给运维一个干净的重试预算。返回是否命中。
   */
  requeue(id: string, now: number): boolean {
    const info = this.db
      .prepare(
        `UPDATE notifications
            SET status = 'pending', attempts = 0, next_attempt_at = @now,
                locked_at = NULL, last_error = NULL, last_status_code = NULL,
                updated_at = @now
          WHERE id = @id AND status IN ('failed', 'dead_letter')`,
      )
      .run({ id, now });
    return info.changes > 0;
  }

  /** 列表查询（面板用），可按状态过滤。 */
  list(opts: { status?: NotificationStatus; limit: number; offset: number }): {
    items: NotificationRecord[];
    total: number;
  } {
    // 注意：better-sqlite3 不允许绑定 SQL 中不存在的命名参数，
    // 因此未过滤时不能把 status 传进去。
    const filtered = opts.status !== undefined;
    const where = filtered ? 'WHERE status = @status' : '';

    const countStmt = this.db.prepare(`SELECT COUNT(*) AS c FROM notifications ${where}`);
    const total = (
      filtered ? countStmt.get({ status: opts.status }) : countStmt.get()
    ) as { c: number };

    const listStmt = this.db.prepare(
      `SELECT * FROM notifications ${where}
        ORDER BY created_at DESC
        LIMIT @limit OFFSET @offset`,
    );
    const rows = (
      filtered
        ? listStmt.all({ status: opts.status, limit: opts.limit, offset: opts.offset })
        : listStmt.all({ limit: opts.limit, offset: opts.offset })
    ) as Row[];

    return { items: rows.map(mapRow), total: total.c };
  }

  /** 各状态计数（面板 StatsBar）。 */
  stats(): StatsResponse {
    const base = Object.fromEntries(
      NOTIFICATION_STATUSES.map((s) => [s, 0]),
    ) as StatsResponse;

    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS c FROM notifications GROUP BY status')
      .all() as Array<{ status: string; c: number }>;

    for (const r of rows) {
      if (r.status in base) base[r.status as NotificationStatus] = r.c;
    }
    return base;
  }
}
