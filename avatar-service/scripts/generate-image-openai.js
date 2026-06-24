#!/usr/bin/env node
/**
 * Генерация изображений через OpenAI (DALL-E 3)
 *
 * Поддерживает:
 *  - Генерацию по тексту (images/generations)
 *  - Генерацию на основе фото-референса (images/edits)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = 'dall-e-3';

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
// ВСПОМОГАТЕЛЬНЫЕ
// ======================================================================

/**
 * Конвертировать изображение в PNG (DALL-E 3 Edits требует PNG).
 */
function ensurePng(inputPath, outputDir) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.png') return inputPath;

  // Если это jpg/webp и т.д., конвертируем через ffmpeg или просто используем как есть
  // DALL-E 3 Edits принимает только PNG. Если не PNG — не сможем использовать edits.
  // Для простоты: пробуем прямой вызов, если не PNG — edits не сработает
  return inputPath;
}

// ======================================================================
// API ВЫЗОВЫ
// ======================================================================

/**
 * Вызов OpenAI API.
 */
function openaiApi(method, endpoint, body, isMultipart = false, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.openai.com/v1/${endpoint}`);
    const headers = {
      'Authorization': `Bearer ${API_KEY}`,
      ...extraHeaders
    };

    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname,
      headers,
      timeout: 300000
    };

    if (!isMultipart) {
      headers['Content-Type'] = 'application/json';
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`OpenAI API: ${parsed.error.message} (${parsed.error.type || ''})`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`OpenAI API parse error: ${data.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI API timeout (>5 min)')); });

    if (isMultipart) {
      // body already is a Buffer
      req.write(body);
    } else {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Сформировать multipart/form-data для edits endpoint.
 */
function buildEditMultipart(imagePath, prompt, size = '1024x1024') {
  const CRLF = '\r\n';
  const boundary = `----OpenAI${Date.now()}`;
  const imageData = fs.readFileSync(imagePath);
  const imageName = path.basename(imagePath);

  let body = '';
  body += `--${boundary}${CRLF}`;
  body += `Content-Disposition: form-data; name="image"; filename="${imageName}"${CRLF}`;
  body += `Content-Type: image/png${CRLF}${CRLF}`;

  const bodyParts = [
    Buffer.from(body, 'utf-8'),
    imageData,
    Buffer.from(`${CRLF}`, 'utf-8'),
    Buffer.from(`--${boundary}${CRLF}`, 'utf-8'),
    Buffer.from(`Content-Disposition: form-data; name="prompt"${CRLF}${CRLF}`, 'utf-8'),
    Buffer.from(prompt, 'utf-8'),
    Buffer.from(`${CRLF}`, 'utf-8'),
    Buffer.from(`--${boundary}${CRLF}`, 'utf-8'),
    Buffer.from(`Content-Disposition: form-data; name="model"${CRLF}${CRLF}`, 'utf-8'),
    Buffer.from(MODEL, 'utf-8'),
    Buffer.from(`${CRLF}`, 'utf-8'),
    Buffer.from(`--${boundary}${CRLF}`, 'utf-8'),
    Buffer.from(`Content-Disposition: form-data; name="n"${CRLF}${CRLF}`, 'utf-8'),
    Buffer.from('1', 'utf-8'),
    Buffer.from(`${CRLF}`, 'utf-8'),
    Buffer.from(`--${boundary}${CRLF}`, 'utf-8'),
    Buffer.from(`Content-Disposition: form-data; name="size"${CRLF}${CRLF}`, 'utf-8'),
    Buffer.from(size, 'utf-8'),
    Buffer.from(`${CRLF}`, 'utf-8'),
    Buffer.from(`--${boundary}--${CRLF}`, 'utf-8'),
  ];

  const totalBody = Buffer.concat(bodyParts);

  return {
    body: totalBody,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: totalBody.length
  };
}

/**
 * Скачать сгенерированное изображение по URL (DALL-E возвращает URL).
 */
function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`📥 OpenAI: скачиваю результат: ${url.slice(0, 80)}...`);
    https.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(outputPath, Buffer.concat(chunks));
        console.log(`✅ Скачано: ${outputPath}`);
        resolve(outputPath);
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Download timeout')); });
  });
}

// ======================================================================
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ======================================================================

/**
 * Загрузить фото (заглушка — OpenAI не требует отдельного API для загрузки).
 * Возвращает объект, совместимый с форматом Gemini.
 */
