#!/usr/bin/env bash
# 向本地服务提交几条样例通知，便于快速填充可观测面板。
# 用法：./scripts/seed.sh [base_url]   默认 http://localhost:8080
set -euo pipefail

BASE="${1:-http://localhost:8080}"

submit() {
  curl -sS -X POST "$BASE/notifications" \
    -H 'content-type: application/json' \
    -d "$1" && echo
}

echo "==> 提交一条应当成功的通知（httpbin 200）"
submit '{"url":"https://httpbin.org/status/200","method":"POST","body":{"event":"user_registered","user_id":"123"}}'

echo "==> 提交一条会持续 500、最终进入死信的通知"
submit '{"url":"https://httpbin.org/status/500","method":"POST","maxAttempts":3,"body":{"event":"payment_succeeded"}}'

echo "==> 提交一条永久失败（404）的通知"
submit '{"url":"https://httpbin.org/status/404","method":"POST","body":{"event":"bad_request"}}'

echo "==> 提交一条带幂等键的通知（重复提交演示去重）"
KEY="demo-$(date +%s)"
curl -sS -X POST "$BASE/notifications" -H 'content-type: application/json' \
  -H "Idempotency-Key: $KEY" \
  -d '{"url":"https://httpbin.org/status/200","body":{"event":"idempotent"}}' && echo
curl -sS -X POST "$BASE/notifications" -H 'content-type: application/json' \
  -H "Idempotency-Key: $KEY" \
  -d '{"url":"https://httpbin.org/status/200","body":{"event":"idempotent"}}' && echo

echo "==> 完成。打开 $BASE 查看面板。"
