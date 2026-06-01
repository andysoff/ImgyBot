#!/usr/bin/env node
/**
 * Imgy Bot — Telegram long-polling раннер
 *
 * Запуск:
 *   BOT_TOKEN=123:Abc... node scripts/bot-runner.js
 *
 * Токен — от @BotFather.
 *
 * Обрабатывает:
 *   /start          → приветствие (шаг 1)
 *   фото            → загрузка, создание юзера, кнопки стилей (шаги 2-3)
 *   callback_data   → выбор стиля → генерация (шаги 4-5)
 *   "отмена"        → возврат в начало
 */

// ===================== PID Lock =====================
// Защита от дублирования процессов — только один экземпляр бота.
const PID_FILE = '/tmp/imgy-bot.pid';

function acquirePidLock() {
  const _fs = require('fs');
  try {
    if (_fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(_fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (oldPid && !isNaN(oldPid)) {
        try {
          // Проверяем, жив ли процесс с этим PID
          process.kill(oldPid, 0);
          console.error(`❌ Дублирование! Процесс ${oldPid} уже запущен. Выход.`);
          console.error(`   Если нужно принудительно: rm -f ${PID_FILE}`);
          process.exit(1);
        } catch (err) {
          // Старый PID не существует — удаляем мусор
          if (err.code === 'ESRCH') {
            console.warn(`⚠️ Старый PID ${oldPid} не найден, удаляю мусорный lock-файл.`);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ Не удалось проверить PID-файл: ${err.message}`);
  }

  // Пишем свой PID
  _fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');

  // Удаляем lock при выходе
  function removeLock() {
    try {
      if (_fs.existsSync(PID_FILE) && _fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
        _fs.unlinkSync(PID_FILE);
        console.log('🧹 PID-файл очищен.');
      }
    } catch {}
  }
  process.on('exit', removeLock);
  process.on('SIGINT', () => { process.exit(0); });
  process.on('SIGTERM', () => { process.exit(0); });
  process.on('SIGHUP', () => { process.exit(0); });

  console.log(`🔒 PID lock acquired: ${process.pid} → ${PID_FILE}`);
}

acquirePidLock();
// ===================== /PID Lock ====================


const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ Укажи BOT_TOKEN=123:Abc...');
  process.exit(1);
}

const botLogic = require('./bot-logic');
const generateImage = require('./generate-image');

const PHOTOS_TMP = path.join(__dirname, '..', 'photos', '_incoming');
fs.mkdirSync(PHOTOS_TMP, { recursive: true });

// ===================== Проверка файлов Gemini =====================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Проверить, жив ли файл в Gemini File API.
 * @param {string} name — полное имя файла (например "files/abc123")
 * @returns {Promise<boolean>} — true если файл активен
 */
async function verifyGeminiFile(name) {
  if (!GEMINI_API_KEY) return false;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/${name}?key=${GEMINI_API_KEY}`;
    const result = await new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
        });
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
    });
    if (result.error) {
      console.warn(`⚠️ Файл ${name} невалиден: ${result.error.message}`);
      return false;
    }
    const valid = result.state === 'ACTIVE' || result.state === 'PROCESSING';
    if (!valid) console.warn(`⚠️ Файл ${name} имеет статус ${result.state}`);
    return valid;
  } catch (err) {
    console.warn(`⚠️ Ошибка проверки файла ${name}: ${err.message}`);
    return false;
  }
}

/**
 * Получить валидные geminiFiles для аватара — проверить кеш, перезагрузить протухшие.
 * @param {object} avatar — объект аватара из avatars.json
 * @param {object} avatars — весь массив (для сохранения)
 * @returns {Promise<Array<{uri: string, mimeType: string}>>}
 */
async function ensureGeminiFiles(avatar, avatars) {
  if (!avatar) return [];

  // Есть кешированные? Проверяем каждый
  if (avatar.geminiFiles && avatar.geminiFiles.length > 0) {
    const validFiles = [];
    let allValid = true;
    for (const gf of avatar.geminiFiles) {
      if (gf.uri) {
        // Извлекаем имя файла из URI: .../v1beta/files/xyz
        const nameMatch = gf.uri.match(/\/v1beta\/(files\/[^\s?]+)/);
        const fileName = nameMatch ? nameMatch[1] : null;
        if (fileName) {
          const alive = await verifyGeminiFile(fileName);
          if (alive) {
            validFiles.push(gf);
          } else {
            allValid = false;
          }
        } else {
          // Не смогли распарсить — считаем невалидным
          allValid = false;
        }
      }
    }

    if (allValid && validFiles.length === avatar.geminiFiles.length) {
      // Все живы — используем кеш
      console.log(`⚡ Все ${validFiles.length} файлов аватара ${avatar.id} живы`);
      return validFiles;
    }

    // Часть протухла — удаляем мёртвые, оставляем живые
    if (validFiles.length > 0) {
      console.log(`⚡ ${validFiles.length}/${avatar.geminiFiles.length} файлов живы, остальные перезагрузим`);
      avatar.geminiFiles = validFiles;
    } else {
      avatar.geminiFiles = [];
    }
  }

  // Подгружаем недостающие файлы
  const userPhotos = avatar.photos || [];
  if (userPhotos.length === 0) return [];

  if (!avatar.geminiFiles) avatar.geminiFiles = [];

  for (const photoRel of userPhotos) {
    const fullPath = path.join(__dirname, '..', photoRel);
    if (fs.existsSync(fullPath)) {
      const fileInfo = await generateImage.uploadPhoto(fullPath);
      avatar.geminiFiles.push({ uri: fileInfo.uri, mimeType: fileInfo.mimeType });
    }
  }

  // Сохраняем обновлённый кеш
  const idx = avatars.findIndex(a => a.id === avatar.id);
  if (idx >= 0) {
    avatars[idx] = avatar;
    fs.writeFileSync(
      path.join(__dirname, '..', 'data', 'avatars.json'),
      JSON.stringify(avatars, null, 2) + '\n'
    );
  }

  console.log(`✅ ${avatar.geminiFiles.length} Gemini URI для аватара ${avatar.id}`);
  return avatar.geminiFiles;
}

// ===================== Telegram API =====================

function tgApi(method, body, timeoutMs = 60000) {
  return tgApiWithReq(method, body, timeoutMs).promise;
}

function tgApiWithReq(method, body, timeoutMs = 60000) {
  let req;
  const promise = new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    req = https.request(
      { hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); } });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(payload);
    req.end();
  });
  return { req, promise };
}

