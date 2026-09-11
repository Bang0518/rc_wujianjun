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

### 目录结构

```
.
├── src/       # 服务核心实现（接入、队列、投递、重试）
├── cli/       # 命令行工具
├── configs/   # 配置文件
├── scripts/   # 构建 / 运行脚本
├── test/      # 测试
├── docs/      # 设计文档
└── memory/    # 作业要求与评分标准（非系统内容）
```

## Quick Start

> 具体命令以最终实现的技术栈为准，以下为标准使用流程。

### 1. 启动服务

```bash
# 按 configs/ 下的配置启动投递服务
./scripts/start.sh
```

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

服务立即返回受理结果（如通知 ID），随后异步投递到目标地址并按策略重试。

### 3. 查询投递状态

```bash
curl http://localhost:8080/notifications/<id>
```