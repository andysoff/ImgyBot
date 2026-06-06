#!/usr/bin/env node
/**
 * Логика бота Imgy — новый сценарий.
 *
 * Flow:
 *   Онбординг (новый пользователь):
 *     1. Приветствие — рассказ о возможностях, 5 бесплатных генераций
 *     2. Кнопки: Узнать больше / Попробовать
 *     3. Узнать больше — детальное описание шагов
 *     4. Попробовать → загрузи фото
 *   Далее:
 *     5. Загрузка фото (одним сообщением, несколько вложений)
 *     6. Создание юзера + аватара, счётчик = 5 → кнопки со стилями
 *     7. Выбор стиля → генерация, −1 от счётчика
 *     8. Счётчик = 0 → просьба оплатить
 *     9. После генерации (если остались генерации) → снова кнопки со стилями
 *
 * Состояния (conversations.json):
 *   idle                    — ожидание
 *   awaiting_photos         — ждём фото
 *   awaiting_style          — ждём выбор стиля
 *   awaiting_onboarding_choice — онбординг: выбор Узнать больше / Попробовать
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
 * Проверить, новый ли пользователь.
 * Новый = нет записи в users.json.
 * Если запись есть — возвращающийся, даже без аватаров.
 * @param {string} telegramId
 * @returns {boolean}
 */
function isNewUser(telegramId) {
  return !findUserByTelegram(telegramId);
}

/**
 * Постоянная клавиатура (кнопки над полем ввода)
 */
function buildMainKeyboard() {
  return {
    keyboard: [
      [{ text: '🖼 Стили' }, { text: '✍️ Промпт' }],
      [{ text: '👤 Аватар' }, { text: '💰 Баланс' }],
      [{ text: '⚙️ Настройки' }, { text: '❓ Помощь' }]
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

function consumeGeneration(userId, cost = 1) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return { user: null, remaining: 0 };
  if (user.generationsRemaining < cost) return { user, remaining: user.generationsRemaining };
  user.generationsRemaining -= cost;
  writeJSON(USERS_FILE, users);
  return { user, remaining: user.generationsRemaining };
}

function getModelCost(telegramId) {
  const settings = getSettings(telegramId);
  return MODEL_COST[settings.model] || 1;
}

function getModelOptions(telegramId) {
  if (String(telegramId) === ADMIN_TELEGRAM_ID) {
    return MODEL_OPTIONS;
  }
  // Не-админам скрываем 2.5 Flash
  const filtered = { ...MODEL_OPTIONS };
  delete filtered['gemini-2.5-flash-image'];
  return filtered;
}

function exhaustionText() {
  return '😔 Твои бесплатные генерации закончились.\n\n'
    + 'Но это не повод расстраиваться! Ты можешь приобрести ещё генераций.';
}

function buildBuyKeyboard() {
  return { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] };
}

function exhaustionMessage() {
  return {
    text: exhaustionText(),
    parse_mode: 'Markdown',
    reply_markup: buildBuyKeyboard()
  };
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
    { text: `Купить ${pkg.generations}`, callback_data: `buy:${pkg.id}` }
  ]));

  let text = '💳 <b>Пополнение баланса</b>\n\n';
  text += 'Выбери количество генераций:\n\n';
  for (const pkg of payments.PACKAGES) {
    text += `${pkg.label} — <b>${pkg.price}₽</b>`;
    if (pkg.savingsPercent > 0) {
      text += ` (скидка ${pkg.savingsPercent}%)`;
    }
    text += '\n';
  }

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
 * Шаг 1 — Приветствие / Онбординг для новых пользователей.
 * При /start или когда юзер в idle.
 *
 * Новый пользователь = нет записи в users.json.
 */
