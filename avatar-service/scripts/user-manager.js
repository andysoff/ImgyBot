#!/usr/bin/env node
/**
 * Управление пользователями avatar-service
 * Запуск: node scripts/user-manager.js <action> [args]
 *
 * Actions:
 *   add <name> <telegram>         — добавить пользователя (10 генераций)
 *   add-with-avatar <name> <telegram> <avatarName> <photoPaths...> — добавить пользователя + первый аватар с фото
 *   list                          — список всех пользователей
 *   get <userId>                  — информация о пользователе
 *   add-generations <userId> <n>  — пополнить счётчик
 *   set-generations <userId> <n>  — установить счётчик
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PHOTOS_DIR = path.join(__dirname, '..', 'photos');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AVATARS_FILE = path.join(DATA_DIR, 'avatars.json');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function generateId(prefix, existing) {
  const max = existing
    .map(e => parseInt(e.id.replace(prefix, ''), 10))
    .filter(n => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${max + 1}`;
}

function actionAdd(name, telegram) {
  const users = readJSON(USERS_FILE);
  const id = generateId('user_', users);
  users.push({
    id,
    name,
    telegram,
    generationsRemaining: 10,
    avatars: []
  });
  writeJSON(USERS_FILE, users);
  console.log(`✅ Пользователь ${id} (${name}) добавлен. 10 генераций на старте.`);
  return id;
}

function actionAddWithAvatar(name, telegram, avatarName, ...photoPaths) {
  // Создаём пользователя
  const userId = actionAdd(name, telegram);
  
  // Создаём аватар
  const avatars = readJSON(AVATARS_FILE);
  const avatarId = generateId('avatar_', avatars);
  
  // Копируем фото в папку аватара
  const avatarPhotosDir = path.join(PHOTOS_DIR, userId, avatarId);
  fs.mkdirSync(avatarPhotosDir, { recursive: true });
  
  const savedPhotos = [];
  photoPaths.forEach((photoPath, i) => {
    const ext = path.extname(photoPath);
    const dest = path.join(avatarPhotosDir, `photo_${i + 1}${ext}`);
    if (fs.existsSync(photoPath)) {
      fs.copyFileSync(photoPath, dest);
      savedPhotos.push(`photos/${userId}/${avatarId}/photo_${i + 1}${ext}`);
      console.log(`  📷 Скопировано: ${dest}`);
    } else {
      console.warn(`  ⚠️ Файл не найден: ${photoPath}`);
    }
  });

  const avatar = {
    id: avatarId,
    userId,
    name: avatarName,
    createdAt: new Date().toISOString(),
    photos: savedPhotos,
    lastGeneratedAt: null
  };
  avatars.push(avatar);
  writeJSON(AVATARS_FILE, avatars);

  // Обновляем пользователя — добавляем аватар в список
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (user) {
    user.avatars.push(avatarId);
    writeJSON(USERS_FILE, users);
  }

  console.log(`✅ Аватар ${avatarId} («${avatarName}») создан.`);
  return { userId, avatarId };
}

function actionList() {
  const users = readJSON(USERS_FILE);
  if (users.length === 0) {
    console.log('📭 Нет пользователей');
    return;
  }
  console.log('📋 Пользователи:');
  users.forEach(u => {
    const icon = u.generationsRemaining > 0 ? '🟢' : '🔴';
    console.log(`  ${icon} ${u.id} — ${u.name} (${u.telegram}) — ${u.generationsRemaining} генераций, аватаров: ${u.avatars.length}`);
  });
}

function actionGet(userId) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) {
    console.log(`❌ Пользователь ${userId} не найден`);
    return;
  }
  const allAvatars = readJSON(AVATARS_FILE);
  const userAvatars = allAvatars.filter(a => a.userId === userId);

  const icon = user.generationsRemaining > 0 ? '🟢' : '🔴';
  console.log(`📌 ${icon} ${user.id}: ${user.name} (${user.telegram})`);
  console.log(`   Генераций осталось: ${user.generationsRemaining}`);
  console.log(`   Аватаров: ${userAvatars.length}`);
  userAvatars.forEach(a => {
    console.log(`     🖼 ${a.id} — «${a.name}» (${a.photos.length} фото, создан ${a.createdAt?.slice(0, 10)})`);
  });
}

function actionAddGenerations(userId, n) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) {
    console.log(`❌ Пользователь ${userId} не найден`);
    return;
  }
  user.generationsRemaining += n;
  writeJSON(USERS_FILE, users);
  console.log(`✅ ${user.name}: +${n} генераций → осталось ${user.generationsRemaining}`);
}

function actionSetGenerations(userId, n) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) {
    console.log(`❌ Пользователь ${userId} не найден`);
    return;
  }
  user.generationsRemaining = n;
  writeJSON(USERS_FILE, users);
  console.log(`✅ ${user.name}: генерации установлены → ${user.generationsRemaining}`);
}

// --- CLI ---
const action = process.argv[2];

switch (action) {
  case 'add':
    if (!process.argv[3] || !process.argv[4]) {
      console.log('Использование: node user-manager.js add <name> <telegram>');
      process.exit(1);
    }
    actionAdd(process.argv[3], process.argv[4]);
    break;

  case 'add-with-avatar':
    if (!process.argv[3] || !process.argv[4] || !process.argv[5] || !process.argv[6]) {
      console.log('Использование: node user-manager.js add-with-avatar <name> <telegram> <avatarName> <photoPath1> [photoPath2 ...]');
      process.exit(1);
    }
    actionAddWithAvatar(process.argv[3], process.argv[4], process.argv[5], ...process.argv.slice(6));
    break;

  case 'list':
    actionList();
    break;

  case 'get':
    if (!process.argv[3]) {
      console.log('Использование: node user-manager.js get <userId>');
      process.exit(1);
    }
    actionGet(process.argv[3]);
    break;

  case 'add-generations':
    if (!process.argv[3] || !process.argv[4]) {
      console.log('Использование: node user-manager.js add-generations <userId> <n>');
      process.exit(1);
    }
    actionAddGenerations(process.argv[3], parseInt(process.argv[4], 10));
    break;

  case 'set-generations':
    if (!process.argv[3] || process.argv[4] === undefined) {
      console.log('Использование: node user-manager.js set-generations <userId> <n>');
      process.exit(1);
    }
    actionSetGenerations(process.argv[3], parseInt(process.argv[4], 10));
    break;

  default:
    console.log(`Доступные действия: add, add-with-avatar, list, get, add-generations, set-generations`);
    process.exit(1);
}
