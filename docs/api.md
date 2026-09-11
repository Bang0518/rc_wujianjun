# API 契约

Base URL：`http://localhost:8080`。请求与响应均为 `application/json`。

## POST /notifications — 提交通知

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 目标地址，必须以 `http://` 或 `https://` 开头 |
| `method` | string | 否 | `GET/POST/PUT/PATCH/DELETE`，默认 `POST` |
| `headers` | object(string→string) | 否 | 附加请求头，与默认 `content-type: application/json` 合并 |
| `body` | any | 否 | 任意 JSON；对象会被序列化，字符串原样发送。`GET` 不带 body |
| `maxAttempts` | integer | 否 | 覆盖默认最大尝试次数（1–100） |

可选请求头：`Idempotency-Key: <string>`（提交侧去重）。

响应：
- `202 Accepted` — 新受理：`{ "id": "<uuid>", "status": "pending", "createdAt": 1710000000000 }`
- `200 OK` — 幂等命中（同 `Idempotency-Key` 已存在）：返回已有记录的 `{ id, status, createdAt }`，不重复创建
- `400 Bad Request` — 校验失败：`{ "error": "validation", "message": "..." }`

```bash
curl -X POST http://localhost:8080/notifications \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-9001" \
  -d '{
    "url": "https://vendor.example.com/webhook",
    "method": "POST",
    "headers": { "Authorization": "Bearer <token>" },
    "body": { "event": "user_registered", "user_id": "123" }
  }'
```

## GET /notifications/:id — 查询单条

- `200` — 完整记录（见下方「记录结构」）
- `404` — `{ "error": "not_found" }`

## GET /notifications — 列表（面板用）

Query：`status`（可选，按状态过滤）、`limit`（默认 50，上限 200）、`offset`（默认 0）。

- `200` — `{ "items": NotificationRecord[], "total": number }`

## GET /stats — 状态计数

- `200` — `{ "pending": n, "delivering": n, "succeeded": n, "failed": n, "dead_letter": n }`

## POST /notifications/:id/retry — 手动重放

把 `failed` / `dead_letter` 记录重置为 `pending`（`attempts` 归零，立即可重投）。

- `200` — 重放后的记录
- `409` — `{ "error": "not_requeuable", ... }`（记录不存在，或不处于 failed/dead_letter）

## GET /healthz — 存活探测

- `200` — `{ "status": "ok" }`

---

## 记录结构（NotificationRecord）

```jsonc
{
  "id": "uuid",
  "idempotencyKey": "order-9001",     // 或 null
  "url": "https://vendor.example.com/webhook",
  "method": "POST",
  "headers": { "Authorization": "Bearer ..." },
  "body": { "event": "user_registered" },
  "status": "pending",                 // pending|delivering|succeeded|failed|dead_letter
  "attempts": 0,
  "maxAttempts": 8,
  "nextAttemptAt": 1710000000000,      // epoch ms，下次可投递时间
  "lockedAt": null,                    // 进入 delivering 的时间
  "lastError": null,
  "lastStatusCode": null,
  "createdAt": 1710000000000,
  "updatedAt": 1710000000000
}
```

## 状态码判定规则（投递结果）

| 外部响应 | 分类 | 处理 |
|---|---|---|
| `2xx` | 成功 | → `succeeded` |
| `408` / `429` / `5xx` | 可重试 | 退避后重试；耗尽 → `dead_letter` |
| 网络错误 / 超时 | 可重试 | 同上 |
| 其他 `4xx` | 永久失败 | → `failed`（不重试） |