function handleStart(telegramId) {
  // === Возвращающийся пользователь (есть запись в users.json) ===
  if (!isNewUser(telegramId)) {
    const user = findUserByTelegram(telegramId);
    const avatars = readJSON(AVATARS_FILE);
    const userAvatars = avatars.filter(a => user.avatars.includes(a.id));

    if (user.generationsRemaining <= 0) {
      // Генераций нет — пишем про пополнение, кнопка Купить
      resetConversation(telegramId);
      return {
        text: `👋 С возвращением, <b>${user.name}</b>!\n\n😔 Твои бесплатные генерации закончились.\n\nНо ты можешь приобрести ещё!`,
        parse_mode: 'HTML',
        reply_markup: buildBuyKeyboard(),
        showDefaultKeyboard: false
      };
    }

    // Есть запись, есть генерации, но нет аватаров — просим загрузить фото
    if (!userAvatars || userAvatars.length === 0) {
      setConversation(telegramId, 'awaiting_photos', {});
      return {
        text: `👋 С возвращением, <b>${user.name}</b>!\nУ тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.\n\n📸 Чтобы начать, загрузи свои фото одним сообщением.`,
        parse_mode: 'HTML',
        showDefaultKeyboard: false
      };
    }

    // Есть генерации и аватары — показываем меню
    const conv = getConversation(telegramId);
    const convAvatarId = conv?.data?.avatarId;
    const savedAvatar = convAvatarId ? userAvatars.find(a => a.id === convAvatarId) : null;
    const avatar = savedAvatar || userAvatars[userAvatars.length - 1];
    setConversation(telegramId, 'awaiting_style', { userId: user.id, avatarId: avatar.id });

    const mainKB = buildMainKeyboard();

    return {
      text: `👋 С возвращением, <b>${user.name}</b>!\nУ тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.\n\nМожешь создавать фото с помощью готовых стилей или написать своё описание.\nВыбери действие в меню 👇`,
      parse_mode: 'HTML',
      reply_markup: mainKB
    };
  }

  // === Новый пользователь — онбординг ===
  setConversation(telegramId, 'awaiting_onboarding_choice', {});
  return {
    text: 'Привет! Я Imgy — твой персональный AI-фотограф 📸\n\nЯ умею генерировать высококачественные изображения на основе твоих фото.\nТы сможешь сделать красивое фото для соцсетей или целую виртуальную фотосессию!\n\n🎁 У новых пользователей есть <b>5 бесплатных генераций</b>.\n\nПробуем или нужно больше информации?'
    ,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'ℹ️ Узнать больше', callback_data: 'onboarding_learn' }],
        [{ text: '🚀 Попробовать', callback_data: 'onboarding_try' }]
      ]
    }
  };
}

/**
 * Шаг 3 — Узнать больше.
 * Детальное описание возможностей и шагов.
 */
function handleOnboardingLearnMore() {
  return {
    text: 'Вот как это работает 👇\n\n'
      + '1️⃣ <b>Загрузи фото</b>\n'
      + 'Можно прислать одно, но лучше несколько. Выбирай самые качественные и любимые.\n\n'
      + '2️⃣ <b>Создание исходника</b>\n'
      + 'После загрузки я создам твой цифровой исходник, и можно приступать к созданию новых фото.\n\n'
      + '3️⃣ <b>Генерация фото</b>\n'
      + 'Можно создавать фото с использованием готовых стилей или написать детальное описание самому (промпт).\n\n'
      + '4️⃣ <b>Несколько исходников</b>\n'
      + 'При желании можно создать несколько исходников и делать фото для близких и друзей.\n\n'
      + 'Готов попробовать? 👇',
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Попробовать', callback_data: 'onboarding_try' }]
      ]
    }
  };
}

/**
 * Шаг 4 — Попробовать → загрузка фото.
 */
function handleOnboardingTry(telegramId) {
  setConversation(telegramId, 'awaiting_photos', {});
  return {
    text: '📸 Отлично! Загрузи свои фото одним сообщением.\nМожно прислать одно или несколько — чем больше, тем лучше результат!',
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
    return { text: 'Пожалуйста, отправь фото. Нужны твои фотографии для создания исходника.' };
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
      generationsRemaining: 5,
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
    name: `Исходник ${existingCount + 1}`,
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

  // Переходим к ожиданию выбора действия через меню
  setConversation(telegramId, 'awaiting_style', { userId: user.id, avatarId });

  const mainKB = buildMainKeyboard();

  return {
    text: `✅ Загрузка завершена! ${savedPhotos.length} фото сохранено.\n`
        + `У тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.\n\n`
        + `Теперь ты можешь создавать фото с помощью готовых стилей или написать своё описание.\n`
        + `Выбери действие в меню 👇`,
    parse_mode: 'HTML',
    reply_markup: mainKB,
    avatarId
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
      const userMsg = !user ? '❌ Пользователь не найден. Напиши /start, чтобы начать.' : '❌ Не найдены твои фото. Загрузи новые через /start.';
      return { text: userMsg };
    }
  }

  const styles = readJSON(STYLES_FILE);
  const style = styles.find(s => s.id === styleId);
  if (!style) {
    return { text: '❌ Такого стиля нет. Выбери из предложенных.' };
  }

  const { userId, avatarId } = conv.data;

  // Проверяем баланс (не списываем!)
  const user = findUserByTelegram(telegramId);
  const cost = getModelCost(telegramId);
  if (!user || user.generationsRemaining < cost) {
    resetConversation(telegramId);
    return exhaustionMessage();
  }

  const avatars = readJSON(AVATARS_FILE);
  const avatar = avatars.find(a => a.id === avatarId);

  // Не списываем генерации — они будут списаны после успешной генерации
  setConversation(telegramId, 'awaiting_style', { userId, avatarId });

  return {
    text: `✅ Стиль «${style.name}». Генерирую...`,
    parse_mode: 'HTML',
    style, userId, avatarId, cost,
    user, avatar,
    remaining: user.generationsRemaining,
    readyToGenerate: true,
    reply_markup: { inline_keyboard: buildStylesKeyboard() }
  };
}

