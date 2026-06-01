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

**Бот:** `avatar-service/scripts/bot-runner.js`

**Управление:**
- Рестарт после правок: `systemctl restart avatar-bot`
- Статус: `systemctl status avatar-bot`
- Логи: `journalctl -u avatar-bot --no-pager -n 50` или `/tmp/avatar-bot-systemd.log`
- PID-файл: `/tmp/imgy-bot.pid` (защита от дублирования)
- Принудительный запуск, если PID-файл мешает: `rm -f /tmp/imgy-bot.pid`

**Данные:**
- Юзеры: `avatar-service/data/users.json`
- Аватары: `avatar-service/data/avatars.json`
- Стили: `avatar-service/data/styles.json`

**Начисление генераций:**
Править `generationsRemaining` в `users.json` для нужного telegramId.

**Основные скрипты:**
- `bot-runner.js` — сам бот (long-polling)
- `bot-logic.js` — логика состояний и ответов
- `generate-image.js` — генерация через Gemini

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)
