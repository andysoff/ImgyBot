#!/usr/bin/env node
/**
 * Генерация изображений через OpenAI gpt-image-1.5
 *
 * Поддерживает:
 *  - Генерацию по тексту
 *  - Генерацию с фото-референсом (base64 в промпте)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const API_KEY = ***
const MODEL = 'gpt-image-1.5';

const SIZE_MAP = {
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '16:9': '1536x1024',
  '3:4': '1024x1536',
  '9:16': '1024x1536'
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
 */
function dalleGeneration(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/images/generations',
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
 */
async function generateFromPrompt(prompt, outputDir, filenameBase = 'openai_gen', size = '1024x1024') {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`🎨 OpenAI gpt-image-1.5: генерация по тексту`);
  console.log('📝 Промпт (первые 500):', prompt.slice(0, 500));

  const body = {
    model: MODEL,
    prompt,
    n: 1,
    size
  };

  const result = await dalleGeneration(body);
  const imageData = result.data?.[0];
  if (!imageData?.b64_json) throw new Error('OpenAI не вернул изображение');

  const imgBuffer = Buffer.from(imageData.b64_json, 'base64');
  const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}.png`);
  fs.writeFileSync(outputPath, imgBuffer);
  const imgSizeKB = (imgBuffer.length / 1024).toFixed(1);
  console.log(`✅ OpenAI: готово ${outputPath} (${imgSizeKB} KB)`);
  return { path: outputPath, prompt };
}

/**
 * Генерация с фото-референсом.
 * Кодирует фото в base64 и передаёт в теле промпта.
 */
async function generateFromPhoto(photoPath, prompt, outputDir, filenameBase = 'openai_photo', size = '1024x1024') {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  if (!fs.existsSync(photoPath)) throw new Error(`Фото не найдено: ${photoPath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const b64 = imageToBase64(photoPath);
  const mime = getMimeType(photoPath);

  console.log(`🎨 OpenAI gpt-image-1.5: генерация с фото-референсом`);
  console.log('📝 Стиль-промпт (первые 300):', prompt.slice(0, 300));

  // Собираем промпт: описание желаемого стиля + фото как референс
  const finalPrompt = `${prompt}\n\nREFERENCE IMAGE (use this person's face and body as reference, preserve their identity): data:${mime};base64,${b64}`;

  const body = {
    model: MODEL,
    prompt: finalPrompt,
    n: 1,
    size
  };

  const result = await dalleGeneration(body);
  const imageData = result.data?.[0];
  if (!imageData?.b64_json) throw new Error('OpenAI не вернул изображение');

  const imgBuffer = Buffer.from(imageData.b64_json, 'base64');
  const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}.png`);
  fs.writeFileSync(outputPath, imgBuffer);
  const imgSizeKB = (imgBuffer.length / 1024).toFixed(1);
  console.log(`✅ OpenAI: готово ${outputPath} (${imgSizeKB} KB)`);
  return { path: outputPath, prompt: finalPrompt };
}

module.exports = {
  uploadPhoto,
  generateFromPrompt,
  generateFromPhoto,
  SIZE_MAP
};
