import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { DEFAULTS } from '@notify/common';

/** 强类型的运行时配置。 */
export interface AppConfig {
  port: number;
  dbPath: string;
  worker: {
    pollIntervalMs: number;
    batchSize: number;
    concurrency: number;
    visibilityTimeoutMs: number;
  };
  delivery: {
    timeoutMs: number;
    maxAttempts: number;
  };
  retry: {
    baseMs: number;
    factor: number;
    capMs: number;
  };
}

/** 深合并配置片段到默认值之上（仅处理本配置的两层结构）。 */
function withDefaults(raw: Partial<RawConfig> = {}): AppConfig {
  return {
    port: num(raw.port, DEFAULTS.port),
    dbPath: raw.dbPath ?? DEFAULTS.dbPath,
    worker: {
      pollIntervalMs: num(raw.worker?.pollIntervalMs, DEFAULTS.worker.pollIntervalMs),
      batchSize: num(raw.worker?.batchSize, DEFAULTS.worker.batchSize),
      concurrency: num(raw.worker?.concurrency, DEFAULTS.worker.concurrency),
      visibilityTimeoutMs: num(
        raw.worker?.visibilityTimeoutMs,
        DEFAULTS.worker.visibilityTimeoutMs,
      ),
    },
    delivery: {
      timeoutMs: num(raw.delivery?.timeoutMs, DEFAULTS.delivery.timeoutMs),
      maxAttempts: num(raw.delivery?.maxAttempts, DEFAULTS.delivery.maxAttempts),
    },
    retry: {
      baseMs: num(raw.retry?.baseMs, DEFAULTS.retry.baseMs),
      factor: num(raw.retry?.factor, DEFAULTS.retry.factor),
      capMs: num(raw.retry?.capMs, DEFAULTS.retry.capMs),
    },
  };
}

interface RawConfig {
  port: number;
  dbPath: string;
  worker: Partial<AppConfig['worker']>;
  delivery: Partial<AppConfig['delivery']>;
  retry: Partial<AppConfig['retry']>;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * 加载配置：读取 yaml 文件（若存在）→ 用默认值兜底 → 应用环境变量覆盖。
 * 环境变量优先级最高，便于部署时无需改文件即可调参。
 */
export function loadConfig(configPath?: string): AppConfig {
  let raw: Partial<RawConfig> = {};
  const path = configPath ?? process.env.CONFIG_PATH ?? 'configs/default.yaml';
  try {
    raw = parse(readFileSync(path, 'utf8')) ?? {};
  } catch {
    // 配置文件缺失时使用纯默认值——保证零配置也能起。
  }

  const cfg = withDefaults(raw);

  // 环境变量覆盖（部署常用项）。
  if (process.env.PORT) cfg.port = num(process.env.PORT, cfg.port);
  if (process.env.DB_PATH) cfg.dbPath = process.env.DB_PATH;

  return cfg;
}
