#!/usr/bin/env bash
# 生产/演示启动脚本：检查 Node → 安装依赖 → 构建 → 单进程启动。
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js。请先安装 Node 18+（推荐 20 LTS）。" >&2
  echo "  例如使用 nvm： nvm install 20 && nvm use 20" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "错误：Node 版本过低（当前 $(node -v)），需要 >= 18。" >&2
  exit 1
fi

# 首次运行安装依赖。better-sqlite3 通常拉取预编译二进制；
# 若你的平台无预编译产物，需要本机具备 C++ 构建工具链。
if [ ! -d node_modules ]; then
  echo "==> 安装依赖 (npm install)..."
  if ! npm install; then
    echo "依赖安装失败。若因 better-sqlite3 编译失败，请安装构建工具链后重试：" >&2
    echo "  macOS: xcode-select --install" >&2
    echo "  Debian/Ubuntu: sudo apt-get install -y build-essential python3" >&2
    exit 1
  fi
fi

echo "==> 构建 (npm run build)..."
npm run build

echo "==> 启动服务 ..."
exec node backend/dist/index.js
