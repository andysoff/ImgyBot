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

const metrics = require('./metrics-ga4');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-image';

// Настройки для разных качеств
const QUALITY_HINTS = {
  economy: ', low quality, compressed, fast rendering',
  standard: '',
  premium: ', ultra high quality, maximum detail, 8K, professional photography grade, magazine quality'
};

// Типы портретного кадрирования
const FACE_TURN_HINTS = {
  front:                ', face directly facing camera, looking straight into the lens, both eyes and face symmetry fully visible',
  three_quarter:        ', face turned about 45 degrees from camera, three-quarter view, one eye closer to camera than the other, adds depth to the portrait',
  half_profile:         ', face turned about 75 degrees from camera, half-profile view, one side of face more prominent, dramatic look',
  profile:              ', face fully turned 90 degrees from camera, profile view, only one side of face visible, nose and chin in silhouette',
  three_quarter_back:   ', face turned about 135 degrees away from camera, three-quarter rear view, partially visible face looking back, intriguing and dynamic',
  over_shoulder:        ', person facing away from camera but looking back over shoulder, only partial face visible, creating a mysterious look over the shoulder'
};

const PORTRAIT_TYPE_HINTS = {
  headshot:  ', headshot composition, face directly facing camera, tightly framed head and shoulders, passport photo style',
  bust:      ', bust portrait composition, face with shoulders and upper chest visible in frame',
  shoulder:  ', shoulder-length portrait composition, face, neck and shoulders visible, emphasis on expression',
  waist:     ', waist-length portrait composition, from head to waist, person\'s posture and arms visible',
  full_body: ', full body portrait composition, entire body from head to toe, fashion photography style',
  close_up:  ', extreme close-up composition, intense focus on facial features, eyes, nose, mouth, skin texture'
};

// Стили → промпты
const STYLE_PROMPTS = {
  portrait: 'professional studio portrait photo, high quality, soft lighting, clean background, focus on face, magazine quality, realistic',
  portrait_classic: 'classic studio portrait, high quality, soft lighting, clean background, focus on face, magazine quality, realistic',
  portrait_business: 'professional corporate business portrait, formal business attire (suit and tie or blazer), clean minimal background, confident professional expression, soft studio lighting, high-end corporate headshot style, magazine quality, realistic photo',
  portrait_corporate: 'corporate executive portrait, business formal attire, professional office setting, confident and approachable expression, soft professional lighting, boardroom aesthetic, high quality realistic photo',
  portrait_image: 'prestige image portrait, editorial fashion quality, artistic lighting, sophisticated style, magazine cover aesthetic, high-end lifestyle photography, dramatic yet elegant, premium quality',
  sport: 'dynamic sporty portrait, athletic look, action pose, sportswear aesthetic, high energy, realistic photo, professional lighting',
  in_car: 'in a car, driver or passenger seat, automotive lifestyle, natural lighting through window, modern car interior, realistic photo, cinematic',
  in_office: 'professional office setting, business attire, desk and computer, natural office lighting, realistic photo',
  professions: 'person dressed in various professional roles (doctor in white coat with stethoscope, chef in kitchen, pilot uniform, engineer with hard hat, teacher at blackboard), high quality portrait, realistic photo, professional lighting, multiple career looks',
  cinema: 'cinematic movie still portrait, dramatic film lighting, anamorphic look, cinematic color grading, shallow depth of field, Hollywood movie scene aesthetic, widescreen composition, realistic photo, high quality'
};

// Shared variable for apiCall
let _callLabel = 'unknown';

// ======================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ======================================================================

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

function finishReasonMessage(reason, settings) {
  if (reason === 'NO_IMAGE') {
    return 'Не смогли сгенерировать изображение, попробуйте еще раз.';
  }
  if (reason) {
    const isPro = settings?.model === 'gemini-3-pro-image-preview';
    if (isPro) {
      return 'Не смогли сгенерировать из-за ограничений нейросети. Попробуйте переформулировать запрос.';
    }
    return 'Не смогли сгенерировать из-за ограничений нейросети. Попробуйте переформулировать запрос или использовать нейросеть Про.';
  }
  return null;
}

/**
 * Применить quality-хинты к промпту (для custom/no-avatar режимов).
 */
function applyQuality(prompt, settings, styleMode = false) {
  if (styleMode) return prompt;
  let result = prompt;
  const qualityHint = QUALITY_HINTS[settings?.quality] || '';
  result += qualityHint;
  return result;
}

/**
 * Получить контекстный промпт для стиля (режим без фото).
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
    portrait: 'Classic portrait, neutral background, professional studio lighting.',
  };
  return contextPrompts[styleId] || '';
}

// ======================================================================
// GEMINI API
// ======================================================================

function apiCall(payload, extraConfig) {
  const callStart = Date.now();
  const callLabel = _callLabel;
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
        headers: { 'Content-Type': 'application/json' },
        timeout: 300000
      },
      (res) => {
        let data = '';
        console.log(`📥 Gemini HTTP ${res.statusCode}`);
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const duration = Date.now() - callStart;
          try {
            if (res.statusCode !== 200) {
              console.error(`❌ Gemini HTTP ${res.statusCode}: ${data.slice(0, 500)}`);
              metrics.track('gemini:api_error', { model: modelName, status: String(res.statusCode), duration_ms: String(duration), label: callLabel });
            }
            const parsed = JSON.parse(data);
            if (parsed.error) {
              metrics.track('gemini:api_error', { model: modelName, status: String(res.statusCode), duration_ms: String(duration), label: callLabel, error: (parsed.error.message || '').slice(0, 100) });
              reject(new Error(`Gemini API: ${parsed.error.message} (${parsed.error.code})`));
            } else {
              const finishReason = parsed?.candidates?.[0]?.finishReason || '';
              metrics.track('gemini:api_success', { model: modelName, status: String(res.statusCode), duration_ms: String(duration), label: callLabel, finish_reason: finishReason });
              resolve(parsed);
            }
          } catch {
            metrics.track('gemini:api_error', { model: modelName, status: String(res.statusCode), duration_ms: String(duration), label: callLabel, error: 'parse_error' });
            reject(new Error(`Gemini API parse error: ${data.slice(0, 300)}`));
          }
        });
      }
    );

    req.on('error', (err) => {
      const duration = Date.now() - callStart;
      metrics.track('gemini:api_error', { model: modelName, status: '0', duration_ms: String(duration), label: callLabel, error: (err.message || '').slice(0, 100) });
      reject(err);
    });
    req.on('timeout', () => {
      const duration = Date.now() - callStart;
      metrics.track('gemini:api_error', { model: modelName, status: '0', duration_ms: String(duration), label: callLabel, error: 'timeout' });
      req.destroy();
      reject(new Error('Gemini API timeout (>5 min)'));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Загрузить фото в Gemini File API.
 */
async function uploadPhoto(photoPath) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');

  const stats = fs.statSync(photoPath);
  const mimeType = getMimeType(photoPath);
  const fileName = path.basename(photoPath);

  const startTime = Date.now();
  const fileSizeKB = (stats.size / 1024).toFixed(1);
  console.log(`📤 Gemini File API: загрузка ${fileName} (${fileSizeKB} KB)`);

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
    req.write(JSON.stringify({ file: { displayName: fileName } }));
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('File API init timeout')); });
    req.end();
  });

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

  const uploadDuration = Date.now() - startTime;
  metrics.track('gemini:file_upload', { file_name: fileName, file_size_kb: fileSizeKB, duration_ms: String(uploadDuration), mime_type: mimeType });
  console.log(`✅ Gemini File URI: ${fileInfo.uri || fileInfo.name}`);
  return { name: fileInfo.name, uri: fileInfo.uri, mimeType };
}

// ======================================================================
// ЕДИНАЯ ФУНКЦИЯ ГЕНЕРАЦИИ
// ======================================================================

/**
 * Извлечь изображение из ответа Gemini, сохранить на диск.
 */
function _extractImage(result, outputDir, filenameBase) {
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
    throw new Error(finishReasonMessage(reason, {}) || 'Gemini не вернул изображение');
  }

  const ext = imagePart.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
  const outputPath = path.join(outputDir, `${filenameBase}_${Date.now()}${ext}`);
  const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, imgBuffer);

  return { path: outputPath, buffer: imgBuffer };
}

/**
 * Выполнить запрос к Gemini API и получить изображение.
 *
 * @param {Object} opts
 * @param {Array<{uri:string,mimeType:string}>} [opts.files] - URI загруженных фото
 * @param {string} opts.prompt - промпт
 * @param {string} opts.outputDir - куда сохранить
 * @param {Object} opts.settings - настройки пользователя
 * @param {string} opts.metricsLabel - метка для метрик
 * @param {string} [opts.metricsStyle] - id стиля
 * @param {string} [opts.metricsSub] - подкатегория (profession id, movie title…)
 * @param {string} [opts.logMessage] - сообщение в консоль
 * @param {string} [opts.filenameBase] - префикс для имени файла (без даты и расширения)
 * @returns {Promise<{path:string, prompt:string}>}
 */