async function uploadPhoto(photoPath) {
  console.log(`📤 OpenAI: фото готово к использованию: ${photoPath}`);
  // OpenAI не использует File API, возвращаем путь как есть
  return { uri: photoPath, mimeType: getMimeType(photoPath) };
}

/**
 * Основная генерация: текст → изображение (без фото-референса).
 */
async function generateFromPrompt(prompt, outputDir, filenameBase = 'openai_generated', size = '1024x1024') {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`🎨 OpenAI: генерация по тексту`);
  console.log('📝 Промпт (первые 1000):', prompt.slice(0, 1000));

  const body = {
    model: MODEL,
    prompt,
    n: 1,
    size,
    quality: 'standard',
    response_format: 'b64_json'
  };

  try {
    const genResult = await openaiApi('POST', 'images/generations', body);
    const imageData = genResult.data?.[0];
    if (!imageData) throw new Error('OpenAI не вернул изображение');

    // b64_json или url
    let imgBuffer;
    if (imageData.b64_json) {
      imgBuffer = Buffer.from(imageData.b64_json, 'base64');
    } else if (imageData.url) {
      const ext = '.png';
      const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}${ext}`);
      await downloadImage(imageData.url, outputPath);
      return { path: outputPath, prompt };
    } else {
      throw new Error('OpenAI: нет изображения в ответе');
    }

    const ext = '.png';
    const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}${ext}`);
    fs.writeFileSync(outputPath, imgBuffer);
    const imgSizeKB = (imgBuffer.length / 1024).toFixed(1);
    console.log(`✅ OpenAI: готово ${outputPath} (${imgSizeKB} KB)`);
    return { path: outputPath, prompt };
  } catch (err) {
    console.error('❌ OpenAI generation error:', err.message);
    throw err;
  }
}

/**
 * Генерация на основе фото-референса (DALL-E 3 /images/edits).
 * @param {string} photoPath - путь к фото
 * @param {string} prompt - промпт со стилем
 * @param {string} outputDir - папка для результата
 * @param {string} [filenameBase] - префикс для файла
 * @param {string} [size] - размер '1024x1024' | '1792x1024' | '1024x1792'
 */
async function generateFromPhoto(photoPath, prompt, outputDir, filenameBase = 'openai_edit', size = '1024x1024') {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`🎨 OpenAI: генерация с фото-референсом`);
  console.log('📝 Промпт:', prompt.slice(0, 500));

  // DALL-E 3 Edits требует PNG
  let imgPath = photoPath;
  const ext = path.extname(photoPath).toLowerCase();
  if (ext !== '.png') {
    console.log('⚠️ OpenAI Edits требует PNG. Передаю как есть — может не сработать.');
    // Попробуем всё равно — API отклонит, если не подходит
  }

  const multipart = buildEditMultipart(imgPath, prompt, size);

  try {
    const genResult = await new Promise((resolve, reject) => {
      const url = new URL('https://api.openai.com/v1/images/edits');
      const headers = {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': multipart.contentType,
        'Content-Length': String(multipart.contentLength)
      };

      const req = https.request({
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        headers,
        timeout: 300000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`OpenAI API: ${parsed.error.message} (${parsed.error.type || ''})`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`OpenAI API parse error: ${data.slice(0, 300)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI API timeout')); });
      req.write(multipart.body);
      req.end();
    });

    const imageData = genResult.data?.[0];
    if (!imageData) throw new Error('OpenAI не вернул изображение');

    let imgBuffer;
    if (imageData.b64_json) {
      imgBuffer = Buffer.from(imageData.b64_json, 'base64');
    } else if (imageData.url) {
      const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}.png`);
      await downloadImage(imageData.url, outputPath);
      return { path: outputPath, prompt };
    } else {
      throw new Error('OpenAI: нет изображения в ответе');
    }

    const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}.png`);
    fs.writeFileSync(outputPath, imgBuffer);
    const imgSizeKB = (imgBuffer.length / 1024).toFixed(1);
    console.log(`✅ OpenAI: готово ${outputPath} (${imgSizeKB} KB)`);
    return { path: outputPath, prompt };
  } catch (err) {
    console.error('❌ OpenAI edit error:', err.message);
    throw err;
  }
}

module.exports = {
  uploadPhoto,
  generateFromPrompt,
  generateFromPhoto
};
