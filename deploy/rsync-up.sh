#!/usr/bin/env bash
# rsync-up.sh — 把本地 repo 推到生产服务器(本地用,不入 prod 容器).
#
# 这是一个**保险脚本**:把所有正确的 rsync exclude 写在一个地方,避免每次
# 手敲漏掉某条(比如 deploy/.env,漏 exclude 会被 --delete 误删).
#
# 用法:
#   bash deploy/rsync-up.sh           # 默认只同步,不跑 deploy.sh
#   bash deploy/rsync-up.sh --deploy  # 同步完顺手 ssh 跑 deploy.sh
#
# 环境变量:
#   AIMEETING_HOST  默认 root@47.245.92.62
#   APP_DIR         默认 /opt/aimeeting

set -euo pipefail

HOST="${AIMEETING_HOST:-root@47.245.92.62}"
REMOTE_DIR="${APP_DIR:-/opt/aimeeting}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$LOCAL_DIR"

# **绝对不要 rsync 上去**(server-only / 会被 --delete 误删的关键文件):
#   - deploy/.env       本机没,服务器有 → --delete 必须 exclude
#   - backend/.env      同上
#   - .git              本地版本控制,服务器不需要
# **没必要 rsync 上去**(rebuild 即生成):
#   - node_modules / .next / __pycache__ / *.tsbuildinfo / *.pyc
# **session 类**:
#   - .claude(本地 IDE / agent 状态,不入 prod)
EXCLUDES=(
    --exclude='.git'
    --exclude='.claude'
    --exclude='node_modules'
    --exclude='__pycache__'
    --exclude='.next'
    --exclude='*.tsbuildinfo'
    --exclude='backend/.env'
    --exclude='backend/.env.*'
    --exclude='deploy/.env'        # ← 第二次 deploy 漏 exclude 这条把 prod 弄崩过
    --exclude='deploy/.env.*'
    --exclude='frontend/next-env.d.ts'
    --exclude='*.pyc'
    --exclude='.pytest_cache'
    --exclude='*.pdf'
)

echo "▸ rsync $LOCAL_DIR/ → $HOST:$REMOTE_DIR/"
rsync -avz --delete "${EXCLUDES[@]}" "$LOCAL_DIR/" "$HOST:$REMOTE_DIR/"

if [ "${1:-}" = "--deploy" ]; then
    echo ""
    echo "▸ 触发 deploy.sh"
    ssh "$HOST" "cd $REMOTE_DIR && bash deploy/deploy.sh"
fi
