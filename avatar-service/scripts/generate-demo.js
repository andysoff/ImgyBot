#!/usr/bin/env node
/**
 * Генерация демо-сета для онбординга
 *
 * Берёт base_photo.png → загружает в Gemini File API → делает 3 стиля
 * Результат: demo/style_{id}.jpg
 */

const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');
const DEMO_DIR = path.join(BASE_DIR, 'demo');
const BASE_PHOTO = path.join(DEMO_DIR, 'base_photo.png');

if (!fs.existsSync(BASE_PHOTO)) {
  console.error('❌ base_photo.png не найден в demo/');
  process.exit(1);
}

const generateImage = require('./generate-image');

// 3 стиля — самые эффектные для демо
const STYLES_TO_GENERATE = [
  'cinema',   // 🎬 Кино
  'sport',    // ⚽ Спорт
  'in_car'    // 🚗 В машине
];

async function main() {
  console.log('📤 Загрузка base_photo в Gemini File API...');
  const fileInfo = await generateImage.uploadPhoto(BASE_PHOTO);
  console.log(`✅ Загружено: ${fileInfo.gemini.uri}`);

  const files = [fileInfo];

  for (const styleId of STYLES_TO_GENERATE) {
    console.log(`\n🎨 Генерация стиля: ${styleId}...`);
    try {
      const outputPath = await generateImage.generateAvatar(
        files,
        styleId,
        DEMO_DIR,
        { quality: 'premium', size: 'small' }
      );
      console.log(`✅ Сохранено: ${outputPath}`);
    } catch (err) {
      console.error(`❌ Ошибка генерации ${styleId}: ${err.message}`);
    }
  }

  console.log('\n🎉 Готово! Файлы в demo/:');
  const demoFiles = fs.readdirSync(DEMO_DIR);
  for (const f of demoFiles) {
    const stat = fs.statSync(path.join(DEMO_DIR, f));
    console.log(`  ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
