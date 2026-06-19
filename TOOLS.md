# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

### Avatar Service (Imgy Bot)

**Архитектура:**
- **Git (source):** `avatar-service/` — только код, без env/data
- **Test deploy:** `/opt/avatar-service-test/` — копия из гита + свой .env
- **Prod deploy:** `/opt/avatar-service-prod/` — копия из гита + свой .env
- Код один, разница только в .env и данных

**Deploy скрипты (в git: `avatar-service/deploy/`):**
- В тест: `bash /opt/deploy-avatar-test.sh` → вызывает `deploy/deploy-test.sh`
- В прод: `bash /opt/deploy-avatar-prod.sh` → вызывает `deploy/deploy-prod.sh`

**Сервисы:**
- Прод: `systemctl [restart|status] avatar-bot`
- Тест: `systemctl [restart|status] avatar-bot-test`

**Логи:**
- Прод: `journalctl -u avatar-bot --no-pager -n 50` или `/tmp/avatar-bot-prod.log`
- Тест: `journalctl -u avatar-bot-test --no-pager -n 50` или `/tmp/avatar-bot-test.log`

**PID-файлы (защита от дублирования):**
- Прод: `/tmp/imgy-bot.pid` (дефолт)
- Тест: `/tmp/imgy-bot-test.pid` (из .env)

**Данные (свои для теста и прода):**
- Юзеры: `data/users.json`
- Аватары: `data/avatars.json`
- Стили: `data/styles.json`

**Начисление генераций:**
Править `generationsRemaining` в `users.json` для нужного telegramId.

**Основные скрипты (в avatar-service/scripts/):**
- `bot-runner.js` — сам бот (long-polling)
- `bot-logic.js` — логика состояний и ответов
- `generate-image.js` — генерация через Gemini

**Health-check GEMINI_API_KEY при старте:**
- bot-runner.js проверяет: длина ≥30 символов, префикс AIzaSy… или AQ…, no binary ch
- Если ключ битый → ERROR в лог + `/tmp/imgy-gemini-key-status.txt`
- Если ок → в лог: `GEMINI_API_KEY: *** (53 символов)`
- Авто-бэкап `.env` → `.env.bak` при каждом старте
- Делать deploy после любых правок .env ИЛИ bot-runner.js (health-check встроен туда)

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)