async function _callGemini(opts) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY не задан');
  fs.mkdirSync(opts.outputDir, { recursive: true });

  const { files, prompt, outputDir, settings, metricsLabel, metricsStyle, metricsSub, logMessage, filenameBase, chatId } = opts;
  const label = metricsLabel || 'generate';
  const fnameBase = filenameBase || 'generated';

  // Собираем части запроса
  const requestParts = files
    ? [...files.map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } })), { text: prompt }]
    : [{ text: prompt }];

  // Пэйлоад
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

  // extra config
  const extraConfig = {};
  if (settings?.aspectRatio) extraConfig.imageConfig = { aspectRatio: settings.aspectRatio };
  if (settings?.model) extraConfig.model = settings.model;

  _callLabel = label;
  console.log(`🎨 Gemini${logMessage ? ': ' + logMessage : ''}`);

  const genStart = Date.now();
  const result = await apiCall(payload, extraConfig);

  // Извлекаем изображение
  const { path: outputPath, buffer } = _extractImage(result, outputDir, fnameBase);

  const totalDuration = Date.now() - genStart;
  const imgSizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`✅ Готово: ${outputPath} (${imgSizeKB} KB)`);

  metrics.track('gemini:generation_success', {
    label,
    style: metricsStyle || '',
    sub: metricsSub || '',
    model: settings?.model || MODEL,
    duration_ms: String(totalDuration),
    img_size_kb: imgSizeKB
  });

  // Сохраняем последний промпт для кнопки «Повторить» — единая точка, внутри вызова Gemini
  if (chatId && prompt) {
    try {
      const convFile = path.join(__dirname, '..', 'data', 'conversations.json');
      const all = JSON.parse(fs.readFileSync(convFile, 'utf-8'));
      if (all[chatId]) {
        all[chatId].data = all[chatId].data || {};
        all[chatId].data.lastGeneratedPrompt = { text: prompt, styleId: metricsStyle || 'unknown' };
        fs.writeFileSync(convFile, JSON.stringify(all, null, 2) + '\n');
      }
    } catch (e) {
      console.warn('⚠️ Не удалось сохранить промпт для повтора:', e.message);
    }
  }

  return { path: outputPath, prompt };
}

// ======================================================================
// ВСПОМОГАТЕЛЬНАЯ: построение промптов
// ======================================================================

/**
 * Построить промпт для фото-стилей (все случаи, где есть файлы пользователя).
 * @param {string}   description - что сделать с человеком (стиль, роль, локация…)
 * @param {number}   count       - количество фото
 * @param {Object}   [extra]     - дополнительные опции
 * @param {string}   [extra.suffix] - суффикс после стандартного окончания
 * @returns {string} полный промпт
 */
function _buildPhotoPrompt(description, count, extra = {}) {
  const base = count === 1
    ? `Transform this person ${description}. Keep the face recognizable, make it look like a high-quality professional photo.`
    : `Transform this person ${description}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features, expressions and appearance accurately. Keep the face recognizable, make it look like a high-quality professional photo.`;
  return base + (extra.suffix || '');
}

// ======================================================================
// ПУБЛИЧНЫЕ ФУНКЦИИ (тонкие обёртки над _callGemini)
// ======================================================================

/**
 * Сгенерировать аватарку по стилю.
 */
async function generateAvatar(files, styleId, outputDir, settings, chatId) {
  const stylePrompt = STYLE_PROMPTS[styleId] || STYLE_PROMPTS.portrait;
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';

  const desc = `into an avatar with the following style: ${stylePrompt}${portraitTypeHint}${faceTurnHint}`;
  const prompt = _buildPhotoPrompt(desc, files.length);

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateAvatar:' + styleId,
    metricsStyle: styleId,
    logMessage: `генерация в стиле «${styleId}»`
  });
}

/**
 * Сгенерировать аватарку для случайной профессии.
 */
async function generateProfessionAvatar(files, profession, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `into the following professional role: ${profession.prompt}. The person should be the main subject dressed for this role.${portraitTypeHint}${faceTurnHint}`,
    files.length
  );

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateProfessionAvatar:' + profession.id,
    metricsStyle: 'professions',
    metricsSub: profession.id,
    logMessage: `генерация профессии «${profession.name}»`,
    filenameBase: 'profession_' + profession.id,
    chatId
  });
}

/**
 * Сгенерировать аватарку для случайного вида спорта.
 */
async function generateSportAvatar(files, sport, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `into a professional athlete in the following sport: ${sport.prompt}. The person should be the main subject playing this sport.${portraitTypeHint}${faceTurnHint}`,
    files.length
  );

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateSportAvatar:' + sport.id,
    metricsStyle: 'sport',
    metricsSub: sport.id,
    logMessage: `генерация спорта «${sport.name}»`,
    filenameBase: 'sport_' + sport.id,
    chatId
  });
}

/**
 * Сгенерировать аватарку для офисной роли.
 */
async function generateOfficeAvatar(files, work, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `in an office setting: ${work.prompt}. The person should be the main subject in this office environment.${portraitTypeHint}${faceTurnHint}`,
    files.length
  );

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateOfficeAvatar:' + work.id,
    metricsStyle: 'in_office',
    metricsSub: work.id,
    logMessage: `генерация офисной роли «${work.name}»`,
    filenameBase: 'office_' + work.id,
    chatId
  });
}

/**
 * Сгенерировать аватарку в стиле фильма.
 */
async function generateCinemaAvatar(files, movie, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const stylePrompt = `cinematic movie still portrait in the style of the film "${movie.titleEn}" (${movie.year}): ${movie.prompt}. The person should look like a character from this movie, wearing appropriate costume for the film. High quality realistic photo, professional lighting, recognizable face.${portraitTypeHint}${faceTurnHint}`;

  const desc = `into a character from the movie "${movie.titleEn}". ${stylePrompt}`;
  const prompt = _buildPhotoPrompt(desc, files.length);

  const filenameBase = 'cinema_' + movie.titleEn.replace(/[^a-z0-9]/gi, '_').toLowerCase();

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateCinemaAvatar:' + movie.titleEn,
    metricsStyle: 'cinema',
    metricsSub: movie.titleEn,
    logMessage: `генерация в стиле фильма «${movie.title}»`,
    filenameBase,
    chatId
  });
}

/**
 * Сгенерировать аватарку на фоне знаменитой локации.
 */
async function generateLocationAvatar(files, location, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `as a tourist at this famous location: ${location.prompt}. Make it look like they are actually visiting this place.${portraitTypeHint}${faceTurnHint}`,
    files.length
  );

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateLocationAvatar:' + location.id,
    metricsStyle: 'location',
    metricsSub: location.id,
    logMessage: `генерация локации «${location.name}»`,
    filenameBase: 'location_' + location.id,
    chatId
  });
}

/**
 * Сгенерировать аватарку в стиле исторической эпохи.
 */
async function generateHistoryAvatar(files, era, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `into the historical era: ${era.prompt}. The person should look like they belong in this era, wearing appropriate period clothing and surrounded by authentic setting. The final image MUST be square 1:1 aspect ratio and look like an epic cinematic movie frame — dramatic lighting, film color grading, shallow depth of field, Hollywood historical film quality. Keep the face recognizable from the reference photo.${portraitTypeHint}${faceTurnHint}`,
    files.length
  );

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateHistoryAvatar:' + era.id,
    metricsStyle: 'history',
    metricsSub: era.id,
    logMessage: `генерация эпохи «${era.name}»`,
    filenameBase: 'history_' + era.id,
    chatId
  });
}

/**
 * Сгенерировать аватарку в стиле литературного произведения.
 */
async function generateLiteratureAvatar(files, work, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `as a character from the literary work: ${work.prompt}. Cinematic movie frame quality, anamorphic look, dramatic film lighting, rich color grading, square 1:1 aspect ratio. The aesthetic should subtly reflect the era of the book — period-appropriate textures, lighting, and atmosphere. Keep face recognizable, high quality, like a shot from an award-winning film adaptation.${portraitTypeHint}${faceTurnHint}`,
    files.length
  );

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateLiteratureAvatar:' + work.id,
    metricsStyle: 'literature',
    metricsSub: work.id,
    logMessage: `генерация литературы «${work.name}»`,
    filenameBase: 'literature_' + work.id,
    chatId
  });
}

/**
 * Режим бога — генерация по кастомному описанию с использованием фото.
 */
async function generateCustomAvatar(files, customPrompt, outputDir, settings, chatId) {
  const count = files.length;
  const promptBase = count === 1
    ? `Transform this person's photo according to this description: ${customPrompt}. Keep the face recognizable, make it look like a high-quality professional photo.`
    : `Transform this person's photo according to this description: ${customPrompt}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features accurately. Keep the face recognizable, make it look like a high-quality professional photo.`;
  const prompt = applyQuality(promptBase, settings);

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateCustomAvatar',
    metricsStyle: 'custom_prompt',
    logMessage: `режим бога: «${customPrompt.slice(0, 80)}»`,
    filenameBase: 'godmode'
  });
}

/**
 * Генерация без фото пользователя (режим «Без аватара»).
 */
async function generateNoAvatarCustom(promptText, outputDir, settings, chatId) {
  const prompt = applyQuality(
    `${promptText}\n\nMake it look like a high-quality realistic photo, photorealistic, professional photography.`,
    settings
  );

  return _callGemini({
    prompt, outputDir, settings,
    metricsLabel: 'generateNoAvatarCustom',
    metricsStyle: 'no_avatar_custom',
    logMessage: `без аватара: «${promptText.slice(0, 80)}»`,
    filenameBase: 'noavatar_prompt'
  });
}

