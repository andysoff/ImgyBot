#!/usr/bin/env node
/**
 * Генерация изображений через OpenAI
 *
 * Поддерживает:
 *  - gpt-image-1.5 — генерация по тексту (generations) + с фото-референсом (edits)
 *  - gpt-image-2 — генерация по тексту (generations) + с фото-референсом (Responses API)
 *
 * OpenAI API reference:
 *  - POST /v1/images/generations → создание с нуля
 *  - POST /v1/images/edits → редактирование по фото (gpt-image-1.5, gpt-image-1, gpt-image-1-mini)
 *  - POST /v1/responses → генерация с фото-референсом (gpt-image-2)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = 'gpt-image-1.5';

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
  const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}.png`);
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
 * Генерация по тексту (без фото-референса).
 * Работает для gpt-image-1.5 и gpt-image-2.
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

  // sizeOrConfig — строка для v1.5, строка для v2
  if (typeof sizeOrConfig === 'string') {
    body.size = sizeOrConfig;
  } else if (typeof sizeOrConfig === 'object') {
    body.size = sizeOrConfig.size || '1024x1024';
  } else {
    body.size = '1024x1024';
  }

  const result = await dalleGeneration(body);
  const imgBuffer = await extractImage(result);
  const outputPath = saveImage(imgBuffer, outputDir, filenameBase);
  return { path: outputPath, prompt };
}

/**
 * Генерация с фото-референсом.
 * Поддерживается только для gpt-image-1.5 (через /v1/images/edits).
 * gpt-image-2 НЕ поддерживает edit endpoint в Image API (нужен Responses API).
 */
async function generateFromPhoto(photoPath, prompt, outputDir, filenameBase = 'openai_photo', sizeOrConfig = '1024x1024', model = DEFAULT_MODEL) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  if (!fs.existsSync(photoPath)) throw new Error(`Фото не найдено: ${photoPath}`);

  const b64 = imageToBase64(photoPath);
  const mime = getMimeType(photoPath);
  const dataUri = `data:${mime};base64,${b64}`;

  console.log(`🎨 OpenAI ${model}: генерация с фото-референсом (edits)`);
  console.log('📝 Стиль-промпт (первые 300):', prompt.slice(0, 300));

  const body = {
    model,
    prompt,
    images: [{ image_url: dataUri }],
    input_fidelity: 'high',
    n: 1
  };

  // edits поддерживает только фиксированные размеры
  if (typeof sizeOrConfig === 'string') {
    body.size = sizeOrConfig;
  } else if (typeof sizeOrConfig === 'object') {
    // Для edits доступны только: auto, 1024x1024, 1536x1024, 1024x1536
    body.size = sizeOrConfig.size || '1024x1024';
  } else {
    body.size = '1024x1024';
  }

  const result = await dalleEdit(body);
  const imgBuffer = await extractImage(result);
  const outputPath = saveImage(imgBuffer, outputDir, filenameBase);
  return { path: outputPath, prompt };
}

// ======================================================================
// GPT-IMAGE-2 ЧЕРЕЗ RESPONSES API (с фото-референсом)
// ======================================================================

/**
 * Универсальный вызов Responses API.
 */
function responsesApiCall(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/responses',
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
              reject(new Error(`OpenAI Responses API: ${parsed.error.message} (${parsed.error.type || ''})`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`OpenAI Responses API parse error: ${data.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI Responses API timeout (>5 min)')); });
    req.write(payload);
    req.end();
  });
}

/**
 * Извлечь изображение из ответа Responses API.
 * Responses API возвращает output-массив, где image_generation_call содержит сгенерированное изображение.
 */
function extractImageFromResponse(response) {
  const output = response.output || [];

  for (const item of output) {
    // Новый формат: type: "image_generation_call", output.image
    if (item.type === 'image_generation_call' && item.output?.image) {
      const img = item.output.image;
      if (img.b64_json) {
        return Buffer.from(img.b64_json, 'base64');
      }
      if (img.url) {
        return downloadImage(img.url);
      }
    }

    // Альтернативный формат: type: "content" с inline_data
    if (item.type === 'content' && item.content) {
      for (const part of item.content) {
        if (part.type === 'inline_data' && part.inline_data) {
          const { mime_type, data } = part.inline_data;
          if (data) {
            return Buffer.from(data, 'base64');
          }
        }
      }
    }

    // Формат через message с image_url
    if (item.type === 'message' && item.content) {
      for (const part of item.content) {
        if (part.type === 'image_url' && part.image_url?.url) {
          return downloadImage(part.image_url.url);
        }
      }
    }
  }

  // Fallback: проверяем response.data (массив как в generations)
  if (response.data?.[0]?.b64_json) {
    return Buffer.from(response.data[0].b64_json, 'base64');
  }
  if (response.data?.[0]?.url) {
    return downloadImage(response.data[0].url);
  }

  throw new Error('OpenAI Responses API не вернул изображение. Ответ (первые 1000): ' + JSON.stringify(response).slice(0, 1000));
}

/**
 * Генерация с фото-референсом через Responses API (gpt-image-2).
 * В отличие от edits, Responses API поддерживает input_image для gpt-image-2.
 */
async function generateFromPhotoV2(photoPath, prompt, outputDir, filenameBase = 'openai_v2_photo', sizeConfig = '1024x1024', model = 'gpt-image-2') {
  if (!API_KEY) throw new Error('OPENAI_API_KEY не задан');
  if (!fs.existsSync(photoPath)) throw new Error(`Фото не найдено: ${photoPath}`);

  const b64 = imageToBase64(photoPath);
  const mime = getMimeType(photoPath);
  const dataUri = `data:${mime};base64,${b64}`;

  console.log(`🎨 OpenAI ${model}: генерация с фото-референсом (Responses API)`);
  console.log('📝 Стиль-промпт (первые 300):', prompt.slice(0, 300));

  // sizeConfig может быть строкой ('1024x1024') или объектом ({size: '1024x1024', resolution: '1K'})
  const resolution = typeof sizeConfig === 'string' ? sizeConfig : (sizeConfig.size || '1024x1024');

  const body = {
    model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: dataUri,
            detail: 'high'
          },
          {
            type: 'input_text',
            text: prompt
          }
        ]
      }
    ],
    tools: [
      {
        type: 'image_generation',
        resolution
      }
    ],
    include: ['image_generation_call.output']
  };

  const result = await responsesApiCall(body);
  const imgBuffer = await extractImageFromResponse(result);
  const outputPath = saveImage(imgBuffer, outputDir, filenameBase);
  return { path: outputPath, prompt };
}

module.exports = {
  uploadPhoto,
  generateFromPrompt,
  generateFromPhoto,
  generateFromPhotoV2,
  SIZE_MAP,
  SIZE_MAP_V2
};
