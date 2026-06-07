#!/usr/bin/env node
/**
 * Генерация аватарок через Google Gemini API
 *
 * Использует gemini-3.1-flash-image-preview (или gemini-3-pro-image-preview).
 * Фото загружаются один раз через File API → URI кешируется.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-image';

// Стили → промпты
const STYLE_PROMPTS = {
  portrait: 'professional studio portrait photo, high quality, soft lighting, clean background, focus on face, magazine quality, realistic',
  sport: 'dynamic sporty portrait, athletic look, action pose, sportswear aesthetic, high energy, realistic photo, professional lighting',
  in_car: 'in a car, driver or passenger seat, automotive lifestyle, natural lighting through window, modern car interior, realistic photo, cinematic',
  in_office: 'professional office setting, business attire, desk and computer, natural office lighting, realistic photo',
  professions: 'person dressed in various professional roles (doctor in white coat with stethoscope, chef in kitchen, pilot uniform, engineer with hard hat, teacher at blackboard), high quality portrait, realistic photo, professional lighting, multiple career looks',
  cinema: 'cinematic movie still portrait, dramatic film lighting, anamorphic look, cinematic color grading, shallow depth of field, Hollywood movie scene aesthetic, widescreen composition, realistic photo, high quality'
};

/**
 * Загрузить фото в Gemini File API.
 * @param {string} photoPath  — путь к файлу
 * @returns {Promise<{name: string, uri: string, mimeType: string}>}
 */
