#!/usr/bin/env node
/**
 * Генерация превью для всех подстилей корпоративного стиля
 * Использует аватар "Девушка" (avatar_6)
 */

const path = require('path');
const { generateAvatar, STYLE_PROMPTS } = require('./generate-image');

// Gemini URI для avatar_6 (Девушка, female) — свежая загрузка
const GEMINI_FILE = { uri: 'https://generativelanguage.googleapis.com/v1beta/files/17f83y6qm7wf', mimeType: 'image/jpeg' };

const SUBSTYLES = [
  { id: 'portrait_corporate_dark',  name: 'Тёмный фон' },
  { id: 'portrait_corporate_light', name: 'Светлый фон' },
  { id: 'portrait_corporate_office', name: 'Офис' },
  { id: 'portrait_corporate_bw',    name: 'Чёрно-белое' },
  { id: 'portrait_corporate_chair',          name: 'На стуле в студии' }
];

const PREVIEWS_DIR = path.join(__dirname, '..', 'photos', 'previews');

async function main() {
  console.log('🎨 Генерация превью корпоративного стиля\n');

  for (const sub of SUBSTYLES) {
    console.log(`\n━━━ [${sub.id}] ${sub.name} ━━━`);
    console.log(`📝 Промпт: ${STYLE_PROMPTS[sub.id].slice(0, 120)}…`);

    const result = await generateAvatar(
      [GEMINI_FILE],
      sub.id,
      PREVIEWS_DIR,
      {},
      null,
      'female'
    );

    console.log(`✅ ${sub.name}: ${result.path || result}`);
  }

  console.log('\n🎉 Все превью сгенерированы!');
  console.log(`📂 Файлы в: ${PREVIEWS_DIR}`);
}

main().catch(err => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});
