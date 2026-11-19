#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo 'Run with sudo: sudo bash install.sh'; exit 1; fi
if ! grep -qi ubuntu /etc/os-release; then echo 'This installer targets Ubuntu Server.'; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl openssl ufw
if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi
if ! docker compose version >/dev/null 2>&1; then apt-get install -y docker-compose-plugin || apt-get install -y docker-compose-v2; fi
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i "s/replace_with_long_random_secret/$(openssl rand -hex 32)/;s/replace_db_password/$(openssl rand -hex 24)/;s/replace_db_root_password/$(openssl rand -hex 24)/;s/REPLACE_API_SECRET/$(openssl rand -hex 32)/g;s#ws://YOUR_SERVER_IP:7880#ws://$(hostname -I | awk '{print $1}'):7880#" .env
  secret=$(grep '^LIVEKIT_API_SECRET=' .env | cut -d= -f2-)
  sed -i "s/REPLACE_API_SECRET/$secret/g" livekit/livekit.yaml
fi
chmod 600 .env
ufw allow OpenSSH || true
ufw allow 3000/tcp
ufw allow 7880/tcp
ufw allow 7881/tcp
ufw allow 3478/udp
ufw allow 50000:50100/udp
ufw --force enable || true
docker compose up -d --build
cat <<MSG

Private Virtual Radio is starting.
Web UI: http://$(hostname -I | awk '{print $1}'):3000
Health: http://127.0.0.1:3000/api/health
Admin username: $(grep '^ADMIN_USERNAME=' .env | cut -d= -f2-)
Admin password: $(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)

IMPORTANT: This is a development/LAN starter. Change the admin password.
For browser microphone access from other devices, configure a public DNS name
and trusted HTTPS/WSS certificates, then set PUBLIC_LIVEKIT_URL accordingly.
Open UDP 3478 and 50000-50100 on your router/cloud firewall too.
MSG
