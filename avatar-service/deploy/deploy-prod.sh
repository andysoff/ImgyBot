#!/usr/bin/env bash
set -euo pipefail

TRIGGER_FILE="/tmp/imgy-prod-deploy-ok"

# === Проверка триггера ===
if [ ! -f "$TRIGGER_FILE" ]; then
  echo "❌ Нет триггера! Prod deploy разрешён только после команды 'катай в прод'."
  echo "   Создай триггер: touch $TRIGGER_FILE"
  echo "   (Имги, бот сделает это за тебя, когда ты скажешь 'катай в прод')"
  exit 1
fi

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

# Удаляем триггер — на каждый деплой нужно новое разрешение
rm -f "$TRIGGER_FILE"
echo "🔒 Триггер удалён. Следующий деплой — только после новой команды."
