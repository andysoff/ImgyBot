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
 *   /start          → Запустить бота
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
const { buildBuyKeyboard } = botLogic;
const generateImage = require('./generate-image');
const metrics = require('./metrics-ga4');

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
  try {
    const res = await tgApi('sendMessage', opts, 30000);
    if (!res.ok) {
      console.error(`❌ tgSend ошибка API: ${res.error_code} ${res.description}`);
    } else {
      console.log(`✅ tgSend OK message_id=${res.result?.message_id}`);
    }
    return res;
  } catch (err) {
    console.error(`❌ tgSend исключение: ${err.message}`);
    return { ok: false };
  }
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

async function tgAnswerCb(cbId, text, alert = false) {
  try {
    const res = await tgApi('answerCallbackQuery', { callback_query_id: cbId, text, show_alert: alert });
    if (!res.ok) {
      console.error(`❌ tgAnswerCb ошибка: ${res.error_code} ${res.description}`);
    }
    return res;
  } catch (err) {
    console.error(`❌ tgAnswerCb исключение: ${err.message}`);
    return { ok: false };
  }
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
/**
 * Отправить медиа-группу (альбом) из нескольких фото с локальных путей.
 * @param {number} chatId
 * @param {string[]} photoPaths — массив локальных путей к файлам
 * @returns {Promise<object>}
 */
async function tgSendMediaGroup(chatId, photoPaths) {
  if (!photoPaths || photoPaths.length === 0) return { ok: false };

  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
  const CRLF = '\r\n';

  // Строим массив media для поля media (JSON)
  const mediaItems = photoPaths.map((p, i) => ({
    type: 'photo',
    media: i === 0 ? `attach://photo_${i}` : `attach://photo_${i}`
  }));
  // У первого фото caption
  mediaItems[0].caption = `📸 Фото аватара`;
  mediaItems[0].parse_mode = 'HTML';

  const parts = [];

  // chat_id
  parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}${chatId}${CRLF}`, 'utf-8'));

  // media (JSON)
  parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="media"${CRLF}Content-Type: application/json${CRLF}${CRLF}${JSON.stringify(mediaItems)}${CRLF}`, 'utf-8'));

  // Каждое фото
  for (let i = 0; i < photoPaths.length; i++) {
    const photoData = fs.readFileSync(photoPaths[i]);
    const fileName = path.basename(photoPaths[i]);
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="photo_${i}"; filename="${fileName}"${CRLF}Content-Type: image/jpeg${CRLF}${CRLF}`, 'utf-8'));
    parts.push(photoData);
    parts.push(Buffer.from(CRLF, 'utf-8'));
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf-8'));

  const bodyBuffer = Buffer.concat(parts);

  const totalKB = (bodyBuffer.length / 1024).toFixed(1);
  console.log(`📸 Отправка медиа-группы ${chatId}: ${photoPaths.length} фото (${totalKB} KB)`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/sendMediaGroup`,
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
              console.log(`✅ tgSendMediaGroup OK, ${photoPaths.length} фото`);
            } else {
              console.error(`❌ tgSendMediaGroup ошибка API: ${parsed.error_code} ${parsed.description}`);
            }
            resolve(parsed);
          } catch { reject(new Error(data)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('sendMediaGroup timeout')); });
    req.write(bodyBuffer);
    req.end();
  });
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

function flushMediaGroup(chatId, mediaGroupId, userName, userLang, isPremium) {
  const buf = mediaGroups[chatId]?.[mediaGroupId];
  if (!buf) return;
  clearTimeout(buf.timer);
  delete mediaGroups[chatId][mediaGroupId];
  processPhotos(chatId, buf.photos, userName, userLang, isPremium);
}

// ===================== Обработка =====================