async function uploadPhoto(photoPath) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');

  const stats = fs.statSync(photoPath);
  const mimeType = getMimeType(photoPath);
  const fileName = path.basename(photoPath);

  console.log(`📤 Gemini File API: загрузка ${fileName} (${(stats.size / 1024).toFixed(1)} KB)`);

  // === Шаг 1: Initiate resumable upload ===
  const initUrl = new URL('https://generativelanguage.googleapis.com/upload/v1beta/files');
  initUrl.searchParams.set('key', API_KEY);

  const { uploadUrl } = await new Promise((resolve, reject) => {
    const req = https.request(
      initUrl,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(stats.size),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      },
      (res) => {
        console.log(`📥 File API init HTTP ${res.statusCode}`);
        const uploadUrl = res.headers['x-goog-upload-url'];
        if (!uploadUrl) {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => reject(new Error(`File API init failed: ${data.slice(0, 200)}`)));
          return;
        }
        resolve({ uploadUrl });
      }
    );
    // В теле можно отправить метаданные (опционально)
    req.write(JSON.stringify({ file: { displayName: fileName } }));
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('File API init timeout')); });
    req.end();
  });

  // === Шаг 2: Upload file bytes ===
  const fileData = fs.readFileSync(photoPath);

  const fileInfo = await new Promise((resolve, reject) => {
    const req = https.request(
      uploadUrl,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
          'Content-Length': String(fileData.length),
          'Content-Type': mimeType
        },
        timeout: 60000
      },
      (res) => {
        console.log(`📥 File API upload HTTP ${res.statusCode}`);
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`File API upload error: ${JSON.stringify(parsed.error)}`));
            } else if (parsed.file) {
              resolve(parsed.file);
            } else {
              reject(new Error(`File API: unexpected response: ${data.slice(0, 300)}`));
            }
          } catch {
            reject(new Error(`File API parse error: ${data.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('File API upload timeout')); });
    req.write(fileData);
    req.end();
  });

  console.log(`✅ Gemini File URI: ${fileInfo.uri || fileInfo.name}`);
  return {
    name: fileInfo.name,
    uri: fileInfo.uri,
    mimeType
  };
}

/**
 * Сгенерировать аватарку, используя ранее загруженные фото (file URI).
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {string} styleId     — id стиля
 * @param {string} outputDir   — куда сохранить результат
 * @returns {Promise<string>}  — путь к сгенерированному изображению
 */
const QUALITY_HINTS = {
  economy: ', low quality, compressed, fast rendering',
  standard: '',
  premium: ', ultra high quality, maximum detail, 8K, professional photography grade, magazine quality'
};

const SIZE_HINTS = {
  small: ', close-up portrait, head and shoulders composition, tighter framing',
  medium: '',
  large: ', full body shot, wide angle composition, maximum detail'
};

function applyQuality(prompt, settings) {
  let result = prompt;
  const qualityHint = QUALITY_HINTS[settings?.quality] || '';
  result += qualityHint;
  const sizeHint = SIZE_HINTS[settings?.size] || '';
  result += sizeHint;
  return result;
}

async function generateAvatar(files, styleId, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const stylePrompt = STYLE_PROMPTS[styleId] || STYLE_PROMPTS.portrait;
  const count = files.length;
  const promptBase = count === 1
    ? `Transform this person into an avatar with the following style: ${stylePrompt}. Keep the face recognizable, make it look like a high-quality professional photo.`
    : `Transform this person into an avatar with the following style: ${stylePrompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features, expressions and appearance accurately. Keep the face recognizable, make it look like a high-quality professional photo.`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });

  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  const payload = JSON.stringify({
    contents: [{
      parts: requestParts
    }],
    generationConfig: {
      responseModalities: ['Image', 'Text'],
      temperature: 1,
      topK: 32,
      topP: 1
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  console.log(`🎨 Gemini: генерация в стиле ${styleId}...`);

  const result = await apiCall(payload, extraConfig);

  // Извлекаем изображение из ответа
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    throw new Error('Gemini не вернул изображение');
  }

  // Сохраняем изображение
  const ext = imagePart.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
  const outputPath = path.join(outputDir, `generated_${Date.now()}${ext}`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Генерация завершена: ${outputPath} (${(imgBuffer.length / 1024).toFixed(1)} KB)`);
  return { path: outputPath, prompt };
}

/**
 * Сгенерировать набор аватарок для всех профессий.
 * Каждая профессия — отдельный запрос к Gemini.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {string} outputDir   — куда сохранить результат
 * @returns {Promise<Array<{id: string, name: string, path: string}>>}
 */
/**
 * Сгенерировать аватарку для случайной профессии.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {object} profession  — объект профессии из PROFESSIONS
 * @param {string} outputDir
 * @returns {Promise<string>}  — путь к сгенерированному изображению
 */
async function generateProfessionAvatar(files, profession, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const count = files.length;
  const promptBase = count === 1
    ? `Transform this person into the following professional role: ${profession.prompt}. Keep the face recognizable, make it look like a high-quality professional photo. The person should be the main subject dressed for this role.`
    : `Transform this person into the following professional role: ${profession.prompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features, expressions and appearance accurately. Keep the face recognizable, make it look like a high-quality professional photo. The person should be the main subject dressed for this role.`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: { responseModalities: ['Image', 'Text'], temperature: 1, topK: 32, topP: 1 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  console.log(`🎨 Gemini: генерация профессии «${profession.name}»...`);

  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;
  const result = await apiCall(payload, extraConfig);
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    throw new Error('Gemini не вернул изображение');
  }

  const ext = imagePart.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
  const outputPath = path.join(outputDir, `profession_${profession.id}_${Date.now()}${ext}`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Профессия «${profession.name}»: ${outputPath} (${(imgBuffer.length / 1024).toFixed(1)} KB)`);
  return { path: outputPath, prompt };
}

/**
 * Выбрать случайную профессию из списка.
 * @returns {{id: string, name: string, prompt: string}}
 */
function getRandomProfession() {
  return PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)];
}

// Профессии для стиля «Профессия» — ~30 самых известных профессий мира
const PROFESSIONS = [
  { id: 'doctor', name: '👨‍⚕️ Врач', prompt: 'person dressed as a doctor in white medical coat with stethoscope, medical clinic background' },
  { id: 'chef', name: '👨‍🍳 Шеф-повар', prompt: 'person dressed as a chef in white kitchen uniform and chef hat, professional kitchen' },
  { id: 'pilot', name: '👨‍✈️ Пилот', prompt: 'person dressed as an airline pilot in uniform, cockpit background' },
  { id: 'engineer', name: '👷 Инженер', prompt: 'person dressed as an engineer with yellow hard hat and safety vest, construction site' },
  { id: 'teacher', name: '👨‍🏫 Учитель', prompt: 'person dressed as a teacher in smart casual, classroom with blackboard' },
  { id: 'astronaut', name: '🧑‍🚀 Космонавт', prompt: 'person dressed as an astronaut in spacesuit, spacecraft background' },
  { id: 'firefighter', name: '👨‍🚒 Пожарный', prompt: 'person dressed as a firefighter in protective gear with helmet, fire station' },
  { id: 'police', name: '👮 Полицейский', prompt: 'person dressed as a police officer in uniform, city street background' },
  { id: 'nurse', name: '👩‍⚕️ Медсестра', prompt: 'person dressed as a nurse in medical scrubs, hospital room' },
  { id: 'lawyer', name: '👨‍💼 Адвокат', prompt: 'person dressed as a lawyer in formal suit, law library or courtroom' },
  { id: 'architect', name: '👷‍♂️ Архитектор', prompt: 'person dressed as an architect with blueprint and rolled plans, modern office' },
  { id: 'scientist', name: '🔬 Учёный', prompt: 'person dressed as a scientist in lab coat and goggles, laboratory with equipment' },
  { id: 'artist', name: '🎨 Художник', prompt: 'person dressed as an artist in paint-splattered smock, studio with easel' },
  { id: 'musician', name: '🎸 Музыкант', prompt: 'person dressed as a rock musician with instrument, concert stage lighting' },
  { id: 'athlete', name: '🏆 Спортсмен', prompt: 'person dressed as a professional athlete in sportswear with medal, stadium' },
  { id: 'farmer', name: '👨‍🌾 Фермер', prompt: 'person dressed as a farmer in plaid shirt and overalls, rural farm landscape' },
  { id: 'sailor', name: '⛵ Моряк', prompt: 'person dressed as a sailor in navy uniform, ship deck with ocean' },
  { id: 'judge', name: '⚖️ Судья', prompt: 'person dressed as a judge in black robe, courtroom bench background' },
  { id: 'photographer', name: '📸 Фотограф', prompt: 'person dressed as a photographer with professional camera, photo studio' },
  { id: 'veterinarian', name: '🐾 Ветеринар', prompt: 'person dressed as a veterinarian in medical coat, veterinary clinic with animal' },
  { id: 'programmer', name: '💻 Программист', prompt: 'person dressed as a programmer in casual attire, modern office with multiple monitors' },
  { id: 'journalist', name: '📰 Журналист', prompt: 'person dressed as a journalist with notebook and press badge, newsroom' },
  { id: 'chef_2', name: '👨‍🍳 Кондитер', prompt: 'person dressed as a pastry chef in white uniform, bakery with cakes and pastries' },
  { id: 'barista', name: '☕ Бариста', prompt: 'person dressed as a barista in apron, coffee shop with espresso machine' },
  { id: 'detective', name: '🔍 Детектив', prompt: 'person dressed as a detective in trench coat, dimly lit office with case board' },
  { id: 'surgeon', name: '🩺 Хирург', prompt: 'person dressed as a surgeon in scrubs and surgical mask, operating room light' },
  { id: 'pilot_helicopter', name: '🚁 Пилот вертолёта', prompt: 'person dressed as a helicopter pilot in flight suit and helmet, helipad' },
  { id: 'soldier', name: '🎖️ Военный', prompt: 'person dressed in military uniform with medals, army base background' },
  { id: 'sculptor', name: '🗿 Скульптор', prompt: 'person dressed as a sculptor in work apron with chisel, studio with marble sculptures' },
  { id: 'dancer', name: '💃 Танцор', prompt: 'person dressed as a dancer in elegant costume, stage with dramatic lighting' },
  { id: 'writer', name: '✍️ Писатель', prompt: 'person dressed as a writer in cozy attire, study room with bookshelves and typewriter' },
  { id: 'astronomer', name: '🔭 Астроном', prompt: 'person dressed as an astronomer in casual wear, observatory with telescope under starry sky' }
];

// Спорт — список видов спорта для стиля «Спорт»
const SPORTS = [
  { id: 'football', name: '⚽ Футбол', prompt: 'person as a football/soccer player in team jersey, action on the pitch, stadium crowd' },
  { id: 'basketball', name: '🏀 Баскетбол', prompt: 'person as a basketball player in jersey, indoor court, jumping for a dunk' },
  { id: 'tennis', name: '🎾 Теннис', prompt: 'person as a tennis player in sportswear, on court with racket, green surface' },
  { id: 'boxing', name: '🥊 Бокс', prompt: 'person as a boxer in gloves and shorts, boxing ring, intense action' },
  { id: 'swimming', name: '🏊 Плавание', prompt: 'person as a swimmer in swim cap and goggles, pool lane, competitive swimming' },
  { id: 'athletics', name: '🏃 Лёгкая атлетика', prompt: 'person as a runner in athletic singlet, sprinting on track, stadium' },
  { id: 'gymnastics', name: '🤸 Гимнастика', prompt: 'person as a gymnast in leotard, performing on apparatus, bright stage lighting' },
  { id: 'skiing', name: '⛷️ Горные лыжи', prompt: 'person as a skier in ski suit and goggles, snowy mountain slope' },
  { id: 'football_american', name: '🏈 Американский футбол', prompt: 'person as an American football player in helmet and shoulder pads, on field' },
  { id: 'baseball', name: '⚾ Бейсбол', prompt: 'person as a baseball player in cap and uniform, batting at home plate' },
  { id: 'volleyball', name: '🏐 Волейбол', prompt: 'person as a volleyball player in jersey, jumping to spike, indoor court' },
  { id: 'rugby', name: '🏉 Регби', prompt: 'person as a rugby player in jersey, running with ball, muddy pitch' },
  { id: 'golf', name: '⛳ Гольф', prompt: 'person as a golfer in polo shirt, holding club on green fairway' },
  { id: 'cycling', name: '🚴 Велоспорт', prompt: 'person as a cyclist in racing kit and helmet, on road bike' },
  { id: 'martial_arts', name: '🥋 Карате', prompt: 'person as a martial artist in gi, karate pose, dojo background' },
  { id: 'fencing', name: '🤺 Фехтование', prompt: 'person as a fencer in white suit and mask, holding foil, piste' },
  { id: 'ice_hockey', name: '🏒 Хоккей', prompt: 'person as an ice hockey player in helmet and jersey, on ice rink with stick' },
  { id: 'figure_skating', name: '⛸️ Фигурное катание', prompt: 'person as a figure skater in elegant costume, spinning on ice rink' },
  { id: 'surfing', name: '🏄 Сёрфинг', prompt: 'person as a surfer on a surfboard, riding ocean wave, tropical beach' },
  { id: 'snowboarding', name: '🏂 Сноуборд', prompt: 'person as a snowboarder in winter gear, carving on snowy mountain' },
  { id: 'weightlifting', name: '🏋️ Тяжёлая атлетика', prompt: 'person as a weightlifter holding barbell overhead, competition platform' },
  { id: 'wrestling', name: '🤼 Борьба', prompt: 'person as a wrestler in singlet, on wrestling mat in clinch' },
  { id: 'horse_riding', name: '🏇 Конный спорт', prompt: 'person as an equestrian rider in helmet and jacket, on horse, show jumping' },
  { id: 'skateboarding', name: '🛹 Скейтбординг', prompt: 'person as a skateboarder in casual streetwear, on skateboard in skatepark' },
  { id: 'climbing', name: '🧗 Скалолазание', prompt: 'person as a rock climber in harness, climbing on natural rock wall' },
  { id: 'diving', name: '🤿 Дайвинг', prompt: 'person as a diver in wetsuit and mask, underwater with coral reef' },
  { id: 'paragliding', name: '🪂 Параглайдинг', prompt: 'person as a paraglider in harness, flying with colorful canopy over landscape' },
  { id: 'bowling', name: '🎳 Боулинг', prompt: 'person as a bowler, rolling ball down lane, bowling alley' },
  { id: 'table_tennis', name: '🏓 Настольный теннис', prompt: 'person as a table tennis player with paddle, at table, intense focus' },
  { id: 'badminton', name: '🏸 Бадминтон', prompt: 'person as a badminton player with racket, jumping smash, indoor court' },
  { id: 'handball', name: '🤾 Гандбол', prompt: 'person as a handball player in jersey, throwing ball, indoor court' },
  { id: 'cricket', name: '🏏 Крикет', prompt: 'person as a cricket player in white uniform, batting on pitch, green field' },
  { id: 'water_polo', name: '🤽 Водное поло', prompt: 'person as a water polo player in cap, in pool, throwing ball' },
  { id: 'biathlon', name: '🎿 Биатлон', prompt: 'person as a biathlete in skis with rifle, snowy forest track' },
  { id: 'bobsleigh', name: '🛷 Бобслей', prompt: 'person as a bobsleigh pilot in streamlined suit and helmet, ice track' },
  { id: 'curling', name: '🥌 Кёрлинг', prompt: 'person as a curler in team uniform, sliding stone on ice' },
  { id: 'triathlon', name: '🏊‍♂️🚴‍♂️🏃‍♂️ Триатлон', prompt: 'person as a triathlete in race kit, transition area with bike' },
  { id: 'motorsport', name: '🏎️ Формула-1', prompt: 'person as a racing driver in firesuit and helmet, race car pit' },
  { id: 'archery', name: '🎯 Стрельба из лука', prompt: 'person as an archer pulling bowstring, target range background' },
  { id: 'judo', name: '🥋 Дзюдо', prompt: 'person as a judoka in white gi, throwing technique, tatami mat' },
  { id: 'taekwondo', name: '🥋 Тхэквондо', prompt: 'person as a taekwondo athlete in dobok, high kick, competition' },
  { id: 'sambo', name: '🥋 Самбо', prompt: 'person as a sambo wrestler in jacket and shorts, grappling on mat' },
  { id: 'skijumping', name: '⛷️ Прыжки с трамплина', prompt: 'person as a ski jumper in aerodynamic suit, flying through air' },
  { id: 'speed_skating', name: '⛸️ Конькобежный спорт', prompt: 'person as a speed skater in tight suit, racing on oval ice track' },
  { id: 'kickboxing', name: '🥊 Кикбоксинг', prompt: 'person as a kickboxer in shorts and gloves, throwing a kick, ring' },
  { id: 'padel', name: '🎾 Падел', prompt: 'person as a padel player with racket, on glass court' },
  { id: 'squash', name: '🏓 Сквош', prompt: 'person as a squash player in sportswear with racket, white wall court' },
  { id: 'rowing', name: '🚣‍♂️ Академическая гребля', prompt: 'person as a rower in singlet, rowing scull on lake' },
  { id: 'sailing', name: '⛵ Парусный спорт', prompt: 'person as a sailor in deck gear, on sailboat, ocean horizon' },
  { id: 'esports', name: '🎮 Киберспорт', prompt: 'person as an esports player with gaming headset, at RGB-lit gaming setup' }
];

/**
 * Выбрать случайный вид спорта из списка.
 * @returns {{id: string, name: string, prompt: string}}
 */
function getRandomSport() {
  return SPORTS[Math.floor(Math.random() * SPORTS.length)];
}

/**
 * Сгенерировать аватарку для случайного вида спорта.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {object} sport  — объект вида спорта из SPORTS
 * @param {string} outputDir
 * @returns {Promise<string>}  — путь к сгенерированному изображению
 */
async function generateSportAvatar(files, sport, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const count = files.length;
  const promptBase = count === 1
    ? `Transform this person into a professional athlete in the following sport: ${sport.prompt}. Keep the face recognizable, make it look like a high-quality sports action photo. The person should be the main subject playing this sport.`
    : `Transform this person into a professional athlete in the following sport: ${sport.prompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features, expressions and appearance accurately. Keep the face recognizable, make it look like a high-quality sports action photo. The person should be the main subject playing this sport.`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: { responseModalities: ['Image', 'Text'], temperature: 1, topK: 32, topP: 1 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;
  console.log(`🎨 Gemini: генерация спорта «${sport.name}»...`);

  const result = await apiCall(payload, extraConfig);
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    throw new Error('Gemini не вернул изображение');
  }

  const ext = imagePart.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
  const outputPath = path.join(outputDir, `sport_${sport.id}_${Date.now()}${ext}`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Спорт «${sport.name}»: ${outputPath} (${(imgBuffer.length / 1024).toFixed(1)} KB)`);
  return { path: outputPath, prompt };
}

// Работа — список интересных рабочих мест и обстановок
const OFFICE = [
  { id: 'ceo', name: '👔 Генеральный директор', prompt: 'person as a confident CEO in expensive suit, corner office with city view, luxury executive desk' },
  { id: 'developer', name: '💻 Разработчик', prompt: 'person working as a software developer, multiple monitors with code, ergonomic chair, tech office' },
  { id: 'designer', name: '🎨 Дизайнер', prompt: 'person as a graphic designer at a large drawing tablet, creative mood board, colorful creative studio' },
  { id: 'analyst', name: '📊 Аналитик', prompt: 'person as a data analyst, large screens with charts and graphs, modern analytical office' },
  { id: 'hr', name: '👥 HR-менеджер', prompt: 'person as an HR manager at desk with files, bright welcoming office, interview room' },
  { id: 'accountant', name: '🧮 Бухгалтер', prompt: 'person as an accountant with spreadsheets and calculator, organized desk, professional office' },
  { id: 'manager', name: '📋 Менеджер проекта', prompt: 'person as a project manager with whiteboard, sticky notes, team meeting room' },
  { id: 'lawyer', name: '⚖️ Юрист', prompt: 'person as a corporate lawyer in formal suit, legal documents, law firm office with bookshelves' },
  { id: 'secretary', name: '📞 Секретарь', prompt: 'person as an administrative assistant at reception desk, phone and planner, modern lobby' },
  { id: 'marketer', name: '📈 Маркетолог', prompt: 'person as a marketing specialist with analytics dashboard, creative agency office' },
  { id: 'recruiter', name: '🔍 Рекрутер', prompt: 'person as a recruiter reviewing resumes on laptop, bright talent acquisition office' },
  { id: 'support', name: '🎧 Саппорт-специалист', prompt: 'person as a customer support agent with headset, dual monitors, call center setting' },
  { id: 'sales', name: '📞 Менеджер по продажам', prompt: 'person as a sales manager on phone, CRM dashboard, energetic open office' },
  { id: 'sysadmin', name: '🖥️ Системный администратор', prompt: 'person as a sysadmin in server room, multiple screens with terminal, IT infrastructure' },
  { id: 'product_owner', name: '📱 Продакт-менеджер', prompt: 'person as a product owner with sticky notes on wall, user stories, agile office setup' },
  { id: 'qa', name: '🐛 QA-инженер', prompt: 'person as a QA engineer testing software, bug tracking board, quality lab' },
  { id: 'office_manager', name: '🏢 Офис-менеджер', prompt: 'person as an office manager organizing supplies, cozy well-maintained office space' },
  { id: 'pr_specialist', name: '📰 PR-специалист', prompt: 'person as a PR specialist at press conference, media contacts, professional communications' },
  { id: 'financier', name: '💰 Финансист', prompt: 'person as a finance professional at Bloomberg terminal, stock market screens, bank office' },
  { id: 'consultant', name: '💼 Бизнес-консультант', prompt: 'person as a management consultant in smart suit, client presentation, boardroom' },
  { id: 'copywriter', name: '✍️ Копирайтер', prompt: 'person as a copywriter typing on sleek laptop, editorial office, creative writing space' },
  { id: 'ux_researcher', name: '🔬 UX-исследователь', prompt: 'person as a UX researcher conducting user interview, usability lab, research notes' },
  { id: 'logistician', name: '🚚 Логист', prompt: 'person as a logistics coordinator at desk with route maps, dispatch screens, warehouse office' },
  { id: 'purchasing', name: '🛒 Закупщик', prompt: 'person as a procurement specialist with supplier catalogs, negotiation desk' },
  { id: 'architect', name: '📐 Архитектор', prompt: 'person as an architect reviewing blueprints, scale models, modern design studio' },
  { id: 'hr_branding', name: '🌟 HR-брендинг', prompt: 'person as an employer branding specialist creating content, social media desk' },
  { id: 'intern', name: '🎓 Стажёр', prompt: 'person as an intern in casual office wear, learning at desk with mentor, eager and fresh' },
  { id: 'coworking', name: '💻 Коворкинг', prompt: 'person working in a modern coworking space with freelancers, casual attire, community atmosphere' },
  { id: 'startup_founder', name: '🚀 Основатель стартапа', prompt: 'person as a startup founder in hoodie, pitching ideas, lean startup office with whiteboard' }
];

/**
 * Выбрать случайное рабочее место из списка.
 * @returns {{id: string, name: string, prompt: string}}
 */
function getRandomOffice() {
  return OFFICE[Math.floor(Math.random() * OFFICE.length)];
}

/**
 * Сгенерировать аватарку для случайного рабочего места.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {object} work  — объект рабочего места из WORKS
 * @param {string} outputDir
 * @returns {Promise<string>}  — путь к сгенерированному изображению
 */
async function generateOfficeAvatar(files, work, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const count = files.length;
  const promptBase = count === 1
    ? `Show this person in an office setting: ${work.prompt}. Keep the face recognizable, make it look like a high-quality realistic office photo. The person should be the main subject in this office environment.`
    : `Show this person in an office setting: ${work.prompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features, expressions and appearance accurately. Keep the face recognizable, make it look like a high-quality realistic office photo. The person should be the main subject in this office environment.`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: { responseModalities: ['Image', 'Text'], temperature: 1, topK: 32, topP: 1 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
    });

const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  console.log(`🎨 Gemini: генерация офисной роли «${work.name}»...`);

  const result = await apiCall(payload, extraConfig);
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    throw new Error('Gemini не вернул изображение');
  }

  const ext = imagePart.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
  const outputPath = path.join(outputDir, `office_${work.id}_${Date.now()}${ext}`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Офис «${work.name}»: ${outputPath} (${(imgBuffer.length / 1024).toFixed(1)} KB)`);
  return { path: outputPath, prompt };
}

// Кино — список культовых фильмов из IMDB Top 250
const MOVIES = [
  { title: 'Побег из Шоушенка', titleEn: 'The Shawshank Redemption', year: 1994,
    prompt: 'prison drama aesthetic, warm amber tones, stone walls, hope and redemption atmosphere, realistic character portrait' },
  { title: 'Крёстный отец', titleEn: 'The Godfather', year: 1972,
    prompt: 'vintage mafia aesthetic, dark warm tones, 1970s style suit, dramatic chiaroscuro lighting, classic cinema portrait' },
  { title: 'Крёстный отец 2', titleEn: 'The Godfather: Part II', year: 1974,
    prompt: 'vintage mafia aesthetic, 1920s Sicily and 1950s Cuba, dark warm amber tones, period suits, dramatic shadows, epic crime portrait' },
  { title: 'Тёмный рыцарь', titleEn: 'The Dark Knight', year: 2008,
    prompt: 'dark noir superhero aesthetic, Gotham city vibe, dramatic low-key lighting, blue-black color palette, gritty urban portrait' },
  { title: '12 разгневанных мужчин', titleEn: '12 Angry Men', year: 1957,
    prompt: 'courtroom drama aesthetic, 1950s suits in jury room, claustrophobic single-room setting, harsh overhead lighting, black and white photography' },
  { title: 'Криминальное чтиво', titleEn: 'Pulp Fiction', year: 1994,
    prompt: '90s cult crime aesthetic, retro diner vibe, sharp suit with skinny tie, Tarantino style, vibrant colors' },
  { title: 'Бойцовский клуб', titleEn: 'Fight Club', year: 1999,
    prompt: 'dark grunge 90s aesthetic, gritty underground vibe, leather jacket, industrial lighting, edgy portrait' },
  { title: 'Форрест Гамп', titleEn: 'Forrest Gump', year: 1994,
    prompt: 'wholesome American aesthetic, 50s-70s era styling, soft warm lighting, bench scene vibe, nostalgic portrait' },
  { title: 'Начало', titleEn: 'Inception', year: 2010,
    prompt: 'sci-fi thriller aesthetic, surreal dreamscape vibe, sharp suit, blue-tinted lighting, Nolan cinematic style' },
  { title: 'Матрица', titleEn: 'The Matrix', year: 1999,
    prompt: 'cyberpunk aesthetic, black leather trench coat, dark sunglasses, green tinted lighting, digital rain vibe, sci-fi portrait' },
  { title: 'Хороший, плохой, злой', titleEn: 'The Good, the Bad and the Ugly', year: 1966,
    prompt: 'spaghetti western aesthetic, cowboy hat and poncho, arid desert landscape, harsh golden sunlight, dramatic Ennio Morricone vibe' },
  { title: 'Список Шиндлера', titleEn: 'Schindler\'s List', year: 1993,
    prompt: 'Holocaust drama aesthetic, 1940s period clothing, black and white photography, muted tones with red accent, Spielberg emotional style' },
  { title: 'Пролетая над гнездом кукушки', titleEn: 'One Flew Over the Cuckoo\'s Nest', year: 1975,
    prompt: 'mental institution aesthetic, 1960s hospital pajamas, stark white walls, institutional green tiles, harsh fluorescent lighting, rebellious spirit' },
  { title: 'Интерстеллар', titleEn: 'Interstellar', year: 2014,
    prompt: 'space epic aesthetic, astronaut suit, cosmic background, dramatic Nolan lighting, vast and lonely feel' },
  { title: 'Властелин колец', titleEn: 'The Lord of the Rings', year: 2001,
    prompt: 'epic fantasy aesthetic, medieval costume, majestic natural landscape, golden hour lighting, heroic portrait' },
  { title: 'Властелин колец: Возвращение короля', titleEn: 'The Lord of the Rings: The Return of the King', year: 2003,
    prompt: 'epic fantasy aesthetic, medieval royal armor, Minas Tirith backdrop, golden epic lighting, heroic festive portrait' },
  { title: 'Звёздные войны: Империя наносит ответный удар', titleEn: 'Star Wars: Episode V - The Empire Strikes Back', year: 1980,
    prompt: 'sci-fi aesthetic, rebel pilot or Jedi outfit, snowy Hoth landscape, blue cold lighting, classic 80s sci-fi portrait' },
  { title: 'Звёздные войны', titleEn: 'Star Wars', year: 1977,
    prompt: 'sci-fi aesthetic, desert robe, Tatooine backdrop, golden warm lighting, classic 70s sci-fi portrait' },
  { title: 'Семь самураев', titleEn: 'Seven Samurai', year: 1954,
    prompt: 'samurai epic aesthetic, traditional kimono and katana, feudal Japan countryside, black and white photography, Kurosawa dramatic style' },
  { title: 'Славные парни', titleEn: 'Goodfellas', year: 1990,
    prompt: 'mafia aesthetic, 70s Italian-American style suit, Copacabana nightclub vibe, warm amber lighting, Scorsese long-take energy' },
  { title: 'Город Бога', titleEn: 'City of God', year: 2002,
    prompt: 'Brazilian favela aesthetic, vibrant street style, colorful walls, harsh sunlight, documentary-style realism, energetic youthful portrait' },
  { title: 'Касабланка', titleEn: 'Casablanca', year: 1942,
    prompt: 'classic noir romance aesthetic, 1940s trench coat and fedora, smoky nightclub backdrop, dramatic black and white shadows, Bogart style' },
  { title: 'Леон', titleEn: 'Léon: The Professional', year: 1994,
    prompt: 'cult assassin aesthetic, dark coat and hat, New York city backdrop, moody street lighting, French cinema style' },
  { title: 'Однажды на Диком Западе', titleEn: 'Once Upon a Time in the West', year: 1968,
    prompt: 'spaghetti western aesthetic, dusty duster coat and wide-brim hat, railroad backdrop, golden sunset, Sergio Leone epic widescreen' },
  { title: 'Окно во двор', titleEn: 'Rear Window', year: 1954,
    prompt: 'Hitchcock noir aesthetic, 1950s casual attire, apartment courtyard backdrop, warm golden lighting, voyeuristic mood, classic Hollywood style' },
  { title: 'Унесённые призраками', titleEn: 'Spirited Away', year: 2001,
    prompt: 'Studio Ghibli magical aesthetic, whimsical spirit world vibe, colorful traditional Japanese elements, dreamlike portrait' },
  { title: 'Искатели потерянного ковчега', titleEn: 'Raiders of the Lost Ark', year: 1981,
    prompt: 'adventure aesthetic, leather jacket and fedora, jungle or temple backdrop, golden warm lighting, Spielberg action-adventure style' },
  { title: 'Подозрительные лица', titleEn: 'The Usual Suspects', year: 1995,
    prompt: 'crime noir aesthetic, dark interrogation room, trench coat, dramatic low-key lighting, smoky atmosphere, Singer neo-noir style' },
  { title: 'Психо', titleEn: 'Psycho', year: 1960,
    prompt: 'Hitchcock horror aesthetic, 1950s attire, dark motel setting, black and white photography, shower scene shadows, eerie gothic mood' },
  { title: 'Спасти рядового Райана', titleEn: 'Saving Private Ryan', year: 1998,
    prompt: 'war epic aesthetic, military uniform, gritty battle-worn look, muted desaturated colors, Spielberg cinematic style' },
  { title: 'Одержимость', titleEn: 'Whiplash', year: 2014,
    prompt: 'intense jazz aesthetic, dark stage lighting, sweat and passion, drumsticks, dramatic spotlight, gritty portrait' },
  { title: 'Бесславные ублюдки', titleEn: 'Inglourious Basterds', year: 2009,
    prompt: 'Tarantino WWII aesthetic, vintage military gear, dramatic cinema lighting, bold colors, tense portrait' },
  { title: 'Гладиатор', titleEn: 'Gladiator', year: 2000,
    prompt: 'ancient Roman epic aesthetic, gladiator armor, golden sunset lighting, Colosseum backdrop, heroic Ridley Scott portrait' },
  { title: 'Это прекрасная жизнь', titleEn: 'It\'s a Wonderful Life', year: 1946,
    prompt: 'classic American aesthetic, 1940s suit, snowy small town backdrop, warm nostalgic lighting, black and white, Capra wholesome style' },
  { title: 'Помни', titleEn: 'Memento', year: 2000,
    prompt: 'psychological thriller aesthetic, Polaroid instant photos, neo-noir lighting, disjointed dark aesthetic, Christopher Nolan style' },
  { title: 'Бульвар Сансет', titleEn: 'Sunset Blvd.', year: 1950,
    prompt: 'Hollywood noir aesthetic, glamorous 40s attire, decaying mansion backdrop, dramatic black and white shadows, Billy Wilder cynical style' },
  { title: 'Волк с Уолл-стрит', titleEn: 'The Wolf of Wall Street', year: 2013,
    prompt: 'luxury 90s aesthetic, sharp suit, excess and glamour, gold and blue tones, high-energy Scorsese portrait' },
  { title: 'Доктор Стрейнджлав', titleEn: 'Dr. Strangelove', year: 1964,
    prompt: 'Cold War satire aesthetic, military uniform, war room backdrop, black and white photography, Kubrick deadpan satirical style' },
  { title: 'Апокалипсис сегодня', titleEn: 'Apocalypse Now', year: 1979,
    prompt: 'Vietnam war aesthetic, jungle fatigues, helicopter backdrop, orange napalm sky, surreal madness, Coppola psychological war style' },
  { title: 'Паразиты', titleEn: 'Parasite', year: 2019,
    prompt: 'Korean thriller aesthetic, contrast between rich and poor, moody lighting, rainy city streets, Bong Joon-ho style' },
  { title: 'Джокер', titleEn: 'Joker', year: 2019,
    prompt: 'gritty psychological aesthetic, 80s grimy Gotham, green and red tones, worn suit, dark staircase, unsettling portrait' },
  { title: 'Американская история X', titleEn: 'American History X', year: 1998,
    prompt: 'neo-nazi drama aesthetic, swastika tattoo, black and white flashback style, gritty streetwear, intense confrontational portrait' },
  { title: 'На север через северо-запад', titleEn: 'North by Northwest', year: 1959,
    prompt: 'Hitchcock spy thriller aesthetic, 1950s sharp grey suit, Mount Rushmore backdrop, mid-century modern style, classic Hollywood glamour' },
  { title: 'Гражданин Кейн', titleEn: 'Citizen Kane', year: 1941,
    prompt: 'classic cinematic aesthetic, 1940s tuxedo, Xanadu mansion backdrop, dramatic deep focus photography, black and white, Welles style' },
  { title: 'Таксист', titleEn: 'Taxi Driver', year: 1976,
    prompt: '70s noir aesthetic, army jacket, rainy neon-lit New York streets at night, Scorsese gritty style, moody portrait' },
  { title: 'Большой куш', titleEn: 'Snatch', year: 2000,
    prompt: 'British crime comedy aesthetic, sharp suit, diamond and gold, fast-paced Guy Ritchie style, colorful eccentric portrait' },
  { title: 'Остров проклятых', titleEn: 'Shutter Island', year: 2010,
    prompt: 'psychological thriller aesthetic, 50s detective look, dark stormy island, mental asylum vibe, eerie Scorsese style' },
  { title: 'Аватар', titleEn: 'Avatar', year: 2009,
    prompt: 'alien sci-fi aesthetic, Pandora jungle, blue-skinned Na\'vi style, bioluminescent lighting, James Cameron epic' },
  { title: 'Назад в будущее', titleEn: 'Back to the Future', year: 1985,
    prompt: '80s sci-fi aesthetic, denim jacket and sneakers, retrofuture DeLorean vibe, bright 80s colors, fun nostalgic portrait' },
  { title: 'Семь', titleEn: 'Se7en', year: 1995,
    prompt: 'dark neo-noir thriller aesthetic, detective trench coat, rainy gritty city, green bleach bypass look, Fincher style' },
  { title: 'Титаник', titleEn: 'Titanic', year: 1997,
    prompt: 'epic romance aesthetic, early 1900s elegant attire, ship deck at sunset, grand staircase, sweeping Cameron portrait' },
  { title: 'Зелёная миля', titleEn: 'The Green Mile', year: 1999,
    prompt: 'depression-era prison aesthetic, 1930s guard uniform, warm amber lighting, emotional Frank Darabont style' },
  { title: 'Драйв', titleEn: 'Drive', year: 2011,
    prompt: 'neo-noir 80s synthwave aesthetic, satin jacket with scorpion, neon pink and teal lighting, LA at night' },
  { title: 'Престиж', titleEn: 'The Prestige', year: 2006,
    prompt: 'Victorian magic aesthetic, top hat and tuxedo, theatrical stage lighting, smoky moody atmosphere, Nolan mystery style' },
  { title: 'Молчание ягнят', titleEn: 'The Silence of the Lambs', year: 1991,
    prompt: 'psychological horror aesthetic, FBI agent look, dark interrogation room, greenish dim lighting, tense Demme style' },
  { title: 'Омерзительная восьмёрка', titleEn: 'The Hateful Eight', year: 2015,
    prompt: 'western snowbound aesthetic, cowboy hat and coat, blizzard cabin interior, warm firelight, Tarantino scope style' },
  { title: 'Бегущий по лезвию', titleEn: 'Blade Runner', year: 1982,
    prompt: 'cyberpunk noir aesthetic, rainy neon-lit streets, futuristic coat, dark and moody, Ridley Scott dystopian style' },
  { title: 'Гарри Поттер', titleEn: 'Harry Potter', year: 2001,
    prompt: 'magical wizard aesthetic, Hogwarts robe, castle corridor, warm candlelight, mystical fantasy portrait' },
  { title: 'Общество мёртвых поэтов', titleEn: 'Dead Poets Society', year: 1989,
    prompt: 'academic 50s aesthetic, prep school uniform, autumn forest, inspirational warm tone, Peter Weir style' },
  { title: 'Джанго освобождённый', titleEn: 'Django Unchained', year: 2012,
    prompt: 'spaghetti western aesthetic, 1850s style dandy suit, Southern plantation backdrop, bold Tarantino colors' },
  { title: 'Ла-Ла Ленд', titleEn: 'La La Land', year: 2016,
    prompt: 'vibrant musical aesthetic, colorful retro dress, LA sunset purple sky, dreamy romantic, Chazelle style' },
  { title: 'Трудности перевода', titleEn: 'Lost in Translation', year: 2003,
    prompt: 'dreamy Tokyo aesthetic, night city lights, neon Tokyo skyline, melancholic mood, Sofia Coppola style' },
  { title: 'Безумный Макс: Дорога ярости', titleEn: 'Mad Max: Fury Road', year: 2015,
    prompt: 'post-apocalyptic aesthetic, dusty wasteland gear, war paint, orange and blue color grade, intense action portrait' },
  { title: 'Прислуга', titleEn: 'The Help', year: 2011,
    prompt: '60s Southern aesthetic, pastel dress, kitchen setting, warm sunlight, nostalgic period portrait' },
  { title: 'Трейнспоттинг', titleEn: 'Trainspotting', year: 1996,
    prompt: '90s underground Scottish aesthetic, casual streetwear, gritty urban vibe, raw vibrant Boyle style portrait' },
  { title: 'Отступники', titleEn: 'The Departed', year: 2006,
    prompt: 'crime thriller aesthetic, Boston cop look, dark suit, tense atmospheric lighting, Scorsese grit' },
  { title: 'Амели', titleEn: 'Amélie', year: 2001,
    prompt: 'whimsical French romance aesthetic, vintage 1940s green dress, Parisian Montmartre backdrop, warm red and green color palette, Jean-Pierre Jeunet magical style' },
  { title: 'ВАЛЛ·И', titleEn: 'WALL·E', year: 2008,
    prompt: 'animated sci-fi aesthetic, rusty robot design, post-apocalyptic Earth rubble, desert orange tones, Pixar whimsical portrait' },
  { title: 'Жизнь других', titleEn: 'The Lives of Others', year: 2006,
    prompt: 'Cold War drama aesthetic, East Berlin 1980s, grey suit, drab apartment surveillance vibe, muted green and brown palette, oppressive mood' },
  { title: 'Лоуренс Аравийский', titleEn: 'Lawrence of Arabia', year: 1962,
    prompt: 'epic desert aesthetic, white Bedouin robe, vast golden desert landscape, dramatic wide-angle sun, David Lean epic style' },
  { title: 'Заводной апельсин', titleEn: 'A Clockwork Orange', year: 1971,
    prompt: 'dystopian aesthetic, white boiler suit with suspenders, bowler hat, droog makeup, surreal stark sets, Kubrick satirical style' },
  { title: 'Чужие', titleEn: 'Aliens', year: 1986,
    prompt: 'sci-fi action aesthetic, colonial marine armor, industrial spaceship corridors, blue-green cold lighting, James Cameron action-horror style' },
  { title: 'Жизнь прекрасна', titleEn: 'Life Is Beautiful', year: 1997,
    prompt: 'Italian Holocaust drama aesthetic, 1930s period suit, concentration camp striped uniform, bittersweet warm tone, Benigni emotional style' },
  { title: 'Бешеные псы', titleEn: 'Reservoir Dogs', year: 1992,
    prompt: 'cult crime aesthetic, black suit with skinny tie, dark warehouse setting, Tarantino early style, slow-motion cool vibe' },
  { title: 'Секреты Лос-Анджелеса', titleEn: 'L.A. Confidential', year: 1997,
    prompt: 'Hollywood noir aesthetic, 1950s detective suit, neon palm trees, vintage LA police badge, retro glamour crime style' },
  { title: 'Китайский квартал', titleEn: 'Chinatown', year: 1974,
    prompt: 'film noir aesthetic, 1930s Panama hat and suit, Los Angeles aqueduct backdrop, golden sepia tones, Polanski noir style' },
  { title: 'Вечное сияние чистого разума', titleEn: 'Eternal Sunshine of the Spotless Mind', year: 2004,
    prompt: 'surreal romantic aesthetic, colorful messy hair, dreamlike fading background, blue and pink tones, Gondry style' },
  { title: 'Отель Гранд Будапешт', titleEn: 'The Grand Budapest Hotel', year: 2014,
    prompt: 'Wes Anderson whimsical aesthetic, vintage hotel uniform, pastel pink and purple, symmetrical composition, storybook style' },
  { title: 'Реквием по мечте', titleEn: 'Requiem for a Dream', year: 2000,
    prompt: 'intense psychological aesthetic, extreme close-up style, harsh contrasts, claustrophobic Aronofsky style, dark portrait' },
  { title: 'В центре внимания', titleEn: 'Spotlight', year: 2015,
    prompt: 'investigative journalism aesthetic, smart casual office wear, warm naturalistic lighting, serious documentary style' },
  { title: 'Старикам тут не место', titleEn: 'No Country for Old Men', year: 2007,
    prompt: 'bleak Western noir aesthetic, dusty Texas landscape, sparse desert tones, Coen brothers stark style' },
  { title: '1+1', titleEn: 'The Intouchables', year: 2011,
    prompt: 'heartwarming French aesthetic, elegant Paris setting, casual chic style, warm sunny lighting, feel-good portrait' },
  { title: 'Город грехов', titleEn: 'Sin City', year: 2005,
    prompt: 'noir graphic novel aesthetic, high contrast black and white, splashes of red, trench coat, dark rainy streets' },
  { title: 'Рокки', titleEn: 'Rocky', year: 1976,
    prompt: 'boxing drama aesthetic, grey sweatsuit, Philadelphia streets, raw training gym, golden hour steps shot, underdog blue-collar style' },
  { title: 'Социальная сеть', titleEn: 'The Social Network', year: 2010,
    prompt: 'modern tech drama aesthetic, casual hoodie and flip-flops, Harvard campus backdrop, blue cold lighting, Fincher sharp dialogue style' },
  { title: 'Убить Билла', titleEn: 'Kill Bill: Vol. 1', year: 2003,
    prompt: 'martial arts aesthetic, yellow and black tracksuit, Hattori Hanzo sword, anime-inspired style, Tarantino mix of Japanese and spaghetti western' },
  { title: 'Пираты Карибского моря', titleEn: 'Pirates of the Caribbean', year: 2003,
    prompt: 'pirate adventure aesthetic, tricorn hat and pirate coat, ship deck backdrop, golden sunset over Caribbean sea, swashbuckling style' },
  { title: 'Дитя человеческое', titleEn: 'Children of Men', year: 2006,
    prompt: 'dystopian sci-fi aesthetic, refugee style worn clothing, grim urban London ruins, desaturated muted palette, Cuarón long-take realism' },
  { title: 'Игры разума', titleEn: 'A Beautiful Mind', year: 2001,
    prompt: 'biographical drama aesthetic, 50s professor tweed jacket, Princeton campus, chalkboard with equations, warm academic lighting' },
  { title: 'Человек дождя', titleEn: 'Rain Man', year: 1988,
    prompt: 'road trip drama aesthetic, 80s casual wear, vintage car backdrop, American highway landscape, warm nostalgic road movie feel' },
  { title: 'Король Лев', titleEn: 'The Lion King', year: 1994,
    prompt: 'animated African savanna aesthetic, Pride Rock backdrop, golden sunrise lighting, majestic wildlife theme, Disney epic animation style' },
  { title: 'В диких условиях', titleEn: 'Into the Wild', year: 2007,
    prompt: 'adventure aesthetic, rugged outdoor jacket, Alaska wilderness backdrop, golden forest lighting, Sean Penn wanderlust style' },
  { title: 'День сурка', titleEn: 'Groundhog Day', year: 1993,
    prompt: 'comedy aesthetic, winter coat and scarf, snowy small town vibe, Punxsutawney backdrop, cozy nostalgic 90s style' },
  { title: 'Район №9', titleEn: 'District 9', year: 2009,
    prompt: 'sci-fi dystopian aesthetic, gritty documentary style, alien refugee camp, Johannesburg backdrop, industrial orange tones, Neill Blomkamp style' },
  { title: 'V — значит вендетта', titleEn: 'V for Vendetta', year: 2006,
    prompt: 'dystopian aesthetic, Guy Fawkes mask, dark trench coat, London Parliament backdrop, rainy night, dark red and black palette' },
  { title: 'Как приручить дракона', titleEn: 'How to Train Your Dragon', year: 2010,
    prompt: 'animated viking fantasy aesthetic, fur and leather armor, dragon companion, Nordic fjord landscape, epic sky lighting, DreamWorks style' },
  { title: 'Мой сосед Тоторо', titleEn: 'My Neighbor Totoro', year: 1988,
    prompt: 'Studio Ghibli anime aesthetic, countryside Japan summer, traditional house, lush green forest, magical whimsical Studio Ghibli portrait' },
  { title: 'Умница Уилл Хантинг', titleEn: 'Good Will Hunting', year: 1997,
    prompt: 'Boston drama aesthetic, casual hoodies and jeans, South Boston streets, Harvard bar backdrop, warm emotional Gus Van Sant style' },
  { title: 'Шоу Трумана', titleEn: 'The Truman Show', year: 1998,
    prompt: 'satirical drama aesthetic, 50s retro casual wear, perfect suburban street, blue sky cyclorama, Peter Weir meta style' },
  { title: 'Суперсемейка', titleEn: 'The Incredibles', year: 2004,
    prompt: 'animated superhero aesthetic, retro 60s super suit design, mid-century modern architecture, bold red and black color palette, Pixar style' },
  { title: 'Ходячий замок', titleEn: 'Howl\'s Moving Castle', year: 2004,
    prompt: 'Studio Ghibli anime fantasy aesthetic, magical hat and cloak, colorful steam-punk backdrop, war-torn sky, Miyazaki whimsical style' },
  { title: 'Храброе сердце', titleEn: 'Braveheart', year: 1995,
    prompt: 'medieval epic aesthetic, blue woad war paint, Scottish kilt, misty Highland landscape, epic battle lighting, Gibson style' },
  { title: 'Большая рыба', titleEn: 'Big Fish', year: 2003,
    prompt: 'magical realism aesthetic, 50s southern suit, fantastical small town backdrop, vibrant colorful Burton style, whimsical storytelling portrait' },
  { title: 'Всё везде и сразу', titleEn: 'Everything Everywhere All at Once', year: 2022,
    prompt: 'surreal multiverse aesthetic, chaotic colorful costumes, tax office backdrop, googly eyes, hot dog fingers, absurdist maximalist style' },
  { title: 'Оппенгеймер', titleEn: 'Oppenheimer', year: 2023,
    prompt: 'historical drama aesthetic, 1940s hat and suit, Los Alamos desert backdrop, black and white and color mix, Nolan epic style' },
  { title: 'Королевство полной луны', titleEn: 'Moonrise Kingdom', year: 2012,
    prompt: 'Wes Anderson whimsical aesthetic, 60s boy scout uniform, New England coastal island, warm amber photography, nostalgic coming-of-age style' },
  { title: 'Шестое чувство', titleEn: 'The Sixth Sense', year: 1999,
    prompt: 'psychological thriller aesthetic, red sweater, cold breath visible, dim indoor lighting, M. Night Shyamalan eerie atmospheric style' }
];

/**
 * Выбрать случайный фильм из списка.
 * @returns {{title: string, titleEn: string, year: number, prompt: string}}
 */
function getRandomMovie() {
  return MOVIES[Math.floor(Math.random() * MOVIES.length)];
}

/**
 * Сгенерировать аватарку в стиле конкретного фильма.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {object} movie  — объект фильма из MOVIES
 * @param {string} outputDir
 * @returns {Promise<string>}  — путь к сгенерированному изображению
 */
async function generateCinemaAvatar(files, movie, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const stylePrompt = `cinematic movie still portrait in the style of the film "${movie.titleEn}" (${movie.year}): ${movie.prompt}. The person should look like a character from this movie, wearing appropriate costume for the film. High quality realistic photo, professional lighting, recognizable face.`;

  const count = files.length;
  const promptBase = count === 1
    ? `Transform this person into a character from the movie "${movie.titleEn}". ${stylePrompt}`
    : `Transform this person into a character from the movie "${movie.titleEn}". I'm providing ${count} photos of the same person — use ALL of them to capture their facial features accurately. ${stylePrompt}`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: {
      responseModalities: ['Image', 'Text'],
      temperature: 1,
      topK: 32,
      topP: 1
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  console.log(`🎬 Gemini: генерация в стиле фильма «${movie.title}»...`);

  const result = await apiCall(payload, extraConfig);

  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    throw new Error('Gemini не вернул изображение');
  }

  const ext = imagePart.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
  const outputPath = path.join(outputDir, `cinema_${movie.titleEn.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}${ext}`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Кино «${movie.title}»: ${outputPath} (${(imgBuffer.length / 1024).toFixed(1)} KB)`);
  return { path: outputPath, prompt };
}

// Локации — 100 знаменитых мировых мест
const { LOCATIONS } = require('./locations-data');

/**
 * Выбрать случайную локацию из списка.
 * @returns {{id: string, name: string, prompt: string}}
 */
function getRandomLocation() {
  return LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
}

/**
 * Сгенерировать аватарку на фоне знаменитой локации.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {object} location  — объект локации
 * @param {string} outputDir
 * @returns {Promise<string>}
 */
async function generateLocationAvatar(files, location, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const count = files.length;
  const promptBase = count === 1
    ? `Place this person as a tourist at this famous location: ${location.prompt}. Make it look like they are actually visiting this place. Keep the face recognizable, high quality realistic travel photo, natural lighting.`
    : `Place this person as a tourist at this famous location: ${location.prompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features accurately. Make it look like they are actually visiting this place. Keep the face recognizable, high quality realistic travel photo, natural lighting.`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: { responseModalities: ['Image', 'Text'], temperature: 1, topK: 32, topP: 1 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  console.log(`🌍 Gemini: генерация локации «${location.name}»...`);

  const result = await apiCall(payload, extraConfig);
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    throw new Error('Gemini не вернул изображение');
  }

  const outputPath = path.join(outputDir, `location_${location.id}_${Date.now()}.jpg`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Локация «${location.name}»: ${outputPath}`);
  return { path: outputPath, prompt };
}

// История — исторические эпохи
const { HISTORY } = require('./history-data');

/**
 * Выбрать случайную историческую эпоху из списка.
 * @returns {{id: string, name: string, prompt: string}}
 */
function getRandomHistory() {
  return HISTORY[Math.floor(Math.random() * HISTORY.length)];
}

/**
 * Сгенерировать аватарку в стиле исторической эпохи.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {object} era  — объект эпохи
 * @param {string} outputDir
 * @returns {Promise<string>}
 */
async function generateHistoryAvatar(files, era, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const count = files.length;
  const promptBase = count === 1
    ? `Transport this person into the historical era: ${era.prompt}. The person should look like they belong in this era, wearing appropriate period clothing and surrounded by authentic setting. The final image MUST be square 1:1 aspect ratio and look like an epic cinematic movie frame — dramatic lighting, film color grading, shallow depth of field, Hollywood historical film quality. Keep the face recognizable from the reference photo.`
    : `Transport this person into the historical era: ${era.prompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features accurately. The person should look like they belong in this era, wearing appropriate period clothing and surrounded by authentic setting. The final image MUST be square 1:1 aspect ratio and look like an epic cinematic movie frame — dramatic lighting, film color grading, shallow depth of field, Hollywood historical film quality. Keep the face recognizable from the reference photos.`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: {
      responseModalities: ['Image', 'Text'],
      temperature: 1,
      topK: 32,
      topP: 1
    },
    safetySettings: [

      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  console.log(`🎬 Gemini: генерация эпохи «${era.name}»...`);

  const result = await apiCall(payload, extraConfig);
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    throw new Error('Gemini не вернул изображение');
  }

  const outputPath = path.join(outputDir, `history_${era.id}_${Date.now()}.jpg`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ История «${era.name}»: ${outputPath}`);
  return { path: outputPath, prompt };
}

// ===================== Вспомогательное =====================

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.bmp': return 'image/bmp';
    default: return 'image/jpeg';
  }
}

function apiCall(payload, extraConfig) {
  // Если есть extra config (model, aspectRatio и т.п.) — встраиваем
  let modelName = MODEL;
  if (extraConfig) {
    const { model: extraModel, ...restConfig } = extraConfig;
    if (extraModel) modelName = extraModel;
    const parsed = JSON.parse(payload);
    if (parsed.generationConfig) {
      parsed.generationConfig = { ...parsed.generationConfig, ...restConfig };
    } else {
      parsed.generationConfig = restConfig;
    }
    payload = JSON.stringify(parsed);
  }

  return new Promise((resolve, reject) => {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`);
    url.searchParams.set('key', API_KEY);

    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 300000
      },
      (res) => {
        let data = '';
        console.log(`📥 Gemini HTTP ${res.statusCode}`);
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              console.error(`❌ Gemini HTTP ${res.statusCode}: ${data.slice(0, 500)}`);
            }
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`Gemini API: ${parsed.error.message} (${parsed.error.code})`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Gemini API parse error: ${data.slice(0, 300)}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini API timeout (>5 min)')); });
    req.write(payload);
    req.end();
  });
}

