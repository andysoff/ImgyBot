#!/usr/bin/env node
/**
 * Ручной тест bot-logic.js
 *
 * Запуск: node scripts/test.js
 *
 * Симулирует полный цикл клиента без Telegram:
 *   1. /start            → приветствие
 *   2. загрузка фото     → создание юзера + кнопки стилей
 *   3. выбор стиля       → генерация (x3 раза, чтобы обнулить счётчик)
 *   4. ещё одна попытка  → "генерации закончились"
 */

const path = require('path');
const fs = require('fs');

// Подчищаем данные перед тестом
const DATA_DIR = path.join(__dirname, '..', 'data');
[ 'conversations.json', 'users.json', 'avatars.json' ].forEach(f => {
  const fp = path.join(DATA_DIR, f);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
});

const botLogic = require('./bot-logic');

// Создаём пустые файлы
botLogic.writeJSON(path.join(DATA_DIR, 'users.json'), []);
botLogic.writeJSON(path.join(DATA_DIR, 'avatars.json'), []);
botLogic.writeJSON(path.join(DATA_DIR, 'conversations.json'), {});

const TELEGRAM_ID = '123456789';
const USER_NAME = 'Тестовый Клиент';

// Создаём временные файлы-фото
const PHOTOS_DIR = path.join(__dirname, '..', 'photos', '_test');
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
const fakePhotos = [];
for (let i = 1; i <= 3; i++) {
  const fp = path.join(PHOTOS_DIR, `test_${i}.jpg`);
  fs.writeFileSync(fp, `fake photo ${i}`);
  fakePhotos.push(fp);
}

function separator(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

function showResponse(res) {
  if (!res) { console.log('❌ Ответ: null'); return; }
  console.log(`📝 Текст: ${res.text}`);
  if (res.readyToGenerate) {
    console.log(`⚙️ Генерация: стиль="${res.style?.name}", аватар="${res.avatarId}", осталось=${res.remaining}`);
  }
  if (res.reply_markup) {
    const btns = res.reply_markup.inline_keyboard.map(row => row.map(b => b.text).join(' | ')).join('\n       ');
    console.log(`🔘 Кнопки: ${btns}`);
  }
}

// =================== Шаг 1: /start ===================
separator('ШАГ 1: /start — приветствие');
let res = botLogic.handleStart(TELEGRAM_ID);
showResponse(res);

// =================== Шаг 2: загрузка фото ===================
separator('ШАГ 2: загрузка фото');
res = botLogic.handlePhotosReceived(TELEGRAM_ID, fakePhotos, USER_NAME);
showResponse(res);

// =================== Шаг 3-5: выбор стиля x3 ===================
const styles = ['portrait', 'sport', 'in_car'];
for (const styleId of styles) {
  separator(`ШАГ 3: выбор стиля "${styleId}"`);
  res = botLogic.handleStyleSelected(TELEGRAM_ID, styleId);
  showResponse(res);
}

// =================== Попытка после обнуления ===================
separator('ШАГ 4: попытка после обнуления');
// Сбрасываем диалог, чтобы проверить handleStart → handleStyleSelected без фото
botLogic.resetConversation(TELEGRAM_ID);
botLogic.handleStart(TELEGRAM_ID);
// Сразу пробуем выбрать стиль — диалог в awaiting_photos, не сработает
res = botLogic.handleStyleSelected(TELEGRAM_ID, 'portrait');
console.log(`(ожидаем null — не в состоянии awaiting_style): ${res === null ? '✅ null' : '❌ ' + JSON.stringify(res)}`);

// Ставим нужное состояние вручную
const conv = botLogic.getConversation(TELEGRAM_ID);
botLogic.setConversation(TELEGRAM_ID, 'awaiting_style', { userId: conv.data.userId, avatarId: conv.data.avatarId });
res = botLogic.handleStyleSelected(TELEGRAM_ID, 'portrait');
showResponse(res);

// =================== Итог ===================
separator('ИТОГ');
const users = botLogic.readJSON(path.join(DATA_DIR, 'users.json'));
const avatars = botLogic.readJSON(path.join(DATA_DIR, 'avatars.json'));
console.log(`👤 Пользователей: ${users.length}`);
users.forEach(u => console.log(`   ${u.id}: ${u.name}, генераций: ${u.generationsRemaining}, аватаров: ${u.avatars.length}`));
console.log(`🖼 Аватаров: ${avatars.length}`);
avatars.forEach(a => console.log(`   ${a.id}: "${a.name}", фото: ${a.photos.length}`));

// Чистим тестовые данные
fs.rmSync(PHOTOS_DIR, { recursive: true, force: true });
console.log('\n✅ Тест завершён.');
