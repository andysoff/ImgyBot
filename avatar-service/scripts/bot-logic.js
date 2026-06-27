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

const detectCountry = require('./detect-country').detectCountry;

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
      [{ text: '⚙️ Настройки' }, { text: 'ℹ️ Поддержка' }]
    ],
    resize_keyboard: true
  };
}

function buildStylesKeyboard() {
  const styles = readJSON(STYLES_FILE).filter(s => !s.hidden);
  const keyboard = [];
  for (let i = 0; i < styles.length; i += 2) {
    const row = [];
    const s1 = styles[i];
    const hasSubMenu1 = s1.subStyles || s1.groups;
    row.push({ text: s1.name, callback_data: (hasSubMenu1 ? `substyle_menu:${s1.id}` : `style:${s1.id}`) });
    if (styles[i + 1]) {
      const s2 = styles[i + 1];
      const hasSubMenu2 = s2.subStyles || s2.groups;
      row.push({ text: s2.name, callback_data: (hasSubMenu2 ? `substyle_menu:${s2.id}` : `style:${s2.id}`) });
    }
    keyboard.push(row);
  }
  return keyboard;
}

/**
 * Показать подменю подстилей для выбранного стиля.
 */
function handleSubStyleMenu(telegramId, styleId) {
  const styles = readJSON(STYLES_FILE);
  const style = styles.find(s => s.id === styleId);
  if (!style) {
    return null;
  }

  const keyboard = [];

  // Если у стиля есть groups — показываем группы вместо подстилей
  if (style.groups && style.groups.length > 0) {
    for (const group of style.groups) {
      keyboard.push([{ text: group.name, callback_data: `group_select:${styleId}:${group.id}` }]);
    }
    // Кнопка рандома для Warhammer 40k
    if (styleId === 'warhammer') {
      keyboard.push([{ text: '🎲 Выбрать случайно', callback_data: 'warhammer_random' }]);
    }
    keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

    return {
      text: `<b>${style.name}</b> — ${style.description || 'выбери категорию'}

Выбери категорию 👇`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    };
  }

  // Обычные подстили (плоская структура)
  if (!style.subStyles || style.subStyles.length === 0) {
    return null;
  }

  for (const sub of style.subStyles) {
    keyboard.push([{ text: sub.name, callback_data: `substyle_select:${sub.id}` }]);
  }
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  return {
    text: `<b>${style.name}</b> — ${style.description || 'выбери тип портрета'}

Выбери тип портрета 👇`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Показать подстили для выбранной группы.
 */
function handleSubStyleGroup(telegramId, styleId, groupId) {
  const styles = readJSON(STYLES_FILE);
  const style = styles.find(s => s.id === styleId);
  if (!style || !style.groups) return null;

  const group = style.groups.find(g => g.id === groupId);
  if (!group || !group.subStyles || group.subStyles.length === 0) return null;

  const keyboard = [];
  for (const sub of group.subStyles) {
    keyboard.push([{ text: sub.name, callback_data: `substyle_select:${sub.id}` }]);
  }
  keyboard.push([{ text: '🔙 К категориям', callback_data: `substyle_menu:${styleId}` }]);

  return {
    text: `<b>${style.name}</b> — <b>${group.name}</b>

Выбери подстиль 👇`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Обработать выбор подстиля.
 * Ищет подстиль в subStyles или в groups->subStyles и передаёт его id в handleStyleSelected.
 */
function handleSubStyleSelected(telegramId, subStyleId) {
  const styles = readJSON(STYLES_FILE);
  // Сначала ищем в плоских subStyles
  for (const style of styles) {
    if (style.subStyles) {
      const sub = style.subStyles.find(s => s.id === subStyleId);
      if (sub) {
        return handleStyleSelected(telegramId, subStyleId);
      }
    }
    // Потом ищем внутри groups
    if (style.groups) {
      for (const group of style.groups) {
        const sub = group.subStyles.find(s => s.id === subStyleId);
        if (sub) {
          return handleStyleSelected(telegramId, subStyleId);
        }
      }
    }
  }
  return { text: '❌ Такого подстиля нет. Выбери из предложенных.' };
}

/**
 * Возвращает id случайного подстиля из Warhammer 40k (все группы).
 * Возвращает null, если не найдено.
 */
function handleWarhammerRandom() {
  const styles = readJSON(STYLES_FILE);
  const wh = styles.find(s => s.id === 'warhammer');
  if (!wh || !wh.groups || wh.groups.length === 0) {
    return null;
  }

  const allSubs = [];
  for (const group of wh.groups) {
    if (group.subStyles) {
      for (const sub of group.subStyles) {
        allSubs.push(sub);
      }
    }
  }

  if (allSubs.length === 0) return null;

  return allSubs[Math.floor(Math.random() * allSubs.length)].id;
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
  // Не-админам скрываем 2.5 Flash и GPT-Image 2
  const filtered = { ...MODEL_OPTIONS };
  delete filtered['gemini-2.5-flash-image'];
  delete filtered['openai-gpt-image-2'];
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

  text += '\n🔹 Оплата производится через сервис <b>ЮKassa</b>.';

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
    
    // Сохраняем 'no_avatar' если был выбран
    if (convAvatarId === 'no_avatar') {
      setConversation(telegramId, 'idle', { userId: user.id, avatarId: 'no_avatar' });
    } else {
      const savedAvatar = convAvatarId ? userAvatars.find(a => a.id === convAvatarId) : null;
      const avatar = savedAvatar || userAvatars[userAvatars.length - 1];
      setConversation(telegramId, 'awaiting_style', { userId: user.id, avatarId: avatar.id });
    }

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
function handleOnboardingLearnMore(telegramId) {
  setConversation(telegramId, 'awaiting_onboarding_choice', {});
  return {
    text: 'Вот как это работает 👇\n\n'
      + '1️⃣ <b>Загрузи фото</b>\n'
      + 'Можно прислать одно, но лучше несколько. Выбирай самые качественные и любимые.\n\n'
      + '2️⃣ <b>Создание аватара</b>\n'
      + 'После загрузки я создам твой цифровой аватар, и можно приступать к созданию новых фото.\n\n'
      + '3️⃣ <b>Генерация фото</b>\n'
      + 'Можно создавать фото с использованием готовых стилей или написать детальное описание самому (промпт).\n\n'
      + '4️⃣ <b>Несколько аватаров</b>\n'
      + 'При желании можно создать несколько аватаров и делать фото для близких и друзей.\n\n'
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
function handlePhotosReceived(telegramId, filePaths, userDisplayName, language = '', isPremium = false) {
  const conv = getConversation(telegramId);
  if (conv.state !== 'awaiting_photos') {
    return null;
  }

  if (!filePaths || filePaths.length === 0) {
    return { text: 'Пожалуйста, отправь фото. Нужны твои фотографии для создания аватара.' };
  }

  if (filePaths.length > 10) {
    return { text: 'Слишком много фото за раз. На аватар можно не больше 10 фото.' };
  }

  // Есть ли уже пользователь?
  let user = findUserByTelegram(telegramId);

  if (user) {
    // Проверяем лимит аватаров для существующего пользователя (кроме админа)
    if (String(telegramId) !== ADMIN_TELEGRAM_ID) {
      const allAvatars = readJSON(AVATARS_FILE);
      const userAvatars = allAvatars.filter(a => user.avatars.includes(a.id));
      if (userAvatars.length >= 4) {
        return {
          text: '⚠️ Максимум 4 аватара. Удали один из существующих, чтобы создать новый.',
          reply_markup: {
            inline_keyboard: [[{ text: '👤 Аватары', callback_data: 'back_to_avatars' }]]
          }
        };
      }
    }
  }

  if (!user) {
    // Определяем страну по языку интерфейса
    const country = detectCountry(language);

    // Создаём нового
    const users = readJSON(USERS_FILE);
    const userId = generateId('user_', users);
    user = {
      id: userId,
      name: userDisplayName || `User ${telegramId}`,
      telegram: `@${telegramId}`,
      generationsRemaining: 5,
      language: language || '',
      country: country,
      isPremium: isPremium,
      avatars: []
    };
    users.push(user);
    writeJSON(USERS_FILE, users);
  } else {
    // Уже существующий пользователь — обновляем premium-статус
    const usersReload = readJSON(USERS_FILE);
    const existing = usersReload.find(u => u.id === user.id);
    if (existing && existing.isPremium !== isPremium) {
      existing.isPremium = isPremium;
      writeJSON(USERS_FILE, usersReload);
    }
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
    // Проверяем режим "Без аватара"
    if (conv?.data?.avatarId === 'no_avatar') {
      conv = { state: 'awaiting_style', data: { ...conv.data } };
    } else {
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
  }

  const styles = readJSON(STYLES_FILE);
  // Ищем стиль сначала на верхнем уровне, потом в подстилях
  let style = styles.find(s => s.id === styleId);
  let parentStyleName = null;
  if (!style) {
    // Ищем в подстилях
    for (const s of styles) {
      if (s.subStyles) {
        style = s.subStyles.find(sub => sub.id === styleId);
        if (style) {
          parentStyleName = s.name;
          break;
        }
      }
      // Ищем в группах подстилей
      if (!style && s.groups) {
        for (const group of s.groups) {
          style = group.subStyles.find(sub => sub.id === styleId);
          if (style) {
            parentStyleName = s.name;
            break;
          }
        }
      }
    }
  }
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

  // Для режима "Без аватара" не ищем аватар
  let avatar = null;
  if (avatarId !== 'no_avatar') {
    const avatars = readJSON(AVATARS_FILE);
    avatar = avatars.find(a => a.id === avatarId);
  }

  // Не списываем генерации — они будут списаны после успешной генерации
  // Сохраняем lastGeneratedPrompt, если он был (для кнопки «Повторить»)
  const existingData = getConversation(telegramId).data || {};
  setConversation(telegramId, 'awaiting_style', {
    userId,
    avatarId,
    lastGeneratedPrompt: existingData.lastGeneratedPrompt
  });

  const displayName = parentStyleName ? `${parentStyleName} → ${style.name}` : style.name;

  return {
    text: `✅ Стиль «${displayName}». Генерирую...`,
    parse_mode: 'HTML',
    style, parentStyleName, userId, avatarId, cost,
    user, avatar,
    remaining: user.generationsRemaining,
    isNoAvatar: avatarId === 'no_avatar',
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

/**
 * Показать фото аватара — вернуть массив полных путей к фото.
 */
function handleShowAvatar(telegramId, avatarId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return { error: 'Пользователь не найден' };

  const allAvatars = readJSON(AVATARS_FILE);
  const avatar = allAvatars.find(a => a.id === avatarId);
  if (!avatar) return { error: 'Аватар не найден' };

  if (!user.avatars.includes(avatarId)) return { error: 'Это не твой аватар' };

  const photos = (avatar.photos || []).map(rel => path.join(__dirname, '..', rel)).filter(p => fs.existsSync(p));

  if (photos.length === 0) return { error: 'Фото аватара не найдены на диске' };

  return { photos, avatarName: avatar.name };
}

/**
 * Меню действий над аватаром — Посмотреть / Удалить / Выбрать / Назад
 * Не выбирает аватар — только открывает подменю.
 */
function handleAvatarMenu(telegramId, avatarId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return null;

  const allAvatars = readJSON(AVATARS_FILE);
  const avatar = allAvatars.find(a => a.id === avatarId);
  if (!avatar || !user.avatars.includes(avatarId)) return null;

  const inlineKeyboard = [];
  if (avatar.photos.length > 1) {
    inlineKeyboard.push([{ text: '👁 Посмотреть все фото', callback_data: 'show_avatar:' + avatarId }]);
  }
  inlineKeyboard.push(
    [{ text: '✏️ Переименовать', callback_data: 'rename_avatar:' + avatarId }],
    [{ text: '🗑 Удалить', callback_data: 'del_avatar:' + avatarId }],
    [{ text: '🔙 Назад', callback_data: 'back_to_avatars' }]
  );

  return {
    text: `👤 <b>${avatar.name}</b>
${avatar.photos.length} фото`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: inlineKeyboard
    },
    photo: avatar.photos[0] || null
  };
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
 * Показать подтверждение удаления аватара.
 */
function handleDeleteConfirm(telegramId, avatarId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return null;

  const allAvatars = readJSON(AVATARS_FILE);
  const avatar = allAvatars.find(a => a.id === avatarId);
  if (!avatar || !user.avatars.includes(avatarId)) return null;

  return {
    text: `❓ Точно удалить аватар «<b>${avatar.name}</b>»? Это действие нельзя отменить.`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗑 Удалить', callback_data: 'confirm_del_avatar:' + avatarId }],
        [{ text: '🔙 Назад', callback_data: 'back_to_avatar_menu:' + avatarId }]
      ]
    }
  };
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

  const allAvatars = readJSON(AVATARS_FILE);
  const userAvatars = allAvatars.filter(a => user.avatars.includes(a.id));
  // Для админа нет лимита аватаров
  if (String(telegramId) !== ADMIN_TELEGRAM_ID && userAvatars.length >= 4) {
    return {
      text: '⚠️ Максимум 4 аватара. Удали один из существующих, чтобы создать новый.',
      reply_markup: {
        inline_keyboard: [[{ text: '👤 Аватары', callback_data: 'back_to_avatars' }]]
      }
    };
  }

  if (user.generationsRemaining <= 0) {
    return exhaustionMessage();
  }

  resetConversation(telegramId);
  setConversation(telegramId, 'awaiting_photos', {});
  return {
    text: '📸 Отправь новые фото для нового аватара.\nМожно до 10 фото одним сообщением.'
  };
}

/**
 * Показать аватары пользователя
 */
function handleAvatars(telegramId) {
  const user = findUserByTelegram(telegramId);
  if (!user) {
    return {
      text: '📸 У тебя пока нет аватаров. Напиши /start, чтобы создать первый.',
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
        text: '😔 У тебя нет аватаров, а генерации закончились. Пополни баланс, чтобы создать новый аватар.',
        reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] }
      };
    }
    return {
      text: `📸 У тебя пока нет аватаров. Загрузи фото, чтобы создать первый!

🌀 У тебя <b>${user.generationsRemaining}</b> ${pluralGen(user.generationsRemaining)} на счету.`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '📸 Загрузить фото', callback_data: 'new_avatar' }]]
      }
    };
  }

  // Получаем текущий аватар из conversation
  const conv = getConversation(telegramId);
  const currentAvatarId = conv?.data?.avatarId;

  const keyboard = [];
  for (const av of userAvatars) {
    const isCurrent = av.id === currentAvatarId;
    keyboard.push([
      {
        text: (isCurrent ? '✅ ' : '') + av.name,
        callback_data: 'avatar:' + av.id
      },
      {
        text: '⚙️',
        callback_data: 'avatar_actions:' + av.id
      }
    ]);
  }

  // Добавляем кнопки внизу списка
  keyboard.push([{
    text: '➕ Новый аватар',
    callback_data: 'new_avatar'
  }]);

  // Режим "Без аватара"
  const isNoAvatarMode = currentAvatarId === 'no_avatar';
  keyboard.push([{
    text: (isNoAvatarMode ? '✅ ' : '❌ ') + 'Без аватара',
    callback_data: 'avatar:no_avatar'
  }]);

  return {
    text: '👤 Твои аватары\n\n👉 Нажми на аватар, чтобы выбрать\n⚙️ Доп. действия\n❌ Без аватара — генерация без твоих фото',
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

  // Если выбран "Без аватара" — просим выбрать аватар
  const conv = getConversation(telegramId);
  if (conv?.data?.avatarId === 'no_avatar') {
    return {
      text: '⚠️ Сначала выбери аватар в меню 👤 Аватар, чтобы использовать стили.',
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '👤 Выбрать аватар', callback_data: 'back_to_avatars' }]]
      }
    };
  }

  const avatars = readJSON(AVATARS_FILE);
  
  // Пытаемся использовать выбранный аватар из conversation
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
        text: `📸 Сначала загрузи фото, чтобы создать аватар!

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

  // Проверяем режим "Без аватара"
  const conv = getConversation(telegramId);
  if (conv?.data?.avatarId === 'no_avatar') {
    setConversation(telegramId, 'awaiting_custom_prompt', {
      userId: user.id,
      avatarId: 'no_avatar'
    });
    return {
      text: '✍️ <b>Промпт</b>\n\nНапиши, что хочешь увидеть на фото. Генерация будет без использования твоих фото.\n\nПример: <i>«киберпанк, неоновые огни, дождь, как в Blade Runner»</i>',
      parse_mode: 'HTML'
    };
  }

  const avatars = readJSON(AVATARS_FILE);
  let currentAvatarId = null;

  // Берём аватар из conversation или первый попавшийся
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
      text: `📸 Сначала загрузи фото, чтобы создать аватар!

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

  // Для режима "Без аватара" не ищем аватар
  let avatar = null;
  const isNoAvatar = avatarId === 'no_avatar';
  if (!isNoAvatar) {
    const avatars = readJSON(AVATARS_FILE);
    avatar = avatars.find(a => a.id === avatarId);
  }

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
    isNoAvatar,
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

