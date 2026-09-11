# 通知投递服务（出向 Webhook 网关）

## 系统介绍

企业内部多个业务系统在关键事件发生时，需要调用**外部供应商的 HTTP(S) API** 发出通知，例如：

- 用户通过第三方广告系统引流并注册成功 → 通知对应广告系统
- 用户订阅付款成功 → 通知 CRM 修改 Contact 状态
- 用户购买商品 → 通知库存系统变更库存

外部 API 的特点是：请求地址不同、Header / Body 格式不同。业务系统**不关心**外部 API 的返回值，**只关心**通知请求能被稳定、可靠地送达。

本系统是一个**内部通知投递服务（出向 Webhook 网关）**：接收业务系统提交的通知请求，异步、可靠地投递到目标地址，把「重试、失败处理、削峰、可观测」这些横切复杂度从各个业务系统里收敛到一处。

### 核心能力

- **统一接入**：业务方只需提交目标地址、Header、Body，无需各自实现重试与失败处理
- **异步投递**：请求先落地再投递，快速返回，与外部 API 的时延解耦
- **可靠送达**：至少一次投递语义，失败自动重试
- **失败兜底**：外部系统长期不可用时进入死信，避免无限重试放大故障
- **可观测**：投递状态、重试次数、失败原因可查

### 技术栈

TypeScript 全栈，npm workspaces 单仓多包：

- **backend**：Fastify（HTTP 接入）+ 轮询 worker（投递/重试）+ better-sqlite3（事务型 outbox）
- **frontend**：Vite + React（轻量可观测面板）
- **common**：前后端共享的类型与常量（契约真相源）

### 目录结构

```
.
├── common/    # @notify/common：前后端共享类型与常量
├── backend/   # @notify/backend：接入 + 队列 + 投递 + 重试
│   └── src/{config,db,server,worker}
├── frontend/  # @notify/frontend：Vite+React 可观测面板
├── configs/   # 配置文件（yaml）
├── scripts/   # 运行 / 开发 / 演示脚本
├── test/      # 端到端黑盒测试（各包单测在 backend/test）
└── docs/      # 设计文档（design / api / ai-usage）+ 评分标准
```

> 设计理念、系统边界、可靠性与取舍详见 [`docs/design.md`](docs/design.md)；
> API 契约见 [`docs/api.md`](docs/api.md)；AI 使用说明见 [`docs/ai-usage.md`](docs/ai-usage.md)。

## Quick Start

### 0. 环境配置

安装 Node.js 18.0+（推荐 20 LTS，仓库含 `.nvmrc`），然后运行 `npm install` 安装依赖。

### 1. 启动服务

```bash
./scripts/start.sh   # 检查 Node → 安装依赖 → 构建 → 单进程启动（:8080）
```

启动后，浏览器打开 <http://localhost:8080> 即可访问**可观测面板**（同进程托管，提交/列表/详情/手动重试）。

开发模式（前端热更新 + 后端 watch）：`./scripts/dev.sh`（面板在 :5173，API 代理到 :8080）。

### 2. 提交一个通知请求

业务系统通过 HTTP 提交待投递的通知：

```bash
curl -X POST http://localhost:8080/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://vendor.example.com/webhook",
    "method": "POST",
    "headers": { "Authorization": "Bearer <token>" },
    "body": { "event": "user_registered", "user_id": "123" }
  }'
```

服务立即返回受理结果（`202` + 通知 ID），随后异步投递到目标地址并按策略重试。
重复提交可带 `Idempotency-Key` 请求头去重。

### 3. 查询投递状态

```bash
curl http://localhost:8080/notifications/<id>   # 单条状态
curl http://localhost:8080/stats                # 各状态计数
```

快速填充演示数据：`./scripts/seed.sh`（需服务已启动）。完整 API 见 [`docs/api.md`](docs/api.md)。

### 4. 构建与测试

```bash
npm run build   # 构建 common / backend / frontend
npm test        # vitest：store/retry/delivery/api 单测 + 端到端黑盒
```