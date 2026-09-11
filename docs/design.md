# 设计文档：通知投递服务（出向 Webhook 网关）

> 交付物 1 的深化版。README 讲「怎么用」，本文讲「为什么这么设计」。
> 评分主线的 6 个必答问题在 §3–§5 用醒目标题逐一回答。

## 1. 问题理解

企业内部多个业务系统在关键事件发生时，要调用**外部供应商的 HTTP API** 发通知（引流注册回调、CRM 状态变更、库存变更等）。这些外部 API 地址各异、鉴权各异，且**业务方不关心返回值，只关心「稳定、可靠地送达」**。

如果每个业务系统各自实现重试与失败处理，会出现：重复造轮子、重试策略不一致、故障时互相放大、无法统一观测。本系统把「重试、失败兜底、削峰、可观测」这一横切复杂度**从各业务系统收敛到一处**，业务方只需提交 `{url, headers, body}`。

## 2. 整体架构

单进程、单节点、零外部依赖。三条链路共享一张 SQLite 表：

```
业务系统                本服务（单进程）                       外部供应商
   │                                                             
   │ POST /notifications                                         
   ├───────────────►  ┌───────────┐  INSERT(pending)  ┌────────────────┐
   │  202 + id        │  Ingest    │ ────────────────► │                │
   │ ◄────────────────│  (Fastify) │                   │  SQLite        │
   │                  └───────────┘                    │  notifications │
   │                                                    │  (= outbox)    │
   │                  ┌───────────┐  claimBatch(原子)   │                │
   │                  │  Worker    │ ◄──────────────────│                │
   │                  │  (轮询)     │  UPDATE(结算)       └────────────────┘
   │                  └─────┬─────┘                            
   │                        │ fetch(url, ...)         ┌────────────────┐
   │                        └────────────────────────►│  Vendor API    │
   │                          2xx/4xx/5xx/超时          └────────────────┘
   │ GET /notifications/:id, /stats                    
   ├───────────────►  查询状态（面板 / 业务方）          
```

- **Ingest（接入）**：Fastify HTTP 服务。校验请求 → 事务内落库为 `pending` → 立即返回 `202 + id`。
- **Store（存储）**：SQLite 单表 `notifications`，同时是业务记录与**事务型 outbox**。
- **Worker（投递）**：单循环轮询。`reap 超时 → claim 一批 → 受并发上限地投递 → 结算状态`。
- **Observability（可观测）**：`GET /:id`、`GET /`、`GET /stats` + 结构化日志；前端轻量面板消费这些接口。

数据模型与状态机见 §6。

---

## 3. 【必答 2.1】系统边界

### 在本系统内解决
1. **统一接入**：业务方只提交 `url/method/headers/body`，不各自实现投递。
2. **异步、削峰**：先落库再返回，接入与外部时延解耦；worker 以固定并发平滑地对外投递。
3. **至少一次可靠送达**：持久化 + 自动重试（见 §4）。
4. **失败兜底**：永久失败快速止损（`failed`），可重试失败耗尽后进 `dead_letter`，不无限重试放大故障。
5. **提交侧幂等**：可选 `Idempotency-Key`，避免业务方网络抖动导致重复入库。
6. **可观测**：投递状态、尝试次数、最近错误/状态码、死信可查。

### 明确不解决，及原因
| 不做 | 原因 |
|---|---|
| **外部响应体的处理/转发** | 需求明确「业务方不关心返回值」。只读状态码判定成败、丢弃 body。 |
| **接收侧去重 / exactly-once** | at-least-once 下重复投递是固有属性，去重是**外部供应商**的职责（其接口应幂等）。分布式 exactly-once 需 2PC/对端配合，成本远超收益。 |
| **严格投递顺序** | 各通知相互独立，业务未提出顺序诉求。保证顺序需串行化，显著牺牲吞吐。 |
| **鉴权 / 多租户 / 配额** | 定位为**内部可信网络**内的基础设施。放到网关内会混入与「可靠送达」无关的复杂度；需要时由上游网关/mTLS 承担。 |
| **跨机房高可用 / 水平扩展** | 第一版规模匹配单节点即可（见 §7 演进）。 |
| **投递记录的长期归档 / 审计回放** | MVP 只保状态；审计是后续演进（尝试历史表）。 |