/**
 * Секретный код SECRETGIFT100 — одноразовое начисление 100 генераций.
 * @returns {{ count: number } | null} — объект с новым количеством, или null если пользователь не найден
 */
function setGenerationsTo100(telegramId) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.telegram === `@${telegramId}`);
  if (!user) return null;

  // Проверка: код уже использован?
  if (!user.usedCodes) user.usedCodes = [];
  if (user.usedCodes.includes('SECRETGIFT100')) {
    return { count: user.generationsRemaining, alreadyUsed: true };
  }

  user.generationsRemaining += 100;
  user.usedCodes.push('SECRETGIFT100');
  writeJSON(USERS_FILE, users);
  console.log(`🎉 SECRETGIFT100 ${user.name || user.telegram}: +100 → ${user.generationsRemaining}`);
  return { count: user.generationsRemaining, alreadyUsed: false };
}

function updateUserPremium(telegramId, isPremium) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.telegram === `@${telegramId}`);
  if (!user) return false;
  if (user.isPremium === isPremium) return true; // не изменилось
  user.isPremium = isPremium;
  writeJSON(USERS_FILE, users);
  console.log(`⭐ ${user.name || user.telegram}: premium=${isPremium}`);
  return true;
}

// ======================
// НАСТРОЙКИ
// ======================

