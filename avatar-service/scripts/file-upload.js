#!/usr/bin/env node
/**
 * file-upload.js — единая точка входа для загрузки фото к провайдерам
 *
 * Интерфейс:
 *   uploadToAll(photoPath)           → { gemini: {...} | null, openai: {fileId} | null }
 *   uploadToGemini(photoPath)        → { uri, name, mimeType }
 *   uploadToOpenAIFileApi(photoPath) → { fileId }
 *   photoToBase64(photoPath)         → { dataUrl }
 *
 * Ни одна из функций не пишет в базу, не лезет в sourceFiles.
 * Это работа вызывающего кода (bot-logic.js / bot-runner.js).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ======================================================================
// ВСПОМОГАТЕЛЬНЫЕ
// ======================================================================

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
  };
  return mimeMap[ext] || 'image/jpeg';
}

// ======================================================================
// GEMINI FILE API
// ======================================================================

/**
 * Загрузить фото в Gemini File API (resumable upload).
 * @param {string} photoPath — путь к файлу на диске
 * @returns {Promise<{uri: string, name: string, mimeType: string}>}
 */
async function uploadToGemini(photoPath) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY не задан');

  const stats = fs.statSync(photoPath);
  const mimeType = getMimeType(photoPath);
  const fileName = path.basename(photoPath);

  const startTime = Date.now();
  const fileSizeKB = (stats.size / 1024).toFixed(1);
  console.log(`📤 file-upload: Gemini File API — ${fileName} (${fileSizeKB} KB)`);

  // === Шаг 1: инициализация resumable upload ===
  const initUrl = new URL('https://generativelanguage.googleapis.com/upload/v1beta/files');
  initUrl.searchParams.set('key', GEMINI_API_KEY);

  const { uploadUrl } = await new Promise((resolve, reject) => {
    const req = https.request(
      initUrl,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(stats.size),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
      (res) => {
        const uploadUrl = res.headers['x-goog-upload-url'];
        if (!uploadUrl) {
          let data = '';
          res.on('data', c => (data += c));
          res.on('end', () => reject(new Error(`Gemini File API init failed: ${data.slice(0, 200)}`)));
          return;
        }
        resolve({ uploadUrl });
      },
    );
    req.write(JSON.stringify({ file: { displayName: fileName } }));
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini File API init timeout')); });
    req.end();
  });

  // === Шаг 2: загрузка тела файла ===
  const fileData = fs.readFileSync(photoPath);
  const fileInfo = await new Promise((resolve, reject) => {
    const req = https.request(
      uploadUrl,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
          'Content-Length': String(fileData.length),
          'Content-Type': mimeType,
        },
        timeout: 60000,
      },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`Gemini File API upload error: ${JSON.stringify(parsed.error)}`));
            } else if (parsed.file) {
              resolve(parsed.file);
            } else {
              reject(new Error(`Gemini File API: unexpected response: ${data.slice(0, 300)}`));
            }
          } catch {
            reject(new Error(`Gemini File API parse error: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini File API upload timeout')); });
    req.write(fileData);
    req.end();
  });

  const duration = Date.now() - startTime;
  console.log(`✅ file-upload: Gemini URI — ${fileInfo.uri || fileInfo.name} (${duration}ms)`);
  return { uri: fileInfo.uri, name: fileInfo.name, mimeType };
}

// ======================================================================
// OPENAI FILE API (multipart upload — без внешних зависимостей)
// ======================================================================

/**
 * Загрузить фото в OpenAI File API (/v1/files).
 * Возвращает file_id для использования в /v1/images/edits или /v1/images/generations.
 * @param {string} photoPath — путь к файлу на диске
 * @returns {Promise<{fileId: string}>}
 */
async function uploadToOpenAIFileApi(photoPath) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY не задан');
  if (!fs.existsSync(photoPath)) throw new Error(`File not found: ${photoPath}`);

  const boundary = '----OpenAIFormBoundary' + Math.random().toString(36).slice(2);
  const filename = path.basename(photoPath);
  const mime = getMimeType(photoPath);
  const fileData = fs.readFileSync(photoPath);

  const fileSizeKB = (fileData.length / 1024).toFixed(0);
  console.log(`📤 file-upload: OpenAI File API — ${filename} (${fileSizeKB} KB)`);

  // Собираем multipart body
  const headerPart = `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="purpose"\r\n\r\n' +
    'user_data\r\n' +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n`;
  const footerPart = `\r\n--${boundary}--\r\n`;
  const headerBuf = Buffer.from(headerPart, 'utf-8');
  const footerBuf = Buffer.from(footerPart, 'utf-8');
  const fullBody = Buffer.concat([headerBuf, fileData, footerBuf]);

  const fileId = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/files',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': fullBody.length,
        },
        timeout: 120000,
      },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`OpenAI File API: ${parsed.error.message} (${parsed.error.type || ''})`));
            } else if (parsed.id) {
              resolve(parsed.id);
            } else {
              reject(new Error(`OpenAI File API: unexpected response: ${data.slice(0, 300)}`));
            }
          } catch {
            reject(new Error(`OpenAI File API parse error: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', err => reject(new Error(`OpenAI File API error: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI File API timeout (>2 min)')); });
    req.write(fullBody);
    req.end();
  });

  console.log(`✅ file-upload: OpenAI File ID — ${fileId}`);
  return { fileId };
}

