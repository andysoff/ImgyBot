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

/**
 * Сохранить готовый промпт для повтора (универсально для всех стилей).
 */
function savePromptForRepeat(chatId, prompt, styleId) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv?.data) return;
  botLogic.setConversation(String(chatId), conv.state, {
    ...conv.data,
    lastGeneratedPrompt: { text: prompt, styleId }
  });
}

// ===================== PID Lock =====================
// Защита от дублирования процессов — только один экземпляр бота.
const PID_FILE = process.env.PID_FILE || '/tmp/imgy-bot.pid';

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
const payments = require('./payments');
const { setDemoOverride } = payments;

const ADMIN_TELEGRAM_ID = '132454710';

/**
 * Отправить админу уведомление об оплате
 */
async function sendAdminPaymentNotification(chatId, paymentId, pkg) {
  const user = botLogic.findUserByTelegram(String(chatId));
  const userName = (user && user.name) ? user.name : 'ID ' + chatId;
  try {
    await tgSend(Number(ADMIN_TELEGRAM_ID),
      '💳 <b>Новый платёж</b>\n\n'
      + '👤 <b>' + userName + '</b>\n'
      + '📦 Пакет: ' + pkg.generations + ' ' + botLogic.pluralGen(pkg.generations) + '\n'
      + '💰 Сумма: ' + pkg.price + '₽\n'
      + '🆔 Платёж: <code>' + paymentId + '</code>\n'
      + '✅ Статус: <b>Оплачено</b>',
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('⚠️ Ошибка отправки уведомления админу:', err.message);
  }
}

const PHOTOS_TMP = path.join(__dirname, '..', 'photos', '_incoming');
fs.mkdirSync(PHOTOS_TMP, { recursive: true });

// ===================== Проверка файлов Gemini =====================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ===================== Health Check: Gemini API Key =====================
(function checkApiKey() {
  const problems = [];

  if (!GEMINI_API_KEY) {
    problems.push('GEMINI_API_KEY пуст или не задан в .env');
  } else {
    if (GEMINI_API_KEY.length < 30) {
      problems.push(`GEMINI_API_KEY слишком короткий (${GEMINI_API_KEY.length} символов, ожидается ≥39). Возможно, ключ повреждён.`);
    }
    if (!/^AIzaSy|^AQ\./.test(GEMINI_API_KEY)) {
      problems.push('GEMINI_API_KEY не начинается с ожидаемого префикса (AIzaSy… или AQ…). Ключ может быть неверным.');
    }
    // Проверка на бинарные/не-ASCII символы
    if (/[^\x20-\x7E]/.test(GEMINI_API_KEY)) {
      problems.push('GEMINI_API_KEY содержит не-ASCII или управляющие символы — ключ повреждён (бинарный мусор).');
    }
  }

  if (problems.length > 0) {
    console.error('\n❌❌❌ GEMINI_API_KEY FAILED HEALTH CHECK ❌❌❌');
    problems.forEach(p => console.error(`  • ${p}`));
    console.error('   Бот продолжит работу, но Gemini API будет возвращать ошибки.');
    console.error('   Проверьте .env и восстановите ключ из бэкапа или из тестового окружения.');
    console.error('   Исправьте и рестартуйте: systemctl restart avatar-bot\n');

    // Пишем статус-файл для внешнего мониторинга
    try {
      require('fs').writeFileSync('/tmp/imgy-gemini-key-status.txt',
        problems.join('\n') + '\n', 'utf8');
    } catch {}
  } else {
    console.log(`✅ GEMINI_API_KEY: ${GEMINI_API_KEY.slice(0, 6)}…${GEMINI_API_KEY.slice(-4)} (${GEMINI_API_KEY.length} символов)`);
    // Удаляем старый статус-файл, если есть
    try { require('fs').unlinkSync('/tmp/imgy-gemini-key-status.txt'); } catch {}
  }
})();

// ===================== /Health Check =====================

// ===================== Auto-backup .env =====================
try {
  const envPath = path.join(__dirname, '..', '.env');
  const bakPath = envPath + '.bak';
  require('fs').copyFileSync(envPath, bakPath);
  console.log(`✅ .env backed up → ${path.basename(bakPath)}`);
} catch (err) {
  console.warn(`⚠️ Не удалось создать бэкап .env: ${err.message}`);
}
// ===================== /Auto-backup =====================

// Хранилище путей к оригинальным файлам для кнопки «Скачать оригинал»
// Ключ: `${chatId}:${photoMessageId}` → путь к файлу
const pendingOriginals = new Map();

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
 * Определить пол аватара через Gemini и сохранить в avatars.json.
 * @param {object} avatar — объект аватара
 * @param {object[]} avatars — весь массив аватаров
 * @param {Array} files — массив geminiFiles
 */
async function detectAndSaveGender(avatar, avatars, files) {
  try {
    const gender = await generateImage.detectGender(files);
    avatar.gender = gender;
    const idx = avatars.findIndex(a => a.id === avatar.id);
    if (idx >= 0) {
      avatars[idx] = avatar;
      fs.writeFileSync(
        path.join(__dirname, '..', 'data', 'avatars.json'),
        JSON.stringify(avatars, null, 2) + '\n'
      );
    }
    console.log(`🔍 Пол аватара ${avatar.id} определён: ${gender}`);
  } catch (detectErr) {
    console.warn('⚠️ Не удалось определить пол:', detectErr.message);
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
      // Определяем пол, если ещё не задан (для старых аватаров с кешированными файлами)
      if (!avatar.gender && validFiles.length > 0) {
        await detectAndSaveGender(avatar, avatars, validFiles);
      }
      // Дозаполняем localPath для OpenAI — старые кеши могут не содержать localPath
      const userPhotos = avatar.photos || [];
      for (let i = 0; i < validFiles.length && i < userPhotos.length; i++) {
        if (!validFiles[i].localPath) {
          const fullPath = path.join(__dirname, '..', userPhotos[i]);
          if (fs.existsSync(fullPath)) {
            validFiles[i].localPath = fullPath;
          }
        }
      }
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
      // Сохраняем и localPath для OpenAI (DALL-E 3 Edits нужен локальный файл)
      avatar.geminiFiles.push({ uri: fileInfo.uri, mimeType: fileInfo.mimeType, localPath: fullPath });
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

  // Определяем пол по фото (один раз, при первой загрузке в Gemini)
  if (!avatar.gender && avatar.geminiFiles && avatar.geminiFiles.length > 0) {
    await detectAndSaveGender(avatar, avatars, avatar.geminiFiles);
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

/**
 * Отправить файл как документ (без сжатия).
 */
function tgSendDocument(chatId, filePath, caption = '') {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
    const CRLF = '\r\n';
    const fileData = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    let body = '';
    body += `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}`;
    body += `${chatId}${CRLF}`;

    if (caption) {
      body += `--${boundary}${CRLF}`;
      body += `Content-Disposition: form-data; name="caption"${CRLF}${CRLF}`;
      body += `${caption}${CRLF}`;
    }

    body += `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="document"; filename="${fileName}"${CRLF}`;
    body += `Content-Type: image/jpeg${CRLF}${CRLF}`;

    const bodyBuffer = Buffer.concat([
      Buffer.from(body, 'utf-8'),
      fileData,
      Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf-8')
    ]);

    console.log(`📄 Отправка файла ${chatId}: ${fileName} (${(fileData.length / 1024).toFixed(1)} KB)`);

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/sendDocument`,
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
              console.log(`✅ tgSendDocument OK message_id=${parsed.result?.message_id}`);
            } else {
              console.error(`❌ tgSendDocument ошибка API: ${parsed.error_code} ${parsed.description}`);
            }
            resolve(parsed);
          } catch { reject(new Error(data)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('sendDocument timeout')); });
    req.write(bodyBuffer);
    req.end();
  });
}

/**
 * Отправить фото с кнопкой «Скачать оригинал» и сохранить путь в Map.
 */
async function sendGeneratedPhoto(chatId, photoPath, caption, extra = {}) {
  const result = await tgSendPhoto(chatId, photoPath, caption, extra);
  return result;
}

/**
 * Отправить кнопки после генерации: Повторить, Скачать оригинал, Другой стиль.
 * «Скачать оригинал» работает через pendingOriginals.
 * @param {number} chatId
 * @param {string} styleId — ID стиля для кнопки «Повторить»
 * @param {string} photoPath — путь к фото для «Скачать оригинал»
 * @param {number} remaining — сколько генераций осталось (0 = показать покупку)
 */
async function sendAfterGenerationButtons(chatId, styleId, photoPath, remaining) {
  if (remaining > 0) {
    const result = await tgSend(chatId, 'Готово! Что дальше? 👇', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📄 Прислать файл без сжатия', callback_data: 'download_original' }
          ],
          [
            { text: '🔄 Повторить', callback_data: 'repeat_style:' + styleId },
            { text: '🎨 Другой стиль', callback_data: 'show_styles_after_generation' }
          ]
        ]
      }
    });
    if (result.ok && result.result?.message_id && photoPath) {
      pendingOriginals.set(`${chatId}:${result.result.message_id}`, photoPath);
      setTimeout(() => {
        pendingOriginals.delete(`${chatId}:${result.result.message_id}`);
      }, 30 * 60 * 1000);
    }
  } else {
    await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', {
      reply_markup: {
        inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]]
      }
    });
  }
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

  if (extra.reply_markup) {
    const rpJson = JSON.stringify(extra.reply_markup);
    body += `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="reply_markup"${CRLF}${CRLF}`;
    body += `${rpJson}${CRLF}`;
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
    let data = cb.data || '';

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

    // ------ Callback: Скачать оригинал (без сжатия) ------
    if (data === 'download_original') {
      const key = `${chatId}:${msgId}`;
      const filePath = pendingOriginals.get(key);
      if (!filePath || !fs.existsSync(filePath)) {
        await tgAnswerCb(cb.id, '❌ Файл уже недоступен (истекло время)', true);
        return;
      }
      await tgAnswerCb(cb.id, '⬇️ Отправляю оригинал...');
      await tgSendDocument(chatId, filePath);
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

    // ------ Callback: Отладка ------
    if (data === 'settings_debug') {
      metrics.track('settings:show_debug', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsDebug(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_debug:')) {
      const value = data.replace('set_debug:', '') === 'true';
      metrics.track('settings:debug_changed', { telegram_id: String(chatId), value: String(value) });
      botLogic.updateSetting(String(chatId), 'debug', value);
      // Переключаем демо-режим платежей вместе с отладкой (только для админа)
      if (String(chatId) === ADMIN_TELEGRAM_ID) {
        setDemoOverride(value);
      }
      await tgAnswerCb(cb.id, value ? '✅ Отладка включена' : '❌ Отладка выключена');
      const result = botLogic.handleSettingsDebug(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ Callback: Тип портретного фото ------
    if (data === 'settings_portrait_type') {
      metrics.track('settings:show_portrait_type', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsPortraitType(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_portrait_type:')) {
      const value = data.replace('set_portrait_type:', '');
      metrics.track('settings:portrait_type_changed', { telegram_id: String(chatId), value });
      botLogic.updateSetting(String(chatId), 'portraitType', value);
      await tgAnswerCb(cb.id, '✅ Тип портрета обновлён');
      const result = botLogic.handleSettingsPortraitType(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ Поворот лица ------
    if (data === 'settings_face_turn') {
      metrics.track('settings:show_face_turn', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsFaceTurn(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_face_turn:')) {
      const value = data.replace('set_face_turn:', '');
      metrics.track('settings:face_turn_changed', { telegram_id: String(chatId), value });
      botLogic.updateSetting(String(chatId), 'faceTurn', value);
      await tgAnswerCb(cb.id, '✅ Поворот лица обновлён');
      const result = botLogic.handleSettingsFaceTurn(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ Разрешение (Gemini) ------
    if (data === 'settings_resolution') {
      metrics.track('settings:show_resolution', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsResolution(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_resolution:')) {
      const value = data.replace('set_resolution:', '');
      metrics.track('settings:resolution_changed', { telegram_id: String(chatId), value });
      botLogic.updateSetting(String(chatId), 'resolution', value);
      await tgAnswerCb(cb.id, '✅ Разрешение обновлено');
      const result = botLogic.handleSettingsResolution(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ OpenAI качество (Идентичный ПРО) ------
    if (data === 'settings_openai_quality') {
      metrics.track('settings:show_openai_quality', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      const result = botLogic.handleSettingsOpenaiQuality(String(chatId));
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    if (data.startsWith('set_openai_quality:')) {
      const value = data.replace('set_openai_quality:', '');
      metrics.track('settings:openai_quality_changed', { telegram_id: String(chatId), value });
      botLogic.updateSetting(String(chatId), 'openaiQuality', value);
      await tgAnswerCb(cb.id, '✅ Качество 2 обновлено');
      const result = botLogic.handleSettingsOpenaiQuality(String(chatId));
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
      if (result.error) {
        await tgAnswerCb(cb.id, '❌ ' + result.error.replace(/<[^>]+>/g, '').slice(0, 50));
        await tgSend(chatId, result.error, { parse_mode: 'HTML' });
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

      // Сначала отправляем фото аватара, если есть
      if (result.photo) {
        await tgSendPhoto(chatId, result.photo);
      }

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
      metrics.track('avatar:delete_initiated', { telegram_id: String(chatId), avatar_id: avatarId });
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
      metrics.track('avatar:photo_viewed', { telegram_id: String(chatId), avatar_id: avatarId });
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
      metrics.track('avatar:back_to_list', { telegram_id: String(chatId) });
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
      metrics.track('avatar:back_to_menu', { telegram_id: String(chatId), avatar_id: avatarId });
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

        // Сохраняем платёж в отдельное хранилище
        botLogic.addPendingPayment(String(chatId), payment.paymentId, packageId);

        const isDemoMode = payments.isDemoMode && payments.isDemoMode();

        if (isDemoMode) {
          // Демо: сразу начисляем
          await tgEdit(chatId, msgId,
            `💳 <b>${pkg.label}</b> — ${pkg.price}₽\n\n`
            + '🔄 <i>Демо-режим</i>. Генерации начисляются...',
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'show_buy' }]] } }
          );
          setTimeout(async () => {
            try {
              const newTotal = botLogic.addGenerations(String(chatId), pkg.generations);
              await tgEdit(chatId, msgId,
                `✅ <b>Демо-режим</b> — генерации начислены!\n\n`
                + `Тебе начислено <b>${pkg.generations}</b> ${botLogic.pluralGen(pkg.generations)}.\n`
                + `Теперь у тебя <b>${newTotal}</b> ${botLogic.pluralGen(newTotal)}.`,
                { parse_mode: 'HTML' }
              );
              const conv = botLogic.getConversation(String(chatId));
              botLogic.setConversation(String(chatId), conv.state, {});
            } catch (e) {
              console.error('❌ Ошибка демо-начисления:', e.message);
            }
          }, 2000);
        } else {
          await tgEdit(chatId, msgId,
            `💳 <b>${pkg.label}</b> — ${pkg.price}₽`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Оплатить ${pkg.price}₽`, url: payment.confirmationUrl }],
                [{ text: '🔙 Назад', callback_data: 'show_buy' }]
              ]
            }
          });

          // Автоматическая проверка платежа в фоне
          startPaymentWatcher(chatId, msgId, payment.paymentId, packageId);
        }
      } catch (err) {
        console.error('❌ Ошибка создания платежа:', err.message);
        await tgSend(chatId, `❌ Не удалось создать платёж: ${err.message}`);
      }
      return;
    }

    /**
     * Показать меню покупки с URL-кнопками на ЮKassa.
     * Создаёт платежи для всех пакетов сразу, кладёт прямые ссылки в кнопки.
     */
    async function handleBuyMenu(chatId) {
      const payments = require('./payments');

      const user = botLogic.findUserByTelegram(String(chatId));
      if (!user) {
        await tgSend(chatId, '❌ Сначала напиши /start, чтобы зарегистрироваться.');
        return;
      }

      const isDemo = payments.isDemoMode && payments.isDemoMode();

      // Текст с ценами
      let text = '💳 <b>Пополнение баланса</b>\n\n';
      text += 'Выбери количество генераций:\n\n';
      for (const pkg of payments.PACKAGES) {
        text += `${pkg.label} — <b>${pkg.price}₽</b>`;
        if (pkg.savingsPercent > 0) text += ` (скидка ${pkg.savingsPercent}%)`;
        text += '\n';
      }

      text += '\n🔹 Оплата производится через сервис <b>ЮKassa</b>.';

      // Кнопки — при нажатии создаётся платёж и открывается ЮKassa
      const keyboard = payments.PACKAGES.map(pkg => ([{ text: isDemo ? `🎁 ${pkg.generations} (демо)` : `💳 Купить ${pkg.generations} — ${pkg.price}₽`, callback_data: `buy:${pkg.id}` }]));
      keyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_menu' }]);
      await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    }



    if (data === 'show_buy') {
      metrics.track('buy:menu_opened', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      await handleBuyMenu(chatId);
      return;
    }

    // Кнопка «🔙 Назад» из меню покупки — удаляем сообщение с ценами
    if (data === 'back_to_menu') {
      metrics.track('buy:menu_closed', { telegram_id: String(chatId) });
      await tgAnswerCb(cb.id, '');
      await tgDelete(chatId, msgId);
      return;
    }

    if (data.startsWith('substyle_menu:')) {
      const subStyleId = data.replace('substyle_menu:', '');
      const result = botLogic.handleSubStyleMenu(String(chatId), subStyleId);
      if (!result) {
        await tgAnswerCb(cb.id, '❌', true);
        return;
      }
      await tgAnswerCb(cb.id, '');
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ Callback: Группы стилей (Warhammer и др. с groups) ------
    if (data.startsWith('group_select:')) {
      const parts = data.split(':');
      const styleId = parts[1];
      const groupId = parts.slice(2).join(':');
      const result = botLogic.handleSubStyleGroup(String(chatId), styleId, groupId);
      if (!result) {
        await tgAnswerCb(cb.id, '❌', true);
        return;
      }
      await tgAnswerCb(cb.id, '');
      await tgEdit(chatId, msgId, result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup
      });
      return;
    }

    // ------ Callback: Рандом Warhammer 40k ------
    if (data === 'warhammer_random') {
      const randomId = botLogic.handleWarhammerRandom();
      if (!randomId) {
        await tgAnswerCb(cb.id, '❌', true);
        return;
      }
      // Перенаправляем в стандартный обработчик выбора стиля
      data = 'style:' + randomId;
    }

    if (data.startsWith('substyle_select:')) {
      const styleId = data.replace('substyle_select:', '');
      // Перенаправляем в обычный обработчик стилей
      data = 'style:' + styleId;
    }

    // ------ Callback: Кино — категории ------
    if (data.startsWith('cinema_category:')) {
      const category = data.replace('cinema_category:', '');
      await tgAnswerCb(cb.id, '');
      await showCinemaMenu(chatId, msgId, category, 0);
      return;
    }

    if (data === 'cinema_back') {
      await tgAnswerCb(cb.id, '');
      await showCinemaCategoryMenu(chatId, msgId);
      return;
    }

    // ------ Callback: Кино — выбор фильма из списка ------
    if (data.startsWith('cinema_page:')) {
      const parts = data.split(':');
      const category = parts[1];
      const page = parseInt(parts[2], 10);
      await tgAnswerCb(cb.id, '');
      await showCinemaMenu(chatId, msgId, category, page);
      return;
    }

    if (data.startsWith('cinema_select:')) {
      const parts = data.split(':');
      const category = parts[1];
      const index = parseInt(parts[2], 10);
      const movie = generateImage.getMovieByIndex(category, index);
      if (!movie) {
        await tgAnswerCb(cb.id, '❌ Фильм не найден', true);
        return;
      }
      await tgAnswerCb(cb.id, `🎬 «${movie.title}»`);
      await generateCinemaMovie(chatId, movie, cb, category);
      return;
    }

    if (data.startsWith('cinema_random:')) {
      const category = data.replace('cinema_random:', '');
      const movie = generateImage.getRandomMovie(category);
      await tgAnswerCb(cb.id, `🎬 Случайно: «${movie.title}»`);
      await generateCinemaMovie(chatId, movie, cb, category);
      return;
    }

    // ------ Callback: Локации — выбор из списка ------
    if (data.startsWith('location_page:')) {
      const page = parseInt(data.replace('location_page:', ''), 10);
      await tgAnswerCb(cb.id, '');
      await showLocationMenu(chatId, msgId, page);
      return;
    }

    if (data.startsWith('location_select:')) {
      const index = parseInt(data.replace('location_select:', ''), 10);
      const location = generateImage.getLocationByIndex(index);
      if (!location) {
        await tgAnswerCb(cb.id, '❌ Локация не найдена', true);
        return;
      }
      await tgAnswerCb(cb.id, `🌍 ${location.name}`);
      await generateLocationPhoto(chatId, location, cb);
      return;
    }

    if (data === 'location_random') {
      const location = generateImage.getRandomLocation();
      await tgAnswerCb(cb.id, `🌍 Случайно: ${location.name}`);
      await generateLocationPhoto(chatId, location, cb);
      return;
    }

    // ------ Callback: Спорт — выбор из списка ------
    if (data.startsWith('sport_page:')) {
      const page = parseInt(data.replace('sport_page:', ''), 10);
      await tgAnswerCb(cb.id, '');
      await showSportMenu(chatId, msgId, page);
      return;
    }

    if (data.startsWith('sport_select:')) {
      const index = parseInt(data.replace('sport_select:', ''), 10);
      const sport = generateImage.getSportByIndex(index);
      if (!sport) {
        await tgAnswerCb(cb.id, '❌ Спорт не найден', true);
        return;
      }
      await tgAnswerCb(cb.id, `🏃 ${sport.name}`);
      await generateSportPhoto(chatId, sport, cb);
      return;
    }

    if (data === 'sport_random') {
      const sport = generateImage.getRandomSport();
      await tgAnswerCb(cb.id, `🏃 Случайно: ${sport.name}`);
      await generateSportPhoto(chatId, sport, cb);
      return;
    }

    // ------ Callback: В офисе — выбор из списка ------
    if (data.startsWith('office_page:')) {
      const page = parseInt(data.replace('office_page:', ''), 10);
      await tgAnswerCb(cb.id, '');
      await showOfficeMenu(chatId, msgId, page);
      return;
    }

    if (data.startsWith('office_select:')) {
      const index = parseInt(data.replace('office_select:', ''), 10);
      const office = generateImage.getOfficeByIndex(index);
      if (!office) {
        await tgAnswerCb(cb.id, '❌ Роль не найдена', true);
        return;
      }
      await tgAnswerCb(cb.id, `💼 ${office.name}`);
      await generateOfficePhoto(chatId, office, cb);
      return;
    }

    if (data === 'office_random') {
      const office = generateImage.getRandomOffice();
      await tgAnswerCb(cb.id, `💼 Случайно: ${office.name}`);
      await generateOfficePhoto(chatId, office, cb);
      return;
    }

    // ------ Callback: История — выбор из списка ------
    if (data.startsWith('history_page:')) {
      const page = parseInt(data.replace('history_page:', ''), 10);
      await tgAnswerCb(cb.id, '');
      await showHistoryMenu(chatId, msgId, page);
      return;
    }

    if (data.startsWith('history_select:')) {
      const index = parseInt(data.replace('history_select:', ''), 10);
      const era = generateImage.getHistoryByIndex(index);
      if (!era) {
        await tgAnswerCb(cb.id, '❌ Эпоха не найдена', true);
        return;
      }
      await tgAnswerCb(cb.id, `🏛️ ${era.name}`);
      await generateHistoryPhoto(chatId, era, cb);
      return;
    }

    if (data === 'history_random') {
      const era = generateImage.getRandomHistory();
      await tgAnswerCb(cb.id, `🏛️ Случайно: ${era.name}`);
      await generateHistoryPhoto(chatId, era, cb);
      return;
    }

    // ------ Callback: Рассказ — выбор из списка ------
    if (data.startsWith('literature_page:')) {
      const page = parseInt(data.replace('literature_page:', ''), 10);
      await tgAnswerCb(cb.id, '');
      await showLiteratureMenu(chatId, msgId, page);
      return;
    }

    if (data.startsWith('literature_select:')) {
      const index = parseInt(data.replace('literature_select:', ''), 10);
      const work = generateImage.getLiteratureByIndex(index);
      if (!work) {
        await tgAnswerCb(cb.id, '❌ Произведение не найдено', true);
        return;
      }
      await tgAnswerCb(cb.id, `📖 ${work.name}`);
      await generateLiteraturePhoto(chatId, work, cb);
      return;
    }

    if (data === 'literature_random') {
      const work = generateImage.getRandomLiterature();
      await tgAnswerCb(cb.id, `📖 Случайно: ${work.name}`);
      await generateLiteraturePhoto(chatId, work, cb);
      return;
    }

    // ------ Callback: Профессия — выбор из списка ------
    if (data.startsWith('professions_page:')) {
      const page = parseInt(data.replace('professions_page:', ''), 10);
      await tgAnswerCb(cb.id, '');
      await showProfessionsMenu(chatId, msgId, page);
      return;
    }

    if (data.startsWith('professions_select:')) {
      const index = parseInt(data.replace('professions_select:', ''), 10);
      const profession = generateImage.getProfessionByIndex(index);
      if (!profession) {
        await tgAnswerCb(cb.id, '❌ Профессия не найдена', true);
        return;
      }
      await tgAnswerCb(cb.id, `👨‍💼 ${profession.name.replace(/^[^\s]+\s/, '')}`);
      await generateProfessionsPhoto(chatId, profession, cb);
      return;
    }

    if (data === 'professions_random') {
      const profession = generateImage.getRandomProfession();
      await tgAnswerCb(cb.id, `👨‍💼 Случайно: ${profession.name.replace(/^[^\s]+\s/, '')}`);
      await generateProfessionsPhoto(chatId, profession, cb);
      return;
    }

    // ------ Callback: Около машины — выбор марки ------
    if (data.startsWith('car_brands_page:')) {
      const page = parseInt(data.replace('car_brands_page:', ''), 10);
      await tgAnswerCb(cb.id, '');
      await showCarBrandsMenu(chatId, msgId, page);
      return;
    }

    if (data.startsWith('car_brand_select:')) {
      const brandId = data.replace('car_brand_select:', '');
      await tgAnswerCb(cb.id, '');
      await showCarModelsMenu(chatId, msgId, brandId, 0);
      return;
    }

    if (data.startsWith('car_models_page:')) {
      const parts = data.replace('car_models_page:', '').split(':');
      const brandId = parts[0];
      const page = parseInt(parts[1], 10);
      await tgAnswerCb(cb.id, '');
      await showCarModelsMenu(chatId, msgId, brandId, page);
      return;
    }

    if (data.startsWith('car_model_select:')) {
      const parts = data.replace('car_model_select:', '').split(':');
      const brandId = parts[0];
      const modelId = parts[1];
      const brand = generateImage.CAR_BRANDS.find(b => b.id === brandId);
      if (!brand) {
        await tgAnswerCb(cb.id, '❌ Марка не найдена', true);
        return;
      }
      const model = brand.models.find(m => m.id === modelId);
      if (!model) {
        await tgAnswerCb(cb.id, '❌ Модель не найдена', true);
        return;
      }
      await tgAnswerCb(cb.id, `🚘 ${brand.name} ${model.name}`);
      await generateCarPhoto(chatId, brand, model, cb);
      return;
    }

    if (data === 'car_random') {
      const { brand, model } = generateImage.getRandomCarModel();
      await tgAnswerCb(cb.id, `🚘 Случайно: ${brand.name} ${model.name}`);
      await generateCarPhoto(chatId, brand, model, cb);
      return;
    }

    if (data === 'car_back_to_brands') {
      await tgAnswerCb(cb.id, '');
      await showCarBrandsMenu(chatId, msgId, 0);
      return;
    }

    // ==== За рулём — выбор марки ====
    if (data.startsWith('wheel_brand_select:')) {
      const brandId = data.replace('wheel_brand_select:', '');
      const brand = generateImage.CAR_BRANDS.find(b => b.id === brandId);
      if (!brand) {
        await tgAnswerCb(cb.id, '❌ Марка не найдена', true);
        return;
      }
      await tgAnswerCb(cb.id, `🚗 ${brand.name}`);
      await generateWheelPhoto(chatId, brand, cb);
      return;
    }

    if (data.startsWith('wheel_brands_page:')) {
      const page = parseInt(data.replace('wheel_brands_page:', ''), 10);
      await tgAnswerCb(cb.id, '');
      await showWheelBrandsMenu(chatId, msgId, page);
      return;
    }

    if (data === 'wheel_random') {
      const brands = generateImage.CAR_BRANDS;
      const brand = brands[Math.floor(Math.random() * brands.length)];
      await tgAnswerCb(cb.id, `🚗 Случайно: ${brand.name}`);
      await generateWheelPhoto(chatId, brand, cb);
      return;
    }

    if (data === 'back_to_styles') {
      const user = botLogic.findUserByTelegram(String(chatId));
      if (user) {
        const result = botLogic.handleStyles(String(chatId));
        await tgAnswerCb(cb.id, '');
        await tgEdit(chatId, msgId, result.text, {
          reply_markup: result.reply_markup
        });
      }
      return;
    }

    if (data === 'show_styles_after_generation') {
      const user = botLogic.findUserByTelegram(String(chatId));
      if (user) {
        const result = botLogic.handleStyles(String(chatId));
        await tgAnswerCb(cb.id, '');
        await tgEdit(chatId, msgId, result.text, {
          reply_markup: result.reply_markup
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
        const replyStyleName = result.parentStyleName ? `${result.parentStyleName} → ${result.style.name}` : result.style.name;
        const statusText = result.remaining > 0
          ? `✅ Стиль: «${replyStyleName}»`
          : `✅ Стиль: «${replyStyleName}»\nГенерации закончились`;

        await tgEdit(chatId, msgId, statusText);

        // ==== Кино — показываем подменю категорий ====
        if (styleId === 'cinema') {
          await showCinemaCategoryMenu(chatId, msgId);
          return;
        }

        // ==== Локации — показываем подменю локаций вместо генерации ====
        if (styleId === 'location') {
          await showLocationMenu(chatId, msgId, 0);
          return;
        }

        // ==== Спорт — подменю видов спорта ====
        if (styleId === 'sport') {
          await showSportMenu(chatId, msgId, 0);
          return;
        }

        // ==== В офисе — подменю офисных ролей ====
        if (styleId === 'in_office') {
          await showOfficeMenu(chatId, msgId, 0);
          return;
        }

        // ==== История — подменю исторических эпох ====
        if (styleId === 'history') {
          await showHistoryMenu(chatId, msgId, 0);
          return;
        }

        // ==== Рассказ — подменю литературных произведений ====
        if (styleId === 'literature') {
          await showLiteratureMenu(chatId, msgId, 0);
          return;
        }

        // ==== Профессия — подменю профессий ====
        if (styleId === 'professions') {
          await showProfessionsMenu(chatId, msgId, 0);
          return;
        }

        // ==== Около машины — подменю марок ====
        if (styleId === 'near_car') {
          await showCarBrandsMenu(chatId, msgId, 0);
          return;
        }

        // ==== За рулём — подменю марок ====
        if (styleId === 'in_car') {
          await showWheelBrandsMenu(chatId, msgId, 0);
          return;
        }

        // ==== Генерация изображения ====
        const settings = botLogic.getSettings(String(chatId));
        try {
          const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
          const avatar = avatars.find(a => a.id === result.avatarId);
          const outputDir = path.join(__dirname, '..', 'photos', 'generated');
          fs.mkdirSync(outputDir, { recursive: true });

          // Уведомление о старте
          metrics.track('generation:started', { telegram_id: String(chatId), style_id: result.style?.id || styleId });
          const styleDisplayName = result.parentStyleName ? `${result.parentStyleName} → ${result.style.name}` : result.style.name;
          const statusMsg = `🎨 Генерирую фото в стиле «${styleDisplayName}»...`;
          await tgSend(chatId, statusMsg);

          {
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

            const generatedResult = await generateImage.generateProfessionAvatar(geminiFiles, profession, outputDir, settings, String(chatId));

            const caption = `${profession.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

            const actualRemaining = consumeAfterGeneration(chatId, result);
            metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'professions', sub_id: profession.id, model: settings?.model || '', cost: String(result.cost || 1) });

            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            await sendAfterGenerationButtons(chatId, styleId, generatedResult.path, actualRemaining);

          } else if (styleId === 'sport') {
            // === Спорт — случайный вид спорта из 50 ===
            const sport = generateImage.getRandomSport();
            await tgEdit(chatId, statusMsg, `🏃 Генерирую в стиле «${sport.name}»...`);

            const generatedResult = await generateImage.generateSportAvatar(geminiFiles, sport, outputDir, settings, String(chatId));

            const caption = `${sport.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

            const actualRemaining = consumeAfterGeneration(chatId, result);
            metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'sport', sub_id: sport.id, model: settings?.model || '', cost: String(result.cost || 1) });

            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            await sendAfterGenerationButtons(chatId, styleId, generatedResult.path, actualRemaining);

          } else if (styleId === 'in_office') {
            // === В офисе — случайная офисная роль ===
            const office = generateImage.getRandomOffice();
            await tgEdit(chatId, statusMsg, `💼 Генерирую «${office.name}»...`);

            const generatedResult = await generateImage.generateOfficeAvatar(geminiFiles, office, outputDir, settings, String(chatId));

            const caption = `${office.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

            const actualRemaining = consumeAfterGeneration(chatId, result);
            metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'in_office', sub_id: office.id, model: settings?.model || '', cost: String(result.cost || 1) });

            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            await sendAfterGenerationButtons(chatId, styleId, generatedResult.path, actualRemaining);

          } else if (styleId === 'location') {
            // === Локация — случайная из 100 знаменитых мест ===
            const location = generateImage.getRandomLocation();
            await tgEdit(chatId, statusMsg, `🌍 Генерирую «${location.name}»...`);

            const generatedResult = await generateImage.generateLocationAvatar(geminiFiles, location, outputDir, settings, String(chatId));

            const caption = `${location.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

            const actualRemaining = consumeAfterGeneration(chatId, result);
            metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'location', sub_id: location.id, model: settings?.model || '', cost: String(result.cost || 1) });

            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            await sendAfterGenerationButtons(chatId, styleId, generatedResult.path, actualRemaining);

          } else if (styleId === 'history') {
            // === История — случайная историческая эпоха ===
            const era = generateImage.getRandomHistory();
            await tgEdit(chatId, statusMsg, `🎬 Генерирую «${era.name}»...`);

            const generatedResult = await generateImage.generateHistoryAvatar(geminiFiles, era, outputDir, settings, String(chatId));

            const caption = `${era.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

            const actualRemaining = consumeAfterGeneration(chatId, result);
            metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'history', sub_id: era.id, model: settings?.model || '', cost: String(result.cost || 1) });

            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            await sendAfterGenerationButtons(chatId, styleId, generatedResult.path, actualRemaining);

          } else if (styleId === 'literature') {
            // === Литература — случайное произведение из 100 ===
            const work = generateImage.getRandomLiterature();
            await tgEdit(chatId, statusMsg, `📚 Генерирую «${work.name}»...`);

            const generatedResult = await generateImage.generateLiteratureAvatar(geminiFiles, work, outputDir, settings, String(chatId));

            const caption = `${work.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

            const actualRemaining = consumeAfterGeneration(chatId, result);
            metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'literature', sub_id: work.id, model: settings?.model || '', cost: String(result.cost || 1) });

            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            await sendAfterGenerationButtons(chatId, styleId, generatedResult.path, actualRemaining);

          } else if (styleId === 'cinema') {
            // === Кино — случайный фильм из IMDB250 ===
            const movie = generateImage.getRandomMovie();
            await tgEdit(chatId, statusMsg, `🎬 Генерирую в стиле «${movie.title}» (${movie.year})...`);

            const generatedResult = await generateImage.generateCinemaAvatar(geminiFiles, movie, outputDir, settings, String(chatId));

            const caption = `🎬 «${movie.title}» (${movie.year})
🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

            const actualRemaining = consumeAfterGeneration(chatId, result);
            metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'cinema', sub_id: movie.titleEn, model: settings?.model || '', cost: String(result.cost || 1) });

            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            await sendAfterGenerationButtons(chatId, styleId, generatedResult.path, actualRemaining);

          } else {
            // === Обычный стиль — одно фото ===
            const generatedResult = await generateImage.generateAvatar(geminiFiles, styleId, outputDir, settings, String(chatId), avatar?.gender);

            const genStyleName = result.parentStyleName ? `${result.parentStyleName} → ${result.style.name}` : result.style.name;
            const caption = `✨ Готово! Стиль: «${genStyleName}»\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

            await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: "HTML" });

            await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

            const actualRemaining = consumeAfterGeneration(chatId, result);
            metrics.track('generation:completed', { telegram_id: String(chatId), style_id: styleId, sub_id: '', model: settings?.model || '', cost: String(result.cost || 1) });

            if (actualRemaining > 0 && actualRemaining <= 3) {
              await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
            }

            await sendAfterGenerationButtons(chatId, styleId, generatedResult.path, actualRemaining);
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
                    newGeminiFiles.push({ uri: fileInfo.uri, mimeType: fileInfo.mimeType, localPath: fullPath });
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
                retryResult = await generateImage.generateProfessionAvatar(geminiFiles, profession, outputDir, settings, String(chatId));
                const caption = `${profession.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'sport') {
                const sport = generateImage.getRandomSport();
                retryResult = await generateImage.generateSportAvatar(geminiFiles, sport, outputDir, settings, String(chatId));
                const caption = `${sport.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'in_office') {
                const office = generateImage.getRandomOffice();
                retryResult = await generateImage.generateOfficeAvatar(geminiFiles, office, outputDir, settings, String(chatId));
                const caption = `${office.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'location') {
                const location = generateImage.getRandomLocation();
                retryResult = await generateImage.generateLocationAvatar(geminiFiles, location, outputDir, settings, String(chatId));
                const caption = `${location.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'history') {
                const era = generateImage.getRandomHistory();
                retryResult = await generateImage.generateHistoryAvatar(geminiFiles, era, outputDir, settings, String(chatId));
                const caption = `${era.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else if (styleId === 'cinema') {
                const movie = generateImage.getRandomMovie();
                retryResult = await generateImage.generateCinemaAvatar(geminiFiles, movie, outputDir, settings, String(chatId));
                const caption = `🎬 «${movie.title}» (${movie.year})\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              } else {
                retryResult = await generateImage.generateAvatar(geminiFiles, styleId, outputDir, settings, String(chatId), avatar?.gender);
                const retryStyleName = result.parentStyleName ? `${result.parentStyleName} → ${result.style.name}` : result.style.name;
                const caption = `✨ Готово! Стиль: «${retryStyleName}»\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
                await tgSendPhoto(chatId, retryResult.path, caption, { parse_mode: 'HTML' });
              }

              if (retryResult) {
                const retryRemaining = consumeAfterGeneration(chatId, result);
                metrics.track('generation:completed', { telegram_id: String(chatId), style_id: styleId, sub_id: '', model: settings?.model || '', cost: String(result.cost || 1) });
                if (retryRemaining > 0 && retryRemaining <= 3) {
                  await tgSend(chatId, `⚠️ Осталось всего ${retryRemaining} ${botLogic.pluralGen(retryRemaining)}`);
                }
                await sendAfterGenerationButtons(chatId, styleId, retryResult ? retryResult.path : null, retryRemaining);
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

      // Проверяем баланс — сама генерация спишет внутри generateCustomAvatarWithPhoto
      const user = botLogic.findUserByTelegram(String(chatId));
      if (!user || user.generationsRemaining < cost) {
        await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: buildBuyKeyboard() });
        botLogic.resetConversation(String(chatId));
        return;
      }
      // Отправляем явное сообщение, что генерация началась
      await tgSend(chatId, `✍️ Генерирую: «${storedPrompt.slice(0, 60)}${storedPrompt.length > 60 ? '...' : ''}»`);

      const isNoAvatar = conv?.data?.avatarId === 'no_avatar';
      const promptResult = {
        promptText: storedPrompt,
        attachedPhoto: storedPhoto,
        avatarId: conv.data.avatarId,
        userId: conv.data.userId,
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

    // ------ Callback: Повторить стиль ------
    if (data.startsWith('repeat_style:')) {
      const repeatStyleId = data.replace('repeat_style:', '');
      metrics.track('style:repeat', { telegram_id: String(chatId), style_id: repeatStyleId });
      await tgAnswerCb(cb.id, '🔄 Повторяю...');

      const user = botLogic.findUserByTelegram(String(chatId));
      if (!user) {
        await tgEdit(chatId, msgId, '❌ Пользователь не найден. Напиши /start.');
        return;
      }

      const cost = botLogic.getModelCost ? botLogic.getModelCost(String(chatId)) : 1;
      if (user.generationsRemaining < cost) {
        await tgSend(chatId, '😔 Твои бесплатные генерации закончились.\nНо ты можешь приобрести ещё! 👇', { reply_markup: botLogic.buildBuyKeyboard() });
        return;
      }

      const result = botLogic.handleStyleSelected(String(chatId), repeatStyleId);

      if (!result || !result.readyToGenerate) {
        await tgSend(chatId, '❌ Ошибка: фото не готовы. Загрузи новые через /start');
        return;
      }

      const repeatStyleName = result.parentStyleName ? `${result.parentStyleName} → ${result.style.name}` : result.style.name;
      await tgSend(chatId, `🔄 Повторяю в стиле «${repeatStyleName}»...`);

      // ---- Генерация ----
      const settings = botLogic.getSettings(String(chatId));
      try {
        const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
        const avatar = avatars.find(a => a.id === result.avatarId);
        const outputDir = path.join(__dirname, '..', 'photos', 'generated');
        fs.mkdirSync(outputDir, { recursive: true });

        const isNoAvatar = result.isNoAvatar || result.avatarId === 'no_avatar';
        const geminiFiles = isNoAvatar ? [] : await ensureGeminiFiles(avatar, avatars);
        if (!isNoAvatar && geminiFiles.length === 0) {
          await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
          return;
        }

        metrics.track('generation:started', { telegram_id: String(chatId), style_id: repeatStyleId });

        // === УНИВЕРСАЛЬНЫЙ ПОВТОР: если есть сохранённый промпт для этого стиля — используем его ===
        const repeatConv = botLogic.getConversation(String(chatId));
        const savedPromptData = repeatConv?.data?.lastGeneratedPrompt;
        const usingSavedPrompt = savedPromptData && savedPromptData.styleId === repeatStyleId;

        let generatedResult, caption, styleLabel;

        if (usingSavedPrompt) {
          generatedResult = await generateImage.generateWithPrompt(geminiFiles, savedPromptData.text, outputDir, settings, String(chatId));
          caption = `🔄 Повтор\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = repeatStyleId;
        } else if (repeatStyleId === 'professions') {
          const profession = require('./generate-image').getRandomProfession();
          generatedResult = await require('./generate-image').generateProfessionAvatar(geminiFiles, profession, outputDir, settings);
          caption = `${profession.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'professions';
        } else if (repeatStyleId === 'sport') {
          const sport = require('./generate-image').getRandomSport();
          generatedResult = await require('./generate-image').generateSportAvatar(geminiFiles, sport, outputDir, settings);
          caption = `${sport.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'sport';
        } else if (repeatStyleId === 'in_office') {
          const office = require('./generate-image').getRandomOffice();
          generatedResult = await require('./generate-image').generateOfficeAvatar(geminiFiles, office, outputDir, settings);
          caption = `${office.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'in_office';
        } else if (repeatStyleId === 'location') {
          const location = require('./generate-image').getRandomLocation();
          generatedResult = await require('./generate-image').generateLocationAvatar(geminiFiles, location, outputDir, settings);
          caption = `${location.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'location';
        } else if (repeatStyleId === 'history') {
          const era = require('./generate-image').getRandomHistory();
          generatedResult = await require('./generate-image').generateHistoryAvatar(geminiFiles, era, outputDir, settings);
          caption = `${era.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'history';
        } else if (repeatStyleId === 'literature') {
          const work = require('./generate-image').getRandomLiterature();
          generatedResult = await require('./generate-image').generateLiteratureAvatar(geminiFiles, work, outputDir, settings);
          caption = `${work.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'literature';
        } else if (repeatStyleId === 'cinema') {
          const movie = require('./generate-image').getRandomMovie();
          generatedResult = await require('./generate-image').generateCinemaAvatar(geminiFiles, movie, outputDir, settings);
          caption = `🎬 «${movie.title}» (${movie.year})\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'cinema';
        } else if (repeatStyleId === 'near_car') {
          const { brand, model } = generateImage.getRandomCarModel();
          generatedResult = await generateImage.generateCarAvatar(geminiFiles, brand, model, outputDir, settings, String(chatId));
          caption = `🚘 ${brand.name} ${model.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'near_car';
        } else if (repeatStyleId === 'in_car') {
          const brands = generateImage.CAR_BRANDS;
          const brand = brands[Math.floor(Math.random() * brands.length)];
          generatedResult = await generateImage.generateWheelAvatar(geminiFiles, brand, outputDir, settings, String(chatId));
          caption = `🚗 За рулём ${brand.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = 'in_car';
        } else {
          generatedResult = await require('./generate-image').generateAvatar(geminiFiles, repeatStyleId, outputDir, settings, undefined, avatar?.gender);
          const repeatGenStyleName = result.parentStyleName ? `${result.parentStyleName} → ${result.style.name}` : result.style.name;
          caption = `✨ Готово! Стиль: «${repeatGenStyleName}»\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
          styleLabel = repeatStyleId;
        }

        await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });

        // Сохраняем промпт для следующего повтора (универсально)

        await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

        const actualRemaining = consumeAfterGeneration(chatId, result);
        metrics.track('generation:completed', { telegram_id: String(chatId), style_id: repeatStyleId, model: settings?.model || '', cost: String(result.cost || 1) });

        if (actualRemaining > 0 && actualRemaining <= 3) {
          await tgSend(chatId, `⚠️ Осталось всего ${actualRemaining} ${botLogic.pluralGen(actualRemaining)}`);
        }

        await sendAfterGenerationButtons(chatId, repeatStyleId, generatedResult.path, actualRemaining);
      } catch (err) {
        console.error('❌ Ошибка repeat генерации:', err.message);
        await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
        if (result.remaining > 0) {
          await tgSend(chatId, 'Попробуй другой стиль 👇', { reply_markup: result.reply_markup });
        } else {
          await tgSend(chatId, '😔 Бесплатные генерации закончились. Приобрести ещё! 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Пополнить', callback_data: 'show_buy' }]] } });
        }
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
      metrics.track('help:back', { telegram_id: String(chatId) });
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

  // /help — информация (и кнопка ℹ️ Поддержка)
  if (text.toLowerCase() === '/help' || text === 'ℹ️ Поддержка') {
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
    await handleBuyMenu(chatId);
    return;
  }

  // /status, /remaining, /balance, /осталось — остаток генераций (и кнопка 💰 Баланс)
  if (['/status', '/remaining', '/balance', '/осталось'].includes(text.toLowerCase()) || text === '💰 Баланс') {
    metrics.track('balance:checked', { telegram_id: String(chatId) });
    const remaining = botLogic.checkBalance(String(chatId));
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
 * Отправить отладочную информацию после генерации (если режим отладки включён).
 */
/**
 * Получить размеры изображения через ImageMagick identify.
 * Возвращает { width, height } или null.
 */
function getImageDimensions(filePath) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`identify -format '%wx%h' ${JSON.stringify(filePath)} 2>/dev/null`, { timeout: 3000 }).toString().trim();
    const m = out.match(/^(\d+)x(\d+)$/);
    if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  } catch {}
  return null;
}

