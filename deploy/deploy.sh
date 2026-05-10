#!/usr/bin/env bash
# deploy.sh — bring up / refresh the aimeeting docker stack
# Run as root on the server, after bootstrap.sh has been run at least once.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aimeeting}"
cd "$APP_DIR/deploy"

if [ ! -f "$APP_DIR/backend/.env" ]; then
    echo "❌ $APP_DIR/backend/.env not found — copy from .env.example and fill secrets first."
    exit 1
fi

# 给 frontend build 注入构建时间 → 左下角 VersionBadge 显示
# 用北京时间(用户在中国),精确到秒便于「这是不是我刚 push 的版本」对账
export BUILD_VERSION="$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')"
echo "▸ BUILD_VERSION=$BUILD_VERSION (会贴到前端左下角)"

echo "▸ docker compose pull (best-effort)"
docker compose pull || true

echo "▸ docker compose build"
docker compose build

echo "▸ docker compose up -d"
docker compose up -d

echo "▸ status:"
docker compose ps
