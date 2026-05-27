#!/usr/bin/env bash
# bootstrap.sh — one-shot server provisioning for aimeeting.zhzjpt.cn
# Idempotent: safe to re-run.
#
# Run as root on a fresh Ubuntu 22.04+ host.

set -euo pipefail

DOMAIN="${DOMAIN:-aimeeting.zhzjpt.cn}"
EMAIL="${EMAIL:-bluesurfiregpt@gmail.com}"
APP_DIR="${APP_DIR:-/opt/aimeeting}"

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

log "1/6 apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg lsb-release \
    nginx git ufw \
    python3 python3-venv

log "2/6 install Docker (if missing)"
if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

log "3/6 firewall (allow 22/80/443)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "4/6 prepare app dir + nginx HTTP-01 webroot"
mkdir -p "$APP_DIR"
mkdir -p /var/www/certbot

log "5/6 install certbot"
if ! command -v certbot >/dev/null 2>&1; then
    apt-get install -y certbot python3-certbot-nginx
fi

log "6/6 nginx HTTP scaffold (pre-cert)"
cat >/etc/nginx/sites-available/aimeeting-bootstrap.conf <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 'aimeeting bootstrap ok\n'; add_header Content-Type text/plain; }
}
EOF
ln -sf /etc/nginx/sites-available/aimeeting-bootstrap.conf /etc/nginx/sites-enabled/aimeeting-bootstrap.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

log "issuing TLS cert via certbot ($DOMAIN)"
certbot certonly --webroot -w /var/www/certbot \
    --non-interactive --agree-tos -m "$EMAIL" \
    -d "$DOMAIN"

# Replace bootstrap config with the production one (caller copies it before running).
#
# v1.4.0 Sprint 3 retro (2026-05-27): 目标 文件名 改 为 `aimeeting` (无 `.conf` 后缀).
# 历史 prod active symlink 是 `/etc/nginx/sites-available/aimeeting` (手动 setup
# 时 漏了 `.conf` 后缀), bootstrap 此前 写到 `aimeeting.conf` 路径 → 两份 配置
# 不同步, prod 漏 了 `location /ws/` 块 ~1 个月, 所有 mobile WS 连接 静默 timeout,
# Sprint 3 WS broadcast 在 prod 没人 收到. 见 docs/release/v1.4.0-sprint3-retro.md.
#
# 修复后: bootstrap 写到 `aimeeting` (跟 active symlink 对齐), 后续 server 重装
# 跑 bootstrap 就能自动 拿到 repo 里的 完整 nginx config (含 /ws/ 块).
if [ -f "$APP_DIR/deploy/nginx/aimeeting.conf" ]; then
    cp "$APP_DIR/deploy/nginx/aimeeting.conf" /etc/nginx/sites-available/aimeeting
    ln -sf /etc/nginx/sites-available/aimeeting /etc/nginx/sites-enabled/aimeeting
    rm -f /etc/nginx/sites-enabled/aimeeting-bootstrap.conf
    rm -f /etc/nginx/sites-enabled/aimeeting.conf  # 旧 link 清掉, 避免双份配置
    nginx -t && systemctl reload nginx
fi

echo
echo "✅ Bootstrap done. App dir: $APP_DIR"
echo "   Next: rsync the repo to $APP_DIR, then run deploy.sh"
