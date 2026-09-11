#!/usr/bin/env bash
# 开发模式：后端 watch + 前端 Vite dev server（前端 dev 通过 proxy 转发 API 到 :8080）。
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js。请先安装 Node 18+。" >&2
  exit 1
fi

[ -d node_modules ] || npm install

# 先构建 common，供后端与前端类型引用。
npm run build --workspace @notify/common

# 并行启动后端 watch 与前端 dev；任一退出即整体退出。
npm run dev --workspace @notify/backend &
BACKEND_PID=$!
npm run dev --workspace @notify/frontend &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' EXIT INT TERM
wait -n