// ======================================================================
// ДАННЫЕ ДЛЯ СТИЛЕЙ
// ======================================================================

// Профессии
const PROFESSIONS = [
  { id: 'lawyer', name: '👨‍💼 Адвокат', prompt: 'person dressed as a lawyer in formal suit, law library or courtroom' },
  { id: 'acrobat', name: '🤸 Акробат', prompt: 'person as a circus acrobat in colorful costume, performing aerial tricks' },
  { id: 'actor', name: '🎭 Актер', prompt: 'person as a professional actor on stage or film set, costume and makeup, dramatic lighting' },
  { id: 'archaeologist', name: '🏺 Археолог', prompt: 'person as an archaeologist on a dig, khaki vest, brush and trowel, ancient ruins' },
  { id: 'architect', name: '👷‍♂️ Архитектор', prompt: 'person dressed as an architect with blueprint and rolled plans, modern office' },
  { id: 'astronomer', name: '🔭 Астроном', prompt: 'person dressed as an astronomer in casual wear, observatory with telescope under starry sky' },
  { id: 'nuclear_engineer', name: '☢️ Атомщик', prompt: 'person as a nuclear engineer in clean suit, reactor control room panels' },
  { id: 'barista', name: '☕ Бариста', prompt: 'person dressed as a barista in apron, coffee shop with espresso machine' },
  { id: 'biologist', name: '🧬 Биолог', prompt: 'person as a biologist in lab coat with microscope, plant specimens or petri dishes' },
  { id: 'flight_attendant', name: '✈️ Бортпроводник', prompt: 'person as a flight attendant in airline uniform with scarf, airplane cabin' },
  { id: 'veterinarian', name: '🐾 Ветеринар', prompt: 'person dressed as a veterinarian in medical coat, veterinary clinic with animal' },
  { id: 'veterinarian_2', name: '🐱 Ветеринар (хирург)', prompt: 'person as a veterinary surgeon in scrubs, operating on a pet in animal clinic' },
  { id: 'makeup_artist', name: '🎨 Визажист', prompt: 'person as a makeup artist with brush set, model chair and lighted mirror' },
  { id: 'bus_driver', name: '🚌 Водитель автобуса', prompt: 'person as a bus driver in uniform, behind the wheel of a city bus' },
  { id: 'scuba_diver', name: '🤿 Водолаз', prompt: 'person as a scuba diver in wetsuit with tank and mask, underwater coral reef' },
  { id: 'military_medic', name: '🚑 Военврач', prompt: 'person as a military medic in combat uniform with red cross, field hospital' },
  { id: 'soldier', name: '🎖️ Военный', prompt: 'person dressed in military uniform with medals, army base background' },
  { id: 'doctor', name: '👨‍⚕️ Врач', prompt: 'person dressed as a doctor in white medical coat with stethoscope, medical clinic background' },
  { id: 'genealogist', name: '📜 Генеалог', prompt: 'person as a genealogist at desk with old family documents and archives' },
  { id: 'surveyor', name: '📐 Геодезист', prompt: 'person as a land surveyor with theodolite tripod, field with construction markers' },
  { id: 'geologist', name: '⛰️ Геолог', prompt: 'person as a geologist in field vest with rock hammer, examining canyon strata' },
  { id: 'maid', name: '🧹 Горничная', prompt: 'person as a hotel maid with cleaning cart and uniform, hallway setting' },
  { id: 'loader', name: '📦 Грузчик', prompt: 'person as a warehouse loader in work vest, lifting boxes with forklift nearby' },
  { id: 'truck_driver', name: '🚛 Дальнобойщик', prompt: 'person as a truck driver in flannel shirt, behind wheel of big rig, highway' },
  { id: 'detective', name: '🔍 Детектив', prompt: 'person dressed as a detective in trench coat, dimly lit office with case board' },
  { id: 'dj', name: '🎧 Ди-джей', prompt: 'person as a DJ with headphones, turntables or mixer, club lights' },
  { id: 'diplomat', name: '🎩 Дипломат', prompt: 'person as a diplomat in elegant suit, handshake with flags behind, embassy setting' },
  { id: 'conductor', name: '🎵 Дирижёр', prompt: 'person as an orchestra conductor in tails, waving baton, symphony behind' },
  { id: 'delivery_driver', name: '📦 Доставщик', prompt: 'person as a delivery driver in company uniform with package, van or scooter' },
  { id: 'journalist', name: '📰 Журналист', prompt: 'person dressed as a journalist with notebook and press badge, newsroom' },
  { id: 'zoologist', name: '🦁 Зоолог', prompt: 'person as a zoologist with notebook, observing animals in zoo or wild' },
  { id: 'inventor', name: '💡 Изобретатель', prompt: 'person as an inventor in workshop with prototypes, gears, blueprints and tools' },
  { id: 'illusionist', name: '🎩 Иллюзионист', prompt: 'person as a stage magician in top hat, playing cards and dove, theater spotlight' },
  { id: 'engineer', name: '👷 Инженер', prompt: 'person dressed as an engineer with yellow hard hat and safety vest, construction site' },
  { id: 'ski_instructor', name: '⛷️ Инструктор по лыжам', prompt: 'person as a ski instructor in winter gear, snowy mountain slope' },
  { id: 'historian', name: '📚 Историк', prompt: 'person as a historian in tweed jacket, surrounded by antique books and scrolls' },
  { id: 'captain', name: '⚓ Капитан корабля', prompt: 'person as a ship captain in navy uniform with cap, on bridge of a ship' },
  { id: 'stuntman', name: '💥 Каскадёр', prompt: 'person as a stunt performer in protective pads, explosion or car jump set' },
  { id: 'cashier', name: '🛒 Кассир', prompt: 'person as a cashier at a checkout counter with cash register and groceries' },
  { id: 'dog_handler', name: '🐕 Кинолог', prompt: 'person as a dog trainer with a trained working dog, outdoor training ground' },
  { id: 'clown', name: '🤡 Клоун', prompt: 'person as a circus clown in colorful costume with red nose, face paint, big shoes' },
  { id: 'chef_2', name: '👨‍🍳 Кондитер', prompt: 'person dressed as a pastry chef in white uniform, bakery with cakes and pastries' },
  { id: 'cosmetologist', name: '💅 Косметолог', prompt: 'person as a cosmetologist in white coat, skincare tools, professional beauty studio' },
  { id: 'astronaut', name: '🧑‍🚀 Космонавт', prompt: 'person dressed as an astronaut in spacesuit, spacecraft background' },
  { id: 'crane_operator', name: '🏗️ Крановщик', prompt: 'person as a crane operator in cabin high above construction site, control levers' },
  { id: 'croupier', name: '🎲 Крупье', prompt: 'person as a casino croupier in vest and bow tie, green felt table with cards' },
  { id: 'courier', name: '🚴 Курьер', prompt: 'person as a bicycle courier in helmet and backpack, city street delivery' },
  { id: 'lab_technician', name: '🧪 Лаборант', prompt: 'person as a lab technician in white coat, working with test tubes and analyzer' },
  { id: 'forest_ranger', name: '🌲 Лесник', prompt: 'person as a forest ranger in green uniform, among tall trees with binoculars' },
  { id: 'linguist', name: '🗣️ Лингвист', prompt: 'person as a linguist with language books and audio equipment, studying speech patterns' },
  { id: 'massage_therapist', name: '💆 Массажист', prompt: 'person as a massage therapist in professional setting, massage table and oils' },
  { id: 'train_driver', name: '🚂 Машинист поезда', prompt: 'person as a train driver in uniform at the controls, cabin with speed gauges' },
  { id: 'nurse', name: '👩‍⚕️ Медсестра', prompt: 'person dressed as a nurse in medical scrubs, hospital room' },
  { id: 'manager', name: '💼 Менеджер', prompt: 'person as a business manager in suit with tablet, modern open office' },
  { id: 'meteorologist', name: '🌤️ Метеоролог', prompt: 'person as a meteorologist pointing at weather map, radar screens' },
  { id: 'mechanic', name: '🔧 Механик', prompt: 'person as an auto mechanic in coveralls with wrench, car engine bay' },
  { id: 'model', name: '👠 Модель', prompt: 'person as a fashion model on runway, designer clothes and dramatic lighting' },
  { id: 'fashion_designer', name: '👗 Модельер', prompt: 'person as a fashion designer in stylish outfit, mannequins and fabric rolls' },
  { id: 'video_editor', name: '🎬 Монтажёр', prompt: 'person as a video editor at workstation with editing timeline, color grading' },
  { id: 'sailor', name: '⛵ Моряк', prompt: 'person dressed as a sailor in navy uniform, ship deck with ocean' },
  { id: 'musician', name: '🎸 Музыкант', prompt: 'person dressed as a rock musician with instrument, concert stage lighting' },
  { id: 'neurologist', name: '🧠 Невролог', prompt: 'person as a neurologist in medical coat, brain scan images on screen' },
  { id: 'oceanographer', name: '🌊 Океанолог', prompt: 'person as an oceanographer on research vessel, sampling water with equipment' },
  { id: 'pilot_drone', name: '🕹️ Оператор БПЛА', prompt: 'person as a military drone operator at console, screens showing aerial view' },
  { id: 'drone_operator', name: '🛸 Оператор дрона', prompt: 'person as a drone pilot with controller, sky backdrop with quadcopter' },
  { id: 'event_planner', name: '🎉 Организатор мероприятий', prompt: 'person as an event planner with tablet, balloons and decorations, party venue' },
  { id: 'ornithologist', name: '🦅 Орнитолог', prompt: 'person as an ornithologist with binoculars, watching birds in nature reserve' },
  { id: 'waiter', name: '🍽️ Официант', prompt: 'person as a waiter in white shirt and bow tie with tray, fine dining restaurant' },
  { id: 'ophthalmologist', name: '👁️ Офтальмолог', prompt: 'person as an eye doctor with slit lamp, examining patient eye' },
  { id: 'hunter', name: '🏹 Охотник', prompt: 'person as a hunter in camouflage, with bow or rifle, forest wilderness' },
  { id: 'security_guard', name: '🛡️ Охранник', prompt: 'person as a security guard in uniform with earpiece, building entrance' },
  { id: 'paleontologist', name: '🦕 Палеонтолог', prompt: 'person as a paleontologist brushing dinosaur fossil, desert dig site' },
  { id: 'hairdresser', name: '✂️ Парикмахер', prompt: 'person as a hairdresser with scissors and comb, salon chair and mirrors' },
  { id: 'perfumer', name: '🌸 Парфюмер', prompt: 'person as a perfumer with glass vials of fragrance, lab bench with flowers' },
  { id: 'pathologist', name: '🔬 Патологоанатом', prompt: 'person as a pathologist in lab coat with microscope, tissue slides and samples' },
  { id: 'singer', name: '🎤 Певец', prompt: 'person as a singer on stage with microphone, concert lights and audience' },
  { id: 'translator', name: '🌐 Переводчик', prompt: 'person as a translator with headphones and microphone, interpretation booth' },
  { id: 'negotiator', name: '🎯 Переговорщик', prompt: 'person as a crisis negotiator in tactical gear, serious negotiation setting' },
  { id: 'pilot', name: '👨‍✈️ Пилот', prompt: 'person dressed as an airline pilot in uniform, cockpit background' },
  { id: 'pilot_helicopter', name: '🚁 Пилот вертолёта', prompt: 'person dressed as a helicopter pilot in flight suit and helmet, helipad' },
  { id: 'writer', name: '✍️ Писатель', prompt: 'person dressed as a writer in cozy attire, study room with bookshelves and typewriter' },
  { id: 'firefighter', name: '👨‍🚒 Пожарный', prompt: 'person dressed as a firefighter in protective gear with helmet, fire station' },
  { id: 'police', name: '👮 Полицейский', prompt: 'person dressed as a police officer in uniform, city street background' },
  { id: 'postman', name: '📬 Почтальон', prompt: 'person as a postman in uniform with mail bag, residential street with post boxes' },
  { id: 'poet', name: '✒️ Поэт', prompt: 'person as a poet by candlelight with quill and parchment, romantic study' },
  { id: 'programmer', name: '💻 Программист', prompt: 'person dressed as a programmer in casual attire, modern office with multiple monitors' },
  { id: 'producer', name: '🎥 Продюсер', prompt: 'person as a film producer on set with clapperboard, director chair and crew' },
  { id: 'prosecutor', name: '⚖️ Прокурор', prompt: 'person as a prosecutor in formal suit, podium in courtroom with jury' },
  { id: 'psychologist', name: '🧠 Психолог', prompt: 'person as a psychologist in cozy office, notebook and armchair, listening session' },
  { id: 'beekeeper', name: '🐝 Пчеловод', prompt: 'person as a beekeeper in protective suit with veil and gloves, bee hives in field' },
  { id: 'programmer_2', name: '🖥️ Разработчик', prompt: 'person as a software developer at desk with code on multiple monitors' },
  { id: 'editor', name: '📝 Редактор', prompt: 'person as an editor at desk with marked-up manuscripts, reading glasses, warm literary office' },
  { id: 'radiologist', name: '🩻 Рентгенолог', prompt: 'person as a radiologist examining X-ray images on light panel' },
  { id: 'restorer', name: '🏺 Реставратор', prompt: 'person as an art restorer with brush and microscope, restoring old painting' },
  { id: 'restaurateur', name: '🍷 Ресторатор', prompt: 'person as a restaurant owner in smart casual, elegant dining room with wine' },
  { id: 'fisherman', name: '🎣 Рыбак', prompt: 'person as a fisherman with rod and net, boat on a lake, sunrise' },
  { id: 'gardener', name: '🌱 Садовник', prompt: 'person as a gardener with pruning shears and watering can, blooming garden' },
  { id: 'plumber', name: '🔧 Сантехник', prompt: 'person as a plumber with wrench and pipe fittings, under sink or bathroom' },
  { id: 'sapper', name: '💣 Сапёр', prompt: 'person as a sapper in protective gear clearing landmines, military zone' },
  { id: 'welder', name: '💥 Сварщик', prompt: 'person as a welder with mask and torch, bright welding sparks, metal workshop' },
  { id: 'priest', name: '⛪ Священник', prompt: 'person as a priest in cassock and collar, church interior with stained glass' },
  { id: 'caregiver', name: '👵 Сиделка', prompt: 'person as a caregiver in medical scrubs, helping an elderly person, warm home setting' },
  { id: 'sculptor', name: '🗿 Скульптор', prompt: 'person dressed as a sculptor in work apron with chisel, studio with marble sculptures' },
  { id: 'locksmith', name: '🔐 Слесарь', prompt: 'person as a locksmith with tool belt, working on a lock or key' },
  { id: 'sociologist', name: '📊 Социолог', prompt: 'person as a sociologist analyzing survey data, research office with interview records' },
  { id: 'lifeguard', name: '🏊 Спасатель', prompt: 'person as a lifeguard in red shorts with whistle, elevated chair at beach or pool' },
  { id: 'rescuer', name: '⛑️ Спасатель МЧС', prompt: 'person as an emergency rescuer in bright orange uniform, disaster site with equipment' },
  { id: 'athlete', name: '🏆 Спортсмен', prompt: 'person dressed as a professional athlete in sportswear with medal, stadium' },
  { id: 'steelworker', name: '🔥 Сталевар', prompt: 'person as a steelworker in protective gear near furnace, glowing molten steel' },
  { id: 'comedian', name: '🎤 Стендап-комик', prompt: 'person as a stand-up comedian on stage with microphone, brick wall background' },
  { id: 'stylist', name: '💇 Стилист', prompt: 'person as a fashion stylist with clothing rack, mood boards and accessories' },
  { id: 'dentist', name: '🦷 Стоматолог', prompt: 'person as a dentist in white coat and mask, dental chair and instruments' },
  { id: 'builder', name: '🏗️ Строитель', prompt: 'person as a construction worker in hard hat and high-vis vest, building framework' },
  { id: 'forensic', name: '🔪 Судмедэксперт', prompt: 'person as a forensic expert in white protective suit, crime scene analysis' },
  { id: 'judge', name: '⚖️ Судья', prompt: 'person dressed as a judge in black robe, courtroom bench background' },
  { id: 'screenwriter', name: '✍️ Сценарист', prompt: 'person as a screenwriter typing on laptop, storyboard wall, creative office' },
  { id: 'taxi_driver', name: '🚕 Таксист', prompt: 'person as a taxi driver behind the wheel, city street night lights' },
  { id: 'customs', name: '🛃 Таможенник', prompt: 'person as a customs officer in uniform, passport control booth at airport' },
  { id: 'dancer', name: '💃 Танцор', prompt: 'person dressed as a dancer in elegant costume, stage with dramatic lighting' },
  { id: 'coach', name: '🏋️ Тренер', prompt: 'person as a sports coach in tracksuit with whistle, training athletes in gym' },
  { id: 'trainer', name: '🐬 Тренер животных', prompt: 'person as an animal trainer with dolphin or dog, performing arena' },
  { id: 'scientist', name: '🔬 Учёный', prompt: 'person dressed as a scientist in lab coat and goggles, laboratory with equipment' },
  { id: 'teacher', name: '👨‍🏫 Учитель', prompt: 'person dressed as a teacher in smart casual, classroom with blackboard' },
  { id: 'paramedic', name: '🚑 Фельдшер', prompt: 'person as a paramedic in uniform with medical bag, ambulance background' },
  { id: 'farmer', name: '👨‍🌾 Фермер', prompt: 'person dressed as a farmer in plaid shirt and overalls, rural farm landscape' },
  { id: 'physicist', name: '⚛️ Физик', prompt: 'person as a physicist with equations on blackboard, particle accelerator model' },
  { id: 'physiotherapist', name: '💪 Физиотерапевт', prompt: 'person as a physiotherapist in clinic, helping patient with exercise' },
  { id: 'philosopher', name: '🤔 Философ', prompt: 'person as a philosopher in thoughtful pose, library of ancient texts, statue background' },
  { id: 'fitness_instructor', name: '💪 Фитнес-инструктор', prompt: 'person as a fitness instructor in sportswear, gym with weights and mats' },
  { id: 'florist', name: '💐 Флорист', prompt: 'person as a florist in apron arranging a bouquet, colorful flower shop' },
  { id: 'photographer', name: '📸 Фотограф', prompt: 'person dressed as a photographer with professional camera, photo studio' },
  { id: 'chemist', name: '⚗️ Химик', prompt: 'person as a chemist in lab coat and goggles, colorful flasks and test tubes' },
  { id: 'surgeon', name: '🩺 Хирург', prompt: 'person dressed as a surgeon in scrubs and surgical mask, operating room light' },
  { id: 'surgeon_2', name: '🩺 Хирург (сердечно-сосудистый)', prompt: 'person as a cardiovascular surgeon in scrubs with surgery cap, operating room' },
  { id: 'choreographer', name: '💃 Хореограф', prompt: 'person as a choreographer in dance clothes, directing dancers in studio with mirrors' },
  { id: 'artist', name: '🎨 Художник', prompt: 'person dressed as an artist in paint-splattered smock, studio with easel' },
  { id: 'watchmaker', name: '⌚ Часовщик', prompt: 'person as a watchmaker with magnifying loupe, tiny gears and watch parts' },
  { id: 'miner', name: '⛏️ Шахтёр', prompt: 'person as a coal miner with hard hat lamp and pickaxe, underground tunnel' },
  { id: 'seamstress', name: '🧵 Швея', prompt: 'person as a seamstress at sewing machine with fabric, tailor shop with mannequins' },
  { id: 'chef', name: '👨‍🍳 Шеф-повар', prompt: 'person dressed as a chef in white kitchen uniform and chef hat, professional kitchen' },
  { id: 'navigator', name: '🧭 Штурман', prompt: 'person as a navigator with maps and compass, cockpit or bridge background' },
  { id: 'ecologist', name: '🌍 Эколог', prompt: 'person as an ecologist in field gear, clipboard with plant data, natural landscape' },
  { id: 'economist', name: '📊 Экономист', prompt: 'person as an economist in suit, pointing at charts and graphs on screens' },
  { id: 'tour_guide', name: '🚩 Экскурсовод', prompt: 'person as a tour guide with raised flag, leading group at historical landmark' },
  { id: 'electrician', name: '⚡ Электрик', prompt: 'person as an electrician in work clothes, tools and wiring, circuit breaker panel' },
  { id: 'jeweler', name: '💎 Ювелир', prompt: 'person as a jeweler at workbench with loupe, precious gems and rings under light' },
];

