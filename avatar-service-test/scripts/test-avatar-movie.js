#!/usr/bin/env node
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const OUTPUT = path.join(BASE, 'photos', 'test_avatar_v2');
const PHOTO = path.join(BASE, 'photos', 'user_3', 'avatar_6', 'photo_1.jpg');
const gen = require('./generate-image');

const AVATAR_MOVIE = {
  title: 'Аватар',
  titleEn: 'Avatar',
  year: 2009,
  prompt: 'sci-fi fantasy bioluminescent jungle, floating mountains in alien world, mystical glowing plants, lush tropical paradise, James Cameron epic adventure style'
};

async function main() {
  console.log('🎬 Аватар — с упоминанием фильма, без blue skin / navi\n');
  const file = await gen.uploadPhoto(PHOTO);
  console.log(`✅ Фото загружено\n`);
  const settings = { model: 'gemini-3.1-flash-image-preview', quality: 'standard' };
  const result = await gen.generateCinemaAvatar([file], AVATAR_MOVIE, OUTPUT, settings, null);
  console.log(`\n✅ ${result.path}`);
}

main().catch(err => { console.log(`\n❌ ${err.message}`); process.exit(1); });
