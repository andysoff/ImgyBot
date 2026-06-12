#!/usr/bin/env node
/**
 * Тест генераций — через реальный Gemini API с загрузкой фото.
 *
 * Тестирует:
 * 1. Стиль Ретро (retro_gatsby) — с загруженным фото
 * 2. Свободный промпт (generateCustomAvatar) — с загруженным фото
 * 3. Без фото, только промпт (generateNoAvatarCustom)
 * 4. Локация (location) — с загруженным фото, full_body
 *
 * Запуск: node scripts/test-generations.js
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = __dirname;
const PHOTOS_DIR = path.join(PROJECT_ROOT, 'photos');
const OUTPUT_DIR = path.join(PHOTOS_DIR, 'test_output');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const generateImage = require(path.join(SCRIPTS_DIR, 'generate-image.js'));
const settings = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'settings.json'), 'utf-8'));

function findTestPhoto() {
  // Используем фото Андрея (user_3)
  const dir = path.join(PHOTOS_DIR, 'user_3', 'avatar_4');
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg'));
    if (files.length > 0) return path.join(dir, files[0]);
  }
  return null;
}

async function main() {
  const testPhoto = findTestPhoto();
  if (!testPhoto) {
    console.error('❌ Не найдено тестовое фото');
    process.exit(1);
  }
  console.log(`📸 Тестовое фото: ${testPhoto}`);
  console.log(`📁 Результаты: ${OUTPUT_DIR}`);
  console.log('');

  // ===== Загружаем фото в Gemini File API =====
  console.log('='.repeat(70));
  console.log('📤 Загрузка тестового фото в Gemini File API...');
  console.log('='.repeat(70));
  let fileData;
  try {
    fileData = await generateImage.uploadPhoto(testPhoto);
    console.log(`✅ Фото загружено: ${fileData.uri}`);
  } catch (e) {
    console.error(`❌ Ошибка загрузки: ${e.message}`);
    console.log('   Продолжаем тесты без фото (только тест 3)...');
  }
  console.log('');

  // ========== ТЕСТ 1: Стиль Ретро → 1920-е / Гэтсби ==========
  if (fileData) {
    console.log('='.repeat(70));
    console.log('🧪 ТЕСТ 1: Стиль Ретро → 1920-е / Гэтсби');
    console.log('   Режим: с фото, portraitType=headshot, faceTurn=front');
    console.log('='.repeat(70));

    try {
      const testSettings = {
        ...settings,
        portraitType: 'headshot',
        faceTurn: 'front',
        quality: 'standard'
      };
      const result = await generateImage.generateAvatar(
        [fileData],
        'retro_gatsby',
        OUTPUT_DIR,
        testSettings,
        'test_retro_gatsby'
      );
      console.log(`✅ УСПЕХ: ${result.path}`);
      console.log(`   Промпт: ${result.prompt.slice(0, 200)}...`);
    } catch (e) {
      console.error(`❌ ОШИБКА: ${e.message}`);
    }
    console.log('');
  }

  // ========== ТЕСТ 2: Свободный промпт с фото ==========
  if (fileData) {
    console.log('='.repeat(70));
    console.log('🧪 ТЕСТ 2: Свободный промпт с фото');
    console.log('   Режим: customize, full_body, faceTurn=three_quarter');
    console.log('   Промпт: киберпанк Токио');
    console.log('='.repeat(70));

    try {
      const result = await generateImage.generateCustomAvatar(
        [fileData],
        'cyberpunk Tokyo at night in the rain, neon lights reflection on wet pavement, person holding a transparent umbrella, blade runner aesthetic, dark blue and pink color palette, futuristic city atmosphere',
        OUTPUT_DIR,
        { ...settings, portraitType: 'full_body', faceTurn: 'three_quarter', quality: 'standard' },
        'test_custom_prompt'
      );
      console.log(`✅ УСПЕХ: ${result.path}`);
      console.log(`   Промпт: ${result.prompt.slice(0, 200)}...`);
    } catch (e) {
      console.error(`❌ ОШИБКА: ${e.message}`);
    }
    console.log('');
  }

  // ========== ТЕСТ 3: Без фото, только промпт ==========
  console.log('='.repeat(70));
  console.log('🧪 ТЕСТ 3: Без фото, только промпт');
  console.log('   Режим: без аватара, без фото');
  console.log('='.repeat(70));

  try {
    const result = await generateImage.generateNoAvatarCustom(
      'A cinematic portrait of a person in an elegant black suit, dramatic studio lighting, blue tint, professional fashion photography, high quality, realistic photo',
      OUTPUT_DIR,
      { ...settings, quality: 'standard' },
      'test_no_avatar'
    );
    console.log(`✅ УСПЕХ: ${result.path}`);
    console.log(`   Промпт: ${result.prompt.slice(0, 200)}...`);
  } catch (e) {
    console.error(`❌ ОШИБКА: ${e.message}`);
  }
  console.log('');

  // ========== ТЕСТ 4: Стиль Локация ==========
  if (fileData) {
    console.log('='.repeat(70));
    console.log('🧪 ТЕСТ 4: Стиль Локация → Санторини');
    console.log('   Режим: с фото, full_body, faceTurn=three_quarter');
    console.log('='.repeat(70));

    try {
      const location = { id: 'santorini', name: '🏝️ Санторини', prompt: 'person in Santorini, Greece, white and blue buildings, caldera view, Aegean Sea, sunset' };
      const result = await generateImage.generateLocationAvatar(
        [fileData],
        location,
        OUTPUT_DIR,
        { ...settings, portraitType: 'full_body', faceTurn: 'three_quarter', quality: 'standard' },
        'test_location'
      );
      console.log(`✅ УСПЕХ: ${result.path}`);
      console.log(`   Промпт: ${result.prompt.slice(0, 200)}...`);
    } catch (e) {
      console.error(`❌ ОШИБКА: ${e.message}`);
    }
    console.log('');
  }

  // ========== ИТОГИ ==========
  console.log('='.repeat(70));
  console.log('🏁 Тест завершён');
  console.log(`📁 Результаты:`);
  const results = fs.readdirSync(OUTPUT_DIR);
  results.forEach(f => {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f));
    const size = (stat.size / 1024).toFixed(1);
    console.log(`   - ${f} (${size} KB)`);
  });
}

main().catch(e => {
  console.error('❌ Фатальная ошибка:', e);
  process.exit(1);
});
