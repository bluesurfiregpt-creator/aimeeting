#!/usr/bin/env bash
# backup-secrets.sh — 把服务器上的 server-only secrets 拉到**本地 Mac**保存.
#
# 为什么要这个脚本:
#   backend/.env + deploy/.env 都不入 git(.gitignore),也不能 rsync 上去
#   (rsync --delete 会误删).他们**只在服务器一份**,服务器挂了 = 全丢.
#   每次 deploy 后跑一次,本地有最新副本.
#
# 用法:
#   bash deploy/backup-secrets.sh
#
# 输出位置:
#   ~/aimeeting-secrets-backup/YYYY-MM-DD-HHMM/
#     ├── backend.env
#     ├── deploy.env
#     └── README.txt   <- 当时的 git commit + 服务器版本
#
# 环境变量:
#   AIMEETING_HOST   默认 root@47.245.92.62
#   BACKUP_DIR       默认 $HOME/aimeeting-secrets-backup

set -euo pipefail

HOST="${AIMEETING_HOST:-root@47.245.92.62}"
BACKUP_BASE="${BACKUP_DIR:-$HOME/aimeeting-secrets-backup}"
TS="$(date '+%Y-%m-%d-%H%M')"
DEST="$BACKUP_BASE/$TS"

mkdir -p "$DEST"
chmod 700 "$BACKUP_BASE"

echo "▸ 拉 backend/.env"
scp -q "$HOST:/opt/aimeeting/backend/.env" "$DEST/backend.env"
chmod 600 "$DEST/backend.env"

echo "▸ 拉 deploy/.env"
scp -q "$HOST:/opt/aimeeting/deploy/.env" "$DEST/deploy.env"
chmod 600 "$DEST/deploy.env"

# 留一个 README 标记当时的 git 状态,出事时知道对应哪个版本
cat > "$DEST/README.txt" <<EOF
Aimeeting secrets backup
========================
Backed up at:   $(date '+%Y-%m-%d %H:%M:%S %Z')
Source server:  $HOST
Local git HEAD: $(cd "$(dirname "$0")/.." && git rev-parse --short HEAD 2>/dev/null || echo 'unknown')
Local git msg:  $(cd "$(dirname "$0")/.." && git log -1 --pretty=%s 2>/dev/null || echo 'unknown')

Files:
  backend.env   server backend env (DashScope key / JWT secret / DATABASE_URL etc)
  deploy.env    POSTGRES_PASSWORD for docker compose env-substitution

恢复方法(把这两个文件传回服务器):
  scp backend.env $HOST:/opt/aimeeting/backend/.env
  scp deploy.env  $HOST:/opt/aimeeting/deploy/.env
  ssh $HOST 'chmod 600 /opt/aimeeting/backend/.env /opt/aimeeting/deploy/.env'
  ssh $HOST 'cd /opt/aimeeting/deploy && docker compose up -d --force-recreate backend'

⚠️ 这个目录里的文件含明文密码 / API key,请妥善保管 — 不要传 iCloud / Dropbox.
EOF

# 滚动留 30 份(防止积累过多)
KEEP=30
total=$(ls -1 "$BACKUP_BASE" | wc -l | tr -d ' ')
if [ "$total" -gt "$KEEP" ]; then
    excess=$((total - KEEP))
    echo "▸ 总份数 $total > $KEEP,清理最旧 $excess 份"
    ls -1t "$BACKUP_BASE" | tail -n "$excess" | while read d; do
        rm -rf "$BACKUP_BASE/$d"
        echo "  rm $d"
    done
fi

echo ""
echo "✅ 备份完成:$DEST"
echo "   保留 $KEEP 份滚动,最旧的会自动清."
ls -la "$DEST"