async function tgSend(chatId, text, extra = {}) {
  const opts = { chat_id: chatId, text, ...extra };
  console.log(`📤 Отправка ${chatId}: [${text.slice(0, 80)}]`, extra.reply_markup ? '(с кнопками)' : '');
  let res = await tgApi('sendMessage', opts);
  if (!res.ok) {
    console.error(`❌ tgSend ошибка API: ${res.error_code} ${res.description}`);
    // fallback без parse_mode
    const { parse_mode, ...optsClean } = opts;
    res = await tgApi('sendMessage', optsClean);
    if (!res.ok) {
      console.error(`❌ tgSend fallback тоже ошибка: ${res.error_code} ${res.description}`);
    }
  } else {
    console.log(`✅ tgSend OK message_id=${res.result?.message_id}`);
  }
  return res;
}

async function tgEdit(chatId, messageId, text, extra = {}) {
  const opts = { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown', ...extra };
  console.log(`📝 tgEdit ${chatId}:${messageId}`);
  let res = await tgApi('editMessageText', opts);
  if (!res.ok) {
    console.error(`❌ tgEdit ошибка API: ${res.error_code} ${res.description}`);
    const { parse_mode, ...optsClean } = opts;
    res = await tgApi('editMessageText', optsClean);
    if (!res.ok) {
      console.error(`❌ tgEdit fallback ошибка: ${res.error_code} ${res.description}`);
    }
  }
  return res;
}

function tgAnswerCb(cbId, text, alert = false) {
  return tgApi('answerCallbackQuery', { callback_query_id: cbId, text, show_alert: alert });
}

function tgDelete(chatId, messageId) {
  return tgApi('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function tgSendPhoto(chatId, photoPath, caption = '', extra = {}) {
  // Telegram Bot API требует multipart/form-data для отправки файлов.
  // Для простоты используем отправку по URL через Telegram.
  // Сначала загружаем файл через getFile-подход, или используем sendPhoto с upload.
  // Используем простой multipart-запрос вручную.
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
  const CRLF = '\r\n';

  const photoData = fs.readFileSync(photoPath);
  const fileName = path.basename(photoPath);

  let body = '';
  body += `--${boundary}${CRLF}`;
  body += `Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}`;
  body += `${chatId}${CRLF}`;

  if (caption) {
    body += `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="caption"${CRLF}${CRLF}`;
    body += `${caption}${CRLF}`;
  }

  if (extra.parse_mode) {
    body += `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="parse_mode"${CRLF}${CRLF}`;
    body += `${extra.parse_mode}${CRLF}`;
  }

  body += `--${boundary}${CRLF}`;
  body += `Content-Disposition: form-data; name="photo"; filename="${fileName}"${CRLF}`;
  body += `Content-Type: image/jpeg${CRLF}${CRLF}`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(body, 'utf-8'),
    photoData,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf-8')
  ]);

  console.log(`📸 Отправка фото ${chatId}: ${fileName} (${(photoData.length / 1024).toFixed(1)} KB)`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/sendPhoto`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': bodyBuffer.length
        },
        timeout: 120000
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) {
              console.log(`✅ tgSendPhoto OK message_id=${parsed.result?.message_id}`);
            } else {
              console.error(`❌ tgSendPhoto ошибка API: ${parsed.error_code} ${parsed.description}`);
            }
            resolve(parsed);
          } catch { reject(new Error(data)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('sendPhoto timeout')); });
    req.write(bodyBuffer);
    req.end();
  });
}

/**
 * Отправить медиа-группу (альбом) из нескольких фото.
 * @param {number} chatId
 * @param {Array<{type: string, media: string, caption?: string}>} media — массив объектов InputMedia
 * @returns {Promise<object>}
 */
function tgSendMediaGroup(chatId, media) {
  return tgApi('sendMediaGroup', {
    chat_id: chatId,
    media
  }, 120000);
}

// ===================== Загрузка фото =====================

async function downloadFromTelegram(fileId) {
  const info = await tgApi('getFile', { file_id: fileId });
  if (!info.ok) throw new Error(`getFile failed: ${info.description}`);
  const ext = path.extname(info.result.file_path) || '.jpg';
  const tmp = path.join(PHOTOS_TMP, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  // Собираем URL через конструктор URL для правильного квотирования
  const fileUrl = new URL(info.result.file_path, `https://api.telegram.org/file/bot${TOKEN}/`);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmp);
    https.get(fileUrl.href, r => {
      if (r.statusCode !== 200) {
        fs.unlink(tmp, () => {});
        reject(new Error(`HTTP ${r.statusCode} downloading file`));
        return;
      }
      r.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', e => { fs.unlink(tmp, () => {}); reject(e); });
  });
  return tmp;
}

// ===================== Media Group Buffer =====================
// Telegram присылает каждое фото из альбома отдельным апдейтом с media_group_id.
// Буферизуем их и процессим разом после паузы.

const mediaGroups = {};

function getOrCreateBuffer(chatId, mediaGroupId) {
  if (!mediaGroups[chatId]) mediaGroups[chatId] = {};
  if (!mediaGroups[chatId][mediaGroupId]) {
    mediaGroups[chatId][mediaGroupId] = { photos: [], timer: null };
  }
  return mediaGroups[chatId][mediaGroupId];
}

function flushMediaGroup(chatId, mediaGroupId, userName) {
  const buf = mediaGroups[chatId]?.[mediaGroupId];
  if (!buf) return;
  clearTimeout(buf.timer);
  delete mediaGroups[chatId][mediaGroupId];
  processPhotos(chatId, buf.photos, userName);
}

// ===================== Обработка =====================

async function processPhotos(chatId, filePaths, userName) {
  if (filePaths.length === 0) return;
  const result = botLogic.handlePhotosReceived(String(chatId), filePaths, userName);
  if (!result) {
    await tgSend(chatId, 'Напиши /start чтобы начать');
    return;
  }
  await tgSend(chatId, result.text, {
    ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
    ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
  });

  // ==== Загружаем все фото в Gemini File API (с проверкой кеша) ====
  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === result.avatarId);
    if (avatar) {
      await ensureGeminiFiles(avatar, avatars);
    }
  } catch (err) {
    console.error('❌ Ошибка загрузки в Gemini File API:', err.message);
    // Не фатально — генерация догрузит при необходимости
  }
}

