#!/bin/bash
# Мониторинг платежей — проверяет статусы каждые 10 минут
# Запускается по крону

LOG_FILE="/tmp/avatar-bot-systemd.log"
PAYMENTS_FILE="/root/.openclaw/workspace/main/avatar-service/data/payments.json"

echo "=== Проверка платежей: $(TZ=Europe/Moscow date '+%H:%M %d.%m.%Y') ==="

# 1. Проверяем payments.json
if [ -f "$PAYMENTS_FILE" ]; then
  PENDING=$(python3 -c "
import json
with open('$PAYMENTS_FILE') as f:
  data = json.load(f)
if not data:
  print('Нет активных платежей')
else:
  for uid, payments in data.items():
    for p in payments:
      print(f\"  👤 {uid}: {p['paymentId'][:20]}... — {p['status']} (created: {p.get('createdAt','?')[:19]})\")
" 2>/dev/null)
  
  if [ "$PENDING" = "Нет активных платежей" ]; then
    echo "📂 payments.json: пусто"
  else
    echo "📂 Активные платежи:"
    echo "$PENDING"
  fi
fi

# 2. Проверяем логи за последние 10 минут
echo "---"
TEN_MIN_AGO=$(date -d '10 minutes ago' '+%H:%M')
echo "📋 Новые оплаты с $TEN_MIN_AGO:"
grep "Оплата подтверждена\|Новый платёж\|начислено\|payment_completed\|payment_completed_auto" "$LOG_FILE" 2>/dev/null | awk '{
  split($0, a, " ")
  ts = a[1] " " a[2]
  print "  " ts " " substr($0, index($0,$3))
}' | tail -5

if [ $? -eq 0 ] && [ -z "$(grep -l '.' /dev/stdin 2>/dev/null)" ] && [ -z "$(grep "Оплата\|начислено\|платёж" "$LOG_FILE" 2>/dev/null | tail -1)" ]; then
  echo "  (изменений нет)"
fi
