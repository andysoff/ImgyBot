#!/usr/bin/env node
/**
 * Логика бота Imgy — новый сценарий.
 *
 * Flow:
 *   1. Приветствие → загрузи фото (10 бесплатных генераций)
 *   2. Загрузка фото (одним сообщением, несколько вложений)
 *   3. Создание юзера + аватара, счётчик = 10 → кнопки со стилями
 *   4. Выбор стиля → генерация, −1 от счётчика
 *   5. Счётчик = 0 → просьба оплатить
 *   6. После генерации (если остались генерации) → снова кнопки со стилями
 *
 * Состояния (conversations.json):
 *   idle              — ожидание
 *   awaiting_photos   — ждём фото
 *   awaiting_style    — ждём выбор стиля
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PHOTOS_DIR = path.join(__dirname, '..', 'photos');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AVATARS_FILE = path.join(DATA_DIR, 'avatars.json');
const STYLES_FILE = path.join(DATA_DIR, 'styles.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf-8')); }

/**
 * Склонение слова "генерация" по числу.
 * 1 генерация, 2 генерации, 5 генераций
 */
function pluralGen(n) {
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 19) return 'генераций';
  if (lastDigit === 1) return 'генерация';
  if (lastDigit >= 2 && lastDigit <= 4) return 'генерации';
  return 'генераций';
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); }