const ADMIN_TELEGRAM_ID = '132454710';

const MODEL_COST = {
  'gemini-2.5-flash-image': 1,
  'gemini-3.1-flash-image-preview': 1,
  'gemini-3-pro-image-preview': 2,
  'openai-gpt-image-1.5': 1,
  'openai-gpt-image-2': 2,
};

const OPENAI_QUALITY_OPTIONS = {
  'low':    { label: '💠 Low', desc: 'быстро, дёшево, ~$0.006' },
  'medium': { label: '💎 Medium', desc: 'сбалансированно, ~$0.053' },
  'high':   { label: '🔥 High', desc: 'макс. качество, ~$0.211' }
};

const RESOLUTION_OPTIONS = {
  '0.5K': { label: '🟢 0.5K (512px)', desc: 'дёшево, $0.045/фото (только Flash)' },
  '1K':   { label: '🟡 1K (1024px)', desc: 'стандарт, $0.067/фото' },
  '2K':   { label: '🟠 2K (2048px)', desc: 'высокое, $0.101/фото' },
  '4K':   { label: '🔴 4K (4096px)', desc: 'макс, $0.151/фото (Flash) / $0.24/фото (Pro)' }
};

const DEFAULT_SETTINGS = {
  quality: 'standard',
  aspectRatio: '1:1',
  model: 'openai-gpt-image-1.5',
  debug: false,
  portraitType: 'bust',
  faceTurn: 'none',
  resolution: '1K',
  openaiQuality: 'low'
};