/**
 * Цены API за 1 изображение для разных моделей и разрешений.
 * Gemini — цена зависит от модели и разрешения.
 * OpenAI gpt-image-1.5 — токеновая, примерно $0.04-0.08, аппроксимируем.
 * OpenAI gpt-image-2 — зависит от качества (standard/hd), качества нет в боте → standard.
 */
const IMAGE_PRICING = {
  // Gemini
  'gemini-2.5-flash-image': {
    '0.5K': 0.039,  // 1K only for 2.5 Flash, но оставим fallback
    '1K':   0.039,
    '2K':   0.039,
    '4K':   0.039
  },
  'gemini-3.1-flash-image-preview': {
    '0.5K': 0.045,
    '1K':   0.067,
    '2K':   0.101,
    '4K':   0.151
  },
  'gemini-3-pro-image-preview': {
    '0.5K': 0.134,
    '1K':   0.134,
    '2K':   0.134,
    '4K':   0.240
  },
  // OpenAI
  'openai-gpt-image-1.5': {
    '_approx': 0.06  // токеновая, примерная средняя
  },
  'openai-gpt-image-2': {
    'low':    0.006,
    'medium': 0.053,
    'high':   0.211
  }
};

/**
 * Рассчитать примерную себестоимость генерации на основе настроек.
 * @returns {string} — строка с ценой, например "$0.067" или "≈$0.06"
 */