> 判断依据：凡是「业务未提出、且会显著增加复杂度」的能力，一律先划到边界外，用文档声明，而不是提前实现。

---

## 4. 【必答 2.2】可靠性与失败处理

### 投递语义：至少一次（at-least-once）
- **先落地再返回**：`POST` 在一个 SQLite 事务里 `INSERT`（`pending`）后才回 `202`。WAL + `synchronous=NORMAL` 保证已受理的请求在崩溃后仍在库。
- **崩溃恢复**：
  - 重启后 `pending` 记录被轮询自然重新取件；
  - 崩溃时正处于 `delivering` 的记录，由 `reapStale` 在 `visibilityTimeoutMs`（默认 30s，须 > 投递超时）后重置为 `pending` 重投。
- **诚实的代价**：若「投递成功但在 `markSucceeded` 落库前进程崩溃」，恢复后会重投一次 → **可能重复送达**。这是 at-least-once 的固有属性，接收侧幂等由供应商负责。

我们**刻意不做 exactly-once**：其收益（去重）可由对端幂等更廉价地获得，而实现成本极高。

### 外部系统失败 / 长期不可用
- **结果分类**（`retry.ts::classify`）：
  - `2xx` → 成功；
  - `408/429/5xx`、网络错误、超时 → **可重试**；
  - 其他 `4xx`（400/401/403/404/422…）→ **永久失败**，直接 `failed`，不进重试循环（对坏请求快速止损，避免故障放大）。
- **指数退避 + full jitter + 上限**（`retry.ts::backoff`）：`delay = random(0, min(base·factor^(n-1), cap))`。默认 `base=1s, factor=2, cap=1h, maxAttempts=8`。
  - **`cap` 是长期不可用的关键**：把重试频率压到最坏每小时一次，既持续尝试恢复，又不放大故障、不打爆外部；
  - jitter 打散多条记录的重试时刻，避免同时重试形成尖峰。
- **死信**：可重试错误耗尽 `maxAttempts` → `dead_letter`，停止重试并保留 `last_error/last_status_code`，供排查与**手动重放**（`POST /:id/retry`）。
- **自我保护**：worker 固定 `concurrency`（默认 5）与 `batchSize` 限制对外压力与自身资源占用。

---

## 5. 【必答 2.3】取舍与演进

### 被判定为「过度设计」而不采纳（附依据）
| 被否决方案 | 为何是过度设计 | MVP 的替代 |
|---|---|---|
| 外部 MQ（Kafka/RabbitMQ/Redis Stream） | 为一个中等量级内部网关引入独立中间件的部署/运维/依赖成本；SQLite 事务型 outbox 已提供持久队列 + 至少一次 | SQLite outbox + 轮询 |
| 熔断器（circuit breaker） | 核心诉求「长期不可用不放大故障」已由**退避上限 + 死信 + 并发上限**覆盖；per-host 滑窗统计/half-open 是为尚未出现的「单目标拖垮共享 worker」提前付费 | 退避上限 + 死信 |
| 分布式追踪（OTel/Jaeger） | 单进程单节点，结构化日志 + `/stats` + 状态查询足以排障 | pino 日志 + 查询接口 |
| 多租户 / 鉴权 / RBAC | 内部可信网络，边界外 | 文档声明 |
| 动态限流 / per-destination 限速 | 固定并发上限已足够保护自身与外部 | 固定 concurrency |
| 水平扩展 / leader 选举 / 分布式锁 | 单进程 + 同步事务已无并发问题 | 单 worker |
| 可插拔存储抽象层 / Repository 泛化 | YAGNI；一个内聚 `store.ts` 就是未来迁库的天然改动边界 | 单一 store 模块 |
| Webhook 签名 / 响应体捕获转发 | 业务方明确不关心响应值 | 只读状态码 |
| 独立 CLI 包（第四 workspace） | 演示用 `scripts/seed.sh`（curl）即可 | seed 脚本 |