const QUALITY_OPTIONS = {
  economy:  { label: '🟢 Эконом', prompt: 'low quality, fast generation, compressed' },
  standard: { label: '👍 Стандарт', prompt: 'standard quality, balanced' },
  premium:  { label: '🔥 Премиум', prompt: 'ultra high quality, maximum detail, 8K, professional photography grade' }
};

const ASPECT_OPTIONS = {
  '1:1': { label: '📐 1:1 Квадрат' },
  '4:3': { label: '🖼 4:3 Классика' },
  '16:9': { label: '🎬 16:9 Широкий' },
  '3:4': { label: '📱 3:4 Портрет' },
  '9:16': { label: '📲 9:16 Телефон' }
};

const PORTRAIT_TYPE_OPTIONS = {
  none:      { label: '❌ Любой / без ограничения', hint: '' },
  headshot:  { label: 'Головной',  hint: 'headshot, face forward, tightly framed head and shoulders, passport photo style' },
  shoulder:  { label: 'Поплечный',          hint: 'shoulder-length portrait, face, neck and shoulders visible, emphasis on expression and gaze' },
  bust:      { label: 'Погрудный',          hint: 'bust portrait, face with shoulders and upper chest visible, focus on face with some shoulder context' },
  waist:     { label: 'Поясной',            hint: 'waist-length portrait, from head to waist, allows postural expression and arm positioning' },
  full_body: { label: 'Ростовой',           hint: 'full body portrait, entire body from head to toe' },
  close_up:  { label: 'Крупный план',       hint: 'extreme close-up portrait, intense focus on facial features, eyes, nose, mouth, skin texture detail' }
};