// ===================== CLI =====================

if (require.main === module) {
  const [,, command, ...args] = process.argv;

  if (command === 'upload') {
    const photoPath = args[0];
    if (!photoPath) {
      console.log('Использование: node scripts/generate-image.js upload <photoPath>');
      process.exit(1);
    }
    uploadPhoto(photoPath)
      .then(f => console.log(`✅ URI: ${f.uri}\n   Name: ${f.name}\n   Type: ${f.mimeType}`))
      .catch(err => { console.error('❌', err.message); process.exit(1); });
  } else if (command === 'generate') {
    const [fileUri, mimeType, styleId] = args;
    if (!fileUri || !mimeType || !styleId) {
      console.log('Использование: node scripts/generate-image.js generate <fileUri> <mimeType> <styleId>');
      console.log('Стили: portrait, sport, in_car, in_office, professions, cinema, location, history');
      process.exit(1);
    }
    const outputDir = path.join(__dirname, '..', 'photos', 'generated');
    fs.mkdirSync(outputDir, { recursive: true });
    generateAvatar([{ uri: fileUri, mimeType }], styleId, outputDir)
      .then(out => console.log(`✅ Результат: ${out}`))
      .catch(err => { console.error('❌', err.message); process.exit(1); });
  } else {
    console.log('Использование:');
    console.log('  node scripts/generate-image.js upload <photoPath>');
    console.log('  node scripts/generate-image.js generate <fileUri> <mimeType> <styleId>');
    process.exit(1);
  }
}