/**
 * Проверить, жив ли файл в OpenAI File API.
 * @param {string} fileId — OpenAI file ID
 * @returns {Promise<boolean>}
 */
async function verifyOpenAIFile(fileId) {
  if (!OPENAI_API_KEY) return false;
  if (!fileId) return false;
  try {
    const result = await new Promise((resolve, reject) => {
      https.get(
        {
          hostname: 'api.openai.com',
          path: `/v1/files/${fileId}`,
          headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', c => (data += c));
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
          });
        }
      ).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
    });
    if (result.error) {
      console.warn(`⚠️ OpenAI File ${fileId} невалиден: ${result.error.message}`);
      return false;
    }
    const valid = result.status === 'processed' || result.status === 'uploaded';
    if (!valid) console.warn(`⚠️ OpenAI File ${fileId} имеет статус ${result.status}`);
    return valid;
  } catch (err) {
    console.warn(`⚠️ Ошибка проверки OpenAI File ${fileId}: ${err.message}`);
    return false;
  }
}

// ======================================================================
// OPENAI — base64 на лету (fallback, если нет file ID)
// ======================================================================

/**
 * Закодировать фото в data URL (base64) для OpenAI.
 * Используется как fallback, если File API недоступен.
 * @param {string} photoPath — путь к файлу на диске
 * @returns {Promise<{dataUrl: string}>}
 */
async function photoToBase64(photoPath) {
  const mimeType = getMimeType(photoPath);
  const fileName = path.basename(photoPath);
  const stats = fs.statSync(photoPath);
  const fileSizeKB = (stats.size / 1024).toFixed(1);

  console.log(`📤 file-upload: OpenAI base64 — ${fileName} (${fileSizeKB} KB)`);

  const b64 = fs.readFileSync(photoPath).toString('base64');
  const dataUrl = `data:${mimeType};base64,${b64}`;
  const dataSizeKB = (Buffer.byteLength(dataUrl, 'utf-8') / 1024).toFixed(0);

  console.log(`✅ file-upload: OpenAI base64 готов (${dataSizeKB} KB)`);
  return { dataUrl };
}

// ======================================================================
// UPLOAD TO ALL
// ======================================================================

/**
 * Загрузить фото ко всем провайдерам параллельно.
 * Gemini → File API, OpenAI → File API (с fallback на base64).
 * @param {string} photoPath — путь к файлу на диске
 * @returns {Promise<{
 *   gemini: {uri: string, name: string, mimeType: string} | null,
 *   openai: {fileId: string} | {dataUrl: string} | null
 * }>}
 */
async function uploadToAll(photoPath) {
  const [gemini, openai] = await Promise.allSettled([
    uploadToGemini(photoPath),
    uploadToOpenAIFileApi(photoPath).catch(() => photoToBase64(photoPath)),
  ]);

  if (gemini.status === 'rejected') {
    console.error(`⚠️ file-upload: Gemini upload failed — ${gemini.reason.message}`);
  }

  let openaiResult = null;
  if (openai.status === 'fulfilled') {
    openaiResult = openai.value;
  } else {
    console.error(`⚠️ file-upload: OpenAI upload failed — ${openai.reason.message}`);
  }

  return {
    gemini: gemini.status === 'fulfilled' ? gemini.value : null,
    openai: openaiResult,
  };
}

// ======================================================================
// CLI
// ======================================================================

if (require.main === module) {
  const [, , cmd, ...args] = process.argv;
  if (cmd === 'upload') {
    const photoPath = args[0];
    if (!photoPath) {
      console.log('Использование: node scripts/file-upload.js upload <photoPath>');
      process.exit(1);
    }
    uploadToAll(photoPath)
      .then(r => {
        console.log('');
        console.log('=== Результат ===');
        if (r.gemini) console.log(`Gemini URI:  ${r.gemini.uri}`);
        if (r.openai?.fileId) console.log(`OpenAI file_id: ${r.openai.fileId}`);
        else if (r.openai?.dataUrl) console.log(`OpenAI data URI: ${r.openai.dataUrl.slice(0, 60)}...`);
        process.exit(0);
      })
      .catch(err => { console.error('❌', err.message); process.exit(1); });
  } else {
    console.log('Использование: node scripts/file-upload.js upload <photoPath>');
    process.exit(1);
  }
}

module.exports = {
  uploadToGemini,
  uploadToOpenAIFileApi,
  photoToBase64,
  verifyOpenAIFile,
  uploadToAll,
};
