---
name: avatar-service
description: "Telegram-бот Imgy для генерации аватарок через Gemini. Пользователь загружает фото → выбирает стиль → Gemini генерирует аватар."
---

# Imgy Avatar Service

Telegram-бот для генерации аватарок (`@Imgy_bot`). Gemini API (gemini-3-pro-image-preview), long-polling.

## Архитектура

```
avatar-service/
├── .env                      # BOT_TOKEN, GEMINI_API_KEY
├── data/
│   ├── users.json            # [{id, name, telegram, generationsRemaining, avatars}]
│   ├── avatars.json          # [{id, userId, name, photos[], geminiFiles[]}]
│   ├── styles.json           # [{id, name, nameEn, description}] — кнопки стилей
│   └── conversations.json    # {telegramId: {state, data}} — диалоги
├── photos/
│   ├── _incoming/            # временные загруженные фото
│   ├── user_{id}/avatar_{id}/  # фото пользователя
│   └── generated/            # сгенерированные аватарки
├── scripts/
│   ├── bot-runner.js         # long-polling раннер
│   ├── bot-logic.js          # логика диалогов (состояния: idle, awaiting_photos, awaiting_style)
│   ├── generate-image.js     # генерация через Gemini, стили, дата-массивы
│   ├── user-manager.js       # CLI для управления пользователями
│   ├── locations-data.js     # 102 мировые локации
│   └── history-data.js       # 51 историческая эпоха
└── logs/bot.log
```

## Стили (8 штук)

Стили с фиксированным промптом:
- **portrait** — классический портрет
- **in_car** — в машине

Стили со случайным выбором из коллекции (каждый раз разный результат):
- **sport** — 50 видов спорта. Функция: `generateSportAvatar`, промпт из `SPORTS`
- **professions** — 32 профессии. Функция: `generateProfessionAvatar`, промпт из `PROFESSIONS`
- **in_office** — 29 офисных ролей. Функция: `generateOfficeAvatar`, промпт из `OFFICE`
- **cinema** — 107 фильмов из IMDB Top 250. Функция: `generateCinemaAvatar`, промпт из `MOVIES`
- **location** — 102 локации. Функция: `generateLocationAvatar`, промпт из `LOCATIONS` (файл `locations-data.js`)
- **history** — 51 историческая эпоха. Функция: `generateHistoryAvatar`, промпт из `HISTORY` (файл `history-data.js`)

### Добавление нового стиля

1. В `generate-image.js` добавить массив данных + функции `getRandomX()` + `generateXAvatar()`
2. Экспортировать функции через `module.exports`
3. В `data/styles.json` добавить запись с `id`
4. В `bot-runner.js` добавить `else if (styleId === 'x')` блок с генерацией
5. Перезапустить бота

## Управление пользователями

```bash
node scripts/user-manager.js list                                    # список всех
node scripts/user-manager.js get user_3                              # информация
node scripts/user-manager.js add-generations user_3 10               # +10 генераций
node scripts/user-manager.js set-generations user_3 5                # установить 5
```

## Запуск

```bash
cd ~/avatar-service
export $(cat .env | xargs)
nohup node scripts/bot-runner.js >> logs/bot.log 2>&1 &
```

## Данные

Каждый массив random-стилей хранится в формате:
```js
{ id: 'unique_id', name: '👑 Отображаемое имя', prompt: 'english prompt with visual description for Gemini' }
```

Для фильмов (cinema) добавлены поля `title` (рус.), `titleEn` (англ.), `year`.