async function processPhotos(chatId, filePaths, userName, userLang, isPremium) {
  if (filePaths.length === 0) return;
  const isNew = botLogic.isNewUser(String(chatId)); // проверяем ДО создания
  const result = botLogic.handlePhotosReceived(String(chatId), filePaths, userName, userLang, isPremium);
  if (result) {
    metrics.track(isNew ? 'onboarding:photos_uploaded' : 'photos:received', {
      telegram_id: String(chatId),
      photo_count: String(filePaths.length)
    });
  }
  if (!result) {
    await tgSend(chatId, 'Напиши /start чтобы начать');
    return;
  }
  await tgSend(chatId, result.text, {
    ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
    ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
  });

  // followUp с inline-кнопками (выбор стиля / своё описание)
  if (result.followUp) {
    await tgSend(chatId, result.followUp.text, {
      ...(result.followUp.parse_mode ? { parse_mode: result.followUp.parse_mode } : {}),
      ...(result.followUp.reply_markup ? { reply_markup: result.followUp.reply_markup } : {})
    });
  }

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

    // ------ Callback: Онбординг ------
    if (data === 'onboarding_learn') {
      metrics.track('onboarding:learn_more', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, 'ℹ️ Узнать больше');
      // Пауза — даём Telegram стабилизироваться после callback
      await new Promise(r => setTimeout(r, 500));
      // Отправляем шаг 3 как отдельное сообщение (старое не удаляем)
      const result = botLogic.handleOnboardingLearnMore(String(chatId));
      await tgSend(chatId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'onboarding_try') {
      metrics.track('onboarding:try', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '🚀 Погнали!');
      // Пауза — даём Telegram стабилизироваться после callback
      await new Promise(r => setTimeout(r, 500));
      // Отправляем шаг 4 как отдельное сообщение (старое не удаляем)
      const result = botLogic.handleOnboardingTry(String(chatId));
      await tgSend(chatId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ Callback: Выбрать стили / Своё описание (из приветствия) ------
    if (data === 'start_choose_style') {
      metrics.track('style:show_styles_from_greeting', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '🎨 Стили');
      const result = botLogic.handleStyles(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'start_custom_prompt') {
      metrics.track('prompt:from_greeting', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '✍️ Промпт');
      const result = botLogic.handleGodMode(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
        ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
      });
      return;
    }

    // ------ Callback: Настройки ------
    if (data === 'settings_main') {
      metrics.track('settings:opened', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettings(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'settings_back') {
      metrics.track('settings:closed', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '🔙 Назад');
      await tgEdit(chatId, msgId, '⚙️ Настройки закрыты. Используй кнопки ниже 👇');
      return;
    }

    if (data === 'settings_quality') {
      metrics.track('settings:show_quality', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsQuality(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'settings_size') {
      metrics.track('settings:show_size', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsSize(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'settings_aspect') {
      metrics.track('settings:show_aspect', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsAspect(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'settings_model') {
      metrics.track('settings:show_model', { telegram_id: String(chatId) });
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
      metrics.track('settings:quality_changed', { telegram_id: String(chatId), value });
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
      metrics.track('settings:size_changed', { telegram_id: String(chatId), value });
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
      metrics.track('settings:aspect_changed', { telegram_id: String(chatId), value });
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
      metrics.track('settings:model_changed', { telegram_id: String(chatId), value });
      botLogic.updateSetting(String(chatId), 'model', value);
      await tgAnswerCb(cb.id, '✅ Модель обновлена');
      const result = botLogic.handleSettingsModel(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ Нажатие на название аватара → выбор (без перезагрузки!) ------
    if (data.startsWith('avatar:')) {
      const avatarId = data.replace('avatar:', '');
      metrics.track('avatar:selected', { telegram_id: String(chatId), avatar_id: avatarId });

      const result = botLogic.handleSelectAvatar(String(chatId), avatarId);
      if (!result) {
        await tgAnswerCb(cb.id, '❌ Ошибка');
        return;
      }

      await tgAnswerCb(cb.id, '');

      // Просто обновляем кнопки на месте — ✅ переезжает без моргания
      const avatarsResult = botLogic.handleAvatars(String(chatId));
      if (avatarsResult) {
        await tgEdit(chatId, msgId, avatarsResult.text, {
          reply_markup: avatarsResult.reply_markup
        });
      }

      // Gemini-кеш в фоне
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
      }
      return;
    }

    // ------ Нажатие на ⚙️ → меню действий с аватаром ------
    if (data.startsWith('avatar_actions:')) {
      const avatarId = data.replace('avatar_actions:', '');
      metrics.track('avatar:actions', { telegram_id: String(chatId), avatar_id: avatarId });
      await tgAnswerCb(cb.id, '');

      const result = botLogic.handleAvatarMenu(String(chatId), avatarId);
      if (!result) {
        await tgSend(chatId, '❌ Аватар не найден');
        return;
      }

      await tgDelete(chatId, msgId);
      await tgSend(chatId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ Переименование аватара ------
    if (data.startsWith('rename_avatar:')) {
      const avatarId = data.replace('rename_avatar:', '');
      metrics.track('avatar:rename_started', { telegram_id: String(chatId), avatar_id: avatarId });

      const result = botLogic.handleStartRenameAvatar(String(chatId), avatarId);
      if (!result) {
        await tgAnswerCb(cb.id, '❌ Ошибка');
        return;
      }

      await tgAnswerCb(cb.id, '✏️ Напиши новое название');
      await tgSend(chatId, result.text);
      return;
    }

    if (data.startsWith('select_avatar:')) {
      const avatarId = data.replace('select_avatar:', '');
      metrics.track('avatar:selected', { telegram_id: String(chatId), avatar_id: avatarId });

      const result = botLogic.handleSelectAvatar(String(chatId), avatarId);
      if (!result) {
        await tgAnswerCb(cb.id, '❌ Ошибка');
        await tgSend(chatId, '❌ Аватар не найден');
        return;
      }

      await tgAnswerCb(cb.id, '✅ Выбран');

      // Удаляем сообщение с подменю
      await tgDelete(chatId, msgId);

      // Показываем обновлённый список аватаров
      const avatarsResult = botLogic.handleAvatars(String(chatId));
      if (avatarsResult) {
        await tgSend(chatId, avatarsResult.text, {
          reply_markup: avatarsResult.reply_markup
        });
      }
      return;
    }

    if (data.startsWith('del_avatar:')) {
      const avatarId = data.replace('del_avatar:', '');
      await tgAnswerCb(cb.id, '');

      const confirmResult = botLogic.handleDeleteConfirm(String(chatId), avatarId);
      if (confirmResult) {
        // Обновляем текущее сообщение на подтверждение
        await tgEdit(chatId, msgId, confirmResult.text, {
          parse_mode: confirmResult.parse_mode,
          reply_markup: confirmResult.reply_markup
        });
      } else {
        await tgSend(chatId, '❌ Аватар не найден');
      }
      return;
    }

    if (data.startsWith('confirm_del_avatar:')) {
      const avatarId = data.replace('confirm_del_avatar:', '');
      metrics.track('avatar:deleted', { telegram_id: String(chatId), avatar_id: avatarId });

      const result = botLogic.deleteAvatar(String(chatId), avatarId);
      if (result.success) {
        await tgAnswerCb(cb.id, '');

        // Удаляем сообщение с подтверждением
        await tgDelete(chatId, msgId);

        // Сообщение об удалении
        await tgSend(chatId, `🗑 Аватар «${result.name}» и все связанные фото удалены.`);

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
        await tgAnswerCb(cb.id, '❌ Ошибка');
        await tgSend(chatId, `❌ Ошибка: ${result.error}`);
      }
      return;
    }

    // ------ Callback: Показать фото аватара ------
    if (data.startsWith('show_avatar:')) {
      const avatarId = data.replace('show_avatar:', '');
      await tgAnswerCb(cb.id, '📸 Загружаю фото...');

      const result = botLogic.handleShowAvatar(String(chatId), avatarId);
      if (result.error) {
        await tgSend(chatId, `❌ ${result.error}`);
        return;
      }

      const { photos, avatarName } = result;

      if (photos.length === 1) {
        // Одно фото — отправляем как фото с подписью
        await tgSendPhoto(chatId, photos[0], `📸 ${avatarName}`);
      } else {
        // Несколько фото — отправляем медиа-группой (альбомом)
        await tgSendMediaGroup(chatId, photos);
      }
      return;
    }

    if (data === 'new_avatar') {
      metrics.track('avatar:new_requested', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '➕ Новый аватар');

      const result = botLogic.handleNewAvatar(String(chatId));
      // Не трогаем предыдущее сообщение, просто отправляем новое
      await tgSend(chatId, result.text);
      return;
    }

    if (data === 'back_to_avatars') {
      await tgAnswerCb(cb.id, '');

      // Удаляем сообщение с подменю
      await tgDelete(chatId, msgId);

      const result = botLogic.handleAvatars(String(chatId));
      if (result) {
        await tgSend(chatId, result.text, {
          ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
          ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
        });
      }
      return;
    }

    if (data.startsWith('back_to_avatar_menu:')) {
      const avatarId = data.replace('back_to_avatar_menu:', '');
      await tgAnswerCb(cb.id, '');

      const result = botLogic.handleAvatarMenu(String(chatId), avatarId);
      if (result) {
        await tgEdit(chatId, msgId, result.text, {
          parse_mode: result.parse_mode,
          reply_markup: result.reply_markup
        });
      }
      return;
    }

    // ------ Callback: Покупка генераций ------
    const payments = require('./payments');

    if (data.startsWith('buy:')) {
      const packageId = data.replace('buy:', '');
      const pkg = payments.PACKAGES.find(p => p.id === packageId);

      metrics.track('buy:package_selected', { telegram_id: String(chatId), package_id: packageId, price: String(pkg?.price || 0) });
      await tgAnswerCb(cb.id, '');

      if (!payments.isConfigured()) {
        await tgSend(chatId, '❌ Оплата временно недоступна. Напиши администратору — @imgy_support');
        return;
      }

      // Демо-режим — только для администратора
      const isDemo = payments.isDemoMode && payments.isDemoMode();
      if (isDemo && Number(chatId) !== 132454710) {
        await tgSend(chatId, '💳 Оплата временно недоступна. Скоро подключим — следи за обновлениями!');
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
            ? '🔄 <i>Демо-режим</i>. Оплата не подключена.\nПросто нажми «✅ Я оплатил» — генерации начислятся сразу.\n\n'
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

      metrics.track('buy:payment_checked', { telegram_id: String(chatId), package_id: packageId });

      if (!payments.isConfigured()) {
        await tgSend(chatId, '❌ Проверка платежа временно недоступна.');
        return;
      }

      try {
        const result = await payments.checkPayment(paymentId);

        if (result.paid) {
          const pkg = payments.PACKAGES.find(p => p.id === packageId);
          if (pkg) {
            metrics.track('buy:payment_completed', { telegram_id: String(chatId), package_id: packageId, generations: String(pkg.generations), amount: String(pkg.price) });
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
      metrics.track('buy:menu_opened', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const buyResult = botLogic.handleBuy(String(chatId));
      // Отправляем отдельным сообщением, не редактируем текущее
      if (buyResult) {
        await tgSend(chatId, buyResult.text, {
          parse_mode: buyResult.parse_mode,
          reply_markup: buyResult.reply_markup
        });
      }
      return;
    }

    if (data.startsWith('style:')) {
      const styleId = data.replace('style:', '');
      metrics.track('style:selected', { telegram_id: String(chatId), style_id: styleId });
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
        const settings = botLogic.getSettings(String(chatId));
        try {
          const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
          const avatar = avatars.find(a => a.id === result.avatarId);
          const outputDir = path.join(__dirname, '..', 'photos', 'generated');
          fs.mkdirSync(outputDir, { recursive: true });

          // Уведомление о старте
          metrics.track('generation:started', { telegram_id: String(chatId), style_id: result.style?.id || styleId });
          const statusMsg = `🎨 Генерирую фото в стиле «${result.style.name}»...`;
          await tgSend(chatId, statusMsg);

          // Режим "Без аватара" — генерация без фото пользователя
          if (result.isNoAvatar) {
            const generatedResult = await generateImage.generateNoAvatar(styleId, outputDir, settings);
            const caption = `${result.style.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }
            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }
          } else {
            // Получаем Gemini URI с проверкой кеша и дозагрузкой протухших
            const geminiFiles = await ensureGeminiFiles(avatar, avatars);
            if (geminiFiles.length === 0) {
              await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
              return;
            }
            console.log(`⚡ Генерация использует ${geminiFiles.length} файлов исходника ${avatar?.id}`);

            // Используется getModelCost для динамической стоимости

            if (styleId === 'professions') {
            // === Профессия — случайная из 30+ самых известных ===
            const profession = generateImage.getRandomProfession();
            await tgEdit(chatId, statusMsg, `👨‍💼 Генерирую в стиле «${profession.name}»...`);

            const generatedResult = await generateImage.generateProfessionAvatar(geminiFiles, profession, outputDir, settings);

            const caption = `${profession.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }

          } else if (styleId === 'sport') {
            // === Спорт — случайный вид спорта из 50 ===
            const sport = generateImage.getRandomSport();
            await tgEdit(chatId, statusMsg, `🏃 Генерирую в стиле «${sport.name}»...`);

            const generatedResult = await generateImage.generateSportAvatar(geminiFiles, sport, outputDir, settings);

            const caption = `${sport.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }

          } else if (styleId === 'in_office') {
            // === В офисе — случайная офисная роль ===
            const office = generateImage.getRandomOffice();
            await tgEdit(chatId, statusMsg, `💼 Генерирую «${office.name}»...`);

            const generatedResult = await generateImage.generateOfficeAvatar(geminiFiles, office, outputDir, settings);

            const caption = `${office.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }

          } else if (styleId === 'location') {
            // === Локация — случайная из 100 знаменитых мест ===
            const location = generateImage.getRandomLocation();
            await tgEdit(chatId, statusMsg, `🌍 Генерирую «${location.name}»...`);

            const generatedResult = await generateImage.generateLocationAvatar(geminiFiles, location, outputDir, settings);

            const caption = `${location.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }

          } else if (styleId === 'history') {
            // === История — случайная историческая эпоха ===
            const era = generateImage.getRandomHistory();
            await tgEdit(chatId, statusMsg, `🎬 Генерирую «${era.name}»...`);

            const generatedResult = await generateImage.generateHistoryAvatar(geminiFiles, era, outputDir, settings);

            const caption = `${era.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }

          } else if (styleId === 'literature') {
            // === Литература — случайное произведение из 100 ===
            const work = generateImage.getRandomLiterature();
            await tgEdit(chatId, statusMsg, `📚 Генерирую «${work.name}»...`);

            const generatedResult = await generateImage.generateLiteratureAvatar(geminiFiles, work, outputDir, settings);

            const caption = `${work.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }

          } else if (styleId === 'cinema') {
            // === Кино — случайный фильм из IMDB250 ===
            const movie = generateImage.getRandomMovie();
            await tgEdit(chatId, statusMsg, `🎬 Генерирую в стиле «${movie.title}» (${movie.year})...`);

            const generatedResult = await generateImage.generateCinemaAvatar(geminiFiles, movie, outputDir, settings);

            const caption = `🎬 «${movie.title}» (${movie.year})
🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }

          } else {
            // === Обычный стиль — одно фото ===
            const generatedResult = await generateImage.generateAvatar(geminiFiles, styleId, outputDir, settings);

            const caption = `✨ Готово! Стиль: «${result.style.name}»\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            const actualRemaining = consumeAfterGeneration(chatId, result);
            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            if (actualRemaining > 0) {
              await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
            }
          }
          }

        } catch (err) {
          console.error('❌ Ошибка генерации:', err.message);

          metrics.track('generation:failed', {
            telegram_id: String(chatId),
            style_id: styleId,
            error: (err.message || '').slice(0, 100),
            recovered: 'false'
          });

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
                  metrics.track('generation:file_expired', { telegram_id: String(chatId), style_id: styleId, recovered: 'true' });
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
            metrics.track('generation:retrying', { telegram_id: String(chatId), style_id: styleId });
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
                const retryRemaining = consumeAfterGeneration(chatId, result);
                if (retryRemaining > 0 && retryRemaining <= 3) {
                  await tgSend(chatId, `⚠️ Осталось всего ${retryRemaining} ${botLogic.pluralGen(retryRemaining)}`);
                }
                if (retryRemaining > 0) {
                  await tgSend(chatId, 'Выбери ещё один стиль 👇', { reply_markup: result.reply_markup });
                } else {
                  await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: buildBuyKeyboard() });
                }
              }
            } catch (retryErr) {
              console.error('❌ Retry тоже не удался:', retryErr.message);
              await tgSend(chatId, `❌ Не удалось сгенерировать даже после повтора: ${retryErr.message}`);
              if (result.remaining > 0) {
                await tgSend(chatId, 'Попробуй другой стиль 👇', { reply_markup: result.reply_markup });
              } else {
                await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: buildBuyKeyboard() });
              }
            }
          } else {
            await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
            if (result.remaining > 0) {
              await tgSend(chatId, 'Попробуй другой стиль 👇', { reply_markup: result.reply_markup });
            } else {
              await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: buildBuyKeyboard() });
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
      metrics.track('prompt:repeat', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '🔄 Повторяю...');
      const conv = botLogic.getConversation(String(chatId));
      const storedPrompt = conv?.data?.lastPromptText;
      if (!storedPrompt) {
        await tgEdit(chatId, msgId, '❌ Нет сохранённого промпта. Напиши новое описание.');
        return;
      }

      const storedPhoto = conv?.data?.lastAttachedPhoto || null;

      // Динамическая стоимость
      const cost = botLogic.getModelCost ? botLogic.getModelCost(String(chatId)) : 1;

      // Проверяем баланс
      const user = botLogic.findUserByTelegram(String(chatId));
      if (!user || user.generationsRemaining < cost) {
        await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: buildBuyKeyboard() });
        botLogic.resetConversation(String(chatId));
        return;
      }
      const generationResult = botLogic.consumeGeneration(conv.data.userId, cost);
      const isNoAvatar = conv?.data?.avatarId === 'no_avatar';
      const promptResult = {
        promptText: storedPrompt,
        attachedPhoto: isNoAvatar ? null : storedPhoto,
        avatarId: conv.data.avatarId,
        userId: conv.data.userId,
        remaining: generationResult.remaining,
        isNoAvatar,
        readyToGenerate: true
      };

      await generateCustomAvatarWithPhoto(chatId, promptResult);
      return;
    }

    if (data === 'prompt_exit') {
      metrics.track('prompt:exit', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '🚪 Выход из промпта');
      const cancelResult = botLogic.handleCancelGodMode(String(chatId));
      if (cancelResult) {
        await tgSend(chatId, cancelResult.text);
      } else {
        await tgSend(chatId, 'Промпт завершён. Выбери другой режим 👇');
      }
      return;
    }

    // ------ Callback: Помощь ------
    if (data === 'help_instructions') {
      metrics.track('help:instructions', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '📖 Инструкция');
      const result = botLogic.handleHelpInstructions();
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'help_support') {
      metrics.track('help:support', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '💬 Задать вопрос');
      const result = botLogic.handleHelpSupport();
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data === 'help_back') {
      await tgAnswerCb(cb.id, '🔙 Назад');
      const result = botLogic.handleHelp();
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }
  }

  // ------ Обычные сообщения ------
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const userName = msg.from?.first_name || msg.from?.username || `User${chatId}`;
  const userLang = msg.from?.language_code || '';
  const isPremium = msg.from?.is_premium === true;

  // /start, /cancel, /отмена
  if (text.toLowerCase() === '/start' || text.toLowerCase() === '/cancel' || text.toLowerCase() === 'отмена') {
    // Чистим буфер медиагруппы
    delete mediaGroups[chatId];
    
    if (text.toLowerCase() === '/cancel') {
      metrics.track('user:cancelled', { telegram_id: String(chatId) });
      // Сначала пробуем отменить режим бога
      const cancelResult = botLogic.handleCancelGodMode(String(chatId));
      if (cancelResult) {
        const mainKB = botLogic.buildMainKeyboard();
        await tgSend(chatId, cancelResult.text, { reply_markup: mainKB });
        return;
      }
    }
    
    const fn = text.toLowerCase() === '/start' ? botLogic.handleStart : botLogic.handleCancel;
    const result = fn(String(chatId));
    
    if (text.toLowerCase() === '/start') {
      const isNew = botLogic.isNewUser(String(chatId));
      // Обновляем premium-статус для существующих пользователей
      if (!isNew) {
        botLogic.updateUserPremium(String(chatId), isPremium);
      }
      metrics.track(isNew ? 'onboarding:started' : 'user:returned', { telegram_id: String(chatId) });
    }

    // Отправляем только ОДНО сообщение — то, что вернул handleStart/handleCancel.
    // Если нужна клавиатура, handleStart сам её возвращает в reply_markup.
    // Дублирующая отправка удалена — она была причиной двух сообщений.
    await tgSend(chatId, result.text, {
      ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
      ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
    });

    // Отправляем followUp (следующее сообщение), если есть
    if (result.followUp) {
      await tgSend(chatId, result.followUp.text, {
        ...(result.followUp.parse_mode ? { parse_mode: result.followUp.parse_mode } : {}),
        ...(result.followUp.reply_markup ? { reply_markup: result.followUp.reply_markup } : {})
      });
    }
    return;
  }

  // ===== SECRETGIFT100 — секретный код: 100 генераций, одноразово (не работает в режиме Промпт) =====
  if (text === 'SECRETGIFT100') {
    const conv = botLogic.getConversation(String(chatId));
    if (conv.state !== 'awaiting_custom_prompt') {
      const result = botLogic.setGenerationsTo100(String(chatId));
      if (result !== null) {
        if (result.alreadyUsed) {
          await tgSend(chatId, '😅 Ты уже активировал этот секретный код! Он одноразовый.', { parse_mode: 'HTML' });
        } else {
          metrics.track('secretgift100:activated', { telegram_id: String(chatId) });
          await tgSend(chatId, `🎉 Секретный код активирован! Теперь у тебя <b>${result.count}</b> ${botLogic.pluralGen(result.count)}.`, { parse_mode: 'HTML' });
        }
      } else {
        await tgSend(chatId, '❌ Сначала напиши /start, чтобы зарегистрироваться.');
      }
      return;
    }
    // В режиме Промпт — пропускаем, обработается как обычный текст промпта
  }

  // /help — информация (и кнопка ❓ Помощь)
  if (text.toLowerCase() === '/help' || text === '❓ Помощь') {
    metrics.track('help:opened', { telegram_id: String(chatId) });
    const result = botLogic.handleHelp();
    await tgSend(chatId, result.text, {
      parse_mode: result.parse_mode,
      reply_markup: result.reply_markup
    });
    return;
  }

  // /styles — показать стили (и кнопка 🖼 Стили)
  if (text.startsWith('/styles') || text === '🖼 Стили') {
    metrics.track('style:list', { telegram_id: String(chatId) });
    const result = botLogic.handleStyles(String(chatId));
    await tgSend(chatId, result.text, {
      ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
      ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
    });
    return;
  }

  // /buy — покупка генераций
  if (text.toLowerCase() === '/buy' || text.toLowerCase() === '/купить') {
    metrics.track('buy:command', { telegram_id: String(chatId) });
    const buyResult = botLogic.handleBuy(String(chatId));
    if (buyResult) {
      await tgSend(chatId, buyResult.text, {
        parse_mode: buyResult.parse_mode,
        reply_markup: buyResult.reply_markup
      });
    }
    return;
  }

  // /status, /remaining, /balance, /осталось — остаток генераций (и кнопка 💰 Баланс)
  if (['/status', '/remaining', '/balance', '/осталось'].includes(text.toLowerCase()) || text === '💰 Баланс') {
    metrics.track('balance:checked', { telegram_id: String(chatId) });
    const remaining = botLogic.checkBalance(String(chatId));
    const payments = require('./payments');
    if (remaining === null) {
      await tgSend(chatId, '❌ Ты ещё не загружал фото. Напиши /start чтобы начать.');
      return;
    }
    
    let responseText;
    if (remaining <= 0) {
      responseText = '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё 👇';
    } else {
      responseText = `🌀 У тебя осталось <b>${remaining}</b> ${botLogic.pluralGen(remaining)}\n\nЕсли нужно ещё — можно приобрести 👇`;
    }
    
    const buyBtn = payments.isConfigured()
      ? { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } }
      : {};
    await tgSend(chatId, responseText, { ...buyBtn, parse_mode: 'HTML' });
    return;
  }

  // ------ Reply keyboard buttons (команды) ------
  if (text.startsWith('/prompt') || text === '✍️ Промпт') {
    metrics.track('prompt:started', { telegram_id: String(chatId) });
    const result = botLogic.handleGodMode(String(chatId));
    await tgSend(chatId, result.text, {
      ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
      ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
    });
    return;
  }
  
  if (text.startsWith('/avatar') || text === '👤 Аватар') {
    metrics.track('avatar:list', { telegram_id: String(chatId) });
    const result = botLogic.handleAvatars(String(chatId));
    await tgSend(chatId, result.text, {
      ...(result.parse_mode ? { parse_mode: result.parse_mode } : {}),
      ...(result.reply_markup ? { reply_markup: result.reply_markup } : {})
    });
    return;
  }
  
  if (text.startsWith('/settings') || text === '⚙️ Настройки') {
    metrics.track('settings:opened', { telegram_id: String(chatId) });
    const result = botLogic.handleSettings(String(chatId));
    await tgSend(chatId, result.text, {
      parse_mode: result.parse_mode,
      reply_markup: result.reply_markup
    });
    return;
  }

  // ------ Фото ------
  if (msg.photo && msg.photo.length > 0) {
    const bestFile = msg.photo.reduce((a, b) => (a.file_size > b.file_size ? a : b));

    // Проверка максимального размера для одиночного фото — 5 MB
    if (!msg.media_group_id && bestFile.file_size > 5 * 1024 * 1024) {
      await tgSend(chatId, '⚠️ Фото слишком большое. Максимальный размер — 5 МБ.');
      return;
    }

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

      const sendOpts = {
        ...(promptResult.parse_mode ? { parse_mode: promptResult.parse_mode } : {}),
        ...(promptResult.reply_markup ? { reply_markup: promptResult.reply_markup } : {})
      };

      if (promptResult.pendingPhotoAttached) {
        // Фото сохранено, ждём текстовое описание
        await tgSend(chatId, promptResult.text, sendOpts);
        return;
      }

      if (promptResult.readyToGenerate) {
        await tgSend(chatId, promptResult.text, sendOpts);
        await generateCustomAvatarWithPhoto(chatId, promptResult);
      } else {
        await tgSend(chatId, promptResult.text, sendOpts);
      }
      return;
    }

    // Media group?
    if (msg.media_group_id) {
      const buf = getOrCreateBuffer(chatId, msg.media_group_id);

      // Суммарный размер всех фото в альбоме
      buf.totalSize = (buf.totalSize || 0) + bestFile.file_size;
      if (buf.totalSize > 25 * 1024 * 1024) {
        clearTimeout(buf.timer);
        delete mediaGroups[chatId][msg.media_group_id];
        // Чистим все уже скачанные фото из этого альбома
        try { fs.unlinkSync(filePath); } catch {}
        for (const p of (buf.photos || [])) {
          try { fs.unlinkSync(p); } catch {}
        }
        await tgSend(chatId, '⚠️ Общий размер всех фото в альбоме превышает 25 МБ. Отправь меньше фото или меньшего качества.');
        return;
      }

      buf.photos.push(filePath);

      // Сбрасываем таймер — ждём 1.5 сек, пока придут остальные фото
      clearTimeout(buf.timer);
      buf.timer = setTimeout(() => flushMediaGroup(chatId, msg.media_group_id, userName, userLang, isPremium), 1500);
    } else {
      // Одиночное фото — сразу процессим
      await processPhotos(chatId, [filePath], userName, userLang, isPremium);
    }
    return;
  }

  // ------ Документ (фото без сжатия) ------
  if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
    if (msg.document.file_size > 5 * 1024 * 1024) {
      await tgSend(chatId, '⚠️ Файл слишком большой. Максимальный размер — 5 МБ.');
      return;
    }
    const filePath = await downloadFromTelegram(msg.document.file_id);

    // Если в режиме промпта — обрабатываем
    const docConvState = botLogic.getConversation(String(chatId));
    if (docConvState.state === 'awaiting_custom_prompt') {
      // Кладём как отложенное фото и ждём текста
      docConvState.data.pendingPhoto = filePath;
      botLogic.setConversation(String(chatId), 'awaiting_custom_prompt', docConvState.data);
      await tgSend(chatId, '✅ Фото получено. Теперь напиши описание для генерации.');
      return;
    }

    // Иначе как обычное фото
    await processPhotos(chatId, [filePath], userName, userLang, isPremium);
    return;
  }

  // ------ Промпт — пользователь ввёл описание (или фото + текст) ------
  const convState = botLogic.getConversation(String(chatId));
  if (convState.state === 'awaiting_custom_prompt') {
    metrics.track('prompt:text_entered', { telegram_id: String(chatId) });
    // Проверяем, есть ли отложенное фото в conversation
    const pendingPhoto = convState.data?.pendingPhoto || null;
    const promptResult = botLogic.handleCustomPrompt(String(chatId), text, pendingPhoto);
    if (!promptResult) {
      await tgSend(chatId, '❌ Ошибка. Напиши описание для генерации.');
      return;
    }

    const sendOpts = {
      ...(promptResult.parse_mode ? { parse_mode: promptResult.parse_mode } : {}),
      ...(promptResult.reply_markup ? { reply_markup: promptResult.reply_markup } : {})
    };

    if (promptResult.readyToGenerate) {
      await tgSend(chatId, promptResult.text, sendOpts);
      await generateCustomAvatarWithPhoto(chatId, promptResult);
    } else {
      await tgSend(chatId, promptResult.text, sendOpts);
    }
    return;
  }

  // ------ В состоянии ожидания фото — если текст, просим фото ------
  if (convState.state === 'awaiting_photos') {
    await tgSend(chatId, '📸 Отправь свои фото, и я создам твой аватар!');
    return;
  }

  // ------ Переименование аватара ------
  if (convState.state === 'awaiting_avatar_rename') {
    metrics.track('avatar:rename_done', { telegram_id: String(chatId) });

    const result = botLogic.handleRenameAvatarDone(String(chatId), text);
    if (result.error) {
      await tgSend(chatId, `❌ ${result.error}`);
      return;
    }

    await tgSend(chatId, `✅ Аватар переименован в «${result.name}»`);

    const avatarsResult = botLogic.handleAvatars(String(chatId));
    if (avatarsResult) {
      await tgSend(chatId, avatarsResult.text, {
        reply_markup: avatarsResult.reply_markup
      });
    }
    return;
  }

  // ------ Всё остальное — не команда и не промпт, предлагаем действия ------
  metrics.track('user:unknown_command', { telegram_id: String(chatId), text: text.slice(0, 50) });
  await tgSend(chatId, 'Выбери действие:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎨 Выбрать стиль', callback_data: 'start_choose_style' }],
        [{ text: '✍️ Своё описание', callback_data: 'start_custom_prompt' }]
      ]
    }
  });
}

// ===================== Генерация аватара в режиме Промпт (с фото или без) =====================

/**
 * Сгенерировать аватар по промпту + опционально прикреплённое фото.
 * Вызывается как из текстового сообщения, так и из сообщения с фото.
 */
/**
 * Списать одну генерацию после успешного создания фото.
 */
function consumeAfterGeneration(chatId, result) {
  try {
    const genResult = botLogic.consumeGeneration(result.userId, result.cost || 1);
    metrics.track('generation:completed', {
      telegram_id: String(chatId),
      style_id: result.style?.id || 'custom_prompt'
    });
    return genResult.remaining;
  } catch (e) {
    console.error('❌ Ошибка списания генерации:', e.message);
    return 0;
  }
}

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

    const settings = botLogic.getSettings(String(chatId));

    // Режим "Без аватара" — генерация без фото пользователя
    if (promptResult.isNoAvatar) {
      metrics.track('prompt:generation_started', { telegram_id: String(chatId) });
      const generatedResult = await generateImage.generateNoAvatarCustom(promptResult.promptText, outputDir, settings);

      const caption = `✍️ Промпт\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>\n\n📝 ${promptResult.promptText}`;

      await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });

      const promptRemaining = consumeAfterGeneration(chatId, promptResult);

      if (promptRemaining <= 0) {
        botLogic.resetConversation(String(chatId));
        const exhMsg = botLogic.exhaustionMessage();
        await tgSend(chatId, exhMsg.text, { reply_markup: exhMsg.reply_markup });
      } else {
        if (promptRemaining <= 3) {
          await tgSend(chatId, `⚠️ Осталось всего ${promptRemaining} ${botLogic.pluralGen(promptRemaining)}`);
        }

        const conv = botLogic.getConversation(String(chatId));
        if (conv?.data) {
          delete conv.data.pendingPhoto;
          conv.data.lastPromptText = promptResult.promptText;
          botLogic.setConversation(String(chatId), 'awaiting_custom_prompt', conv.data);
        }

        await tgSend(chatId, '✍️ Что дальше?\n\n🔄 <b>Повторить</b> — новая генерация по тому же описанию\n🚪 <b>Выйти</b> — выйти из режима Промпт', {
          parse_mode: 'HTML',
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
      return;
    }

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

    // Используется getModelCost для динамической стоимости
    metrics.track('prompt:generation_started', { telegram_id: String(chatId) });
    const generatedResult = await generateImage.generateCustomAvatar(geminiFiles, promptResult.promptText, outputDir, settings);

    const caption = `✍️ Промпт\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>\n\n📝 ${promptResult.promptText}`;

    await tgSendPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });

    const promptRemaining = consumeAfterGeneration(chatId, promptResult);

    if (promptRemaining <= 0) {
      botLogic.resetConversation(String(chatId));
      const exhMsg = botLogic.exhaustionMessage();
      await tgSend(chatId, exhMsg.text, { reply_markup: exhMsg.reply_markup });
    } else {
      if (promptRemaining <= 3) {
        await tgSend(chatId, `⚠️ Осталось всего ${promptRemaining} ${botLogic.pluralGen(promptRemaining)}`);
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
      await tgSend(chatId, '✍️ Что дальше?\n\n🔄 <b>Повторить</b> — новая генерация по тому же описанию\n🚪 <b>Выйти</b> — выйти из режима Промпт', {
        parse_mode: 'HTML',
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

  } catch (err) {
    console.error('❌ Ошибка генерации в режиме промпта:', err.message);
    metrics.track('prompt:generation_failed', {
      telegram_id: String(chatId),
      error: err.message.slice(0, 100),
      blocked: String(err.message.includes('Заблокировано'))
    });
    if (err.message.includes('Заблокировано')) {
      await tgSend(chatId, '❌ Gemini заблокировал генерацию. Попробуй другое описание.');
    } else {
      await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
    }
    await tgSend(chatId, '✍️ Что дальше?\n\n🔄 <b>Повторить</b> — новая генерация по тому же описанию\n🚪 <b>Выйти</b> — выйти из режима Промпт', {
      parse_mode: 'HTML',
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

metrics.init();
console.log('🤖 Imgy Bot запущен.');
console.log(`📁 Временные фото: ${PHOTOS_TMP}`);
console.log('Ожидание сообщений...');
poll();
