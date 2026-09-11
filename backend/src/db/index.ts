import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';

/**
 * 打开 SQLite 连接并完成初始化。
 *
 * PRAGMA 选择说明：
 * - journal_mode=WAL：读写并发。API 查询状态时不会阻塞 worker 的写入。
 * - synchronous=NORMAL：WAL 下的推荐值，兼顾持久性与吞吐。
 * - busy_timeout：遇到写锁时最多等待，避免瞬时竞争直接抛错。
 */
export function openDatabase(dbPath: string): Database.Database {
  // `:memory:` 用于测试；文件路径则确保父目录存在。
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}
