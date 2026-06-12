#!/usr/bin/env node
/**
 * Генерация превью для всех подстилей повседневного стиля
 * Использует дефолтное фото девушки из demo/
 */

const path = require('path');
const { generateAvatar, uploadPhoto, STYLE_PROMPTS } = require('./generate-image');

const BASE_PHOTO = path.join(__dirname, '..', 'demo', '00_base_photo.png');
const PREVIEWS_DIR = path.join(__dirname, '..', 'data', 'previews');

const SUBSTYLES = [
  { id: 'casual_dark',  name: 'Тёмный фон' },
  { id: 'casual_light', name: 'Светлый фон' },
  { id: 'casual_office', name: 'Офис' },
  { id: 'casual_bw',    name: 'Чёрно-белое / На стуле в студии' },
  { id: 'casual_home',  name: 'Дом' }
];

async function main() {
  console.log('📤 Загрузка фото девушки в Gemini File API...');
  const fileInfo = await uploadPhoto(BASE_PHOTO);
  console.log(`✅ Загружено: ${fileInfo.uri}`);

  const files = [{ uri: fileInfo.uri, mimeType: fileInfo.mimeType }];

  for (const sub of SUBSTYLES) {
    console.log(`\n━━━ [${sub.id}] ${sub.name} ━━━`);
    console.log(`📝 Промпт: ${STYLE_PROMPTS[sub.id].slice(0, 150)}…`);

    const outputPath = await generateAvatar(
      files,
      sub.id,
      PREVIEWS_DIR,
      {},
      null
    );

    console.log(`✅ ${sub.name}: ${outputPath || 'готово'}`);
  }

  console.log('\n🎉 Все превью повседневного стиля сгенерированы!');
  console.log(`📂 Файлы в: ${PREVIEWS_DIR}`);
}

main().catch(err => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});
