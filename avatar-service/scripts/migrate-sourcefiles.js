#!/usr/bin/env node
/**
 * Миграция avatars.json: geminiFiles → sourceFiles
 *
 * Старая структура:
 *   "geminiFiles": [{ "uri": "...", "mimeType": "...", "localPath": "...", "openaiFileId": "file-..." }]
 *
 * Новая структура:
 *   "sourceFiles": [{ "localPath": "...", "mimeType": "...", "gemini": { "uri": "..." }, "openai": { "fileId": "file-..." } }]
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AVATARS_FILE = path.join(DATA_DIR, 'avatars.json');

if (!fs.existsSync(AVATARS_FILE)) {
  console.error('❌ avatars.json не найден:', AVATARS_FILE);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(AVATARS_FILE, 'utf-8'));
let migrated = 0;

for (const avatar of data) {
  if (!avatar.geminiFiles) continue;
  
  const newFiles = [];
  for (const f of avatar.geminiFiles) {
    const newFile = {
      localPath: f.localPath || '',
      mimeType: f.mimeType || 'image/jpeg',
      gemini: { uri: f.uri || '' }
    };
    if (f.openaiFileId) {
      newFile.openai = { fileId: f.openaiFileId };
    }
    newFiles.push(newFile);
  }

  avatar.sourceFiles = newFiles;
  delete avatar.geminiFiles;
  migrated++;
}

fs.writeFileSync(AVATARS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
console.log(`✅ Миграция завершена: ${migrated} аватаров обновлено`);
console.log(`   Файл: ${AVATARS_FILE}`);
