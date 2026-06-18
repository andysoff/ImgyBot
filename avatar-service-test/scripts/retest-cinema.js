#!/usr/bin/env node
/**
 * Ретест фильмов, которые падали с NO_IMAGE на gemini-2.5-flash-image.
 * Используем gemini-3.1-flash-image-preview.
 */
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const OUTPUT = path.join(BASE, 'photos', 'test_output_cinema');
const PHOTO = path.join(BASE, 'photos', 'user_3', 'avatar_6', 'photo_1.jpg');

const gen = require('./generate-image');

// Фильмы для ретеста (те, что падали с NO_IMAGE)
const MOVIES_TO_RETEST = [
  { title: 'Оппенгеймер', titleEn: 'Oppenheimer', year: 2023,
    prompt: 'cinematic portrait with dramatic shadows, 1940s suit and hat, desert landscape backdrop, high contrast lighting, professional photography style' },
  { title: 'Чужие', titleEn: 'Aliens', year: 1986,
    prompt: 'sci-fi film aesthetic, dark industrial setting, blue emergency lighting, futuristic gear, cinematic high-contrast portrait' },
  { title: 'Прислуга', titleEn: 'The Help', year: 2011,
    prompt: '1960s southern drama aesthetic, vintage pastel dress, warm kitchen lighting, nostalgic period portrait, heartfelt atmosphere' },
  { title: 'Рокки', titleEn: 'Rocky', year: 1976,
    prompt: 'sports drama aesthetic, grey sweatshirt, urban streets at golden hour, gritty 70s style, motivational atmosphere' },
  { title: 'Американская история X', titleEn: 'American History X', year: 1998,
    prompt: 'black and white dramatic aesthetic, late 90s California style, leather jacket, striking contrast photography, intense cinematic portrait, beach atmosphere' }
];

async function main() {
  console.log('🎬 Ретест киногенераций с gemini-3.1-flash-image-preview\n');

  // Загружаем фото в Gemini File API
  console.log('📤 Загружаем тестовое фото...');
  const file = await gen.uploadPhoto(PHOTO);
  console.log(`✅ Фото загружено: ${file.uri}\n`);

  const settings = {
    model: 'gemini-3.1-flash-image-preview',
    quality: 'standard'
  };

  const results = [];

  for (const movie of MOVIES_TO_RETEST) {
    const label = `${movie.title} (${movie.year})`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎬 Тест ${label}...`);
    console.log('='.repeat(60));

    try {
      const result = await gen.generateCinemaAvatar(
        [file], movie, OUTPUT, settings, null
      );
      console.log(`✅ ${label} — УСПЕХ: ${result.path}`);
      results.push({ movie: movie.title, status: '✅ SUCCESS', path: result.path });
    } catch (err) {
      console.log(`❌ ${label} — ОШИБКА: ${err.message}`);
      results.push({ movie: movie.title, status: '❌ FAIL', error: err.message });
    }
  }

  // Итоги
  console.log('\n' + '='.repeat(60));
  console.log('📊 РЕЗУЛЬТАТЫ РЕТЕСТА');
  console.log('='.repeat(60));
  const succeeded = results.filter(r => r.status === '✅ SUCCESS').length;
  const failed = results.filter(r => r.status === '❌ FAIL').length;

  for (const r of results) {
    console.log(`  ${r.status}  ${r.movie}${r.error ? ': ' + r.error : ''}`);
  }
  console.log(`\nИтого: ✅ ${succeeded} / ❌ ${failed} из ${results.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('💥 Критическая ошибка:', err);
  process.exit(2);
});
