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

# v23.5+: deploy/.env 必须存在且含 POSTGRES_PASSWORD,否则 docker compose 会
# fallback 到字面量 'aimeeting' → 跟 DB 实际密码不匹配 → backend crash.
# (踩过的坑:rsync --delete 不 exclude deploy/.env 时会把它删掉)
if [ ! -f "$APP_DIR/deploy/.env" ]; then
    echo "❌ $APP_DIR/deploy/.env not found."
    echo "   cp $APP_DIR/deploy/.env.example $APP_DIR/deploy/.env"
    echo "   chmod 600 $APP_DIR/deploy/.env"
    echo "   填上 POSTGRES_PASSWORD = DB 端 'aimeeting' 用户的实际密码"
    exit 1
fi
if ! grep -q '^POSTGRES_PASSWORD=.\+' "$APP_DIR/deploy/.env"; then
    echo "❌ $APP_DIR/deploy/.env missing or empty POSTGRES_PASSWORD"
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
