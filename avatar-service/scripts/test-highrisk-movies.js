#!/usr/bin/env node
/**
 * Выборочный тест высокорискованных фильмов после чистки промптов.
 */
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const OUTPUT = path.join(BASE, 'photos', 'test_highrisk');
const PHOTO = path.join(BASE, 'photos', 'user_3', 'avatar_6', 'photo_1.jpg');

const gen = require('./generate-image');

const HIGH_RISK_MOVIES = [
  // 🔴 Прямое оружие
  { title: 'Убить Билла', titleEn: 'Kill Bill', year: 2003,
    prompt: 'martial arts aesthetic, yellow and black tracksuit, anime-inspired style, Tarantino mix of Japanese and spaghetti western' },
  { title: 'Семь самураев', titleEn: 'Seven Samurai', year: 1954,
    prompt: 'samurai epic aesthetic, traditional kimono, feudal Japan countryside, black and white photography, Kurosawa dramatic style' },
  { title: 'Дуэлянт', titleEn: 'The Duelist', year: 2016,
    prompt: '19th century St. Petersburg aesthetic, elegant nobility attire, foggy capital, stylish period drama style' },

  // 🔴 Нацизм / Холокост
  { title: 'Жизнь прекрасна', titleEn: 'Life Is Beautiful', year: 1997,
    prompt: 'Italian 1930s period drama aesthetic, 1930s period suit, vintage striped uniform, bittersweet warm tone, Benigni emotional style' },
  { title: 'Список Шиндлера', titleEn: 'Schindler\'s List', year: 1993,
    prompt: '1940s period drama aesthetic, 1940s period clothing, black and white photography, muted tones with red accent, Spielberg emotional style' },
  { title: 'Семнадцать мгновений весны', titleEn: 'Seventeen Moments of Spring', year: 1973,
    prompt: 'WWII spy thriller aesthetic, 1940s German trench coat, wartime Berlin, dark offices, Lioznova tense espionage style' },

  // 🔴 Психологический хоррор
  { title: 'Психо', titleEn: 'Psycho', year: 1960,
    prompt: 'Hitchcock suspense aesthetic, 1950s attire, dark motel setting, black and white photography, gothic atmosphere' },
  { title: 'Молчание ягнят', titleEn: 'The Silence of the Lambs', year: 1991,
    prompt: 'psychological thriller aesthetic, FBI agent look, dark interrogation room, greenish dim lighting, tense Demme style' },

  // 🔴 Терроризм / культура
  { title: 'V — значит вендетта', titleEn: 'V for Vendetta', year: 2005,
    prompt: 'dystopian aesthetic, theatrical mask and dark trench coat, London Parliament backdrop, rainy night, dark red and black palette' },

  // 🔴 Война
  { title: 'Спасти рядового Райана', titleEn: 'Saving Private Ryan', year: 1998,
    prompt: 'WWII period epic aesthetic, soldier uniform, gritty worn look, muted desaturated colors, Spielberg cinematic style' },
  { title: 'Апокалипсис сегодня', titleEn: 'Apocalypse Now', year: 1979,
    prompt: 'Vietnam era 1970s aesthetic, army-style jacket, helicopter backdrop, orange dramatic sky, intense atmosphere, Coppola epic psychological style' },
  { title: 'Сталинград', titleEn: 'Stalingrad', year: 2013,
    prompt: 'WWII period aesthetic, Soviet soldier uniform, ruined Stalingrad city, mud and smoke, Bondarchuk historical epic style' },
];

async function main() {
  console.log('🎬 Выборочный тест высокорискованных фильмов\n');
  console.log(`📸 Тестовое фото: ${PHOTO}\n`);

  const file = await gen.uploadPhoto(PHOTO);
  console.log(`✅ Фото загружено: ${file.gemini.uri}\n`);

  const settings = {
    model: 'gemini-3.1-flash-image-preview',
    quality: 'standard'
  };

  const results = [];

  for (const movie of HIGH_RISK_MOVIES) {
    const label = `${movie.title} (${movie.year})`;
    console.log(`${'='.repeat(60)}`);
    console.log(`🎬  ${label}...`);
    console.log(`${'='.repeat(60)}`);

    try {
      const result = await gen.generateCinemaAvatar(
        [file], movie, OUTPUT, settings, null
      );
      console.log(`  ✅ УСПЕХ: ${result.path}\n`);
      results.push({ movie: movie.title, status: '✅ SUCCESS', path: result.path });
    } catch (err) {
      const msg = err.message || String(err);
      // Пробуем вытащить safety rating
      let reason = msg;
      if (msg.includes('NO_IMAGE') || msg.includes('safety') || msg.includes('blocked')) {
        reason = '⛔ БЛОКИРОВКА';
      }
      console.log(`  ❌ ${reason}: ${msg.slice(0, 200)}\n`);
      results.push({ movie: movie.title, status: '❌ FAIL', error: reason });
    }
  }

  // Итоги
  console.log('\n' + '═'.repeat(60));
  console.log('📊 ИТОГИ ТЕСТА');
  console.log('═'.repeat(60));

  const succeeded = results.filter(r => r.status === '✅ SUCCESS').length;
  const failed = results.filter(r => r.status === '❌ FAIL').length;

  for (const r of results) {
    console.log(`  ${r.status}  ${r.movie}${r.error && r.error !== '⛔ БЛОКИРОВКА' ? ': ' + r.error : ''}`);
  }

  console.log(`\n📊 Результат: ✅ ${succeeded} / ❌ ${failed} из ${results.length}`);

  if (failed > 0) {
    console.log('\n⚠️ Есть падения — нужно смотреть логи.');
    process.exit(1);
  }

  console.log('\n🎉 Все высокорискованные фильмы прошли!');
}

main().catch(err => {
  console.error('💥 Критическая ошибка:', err);
  process.exit(2);
});