async function handleUpdate(update) {
  console.log(`📩 update_id=${update.update_id}, type=${update.message?'msg':update.callback_query?'cb':'other'}`);
  // ------ Callback (нажатие кнопки стиля) ------
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const msgId = cb.message.message_id;
    const data = cb.data || '';

    // ------ Callback: Настройки ------
    if (data === 'settings_main') {
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettings(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'settings_back') {
      await tgAnswerCb(cb.id, '🔙 Назад');
      await tgEdit(chatId, msgId, '⚙️ Настройки закрыты. Используй кнопки ниже 👇');
      return;
    }

    if (data === 'settings_quality') {
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsQuality(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'settings_size') {
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsSize(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'settings_aspect') {
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsAspect(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'settings_model') {
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsModel(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_quality:')) {
      const value = data.replace('set_quality:', '');
      botLogic.updateSetting(String(chatId), 'quality', value);
      await tgAnswerCb(cb.id, '✅ Качество обновлено');
      // Показываем обновлённый список
      const result = botLogic.handleSettingsQuality(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_size:')) {
      const value = data.replace('set_size:', '');
      botLogic.updateSetting(String(chatId), 'size', value);
      await tgAnswerCb(cb.id, '✅ Размер обновлён');
      const result = botLogic.handleSettingsSize(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_aspect:')) {
      const value = data.replace('set_aspect:', '');
      botLogic.updateSetting(String(chatId), 'aspectRatio', value);
      await tgAnswerCb(cb.id, '✅ Соотношение обновлено');
      const result = botLogic.handleSettingsAspect(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_model:')) {
      const value = data.replace('set_model:', '');
      botLogic.updateSetting(String(chatId), 'model', value);
      await tgAnswerCb(cb.id, '✅ Модель обновлена');
      const result = botLogic.handleSettingsModel(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('avatar:')) {
      const avatarId = data.replace('avatar:', '');
      await tgAnswerCb(cb.id, `🖼 Выбран аватар`);

      // Обновляем conversation с новым avatarId
      const conv = botLogic.getConversation(String(chatId));
      if (conv && conv.data) {
        conv.data.avatarId = avatarId;
        botLogic.setConversation(String(chatId), conv.state, conv.data);
      }

      // Показываем стили для выбранного аватара
      const result = botLogic.handleStyles(String(chatId));
      // Обновляем текст сообщения со списком аватаров
      const avText = result
        ? `✅ Аватар выбран.\n\n${result.text}`
        : '✅ Аватар выбран. Нажми 🎨 Стили чтобы продолжить.';
      await tgEdit(chatId, msgId, avText, {
        ...(result?.reply_markup ? { reply_markup: result.reply_markup } : {})
      });

      // Проверяем/загружаем фото выбранного аватара в Gemini (проверка кеша + дозагрузка протухших)
      try {
        const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
        const selectedAvatar = avatars.find(a => a.id === avatarId);
        if (selectedAvatar) {
          const hadFiles = selectedAvatar.geminiFiles && selectedAvatar.geminiFiles.length > 0;
          const files = await ensureGeminiFiles(selectedAvatar, avatars);
          if (!hadFiles && files.length > 0) {
            console.log(`✅ Фото аватара ${avatarId} загружены в Gemini`);
          } else if (files.length > 0) {
            console.log(`⚡ Использую живые кешированные файлы аватара ${avatarId}`);
          }
        }
      } catch (err) {
        console.error('❌ Ошибка загрузки в Gemini при выборе аватара:', err.message);
        // Не фатально — генерация догрузит при необходимости
      }
      return;
    }

    if (data.startsWith('del_avatar:')) {
      const avatarId = data.replace('del_avatar:', '');
      await tgAnswerCb(cb.id, '🗑 Удаляю...');

      const result = botLogic.deleteAvatar(String(chatId), avatarId);
      if (result.success) {
        await tgEdit(chatId, msgId, `🗑 Аватар «${result.name}» удалён.`);

        // Показываем оставшиеся аватары или возвращаемся к старту
        const remainingResult = botLogic.handleAvatars(String(chatId));
        if (remainingResult) {
          await tgSend(chatId, remainingResult.text, {
            reply_markup: remainingResult.reply_markup
          });
        } else {
          await tgSend(chatId, '🆕 У тебя больше нет аватаров. Загрузи новое фото через /start');
        }
      } else {
        await tgSend(chatId, `❌ Ошибка: ${result.error}`);
      }
      return;
    }

    if (data === 'new_avatar') {
      await tgAnswerCb(cb.id, '➕ Новый аватар');

      const result = botLogic.handleNewAvatar(String(chatId));
      // Редактируем текущее сообщение
      await tgEdit(chatId, msgId, result.text);
      return;
    }

    // ------ Callback: Покупка генераций ------
    const payments = require('./payments');

    if (data.startsWith('buy:')) {
      const packageId = data.replace('buy:', '');
      const pkg = payments.PACKAGES.find(p => p.id === packageId);

      await tgAnswerCb(cb.id, '');

      if (!payments.isConfigured()) {
        await tgSend(chatId, '❌ Оплата временно недоступна. Напиши администратору — @imgy_support');
        return;
      }

      try {
        const payment = await payments.createPayment(chatId, packageId);

        // Сохраняем paymentId в conversation для последующей проверки
        const conv = botLogic.getConversation(String(chatId));
        botLogic.setConversation(String(chatId), conv.state, {
          ...conv.data,
          pendingPaymentId: payment.paymentId,
          pendingPackageId: packageId,
        });

        const isDemoMode = payments.isDemoMode && payments.isDemoMode();

        await tgEdit(chatId, msgId,
          `💳 <b>${pkg.label}</b> — ${pkg.price}₽\n\n`
          + (isDemoMode
            ? '🔄 <i>Демо-режим</i>. Оплата не подключена.\nПросто нажми «✅ Я оплатил» — генерации начислятся сразу.\n\n')
          : 'Нажми кнопку ниже, чтобы перейти к оплате.\nПосле оплаты нажми «✅ Я оплатил» — мы проверим и начислим генерации.\n\n'),
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Оплатить ${pkg.price}₽`, url: payment.confirmationUrl }],
                [{ text: '✅ Я оплатил', callback_data: `check_payment:${payment.paymentId}:${packageId}` }],
                [{ text: '🔙 Назад', callback_data: 'show_buy' }]
              ]
            }
          }
        );
      } catch (err) {
        console.error('❌ Ошибка создания платежа:', err.message);
        await tgSend(chatId, `❌ Не удалось создать платёж: ${err.message}`);
      }
      return;
    }

    if (data.startsWith('check_payment:')) {
      await tgAnswerCb(cb.id, '🔄 Проверяю...');

      const parts = data.split(':');
      const paymentId = parts[1];
      const packageId = parts[2];

      if (!payments.isConfigured()) {
        await tgSend(chatId, '❌ Проверка платежа временно недоступна.');
        return;
      }

      try {
        const result = await payments.checkPayment(paymentId);

        if (result.paid) {
          const pkg = payments.PACKAGES.find(p => p.id === packageId);
          if (pkg) {
            // Начисляем генерации
            const newTotal = botLogic.addGenerations(String(chatId), pkg.generations);

            const isDemoPayment = String(paymentId).startsWith('demo_');

            await tgEdit(chatId, msgId,
              `✅ <b>Оплата подтверждена!</b>\n\n`
              + (isDemoPayment ? '🔄 <i>Демо-режим</i> — генерации начислены для теста.\n\n' : '')
              + `Тебе начислено <b>${pkg.generations}</b> ${botLogic.pluralGen(pkg.generations)}.\n`
              + `Теперь у тебя <b>${newTotal}</b> ${botLogic.pluralGen(newTotal)}.`,
              { parse_mode: 'HTML' }
            );

            // Сбрасываем pendingPaymentId из conversation
            const conv = botLogic.getConversation(String(chatId));
            botLogic.setConversation(String(chatId), conv.state, {});
          }
        } else if (result.status === 'pending') {
          await tgSend(chatId, '⏳ Платёж ещё не завершён. Попробуй оплатить или нажми «✅ Я оплатил» через несколько секунд.');
        } else if (result.status === 'canceled') {
          await tgEdit(chatId, msgId,
            '❌ Платёж был отменён.\nПопробуй ещё раз — /buy',
            { parse_mode: 'HTML' }
          );
        } else {
          await tgSend(chatId, `❌ Статус платежа: ${result.status}. Если оплатил — подожди немного и попробуй ещё раз.`);
        }
      } catch (err) {
        console.error('❌ Ошибка проверки платежа:', err.message);
        await tgSend(chatId, `❌ Не удалось проверить платёж: ${err.message}`);
      }
      return;
    }

    if (data === 'show_buy') {
      await tgAnswerCb(cb.id, '');
      const buyResult = botLogic.handleBuy(String(chatId));
      if (buyResult) {
        await tgEdit(chatId, msgId, buyResult.text, {
          parse_mode: buyResult.parse_mode,
          reply_markup: buyResult.reply_markup
        });
      }
      return;
    }

    if (data.startsWith('style:')) {
      const styleId = data.replace('style:', '');
      const result = botLogic.handleStyleSelected(String(chatId), styleId);

      if (!result) {
        await tgAnswerCb(cb.id, '❌ Ошибка. Начни с /start', true);
        return;
      }

      // Подтверждаем нажатие
      await tgAnswerCb(cb.id, `✅ «${result.style?.name || styleId}»`);

      if (result.readyToGenerate) {
        // Меняем текст сообщения
        const statusText = result.remaining > 0
          ? `✅ Стиль: «${result.style.name}»`
          : `✅ Стиль: «${result.style.name}»\nГенерации закончились`;

        await tgEdit(chatId, msgId, statusText);

        // ==== Генерация изображения ====
        try {
          const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
          const avatar = avatars.find(a => a.id === result.avatarId);
          const outputDir = path.join(__dirname, '..', 'photos', 'generated');
          fs.mkdirSync(outputDir, { recursive: true });

          // Уведомление о старте
          const statusMsg = `🎨 Генерирую аватарку в стиле «${result.style.name}»...`;
          await tgSend(chatId, statusMsg);

          // Получаем Gemini URI с проверкой кеша и дозагрузкой протухших
          const geminiFiles = await ensureGeminiFiles(avatar, avatars);
          if (geminiFiles.length === 0) {
            await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
            return;
          }
          console.log(`⚡ Генерация использует ${geminiFiles.length} файлов аватара ${avatar?.id}`);

          const settings = botLogic.getSettings(String(chatId));

          if (styleId === 'professions') {
            // === Профессия — случайная из 30+ самых известных ===
            const profession = generateImage.getRandomProfession();
            await tgEdit(chatId, statusMsg, `👨‍💼 Генерирую в стиле «${profession.name}»...`);

            const generatedResult = await generateImage.generateProfessionAvatar(geminiFiles, profession, outputDir, settings);

            const caption = `${profession.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            if (result.remaining > 0 && result.remaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
            }

            if (result.reply_markup) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
            }

          } else if (styleId === 'sport') {
            // === Спорт — случайный вид спорта из 50 ===
            const sport = generateImage.getRandomSport();
            await tgEdit(chatId, statusMsg, `🏃 Генерирую в стиле «${sport.name}»...`);

            const generatedResult = await generateImage.generateSportAvatar(geminiFiles, sport, outputDir, settings);

            const caption = `${sport.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            if (result.remaining > 0 && result.remaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
            }

            if (result.reply_markup) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
            }

          } else if (styleId === 'in_office') {
            // === В офисе — случайная офисная роль ===
            const office = generateImage.getRandomOffice();
            await tgEdit(chatId, statusMsg, `💼 Генерирую «${office.name}»...`);

            const generatedResult = await generateImage.generateOfficeAvatar(geminiFiles, office, outputDir, settings);

            const caption = `${office.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            if (result.remaining > 0 && result.remaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
            }

            if (result.reply_markup) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
            }

          } else if (styleId === 'location') {
            // === Локация — случайная из 100 знаменитых мест ===
            const location = generateImage.getRandomLocation();
            await tgEdit(chatId, statusMsg, `🌍 Генерирую «${location.name}»...`);

            const generatedResult = await generateImage.generateLocationAvatar(geminiFiles, location, outputDir, settings);

            const caption = `${location.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            if (result.remaining > 0 && result.remaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
            }

            if (result.reply_markup) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
            }

          } else if (styleId === 'history') {
            // === История — случайная историческая эпоха ===
            const era = generateImage.getRandomHistory();
            await tgEdit(chatId, statusMsg, `🎬 Генерирую «${era.name}»...`);

            const generatedResult = await generateImage.generateHistoryAvatar(geminiFiles, era, outputDir, settings);

            const caption = `${era.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            if (result.remaining > 0 && result.remaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
            }

            if (result.reply_markup) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
            }

          } else if (styleId === 'literature') {
            // === Литература — случайное произведение из 100 ===
            const work = generateImage.getRandomLiterature();
            await tgEdit(chatId, statusMsg, `📚 Генерирую «${work.name}»...`);

            const generatedResult = await generateImage.generateLiteratureAvatar(geminiFiles, work, outputDir, settings);

            const caption = `${work.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            if (result.remaining > 0 && result.remaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
            }

            if (result.reply_markup) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
            }

          } else if (styleId === 'cinema') {
            // === Кино — случайный фильм из IMDB250 ===
            const movie = generateImage.getRandomMovie();
            await tgEdit(chatId, statusMsg, `🎬 Генерирую в стиле «${movie.title}» (${movie.year})...`);

            const generatedResult = await generateImage.generateCinemaAvatar(geminiFiles, movie, outputDir, settings);

            const caption = `🎬 «${movie.title}» (${movie.year})
🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            if (result.remaining > 0 && result.remaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
            }

            if (result.reply_markup) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
            }

          } else {
            // === Обычный стиль — одно фото ===
            const generatedResult = await generateImage.generateAvatar(geminiFiles, styleId, outputDir, settings);

            const caption = `✨ Готово! Стиль: «${result.style.name}»\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            if (result.remaining > 0 && result.remaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
            }

            if (result.reply_markup) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
            }
          }

        } catch (err) {
          console.error('❌ Ошибка генерации:', err.message);

          // Если Gemini URI протух (403), перезагружаем фото и авто-ретраим
          if (err.message && err.message.includes('do not have permission') && err.message.includes('File')) {
            try {
              const userPhotos = avatar?.photos || [];
              if (userPhotos.length > 0) {
                await tgSend(chatId, '📤 Срок хранения фото в Gemini истёк. Перезагружаю...');

                const newGeminiFiles = [];
                for (const photoRel of userPhotos) {
                  const fullPath = path.join(__dirname, '..', photoRel);
                  if (fs.existsSync(fullPath)) {
                    const fileInfo = await generateImage.uploadPhoto(fullPath);
                    newGeminiFiles.push({ uri: fileInfo.uri, mimeType: fileInfo.mimeType });
                  }
                }

                if (newGeminiFiles.length > 0) {
                  avatar.geminiFiles = newGeminiFiles;
                  fs.writeFileSync(
                    path.join(__dirname, '..', 'data', 'avatars.json'),
                    JSON.stringify(avatars, null, 2) + '\n'
                  );
                  console.log(`✅ ${newGeminiFiles.length} Gemini URI обновлены для ${result.avatarId}`);
                  await tgSend(chatId, '✅ Фото обновлены! Нажми на стиль ещё раз 👇', {
                    reply_markup: result.reply_markup
                  });
                  return;
                }
              }
            } catch (uploadErr) {
              console.error('❌ Ошибка перезагрузки фото:', uploadErr.message);
            }
          }

          if (err.message && err.message.includes('timeout')) {
            await tgSend(chatId, '⏳ Gemini отвечает дольше обычного. Пробую ещё раз...');
            try {
              // Retry один раз
              let retryResult;
              if (styleId === 'professions') {
                const profession = generateImage.getRandomProfession();
                retryResult = await generateImage.generateProfessionAvatar(geminiFiles, profession, outputDir, settings);
                const caption = `${profession.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'sport') {
                const sport = generateImage.getRandomSport();
                retryResult = await generateImage.generateSportAvatar(geminiFiles, sport, outputDir, settings);
                const caption = `${sport.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'in_office') {
                const office = generateImage.getRandomOffice();
                retryResult = await generateImage.generateOfficeAvatar(geminiFiles, office, outputDir, settings);
                const caption = `${office.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'location') {
                const location = generateImage.getRandomLocation();
                retryResult = await generateImage.generateLocationAvatar(geminiFiles, location, outputDir, settings);
                const caption = `${location.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'history') {
                const era = generateImage.getRandomHistory();
                retryResult = await generateImage.generateHistoryAvatar(geminiFiles, era, outputDir, settings);
                const caption = `${era.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'cinema') {
                const movie = generateImage.getRandomMovie();
                retryResult = await generateImage.generateCinemaAvatar(geminiFiles, movie, outputDir, settings);
                const caption = `🎬 «${movie.title}» (${movie.year})\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else {
                retryResult = await generateImage.generateAvatar(geminiFiles, styleId, outputDir, settings);
                const caption = `✨ Готово! Стиль: «${result.style.name}»\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              }

              if (retryResult) {
                if ((result.remaining || 0) > 0 && (result.remaining || 0) <= 3) {
                  await tgSend(chatId, `⚠️ Осталось всего ${result.remaining} ${botLogic.pluralGen(result.remaining)}`);
                }
                if (result.reply_markup) {
                  await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
                } else {
                  await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support');
                }
              }
            } catch (retryErr) {
              console.error('❌ Retry тоже не удался:', retryErr.message);
              await tgSend(chatId, `❌ Не удалось сгенерировать даже после повтора: ${retryErr.message}`);
              if (result.reply_markup) {
                await tgSend(chatId, 'Попробуй другой стиль 👇', { reply_markup: result.reply_markup });
              }
            }
          } else {
            await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
            if (result.reply_markup) {
              await tgSend(chatId, 'Попробуй другой стиль 👇', { reply_markup: result.reply_markup });
            }
          }
        }
      } else {
        // Ошибка (генераций нет и т.п.)
        await tgEdit(chatId, msgId, result.text);
      }
    }

    // ------ Callback: Повторить / Выйти в режиме Промпт ------
    if (data === 'prompt_repeat') {
      await tgAnswerCb(cb.id, '🔄 Повторяю...');
      const conv = botLogic.getConversation(String(chatId));
      const storedPrompt = conv?.data?.lastPromptText;
      if (!storedPrompt) {
        await tgEdit(chatId, msgId, '❌ Нет сохранённого промпта. Напиши новое описание.');
        return;
      }

      const storedPhoto = conv?.data?.lastAttachedPhoto || null;

      // Проверяем баланс
      const user = botLogic.findUserByTelegram(String(chatId));
      if (!user || user.generationsRemaining <= 0) {
        await tgSend(chatId, '😔 Твои бесплатные генерации закончились. Напиши администратору — @imgy_support');
        botLogic.resetConversation(String(chatId));
        return;
      }

      const generationResult = botLogic.consumeGeneration(conv.data.userId);
      const promptResult = {
        promptText: storedPrompt,
        attachedPhoto: storedPhoto,
        avatarId: conv.data.avatarId,
        userId: conv.data.userId,
        remaining: generationResult.remaining,
        readyToGenerate: true
      };

      await generateCustomAvatarWithPhoto(chatId, promptResult);
      return;
    }

    if (data === 'prompt_exit') {
      await tgAnswerCb(cb.id, '🚪 Выход из промпта');
      const cancelResult = botLogic.handleCancelGodMode(String(chatId));
      if (cancelResult) {
        await tgSend(chatId, cancelResult.text);
      } else {
        await tgSend(chatId, 'Промпт завершён. Выбери другой режим 👇');
      }
      return;
    }
  }

  // ------ Обычные сообщения ------
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const userName = msg.from?.first_name || msg.from?.username || `User${chatId}`;

  // /start, /cancel, /отмена
  if (text.toLowerCase() === '/start' || text.toLowerCase() === '/cancel' || text.toLowerCase() === 'отмена') {
    // Чистим буфер медиагруппы
    delete mediaGroups[chatId];
    
    if (text.toLowerCase() === '/cancel') {
      // Сначала пробуем отменить режим бога
      const cancelResult = botLogic.handleCancelGodMode(String(chatId));
      if (cancelResult) {
        await tgSend(chatId, cancelResult.text);
        // Показываем постоянную клавиатуру
        const mainKB = botLogic.buildMainKeyboard();
        await tgSend(chatId, 'Выбери действие 👇', { reply_markup: mainKB });
        return;
      }
    }
    
    const fn = text.toLowerCase() === '/start' ? botLogic.handleStart : botLogic.handleCancel;
    const result = fn(String(chatId));
    await tgSend(chatId, result.text, {
      ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
      ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
    });
    // Отправляем постоянную клавиатуру (кнопки над вводом)
    const mainKB = botLogic.buildMainKeyboard();
    await tgSend(chatId, 'Выбери действие 👇', { reply_markup: mainKB });
    return;
  }

  // /help — информация
  if (text.toLowerCase() === '/help') {
    await tgSend(chatId, '🤖 <b>Imgy Avatar Bot</b>\n\n🎨 Генерирую аватарки по твоему фото в разных стилях.\n\n📸 <b>Как использовать:</b>\n1️⃣ Напиши /start\n2️⃣ Загрузи фото (1-3 штуки)\n3️⃣ Выбери стиль из кнопок\n4️⃣ Готово! 🎉\n\n💰 /balance — остаток генераций\n🎨 /styles — показать стили\n❓ /help — эта справка', { parse_mode: 'HTML' });
    return;
  }

  // /styles — показать стили (то же что и после загрузки фото)
  if (text.toLowerCase() === '/styles') {
    const result = botLogic.handleStyles(String(chatId));
    if (result) {
      await tgSend(chatId, result.text, {
        ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
        ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
      });
    } else {
      await tgSend(chatId, '❌ Сначала загрузи фото — /start');
    }
    return;
  }

  // /buy — покупка генераций
  if (text.toLowerCase() === '/buy' || text.toLowerCase() === '/купить') {
    const buyResult = botLogic.handleBuy(String(chatId));
    if (buyResult) {
      await tgSend(chatId, buyResult.text, {
        parse_mode: buyResult.parse_mode,
        reply_markup: buyResult.reply_markup
      });
    }
    return;
  }

  // /status, /remaining, /balance, /осталось — остаток генераций
  if (['/status', '/remaining', '/balance', '/осталось'].includes(text.toLowerCase())) {
    const remaining = botLogic.checkBalance(String(chatId));
    const payments = require('./payments');
    if (remaining === null) {
      await tgSend(chatId, '❌ Ты ещё не загружал фото. Напиши /start чтобы начать.');
    } else if (remaining <= 0) {
      const buyBtn = payments.isConfigured()
        ? { reply_markup: { inline_keyboard: [[{ text: '💳 Купить генерации', callback_data: 'show_buy' }]] } }
        : {};
      await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support', buyBtn);
    } else {
      await tgSend(chatId, `🌀 У тебя осталось <b>${remaining}</b> ${botLogic.pluralGen(remaining)}`, { parse_mode: 'HTML' });
    }
    return;
  }

  // ------ Reply keyboard buttons (постоянная клавиатура) ------
  if (text === '🎮 Промпт') {
    const result = botLogic.handleGodMode(String(chatId));
    if (result) {
      await tgSend(chatId, result.text, {
        ...(result.parse_mode ? { parse_mode: result.parse_mode } : {})
      });
    } else {
      await tgSend(chatId, '❌ Сначала загрузи фото — /start');
    }
    return;
  }
  
  if (text === '🎨 Стили') {
    const result = botLogic.handleStyles(String(chatId));
    if (result) {
      await tgSend(chatId, result.text, {
        ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
        ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
      });
    } else {
      await tgSend(chatId, '❌ Сначала загрузи фото — /start');
    }
    return;
  }
  
  if (text === '🖼 Аватар') {
    const result = botLogic.handleAvatars(String(chatId));
    if (result) {
      await tgSend(chatId, result.text, {
        ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
        ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
      });
    } else {
      await tgSend(chatId, '❌ У тебя нет аватаров. Загрузи фото через /start');
    }
    return;
  }
  
  if (text === '⚙️ Настройки') {
    const result = botLogic.handleSettings(String(chatId));
    await tgSend(chatId, result.text, {
      parse_mode: result.parse_mode,
      reply_markup: result.reply_markup
    });
    return;
  }
  
  if (text === '💰 Баланс') {
    const remaining = botLogic.checkBalance(String(chatId));
    const payments = require('./payments');
    if (remaining === null) {
      await tgSend(chatId, '❌ Ты ещё не загружал фото. Напиши /start чтобы начать.');
    } else if (remaining <= 0) {
      const buyBtn = payments.isConfigured()
        ? { reply_markup: { inline_keyboard: [[{ text: '💳 Купить генерации', callback_data: 'show_buy' }]] } }
        : {};
      await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНапиши администратору — @imgy_support', buyBtn);
    } else {
      await tgSend(chatId, `🌀 У тебя осталось <b>${remaining}</b> ${botLogic.pluralGen(remaining)}`, { parse_mode: 'HTML' });
    }
    return;
  }

  if (text === '💳 Купить') {
    const buyResult = botLogic.handleBuy(String(chatId));
    if (buyResult) {
      await tgSend(chatId, buyResult.text, {
        parse_mode: buyResult.parse_mode,
        reply_markup: buyResult.reply_markup
      });
    }
    return;
  }
  
  if (text === '❓ Помощь') {
    await tgSend(chatId, '🤖 <b>Imgy Avatar Bot</b>\n\n🎨 Генерирую аватарки по твоему фото в разных стилях.\n\n📸 <b>Как использовать:</b>\n1️⃣ Напиши /start\n2️⃣ Загрузи фото (1-3 штуки)\n3️⃣ Выбери стиль из кнопок\n4️⃣ Готово! 🎉\n\n💰 /balance — остаток генераций\n🎨 /styles — показать стили\n❓ /help — эта справка', { parse_mode: 'HTML' });
    return;
  }

  // ------ Фото ------
  if (msg.photo && msg.photo.length > 0) {
    const bestFile = msg.photo.reduce((a, b) => (a.file_size > b.file_size ? a : b));
    const filePath = await downloadFromTelegram(bestFile.file_id);

    // Если пользователь в режиме Промпт — обрабатываем как прикреплённое фото
    const photoConvState = botLogic.getConversation(String(chatId));
    if (photoConvState.state === 'awaiting_custom_prompt') {
      const caption = (msg.caption || '').trim();
      const promptResult = botLogic.handleCustomPrompt(String(chatId), caption, filePath);

      if (!promptResult) {
        await tgSend(chatId, '❌ Ошибка. Попробуй ещё раз.');
        return;
      }

      if (promptResult.pendingPhotoAttached) {
        // Фото сохранено, ждём текстовое описание
        await tgSend(chatId, promptResult.text);
        return;
      }

      if (promptResult.readyToGenerate) {
        await tgSend(chatId, promptResult.text);
        await generateCustomAvatarWithPhoto(chatId, promptResult);
      } else {
        await tgSend(chatId, promptResult.text);
      }
      return;
    }

    // Media group?
    if (msg.media_group_id) {
      const buf = getOrCreateBuffer(chatId, msg.media_group_id);
      buf.photos.push(filePath);

      // Сбрасываем таймер — ждём 1.5 сек, пока придут остальные фото
      clearTimeout(buf.timer);
      buf.timer = setTimeout(() => flushMediaGroup(chatId, msg.media_group_id, userName), 1500);
    } else {
      // Одиночное фото — сразу процессим
      await processPhotos(chatId, [filePath], userName);
    }
    return;
  }

  // ------ Промпт — пользователь ввёл описание (или фото + текст) ------
  const convState = botLogic.getConversation(String(chatId));
  if (convState.state === 'awaiting_custom_prompt') {
    // Проверяем, есть ли отложенное фото в conversation
    const pendingPhoto = convState.data?.pendingPhoto || null;
    const promptResult = botLogic.handleCustomPrompt(String(chatId), text, pendingPhoto);
    if (!promptResult) {
      await tgSend(chatId, '❌ Ошибка. Напиши описание для генерации.');
      return;
    }

    if (promptResult.readyToGenerate) {
      await tgSend(chatId, promptResult.text);
      await generateCustomAvatarWithPhoto(chatId, promptResult);
    } else {
      await tgSend(chatId, promptResult.text);
    }
    return;
  }

  // ------ Всё остальное ------
  const result = botLogic.handleUnknown(String(chatId), text);
  await tgSend(chatId, result.text, {
    ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
    ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
  });
}

// ===================== Генерация аватара в режиме Промпт (с фото или без) =====================

/**
 * Сгенерировать аватар по промпту + опционально прикреплённое фото.
 * Вызывается как из текстового сообщения, так и из сообщения с фото.
 */
async function generateCustomAvatarWithPhoto(chatId, promptResult) {
  // Сохраняем промпт и фото в conversation заранее (на случай ошибки)
  const earlyConv = botLogic.getConversation(String(chatId));
  if (earlyConv?.data) {
    earlyConv.data.lastPromptText = promptResult.promptText;
    if (promptResult.attachedPhoto) earlyConv.data.lastAttachedPhoto = promptResult.attachedPhoto;
    botLogic.setConversation(String(chatId), 'awaiting_custom_prompt', earlyConv.data);
  }

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === promptResult.avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    const statusMsg = `🎮 Генерирую по твоему описанию...`;
    await tgSend(chatId, statusMsg);

    // Получаем Gemini URI для фото аватара
    let geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0 && !promptResult.attachedPhoto) {
      await tgSend(chatId, '❌ Не найдено фото для генерации.');
      return;
    }

    // Если пользователь прикрепил своё фото — загружаем его в Gemini и добавляем
    if (promptResult.attachedPhoto) {
      try {
        console.log(`📤 Загружаю прикреплённое фото в Gemini: ${promptResult.attachedPhoto}`);
        const fileInfo = await generateImage.uploadPhoto(promptResult.attachedPhoto);
        geminiFiles.push({ uri: fileInfo.uri, mimeType: fileInfo.mimeType });
        console.log(`✅ Прикреплённое фото загружено: ${fileInfo.uri}`);
      } catch (uploadErr) {
        console.error('❌ Ошибка загрузки прикреплённого фото:', uploadErr.message);
        await tgSend(chatId, '⚠️ Не удалось загрузить прикреплённое фото. Генерирую без него.');
      }
    }

    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Нет доступных фото для генерации.');
      return;
    }

    const settings = botLogic.getSettings(String(chatId));
    const generatedResult = await generateImage.generateCustomAvatar(geminiFiles, promptResult.promptText, outputDir, settings);

    const caption = `🎮 Промпт\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>\n\n📝 ${promptResult.promptText}`;

    await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });

    if (promptResult.remaining > 0 && promptResult.remaining <= 3) {
      await tgSend(chatId, `⚠️ Осталось всего ${promptResult.remaining} ${botLogic.pluralGen(promptResult.remaining)}`);
    }

    // Обновляем conversation: сохраняем lastPromptText/lastAttachedPhoto для Повторить
    const conv = botLogic.getConversation(String(chatId));
    if (conv?.data) {
      delete conv.data.pendingPhoto;
      conv.data.lastPromptText = promptResult.promptText;
      if (promptResult.attachedPhoto) conv.data.lastAttachedPhoto = promptResult.attachedPhoto;
      botLogic.setConversation(String(chatId), 'awaiting_custom_prompt', conv.data);
    }

    // Показываем inline кнопки: Повторить / Выйти
    await tgSend(chatId, '🎮 Что дальше?', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Повторить', callback_data: 'prompt_repeat' },
            { text: '🚪 Выйти', callback_data: 'prompt_exit' }
          ]
        ]
      }
    });

  } catch (err) {
    console.error('❌ Ошибка генерации в режиме промпта:', err.message);
    if (err.message.includes('Заблокировано')) {
      await tgSend(chatId, '❌ Gemini заблокировал генерацию. Попробуй другое описание.');
    } else {
      await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
    }
    await tgSend(chatId, '🎮 Что дальше?', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Повторить', callback_data: 'prompt_repeat' },
            { text: '🚪 Выйти', callback_data: 'prompt_exit' }
          ]
        ]
      }
    });
  }
}

