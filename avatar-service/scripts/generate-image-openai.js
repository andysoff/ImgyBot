#!/usr/bin/env node
/**
 * Генерация изображений через OpenAI
 *
 * Поддерживает:
 *  - gpt-image-1.5 (по умолчанию)
 *  - gpt-image-2
 *
 * Функции:
 *  - Генерация по тексту
 *  - Генерация с фото-референсом (base64 в промпте)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = 'gpt-image-1.5';

const SIZE_MAP = {
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '16:9': '1536x1024',
  '3:4': '1024x1536',
  '9:16': '1024x1536'
};

// gpt-image-2 поддерживает больше размеров и resolution (1K/2K/4K)
const SIZE_MAP_V2 = {
  '1:1': { size: '1024x1024', resolution: '1K' },
  '4:3': { size: '2048x1536', resolution: '2K' },
  '16:9': { size: '3840x2160', resolution: '4K' },
  '3:4': { size: '1536x2048', resolution: '2K' },
  '9:16': { size: '2160x3840', resolution: '4K' }
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
 * Вызов OpenAI images/generations.
 * gpt-image-1.5 возвращает b64_json по умолчанию.
 * gpt-image-2 поддерживает как b64_json, так и url.
 */
/**
 * Универсальный вызов OpenAI API.
 * @param {string} apiPath - путь API (напр. /v1/images/generations, /v1/images/edits)
 * @param {Object} body - тело запроса
 */
function openaiRequest(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
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
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
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
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI timeout (>5 min)')); });
    req.write(payload);
    req.end();
  });
}

/**
 * Вызов OpenAI images/generations (текст → изображение).
 * gpt-image-1.5 возвращает b64_json по умолчанию.
 * gpt-image-2 поддерживает как b64_json, так и url.
 */
function dalleGeneration(body) {
  return openaiRequest('/v1/images/generations', body);
}

/**
 * Вызов OpenAI images/edits (изображение + промпт → новое изображение).
 * Для gpt-image-1.5/gpt-image-2 с фото-референсом.
 */
function dalleEdit(body) {
  return openaiRequest('/v1/images/edits', body);
}

/**
 * Скачать изображение по URL (для gpt-image-2, который может вернуть url вместо b64_json).
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

/**
 * Считать изображение в base64.
 */
function imageToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

// ======================================================================
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ======================================================================

/**
 * Загрузить фото (заглушка — OpenAI не требует File API).
 */
async function uploadPhoto(photoPath) {
  console.log(`📤 OpenAI: фото готово к использованию: ${photoPath}`);
  return { uri: photoPath, mimeType: getMimeType(photoPath) };
}

/**
 * Генерация по тексту (без фото-референса).
 * @param {string} prompt - промпт
 * @param {string} outputDir - папка для результата
 * @param {string} [filenameBase='openai_gen'] - префикс файла
 * @param {string|Object} [sizeOrConfig='1024x1024'] - размер или конфигурация для v2
 * @param {string} [model=DEFAULT_MODEL] - модель OpenAI
 */
async function generateFromPrompt(prompt, outputDir, filenameBase = 'openai_gen', sizeOrConfig = '1024x1024', model = DEFAULT_MODEL) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`🎨 OpenAI ${model}: генерация по тексту`);
  console.log('📝 Промпт (первые 500):', prompt.slice(0, 500));

  const body = {
    model,
    prompt,
    n: 1
  };

  if (model === 'gpt-image-2' && typeof sizeOrConfig === 'object') {
    body.size = sizeOrConfig.size || '1024x1024';
    body.resolution = sizeOrConfig.resolution || '1K';
  } else {
    body.size = typeof sizeOrConfig === 'string' ? sizeOrConfig : (sizeOrConfig.size || '1024x1024');
  }

  const result = await dalleGeneration(body);
  const imageData = result.data?.[0];

  let imgBuffer;
  if (imageData?.b64_json) {
    imgBuffer = Buffer.from(imageData.b64_json, 'base64');
  } else if (imageData?.url) {
    console.log('📥 OpenAI: скачивание по URL');
    imgBuffer = await downloadImage(imageData.url);
  } else {
    throw new Error('OpenAI не вернул изображение');
  }

  const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}.png`);
  fs.writeFileSync(outputPath, imgBuffer);
  const imgSizeKB = (imgBuffer.length / 1024).toFixed(1);
  console.log(`✅ OpenAI ${model}: готово ${outputPath} (${imgSizeKB} KB)`);
  return { path: outputPath, prompt };
}

/**
 * Генерация с фото-референсом.
 * Кодирует фото в base64 и передаёт в теле промпта.
 * @param {string} photoPath - путь к фото
 * @param {string} prompt - промпт
 * @param {string} outputDir - папка для результата
 * @param {string} [filenameBase='openai_photo'] - префикс файла
 * @param {string|Object} [sizeOrConfig='1024x1024'] - размер или конфигурация для v2
 * @param {string} [model=DEFAULT_MODEL] - модель OpenAI
 */
async function generateFromPhoto(photoPath, prompt, outputDir, filenameBase = 'openai_photo', sizeOrConfig = '1024x1024', model = DEFAULT_MODEL) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  if (!fs.existsSync(photoPath)) throw new Error(`Фото не найдено: ${photoPath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const b64 = imageToBase64(photoPath);
  const mime = getMimeType(photoPath);

  console.log(`🎨 OpenAI ${model}: генерация с фото-референсом`);
  console.log('📝 Стиль-промпт (первые 300):', prompt.slice(0, 300));

  // Используем /v1/images/edits — он принимает image как отдельное поле
  // ВАЖНО: не пихаем base64 в текст промпта — лимит 32000 символов!
  const body = {
    model,
    prompt,
    images: [`data:${mime};base64,${b64}`],
    n: 1
  };

  if (model === 'gpt-image-2' && typeof sizeOrConfig === 'object') {
    body.size = sizeOrConfig.size || '1024x1024';
    body.resolution = sizeOrConfig.resolution || '1K';
  } else {
    body.size = typeof sizeOrConfig === 'string' ? sizeOrConfig : (sizeOrConfig.size || '1024x1024');
  }

  const result = await dalleEdit(body);
  const imageData = result.data?.[0];

  let imgBuffer;
  if (imageData?.b64_json) {
    imgBuffer = Buffer.from(imageData.b64_json, 'base64');
  } else if (imageData?.url) {
    console.log('📥 OpenAI: скачивание по URL');
    imgBuffer = await downloadImage(imageData.url);
  } else {
    throw new Error('OpenAI не вернул изображение');
  }

  const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}.png`);
  fs.writeFileSync(outputPath, imgBuffer);
  const imgSizeKB = (imgBuffer.length / 1024).toFixed(1);
  console.log(`✅ OpenAI ${model}: готово ${outputPath} (${imgSizeKB} KB)`);
  return { path: outputPath, prompt };
}

module.exports = {
  uploadPhoto,
  generateFromPrompt,
  generateFromPhoto,
  SIZE_MAP,
  SIZE_MAP_V2
};
