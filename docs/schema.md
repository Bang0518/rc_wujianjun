# 库表设计

## 1. 为什么是单表

通知请求本身就是「待投递项」，没有独立于投递项之外的领域实体需要分离。
把 outbox 和业务记录合成一张表，换来：

- **无分布式事务**：落库即入队，一次 INSERT 完成「持久化 + 排队」。
- **无一致性缝隙**：不存在「写了业务表但没写队列表」的中间态。
- **迁移简单**：MVP 用幂等 DDL（`IF NOT EXISTS`）在启动时执行，不引迁移框架。

## 2. 表结构 `notifications`

```sql
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
```

## 3. 字段说明

| 列 | 类型 | 可空 | 含义 |
|---|---|---|---|
| `id` | TEXT | 否 | 主键，`crypto.randomUUID()` 生成的 UUID |
| `idempotency_key` | TEXT | 是 | 提交侧幂等键（`Idempotency-Key` 头），`UNIQUE`；未提供则为 NULL |
| `url` | TEXT | 否 | 投递目标地址（`http(s)://`） |
| `method` | TEXT | 否 | HTTP 方法（GET/POST/PUT/PATCH/DELETE） |
| `headers` | TEXT | 否 | 请求头，**JSON 字符串**，缺省 `'{}'` |
| `body` | TEXT | 是 | 请求体；对象在上层序列化为字符串后存入；GET 无 body 则 NULL |
| `status` | TEXT | 否 | 状态机当前态（见 §5） |
| `attempts` | INTEGER | 否 | 已尝试投递次数，缺省 0 |
| `max_attempts` | INTEGER | 否 | 最大尝试次数（请求可覆盖，否则用默认 8） |
| `next_attempt_at` | INTEGER | 否 | 下次可投递时间（epoch ms）；退避通过推后此值实现 |
| `locked_at` | INTEGER | 是 | 进入 `delivering` 的时间；用于可见性超时回收 |
| `last_error` | TEXT | 是 | 最近一次失败原因（状态码文案 / 网络错误 / 超时） |
| `last_status_code` | INTEGER | 是 | 最近一次外部响应状态码 |
| `created_at` | INTEGER | 否 | 创建时间（epoch ms） |
| `updated_at` | INTEGER | 否 | 最后更新时间（epoch ms） |

> 时间统一用 **epoch 毫秒（INTEGER）** 存储，避免时区与字符串解析问题。
> `headers` / `body` 存 JSON 文本，读出时反序列化（见 `store.ts` 的 `mapRow`）。

## 4. 索引

| 索引 | 列 | 用途 |
|---|---|---|
| `idx_notifications_claim` | `(status, next_attempt_at)` | worker 取件热路径：快速定位「到期的 pending」 |
| `idx_notifications_status_created` | `(status, created_at DESC)` | 面板列表与按状态过滤 |

## 5. status 字段与状态机

`status` 取值及流转（终态不再变化）：

| 状态 | 含义 | 由何触发 | 终态 |
|---|---|---|---|
| `pending` | 待投递（含重试等待中） | 新建 / 退避结束 / 回收 / 手动重放 | 否 |
| `delivering` | 投递中 | worker 取件（claim） | 否 |
| `succeeded` | 送达成功（2xx） | 投递成功 | ✅ |
| `failed` | 永久失败（非可重试 4xx） | 如 400/401/404 | ✅ |
| `dead_letter` | 可重试但耗尽次数（进死信） | 5xx/429/超时/网络错且 attempts≥max | ✅ |

```
pending ──claim──► delivering ──┬─ 2xx ─────────► succeeded
   ▲                            ├─ 永久4xx ─────► failed
   │  退避后回填                  ├─ 可重试&未耗尽 ► (退避) ─► pending
   │  / 超时回收 / 手动重放        └─ 可重试&已耗尽 ► dead_letter
   └──────────────────────────────────────────────┘
```

对应 `store.ts` 的写方法：`claimBatch`（→delivering）、`markSucceeded`、
`markFailed`、`markRetry`（→pending）、`markDeadLetter`、`reapStale`（超时回收）、
`requeue`（手动重放 failed/dead_letter → pending）。

## 6. 连接与 PRAGMA

`openDatabase()` 打开连接后设置：

| PRAGMA | 值 | 原因 |
|---|---|---|
| `journal_mode` | `WAL` | 读写并发：API 查状态不阻塞 worker 写入 |
| `synchronous` | `NORMAL` | WAL 下推荐值，兼顾持久性与吞吐 |
| `busy_timeout` | `5000` | 遇写锁最多等 5s，避免瞬时竞争直接抛错 |
| `foreign_keys` | `ON` | 良好默认（当前单表暂无外键） |

## 7. 并发正确性

取件在 `BEGIN IMMEDIATE` 事务内完成「SELECT 到期 pending → UPDATE 为 delivering」。
better-sqlite3 是**同步 API**，事务执行期间没有其他 JS 代码交错，claim 天然原子，
MVP 单进程单 worker **无需应用层锁**；`BEGIN IMMEDIATE` 也让它对未来多进程友好。

## 8. 演进方向

- 吞吐上升：先调 `batchSize` / `concurrency`；触顶后迁 Postgres，`store.ts` 是唯一改动面。
- 多实例：已有 `BEGIN IMMEDIATE`；更大规模换 Postgres `SELECT ... FOR UPDATE SKIP LOCKED`。
- 审计需求：增独立「尝试历史表」记录每次投递明细（当前只保留最近一次错误）。
