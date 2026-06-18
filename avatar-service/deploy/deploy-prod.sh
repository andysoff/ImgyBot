#!/usr/bin/env bash
set -euo pipefail

echo "=== Deploy PROD ==="

SRC="/root/.openclaw/workspace/main/avatar-service"
DST="/opt/avatar-service-prod"

rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='logs/' \
  --exclude='photos/' \
  --exclude='*.log' \
  --exclude='.git' \
  "$SRC/" "$DST/"

systemctl restart avatar-bot.service
echo "✅ Prod bot restarted"