function generateId(prefix, existing) {
  const max = existing
    .map(e => parseInt(e.id.replace(prefix, ''), 10))
    .filter(n => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${max + 1}`;
}

// ======================
// Состояния диалога
// ======================

function getConversation(telegramId) {
  const convs = readJSON(CONVERSATIONS_FILE);
  return convs[telegramId] || { state: 'idle', data: {} };
}

function setConversation(telegramId, state, data = {}) {
  const convs = readJSON(CONVERSATIONS_FILE);
  convs[telegramId] = { state, data };
  writeJSON(CONVERSATIONS_FILE, convs);
}

function resetConversation(telegramId) {
  const convs = readJSON(CONVERSATIONS_FILE);
  delete convs[telegramId];
  writeJSON(CONVERSATIONS_FILE, convs);
}

// ======================
// Утилиты
// ======================

/**
 * Постоянная клавиатура (кнопки над полем ввода)
 */
function buildMainKeyboard() {
  return {
    keyboard: [
      [{ text: '🎨 Стили' }, { text: '🎮 Промпт' }],
      [{ text: '🖼 Аватар' }, { text: '💰 Баланс' }],
      [{ text: '💳 Купить' }, { text: '⚙️ Настройки' }],
      [{ text: '❓ Помощь' }]
    ],
    resize_keyboard: true
  };
}

function buildStylesKeyboard() {
  const styles = readJSON(STYLES_FILE);
  const keyboard = [];
  for (let i = 0; i < styles.length; i += 2) {
    const row = [];
    row.push({ text: styles[i].name, callback_data: `style:${styles[i].id}` });
    if (styles[i + 1]) {
      row.push({ text: styles[i + 1].name, callback_data: `style:${styles[i + 1].id}` });
    }
    keyboard.push(row);
  }
  return keyboard;
}

function findUserByTelegram(telegramId) {
  const users = readJSON(USERS_FILE);
  return users.find(u => u.telegram === `@${telegramId}`) || null;
}

function consumeGeneration(userId) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return { user: null, remaining: 0 };
  if (user.generationsRemaining <= 0) return { user, remaining: 0 };
  user.generationsRemaining -= 1;
  writeJSON(USERS_FILE, users);
  return { user, remaining: user.generationsRemaining };
}

function exhaustionText() {
  return '😔 Твои бесплатные генерации закончились.\n\n'
    + 'Но это не повод расстраиваться! Ты можешь приобрести ещё генераций.\n'
    + 'Напиши администратору — @imgy_support, он поможет с продлением.';
}

// ======================
// ОПЛАТА
// ======================

/**
 * Показать меню покупки генераций
 */
function handleBuy(telegramId) {
  const payments = require('./payments');
  const user = findUserByTelegram(telegramId);
  if (!user) {
    return { text: '❌ Сначала напиши /start, чтобы зарегистрироваться.' };
  }

  // Инлайн кнопки с пакетами
  const keyboard = payments.PACKAGES.map(pkg => ([
    { text: `${pkg.label} — ${pkg.price}₽`, callback_data: `buy:${pkg.id}` }
  ]));

  const isDemo = payments.isDemoMode && payments.isDemoMode();

  let text = '💳 <b>Пополнение баланса</b>\n\n';
  text += 'Выбери количество генераций:\n\n';
  for (const pkg of payments.PACKAGES) {
    text += `${pkg.label} — <b>${pkg.price}₽</b>\n`;
  }
  if (isDemo) {
    text += '\n━━━━━━━━━━━━━━━━━━━\n🔄 <i>Демо-режим</i> — оплата без реального подключения.\nНажми «Я оплатил» → генерации начислятся сразу.\n<i>Для продакшена зарегистрируй ЮKassa</i>.\n━━━━━━━━━━━━━━━━━━━\n';
  }

  text += `\nУ тебя сейчас: <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)}`;

  return {
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

// ======================
// ОБРАБОТЧИКИ ШАГОВ
// ======================

/**
 * Шаг 1 — Приветствие.
 * При /start или когда юзер в idle.
 */
function handleStart(telegramId) {
  // Проверяем, есть ли уже пользователь
  const user = findUserByTelegram(telegramId);

  if (user) {
    // Пользователь есть — проверяем аватары
    const avatars = readJSON(AVATARS_FILE);
    const userAvatars = avatars.filter(a => user.avatars.includes(a.id));

    if (userAvatars.length > 0 && userAvatars.some(a => a.photos.length > 0)) {
      if (user.generationsRemaining <= 0) {
        // Генераций нет — пишем про пополнение, без стилей
        resetConversation(telegramId);
        return {
          text: `👋 С возвращением!\n\n😔 Твои бесплатные генерации закончились.\n\nНо ты можешь приобрести ещё. Напиши администратору — @imgy_support, он поможет с продлением.`,
          parse_mode: 'Markdown'
        };
      }

      // Есть генерации — сразу к стилям
      const avatar = userAvatars[0];
      setConversation(telegramId, 'awaiting_style', { userId: user.id, avatarId: avatar.id });

      return {
        text: `👋 С возвращением!\nУ тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.\n\nВыбери стиль для своей фотосессии 👇`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildStylesKeyboard() }
      };
    }
  }

  // Новый пользователь или нет аватаров — просим фото
  setConversation(telegramId, 'awaiting_photos', {});
  return {
    text: 'Привет! Я Imgy, могу сделать классную фотосессию для тебя за 5 минут! '
        + 'У тебя будет 10 бесплатных генераций. Для начала загрузи свои фото.',
    parse_mode: 'Markdown'
  };
}

/**
 * Шаг 2 → 3 — Получены фото.
 *
 * telegramId:       string — ID чата в телеграме
 * filePaths:        string[] — массив путей к загруженным файлам
 * userDisplayName:  string — имя пользователя для отображения
 */
function handlePhotosReceived(telegramId, filePaths, userDisplayName) {
  const conv = getConversation(telegramId);
  if (conv.state !== 'awaiting_photos') {
    return null;
  }

  if (!filePaths || filePaths.length === 0) {
    return { text: 'Пожалуйста, отправь фото. Нужны твои фотографии, чтобы я мог сделать аватарки.' };
  }

  if (filePaths.length > 10) {
    return { text: 'Слишком много фото за раз. Отправь не больше 10 штук.' };
  }

  // Есть ли уже пользователь?
  let user = findUserByTelegram(telegramId);

  if (!user) {
    // Создаём нового
    const users = readJSON(USERS_FILE);
    const userId = generateId('user_', users);
    user = {
      id: userId,
      name: userDisplayName || `User ${telegramId}`,
      telegram: `@${telegramId}`,
      generationsRemaining: 10,
      avatars: []
    };
    users.push(user);
    writeJSON(USERS_FILE, users);
  }

  // Создаём аватар
  const avatars = readJSON(AVATARS_FILE);
  const avatarId = generateId('avatar_', avatars);

  const avatarPhotosDir = path.join(PHOTOS_DIR, user.id, avatarId);
  fs.mkdirSync(avatarPhotosDir, { recursive: true });

  const savedPhotos = [];
  filePaths.forEach((src, i) => {
    const ext = path.extname(src) || '.jpg';
    const dest = path.join(avatarPhotosDir, `photo_${i + 1}${ext}`);
    try {
      fs.cpSync(src, dest, { force: true });
    } catch {
      savedPhotos.push(src);
      return;
    }
    savedPhotos.push(`photos/${user.id}/${avatarId}/photo_${i + 1}${ext}`);
  });

  const existingCount = avatars.filter(a => a.userId === user.id).length;
  const avatar = {
    id: avatarId,
    userId: user.id,
    name: `Аватар ${existingCount + 1}`,
    createdAt: new Date().toISOString(),
    photos: savedPhotos,
    lastGeneratedAt: null
  };
  avatars.push(avatar);
  writeJSON(AVATARS_FILE, avatars);

  // Привязываем аватар к пользователю
  const usersReload = readJSON(USERS_FILE);
  const userReload = usersReload.find(u => u.id === user.id);
  if (userReload) {
    if (!userReload.avatars.includes(avatarId)) userReload.avatars.push(avatarId);
    writeJSON(USERS_FILE, usersReload);
  }

  // Переходим к выбору стиля
  setConversation(telegramId, 'awaiting_style', { userId: user.id, avatarId });

  return {
    text: `✅ Загрузка завершена! ${savedPhotos.length} фото сохранено.\n`
        + `У тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.\n\n`
        + `Теперь выбери стиль для своей фотосессии 👇`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: buildStylesKeyboard()
    }
  };
}

/**
 * Шаг 4 → 5 — Выбран стиль.
 */
function handleStyleSelected(telegramId, styleId) {
  let conv = getConversation(telegramId);
  if (conv.state !== 'awaiting_style') {
    // Попробуем восстановиться — найдём пользователя и его аватар
    const user = findUserByTelegram(telegramId);
    const avatars = readJSON(AVATARS_FILE);
    const avatar = user ? avatars.find(a => a.userId === user.id && a.photos?.length > 0) : null;
    if (user && avatar) {
      conv = { state: 'awaiting_style', data: { userId: user.id, avatarId: avatar.id } };
      setConversation(telegramId, 'awaiting_style', { userId: user.id, avatarId: avatar.id });
    } else {
      const userMsg = !user ? '❌ Пользователь не найден. Напиши /start чтобы начать.' : '❌ Не найдены твои фото. Загрузи новые через /start.';
      return { text: userMsg };
    }
  }

  const styles = readJSON(STYLES_FILE);
  const style = styles.find(s => s.id === styleId);
  if (!style) {
    return { text: '❌ Такого стиля нет. Выбери из предложенных.' };
  }

  const { userId, avatarId } = conv.data;

  // Проверяем баланс до списания
  const userBefore = findUserByTelegram(telegramId);
  if (!userBefore || userBefore.generationsRemaining <= 0) {
    resetConversation(telegramId);
    return {
      text: exhaustionText(),
      parse_mode: 'Markdown'
    };
  }

  // Списываем одну генерацию
  const result = consumeGeneration(userId);
  if (!result.user) {
    resetConversation(telegramId);
    return { text: '❌ Пользователь не найден. Начни заново — /start' };
  }

  const avatars = readJSON(AVATARS_FILE);
  const avatar = avatars.find(a => a.id === avatarId);

  if (result.remaining > 0) {
    // Ещё есть генерации — снова показываем стили
    setConversation(telegramId, 'awaiting_style', { userId, avatarId });

    return {
      text: `✅ Готово! Стиль «${style.name}».\nОсталось генераций: <b>${result.remaining}</b>\n\nВыбери ещё один стиль 👇`,
      parse_mode: 'HTML',
      style, userId, avatarId,
      user: result.user, avatar,
      remaining: result.remaining,
      readyToGenerate: true,
      reply_markup: { inline_keyboard: buildStylesKeyboard() }
    };
  }

  // Генераций больше нет
  resetConversation(telegramId);

  return {
    text: `✅ Готово! Стиль «${style.name}».\n\n${exhaustionText()}`,
    parse_mode: 'Markdown',
    style, userId, avatarId,
    user: result.user, avatar,
    remaining: 0,
    readyToGenerate: true
  };
}

// ======================
// ВСПОМОГАТЕЛЬНЫЕ
// ======================

/**
 * Счётчик на нуле — предложение оплатить (отдельный вызов, не после генерации).
 */
function handleGenerationsExhausted(telegramId) {
  return {
    text: exhaustionText(),
    parse_mode: 'Markdown'
  };
}

/**
 * Отмена / возврат в начало.
 */
function handleCancel(telegramId) {
  resetConversation(telegramId);
  return handleStart(telegramId);
}

/**
 * Фолбэк — непонятное сообщение.
 */
function handleUnknown(telegramId, text) {
  const conv = getConversation(telegramId);

  if (conv.state === 'idle' || !conv.state) {
    return handleStart(telegramId);
  }

  if (conv.state === 'awaiting_photos') {
    return { text: 'Отправь свои фото, и я сделаю классные аватарки! 📸' };
  }

  if (conv.state === 'awaiting_style') {
    return {
      text: 'Нажми на кнопку со стилем, который тебе нравится 👇',
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buildStylesKeyboard() }
    };
  }

  if (conv.state === 'awaiting_custom_prompt') {
    return {
      text: '✍️ Напиши описание для генерации или прикрепи фото с описанием.\nИли нажми /cancel чтобы выйти.'
    };
  }

  return { text: '❌ Не понял. Напиши /start чтобы начать заново.' };
}

// --- Проверка баланса (админ-утилита) ---

/**
 * Удалить аватар
 */
function deleteAvatar(telegramId, avatarId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return { error: 'Пользователь не найден' };

  const allAvatars = readJSON(AVATARS_FILE);
  const idx = allAvatars.findIndex(a => a.id === avatarId);
  if (idx === -1) return { error: 'Аватар не найден' };

  const avatar = allAvatars[idx];

  // Удаляем фото с диска и всю папку аватара
  const avatarDir = path.join(__dirname, '..', 'photos', user.id, avatarId);
  if (fs.existsSync(avatarDir)) {
    try {
      fs.rmSync(avatarDir, { recursive: true, force: true });
      console.log(`🗑 Удалена папка: ${avatarDir}`);
    } catch (e) {
      console.error('⚠️ Не удалось удалить папку:', avatarDir, e.message);
      // Fallback: удаляем файлы по одному
      for (const photoRel of (avatar.photos || [])) {
        const fullPath = path.join(__dirname, '..', photoRel);
        try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch {}
      }
    }
  }

  // Удаляем из avatars.json
  allAvatars.splice(idx, 1);
  writeJSON(AVATARS_FILE, allAvatars);

  // Удаляем из пользователя
  user.avatars = user.avatars.filter(a => a !== avatarId);
  const users = readJSON(USERS_FILE);
  const userInFile = users.find(u => u.id === user.id);
  if (userInFile) {
    userInFile.avatars = userInFile.avatars.filter(a => a !== avatarId);
    writeJSON(USERS_FILE, users);
  }

  // Если удалённый аватар был текущим — сбрасываем на первый оставшийся
  const conv = getConversation(telegramId);
  if (conv?.data?.avatarId === avatarId) {
    const remaining = allAvatars.filter(a => userInFile?.avatars?.includes(a.id) || user.avatars.includes(a.id));
    if (remaining.length > 0) {
      conv.data.avatarId = remaining[0].id;
    } else {
      delete conv.data.avatarId;
    }
    setConversation(telegramId, conv.state || 'idle', conv.data);
    console.log(`🗑 avatarId сброшен на ${conv.data.avatarId || 'none'}`);
  }

  return { success: true, name: avatar.name };
}

/**
 * Начать добавление нового аватара (сброс и запрос фото)
 */
function handleNewAvatar(telegramId) {
  const user = findUserByTelegram(telegramId);
  if (!user) {
    // Новый пользователь — создаём через handleStart
    return handleStart(telegramId);
  }

  if (user.generationsRemaining <= 0) {
    return {
      text: '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support'
    };
  }

  resetConversation(telegramId);
  setConversation(telegramId, 'awaiting_photos', {});
  return {
    text: '📸 Отправь новые фото для нового аватара.\nМожно 1-3 фото одним сообщением.'
  };
}

/**
 * Показать аватары пользователя
 */
function handleAvatars(telegramId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return null;

  const allAvatars = readJSON(AVATARS_FILE);
  const userAvatars = allAvatars.filter(a => user.avatars.includes(a.id));

  if (userAvatars.length === 0) return null;

  // Получаем текущий аватар (из conversation)
  const conv = getConversation(telegramId);
  const currentAvatarId = conv?.data?.avatarId;

  const keyboard = [];
  for (const av of userAvatars) {
    const isCurrent = av.id === currentAvatarId;
    keyboard.push([
      {
        text: (isCurrent ? '✅ ' : '') + av.name + ' (' + av.photos.length + ' фото)',
        callback_data: 'avatar:' + av.id
      },
      {
        text: '🗑',
        callback_data: 'del_avatar:' + av.id
      }
    ]);
  }

  // Добавляем кнопку "Новый аватар" внизу списка
  keyboard.push([{
    text: '➕ Новый аватар',
    callback_data: 'new_avatar'
  }]);

  return {
    text: '🖼 Твои аватары:\n' + userAvatars.map(av => {
      const isCurrent = av.id === currentAvatarId;
      return (isCurrent ? '✅ ' : '• ') + av.name + ' — ' + av.photos.length + ' фото';
    }).join('\n') + '\n\n✅ Нажми на аватар — выбрать\n🗑 Нажми 🗑 — удалить',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Показать стили (/styles)
 */
function handleStyles(telegramId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return null;

  const avatars = readJSON(AVATARS_FILE);
  
  // Пытаемся использовать выбранный аватар из conversation
  const conv = getConversation(telegramId);
  let avatar = null;
  
  if (conv?.data?.avatarId) {
    avatar = avatars.find(a => a.id === conv.data.avatarId);
    console.log(`📋 handleStyles: conv avatarId=${conv.data.avatarId}, found=${!!avatar}`);
  } else {
    console.log(`📋 handleStyles: conv нет avatarId`);
  }
  
  // Если выбранный не найден — берём первый аватар пользователя
  if (!avatar) {
    avatar = avatars.find(a => a.userId === user.id);
    console.log(`📋 handleStyles: fallback to first avatar=${avatar?.id}`);
  }
  
  if (!avatar) return null;

  // Сохраняем правильный avatarId в conversation
  setConversation(telegramId, 'awaiting_style', { userId: user.id, avatarId: avatar.id });
  console.log(`📋 handleStyles: сохранён avatarId=${avatar.id}`);

  return {
    text: '🎨 Выбери стиль для аватарки 👇',
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: buildStylesKeyboard()
    }
  };
}

/**
 * Промпт — пользователь сам пишет описание для генерации.
 */
function handleGodMode(telegramId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return null;

  if (user.generationsRemaining <= 0) {
    return {
      text: '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support'
    };
  }

  const avatars = readJSON(AVATARS_FILE);
  let currentAvatarId = null;

  // Берём аватар из conversation или первый попавшийся
  const conv = getConversation(telegramId);
  if (conv?.data?.avatarId) {
    const found = avatars.find(a => a.id === conv.data.avatarId);
    if (found) currentAvatarId = found.id;
  }

  if (!currentAvatarId) {
    const first = avatars.find(a => a.userId === user.id);
    if (first) currentAvatarId = first.id;
  }

  if (!currentAvatarId) {
    return { text: '❌ У тебя нет аватаров. Сначала загрузи фото — /start' };
  }

  setConversation(telegramId, 'awaiting_custom_prompt', {
    userId: user.id,
    avatarId: currentAvatarId
  });

  return {
    text: '🎮 <b>Промпт</b>\n\nНапиши, что хочешь увидеть на фото. Можно прикрепить своё фото, и я использую его как основу для генерации.\n\nПример: <i>«киберпанк, неоновые огни, дождь, как в Blade Runner»</i>',
    parse_mode: 'HTML'
  };
}

/**
 * Обработать кастомное описание от пользователя.
 * Можно передавать attachedPhotoPath — путь к фото, которое пользователь прикрепил.
 */
function handleCustomPrompt(telegramId, promptText, attachedPhotoPath) {
  const conv = getConversation(telegramId);
  if (conv.state !== 'awaiting_custom_prompt') return null;

  if (!promptText || promptText.trim().length === 0) {
    // Пользователь прислал фото без текста — сохраняем путь и ждём описание
    if (attachedPhotoPath) {
      setConversation(telegramId, 'awaiting_custom_prompt', {
        ...conv.data,
        pendingPhoto: attachedPhotoPath
      });
      return {
        text: '📸 Фото сохранено! Теперь напиши текстовое описание для генерации ✍️',
        pendingPhotoAttached: true
      };
    }
    return { text: '❌ Напиши описание для генерации.' };
  }

  const { userId, avatarId } = conv.data;
  // Если есть pendingPhoto от предыдущего шага — используем его
  const effectivePhoto = attachedPhotoPath || conv.data?.pendingPhoto || null;

  // Проверяем баланс
  const user = findUserByTelegram(telegramId);
  if (!user || user.generationsRemaining <= 0) {
    resetConversation(telegramId);
    return {
      text: '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support'
    };
  }

  // Списываем одну генерацию
  const result = consumeGeneration(userId);
  if (!result.user) {
    resetConversation(telegramId);
    return { text: '❌ Пользователь не найден. Начни заново — /start' };
  }

  const avatars = readJSON(AVATARS_FILE);
  const avatar = avatars.find(a => a.id === avatarId);

  setConversation(telegramId, 'awaiting_custom_prompt', { userId, avatarId });

  return {
    text: `🎮 Генерирую: «${promptText.slice(0, 60)}${promptText.length > 60 ? '...' : ''}»`,
    promptText: promptText.trim(),
    hasExternalPhoto: !!effectivePhoto,
    user: result.user,
    avatar,
    userId,
    avatarId,
    attachedPhoto: effectivePhoto,
    remaining: result.remaining,
    readyToGenerate: true
  };
}

/**
 * Отмена режима бога
 */
function handleCancelGodMode(telegramId) {
  const conv = getConversation(telegramId);
  if (conv.state === 'awaiting_custom_prompt') {
    // Если есть pendingPhoto — удаляем временный файл
    if (conv.data?.pendingPhoto) {
      try { fs.unlinkSync(conv.data.pendingPhoto); } catch {}
    }
    // Если есть lastAttachedPhoto — удаляем временный файл
    if (conv.data?.lastAttachedPhoto) {
      try { fs.unlinkSync(conv.data.lastAttachedPhoto); } catch {}
    }
    resetConversation(telegramId);
    return {
      text: '❌ Промпт отменён. Выбери другой режим 👇',
      parse_mode: 'Markdown'
    };
  }
  return null;
}

function checkBalance(telegramId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return null;
  return user.generationsRemaining;
}

/**
 * Начислить генерации пользователю (после оплаты или вручную)
 *
 * @param {string} telegramId
 * @param {number} n — сколько генераций добавить
 * @returns {number|null} — новое количество или null если пользователь не найден
 */
function addGenerations(telegramId, n) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.telegram === telegramId);
  if (!user) return null;
  user.generationsRemaining = (user.generationsRemaining || 0) + n;
  writeJSON(USERS_FILE, users);
  console.log(`💰 ${user.name || user.telegram}: +${n} генераций → всего ${user.generationsRemaining}`);
  return user.generationsRemaining;
}

// ======================
// НАСТРОЙКИ
// ======================

const DEFAULT_SETTINGS = {
  quality: 'standard',
  aspectRatio: '1:1',
  size: 'medium',
  model: 'gemini-2.5-flash-image'
};

const QUALITY_OPTIONS = {
  economy:  { label: '🟢 Эконом', prompt: 'low quality, fast generation, compressed' },
  standard: { label: '🟡 Стандарт', prompt: 'standard quality, balanced' },
  premium:  { label: '🔥 Премиум', prompt: 'ultra high quality, maximum detail, 8K, professional photography grade' }
};

const SIZE_OPTIONS = {
  small:  { label: '🟢 Маленький', prompt: 'close-up portrait, head and shoulders, faster generation' },
  medium: { label: '🟡 Средний', prompt: 'balanced portrait, half body' },
  large:  { label: '🔴 Большой', prompt: 'maximum detail, full body, ultra high resolution composition' }
};

const ASPECT_OPTIONS = {
  '1:1': { label: '📐 1:1 Квадрат' },
  '4:3': { label: '🖼 4:3 Классика' },
  '16:9': { label: '🎬 16:9 Широкий' },
  '3:4': { label: '📱 3:4 Портрет' },
  '9:16': { label: '📲 9:16 Телефон' }
};

const MODEL_OPTIONS = {
  'gemini-3.1-flash-image-preview': { label: '⚡ Flash 3.1 (быстрая)', desc: 'Nano Banana 2 — быстрая генерация, 4K' },
  'gemini-3-pro-image-preview': { label: '🔥 Flash 3.1 Pro (качество)', desc: 'Nano Banana Pro — макс. детализация' },
  'gemini-2.5-flash-image': { label: '🟢 Flash 2.5 (бесплатно)', desc: 'Nano Banana — бесплатный слой' },
};

function getSettings(telegramId) {
  try {
    const all = readJSON(SETTINGS_FILE);
    return { ...DEFAULT_SETTINGS, ...(all[telegramId] || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function updateSetting(telegramId, key, value) {
  let all = {};
  try { all = readJSON(SETTINGS_FILE); } catch {}
  if (!all[telegramId]) all[telegramId] = {};
  all[telegramId][key] = value;
  writeJSON(SETTINGS_FILE, all);
}

/**
 * Показать меню настроек.
 */
function handleSettings(telegramId) {
  const s = getSettings(telegramId);
  const qualityLabel = QUALITY_OPTIONS[s.quality]?.label || '🟡 Стандарт';
  const aspectLabel = ASPECT_OPTIONS[s.aspectRatio]?.label || '📐 1:1';
  const sizeLabel = SIZE_OPTIONS[s.size]?.label || '🟡 Средний';
  const modelLabel = MODEL_OPTIONS[s.model]?.label || '⚙️ Не выбрана';

  const keyboard = [
    [{ text: '🖼 Размер: ' + sizeLabel, callback_data: 'settings_size' }],
    [{ text: '📷 Качество: ' + qualityLabel, callback_data: 'settings_quality' }],
    [{ text: '📐 Соотношение: ' + aspectLabel, callback_data: 'settings_aspect' }],
    [{ text: '🤖 Модель: ' + modelLabel, callback_data: 'settings_model' }],
    [{ text: '🔙 Назад', callback_data: 'settings_back' }]
  ];

  return {
    text: '⚙️ <b>Настройки генерации</b>\n\nТекущие:\n🤖 Модель: ' + modelLabel + '\n🖼 Размер: ' + sizeLabel + '\n📷 Качество: ' + qualityLabel + '\n📐 Соотношение: ' + aspectLabel + '\n\nВыбери параметр для изменения 👇',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Показать выбор качества.
 */
function handleSettingsQuality(telegramId) {
  const s = getSettings(telegramId);
  const keyboard = Object.entries(QUALITY_OPTIONS).map(([key, opt]) => ({
    text: (s.quality === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_quality:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  return {
    text: '📷 <b>Качество изображения</b>\n\n🟢 <b>Эконом</b> — быстро, низкое качество\n🟡 <b>Стандарт</b> — среднее качество, сбалансированно\n🔥 <b>Премиум</b> — максимальное качество, детализация\n\nВыбери 👇',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Показать выбор соотношения сторон.
 */
function handleSettingsAspect(telegramId) {
  const s = getSettings(telegramId);
  const keyboard = Object.entries(ASPECT_OPTIONS).map(([key, opt]) => ({
    text: (s.aspectRatio === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_aspect:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  return {
    text: '📐 <b>Соотношение сторон</b>\n\n1:1 — квадрат\n4:3 — классический снимок\n16:9 — широкоформатный\n3:4 — портретный\n9:16 — вертикальный (телефон)\n\nВыбери 👇',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Показать выбор размера.
 */
/**
 * Показать выбор модели.
 */
function handleSettingsModel(telegramId) {
  const s = getSettings(telegramId);
  const keyboard = Object.entries(MODEL_OPTIONS).map(([key, opt]) => ({
    text: (s.model === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_model:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  return {
    text: '🤖 <b>Модель генерации</b>\n\n⚡ <b>Flash</b> — быстро, до 4K\n🔥 <b>Pro</b> — макс. качество, дольше\n\nВыбери модель 👇',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

function handleSettingsSize(telegramId) {
  const s = getSettings(telegramId);
  const keyboard = Object.entries(SIZE_OPTIONS).map(([key, opt]) => ({
    text: (s.size === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_size:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  return {
    text: '🖼 <b>Размер изображения</b>\n\n🟢 <b>Маленький</b> — быстрая генерация, крупный план\n🟡 <b>Средний</b> — сбалансированный, поясной портрет\n🔴 <b>Большой</b> — максимальная детализация, полный рост\n\nВыбери 👇',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Получить quality prompt-суффикс.
 */
function getQualityPrompt(telegramId) {
  const s = getSettings(telegramId);
  return QUALITY_OPTIONS[s.quality]?.prompt || QUALITY_OPTIONS.standard.prompt;
}

/**
 * Получить aspectRatio.
 */
function getAspectRatio(telegramId) {
  const s = getSettings(telegramId);
  return s.aspectRatio;
}

/**
 * Получить size prompt-суффикс.
 */
function getSizePrompt(telegramId) {
  const s = getSettings(telegramId);
  return SIZE_OPTIONS[s.size]?.prompt || '';
}

// ======================
// Экспорт
// ======================

module.exports = {
  handleStart,
  handleBuy,
  handlePhotosReceived,
  handleStyleSelected,
  handleGenerationsExhausted,
  handleCancel,
  handleUnknown,
  getConversation,
  setConversation,
  resetConversation,
  findUserByTelegram,
  handleStyles,
  handleAvatars,
  handleGodMode,
  handleCustomPrompt,
  handleCancelGodMode,
  handleNewAvatar,
  deleteAvatar,
  checkBalance,
  consumeGeneration,
  addGenerations,
  buildMainKeyboard,
  buildStylesKeyboard,
  readJSON,
  writeJSON,
  getSettings,
  updateSetting,
  handleSettings,
  handleSettingsQuality,
  handleSettingsAspect,
  handleSettingsSize,
  handleSettingsModel,
  getQualityPrompt,
  getAspectRatio,
  getSizePrompt,
  QUALITY_OPTIONS,
  ASPECT_OPTIONS,
  SIZE_OPTIONS,
  MODEL_OPTIONS,
  pluralGen
};
