#!/usr/bin/env bash
set -euo pipefail

echo "=== Deploy TEST ==="

SRC="/root/.openclaw/workspace/main/avatar-service"
DST="/opt/avatar-service-test"

rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='logs/' \
  --exclude='photos/' \
  --exclude='*.log' \
  --exclude='.git' \
  "$SRC/" "$DST/"

systemctl restart avatar-bot-test.service
echo "✅ Test bot restarted"