function getRandomProfession() {
  return PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)];
}

function getProfessionByIndex(index) {
  return PROFESSIONS[index] || null;
}

function getProfessionsPage(page, pageSize = 10) {
  const total = PROFESSIONS.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = PROFESSIONS.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

// Спорт
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

function getRandomSport() {
  return SPORTS[Math.floor(Math.random() * SPORTS.length)];
}

function getSportByIndex(index) {
  return SPORTS[index] || null;
}

function getSportsPage(page, pageSize = 10) {
  const total = SPORTS.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = SPORTS.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

// Офисные роли
const OFFICE = [
  { id: 'analyst', name: '📊 Аналитик', prompt: 'person as a data analyst, large screens with charts and graphs, modern analytical office' },
  { id: 'architect', name: '📐 Архитектор', prompt: 'person as an architect reviewing blueprints, scale models, modern design studio' },
  { id: 'consultant', name: '💼 Бизнес-консультант', prompt: 'person as a management consultant in smart suit, client presentation, boardroom' },
  { id: 'accountant', name: '🧮 Бухгалтер', prompt: 'person as an accountant with spreadsheets and calculator, organized desk, professional office' },
  { id: 'ceo', name: '👔 Генеральный директор', prompt: 'person as a confident CEO in expensive suit, corner office with city view, luxury executive desk' },
  { id: 'designer', name: '🎨 Дизайнер', prompt: 'person as a graphic designer at a large drawing tablet, creative mood board, colorful creative studio' },
  { id: 'purchasing', name: '🛒 Закупщик', prompt: 'person as a procurement specialist with supplier catalogs, negotiation desk' },
  { id: 'coworking', name: '💻 Коворкинг', prompt: 'person working in a modern coworking space with freelancers, casual attire, community atmosphere' },
  { id: 'copywriter', name: '✍️ Копирайтер', prompt: 'person as a copywriter typing on sleek laptop, editorial office, creative writing space' },
  { id: 'logistician', name: '🚚 Логист', prompt: 'person as a logistics coordinator at desk with route maps, dispatch screens, warehouse office' },
  { id: 'marketer', name: '📈 Маркетолог', prompt: 'person as a marketing specialist with analytics dashboard, creative agency office' },
  { id: 'sales', name: '📞 Менеджер по продажам', prompt: 'person as a sales manager on phone, CRM dashboard, energetic open office' },
  { id: 'manager', name: '📋 Менеджер проекта', prompt: 'person as a project manager with whiteboard, sticky notes, team meeting room' },
  { id: 'startup_founder', name: '🚀 Основатель стартапа', prompt: 'person as a startup founder in hoodie, pitching ideas, lean startup office with whiteboard' },
  { id: 'office_manager', name: '🏢 Офис-менеджер', prompt: 'person as an office manager organizing supplies, cozy well-maintained office space' },
  { id: 'product_owner', name: '📱 Продакт-менеджер', prompt: 'person as a product owner with sticky notes on wall, user stories, agile office setup' },
  { id: 'developer', name: '💻 Разработчик', prompt: 'person working as a software developer, multiple monitors with code, ergonomic chair, tech office' },
  { id: 'recruiter', name: '🔍 Рекрутер', prompt: 'person as a recruiter reviewing resumes on laptop, bright talent acquisition office' },
  { id: 'support', name: '🎧 Саппорт', prompt: 'person as a customer support agent with headset, dual monitors, call center setting' },
  { id: 'secretary', name: '📞 Секретарь', prompt: 'person as an administrative assistant at reception desk, phone and planner, modern lobby' },
  { id: 'sysadmin', name: '🖥️ Системный администратор', prompt: 'person as a sysadmin in server room, multiple screens with terminal, IT infrastructure' },
  { id: 'intern', name: '🎓 Стажёр', prompt: 'person as an intern in casual office wear, learning at desk with mentor, eager and fresh' },
  { id: 'financier', name: '💰 Финансист', prompt: 'person as a finance professional at Bloomberg terminal, stock market screens, bank office' },
  { id: 'lawyer', name: '⚖️ Юрист', prompt: 'person as a corporate lawyer in formal suit, legal documents, law firm office with bookshelves' },
  { id: 'hr_branding', name: '🌟 HR-брендинг', prompt: 'person as an employer branding specialist creating content, social media desk' },
  { id: 'hr', name: '👥 HR-менеджер', prompt: 'person as an HR manager at desk with files, bright welcoming office, interview room' },
  { id: 'pr_specialist', name: '📰 PR-специалист', prompt: 'person as a PR specialist at press conference, media contacts, professional communications' },
  { id: 'qa', name: '🐛 QA-инженер', prompt: 'person as a QA engineer testing software, bug tracking board, quality lab' },
  { id: 'ux_researcher', name: '🔬 UX-исследователь', prompt: 'person as a UX researcher conducting user interview, usability lab, research notes' },
];

function getRandomOffice() {
  return OFFICE[Math.floor(Math.random() * OFFICE.length)];
}

function getOfficeByIndex(index) {
  return OFFICE[index] || null;
}

function getOfficesPage(page, pageSize = 10) {
  const total = OFFICE.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = OFFICE.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

// Кино
const MOVIES = [
  { title: '1+1', titleEn: 'The Intouchables', year: 2011,
    prompt: 'heartwarming French aesthetic, elegant Paris setting, casual chic style, warm sunny lighting, feel-good portrait' },
  { title: '12 разгневанных мужчин', titleEn: '12 Angry Men', year: 1957,
    prompt: 'courtroom drama aesthetic, 1950s suits in jury room, claustrophobic single-room setting, harsh overhead lighting, black and white photography' },
  { title: 'Аватар', titleEn: 'Avatar', year: 2009,
    prompt: 'alien sci-fi aesthetic, Pandora jungle, blue-skinned Na\'vi style, bioluminescent lighting, James Cameron epic' },
  { title: 'Амели', titleEn: 'Amélie', year: 2001,
    prompt: 'whimsical French romance aesthetic, vintage 1940s green dress, Parisian Montmartre backdrop, warm red and green color palette, Jean-Pierre Jeunet magical style' },
  { title: 'Американская история X', titleEn: 'American History X', year: 1998,
    prompt: 'neo-nazi drama aesthetic, swastika tattoo, black and white flashback style, gritty streetwear, intense confrontational portrait' },
  { title: 'Апокалипсис сегодня', titleEn: 'Apocalypse Now', year: 1979,
    prompt: 'Vietnam war aesthetic, jungle fatigues, helicopter backdrop, orange napalm sky, surreal madness, Coppola psychological war style' },
  { title: 'Бегущий по лезвию', titleEn: 'Blade Runner', year: 1982,
    prompt: 'cyberpunk noir aesthetic, rainy neon-lit streets, futuristic coat, dark and moody, Ridley Scott dystopian style' },
  { title: 'Безумный Макс: Дорога ярости', titleEn: 'Mad Max: Fury Road', year: 2015,
    prompt: 'post-apocalyptic aesthetic, dusty wasteland gear, war paint, orange and blue color grade, intense action portrait' },
  { title: 'Бесславные ублюдки', titleEn: 'Inglourious Basterds', year: 2009,
    prompt: 'Tarantino WWII aesthetic, vintage military gear, dramatic cinema lighting, bold colors, tense portrait' },
  { title: 'Бешеные псы', titleEn: 'Reservoir Dogs', year: 1992,
    prompt: 'cult crime aesthetic, black suit with skinny tie, dark warehouse setting, Tarantino early style, slow-motion cool vibe' },
  { title: 'Бойцовский клуб', titleEn: 'Fight Club', year: 1999,
    prompt: 'dark grunge 90s aesthetic, gritty underground vibe, leather jacket, industrial lighting, edgy portrait' },
  { title: 'Большая рыба', titleEn: 'Big Fish', year: 2003,
    prompt: 'magical realism aesthetic, 50s southern suit, fantastical small town backdrop, vibrant colorful Burton style, whimsical storytelling portrait' },
  { title: 'Большой куш', titleEn: 'Snatch', year: 2000,
    prompt: 'British crime comedy aesthetic, sharp suit, diamond and gold, fast-paced Guy Ritchie style, colorful eccentric portrait' },
  { title: 'Бульвар Сансет', titleEn: 'Sunset Blvd.', year: 1950,
    prompt: 'Hollywood noir aesthetic, glamorous 40s attire, decaying mansion backdrop, dramatic black and white shadows, Billy Wilder cynical style' },
  { title: 'В диких условиях', titleEn: 'Into the Wild', year: 2007,
    prompt: 'adventure aesthetic, rugged outdoor jacket, Alaska wilderness backdrop, golden forest lighting, Sean Penn wanderlust style' },
  { title: 'В центре внимания', titleEn: 'Spotlight', year: 2015,
    prompt: 'investigative journalism aesthetic, smart casual office wear, warm naturalistic lighting, serious documentary style' },
  { title: 'ВАЛЛ·И', titleEn: 'WALL·E', year: 2008,
    prompt: 'animated sci-fi aesthetic, rusty robot design, post-apocalyptic Earth rubble, desert orange tones, Pixar whimsical portrait' },
  { title: 'Вечное сияние чистого разума', titleEn: 'Eternal Sunshine of the Spotless Mind', year: 2004,
    prompt: 'surreal romantic aesthetic, colorful messy hair, dreamlike fading background, blue and pink tones, Gondry style' },
  { title: 'Властелин колец', titleEn: 'The Lord of the Rings', year: 2001,
    prompt: 'epic fantasy aesthetic, medieval costume, majestic natural landscape, golden hour lighting, heroic portrait' },
  { title: 'Властелин колец: Возвращение короля', titleEn: 'The Lord of the Rings: The Return of the King', year: 2003,
    prompt: 'epic fantasy aesthetic, medieval royal armor, Minas Tirith backdrop, golden epic lighting, heroic festive portrait' },
  { title: 'Волк с Уолл-стрит', titleEn: 'The Wolf of Wall Street', year: 2013,
    prompt: 'luxury 90s aesthetic, sharp suit, excess and glamour, gold and blue tones, high-energy Scorsese portrait' },
  { title: 'Всё везде и сразу', titleEn: 'Everything Everywhere All at Once', year: 2022,
    prompt: 'surreal multiverse aesthetic, chaotic colorful costumes, tax office backdrop, googly eyes, hot dog fingers, absurdist maximalist style' },
  { title: 'Гарри Поттер', titleEn: 'Harry Potter', year: 2001,
    prompt: 'magical wizard aesthetic, Hogwarts robe, castle corridor, warm candlelight, mystical fantasy portrait' },
  { title: 'Гладиатор', titleEn: 'Gladiator', year: 2000,
    prompt: 'ancient Roman epic aesthetic, gladiator armor, golden sunset lighting, Colosseum backdrop, heroic Ridley Scott portrait' },
  { title: 'Город Бога', titleEn: 'City of God', year: 2002,
    prompt: 'Brazilian favela aesthetic, vibrant street style, colorful walls, harsh sunlight, documentary-style realism, energetic youthful portrait' },
  { title: 'Город грехов', titleEn: 'Sin City', year: 2005,
    prompt: 'noir graphic novel aesthetic, high contrast black and white, splashes of red, trench coat, dark rainy streets' },
  { title: 'Гражданин Кейн', titleEn: 'Citizen Kane', year: 1941,
    prompt: 'classic cinematic aesthetic, 1940s tuxedo, Xanadu mansion backdrop, dramatic deep focus photography, black and white, Welles style' },
  { title: 'День сурка', titleEn: 'Groundhog Day', year: 1993,
    prompt: 'comedy aesthetic, winter coat and scarf, snowy small town vibe, Punxsutawney backdrop, cozy nostalgic 90s style' },
  { title: 'Джанго освобождённый', titleEn: 'Django Unchained', year: 2012,
    prompt: 'spaghetti western aesthetic, 1850s style dandy suit, Southern plantation backdrop, bold Tarantino colors' },
  { title: 'Джокер', titleEn: 'Joker', year: 2019,
    prompt: 'gritty psychological aesthetic, 80s grimy Gotham, green and red tones, worn suit, dark staircase, unsettling portrait' },
  { title: 'Дитя человеческое', titleEn: 'Children of Men', year: 2006,
    prompt: 'dystopian sci-fi aesthetic, refugee style worn clothing, grim urban London ruins, desaturated muted palette, Cuarón long-take realism' },
  { title: 'Доктор Стрейнджлав', titleEn: 'Dr. Strangelove', year: 1964,
    prompt: 'Cold War satire aesthetic, military uniform, war room backdrop, black and white photography, Kubrick deadpan satirical style' },
  { title: 'Драйв', titleEn: 'Drive', year: 2011,
    prompt: 'neo-noir 80s synthwave aesthetic, satin jacket with scorpion, neon pink and teal lighting, LA at night' },
  { title: 'Жизнь других', titleEn: 'The Lives of Others', year: 2006,
    prompt: 'Cold War drama aesthetic, East Berlin 1980s, grey suit, drab apartment surveillance vibe, muted green and brown palette, oppressive mood' },
  { title: 'Жизнь прекрасна', titleEn: 'Life Is Beautiful', year: 1997,
    prompt: 'Italian Holocaust drama aesthetic, 1930s period suit, concentration camp striped uniform, bittersweet warm tone, Benigni emotional style' },
  { title: 'Заводной апельсин', titleEn: 'A Clockwork Orange', year: 1971,
    prompt: 'dystopian aesthetic, white boiler suit with suspenders, bowler hat, droog makeup, surreal stark sets, Kubrick satirical style' },
  { title: 'Звёздные войны', titleEn: 'Star Wars', year: 1977,
    prompt: 'sci-fi aesthetic, desert robe, Tatooine backdrop, golden warm lighting, classic 70s sci-fi portrait' },
  { title: 'Звёздные войны: Империя наносит ответный удар', titleEn: 'Star Wars: Episode V - The Empire Strikes Back', year: 1980,
    prompt: 'sci-fi aesthetic, rebel pilot or Jedi outfit, snowy Hoth landscape, blue cold lighting, classic 80s sci-fi portrait' },
  { title: 'Зелёная миля', titleEn: 'The Green Mile', year: 1999,
    prompt: 'depression-era prison aesthetic, 1930s guard uniform, warm amber lighting, emotional Frank Darabont style' },
  { title: 'Игры разума', titleEn: 'A Beautiful Mind', year: 2001,
    prompt: 'biographical drama aesthetic, 50s professor tweed jacket, Princeton campus, chalkboard with equations, warm academic lighting' },
  { title: 'Интерстеллар', titleEn: 'Interstellar', year: 2014,
    prompt: 'space epic aesthetic, astronaut suit, cosmic background, dramatic Nolan lighting, vast and lonely feel' },
  { title: 'Искатели потерянного ковчега', titleEn: 'Raiders of the Lost Ark', year: 1981,
    prompt: 'adventure aesthetic, leather jacket and fedora, jungle or temple backdrop, golden warm lighting, Spielberg action-adventure style' },
  { title: 'Как приручить дракона', titleEn: 'How to Train Your Dragon', year: 2010,
    prompt: 'animated viking fantasy aesthetic, fur and leather armor, dragon companion, Nordic fjord landscape, epic sky lighting, DreamWorks style' },
  { title: 'Касабланка', titleEn: 'Casablanca', year: 1942,
    prompt: 'classic noir romance aesthetic, 1940s trench coat and fedora, smoky nightclub backdrop, dramatic black and white shadows, Bogart style' },
  { title: 'Китайский квартал', titleEn: 'Chinatown', year: 1974,
    prompt: 'film noir aesthetic, 1930s Panama hat and suit, Los Angeles aqueduct backdrop, golden sepia tones, Polanski noir style' },
  { title: 'Королевство полной луны', titleEn: 'Moonrise Kingdom', year: 2012,
    prompt: 'Wes Anderson whimsical aesthetic, 60s boy scout uniform, New England coastal island, warm amber photography, nostalgic coming-of-age style' },
  { title: 'Король Лев', titleEn: 'The Lion King', year: 1994,
    prompt: 'animated African savanna aesthetic, Pride Rock backdrop, golden sunrise lighting, majestic wildlife theme, Disney epic animation style' },
  { title: 'Крёстный отец', titleEn: 'The Godfather', year: 1972,
    prompt: 'vintage mafia aesthetic, dark warm tones, 1970s style suit, dramatic chiaroscuro lighting, classic cinema portrait' },
  { title: 'Крёстный отец 2', titleEn: 'The Godfather: Part II', year: 1974,
    prompt: 'vintage mafia aesthetic, 1920s Sicily and 1950s Cuba, dark warm amber tones, period suits, dramatic shadows, epic crime portrait' },
  { title: 'Криминальное чтиво', titleEn: 'Pulp Fiction', year: 1994,
    prompt: '90s cult crime aesthetic, retro diner vibe, sharp suit with skinny tie, Tarantino style, vibrant colors' },
  { title: 'Ла-Ла Ленд', titleEn: 'La La Land', year: 2016,
    prompt: 'vibrant musical aesthetic, colorful retro dress, LA sunset purple sky, dreamy romantic, Chazelle style' },
  { title: 'Леон', titleEn: 'Léon: The Professional', year: 1994,
    prompt: 'cult assassin aesthetic, dark coat and hat, New York city backdrop, moody street lighting, French cinema style' },
  { title: 'Лоуренс Аравийский', titleEn: 'Lawrence of Arabia', year: 1962,
    prompt: 'epic desert aesthetic, white Bedouin robe, vast golden desert landscape, dramatic wide-angle sun, David Lean epic style' },
  { title: 'Матрица', titleEn: 'The Matrix', year: 1999,
    prompt: 'cyberpunk aesthetic, black leather trench coat, dark sunglasses, green tinted lighting, digital rain vibe, sci-fi portrait' },
  { title: 'Мой сосед Тоторо', titleEn: 'My Neighbor Totoro', year: 1988,
    prompt: 'Studio Ghibli anime aesthetic, countryside Japan summer, traditional house, lush green forest, magical whimsical Studio Ghibli portrait' },
  { title: 'Молчание ягнят', titleEn: 'The Silence of the Lambs', year: 1991,
    prompt: 'psychological horror aesthetic, FBI agent look, dark interrogation room, greenish dim lighting, tense Demme style' },
  { title: 'На север через северо-запад', titleEn: 'North by Northwest', year: 1959,
    prompt: 'Hitchcock spy thriller aesthetic, 1950s sharp grey suit, Mount Rushmore backdrop, mid-century modern style, classic Hollywood glamour' },
  { title: 'Назад в будущее', titleEn: 'Back to the Future', year: 1985,
    prompt: '80s sci-fi aesthetic, denim jacket and sneakers, retrofuture DeLorean vibe, bright 80s colors, fun nostalgic portrait' },
  { title: 'Начало', titleEn: 'Inception', year: 2010,
    prompt: 'sci-fi thriller aesthetic, surreal dreamscape vibe, sharp suit, blue-tinted lighting, Nolan cinematic style' },
  { title: 'Общество мёртвых поэтов', titleEn: 'Dead Poets Society', year: 1989,
    prompt: 'academic 50s aesthetic, prep school uniform, autumn forest, inspirational warm tone, Peter Weir style' },
  { title: 'Одержимость', titleEn: 'Whiplash', year: 2014,
    prompt: 'intense jazz aesthetic, dark stage lighting, sweat and passion, drumsticks, dramatic spotlight, gritty portrait' },
  { title: 'Однажды на Диком Западе', titleEn: 'Once Upon a Time in the West', year: 1968,
    prompt: 'spaghetti western aesthetic, dusty duster coat and wide-brim hat, railroad backdrop, golden sunset, Sergio Leone epic widescreen' },
  { title: 'Окно во двор', titleEn: 'Rear Window', year: 1954,
    prompt: 'Hitchcock noir aesthetic, 1950s casual attire, apartment courtyard backdrop, warm golden lighting, voyeuristic mood, classic Hollywood style' },
  { title: 'Омерзительная восьмёрка', titleEn: 'The Hateful Eight', year: 2015,
    prompt: 'western snowbound aesthetic, cowboy hat and coat, blizzard cabin interior, warm firelight, Tarantino scope style' },
  { title: 'Оппенгеймер', titleEn: 'Oppenheimer', year: 2023,
    prompt: 'historical drama aesthetic, 1940s hat and suit, Los Alamos desert backdrop, black and white and color mix, Nolan epic style' },
  { title: 'Остров проклятых', titleEn: 'Shutter Island', year: 2010,
    prompt: 'psychological thriller aesthetic, 50s detective look, dark stormy island, mental asylum vibe, eerie Scorsese style' },
  { title: 'Отель Гранд Будапешт', titleEn: 'The Grand Budapest Hotel', year: 2014,
    prompt: 'Wes Anderson whimsical aesthetic, vintage hotel uniform, pastel pink and purple, symmetrical composition, storybook style' },
  { title: 'Отступники', titleEn: 'The Departed', year: 2006,
    prompt: 'crime thriller aesthetic, Boston cop look, dark suit, tense atmospheric lighting, Scorsese grit' },
  { title: 'Паразиты', titleEn: 'Parasite', year: 2019,
    prompt: 'Korean thriller aesthetic, contrast between rich and poor, moody lighting, rainy city streets, Bong Joon-ho style' },
  { title: 'Пираты Карибского моря', titleEn: 'Pirates of the Caribbean', year: 2003,
    prompt: 'pirate adventure aesthetic, tricorn hat and pirate coat, ship deck backdrop, golden sunset over Caribbean sea, swashbuckling style' },
  { title: 'Побег из Шоушенка', titleEn: 'The Shawshank Redemption', year: 1994,
    prompt: 'prison drama aesthetic, warm amber tones, stone walls, hope and redemption atmosphere, realistic character portrait' },
  { title: 'Подозрительные лица', titleEn: 'The Usual Suspects', year: 1995,
    prompt: 'crime noir aesthetic, dark interrogation room, trench coat, dramatic low-key lighting, smoky atmosphere, Singer neo-noir style' },
  { title: 'Помни', titleEn: 'Memento', year: 2000,
    prompt: 'psychological thriller aesthetic, Polaroid instant photos, neo-noir lighting, disjointed dark aesthetic, Christopher Nolan style' },
  { title: 'Престиж', titleEn: 'The Prestige', year: 2006,
    prompt: 'Victorian magic aesthetic, top hat and tuxedo, theatrical stage lighting, smoky moody atmosphere, Nolan mystery style' },
  { title: 'Прислуга', titleEn: 'The Help', year: 2011,
    prompt: '60s Southern aesthetic, pastel dress, kitchen setting, warm sunlight, nostalgic period portrait' },
  { title: 'Пролетая над гнездом кукушки', titleEn: 'One Flew Over the Cuckoo\'s Nest', year: 1975,
    prompt: 'mental institution aesthetic, 1960s hospital pajamas, stark white walls, institutional green tiles, harsh fluorescent lighting, rebellious spirit' },
  { title: 'Психо', titleEn: 'Psycho', year: 1960,
    prompt: 'Hitchcock horror aesthetic, 1950s attire, dark motel setting, black and white photography, shower scene shadows, eerie gothic mood' },
  { title: 'Район №9', titleEn: 'District 9', year: 2009,
    prompt: 'sci-fi dystopian aesthetic, gritty documentary style, alien refugee camp, Johannesburg backdrop, industrial orange tones, Neill Blomkamp style' },
  { title: 'Реквием по мечте', titleEn: 'Requiem for a Dream', year: 2000,
    prompt: 'intense psychological aesthetic, extreme close-up style, harsh contrasts, claustrophobic Aronofsky style, dark portrait' },
  { title: 'Рокки', titleEn: 'Rocky', year: 1976,
    prompt: 'boxing drama aesthetic, grey sweatsuit, Philadelphia streets, raw training gym, golden hour steps shot, underdog blue-collar style' },
  { title: 'Секреты Лос-Анджелеса', titleEn: 'L.A. Confidential', year: 1997,
    prompt: 'Hollywood noir aesthetic, 1950s detective suit, neon palm trees, vintage LA police badge, retro glamour crime style' },
  { title: 'Семь', titleEn: 'Se7en', year: 1995,
    prompt: 'dark neo-noir thriller aesthetic, detective trench coat, rainy gritty city, green bleach bypass look, Fincher style' },
  { title: 'Семь самураев', titleEn: 'Seven Samurai', year: 1954,
    prompt: 'samurai epic aesthetic, traditional kimono and katana, feudal Japan countryside, black and white photography, Kurosawa dramatic style' },
  { title: 'Славные парни', titleEn: 'Goodfellas', year: 1990,
    prompt: 'mafia aesthetic, 70s Italian-American style suit, Copacabana nightclub vibe, warm amber lighting, Scorsese long-take energy' },
  { title: 'Социальная сеть', titleEn: 'The Social Network', year: 2010,
    prompt: 'modern tech drama aesthetic, casual hoodie and flip-flops, Harvard campus backdrop, blue cold lighting, Fincher sharp dialogue style' },
  { title: 'Спасти рядового Райана', titleEn: 'Saving Private Ryan', year: 1998,
    prompt: 'war epic aesthetic, military uniform, gritty battle-worn look, muted desaturated colors, Spielberg cinematic style' },
  { title: 'Список Шиндлера', titleEn: 'Schindler\'s List', year: 1993,
    prompt: 'Holocaust drama aesthetic, 1940s period clothing, black and white photography, muted tones with red accent, Spielberg emotional style' },
  { title: 'Старикам тут не место', titleEn: 'No Country for Old Men', year: 2007,
    prompt: 'bleak Western noir aesthetic, dusty Texas landscape, sparse desert tones, Coen brothers stark style' },
  { title: 'Суперсемейка', titleEn: 'The Incredibles', year: 2004,
    prompt: 'animated superhero aesthetic, retro 60s super suit design, mid-century modern architecture, bold red and black color palette, Pixar style' },
  { title: 'Таксист', titleEn: 'Taxi Driver', year: 1976,
    prompt: '70s noir aesthetic, army jacket, rainy neon-lit New York streets at night, Scorsese gritty style, moody portrait' },
  { title: 'Тёмный рыцарь', titleEn: 'The Dark Knight', year: 2008,
    prompt: 'dark noir superhero aesthetic, Gotham city vibe, dramatic low-key lighting, blue-black color palette, gritty urban portrait' },
  { title: 'Титаник', titleEn: 'Titanic', year: 1997,
    prompt: 'epic romance aesthetic, early 1900s elegant attire, ship deck at sunset, grand staircase, sweeping Cameron portrait' },
  { title: 'Трейнспоттинг', titleEn: 'Trainspotting', year: 1996,
    prompt: '90s underground Scottish aesthetic, casual streetwear, gritty urban vibe, raw vibrant Boyle style portrait' },
  { title: 'Трудности перевода', titleEn: 'Lost in Translation', year: 2003,
    prompt: 'dreamy Tokyo aesthetic, night city lights, neon Tokyo skyline, melancholic mood, Sofia Coppola style' },
  { title: 'Убить Билла', titleEn: 'Kill Bill: Vol. 1', year: 2003,
    prompt: 'martial arts aesthetic, yellow and black tracksuit, Hattori Hanzo sword, anime-inspired style, Tarantino mix of Japanese and spaghetti western' },
  { title: 'Умница Уилл Хантинг', titleEn: 'Good Will Hunting', year: 1997,
    prompt: 'Boston drama aesthetic, casual hoodies and jeans, South Boston streets, Harvard bar backdrop, warm emotional Gus Van Sant style' },
  { title: 'Унесённые призраками', titleEn: 'Spirited Away', year: 2001,
    prompt: 'Studio Ghibli magical aesthetic, whimsical spirit world vibe, colorful traditional Japanese elements, dreamlike portrait' },
  { title: 'Форрест Гамп', titleEn: 'Forrest Gump', year: 1994,
    prompt: 'wholesome American aesthetic, 50s-70s era styling, soft warm lighting, bench scene vibe, nostalgic portrait' },
  { title: 'Ходячий замок', titleEn: 'Howl\'s Moving Castle', year: 2004,
    prompt: 'Studio Ghibli anime fantasy aesthetic, magical hat and cloak, colorful steam-punk backdrop, war-torn sky, Miyazaki whimsical style' },
  { title: 'Хороший, плохой, злой', titleEn: 'The Good, the Bad and the Ugly', year: 1966,
    prompt: 'spaghetti western aesthetic, cowboy hat and poncho, arid desert landscape, harsh golden sunlight, dramatic Ennio Morricone vibe' },
  { title: 'Храброе сердце', titleEn: 'Braveheart', year: 1995,
    prompt: 'medieval epic aesthetic, blue woad war paint, Scottish kilt, misty Highland landscape, epic battle lighting, Gibson style' },
  { title: 'Человек дождя', titleEn: 'Rain Man', year: 1988,
    prompt: 'road trip drama aesthetic, 80s casual wear, vintage car backdrop, American highway landscape, warm nostalgic road movie feel' },
  { title: 'Чужие', titleEn: 'Aliens', year: 1986,
    prompt: 'sci-fi action aesthetic, colonial marine armor, industrial spaceship corridors, blue-green cold lighting, James Cameron action-horror style' },
  { title: 'Шестое чувство', titleEn: 'The Sixth Sense', year: 1999,
    prompt: 'psychological thriller aesthetic, red sweater, cold breath visible, dim indoor lighting, M. Night Shyamalan eerie atmospheric style' },
  { title: 'Шоу Трумана', titleEn: 'The Truman Show', year: 1998,
    prompt: 'satirical drama aesthetic, 50s retro casual wear, perfect suburban street, blue sky cyclorama, Peter Weir meta style' },
  { title: 'Это прекрасная жизнь', titleEn: 'It\'s a Wonderful Life', year: 1946,
    prompt: 'classic American aesthetic, 1940s suit, snowy small town backdrop, warm nostalgic lighting, black and white, Capra wholesome style' },
  { title: 'V — значит вендетта', titleEn: 'V for Vendetta', year: 2006,
    prompt: 'dystopian aesthetic, Guy Fawkes mask, dark trench coat, London Parliament backdrop, rainy night, dark red and black palette' }
];;

function getRandomMovie() {
  return MOVIES[Math.floor(Math.random() * MOVIES.length)];
}

function getMovieByIndex(index) {
  return MOVIES[index] || null;
}

function getMoviesPage(page, pageSize = 10) {
  const total = MOVIES.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = MOVIES.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

// Локации
const { LOCATIONS } = require('./locations-data');

// Автомобильные бренды и модели
const { CAR_BRANDS } = require('./cars-data');
function getRandomLocation() {
  return LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
}

function getLocationByIndex(index) {
  return LOCATIONS[index] || null;
}

function getLocationsPage(page, pageSize = 10) {
  const total = LOCATIONS.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = LOCATIONS.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

// Исторические эпохи
const { HISTORY } = require('./history-data');
function getRandomHistory() {
  return HISTORY[Math.floor(Math.random() * HISTORY.length)];
}

function getHistoryByIndex(index) {
  return HISTORY[index] || null;
}

function getHistoryPage(page, pageSize = 10) {
  const total = HISTORY.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = HISTORY.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

// Литературные произведения
const { LITERATURE } = require('./literature-data');
function getRandomLiterature() {
  return LITERATURE[Math.floor(Math.random() * LITERATURE.length)];
}

// Около машины
function getCarBrandByIndex(index) {
  return CAR_BRANDS[index] || null;
}

function getCarBrandsPage(page, pageSize = 10) {
  const total = CAR_BRANDS.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = CAR_BRANDS.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

function getModelsForBrand(brandId, page, pageSize = 10) {
  const brand = CAR_BRANDS.find(b => b.id === brandId);
  if (!brand) return { items: [], page: 0, totalPages: 0, total: 0, brand: null };
  const total = brand.models.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = brand.models.slice(start, start + pageSize);
  return { items, page, totalPages, total, brand };
}

function getRandomCarModel() {
  const brand = CAR_BRANDS[Math.floor(Math.random() * CAR_BRANDS.length)];
  const model = brand.models[Math.floor(Math.random() * brand.models.length)];
  return { brand, model };
}

async function generateCarAvatar(files, brand, model, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `${model.prompt}, front grille and headlights clearly visible, car logo and badge prominent, professional automotive photography, sharp detailed front view showing the make and model of the car, model standing next to the front hood or near the driver door, stylish streetwear fashion, urban setting bright day, high-end luxury car photo shoot, person and car both in frame, car front half fully in shot${portraitTypeHint}${faceTurnHint}`,
    files.length
  );
  console.log(`🎨 Генерация авто: ${brand.name} ${model.name}`);
  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateCarAvatar:' + brand.id,
    metricsStyle: 'near_car',
    metricsSub: brand.id + '_' + model.id,
    logMessage: `генерация «${brand.name} ${model.name}»`,
    filenameBase: 'car_' + brand.id + '_' + model.id,
    chatId
  });
}

function getLiteratureByIndex(index) {
  return LITERATURE[index] || null;
}

function getLiteraturePage(page, pageSize = 10) {
  const total = LITERATURE.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = LITERATURE.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

// ======================================================================
// CLI
// ======================================================================

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

// ======================================================================
// EXPORTS
// ======================================================================

/**
 * Универсальная генерация по готовому промпту.
 * Подходит для повтора — нужен только финальный текст промпта.
 */
async function generateWithPrompt(files, prompt, outputDir, settings, chatId) {
  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateWithPrompt',
    metricsStyle: 'repeat',
    logMessage: 'повтор по сохранённому промпту',
    filenameBase: 'repeat_generated',
    chatId
  });
}

module.exports = {
  // Единая генерация
  generateWithPrompt,
  generateAvatar,
  generateProfessionAvatar,
  generateCinemaAvatar,
  generateSportAvatar,
  generateOfficeAvatar,
  generateLocationAvatar,
  generateHistoryAvatar,
  generateLiteratureAvatar,
  generateCustomAvatar,
  generateNoAvatarCustom,
  // Вспомогательное
  uploadPhoto,
  // Данные
  STYLE_PROMPTS,
  PROFESSIONS, SPORTS, OFFICE, MOVIES, LOCATIONS, HISTORY, LITERATURE,
  // Рандомайзеры
  getRandomMovie,
  getMovieByIndex,
  getMoviesPage,
  getRandomProfession,
  getProfessionByIndex,
  getProfessionsPage,
  getRandomSport,
  getSportByIndex,
  getSportsPage,
  getRandomOffice,
  getOfficeByIndex,
  getOfficesPage,
  getRandomLocation,
  getLocationByIndex,
  getLocationsPage,
  getRandomHistory,
  getHistoryByIndex,
  getHistoryPage,
  getRandomLiterature,
  getLiteratureByIndex,
  getLiteraturePage,
  // Около машины
  CAR_BRANDS,
  getCarBrandByIndex,
  getCarBrandsPage,
  getModelsForBrand,
  getRandomCarModel,
  generateCarAvatar,
  FACE_TURN_HINTS,
  PORTRAIT_TYPE_HINTS
};