// ======================
// ВСПОМОГАТЕЛЬНЫЕ
// ======================

/**
 * Счётчик на нуле — предложение оплатить (отдельный вызов, не после генерации).
 */
function handleGenerationsExhausted(telegramId) {
  return exhaustionMessage();
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

  if (conv.state === 'awaiting_onboarding_choice') {
    return {
      text: 'Нажми на одну из кнопок ниже',
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ℹ️ Узнать больше', callback_data: 'onboarding_learn' }],
          [{ text: '🚀 Попробовать', callback_data: 'onboarding_try' }]
        ]
      }
    };
  }

  if (conv.state === 'awaiting_photos') {
    return { text: 'Отправь свои фото, и я сделаю классные фото! 📸' };
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
      text: '✍️ Напиши описание для генерации или прикрепи фото с описанием.\nИли нажми /cancel, чтобы выйти.'
    };
  }

  return { text: '❌ Не понял. Напиши /start, чтобы начать заново.' };
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
  if (idx === -1) return { error: 'Исходник не найден' };

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
    return exhaustionMessage();
  }

  resetConversation(telegramId);
  setConversation(telegramId, 'awaiting_photos', {});
  return {
    text: '📸 Отправь новые фото для нового исходника.\nМожно 1-3 фото одним сообщением.'
  };
}

/**
 * Показать аватары пользователя
 */