function getEstimatedCost(settings) {
  const model = settings.model || '';
  const resolution = settings.resolution || '1K';
  const modelPricing = IMAGE_PRICING[model];
  if (!modelPricing) return '—';

  // Для gpt-image-2 учитываем качество (low/medium/high)
  if (model === 'openai-gpt-image-2') {
    const quality = settings.openaiQuality || 'medium';
    if (modelPricing[quality]) return '$' + modelPricing[quality].toFixed(3);
  }

  if (modelPricing[resolution]) {
    return '$' + modelPricing[resolution].toFixed(3);
  }
  if (modelPricing._approx) {
    return '≈$' + modelPricing._approx.toFixed(3);
  }
  return '—';
}

async function sendDebugInfo(chatId, settings, prompt, durationMs, photoPath) {
  if (!settings.debug) return;

  const modelLabel = botLogic.MODEL_OPTIONS[settings.model]?.label || settings.model;
  const qualityLabel = botLogic.QUALITY_OPTIONS[settings.quality]?.label || settings.quality;
  const openaiQualityLabel = botLogic.OPENAI_QUALITY_OPTIONS?.[settings.openaiQuality]?.label || settings.openaiQuality || 'medium';
  const aspectLabel = botLogic.ASPECT_OPTIONS[settings.aspectRatio]?.label || settings.aspectRatio;
  const portraitLabel = botLogic.PORTRAIT_TYPE_OPTIONS[settings.portraitType]?.label || '—';

  let durationStr = '';
  if (durationMs) {
    const secs = (durationMs / 1000).toFixed(1);
    if (secs >= 60) {
      const mins = Math.floor(secs / 60);
      const remainSecs = (secs % 60).toFixed(0);
      durationStr = `${mins} мин ${remainSecs} с`;
    } else {
      durationStr = `${secs} с`;
    }
  }

  // Размер файла и разрешение
  let fileSizeStr = '';
  let resolutionStr = '';
  if (photoPath) {
    try {
      const stat = fs.statSync(photoPath);
      const kb = (stat.size / 1024).toFixed(0);
      fileSizeStr = `${kb} KB`;
    } catch {}
    const dims = getImageDimensions(photoPath);
    if (dims) {
      resolutionStr = `${dims.width}×${dims.height}`;
    }
  }

  // Себестоимость
  const costStr = getEstimatedCost(settings);

  // Параметры API
  let apiParams = '';
  const isGemini = settings.model && !settings.model.startsWith('openai-');
  const isOpenAI = settings.model && settings.model.startsWith('openai-');

  if (isGemini) {
    const geminiModel = settings.model || 'gemini-3.1-flash-image-preview';
    const resolutionApiMap = { '0.5K': '512', '1K': '1K', '2K': '2K', '4K': '4K' };
    const imageConfig = {};
    if (settings.aspectRatio) imageConfig.aspectRatio = settings.aspectRatio;
    if (settings.resolution) imageConfig.imageSize = resolutionApiMap[settings.resolution] || '1K';

    apiParams = JSON.stringify({
      model: geminiModel,
      generationConfig: {
        responseModalities: ['Image', 'Text'],
        temperature: 0.1,
        topK: 32,
        topP: 1,
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {})
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    }, null, 2);
  } else if (isOpenAI) {
    const openaiModel = settings.model.replace(/^openai-/, '');
    const isV2 = openaiModel === 'gpt-image-2';
    const sizeMap = isV2
      ? { '1:1': '1024x1024', '4:3': '2048x1536', '16:9': '3840x2160', '3:4': '1536x2048', '9:16': '2160x3840' }
      : { '1:1': '1024x1024', '4:3': '1536x1024', '16:9': '1536x1024', '3:4': '1024x1536', '9:16': '1024x1536' };
    const size = sizeMap[settings.aspectRatio] || '1024x1024';
    const quality = settings.openaiQuality || 'medium';

    const body = {
      model: openaiModel,
      size,
      n: 1
    };
    if (quality) body.quality = quality;
    if (!isV2) body.input_fidelity = 'high';

    apiParams = JSON.stringify(body, null, 2);
  }

  let debugText = '🔧 <b>Отладка</b>\n\n'
    + '<b>Промпт:</b>\n<code>'
    + prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    + '</code>\n\n'
    + '<b>Параметры API:</b>\n<code>'
    + apiParams.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    + '</code>\n\n'
    + '<b>Модель:</b> ' + modelLabel + '\n'
    + '<b>Качество:</b> ' + qualityLabel + '\n'
    + '<b>Качество 2:</b> ' + openaiQualityLabel + '\n'
    + '<b>Формат:</b> ' + aspectLabel + '\n'
    + '<b>Тип портрета:</b> ' + portraitLabel;

  if (resolutionStr) {
    debugText += '\n<b>Разрешение:</b> ' + resolutionStr;
  }
  if (fileSizeStr) {
    debugText += '\n<b>Размер:</b> ' + fileSizeStr;
  }
  if (durationStr) {
    debugText += '\n<b>Время генерации:</b> ' + durationStr;
  }
  if (costStr) {
    debugText += '\n<b>Себестоимость:</b> ' + costStr;
  }

  try {
    await tgSend(chatId, debugText, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('❌ Ошибка отправки отладки:', e.message);
  }
}

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

    // Режим "Без аватара" — генерация без аватара, но может быть прикреплённое фото
    if (promptResult.isNoAvatar) {
      metrics.track('prompt:generation_started', { telegram_id: String(chatId) });

      // Если есть прикреплённое фото — загружаем его и используем обычную генерацию с фото
      if (promptResult.attachedPhoto) {
        let singleFile;
        try {
          console.log(`📤 Загружаю прикреплённое фото (no_avatar): ${promptResult.attachedPhoto}`);
          const fileInfo = await generateImage.uploadPhoto(promptResult.attachedPhoto);
          singleFile = { uri: fileInfo.uri, mimeType: fileInfo.mimeType, localPath: promptResult.attachedPhoto };
          console.log(`✅ Прикреплённое фото загружено: ${fileInfo.uri}`);
        } catch (uploadErr) {
          console.error('❌ Ошибка загрузки прикреплённого фото:', uploadErr.message);
          await tgSend(chatId, '⚠️ Не удалось загрузить фото. Генерирую без него.');
        }

        if (singleFile) {
          const generatedResult = await generateImage.generateCustomAvatar([singleFile], promptResult.promptText, outputDir, settings, String(chatId));
          const caption = `✍️ Промпт\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>\n\n📝 ${promptResult.promptText}`;
          await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
          await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);
          const promptRemaining = consumeAfterGeneration(chatId, promptResult);
          metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'custom_prompt_no_avatar_photo', model: settings?.model || '', cost: String(promptResult?.cost || 1) });
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
              if (promptResult.attachedPhoto) conv.data.lastAttachedPhoto = promptResult.attachedPhoto;
              botLogic.setConversation(String(chatId), 'awaiting_custom_prompt', conv.data);
            }
            const promptBtnsResult = await tgSend(chatId, '✍️ Что дальше?\n\n🔄 <b>Повторить</b> — новая генерация по тому же описанию\n📄 <b>Файл</b> — прислать без сжатия\n🚪 <b>Выйти</b> — выйти из режима Промпт', {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '📄 Прислать файл без сжатия', callback_data: 'download_original' }
                  ],
                  [
                    { text: '🔄 Повторить', callback_data: 'prompt_repeat' },
                    { text: '🚪 Выйти', callback_data: 'prompt_exit' }
                  ]
                ]
              }
            });
            if (promptBtnsResult.ok && promptBtnsResult.result?.message_id && generatedResult?.path) {
              pendingOriginals.set(`${chatId}:${promptBtnsResult.result.message_id}`, generatedResult.path);
              setTimeout(() => {
                pendingOriginals.delete(`${chatId}:${promptBtnsResult.result.message_id}`);
              }, 30 * 60 * 1000);
            }
          }
          return;
        }
      }

      const generatedResult = await generateImage.generateNoAvatarCustom(promptResult.promptText, outputDir, settings, String(chatId));

      const caption = `✍️ Промпт\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>\n\n📝 ${promptResult.promptText}`;

      await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });

      await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

      const promptRemaining = consumeAfterGeneration(chatId, promptResult);
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'custom_prompt_no_avatar', model: settings?.model || '', cost: String(promptResult?.cost || 1) });

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

        const promptBtnsResult = await tgSend(chatId, '✍️ Что дальше?\n\n🔄 <b>Повторить</b> — новая генерация по тому же описанию\n📄 <b>Файл</b> — прислать без сжатия\n🚪 <b>Выйти</b> — выйти из режима Промпт', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📄 Прислать файл без сжатия', callback_data: 'download_original' }
              ],
              [
                { text: '🔄 Повторить', callback_data: 'prompt_repeat' },
                { text: '🚪 Выйти', callback_data: 'prompt_exit' }
              ]
            ]
          }
        });
        if (promptBtnsResult.ok && promptBtnsResult.result?.message_id && generatedResult?.path) {
          pendingOriginals.set(`${chatId}:${promptBtnsResult.result.message_id}`, generatedResult.path);
          setTimeout(() => {
            pendingOriginals.delete(`${chatId}:${promptBtnsResult.result.message_id}`);
          }, 30 * 60 * 1000);
        }
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
        geminiFiles.push({ uri: fileInfo.uri, mimeType: fileInfo.mimeType, localPath: promptResult.attachedPhoto });
        console.log(`✅ Прикреплённое фото загружено: ${fileInfo.uri}, local: ${promptResult.attachedPhoto}`);
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
    const generatedResult = await generateImage.generateCustomAvatar(geminiFiles, promptResult.promptText, outputDir, settings, String(chatId));

    const caption = `✍️ Промпт\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>\n\n📝 ${promptResult.promptText}`;

    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });

    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'custom_prompt', model: settings?.model || '', cost: String(promptResult?.cost || 1) });

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

      // Показываем inline кнопки: Файл без сжатия / Повторить / Выйти
      const promptBtnsResult = await tgSend(chatId, '✍️ Что дальше?\n\n🔄 <b>Повторить</b> — новая генерация по тому же описанию\n📄 <b>Файл</b> — прислать без сжатия\n🚪 <b>Выйти</b> — выйти из режима Промпт', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📄 Прислать файл без сжатия', callback_data: 'download_original' }
            ],
            [
              { text: '🔄 Повторить', callback_data: 'prompt_repeat' },
              { text: '🚪 Выйти', callback_data: 'prompt_exit' }
            ]
          ]
        }
      });
      if (promptBtnsResult.ok && promptBtnsResult.result?.message_id && generatedResult?.path) {
        pendingOriginals.set(`${chatId}:${promptBtnsResult.result.message_id}`, generatedResult.path);
        setTimeout(() => {
          pendingOriginals.delete(`${chatId}:${promptBtnsResult.result.message_id}`);
        }, 30 * 60 * 1000);
      }
    }

  } catch (err) {
    console.error('❌ Ошибка генерации в режиме промпта:', err.message);
    metrics.track('prompt:generation_failed', {
      telegram_id: String(chatId),
      error: err.message.slice(0, 100),
      blocked: String(err.message.includes('Заблокировано'))
    });
    await tgSend(chatId, '❌ ' + err.message);
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

/**
 * Фоновая проверка статуса платежа.
 * msgId может быть null (при восстановлении после рестарта).
 */
function startPaymentWatcher(chatId, msgId, paymentId, packageId) {
  const maxAttempts = 225; // ~30 минут (225 × 8 сек)
  let attempts = 0;

  const check = async () => {
    attempts++;
    try {
      const result = await payments.checkPayment(paymentId);
      if (result.paid) {
        const pkg = payments.PACKAGES.find(p => p.id === packageId);
        if (pkg) {
          metrics.track('buy:payment_completed_auto', { telegram_id: String(chatId), package_id: packageId, generations: String(pkg.generations), amount: String(pkg.price) });
          const newTotal = botLogic.addGenerations(String(chatId), pkg.generations);
          try {
            await tgSend(chatId,
              '✅ <b>Оплата подтверждена!</b> 🎉\n\n'
              + 'Тебе начислено <b>' + pkg.generations + '</b> ' + botLogic.pluralGen(pkg.generations) + '.\n'
              + 'Теперь у тебя <b>' + newTotal + '</b> ' + botLogic.pluralGen(newTotal) + '.',
              { parse_mode: 'HTML' }
            );
          } catch {}
          // Уведомление админу
          try { await sendAdminPaymentNotification(chatId, paymentId, pkg); } catch {}
          // Удаляем выполненный платёж из хранилища
          botLogic.removePendingPayment(String(chatId), paymentId);
        }
        return;
      }
      if (result.status === 'canceled') {
        try {
          await tgSend(chatId, '❌ Платёж был отменён.');
        } catch {}
        // Удаляем отменённый платёж из хранилища
        botLogic.removePendingPayment(String(chatId), paymentId);
        return;
      }
    } catch (err) {
      console.error('⚠️ Ошибка авто-проверки платежа (' + attempts + '/' + maxAttempts + '):', err.message);
    }

    if (attempts < maxAttempts) {
      setTimeout(check, 8000);
    }
  };

  setTimeout(check, 8000);
}

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

// Восстановление watcher'ов для незавершённых платежей (из payments.json)
(async () => {
  try {
    let restored = 0;
    const allPending = botLogic.getAllPendingPayments();
    for (const pp of allPending) {
      const { telegramId, paymentId, packageId } = pp;
      if (!paymentId || !packageId) continue;
      try {
        const result = await payments.checkPayment(paymentId);
        if (result.paid) {
          for (const pkg of payments.PACKAGES) {
            if (pkg.id === packageId) {
              const newTotal = botLogic.addGenerations(telegramId, pkg.generations);
              try { await tgSend(Number(telegramId), '✅ <b>Оплата подтверждена!</b> 🎉\n\nТебе начислено <b>' + pkg.generations + '</b> ' + botLogic.pluralGen(pkg.generations) + '.\nТеперь у тебя <b>' + newTotal + '</b> ' + botLogic.pluralGen(newTotal) + '.', { parse_mode: 'HTML' }); } catch {}
              // Уведомление админу (создаём объект пакета для функции)
              try { await sendAdminPaymentNotification(telegramId, paymentId, pkg); } catch {}
              botLogic.removePendingPayment(telegramId, paymentId);
              console.log('♻️ Восстановлен платёж ' + paymentId + ' для ' + telegramId + ': оплачен ✅');
              restored++;
              break;
            }
          }
          continue;
        }
        if (result.status === 'canceled') {
          console.log('♻️ Платёж ' + paymentId + ' для ' + telegramId + ' отменён, удаляем');
          botLogic.removePendingPayment(telegramId, paymentId);
          continue;
        }
      } catch (e) {
        console.error('⚠️ Ошибка проверки платежа ' + paymentId + ' при восстановлении:', e.message);
      }
      startPaymentWatcher(Number(telegramId), null, paymentId, packageId);
      console.log('♻️ Восстановлен watcher для платежа ' + paymentId + ' (' + telegramId + ')');
      restored++;
    }
    if (restored > 0) {
      console.log('♻️ Восстановлено ' + restored + ' платежных watcher\'ов');
    }
  } catch (e) {
    console.error('⚠️ Ошибка восстановления watcher\'ов:', e.message);
  }
})();

// ======================================================================
// Подменю Кино
// ======================================================================
const CINEMA_PAGE_SIZE = 5;

/**
 * Показать меню выбора категории кино.
 */
async function showCinemaCategoryMenu(chatId, msgId) {
  const keyboard = [
    [{ text: '🌍 Иностранные', callback_data: 'cinema_category:foreign' }],
    [{ text: '🇷🇺 Российское', callback_data: 'cinema_category:russian' }],
    [{ text: '🛸 Советское', callback_data: 'cinema_category:soviet' }],
    [{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]
  ];

  const text = `🎬 <b>Кино</b>
Выбери категорию фильмов:`;

  const isEdit = typeof msgId === 'number' && msgId > 0;
  if (isEdit) {
    await tgEdit(chatId, msgId, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } else {
    await tgSend(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

/**
 * Показать страницу фильмов для выбора.
 */
async function showCinemaMenu(chatId, msgId, category = 'foreign', page = 0) {
  const { items, page: curPage, totalPages, total } = generateImage.getMoviesPage(category, page, CINEMA_PAGE_SIZE);
  const keyboard = [];

  // Кнопки фильмов по одной в ряд
  for (let i = 0; i < items.length; i++) {
    const startIndex = page * CINEMA_PAGE_SIZE + i;
    keyboard.push([{ text: `🎬 ${items[i].title}`, callback_data: `cinema_select:${category}:${startIndex}` }]);
  }

  // Стрелки пагинации
  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `cinema_page:${category}:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `cinema_page:${category}:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  // Случайно под стрелками
  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: `cinema_random:${category}` }]);

  // Кнопки назад
  keyboard.push([{ text: '🔙 Категории кино', callback_data: 'cinema_back' }]);
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const categoryNames = { foreign: '🌍 Иностранные', russian: '🇷🇺 Российские', soviet: '🛸 Советские' };
  const text = `🎬 <b>Кино</b> — ${categoryNames[category] || category}
Выбери фильм для генерации (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сгенерировать фото в стиле выбранного фильма.
 */
async function generateCinemaMovie(chatId, movie, cb, category = 'foreign') {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'cinema', sub_id: movie.titleEn });
    const statusMsg = `🎬 Генерирую в стиле «${movie.title}» (${movie.year})...`;
    await tgSend(chatId, statusMsg);

    // Режим "Без аватара"
    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateCinemaAvatar([], movie, outputDir, settings, String(chatId));
      const caption = `🎬 «${movie.title}» (${movie.year})\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });

      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);

      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'cinema' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'cinema', sub_id: movie.titleEn, model: settings?.model || '', cost: String(genCost) });

      if (remaining > 0 && remaining <= 3) {
        await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      }

      await sendAfterGenerationButtons(chatId, 'cinema', generatedResult ? generatedResult.path : null, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateCinemaAvatar(geminiFiles, movie, outputDir, settings, String(chatId));

    const caption = `🎬 «${movie.title}» (${movie.year})\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });

    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'cinema' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'cinema', sub_id: movie.titleEn, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) {
      await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    }

    await sendAfterGenerationButtons(chatId, 'cinema', generatedResult.path, remaining);

  } catch (err) {
    console.error('❌ Ошибка генерации кино:', err.message);
    metrics.track('generation:failed', {
      telegram_id: String(chatId),
      style_id: 'cinema',
      sub_id: movie.titleEn,
      error: (err.message || '').slice(0, 100),
      recovered: 'false'
    });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

// ======================================================================
// Подменю Локаций
// ======================================================================
const LOCATION_PAGE_SIZE = 5;

/**
 * Показать страницу локаций для выбора.
 */
async function showLocationMenu(chatId, msgId, page) {
  const { items, page: curPage, totalPages, total } = generateImage.getLocationsPage(page, LOCATION_PAGE_SIZE);
  const keyboard = [];

  // Кнопки локаций по одной в ряд
  for (let i = 0; i < items.length; i++) {
    const startIndex = page * LOCATION_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `location_select:${startIndex}` }]);
  }

  // Стрелки пагинации
  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `location_page:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `location_page:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  // Случайно под стрелками
  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'location_random' }]);

  // Кнопка назад
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const text = `🌍 <b>Локация</b>
Выбери место для генерации (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сгенерировать фото в стиле выбранной локации.
 */
async function generateLocationPhoto(chatId, location, cb) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'location', sub_id: location.id });
    const statusMsg = `🌍 Генерирую «${location.name}»...`;
    await tgSend(chatId, statusMsg);

    // Режим "Без аватара"
    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateLocationAvatar([], location, outputDir, settings, String(chatId));
      const caption = `${location.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });

      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);

      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'location' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'location', sub_id: location.id, model: settings?.model || '', cost: String(genCost) });

      if (remaining > 0 && remaining <= 3) {
        await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      }

      await sendAfterGenerationButtons(chatId, 'location', result.path, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateLocationAvatar(geminiFiles, location, outputDir, settings, String(chatId));

    const caption = `${location.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;

    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });

    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'location' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'location', sub_id: location.id, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) {
      await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    }

    await sendAfterGenerationButtons(chatId, 'location', generatedResult.path, remaining);

  } catch (err) {
    console.error('❌ Ошибка генерации локации:', err.message);
    metrics.track('generation:failed', {
      telegram_id: String(chatId),
      style_id: 'location',
      sub_id: location.id,
      error: (err.message || '').slice(0, 100),
      recovered: 'false'
    });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

// ======================================================================
// Подменю Спорта
// ======================================================================
const SPORT_PAGE_SIZE = 5;

/**
 * Показать страницу видов спорта для выбора.
 */
async function showSportMenu(chatId, msgId, page) {
  const { items, page: curPage, totalPages, total } = generateImage.getSportsPage(page, SPORT_PAGE_SIZE);
  const keyboard = [];

  for (let i = 0; i < items.length; i++) {
    const startIndex = page * SPORT_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `sport_select:${startIndex}` }]);
  }

  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `sport_page:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `sport_page:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'sport_random' }]);
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const text = `🏃 <b>Спорт</b>
Выбери вид спорта для генерации (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сгенерировать фото в стиле выбранного вида спорта.
 */
async function generateSportPhoto(chatId, sport, cb) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'sport', sub_id: sport.id });
    const statusMsg = `🏃 Генерирую «${sport.name}»...`;
    await tgSend(chatId, statusMsg);

    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateSportAvatar([], sport, outputDir, settings, String(chatId));
      const caption = `${sport.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });
      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);
      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'sport' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'sport', sub_id: sport.id, model: settings?.model || '', cost: String(genCost) });
      if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      await sendAfterGenerationButtons(chatId, 'sport', result.path, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateSportAvatar(geminiFiles, sport, outputDir, settings, String(chatId));
    const caption = `${sport.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'sport' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'sport', sub_id: sport.id, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    await sendAfterGenerationButtons(chatId, 'sport', generatedResult.path, remaining);
  } catch (err) {
    console.error('❌ Ошибка генерации спорта:', err.message);
    metrics.track('generation:failed', { telegram_id: String(chatId), style_id: 'sport', sub_id: sport.id, error: (err.message || '').slice(0, 100), recovered: 'false' });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

// ======================================================================
// Подменю В офисе
// ======================================================================
const OFFICE_PAGE_SIZE = 5;

/**
 * Показать страницу офисных ролей для выбора.
 */
async function showOfficeMenu(chatId, msgId, page) {
  const { items, page: curPage, totalPages, total } = generateImage.getOfficesPage(page, OFFICE_PAGE_SIZE);
  const keyboard = [];

  for (let i = 0; i < items.length; i++) {
    const startIndex = page * OFFICE_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `office_select:${startIndex}` }]);
  }

  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `office_page:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `office_page:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'office_random' }]);
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const text = `💼 <b>В офисе</b>
Выбери офисную роль для генерации (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сгенерировать фото в стиле выбранной офисной роли.
 */
async function generateOfficePhoto(chatId, office, cb) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'in_office', sub_id: office.id });
    const statusMsg = `💼 Генерирую «${office.name}»...`;
    await tgSend(chatId, statusMsg);

    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateOfficeAvatar([], office, outputDir, settings, String(chatId));
      const caption = `${office.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });
      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);
      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'in_office' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'in_office', sub_id: office.id, model: settings?.model || '', cost: String(genCost) });
      if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      await sendAfterGenerationButtons(chatId, 'in_office', result.path, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateOfficeAvatar(geminiFiles, office, outputDir, settings, String(chatId));
    const caption = `${office.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'in_office' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'in_office', sub_id: office.id, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    await sendAfterGenerationButtons(chatId, 'in_office', generatedResult.path, remaining);
  } catch (err) {
    console.error('❌ Ошибка генерации офиса:', err.message);
    metrics.track('generation:failed', { telegram_id: String(chatId), style_id: 'in_office', sub_id: office.id, error: (err.message || '').slice(0, 100), recovered: 'false' });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

// ======================================================================
// Подменю Истории
// ======================================================================
const HISTORY_PAGE_SIZE = 5;

/**
 * Показать страницу исторических эпох для выбора.
 */
async function showHistoryMenu(chatId, msgId, page) {
  const { items, page: curPage, totalPages, total } = generateImage.getHistoryPage(page, HISTORY_PAGE_SIZE);
  const keyboard = [];

  for (let i = 0; i < items.length; i++) {
    const startIndex = page * HISTORY_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `history_select:${startIndex}` }]);
  }

  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `history_page:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `history_page:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'history_random' }]);
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const text = `🏛️ <b>История</b>
Выбери историческую эпоху для генерации (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сгенерировать фото в стиле выбранной исторической эпохи.
 */
async function generateHistoryPhoto(chatId, era, cb) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'history', sub_id: era.id });
    const statusMsg = `🏛️ Генерирую «${era.name}»...`;
    await tgSend(chatId, statusMsg);

    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateHistoryAvatar([], era, outputDir, settings, String(chatId));
      const caption = `${era.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });
      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);
      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'history' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'history', sub_id: era.id, model: settings?.model || '', cost: String(genCost) });
      if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      await sendAfterGenerationButtons(chatId, 'history', result.path, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateHistoryAvatar(geminiFiles, era, outputDir, settings, String(chatId));
    const caption = `${era.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'history' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'history', sub_id: era.id, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    await sendAfterGenerationButtons(chatId, 'history', generatedResult.path, remaining);
  } catch (err) {
    console.error('❌ Ошибка генерации истории:', err.message);
    metrics.track('generation:failed', { telegram_id: String(chatId), style_id: 'history', sub_id: era.id, error: (err.message || '').slice(0, 100), recovered: 'false' });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

// ======================================================================
// Подменю Рассказа
// ======================================================================
const LITERATURE_PAGE_SIZE = 5;

/**
 * Показать страницу литературных произведений для выбора.
 */
async function showLiteratureMenu(chatId, msgId, page) {
  const { items, page: curPage, totalPages, total } = generateImage.getLiteraturePage(page, LITERATURE_PAGE_SIZE);
  const keyboard = [];

  for (let i = 0; i < items.length; i++) {
    const startIndex = page * LITERATURE_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `literature_select:${startIndex}` }]);
  }

  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `literature_page:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `literature_page:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'literature_random' }]);
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const text = `📖 <b>Рассказ</b>
Выбери произведение для генерации (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сгенерировать фото в стиле выбранного литературного произведения.
 */
async function generateLiteraturePhoto(chatId, work, cb) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'literature', sub_id: work.id });
    const statusMsg = `📖 Генерирую «${work.name}»...`;
    await tgSend(chatId, statusMsg);

    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateLiteratureAvatar([], work, outputDir, settings, String(chatId));
      const caption = `${work.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });
      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);
      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'literature' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'literature', sub_id: work.id, model: settings?.model || '', cost: String(genCost) });
      if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      await sendAfterGenerationButtons(chatId, 'literature', result.path, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateLiteratureAvatar(geminiFiles, work, outputDir, settings, String(chatId));
    const caption = `${work.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'literature' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'literature', sub_id: work.id, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    await sendAfterGenerationButtons(chatId, 'literature', generatedResult.path, remaining);
  } catch (err) {
    console.error('❌ Ошибка генерации литературы:', err.message);
    metrics.track('generation:failed', { telegram_id: String(chatId), style_id: 'literature', sub_id: work.id, error: (err.message || '').slice(0, 100), recovered: 'false' });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

// ======================================================================
// Подменю Профессий
// ======================================================================
const PROFESSIONS_PAGE_SIZE = 5;

/**
 * Показать страницу профессий для выбора.
 */
async function showProfessionsMenu(chatId, msgId, page) {
  const { items, page: curPage, totalPages, total } = generateImage.getProfessionsPage(page, PROFESSIONS_PAGE_SIZE);
  const keyboard = [];

  for (let i = 0; i < items.length; i++) {
    const startIndex = page * PROFESSIONS_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `professions_select:${startIndex}` }]);
  }

  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `professions_page:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `professions_page:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'professions_random' }]);
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const text = `👨‍💼 <b>Профессия</b>
Выбери профессию для генерации (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сгенерировать фото в стиле выбранной профессии.
 */
async function generateProfessionsPhoto(chatId, profession, cb) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'professions', sub_id: profession.id });
    const statusMsg = `👨‍💼 Генерирую «${profession.name}»...`;
    await tgSend(chatId, statusMsg);

    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateProfessionAvatar([], profession, outputDir, settings, String(chatId));
      const caption = `${profession.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });
      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);
      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'professions' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'professions', sub_id: profession.id, model: settings?.model || '', cost: String(genCost) });
      if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      await sendAfterGenerationButtons(chatId, 'professions', result.path, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateProfessionAvatar(geminiFiles, profession, outputDir, settings, String(chatId));
    const caption = `${profession.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'professions' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'professions', sub_id: profession.id, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    await sendAfterGenerationButtons(chatId, 'professions', generatedResult.path, remaining);
  } catch (err) {
    console.error('❌ Ошибка генерации профессии:', err.message);
    metrics.track('generation:failed', { telegram_id: String(chatId), style_id: 'professions', sub_id: profession.id, error: (err.message || '').slice(0, 100), recovered: 'false' });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

// ======================================================================
// Подменю Около машины
// ======================================================================
const CAR_BRAND_PAGE_SIZE = 5;
const CAR_MODEL_PAGE_SIZE = 5;

/**
 * Показать страницу марок автомобилей.
 */
async function showCarBrandsMenu(chatId, msgId, page) {
  const { items, page: curPage, totalPages, total } = generateImage.getCarBrandsPage(page, CAR_BRAND_PAGE_SIZE);
  const keyboard = [];

  for (let i = 0; i < items.length; i++) {
    const startIndex = page * CAR_BRAND_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `car_brand_select:${items[i].id}` }]);
  }

  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `car_brands_page:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `car_brands_page:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'car_random' }]);
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const text = `🚘 <b>Около машины</b>
Выбери марку автомобиля (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showWheelBrandsMenu(chatId, msgId, page) {
  const { items, page: curPage, totalPages, total } = generateImage.getCarBrandsPage(page, CAR_BRAND_PAGE_SIZE);
  const keyboard = [];

  for (let i = 0; i < items.length; i++) {
    const startIndex = page * CAR_BRAND_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `wheel_brand_select:${items[i].id}` }]);
  }

  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `wheel_brands_page:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `wheel_brands_page:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'wheel_random' }]);
  keyboard.push([{ text: '🔙 Назад к стилям', callback_data: 'back_to_styles' }]);

  const text = `🚗 <b>За рулём</b>
Выбери марку автомобиля (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}


/**
 * Показать страницу моделей для выбранной марки.
 */
async function showCarModelsMenu(chatId, msgId, brandId, page) {
  const brand = generateImage.CAR_BRANDS.find(b => b.id === brandId);
  if (!brand) {
    await tgSend(chatId, '❌ Марка не найдена');
    return;
  }

  const { items, page: curPage, totalPages, total } = generateImage.getModelsForBrand(brandId, page, CAR_MODEL_PAGE_SIZE);
  const keyboard = [];

  for (let i = 0; i < items.length; i++) {
    const startIndex = page * CAR_MODEL_PAGE_SIZE + i;
    keyboard.push([{ text: items[i].name, callback_data: `car_model_select:${brandId}:${items[i].id}` }]);
  }

  const navRow = [];
  if (curPage > 0) {
    navRow.push({ text: '⬅️', callback_data: `car_models_page:${brandId}:${curPage - 1}` });
  }
  if (curPage < totalPages - 1) {
    navRow.push({ text: '➡️', callback_data: `car_models_page:${brandId}:${curPage + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: '🎲 Выбрать случайный', callback_data: 'car_random' }]);
  keyboard.push([{ text: '🔙 К маркам', callback_data: 'car_back_to_brands' }]);

  const text = `🚘 <b>${brand.name}</b>
Выбери модель (стр. ${curPage + 1}/${totalPages}):`;

  await tgEdit(chatId, msgId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сгенерировать фото в стиле выбранной машины.
 */
async function generateCarPhoto(chatId, brand, model, cb) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'near_car', sub_id: brand.id + '_' + model.id });
    const statusMsg = `🚘 Генерирую «${brand.name} ${model.name}»...`;
    await tgSend(chatId, statusMsg);

    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateCarAvatar([], brand, model, outputDir, settings, String(chatId));
      const caption = `🚘 ${brand.name} ${model.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });
      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);
      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'near_car' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'near_car', sub_id: brand.id + '_' + model.id, model: settings?.model || '', cost: String(genCost) });
      if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      await sendAfterGenerationButtons(chatId, 'near_car', result.path, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateCarAvatar(geminiFiles, brand, model, outputDir, settings, String(chatId));
    const caption = `🚘 ${brand.name} ${model.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'near_car' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'near_car', sub_id: brand.id + '_' + model.id, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    await sendAfterGenerationButtons(chatId, 'near_car', generatedResult.path, remaining);
  } catch (err) {
    console.error('❌ Ошибка генерации авто:', err.message);
    metrics.track('generation:failed', { telegram_id: String(chatId), style_id: 'near_car', sub_id: brand.id + '_' + model.id, error: (err.message || '').slice(0, 100), recovered: 'false' });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

async function generateWheelPhoto(chatId, brand, cb) {
  const conv = botLogic.getConversation(String(chatId));
  if (!conv || !conv.data || !conv.data.userId) {
    await tgSend(chatId, '❌ Данные сессии утеряны. Начни с /start');
    return;
  }

  const { userId, avatarId } = conv.data;
  const settings = botLogic.getSettings(String(chatId));

  try {
    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'avatars.json'), 'utf-8'));
    const avatar = avatars.find(a => a.id === avatarId);
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });

    metrics.track('generation:started', { telegram_id: String(chatId), style_id: 'in_car', sub_id: brand.id });
    const statusMsg = `🚗 Генерирую за рулём «${brand.name}»...`;
    await tgSend(chatId, statusMsg);

    if (avatarId === 'no_avatar') {
      const result = await generateImage.generateWheelAvatar([], brand, outputDir, settings, String(chatId));
      const caption = `🚗 За рулём ${brand.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
      await tgSendPhoto(chatId, result.path, caption, { parse_mode: 'HTML' });
      await sendDebugInfo(chatId, settings, result.prompt, result.durationMs, result.path);
      const genCost = botLogic.getModelCost(String(chatId));
      const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'in_car' } });
      metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'in_car', sub_id: brand.id, model: settings?.model || '', cost: String(genCost) });
      if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
      await sendAfterGenerationButtons(chatId, 'in_car', result.path, remaining);
      return;
    }

    const geminiFiles = await ensureGeminiFiles(avatar, avatars);
    if (geminiFiles.length === 0) {
      await tgSend(chatId, '❌ Не найдено фото для генерации. Загрузи новые — /start');
      return;
    }

    const generatedResult = await generateImage.generateWheelAvatar(geminiFiles, brand, outputDir, settings, String(chatId));
    const caption = `🚗 За рулём ${brand.name}\n🌀 Сделано с помощью <a href="https://t.me/Imgy_bot">Imgy</a>`;
    await sendGeneratedPhoto(chatId, generatedResult.path, caption, { parse_mode: 'HTML' });
    await sendDebugInfo(chatId, settings, generatedResult.prompt, generatedResult.durationMs, generatedResult.path);

    const genCost = botLogic.getModelCost(String(chatId));
    const remaining = consumeAfterGeneration(chatId, { userId, cost: genCost, style: { id: 'in_car' } });
    metrics.track('generation:completed', { telegram_id: String(chatId), style_id: 'in_car', sub_id: brand.id, model: settings?.model || '', cost: String(genCost) });

    if (remaining > 0 && remaining <= 3) await tgSend(chatId, `⚠️ Осталось всего ${remaining} ${botLogic.pluralGen(remaining)}`);
    await sendAfterGenerationButtons(chatId, 'in_car', generatedResult.path, remaining);
  } catch (err) {
    console.error('❌ Ошибка генерации за рулём:', err.message);
    metrics.track('generation:failed', { telegram_id: String(chatId), style_id: 'in_car', sub_id: brand.id, error: (err.message || '').slice(0, 100), recovered: 'false' });
    await tgSend(chatId, `❌ Не удалось сгенерировать: ${err.message}`);
  }
}

// При старте: читаем отладку админа и применяем к демо-режиму
const adminSettings = botLogic.getSettings(String(ADMIN_TELEGRAM_ID));
if (adminSettings.debug) {
  setDemoOverride(true);
}

console.log('Ожидание сообщений...');
poll();
