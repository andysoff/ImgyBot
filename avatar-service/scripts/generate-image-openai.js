#!/usr/bin/env node
/**
 * Генерация изображений через OpenAI
 *
 * Поддерживает:
 *  - gpt-image-1.5 — генерация по тексту (generations) + с фото-референсом (edits)
 *  - gpt-image-2 — генерация по тексту (generations) + с фото-референсом (generations с images[])
 *
 * OpenAI API reference:
 *  - POST /v1/images/generations → создание с нуля (+ фото-референс через images[] для gpt-image-2)
 *  - POST /v1/images/edits → редактирование по фото (gpt-image-1.5, gpt-image-1, gpt-image-1-mini)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Buffer } = require('buffer');

const API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = 'gpt-image-1.5';

// ======================================================================
// Кеш base64 data URI для фото (избегаем повторного чтения/кодирования)
// ======================================================================

const PHOTO_CACHE_DIR = path.join(__dirname, '..', 'data', 'openai-photo-cache');

function _ensureCacheDir() {
  fs.mkdirSync(PHOTO_CACHE_DIR, { recursive: true });
}

/**
 * Уникальный ключ кеша для файла — зависит от пути + размера + времени модификации.
 * Если файл изменится — кеш автоматически инвалидируется (другой ключ).
 */
function _cacheKey(filePath) {
  const stat = fs.statSync(filePath);
  return crypto.createHash('md5').update(`${filePath}::${stat.size}::${stat.mtimeMs}`).digest('hex');
}

/**
 * Получить data URI для фото:
 *  - если есть кеш — читаем оттуда
 *  - если нет — кодируем в base64 и сохраняем в кеш
 */
function _getPhotoDataUri(filePath) {
  try {
    const key = _cacheKey(filePath);
    const cacheFile = path.join(PHOTO_CACHE_DIR, key + '.uri');
    if (fs.existsSync(cacheFile)) {
      const cached = fs.readFileSync(cacheFile, 'utf-8');
      console.log(`  📦 Кеш OpenAI: data URI для ${path.basename(filePath)} (${(Buffer.byteLength(cached, 'utf-8') / 1024).toFixed(0)} KB)`);
      return cached;
    }
    // Кеша нет — кодируем и сохраняем
    const mime = getMimeType(filePath);
    const b64 = imageToBase64(filePath);
    const dataUri = `data:${mime};base64,${b64}`;
    _ensureCacheDir();
    fs.writeFileSync(cacheFile, dataUri, 'utf-8');
    console.log(`  💾 Кеш OpenAI: сохранён data URI для ${path.basename(filePath)} (${(Buffer.byteLength(dataUri, 'utf-8') / 1024).toFixed(0)} KB)`);
    return dataUri;
  } catch (e) {
    console.warn(`  ⚠️ Ошибка кеша OpenAI для ${filePath}: ${e.message}. Кодирую напрямую.`);
    const mime = getMimeType(filePath);
    const b64 = imageToBase64(filePath);
    return `data:${mime};base64,${b64}`;
  }
}

/**
 * Очистить кеш для конкретного файла (или весь, если filePath не указан).
 */
function clearPhotoCache(filePath) {
  if (filePath) {
    try {
      const key = _cacheKey(filePath);
      const cacheFile = path.join(PHOTO_CACHE_DIR, key + '.uri');
      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
        console.log(`  🗑️ Кеш OpenAI: удалён data URI для ${path.basename(filePath)}`);
      }
    } catch (e) {
      console.warn(`  ⚠️ Не удалось очистить кеш для ${filePath}: ${e.message}`);
    }
  } else {
    // Очистить весь кеш
    try {
      if (fs.existsSync(PHOTO_CACHE_DIR)) {
        const files = fs.readdirSync(PHOTO_CACHE_DIR);
        for (const f of files) {
          fs.unlinkSync(path.join(PHOTO_CACHE_DIR, f));
        }
        console.log(`  🗑️ Кеш OpenAI: очищен полностью (${files.length} файлов)`);
      }
    } catch (e) {
      console.warn(`  ⚠️ Не удалось очистить кеш: ${e.message}`);
    }
  }
}