// Литература — литературные произведения
const { LITERATURE } = require('./literature-data');

/**
 * Выбрать случайное произведение из списка.
 * @returns {{id: string, name: string, prompt: string}}
 */
function getRandomLiterature() {
  return LITERATURE[Math.floor(Math.random() * LITERATURE.length)];
}

/**
 * Сгенерировать аватарку в стиле литературного произведения.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {object} work  — объект произведения
 * @param {string} outputDir
 * @returns {Promise<string>}
 */
async function generateLiteratureAvatar(files, work, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const count = files.length;
  const promptBase = count === 1
    ? `This person as a character from the literary work: ${work.prompt}. Cinematic movie frame quality, anamorphic look, dramatic film lighting, rich color grading, square 1:1 aspect ratio. The aesthetic should subtly reflect the era of the book — period-appropriate textures, lighting, and atmosphere. Keep face recognizable, high quality, like a shot from an award-winning film adaptation.`
    : `This person as a character from the literary work: ${work.prompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features accurately. Cinematic movie frame quality, anamorphic look, dramatic film lighting, rich color grading, square 1:1 aspect ratio. The aesthetic should subtly reflect the era of the book — period-appropriate textures, lighting, and atmosphere. Keep face recognizable, high quality, like a shot from an award-winning film adaptation.`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: { responseModalities: ['Image', 'Text'], temperature: 1, topK: 32, topP: 1 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  console.log(`📚 Gemini: генерация литературы «${work.name}»...`);

  const result = await apiCall(payload, extraConfig);
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    throw new Error('Gemini не вернул изображение');
  }

  const outputPath = path.join(outputDir, `literature_${work.id}_${Date.now()}.jpg`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Литература «${work.name}»: ${outputPath}`);
  return { path: outputPath, prompt };
}

/**
 * Режим бога — генерация по кастомному описанию.
 *
 * @param {Array<{uri: string, mimeType: string}>} files — массив file URI
 * @param {string} customPrompt  — описание от пользователя (до 250 символов)
 * @param {string} outputDir     — куда сохранить результат
 * @returns {Promise<string>}    — путь к сгенерированному изображению
 */
async function generateCustomAvatar(files, customPrompt, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  if (!files || files.length === 0) throw new Error('Нет фото для генерации');

  const count = files.length;
  const promptBase = count === 1
    ? `Transform this person's photo according to this description: ${customPrompt}. Keep the face recognizable, make it look like a high-quality professional photo.`
    : `Transform this person's photo according to this description: ${customPrompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features accurately. Keep the face recognizable, make it look like a high-quality professional photo.`;
  const prompt = applyQuality(promptBase, settings);

  const requestParts = files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
  requestParts.push({ text: prompt });
  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: { responseModalities: ['Image', 'Text'], temperature: 1, topK: 32, topP: 1 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  console.log(`🎮 Режим бога: ${customPrompt.slice(0, 100)}`);

  const result = await apiCall(payload, extraConfig);
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    console.error('⚠️ Полный ответ:', JSON.stringify(result).slice(0, 1000));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    const candidateSnippet = candidates ? JSON.stringify(candidates[0]).slice(0, 2000) : 'null';
    console.error(`🔍 Полный candidate: ${candidateSnippet}`);
    const reason = candidates?.[0]?.finishReason;
    const finishMsg = candidates?.[0]?.finishMessage || '';
    const userMsg = finishReasonMessage(reason);
    if (userMsg) {
      throw new Error(userMsg);
    }
    throw new Error('Gemini не вернул изображение');
  }

  const outputPath = path.join(outputDir, `godmode_${Date.now()}.jpg`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Режим бога: ${outputPath}`);
  return { path: outputPath, prompt };
}

// =====================
// Генерация без фото пользователя (режим «Без аватара»)
// =====================

/**
 * Сгенерировать изображение по стилю без использования фото пользователя.
 * @param {string} styleId — id стиля
 * @param {string} outputDir
 * @param {object} settings
 * @returns {Promise<{path: string, prompt: string}>}
 */
function getStyleContextPrompt(styleId) {
  const contextPrompts = {
    sport: 'The person is engaged in an athletic activity. Choose a popular sport.',
    in_office: 'The person is in a professional office environment.',
    professions: 'The person is dressed in a professional role (doctor, chef, pilot, engineer, etc.).',
    in_car: 'The person is sitting in a modern car, driver or passenger seat.',
    cinema: 'Cinematic movie still quality, dramatic lighting, like a scene from a Hollywood film.',
    location: 'The person is at a famous travel destination or scenic location.',
    history: 'The person is dressed in clothing from a historical era.',
    literature: 'The person looks like a character from a famous literary work.',
    portrait: 'Classic studio portrait.',
  };
  return contextPrompts[styleId] || '';
}

async function generateNoAvatarCustom(promptText, outputDir, settings) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');

  const prompt = applyQuality(
    `<start_of_image_generation>\n${promptText}\n<end_of_image_generation>\n\nMake it look like a high-quality realistic photo, photorealistic, professional photography.`, 
    settings
  );

  const requestParts = [{ text: prompt }];

  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  const payload = JSON.stringify({
    contents: [{ parts: requestParts }],
    generationConfig: { responseModalities: ['Image', 'Text'], temperature: 1, topK: 32, topP: 1 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  });

  console.log(`✍️ Без аватара: промпт «${promptText.slice(0, 80)}»...`);

  const result = await apiCall(payload, extraConfig);
  const candidates = result?.candidates;
  if (!candidates || candidates.length === 0) {
    const blocked = result?.promptFeedback?.blockReason;
    console.error('⚠️ Safety ratings:', JSON.stringify(result?.promptFeedback?.safetyRatings));
    throw new Error(blocked ? `Заблокировано: ${blocked}` : 'Нет кандидатов в ответе');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    // Логируем полный ответ для диагностики
    const candidateSnippet = candidates ? JSON.stringify(candidates[0]).slice(0, 2000) : 'null';
    console.error(`🔍 Полный candidate: ${candidateSnippet}`);
    const reason = candidates?.[0]?.finishReason;
    const finishMsg = candidates?.[0]?.finishMessage || '';
    const userMsg = finishReasonMessage(reason);
    if (userMsg) {
      throw new Error(userMsg);
    }
    throw new Error('Gemini не вернул изображение');
  }

  const outputPath = path.join(outputDir, `noavatar_prompt_${Date.now()}.jpg`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`✅ Без аватара промпт: ${outputPath}`);
  return { path: outputPath, prompt };
}

/**
 * Преобразовать finishReason Gemini в короткое сообщение для пользователя.
 */
function finishReasonMessage(reason) {
  if (reason === 'NO_IMAGE') {
    return 'Не смогли сгенерировать изображение, попробуйте еще раз.';
  }
  if (reason) {
    return 'Не смогли сгенерировать из-за ограничений нейросети. Попробуйте переформулировать запрос или использовать нейросеть Про.';
  }
  return null;
}

module.exports = { generateAvatar, generateProfessionAvatar, generateCinemaAvatar, generateSportAvatar, generateOfficeAvatar, generateLocationAvatar, generateHistoryAvatar, generateLiteratureAvatar, generateCustomAvatar, uploadPhoto, STYLE_PROMPTS, PROFESSIONS, SPORTS, OFFICE, MOVIES, LOCATIONS, HISTORY, LITERATURE, getRandomMovie, getRandomProfession, getRandomSport, getRandomOffice, getRandomLocation, getRandomHistory, getRandomLiterature, generateNoAvatarCustom };
