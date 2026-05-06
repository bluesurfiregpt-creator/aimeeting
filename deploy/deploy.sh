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

echo "▸ docker compose pull (best-effort)"
docker compose pull || true

echo "▸ docker compose build"
docker compose build

echo "▸ docker compose up -d"
docker compose up -d

echo "▸ status:"
docker compose ps