// ======================================================================
// /Кеш
// ======================================================================

// Размеры по соотношениям сторон
// gpt-image-1.5 works with /v1/images/edits → size: "1024x1024" (only standard sizes)
const SIZE_MAP = {
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '16:9': '1536x1024',
  '3:4': '1024x1536',
  '9:16': '1024x1536'
};

// gpt-image-2 supports arbitrary sizes up to 3840x2160
const SIZE_MAP_V2 = {
  '1:1': '1024x1024',
  '4:3': '2048x1536',
  '16:9': '3840x2160',
  '3:4': '1536x2048',
  '9:16': '2160x3840'
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp',
    '.heic': 'image/heic', '.heif': 'image/heif'
  };
  return mimeTypes[ext] || 'image/jpeg';
}

// ======================================================================
// API
// ======================================================================

/**
 * Универсальный вызов OpenAI API (JSON body).
 */
function openaiRequest(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const payloadKB = (Buffer.byteLength(payload) / 1024).toFixed(0);
    console.log(`🔌 OpenAI HTTP → ${apiPath}, payload ${payloadKB} KB, model=${body.model || '?'}`);
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: apiPath,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 300000
      },
      (res) => {
        const reqStart = Date.now();
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const elapsed = ((Date.now() - reqStart) / 1000).toFixed(1);
          console.log(`🔌 OpenAI HTTP ← ${apiPath} (${elapsed}s, payload ${payloadKB} KB, status ${res.statusCode})`);
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`OpenAI: ${parsed.error.message} (${parsed.error.type || ''})`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`OpenAI parse error: ${data.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error(`❌ OpenAI HTTP error: ${err.message}`);
      reject(err);
    });
    req.on('timeout', () => {
      console.error('❌ OpenAI HTTP timeout (>5 min)');
      req.destroy();
      reject(new Error('OpenAI timeout (>5 min)'));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Вызов OpenAI images/generations (текст → изображение).
 */
function dalleGeneration(body) {
  return openaiRequest('/v1/images/generations', body);
}

/**
 * Вызов OpenAI images/edits (изображение + промпт → новое изображение).
 */
function dalleEdit(body) {
  return openaiRequest('/v1/images/edits', body);
}

/**
 * Скачать изображение по URL (не используется для GPT image models — они всегда b64_json).
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// ======================================================================
// ВСПОМОГАТЕЛЬНЫЕ
// ======================================================================

function imageToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

function extractImage(result) {
  const imageData = result.data?.[0];
  if (imageData?.b64_json) {
    return Buffer.from(imageData.b64_json, 'base64');
  }
  if (imageData?.url) {
    console.log('📥 OpenAI: скачивание по URL');
    return downloadImage(imageData.url);
  }
  throw new Error('OpenAI не вернул изображение');
}

function saveImage(imgBuffer, outputDir, filenameBase) {
  fs.mkdirSync(outputDir, { recursive: true });
  const now = new Date();
  const ts = String(now.getUTCDate()).padStart(2, '0') + String(now.getUTCMonth() + 1).padStart(2, '0') + now.getUTCFullYear() + '_' + String(now.getUTCHours()).padStart(2, '0') + String(now.getUTCMinutes()).padStart(2, '0') + String(now.getUTCSeconds()).padStart(2, '0');
  const outputPath = path.join(outputDir, `Imgy_${ts}.png`);
  fs.writeFileSync(outputPath, imgBuffer);
  const imgSizeKB = (imgBuffer.length / 1024).toFixed(1);
  console.log(`✅ OpenAI: готово ${outputPath} (${imgSizeKB} KB)`);
  return outputPath;
}

// ======================================================================
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ======================================================================

async function uploadPhoto(photoPath) {
  console.log(`📤 OpenAI: фото готово к использованию: ${photoPath}`);
  return { uri: photoPath, mimeType: getMimeType(photoPath) };
}

/**
 * Генерация по тексту (с опциональным фото-референсом).
 * Работает для gpt-image-1.5 и gpt-image-2.
 * Для gpt-image-2 фото-референс передаётся через images[] в /v1/images/generations.
 */
async function generateFromPrompt(prompt, outputDir, filenameBase = 'openai_gen', sizeOrConfig = '1024x1024', model = DEFAULT_MODEL, images = null) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  fs.mkdirSync(outputDir, { recursive: true });

  const hasImages = images && images.length > 0;
  console.log(`🎨 OpenAI ${model}: генерация${hasImages ? ' с фото-референсом' : ' по тексту'}`);
  console.log('📝 Промпт (первые 500):', prompt.slice(0, 500));

  const body = {
    model,
    prompt,
    n: 1
  };

  // Фото-референс для gpt-image-2 (через /v1/images/generations)
  if (hasImages) {
    body.images = images;
  }

  // sizeOrConfig — строка для v1.5, объект для v2 (может содержать size, resolution, quality)
  if (typeof sizeOrConfig === 'string') {
    body.size = sizeOrConfig;
  } else if (typeof sizeOrConfig === 'object') {
    body.size = sizeOrConfig.size || '1024x1024';
    if (sizeOrConfig.quality) body.quality = sizeOrConfig.quality;
  } else {
    body.size = '1024x1024';
  }

  const result = await dalleGeneration(body);
  const imgBuffer = await extractImage(result);
  const outputPath = saveImage(imgBuffer, outputDir, filenameBase);
  return { path: outputPath, prompt };
}

/**
 * Генерация с фото-референсом через Image API edits.
 * Принимает массив путей к фото — все будут отправлены как референсы.
 * Работает для gpt-image-1.5 и gpt-image-2 (через /v1/images/edits).
 * gpt-image-2 НЕ поддерживает input_fidelity (всегда high fidelity).
 */
async function generateFromPhoto(photoPaths, prompt, outputDir, filenameBase = 'openai_photo', sizeOrConfig = '1024x1024', model = DEFAULT_MODEL) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');

  if (!Array.isArray(photoPaths)) {
    photoPaths = [photoPaths];
  }

  const validPaths = photoPaths.filter(p => p && fs.existsSync(p));
  if (validPaths.length === 0) {
    throw new Error('Нет валидных фото для референса');
  }

  // Конвертируем все фото (с кешированием base64 data URI)
  const images = [];
  let totalPayloadKB = 0;
  for (const p of validPaths) {
    const dataUri = _getPhotoDataUri(p);
    const payloadSizeKB = (Buffer.byteLength(dataUri, 'utf-8') / 1024).toFixed(0);
    totalPayloadKB += parseInt(payloadSizeKB);
    const idx = validPaths.indexOf(p) + 1;
    console.log(`   изображение ${idx}/${validPaths.length}: ${payloadSizeKB} KB (data URI) ` + path.basename(p));
    images.push({ image_url: dataUri });
  }

  const isV2 = model === 'gpt-image-2';

  console.log(`🎨 OpenAI ${model}: генерация с фото-референсом (edits), ${validPaths.length} фото, общий payload ~${totalPayloadKB} KB`);
  console.log('📝 Стиль-промпт (первые 300):', prompt.slice(0, 300));
  console.log(`🔍 OpenAI request body: model=${model}, images=${images.length}, totalPayloadKB=${totalPayloadKB}`);

  const body = {
    model,
    prompt,
    images,
    n: 1
  };

  // input_fidelity не поддерживается gpt-image-2 (всегда high)
  if (!isV2) {
    body.input_fidelity = 'high';
  }

  // size для edits (gpt-image-2 поддерживает кастомные размеры) + quality
  if (typeof sizeOrConfig === 'string') {
    body.size = sizeOrConfig;
  } else if (typeof sizeOrConfig === 'object') {
    body.size = sizeOrConfig.size || '1024x1024';
    if (sizeOrConfig.quality) body.quality = sizeOrConfig.quality;
  } else {
    body.size = '1024x1024';
  }

  const result = await dalleEdit(body);
  const imgBuffer = await extractImage(result);
  const outputPath = saveImage(imgBuffer, outputDir, filenameBase);
  return { path: outputPath, prompt };
}

module.exports = {
  uploadPhoto,
  generateFromPrompt,
  generateFromPhoto,
  getMimeType,
  clearPhotoCache,
  SIZE_MAP,
  SIZE_MAP_V2
};
