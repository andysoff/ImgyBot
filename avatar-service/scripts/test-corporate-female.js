#!/usr/bin/env node
/**
 * Тест корпоративных стилей для аватара Девушка (avatar_6).
 * Проверяет, что для female используются женские промпты (блузка + юбка, без галстука/брюк).
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'photos', 'test_corporate_female');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const generateImage = require(path.join(__dirname, 'generate-image.js'));
const settings = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'settings.json'), 'utf-8'));

const CORPORATE_STYLES = [
  'portrait_corporate_dark',
  'portrait_corporate_light',
  'portrait_corporate_office',
  'portrait_corporate_bw',
  'portrait_corporate_chair'
];

async function main() {
  // Загружаем фото свежим URI (старый мог протухнуть)
  const photo = path.join(PROJECT_ROOT, 'photos', 'user_3', 'avatar_6', 'photo_1.jpg');
  console.log('📤 Загружаю фото в Gemini...');
  const fileData = await generateImage.uploadPhoto(photo);
  const files = [fileData];
  const gender = 'female';
  console.log(`📸 Аватар: Девушка (avatar_6)`);
  console.log(`🔍 Пол: ${gender}`);
  console.log(`📁 Результаты: ${OUTPUT_DIR}`);
  console.log('');

  for (const styleId of CORPORATE_STYLES) {
    console.log('='.repeat(70));
    const stylePrompt = generateImage.STYLE_PROMPTS[styleId] || '(нет)';
    const femalePrompt = generateImage.STYLE_PROMPTS_FEMALE[styleId] || '(нет)';

    console.log(`🎨 Стиль: ${styleId}`);
    console.log(`   Мужской промпт: ${stylePrompt.slice(0, 120)}...`);
    console.log(`   Женский промпт:  ${femalePrompt.slice(0, 120)}...`);

    try {
      const result = await generateImage.generateAvatar(
        files,
        styleId,
        OUTPUT_DIR,
        { ...settings, quality: 'standard' },
        `test_female_${styleId}`,
        gender
      );
      console.log(`✅ Готово: ${result.path}`);
      console.log(`   Использован промпт (первые 200): ${result.prompt.slice(0, 200)}...`);
    } catch (e) {
      console.error(`❌ Ошибка: ${e.message}`);
    }
    console.log('');
  }

  console.log('='.repeat(70));
  console.log('✅ Все генерации завершены!');
  console.log(`   Файлы в: ${OUTPUT_DIR}`);
}

main().catch(e => {
  console.error('❌ Критическая ошибка:', e);
  process.exit(1);
});
