#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[错误] 未找到 Node.js。请先安装 Node 20 或更高版本："
  echo "       https://nodejs.org/"
  echo ""
  exit 1
fi

node scripts/install.mjs