function handleAvatars(telegramId) {
  const user = findUserByTelegram(telegramId);
  if (!user) {
    return {
      text: '📸 У тебя пока нет исходников. Напиши /start, чтобы создать первый.',
      reply_markup: {
        inline_keyboard: [[{ text: '🚀 Начать', callback_data: 'new_avatar' }]]
      }
    };
  }

  const allAvatars = readJSON(AVATARS_FILE);
  const userAvatars = allAvatars.filter(a => user.avatars.includes(a.id));

  if (userAvatars.length === 0) {
    // Пользователь есть, но аватаров нет — предлагаем создать
    if (user.generationsRemaining <= 0) {
      return {
        text: '😔 У тебя нет исходников, а генерации закончились. Пополни баланс, чтобы создать новый исходник.',
        reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] }
      };
    }
    return {
      text: `📸 У тебя пока нет исходников. Загрузи фото, чтобы создать первый!

🌀 У тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '📸 Загрузить фото', callback_data: 'new_avatar' }]]
      }
    };
  }

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

  // Добавляем кнопку "Новый исходник" внизу списка
  keyboard.push([{
    text: '➕ Новый исходник',
    callback_data: 'new_avatar'
  }]);

  return {
    text: '👤 Твои исходники:\n' + userAvatars.map(av => {
      const isCurrent = av.id === currentAvatarId;
      return (isCurrent ? '✅ ' : '• ') + av.name + ' — ' + av.photos.length + ' фото';
    }).join('\n') + '\n\n✅ Нажми на исходник — выбрать\n🗑 Нажми 🗑 — удалить',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Показать стили (/styles)
 */
function handleStyles(telegramId) {
  const user = findUserByTelegram(telegramId);
  if (!user) {
    return {
      text: '📸 Сначала напиши /start, чтобы зарегистрироваться.',
      reply_markup: {
        inline_keyboard: [[{ text: '🚀 Начать', callback_data: 'onboarding_try' }]]
      }
    };
  }

  if (user.generationsRemaining <= 0) {
    return exhaustionMessage();
  }

  const avatars = readJSON(AVATARS_FILE);
  
  // Пытаемся использовать выбранный аватар из conversation
  const conv = getConversation(telegramId);
  let avatar = null;
  
  if (conv?.data?.avatarId) {
    avatar = avatars.find(a => a.id === conv.data.avatarId);
  }
  
  // Если выбранный не найден — берём первый аватар пользователя
  if (!avatar) {
    avatar = avatars.find(a => a.userId === user.id);
  }
  
  if (!avatar) {
    // Пользователь есть и есть генерации, но нет аватаров
    if (user.generationsRemaining > 0) {
      return {
        text: `📸 Сначала загрузи фото, чтобы создать исходник!

🌀 У тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '📸 Загрузить фото', callback_data: 'new_avatar' }]]
        }
      };
    }
    return exhaustionMessage();
  }

  // Сохраняем правильный avatarId в conversation
  setConversation(telegramId, 'awaiting_style', { userId: user.id, avatarId: avatar.id });

  return {
    text: '🖼 Выбери стиль для фото 👇',
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
  if (!user) {
    return {
      text: '📸 Сначала напиши /start, чтобы зарегистрироваться.',
      reply_markup: {
        inline_keyboard: [[{ text: '🚀 Начать', callback_data: 'onboarding_try' }]]
      }
    };
  }

  if (user.generationsRemaining <= 0) {
    return exhaustionMessage();
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
    // Пользователь есть, есть генерации, но нет аватаров
    return {
      text: `📸 Сначала загрузи фото, чтобы создать исходник!

🌀 У тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '📸 Загрузить фото', callback_data: 'new_avatar' }]]
      }
    };
  }

  setConversation(telegramId, 'awaiting_custom_prompt', {
    userId: user.id,
    avatarId: currentAvatarId
  });

  return {
    text: '✍️ <b>Промпт</b>\n\nНапиши, что хочешь увидеть на фото. Можно прикрепить изображение, и я использую его как основу совместно с твоими фото.\n\nПример: <i>«киберпанк, неоновые огни, дождь, как в Blade Runner»</i>',
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

  // Проверяем баланс (не списываем!)
  const user = findUserByTelegram(telegramId);
  const cost = getModelCost(telegramId);
  if (!user || user.generationsRemaining < cost) {
    resetConversation(telegramId);
    return exhaustionMessage();
  }

  const avatars = readJSON(AVATARS_FILE);
  const avatar = avatars.find(a => a.id === avatarId);

  // Не списываем генерации — будут списаны после успешной генерации
  setConversation(telegramId, 'awaiting_custom_prompt', { userId, avatarId });

  return {
    text: `✍️ Генерирую: «${promptText.slice(0, 60)}${promptText.length > 60 ? '...' : ''}»`,
    promptText: promptText.trim(),
    hasExternalPhoto: !!effectivePhoto,
    user,
    avatar,
    userId,
    avatarId,
    cost,
    attachedPhoto: effectivePhoto,
    remaining: user.generationsRemaining,
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
  const user = users.find(u => u.telegram === `@${telegramId}`);
  if (!user) return null;
  user.generationsRemaining = (user.generationsRemaining || 0) + n;
  writeJSON(USERS_FILE, users);
  console.log(`💰 ${user.name || user.telegram}: +${n} генераций → всего ${user.generationsRemaining}`);
  return user.generationsRemaining;
}

// ======================
// НАСТРОЙКИ
// ======================

const ADMIN_TELEGRAM_ID = '132454710';

const MODEL_COST = {
  'gemini-2.5-flash-image': 1,
  'gemini-3.1-flash-image-preview': 1,
  'gemini-3-pro-image-preview': 2,
};

const DEFAULT_SETTINGS = {
  quality: 'standard',
  aspectRatio: '1:1',
  size: 'medium',
  model: 'gemini-3.1-flash-image-preview'
};

const QUALITY_OPTIONS = {
  economy:  { label: '🟢 Эконом', prompt: 'low quality, fast generation, compressed' },
  standard: { label: '👍 Стандарт', prompt: 'standard quality, balanced' },
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
  'gemini-3.1-flash-image-preview': { label: '⚡ Базовая', desc: 'Быстрая, нормальное качество. Стоимость — 1 генерация.' },
  'gemini-3-pro-image-preview': { label: '🏆 Про', desc: 'Максимальное качество, но медленнее и дороже. Стоимость — 2 генерации.' },
  'gemini-2.5-flash-image': { label: '🟢 Flash 2.5', desc: 'Только для админа' },
};

function getSettings(telegramId) {
  try {
    const all = readJSON(SETTINGS_FILE);
    const settings = { ...DEFAULT_SETTINGS, ...(all[telegramId] || {}) };
    // Не-админам 2.5 Flash не показываем и не используем
    if (settings.model === "gemini-2.5-flash-image" && String(telegramId) !== ADMIN_TELEGRAM_ID) {
      settings.model = DEFAULT_SETTINGS.model;
    }
    return settings;
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
  const qualityLabel = QUALITY_OPTIONS[s.quality]?.label || '👍 Стандарт';
  const aspectLabel = ASPECT_OPTIONS[s.aspectRatio]?.label || '📐 1:1';
  const sizeLabel = SIZE_OPTIONS[s.size]?.label || '🟡 Средний';
  const modelCost = MODEL_COST[s.model] !== undefined ? MODEL_COST[s.model] : 1;
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
    text: '📷 <b>Качество изображения</b>\n\n🟢 <b>Эконом</b> — быстро, низкое качество\n👍 <b>Стандарт</b> — среднее качество, сбалансированное\n🔥 <b>Премиум</b> — максимальное качество, детализация\n\nВыбери 👇',
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
  const options = getModelOptions(telegramId);
  const keyboard = Object.entries(options).map(([key, opt]) => ({
    text: (s.model === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_model:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  const isAdmin = String(telegramId) === ADMIN_TELEGRAM_ID;
  const proLabel = '🏆 <b>Про</b> — 2 генерации, макс. качество';
  const flashLabel = '⚡ <b>Базовая</b> — 1 генерация, быстро, нормальное качество';
  const oldLabel = isAdmin ? '\n🟢 <b>Flash 2.5</b> — 1 генерация (только ты)\n' : '';

  return {
    text: '🤖 <b>Модель генерации</b>\n\n' + flashLabel + '\n' + proLabel + oldLabel + '\nВыбери модель 👇',
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
// ПОМОЩЬ
// ======================

/**
 * Главный экран Помощи — как онбординг, с inline-кнопками.
 */
function handleHelp() {
  return {
    text: '🤖 <b>Какая помощь необходима?</b>',
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📖 Инструкция', callback_data: 'help_instructions' }],
        [{ text: '💬 Задать вопрос', callback_data: 'help_support' }]
      ]
    }
  };
}

/**
 * Экран Инструкция — основные шаги.
 */
function handleHelpInstructions() {
  return {
    text: '🤖 <b>Imgy Bot</b> — твой персональный AI-фотограф 📸\n\n<b>Как это работает:</b>\n\n'
      + '1️⃣ <b>Загрузи фото</b>\n'
      + 'Можно прислать одно, но лучше несколько. Выбирай самые качественные и любимые.\n\n'
      + '2️⃣ <b>Создание исходника</b>\n'
      + 'После загрузки я создам твой цифровой исходник, и можно приступать к созданию новых фото.\n\n'
      + '3️⃣ <b>Генерация фото</b>\n'
      + 'Можно создавать фото с использованием готовых стилей или написать детальное описание самому (промпт).\n\n'
      + '4️⃣ <b>Несколько исходников</b>\n'
      + 'При желании можно создать несколько исходников и делать фото для близких и друзей.',
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Назад', callback_data: 'help_back' }]
      ]
    }
  };
}

/**
 * Контакты поддержки.
 */
function handleHelpSupport() {
  return {
    text: '💬 <b>Поддержка</b>\n\n'
      + 'Если у тебя возникли вопросы или проблемы — пиши:\n\n'
      + '📩 <a href="https://t.me/imgy_support">@imgy_support</a>\n\n'
      + 'Мы ответим в ближайшее время 🕐',
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Назад', callback_data: 'help_back' }]
      ]
    }
  };
}

// ======================
// Экспорт
// ======================

module.exports = {
  handleHelp,
  handleHelpInstructions,
  handleHelpSupport,
  isNewUser,
  handleStart,
  handleBuy,
  handlePhotosReceived,
  handleStyleSelected,
  handleGenerationsExhausted,
  buildBuyKeyboard,
  exhaustionMessage,
  handleCancel,
  handleUnknown,
  handleOnboardingLearnMore,
  handleOnboardingTry,
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
  getModelCost,
  MODEL_COST,
  pluralGen
};