const FACE_TURN_OPTIONS = {
  none:           { label: '❌ Любой / без ограничения', hint: '' },
  front:          { label: 'Анфас',       hint: 'face directly facing camera, looking straight into the lens, both eyes and face symmetry fully visible' },
  three_quarter:  { label: 'Три четверти', hint: 'face turned about 45 degrees from camera, three-quarter view, one eye closer to camera than the other, adds depth to the portrait' },
  half_profile:   { label: 'Полупрофиль',  hint: 'face turned about 75 degrees from camera, half-profile view, one side of face more prominent, dramatic look' },
  profile:        { label: 'Профиль',      hint: 'face fully turned 90 degrees from camera, profile view, only one side of face visible, nose and chin in silhouette' },
  three_quarter_back: { label: 'Три четверти сзади', hint: 'face turned about 135 degrees away from camera, three-quarter rear view, partially visible face looking back, intriguing and dynamic' },
  over_shoulder:  { label: 'Поворот спиной', hint: 'person facing away from camera but looking back over shoulder, only partial face visible, creating a mysterious look over the shoulder' }
};

const MODEL_OPTIONS = {
  'gemini-3.1-flash-image-preview': { label: '⚡ Идеализм', desc: 'Быстрая, нормальное качество. Стоимость — 1 генерация.' },
  'gemini-3-pro-image-preview': { label: '🏆 Идеализм ПРО', desc: 'Максимальное качество, но медленнее и дороже. Стоимость — 2 генерации.' },
  'gemini-2.5-flash-image': { label: '🟢 Flash 2.5', desc: 'Только для админа' },
  'openai-gpt-image-1.5': { label: '🎨 Реализм', desc: '1 генерация, с поддержкой фото-референса' },
  'openai-gpt-image-2': { label: '🌟 Реализм ПРО', desc: '1 генерация, до 4K, только для админа' },
};


