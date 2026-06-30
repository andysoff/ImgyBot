#!/usr/bin/env node
/**
 * file-upload.js — единая точка входа для загрузки фото к провайдерам
 *
 * Интерфейс:
 *   uploadToAll(photoPath)   → { gemini: {uri, name, mimeType} | null,
 *                                 openai: {dataUrl} | null }
 *   uploadToGemini(photoPath) → { uri, name, mimeType }
 *   uploadToOpenAI(photoPath) → { dataUrl }
 *
 * Ни одна из функций не пишет в базу, не лезет в sourceFiles.
 * Это работа вызывающего кода (bot-logic.js / bot-runner.js).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
// OPENAI — base64 на лету (без кэша)
// ======================================================================

/**
 * Закодировать фото в data URL для OpenAI.
 * Без кэша — читаем файл и кодируем каждый раз на лету.
 * @param {string} photoPath — путь к файлу на диске
 * @returns {Promise<{dataUrl: string}>}
 */
async function uploadToOpenAI(photoPath) {
  const mimeType = getMimeType(photoPath);
  const fileName = path.basename(photoPath);
  const stats = fs.statSync(photoPath);
  const fileSizeKB = (stats.size / 1024).toFixed(1);

  console.log(`📤 file-upload: OpenAI data URI — ${fileName} (${fileSizeKB} KB)`);

  const b64 = fs.readFileSync(photoPath).toString('base64');
  const dataUrl = `data:${mimeType};base64,${b64}`;
  const dataSizeKB = (Buffer.byteLength(dataUrl, 'utf-8') / 1024).toFixed(0);

  console.log(`✅ file-upload: OpenAI data URI готов (${dataSizeKB} KB)`);
  return { dataUrl };
}

// ======================================================================
// UPLOAD TO ALL
// ======================================================================

/**
 * Загрузить фото ко всем провайдерам параллельно.
 * Каждый провайдер независим — ошибка одного не влияет на других.
 * @param {string} photoPath — путь к файлу на диске
 * @returns {Promise<{
 *   gemini: {uri: string, name: string, mimeType: string} | null,
 *   openai: {dataUrl: string} | null
 * }>}
 */
async function uploadToAll(photoPath) {
  const [gemini, openai] = await Promise.allSettled([
    uploadToGemini(photoPath),
    uploadToOpenAI(photoPath),
  ]);

  if (gemini.status === 'rejected') {
    console.error(`⚠️ file-upload: Gemini upload failed — ${gemini.reason.message}`);
  }
  if (openai.status === 'rejected') {
    console.error(`⚠️ file-upload: OpenAI upload failed — ${openai.reason.message}`);
  }

  return {
    gemini: gemini.status === 'fulfilled' ? gemini.value : null,
    openai: openai.status === 'fulfilled' ? openai.value : null,
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
        if (r.openai) console.log(`OpenAI URI:  ${r.openai.dataUrl.slice(0, 60)}...`);
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
  uploadToOpenAI,
  uploadToAll,
};