// ===================== Polling =====================

const OFFSET_FILE = path.join(__dirname, '..', 'data', 'offset.txt');

function loadOffset() {
  try {
    const v = parseInt(fs.readFileSync(OFFSET_FILE, 'utf-8').trim(), 10);
    if (!isNaN(v) && v > 0) return v;
  } catch {}
  return 0;
}

function saveOffset(v) {
  try { fs.writeFileSync(OFFSET_FILE, String(v)); } catch {}
}

let offset = loadOffset();
let currentReq = null;

console.log(`📡 offset загружен: ${offset}`);

async function poll() {
  try {
    // Отменяем предыдущий запрос, если он ещё висит
    if (currentReq) {
      try { currentReq.destroy(); } catch {}
      currentReq = null;
    }

    const { req, promise } = tgApiWithReq('getUpdates', { offset, timeout: 30 }, 35000);
    currentReq = req;
    const res = await promise;

    if (res.ok && Array.isArray(res.result)) {
      console.log(`📬 poll complete: ${res.result.length} updates, offset=${offset}`);
      if (res.result.length > 0) {
        console.log(`📬 Получено ${res.result.length} апдейтов, offset=${offset}`);
      }
      for (const update of res.result) {
        offset = update.update_id + 1;
        saveOffset(offset);
        try {
          await handleUpdate(update);
        } catch (err) {
          console.error(`❌ Ошибка обработки update ${update.update_id}:`, err.message);
        }
      }
    } else if (!res.ok) {
      if (res.error_code === 409) {
        // Conflict — другой экземпляр бота. Подождём подольше.
        console.warn('⚠️ Conflict (другой бот?), жду 5с...');
        await new Promise(r => setTimeout(r, 5000));
      } else {
        console.error(`❌ getUpdates error: ${res.error_code} ${res.description}`);
      }
    }
  } catch (err) {
    if (err.code !== 'ECONNRESET' && !err.message.includes('destroy')) {
      console.error(`❌ Poll error (${err.code || 'unknown'}): ${err.message}`);
    }
  } finally {
    currentReq = null;
    console.log('🔄 scheduling next poll in 1s');
    setTimeout(poll, 1000);
  }
}

// ===================== Запуск =====================

console.log('🤖 Imgy Bot запущен.');
console.log(`📁 Временные фото: ${PHOTOS_TMP}`);
console.log('Ожидание сообщений...');
poll();