function getSettings(telegramId) {
  try {
    const all = readJSON(SETTINGS_FILE);
    const settings = { ...DEFAULT_SETTINGS, ...(all[telegramId] || {}) };
    // Не-админам 2.5 Flash не показываем и не используем
    if ((settings.model === "gemini-2.5-flash-image" || (settings.model.startsWith('openai-') && settings.model !== 'openai-gpt-image-1.5')) && String(telegramId) !== ADMIN_TELEGRAM_ID) {
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
  const isAdmin = String(telegramId) === ADMIN_TELEGRAM_ID;
  const modelLabel = MODEL_OPTIONS[s.model]?.label || '⚙️ Не выбрана';
  const aspectLabel = ASPECT_OPTIONS[s.aspectRatio]?.label || '📐 1:1';

  let textLines, keyboard;

  if (isAdmin) {
    // Админ — полное меню
    const qualityLabel = QUALITY_OPTIONS[s.quality]?.label || '👍 Стандарт';
    const debugLabel = s.debug ? '🔧 Вкл' : '🔧 Выкл';
    const portraitLabel = PORTRAIT_TYPE_OPTIONS[s.portraitType]?.label || 'Головной';
    const faceTurnLabel = FACE_TURN_OPTIONS[s.faceTurn]?.label || 'Анфас';
    const resolutionLabel = RESOLUTION_OPTIONS[s.resolution]?.label || '🟡 1K';
    const openaiQualityLabel = OPENAI_QUALITY_OPTIONS[s.openaiQuality]?.label || '💎 Medium';

    keyboard = [
      [{ text: '📐 Соотношение: ' + aspectLabel, callback_data: 'settings_aspect' }],
      [{ text: '📸 Портрет: ' + portraitLabel, callback_data: 'settings_portrait_type' }],
      [{ text: '🔄 Поворот: ' + faceTurnLabel, callback_data: 'settings_face_turn' }],
      [{ text: '🤖 Нейросеть: ' + modelLabel, callback_data: 'settings_model' }],
      [{ text: '🔧 Отладка: ' + debugLabel, callback_data: 'settings_debug' }],
      [{ text: '📷 Качество: ' + qualityLabel, callback_data: 'settings_quality' }],
      [{ text: '🔍 Разрешение: ' + resolutionLabel, callback_data: 'settings_resolution' }],
      [{ text: '🌟 Качество 2: ' + openaiQualityLabel, callback_data: 'settings_openai_quality' }],
      [{ text: '🔙 Назад', callback_data: 'settings_back' }]
    ];

    textLines = '🤖 Нейросеть: ' + modelLabel + '\n📐 Соотношение: ' + aspectLabel + '\n📸 Портрет: ' + portraitLabel + '\n🔄 Поворот: ' + faceTurnLabel + '\n🔧 Отладка: ' + debugLabel + '\n📷 Качество: ' + qualityLabel + '\n🔍 Разрешение: ' + resolutionLabel + '\n🌟 Качество 2: ' + openaiQualityLabel;
  } else {
    // Обычные пользователи — портрет, модель, соотношение
    const portraitLabel = PORTRAIT_TYPE_OPTIONS[s.portraitType]?.label || 'Головной';
    const faceTurnLabel = FACE_TURN_OPTIONS[s.faceTurn]?.label || 'Анфас';
    keyboard = [
      [{ text: '📸 Портрет: ' + portraitLabel, callback_data: 'settings_portrait_type' }],
      [{ text: '🔄 Поворот: ' + faceTurnLabel, callback_data: 'settings_face_turn' }],
      [{ text: '📐 Соотношение: ' + aspectLabel, callback_data: 'settings_aspect' }],
      [{ text: '🤖 Нейросеть: ' + modelLabel, callback_data: 'settings_model' }],
      [{ text: '🔙 Назад', callback_data: 'settings_back' }]
    ];

    textLines = '🤖 Нейросеть: ' + modelLabel + '\n📐 Соотношение: ' + aspectLabel + '\n📸 Портрет: ' + portraitLabel + '\n🔄 Поворот: ' + faceTurnLabel;
  }

  return {
    text: '⚙️ <b>Настройки генерации</b>\n\nТекущие:\n' + textLines + '\n\nВыбери параметр для изменения 👇',
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
 * Показать выбор типа портретного фото.
 */
function handleSettingsPortraitType(telegramId) {
  const s = getSettings(telegramId);
  const keyboard = Object.entries(PORTRAIT_TYPE_OPTIONS).map(([key, opt]) => ({
    text: (s.portraitType === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_portrait_type:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  return {
    text: '📸 <b>Тип портретного фото</b>\n\nВыбери тип кадрирования — он будет применяться ко <b>всем стилям</b>:\n\n❌ <b>Любой / без ограничения</b> — нейросеть сама выберет кадрирование\n👤 <b>Головной</b> — классический, обязательно лицо\n🧑 <b>Поплечный</b> — лицо, шея и плечи\n👔 <b>Погрудный</b> — лицо, плечи и грудь\n👕 <b>Поясной</b> — до пояса, видны фигура и позы\n🧍 <b>Ростовой</b> — фото в полный рост\n🔍 <b>Крупный план</b> — акцент на деталях лица\n\nСейчас: <b>' + PORTRAIT_TYPE_OPTIONS[s.portraitType]?.label + '</b>',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Показать выбор поворота лица.
 */
function handleSettingsFaceTurn(telegramId) {
  const s = getSettings(telegramId);
  const keyboard = Object.entries(FACE_TURN_OPTIONS).map(([key, opt]) => ({
    text: (s.faceTurn === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_face_turn:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  return {
    text: '🔄 <b>Поворот лица</b>\n\nВыбери положение лица относительно камеры — будет применяться ко <b>всем стилям</b>:\n\n❌ <b>Любой / без ограничения</b> — нейросеть сама выберет ракурс\n👤 <b>Анфас</b> — лицо прямо в объектив\n🔄 <b>Три четверти</b> — поворот ~45°, глубина\n🎭 <b>Полупрофиль</b> — ~75°, драматичный эффект\n横 <b>Профиль</b> — 90°, чёткие черты лица\n👀 <b>Три четверти сзади</b> — ~135°, интрига\n💫 <b>Поворот спиной</b> — взгляд через плечо\n\nСейчас: <b>' + FACE_TURN_OPTIONS[s.faceTurn]?.label + '</b>',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Показать выбор модели.
 */
function getPortraitTypePrompt(telegramId) {
  const s = getSettings(telegramId);
  if (s.portraitType === 'none') return '';
  return PORTRAIT_TYPE_OPTIONS[s.portraitType]?.hint || PORTRAIT_TYPE_OPTIONS.headshot.hint;
}

function getFaceTurnPrompt(telegramId) {
  const s = getSettings(telegramId);
  if (s.faceTurn === 'none') return '';
  return FACE_TURN_OPTIONS[s.faceTurn]?.hint || FACE_TURN_OPTIONS.front.hint;
}

function getDebugEnabled(telegramId) {
  const s = getSettings(telegramId);
  return s.debug === true;
}

/**
 * Показать меню отладки (только для админа).
 */
function handleSettingsDebug(telegramId) {
  const s = getSettings(telegramId);
  const isEnabled = s.debug === true;

  return {
    text: '🔧 <b>Режим отладки</b>\n\n'
      + 'Показывает техническую информацию после каждой генерации:\n'
      + '• Финальный промпт, отправленный нейросети\n'
      + '• Модель, качество, размер, формат\n\n'
      + 'Сейчас: <b>' + (isEnabled ? '✅ Включён' : '❌ Выключен') + '</b>',
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: (isEnabled ? '✅ ' : '') + 'Включить', callback_data: 'set_debug:true' }],
        [{ text: (!isEnabled ? '✅ ' : '') + 'Выключить', callback_data: 'set_debug:false' }],
        [{ text: '🔙 Назад', callback_data: 'settings_main' }]
      ]
    }
  };
}

function handleSettingsResolution(telegramId) {
  const s = getSettings(telegramId);
  const keyboard = Object.entries(RESOLUTION_OPTIONS).map(([key, opt]) => ({
    text: (s.resolution === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_resolution:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  const lines = Object.entries(RESOLUTION_OPTIONS)
    .map(([key, opt]) => `${opt.label} — ${opt.desc}`)
    .join('\n');

  return {
    text: '🔍 <b>Разрешение (Gemini)</b>\n\nВыбери разрешение для Gemini-моделей:\n\n' + lines + '\n\nВыбери 👇',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

function handleSettingsOpenaiQuality(telegramId) {
  const s = getSettings(telegramId);
  const keyboard = Object.entries(OPENAI_QUALITY_OPTIONS).map(([key, opt]) => ({
    text: (s.openaiQuality === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_openai_quality:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  const lines = Object.entries(OPENAI_QUALITY_OPTIONS)
    .map(([key, opt]) => `${opt.label} — ${opt.desc}`)
    .join('\n');

  return {
    text: '🌟 <b>Качество 2</b>\n\nВыбери качество для OpenAI (gpt-image-1.5 / gpt-image-2):\n\n' + lines + '\n\nВыбери 👇',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  };
}

function handleSettingsModel(telegramId) {
  const s = getSettings(telegramId);
  const options = getModelOptions(telegramId);
  const keyboard = Object.entries(options).map(([key, opt]) => ({
    text: (s.model === key ? '✅ ' : '') + opt.label,
    callback_data: 'set_model:' + key
  })).map(btn => [btn]);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_main' }]);

  const isAdmin = String(telegramId) === ADMIN_TELEGRAM_ID;
  const proLabel = '🏆 <b>Идеализм ПРО</b> — 2 генерации, макс. качество';
  const flashLabel = '⚡ <b>Идеализм</b> — 1 генерация, быстро, нормальное качество';
  const oldLabel = isAdmin ? '\n🟢 <b>Flash 2.5</b> — 1 генерация (только ты)\n' : '';
  const openaiLabel1 = '\n🎨 <b>Реализм</b> — 1 генерация, с поддержкой фото-референса';
  const openaiLabel2 = isAdmin ? '\n🌟 <b>Реализм ПРО</b> — 1 генерация, до 4K (только ты, с поддержкой фото-референса)' : '';
  const openaiLabel = openaiLabel1 + (openaiLabel2 || '') + '\n';

  return {
    text: '🤖 <b>Нейросеть</b>\n\n' + flashLabel + '\n' + proLabel + oldLabel + openaiLabel + '\nВыбери нейросеть 👇',
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
      + '2️⃣ <b>Создание аватара</b>\n'
      + 'После загрузки я создам твой цифровой аватар, и можно приступать к созданию новых фото.\n\n'
      + '3️⃣ <b>Генерация фото</b>\n'
      + 'Можно создавать фото с использованием готовых стилей или написать детальное описание самому (промпт).\n\n'
      + '4️⃣ <b>Несколько аватаров</b>\n'
      + 'При желании можно создать несколько аватаров и делать фото для близких и друзей.',
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

/**
 * Выбрать аватар — сохраняет avatarId в conversation.
 */
function handleSelectAvatar(telegramId, avatarId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return null;

  // Режим "Без аватара"
  if (avatarId === 'no_avatar') {
    const conv = getConversation(telegramId);
    setConversation(telegramId, conv.state || 'idle', { ...(conv.data || {}), avatarId: 'no_avatar' });
    return { success: true, name: 'Без аватара', isNoAvatar: true };
  }

  const allAvatars = readJSON(AVATARS_FILE);
  const avatar = allAvatars.find(a => a.id === avatarId);
  if (!avatar || !user.avatars.includes(avatarId)) return null;

  // Устанавливаем аватар как текущий
  const conv = getConversation(telegramId);
  setConversation(telegramId, conv.state || 'idle', { ...(conv.data || {}), avatarId });

  return { success: true, name: avatar.name };
}

/**
 * Запросить новое название для аватара.
 */
function handleStartRenameAvatar(telegramId, avatarId) {
  const user = findUserByTelegram(telegramId);
  if (!user) return null;

  const allAvatars = readJSON(AVATARS_FILE);
  const avatar = allAvatars.find(a => a.id === avatarId);
  if (!avatar || !user.avatars.includes(avatarId)) return null;

  setConversation(telegramId, 'awaiting_avatar_rename', { avatarId });

  return {
    text: `✏️ Напиши новое название для «${avatar.name}»:`
  };
}

/**
 * Сохранить новое название аватара.
 */
function handleRenameAvatarDone(telegramId, newName) {
  const conv = getConversation(telegramId);
  const avatarId = conv?.data?.avatarId;
  if (!avatarId) return { error: 'Нет аватара для переименования' };

  const user = findUserByTelegram(telegramId);
  if (!user) return { error: 'Пользователь не найден' };

  const trimmed = newName.trim();
  if (!trimmed) return { error: 'Имя не может быть пустым' };
  if (trimmed.length > 40) return { error: 'Слишком длинное (макс. 40 символов)' };

  const allAvatars = readJSON(AVATARS_FILE);
  const avatar = allAvatars.find(a => a.id === avatarId);
  if (!avatar || !user.avatars.includes(avatarId)) return { error: 'Аватар не найден' };

  avatar.name = trimmed;
  writeJSON(AVATARS_FILE, allAvatars);

  // Сохраняем выбранный аватар, сбрасываем только состояние
  setConversation(telegramId, 'idle', { avatarId });

  return { success: true, name: trimmed };
}

// ======================
// Payments (отдельное хранилище от conversations)
// ======================

const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');

function _readPayments() {
  try { return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8')); }
  catch { return {}; }
}

function _writePayments(data) {
  writeJSON(PAYMENTS_FILE, data);
}

/**
 * Получить список pending-платежей для пользователя
 */
function getPendingPayments(telegramId) {
  const all = _readPayments();
  return all[telegramId] || [];
}

/**
 * Добавить платёж в список ожидания
 */
function addPendingPayment(telegramId, paymentId, packageId) {
  const all = _readPayments();
  if (!all[telegramId]) all[telegramId] = [];
  if (!all[telegramId].find(p => p.paymentId === paymentId)) {
    all[telegramId].push({
      paymentId,
      packageId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  _writePayments(all);
}

/**
 * Удалить платёж (по оплате или отмене)
 */
function removePendingPayment(telegramId, paymentId) {
  const all = _readPayments();
  if (all[telegramId]) {
    all[telegramId] = all[telegramId].filter(p => p.paymentId !== paymentId);
    if (all[telegramId].length === 0) delete all[telegramId];
  }
  _writePayments(all);
}

/**
 * Получить все pending-платежи всех пользователей (для восстановления watcher'ов)
 */
function getAllPendingPayments() {
  const all = _readPayments();
  const result = [];
  for (const [telegramId, list] of Object.entries(all)) {
    for (const pp of list) {
      result.push({ telegramId, ...pp });
    }
  }
  return result;
}

module.exports = {
  handleHelp,
  handleHelpInstructions,
  handleHelpSupport,
  isNewUser,
  handleStart,
  handleBuy,
  handlePhotosReceived,
  handleStyleSelected,
  handleSubStyleMenu,
  handleSubStyleSelected,
  handleSubStyleGroup,
  handleWarhammerRandom,
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
  handleAvatarMenu,
  handleSelectAvatar,
  handleStartRenameAvatar,
  handleRenameAvatarDone,
  handleGodMode,
  handleCustomPrompt,
  handleCancelGodMode,
  handleNewAvatar,
  deleteAvatar,
  handleDeleteConfirm,
  checkBalance,
  consumeGeneration,
  addGenerations,
  setGenerationsTo100,
  updateUserPremium,
  handleShowAvatar,
  buildMainKeyboard,
  buildStylesKeyboard,
  readJSON,
  writeJSON,
  getSettings,
  updateSetting,
  handleSettings,
  handleSettingsQuality,
  handleSettingsAspect,
  handleSettingsModel,
  handleSettingsDebug,
  handleSettingsResolution,
  handleSettingsOpenaiQuality,
  OPENAI_QUALITY_OPTIONS,
  RESOLUTION_OPTIONS,
  getDebugEnabled,
  getPortraitTypePrompt,
  handleSettingsPortraitType,
  getFaceTurnPrompt,
  handleSettingsFaceTurn,
  PORTRAIT_TYPE_OPTIONS,
  FACE_TURN_OPTIONS,
  getQualityPrompt,
  getAspectRatio,
  QUALITY_OPTIONS,
  ASPECT_OPTIONS,
  MODEL_OPTIONS,
  getModelCost,
  MODEL_COST,
  pluralGen,
  getPendingPayments,
  addPendingPayment,
  removePendingPayment,
  getAllPendingPayments
};