> 一句话依据：**把复杂度花在「已被需求证明的问题」上**。对尚未出现的问题，用文档记录演进触发条件，而不是提前实现。

### 演进路线（流量 / 复杂度增长时）
1. **吞吐上升** → 先调大 `worker.concurrency` / `batchSize`；SQLite 写入触顶 → 迁 PostgreSQL（**`store.ts` 是唯一改动面**）。
2. **多实例 / 高可用** → claim 已用 `BEGIN IMMEDIATE` 原子取件，可直接多进程打同库；再大则换 Postgres `SELECT ... FOR UPDATE SKIP LOCKED`，或引入 MQ。
3. **单目标拖累共享 worker**（队头阻塞）→ 引入**按目标退避/隔离**，此时熔断器才有正收益。
4. **审计 / 回放需求** → 增加投递尝试历史表（attempts log）。
5. **运维需求** → 补 `cli/` 包与死信批量重放。

---

## 6. 数据模型与状态机

单表 `notifications`（**不拆 outbox 与业务两张表**——通知请求本身就是待投递项，无独立领域实体需要分离；拆分即过度设计）。关键列：

`id, idempotency_key(UNIQUE), url, method, headers(JSON), body, status, attempts, max_attempts, next_attempt_at, locked_at, last_error, last_status_code, created_at, updated_at`

索引：`(status, next_attempt_at)`（worker 取件热路径）、`(status, created_at DESC)`（面板列表）。
PRAGMA：`journal_mode=WAL`（API 读不阻塞 worker 写）、`synchronous=NORMAL`、`busy_timeout=5000`。

**状态机（5 态）**：

```
 pending ──claim──► delivering ──2xx────────────────► succeeded (终态)
    ▲                   │  │ 非408/429的4xx ─────────► failed    (终态)
    │ 退避到期/reap回收    │  │ 408/429/5xx/网络/超时:
    └───────────────────┘  │   ├─ attempts<max → pending(退避后)
                           │   └─ attempts≥max → dead_letter (终态)
```

- `claimBatch` 在 `BEGIN IMMEDIATE` 事务里「选中到期 pending → 置 delivering」。因 better-sqlite3 同步执行，事务期间无 JS 交错，**claim 天然原子**，单 worker 无需应用层锁。
- `reapStale` 回收 `locked_at` 过旧的 `delivering`（崩溃恢复）。

---

## 7. 中间件与依赖说明（应评分标准 §3）

| 依赖 | 为什么选它 | 不用它的替代方案 |
|---|---|---|
| **SQLite / better-sqlite3** | 零外部依赖即得「持久化 + 事务 + 队列」；**同步事务**把并发复杂度消灭在语言层；自带预编译二进制，`npm install` 即可 | 用 Postgres（需部署 DB）；或纯内存队列（丢持久性，不满足至少一次） |
| **Fastify** | 内建 JSON Schema 校验 + 响应序列化（直接落地契约，免引 zod）、内建 pino 日志、`inject()` 便于测试、`@fastify/static` 单进程托管前端 | Express（需自行拼装校验/日志/静态）；原生 http（更底层，重复造轮子） |
| **原生 fetch + AbortController** | Node 18+ 内置，零依赖，超时用 abort 即可 | axios/got/undici（MVP 无需其额外能力） |
| **yaml** | 小而准的 YAML 解析，配合 `config.ts` 做强类型校验 | js-yaml（等价）；JSON 配置（可读性差） |
| **vitest** | TS 原生、workspace 支持、与前端 Vite 同源 | jest + ts-jest（配置更重） |

评价重点不是「功能齐全」，而是这些选择背后的**判断与取舍逻辑**。

---

## 8. 目录结构

npm workspaces 单仓多包：`common/`（前后端共享类型，契约真相源）、`backend/`（Fastify + worker + SQLite）、`frontend/`（Vite+React 可观测面板），并保留 `configs/ docs/ scripts/ test/`。详见根 `readme.md`。
