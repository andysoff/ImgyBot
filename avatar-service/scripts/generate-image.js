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
let openaiGen = null;
try {
  if (process.env.OPENAI_API_KEY) {
    openaiGen = require('./generate-image-openai');
  }
} catch (e) {
  console.warn('⚠️ OpenAI модуль не загружен:', e.message);
}
const MODEL = 'gemini-3.1-flash-image-preview';

// Настройки для разных качеств
const QUALITY_HINTS = {
  economy: ', low quality, compressed, fast rendering',
  standard: '',
  premium: ', ultra high quality, maximum detail, 8K, professional photography grade, magazine quality'
};

// Типы портретного кадрирования
const FACE_TURN_HINTS = {
  none:                 '',
  front:                ', face directly facing camera, looking straight into the lens, both eyes and face symmetry fully visible',
  three_quarter:        ', face turned about 45 degrees from camera, three-quarter view, one eye closer to camera than the other, adds depth to the portrait',
  half_profile:         ', face turned about 75 degrees from camera, half-profile view, one side of face more prominent, dramatic look',
  profile:              ', face fully turned 90 degrees from camera, profile view, only one side of face visible, nose and chin in silhouette',
  three_quarter_back:   ', face turned about 135 degrees away from camera, three-quarter rear view, partially visible face looking back, intriguing and dynamic',
  over_shoulder:        ', person facing away from camera but looking back over shoulder, only partial face visible, creating a mysterious look over the shoulder'
};

const PORTRAIT_TYPE_HINTS = {
  none:      '',
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
  portrait_corporate_dark: 'formal corporate studio portrait, professional attire (suit, blazer, or dress shirt, tie optional), dark monochrome solid background, refined studio lighting with subtle rim light, confident poised expression, premium corporate headshot style, exquisite studio quality, realistic photo, impeccable lighting',
  portrait_corporate_light: 'formal corporate studio portrait, professional attire (suit, blazer, or dress shirt, tie optional), light monochrome clean background, soft diffused studio lighting, bright and polished atmosphere, confident approachable expression, premium corporate headshot style, exquisite studio quality, realistic photo, impeccable lighting',
  portrait_corporate_office: 'formal corporate studio portrait, professional attire (suit, blazer, or dress shirt, tie optional), modern office interior background with windows and furniture, polished mixed lighting, confident professional expression, executive presence, premium corporate style, exquisite studio quality, realistic photo, professional studio-grade lighting',
  portrait_corporate_bw: 'formal black and white corporate studio portrait, professional attire (suit, blazer, or dress shirt, tie optional), classic studio setting with a clean solid monochrome background, studio-quality soft diffused lighting, soft low contrast with even and balanced exposure, gentle tonal range, timeless elegant black and white aesthetic, confident professional expression, premium corporate headshot style, realistic photo, impeccable studio lighting',
  portrait_corporate_chair: 'formal corporate studio portrait, professional attire (suit, blazer, or dress shirt, tie optional), sitting on a chair in a photo studio (random: high bar stool, modern office chair, designer chair, wooden chair), studio professional lighting, clean studio background, can be color or black and white, confident professional expression, premium corporate style, realistic photo',

  classic_dark: 'professional classic portrait, smart business casual attire (dress shirt only, no tie, no jacket), dark monochrome solid background, soft studio lighting, confident relaxed expression, clean and minimalist aesthetic, magazine quality, realistic photo',
  classic_light: 'professional classic portrait, smart business casual attire (dress shirt only, no tie, no jacket), light monochrome clean background, soft diffused studio lighting, bright and fresh atmosphere, confident relaxed expression, clean and minimalist aesthetic, magazine quality, realistic photo',
  classic_office: 'professional classic portrait, smart business casual attire (dress shirt only, no tie, no jacket), modern office interior background with windows and furniture, natural and artificial mixed lighting, confident relaxed expression, approachable professional look, magazine quality, realistic photo',
  classic_bw: 'professional black and white classic portrait, smart business casual attire (dress shirt only, no tie, no jacket), classic studio setting with a clean solid monochrome background, studio-quality soft diffused professional lighting, even and balanced exposure, timeless elegant black and white aesthetic, confident relaxed expression, magazine quality, realistic photo',
  classic_chair: 'professional classic portrait, smart business casual attire (dress shirt only, no tie, no jacket), sitting on a chair in a photo studio (random: high bar stool, modern office chair, designer chair, wooden chair), studio professional lighting, clean studio background, can be color or black and white, confident relaxed expression, classic business portrait style, realistic photo',

  casual_dark: 'casual lifestyle portrait, relaxed everyday clothing (t-shirt, sweater, hoodie, jeans, hoodie), dark monochrome smooth solid background, soft studio diffused lighting with subtle side rim light, relaxed natural expression, modern casual portrait aesthetic, realistic photo, exquisite studio quality, impeccable lighting, no earrings no jewelry no accessories no extra adornments, simple natural look',
  casual_light: 'casual lifestyle portrait, relaxed everyday clothing (t-shirt, sweater, hoodie, jeans, hoodie), light monochrome clean solid background, soft bright diffused studio lighting, relaxed natural candid expression, bright and fresh atmosphere, modern casual portrait style, realistic photo, high quality photography, no earrings no jewelry no accessories no extra adornments, simple natural look',
  casual_office: 'casual lifestyle portrait, relaxed everyday clothing (t-shirt, sweater, hoodie, jeans, hoodie), modern office interior background with desks chairs and computers, natural and artificial mixed lighting, relaxed natural expression, casual work atmosphere, modern casual lifestyle, realistic photo, high quality photography, no earrings no jewelry no accessories no extra adornments, simple natural look, absolutely no text no timestamps no dates no clocks no writing of any kind on the image or on any objects in the scene, computer screen is blank or shows only abstract blurred content',
  casual_bw: 'casual black and white studio portrait, relaxed everyday clothing (t-shirt, sweater, hoodie, jeans, hoodie), sitting on a chair in a photo studio (random: wooden chair, high stool, designer chair, armchair), classic studio lighting, clean solid monochrome studio background, even and balanced exposure, timeless black and white aesthetic, relaxed natural expression, modern casual portrait, realistic photo, no earrings no jewelry no accessories no extra adornments, simple natural look',
  casual_home: 'casual lifestyle portrait at home, relaxed everyday clothing (t-shirt, sweater, hoodie, jeans, joggers), cozy home interior background (living room sofa, bedroom, hallway, kitchen), warm soft natural window light, relaxed candid expression, comfortable homely atmosphere, modern casual lifestyle photography, realistic photo, high quality photography, no earrings no jewelry no accessories no extra adornments, simple natural look',

  sport: 'dynamic sporty portrait, athletic look, action pose, sportswear aesthetic, high energy, realistic photo, professional lighting',
  in_car: 'in a car, driver or passenger seat, automotive lifestyle, natural lighting through window, modern car interior, realistic photo, cinematic',
  in_office: 'professional office setting, business attire, desk and computer, natural office lighting, realistic photo',
  professions: 'person dressed in various professional roles (doctor in white coat with stethoscope, chef in kitchen, pilot uniform, engineer with hard hat, teacher at blackboard), high quality portrait, realistic photo, professional lighting, multiple career looks',
  cinema: 'cinematic movie still portrait, dramatic film lighting, anamorphic look, cinematic color grading, shallow depth of field, Hollywood movie scene aesthetic, widescreen composition, realistic photo, high quality',

  // ==== РЕТРО ====
  retro_gatsby: 'retro 1920s gangster era / great gatsby portrait, authentic 1920s period clothing: three-piece pinstripe suits, fedora hats, bow ties, suspenders, slicked-back hair, finger-wave hairstyles, vintage sepia color grading with warm tones, soft dramatic vignette, visible film grain consistent with 1920s photography, classic portrait lighting of the era, the entire image should look like a real vintage historical photograph from the 1920s, not modern — authentic period atmosphere in every detail, 1920s aesthetic',
  retro_rockabilly: 'retro 1950s rockabilly / americana portrait, authentic 1950s period clothing: leather jackets, denim jeans, white t-shirts, rolled sleeves, flannel shirts, pompadour hairstyles, poodle skirts, retro diner or car setting, warm slightly faded color palette, visible period film grain, vibrant but era-accurate amateur photography look, 1950s snapshot aesthetic, the entire image should look like a real vintage 1950s photograph from a family album, saturated yet authentic to the era',
  retro_hippie: 'retro 1960s hippie / woodstock era portrait, authentic 1960s period clothing: tie-dye tie-dyed shirts, bell-bottom jeans, fringed suede vests, headbands, round wireframe sunglasses, long natural hair, bead necklaces, earthy warm color palette with 1960s film color shift, soft film grain, natural outdoor sunlight, spontaneous candid look, the entire image should look like a real period photograph from the 1960s counterculture movement, authentic woodstock era atmosphere',
  retro_disco: 'retro 1970s disco era portrait, authentic 1970s period clothing: wide-lapel satin shirts, flared bell-bottom trousers, platform shoes, afro hairstyles, feathered hair, shiny polyester fabrics, bold geometric patterns, warm golden amber color palette, characteristic 1970s amber-tinted color cast, disco ball light reflections and sparkles, soft halation glow, period-specific film stock texture, the entire image should look like a real 1970s disco nightclub photograph, authentic vibrant nightlife atmosphere',
  retro_synthwave: 'retro 1980s synthwave / miami vice era portrait, authentic 1980s period clothing: oversized blazers with rolled sleeves, pastel colored t-shirts, white linen suits, big voluminous hair, brightly colored makeup, aviator sunglasses, pastel and neon color palette with magenta cyan and teal tones, slight soft glow halation characteristic of 1980s film and early video, period-perfect commercial and snapshot photography look, the entire image should look like a real 1980s photograph from a shopping mall portrait studio or vacation snapshot',
  retro_90s: 'retro 1990s grunge / vhs era portrait, authentic 1990s period clothing: flannel shirts worn open over band t-shirts, ripped jeans, denim jackets, baggy cargo pants, chokers, snapback caps, Dr. Martens boots, warm desaturated slightly muddy color palette with brownish-orange tones characteristic of 1990s disposablen point-and-shoot film cameras, strong visible film grain, slight softness and vhs-era artifacts in the image, the entire image should look like a real 1990s amateur photograph taken with a disposable camera at a school event or concert',
  retro_vintage: 'vintage turn-of-the-century antique portrait, authentic 19th to early 20th century period clothing: stiff high starched collars, formal tailored waistcoats and frock coats, corsets, high-neck blouses with lace collars, bonnets and hats, formal rigid upright posture, sepia black and white or slightly hand-tinted color, heavy film grain with visible texture, strong soft vignette, shallow depth of focus, subtle surface imperfections and scratches characteristic of old photographic plates, the entire image should look like a real historical daguerreotype tintype or cabinet card photograph from the 1800s or early 1900s, museum-quality vintage reproduction',
  retro_soviet: 'retro soviet union ussr era portrait, authentic soviet period clothing: pioneer uniform with bright red necktie and white shirt, military dress uniforms, worker overalls with caps, school uniforms with white aprons, ushanka fur hats, leather bomber jackets, soviet cosmonaut outfit, slightly washed-out color palette with subdued greens blues and warm browns characteristic of soviet-era photographic film, heavy visible film grain with slight lens softness and chromatic aberration, period-accurate amateur and official photography lighting, the entire image should look like a real photograph from the soviet era, authentic ussr atmosphere from the mid 20th century',

  // ==== FASHION ====
  fashion_editorial: 'high fashion editorial portrait, premium studio photography, dramatic directional lighting with deep shadows and sharp highlights, sophisticated high-fashion clothing and styling, editorial poses with attitude and confidence, impeccable professional hair and makeup, clean studio background with creative lighting setup, premium fashion editorial aesthetic, high-end photography with artistic composition, flawless skin texture yet natural, no text no letters no typography no logos no labels anywhere on the image, no magazine cover layout or captions, blank clean aesthetic with only the person, pure fashion editorial without any inscriptions',
  fashion_street: 'high fashion street style portrait, luxury casual clothing and accessories like designer coats tailored blazers premium denim statement handbags and sunglasses, natural outdoor lighting with city or street background, candid yet composed pose with movement and attitude, on-location urban setting, edgy sophisticated effortless look, street fashion photography aesthetic, high quality photography, no text no letters no typography no logos no labels anywhere on the image, no street signs or text on buildings, pure street fashion without any inscriptions',
  fashion_beauty: 'high fashion beauty close-up portrait, extreme close-up or tight headshot framing, flawless perfected skin with natural texture, emphasis on makeup artistry — bold lipstick defined brows contoured cheeks smoky eyes or editorial makeup looks, impeccable hair styling, soft diffused studio lighting that flatters facial features, subtle retouching maintaining skin realism, high-end beauty photography, no text no letters no typography no logos no labels anywhere on the image, no magazine cover layout or cosmetics branding, pure beauty portrait without any inscriptions',
  fashion_glamour: 'high fashion glamour portrait, luxurious evening wear: silk gowns sequined dresses velvet tuxedos statement jewelry, old Hollywood and modern red carpet glamour aesthetic, warm golden studio lighting with soft reflections and sparkle, polished sophisticated pose with elegance and confidence, impeccable styling with glossy polished finish, luxurious atmosphere, premium lifestyle photography, no text no letters no typography no logos no labels anywhere on the image, no magazine text or event branding, pure glamour portrait without any inscriptions',
  fashion_avantgarde: 'avant-garde high fashion art portrait, experimental conceptual fashion photography, unconventional silhouettes and architectural clothing, creative experimental studio lighting with colored gels geometric shadows and unusual light patterns, artistic and surreal aesthetic, bold makeup and styling, striking unusual poses, creative photography with strong visual impact, no text no letters no typography no logos no labels anywhere on the image, no magazine captions or titles, pure avant-garde art photography without any inscriptions',

  // ==== WARHAMMER 40,000 ====
  warhammer_ultramarines: 'warhammer 40k ultramarines space marine portrait, character in blue and gold power armor with ultramarines chapter iconography, gothic cathedral aesthetic background, dramatic grimdark lighting, imperial warhammer 40k aesthetic, cinematic sci-fi portrait, realistic photo, high detail, warhammer 40k universe atmosphere',
  warhammer_bloodangels: 'warhammer 40k blood angels space marine portrait, character in red power armor with blood angels iconography, gothic cathedral background, sanguinary priest aesthetic, dramatic grimdark lighting, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_spacewolves: 'warhammer 40k space wolves space marine portrait, character in grey-blue power armor with space wolves iconography, viking norse aesthetic, wolf pelts and talismans, icy grimdark background, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_darkangels: 'warhammer 40k dark angels space marine portrait, character in dark green power armor with dark angels chapter iconography, knightly monastic aesthetic, hooded robes, mysterious grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_blacktemplars: 'warhammer 40k black templars space marine portrait, character in black power armor with black templars chapter iconography, crusader knight aesthetic, tabards and crosses, righteous grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_salamanders: 'warhammer 40k salamanders space marine portrait, character in green power armor with salamanders chapter iconography, black skin, red eyes, fiery forge aesthetic, volcanic grimdark background, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_deathwatch: 'warhammer 40k deathwatch space marine portrait, character in black power armor with silver left arm, deathwatch shoulder pauldron with inquisition iconography, alien hunter aesthetic, dark grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_worldeaters: 'warhammer 40k world eaters chaos space marine portrait, character in red bloodstained power armor with khorne iconography, berserker chainaxes and spikes, skulls and brass trim, chaotic brutal grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_deathguard: 'warhammer 40k death guard chaos space marine portrait, character in pale green corroded power armor with nurgle iconography, plague aesthetic, rot decay and tentacles, bloated and decayed grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_thousandsons: 'warhammer 40k thousand sons chaos space marine portrait, character in blue and gold ornate power armor with tzeentch iconography, egyptian sorcerer aesthetic, magical glows and mutations, mystical grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_emperorschildren: 'warhammer 40k emperor\'s children chaos space marine portrait, character in purple and gold power armor with slaanesh iconography, perfectionist hedonist aesthetic, extravagant decorations and spikes, sensual decadent grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_blacklegion: 'warhammer 40k black legion chaos space marine portrait, character in black and gold power armor with chaos undivided iconography, abaddon the despoiler aesthetic, trophies and dark runes, commanding grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_wordbearers: 'warhammer 40k word bearers chaos space marine portrait, character in dark grey power armor with red inscriptions and chaos iconography, dark apostle aesthetic, holy texts and censers, fanatical grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_sororitas: 'warhammer 40k sisters of battle adeptas sororitas portrait, character in red and white power armor with ecclesiarchy iconography, battle sister aesthetic, bolter and faith, gothic cathedral background, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_mechanicus: 'warhammer 40k adeptus mechanicus tech-priest portrait, character in red mechanicus robes with mechanical augmentations, cybernetic implants and mechadendrites, cog iconography, forge world grimdark aesthetic, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_guard: 'warhammer 40k astra militarum imperial guard portrait, character in imperial guard flak armor with cadian or vostroyan aesthetic, lasgun and military gear, trench warfare grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_greyknights: 'warhammer 40k grey knights space marine portrait, character in silver power armor with purity seals and psykic iconography, daemon hunter paladin aesthetic, glowing force weapons, holy grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_custodes: 'warhammer 40k adeptus custodes portrait, character in magnificent golden auramite armor with aquila iconography, emperor\'s personal guardian aesthetic, guardian spear, imperial palace background, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_knights: 'warhammer 40k imperial knights portrait, character piloting or standing before a massive knight titan war machine, heraldic knightly aesthetic, giant mech with banners and crown, epic scale grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_ork: 'warhammer 40k ork portrait, character transformed into a massive green-skinned ork warboss, crude spiky metal armor, teef and war paint, waaagh energy, scrap technology aesthetic, brutal grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_necron: 'warhammer 40k necron portrait, character transformed into an ancient necron warrior or overlord, skeletal metal body with green glowing energy, gauss weaponry, egyptian android aesthetic, ancient tomb world grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_eldar: 'warhammer 40k aeldari portrait, character transformed into an elegant eldar aspect warrior or farseer, wraithbone armor with soul stones, graceful elf-like aesthetic, psychic energy glows, craftworld grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_tau: 'warhammer 40k tau empire portrait, character in tau battle armor with sleek futuristic design, medical and military aesthetic, blue skin tone, drone companions, clean geometric background, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_harlequin: 'warhammer 40k harlequin portrait, character in diamond patterned harlequin bodysuit, laughing god theatrical aesthetic, holographic shimmering colors, acrobatic pose, masque of the laughing god, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_tyranids: 'warhammer 40k tyranid portrait, character transformed into a tyranid hive tyrant or warrior, chitinous bone armor with organic blade limbs, hive mind alien aesthetic, xenos organic horror, grimdark cosmic horror atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_genestealers: 'warhammer 40k genestealer cult portrait, character transformed into a genestealer hybrid cultist, miner gear mixed with xenos mutations, extra arm and alien features, industrial grimdark background, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_drukhari: 'warhammer 40k drukhari dark eldar portrait, character transformed into a drukhari kabalite or wych, spiked dark armor with blades and hooks, sinister elf-like aesthetic, webway portal background, cruel grimdark atmosphere, warhammer 40k cinematic portrait, realistic photo, high detail',
  warhammer_votann: 'warhammer 40k leagues of votann portrait, character transformed into a stout votann warrior, heavy exo-armor with ancestral iconography, plasma weapons and mining gear, dwarven space aesthetic, grimdark atmospheric, warhammer 40k cinematic portrait, realistic photo, high detail'
};

// Женские версии корпоративных стилей (без галстука и брюк, с юбкой)
const STYLE_PROMPTS_FEMALE = {
  portrait_corporate_dark: 'formal corporate studio portrait, professional women\'s corporate attire (elegant blouse, professional skirt, blazer optional, no tie, no trousers), dark monochrome solid background, refined studio lighting with subtle rim light, confident poised expression, premium corporate headshot style, exquisite studio quality, realistic photo, impeccable lighting',
  portrait_corporate_light: 'formal corporate studio portrait, professional women\'s corporate attire (elegant blouse, professional skirt, blazer optional, no tie, no trousers), light monochrome clean background, soft diffused studio lighting, bright and polished atmosphere, confident approachable expression, premium corporate headshot style, exquisite studio quality, realistic photo, impeccable lighting',
  portrait_corporate_office: 'formal corporate studio portrait, professional women\'s corporate attire (elegant blouse, professional skirt, blazer optional, no tie, no trousers), modern office interior background with windows and furniture, polished mixed lighting, confident professional expression, executive presence, premium corporate style, exquisite studio quality, realistic photo, professional studio-grade lighting',
  portrait_corporate_bw: 'formal black and white corporate studio portrait, professional women\'s corporate attire (elegant blouse, professional skirt, blazer optional, no tie, no trousers), classic studio setting with a clean solid monochrome background, studio-quality soft diffused lighting, soft low contrast with even and balanced exposure, gentle tonal range, timeless elegant black and white aesthetic, confident professional expression, premium corporate headshot style, realistic photo, impeccable studio lighting',
  portrait_corporate_chair: 'formal corporate studio portrait, professional women\'s corporate attire (elegant blouse, professional skirt, blazer optional, no tie, no trousers), sitting on a chair in a photo studio (random: high bar stool, modern office chair, designer chair, wooden chair), studio professional lighting, clean studio background, can be color or black and white, confident professional expression, premium corporate style, realistic photo'
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
  const reasons = {
    NO_IMAGE:             '\u{1F604} Gemini не смогла создать изображение по этому запросу. Попробуй переформулировать описание или выбрать другой стиль.',
    SAFETY:               '\u{1F6AB} Результат заблокирован фильтром безопасности Gemini. Попробуй изменить описание или выбрать другой стиль.',
    RECITATION:           '\u{1F4DD} Нейросеть считает, что результат слишком похож на защищённый контент. Попробуй изменить описание.',
    PROHIBITED_CONTENT:   '\u{1F6AB} Gemini обнаружила запрещённый контент в ответе. Попробуй другой стиль или менее конкретное описание.',
    IMAGE_SAFETY:         '\u{1F6AB} Сгенерированное изображение не прошло проверку безопасности. Попробуй другой стиль или измени описание.',
    MAX_TOKENS:           '\u{1F4CF} Слишком длинный запрос. Нейросеть не смогла обработать его целиком. Сократи описание или выбери стиль без кастомного промпта.',
    BLOCKLIST:            '\u{1F914} Нейросеть прервала генерацию. Попробуй ещё раз или выбери другой стиль.',
    SPII:                 '\u{1F914} Нейросеть прервала генерацию. Попробуй ещё раз или выбери другой стиль.',
    OTHER:                '\u{1F914} Нейросеть прервала генерацию по неизвестной причине. Попробуй ещё раз или выбери другой стиль.',
  };
  if (reason && reasons[reason]) return reasons[reason];
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
    casual: 'Casual lifestyle portrait, relaxed everyday look, comfortable clothing.',
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
    console.log('🔍 Gemini payload:', payload);
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
    const blockMessages = {
      SAFETY:             '🚫 Запрос заблокирован фильтром безопасности. Попробуй сделать описание менее детальным или выбрать другой стиль.',
      PROHIBITED_CONTENT: '🚫 Запрос содержит запрещённый контент. Попробуй другой стиль.',
      IMAGE_SAFETY:       '🚫 Фото не прошло проверку безопасности Gemini. Попробуй загрузить другие фото.',
      BLOCKLIST:          '🚫 Запрос заблокирован. Попробуй другой стиль.',
    };
    throw new Error(blocked ? (blockMessages[blocked] || `🚫 Запрос заблокирован: ${blocked}`) : '🤔 Нейросеть не дала ответа на этот запрос. Попробуй ещё раз или выбери другой стиль.');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\n');
    console.warn(`⚠️ Gemini вернул только текст: ${textParts.slice(0, 200)}`);
    const candidateSnippet = candidates ? JSON.stringify(candidates[0]).slice(0, 2000) : 'null';
    console.error(`🔍 Полный candidate: ${candidateSnippet}`);
    const reason = candidates?.[0]?.finishReason;
    throw new Error(finishReasonMessage(reason, {}) || '💬 Gemini вернула описание вместо изображения. Попробуй переформулировать запрос.');
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
  // ======================================================================
  // OpenAI routing
  // ======================================================================
  const isOpenAI = opts.settings?.model?.startsWith('openai-');

  if (isOpenAI) {
    if (!openaiGen) {
      throw new Error('OPENAI_API_KEY не задан. Добавь ключ в .env и перезапусти бота.');
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY не задан. Добавь ключ в .env и перезапусти бота.');
    }

    fs.mkdirSync(opts.outputDir, { recursive: true });
    const { files, prompt, outputDir, settings, metricsLabel, metricsStyle, metricsSub, logMessage, filenameBase, chatId } = opts;
    const label = metricsLabel || 'generate';
    const fnameBase = filenameBase || 'openai_generated';

    // Определяем фактическое имя модели OpenAI (убираем префикс 'openai-')
    const openaiModel = (settings?.model || 'openai-gpt-image-1.5').replace(/^openai-/, '');
    const isV2 = openaiModel === 'gpt-image-2';

    // Размер/конфигурация от соотношения сторон
    const sizeMap = isV2 ? openaiGen.SIZE_MAP_V2 : openaiGen.SIZE_MAP;
    const sizeOrConfig = isV2
      ? (sizeMap?.[settings?.aspectRatio] || { size: '1024x1024', resolution: '1K' })
      : (sizeMap?.[settings?.aspectRatio] || '1024x1024');

    _callLabel = label;
    console.log(`🎨 OpenAI ${openaiModel}${logMessage ? ': ' + logMessage : ''}`);
    console.log('📝 Промпт (первые 1000):', prompt.slice(0, 1000));

    const genStart = Date.now();
    let result;

    if (files && files.length > 0) {
      // Пробуем localPath (сохранённый ensureGeminiFiles), потом uri
      const refFile = files[0];
      let photoPath = null;

      if (refFile.localPath && fs.existsSync(refFile.localPath)) {
        photoPath = refFile.localPath;
      } else if (refFile.uri && fs.existsSync(refFile.uri)) {
        photoPath = refFile.uri;
      }

      if (isV2 && photoPath) {
        // gpt-image-2 с фото — через Image API edits (/v1/images/edits)
        console.log('📸 OpenAI V2: Image API edits с фото-референсом:', photoPath);
        result = await openaiGen.generateFromPhoto(photoPath, prompt, outputDir, fnameBase, sizeOrConfig, openaiModel);
      } else if (photoPath) {
        console.log('📸 Использую фото-референс для OpenAI edit:', photoPath);
        result = await openaiGen.generateFromPhoto(photoPath, prompt, outputDir, fnameBase, sizeOrConfig, openaiModel);
      } else {
        // Gemini File URI — не можем использовать напрямую
        console.log('⚠️ OpenAI: нет локального файла для референса. Генерирую без фото.');
        result = await openaiGen.generateFromPrompt(prompt, outputDir, fnameBase, sizeOrConfig, openaiModel);
      }
    } else if (isV2) {
      // gpt-image-2 без фото — через Image API /v1/images/generations
      console.log('📸 OpenAI V2: Image API, без фото');
      result = await openaiGen.generateFromPrompt(prompt, outputDir, fnameBase, sizeOrConfig, openaiModel);
    } else {
      result = await openaiGen.generateFromPrompt(prompt, outputDir, fnameBase, sizeOrConfig, openaiModel);
    }

    const totalDuration = Date.now() - genStart;
    const imgStat = fs.statSync(result.path);
    const imgSizeKB = (imgStat.size / 1024).toFixed(1);
    console.log(`✅ OpenAI: готово ${result.path} (${imgSizeKB} KB)`);

    metrics.track('openai:generation_success', {
      label,
      style: metricsStyle || '',
      sub: metricsSub || '',
      model: openaiModel,
      duration_ms: String(totalDuration),
      img_size_kb: imgSizeKB
    });

    // Сохраняем промпт для повтора
    if (chatId && prompt) {
      try {
        const convFile = path.join(__dirname, '..', 'data', 'conversations.json');
        const all = JSON.parse(fs.readFileSync(convFile, 'utf-8'));
        if (all[chatId]) {
          all[chatId].data = all[chatId].data || {};
          all[chatId].data.lastGeneratedPrompt = { text: prompt, styleId: metricsStyle || 'openai' };
          fs.writeFileSync(convFile, JSON.stringify(all, null, 2) + '\n');
        }
      } catch (e) {
        console.warn('⚠️ Не удалось сохранить промпт для повтора:', e.message);
      }
    }

    return { path: result.path, prompt };
  }
  // ======================================================================
  // /OpenAI routing
  // ======================================================================

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
    generationConfig: { responseModalities: ['Image', 'Text'], temperature: 0.1, topK: 32, topP: 1 },
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
  console.log('📝 Промпт (первые 1000):', prompt.slice(0, 1000));

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
 * @param {Object}   [settings]  - настройки пользователя (для применения качества)
 * @returns {string} полный промпт
 */
function _buildPhotoPrompt(description, count, extra = {}, settings = {}) {
  const identityLock = '⚠️ CRITICAL IDENTITY LOCK — THIS IS THE MOST IMPORTANT REQUIREMENT: The output face must be an EXACT pixel-level match to the reference face. Preserve every facial detail IDENTICALLY: eye shape and size, irises and pupils, nose bridge and width, mouth curve and lip shape, jawline contour, cheekbone structure, forehead shape, eyebrow arch, chin form, skin texture and pores. The person MUST be 100%% immediately recognizable as the same individual. You MUST NOT change, improve, beautify, smooth, morph, reshape, slim, widen, or modify the face in ANY way. NO skin smoothing, NO jaw reshaping, NO eye color change, NO cheekbone enhancement, NO facial hair alteration, NO wrinkle removal. Only change: clothing, background, lighting, and styling. The face must appear as if copied and pasted from the reference onto the new scene. If you change the face at all, the generation is a FAILURE.';
  const base = count === 1
    ? `Transform this person ${description}. ${identityLock} Make it look like a high-quality professional photo.`
    : `Transform this person ${description}. I'm providing ${count} photos of the same person — use ALL of them to capture their facial features, expressions and appearance accurately. ${identityLock} Make it look like a high-quality professional photo.`;
  const qualityPart = QUALITY_HINTS[settings.quality] || '';
  return base + qualityPart + ' No text, no letters, no words, no logos, no titles in the image.' + (extra.suffix || '');
}

// ======================================================================
// ПУБЛИЧНЫЕ ФУНКЦИИ (тонкие обёртки над _callGemini)
// ======================================================================

/**
 * Определить пол человека на фото через Gemini.
 * @param {Object[]} files - загруженные файлы
 * @returns {Promise<string>} 'male' | 'female'
 */
async function detectGender(files) {
  if (!files || files.length === 0) return 'male';
  try {
    const payload = JSON.stringify({
      contents: [{
        parts: [
          ...files.slice(0, 1).map(f => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } })),
          { text: 'Look at the person in this photo. Is this a man or a woman? Answer with only one word: male or female.' }
        ]
      }],
      generationConfig: {
        responseModalities: ['Text'],
        temperature: 0.1,
        maxOutputTokens: 10
      }
    });
    const result = await apiCall(payload, { model: 'gemini-2.0-flash' });
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.toLowerCase().trim() || '';
    if (text.includes('female') || text.includes('woman') || text.includes('girl')) {
      return 'female';
    }
    return 'male';
  } catch (err) {
    console.warn('⚠️ Не удалось определить пол, используется male:', err.message);
    return 'male';
  }
}

/**
 * Сгенерировать аватарку по стилю.
 * @param {Object[]} files - загруженные файлы
 * @param {string} styleId - id стиля
 * @param {string} outputDir - папка для результата
 * @param {Object} settings - настройки
 * @param {string} [chatId] - id чата
 * @param {string} [gender] - пол ('male' или 'female'), для корпоративных стилей. Если не передан — считается мужчина
 */
async function generateAvatar(files, styleId, outputDir, settings, chatId, gender) {
  // Для женских аватаров используем женские версии корпоративных промптов
  let stylePrompt;
  if (gender === 'female' && STYLE_PROMPTS_FEMALE[styleId]) {
    stylePrompt = STYLE_PROMPTS_FEMALE[styleId];
  } else {
    stylePrompt = STYLE_PROMPTS[styleId];
  }

  if (!stylePrompt) {
    throw new Error(`Промпт для стиля «${styleId}» не найден. Стиль ещё не настроен. Генерация не списана — попробуй другой стиль.`);
  }

  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = (settings?.faceTurn && settings?.faceTurn !== 'none')
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : ', face angle, head rotation and orientation must match the source photo exactly';

  const desc = `into an avatar with the following style: ${stylePrompt}${portraitTypeHint}${faceTurnHint}`;
  const prompt = _buildPhotoPrompt(desc, files.length, {}, settings);

  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateAvatar:' + styleId,
    metricsStyle: styleId,
    logMessage: `генерация в стиле «${styleId}»${gender ? ', пол: ' + gender : ''}`
  });
}

/**
 * Сгенерировать аватарку для случайной профессии.
 */
async function generateProfessionAvatar(files, profession, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = (settings?.faceTurn && settings?.faceTurn !== 'none')
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : ', face angle, head rotation and orientation must match the source photo exactly';
  const prompt = _buildPhotoPrompt(
    `into the following professional role: ${profession.prompt}. The person should be the main subject dressed for this role.${portraitTypeHint}${faceTurnHint}`,
    files.length,
    {},
    settings
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
  const faceTurnHint = (settings?.faceTurn && settings?.faceTurn !== 'none')
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : ', face angle, head rotation and orientation must match the source photo exactly';
  const prompt = _buildPhotoPrompt(
    `into a professional athlete in the following sport: ${sport.prompt}. The person should be the main subject playing this sport.${portraitTypeHint}${faceTurnHint}`,
    files.length,
    {},
    settings
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
  const faceTurnHint = (settings?.faceTurn && settings?.faceTurn !== 'none')
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : ', face angle, head rotation and orientation must match the source photo exactly';
  const prompt = _buildPhotoPrompt(
    `in an office setting: ${work.prompt}. The person should be the main subject in this office environment.${portraitTypeHint}${faceTurnHint}`,
    files.length,
    {},
    settings
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
  const faceTurnHint = (settings?.faceTurn && settings?.faceTurn !== 'none')
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : ', face angle, head rotation and orientation must match the source photo exactly';

  // Safety compliance: instruct Gemini that the generated content must be safe
  const safetyPrefix = 'Generate a cinematic movie portrait ' +
    `in the visual style and aesthetic of the film "${movie.titleEn}" (${movie.year}). ` +
    'Focus ONLY on visual atmosphere, colors, cinematography, and fashion aesthetic. ' +
    'This is a harmless artistic tribute to the movie\'s style and visual direction. ' +
    'The output must comply with all safety policies and may NOT depict any violence,' +
    'weapons, hate symbols, drug use, or unsafe content of any kind. ';

  const stylePrompt = `${safetyPrefix}${movie.prompt}. The person should look like an actor in a costume inspired by this film — stylish clothing, natural expression, professional portrait. High quality realistic photo, professional lighting, recognizable face.${portraitTypeHint}${faceTurnHint}`;

  const desc = `into a character inspired by the visual style of "${movie.titleEn}". ${stylePrompt}`;
  const prompt = _buildPhotoPrompt(desc, files.length, {}, settings);

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
  const faceTurnHint = (settings?.faceTurn && settings?.faceTurn !== 'none')
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : ', face angle, head rotation and orientation must match the source photo exactly';
  const prompt = _buildPhotoPrompt(
    `as a traveler at this world-famous location: ${location.prompt}. The person should be the main subject naturally present at this place. Premium travel editorial photography, National Geographic and Condé Nast Traveler quality, exceptional lighting and composition, rich colors and atmosphere, lifestyle travel magazine aesthetic, professional photography with perfect exposure and depth of field, travel portrait like from the pages of a luxury travel magazine, high-end editorial quality, no text no letters no typography no logos no labels anywhere on the image, no signs with text or location names, pure travel photography without any inscriptions.${portraitTypeHint}${faceTurnHint}`,
    files.length,
    {},
    settings
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
  const faceTurnHint = (settings?.faceTurn && settings?.faceTurn !== 'none')
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : ', face angle, head rotation and orientation must match the source photo exactly';
  const prompt = _buildPhotoPrompt(
    `into the historical era: ${era.prompt}. The person should look like they belong in this era, wearing appropriate period clothing and surrounded by authentic setting. The final image MUST be square 1:1 aspect ratio and look like an epic cinematic movie frame — dramatic lighting, film color grading, shallow depth of field, Hollywood historical film quality. Keep the face recognizable from the reference photo.${portraitTypeHint}${faceTurnHint}`,
    files.length,
    {},
    settings
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
  const faceTurnHint = (settings?.faceTurn && settings?.faceTurn !== 'none')
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : ', face angle, head rotation and orientation must match the source photo exactly';
  const prompt = _buildPhotoPrompt(
    `as a character from the literary work: ${work.prompt}. Cinematic movie frame quality, anamorphic look, dramatic film lighting, rich color grading, square 1:1 aspect ratio. The aesthetic should subtly reflect the era of the book — period-appropriate textures, lighting, and atmosphere. Keep face recognizable, high quality, like a shot from an award-winning film adaptation.${portraitTypeHint}${faceTurnHint}`,
    files.length,
    {},
    settings
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
  const prompt = applyQuality(customPrompt, settings);

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
    promptText,
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
    prompt: 'sci-fi fantasy bioluminescent jungle, floating mountains in alien world, mystical glowing plants, lush tropical paradise, James Cameron epic adventure style' },
  { title: 'Амели', titleEn: 'Amélie', year: 2001,
    prompt: 'whimsical French romance aesthetic, vintage 1940s green dress, Parisian Montmartre backdrop, warm red and green color palette, Jean-Pierre Jeunet magical style' },
  { title: 'Апокалипсис сегодня', titleEn: 'Apocalypse Now', year: 1979,
    prompt: 'Vietnam era 1970s aesthetic, army-style jacket, helicopter backdrop, orange dramatic sky, intense atmosphere, Coppola epic psychological style' },
  { title: 'Бегущий по лезвию', titleEn: 'Blade Runner', year: 1982,
    prompt: 'cyberpunk noir aesthetic, rainy neon-lit streets, futuristic coat, dark and moody, Ridley Scott dystopian style' },
  { title: 'Безумный Макс: Дорога ярости', titleEn: 'Mad Max: Fury Road', year: 2015,
    prompt: 'post-apocalyptic aesthetic, dusty wasteland gear, orange and blue color grade, intense desert portrait' },
  { title: 'Бесславные ублюдки', titleEn: 'Inglourious Basterds', year: 2009,
    prompt: 'Tarantino 1940s period aesthetic, vintage 1940s European costume, dramatic cinema lighting, bold colors, tense portrait' },
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
    prompt: 'ancient Roman epic aesthetic, gladiator style tunic and sandals, golden sunset lighting, Colosseum backdrop, heroic Ridley Scott portrait' },
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
    prompt: 'gritty psychological aesthetic, 80s grimy Gotham, green and red tones, worn suit, dark staircase, intense portrait' },
  { title: 'Дитя человеческое', titleEn: 'Children of Men', year: 2006,
    prompt: 'dystopian sci-fi aesthetic, refugee style worn clothing, grim urban London ruins, desaturated muted palette, Cuarón long-take realism' },
  { title: 'Доктор Стрейнджлав', titleEn: 'Dr. Strangelove', year: 1964,
    prompt: 'Cold War satire aesthetic, generals in uniform, war room backdrop, black and white photography, Kubrick deadpan satirical style' },
  { title: 'Драйв', titleEn: 'Drive', year: 2011,
    prompt: 'neo-noir 80s synthwave aesthetic, satin jacket with scorpion, neon pink and teal lighting, LA at night' },
  { title: 'Жизнь других', titleEn: 'The Lives of Others', year: 2006,
    prompt: 'Cold War drama aesthetic, East Berlin 1980s, grey suit, drab apartment surveillance vibe, muted green and brown palette, oppressive mood' },
  { title: 'Жизнь прекрасна', titleEn: 'Life Is Beautiful', year: 1997,
    prompt: 'Italian 1930s period drama aesthetic, 1930s period suit, vintage striped uniform, bittersweet warm tone, Benigni emotional style' },
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
    prompt: 'cult thriller aesthetic, dark coat and hat, New York city backdrop, moody street lighting, French cinema style' },
  { title: 'Лоуренс Аравийский', titleEn: 'Lawrence of Arabia', year: 1962,
    prompt: 'epic desert aesthetic, white Bedouin robe, vast golden desert landscape, dramatic wide-angle sun, David Lean epic style' },
  { title: 'Матрица', titleEn: 'The Matrix', year: 1999,
    prompt: 'cyberpunk aesthetic, black leather trench coat, dark sunglasses, green tinted lighting, digital rain vibe, sci-fi portrait' },
  { title: 'Мой сосед Тоторо', titleEn: 'My Neighbor Totoro', year: 1988,
    prompt: 'Studio Ghibli anime aesthetic, countryside Japan summer, traditional house, lush green forest, magical whimsical Studio Ghibli portrait' },
  { title: 'Молчание ягнят', titleEn: 'The Silence of the Lambs', year: 1991,
    prompt: 'psychological thriller aesthetic, FBI agent look, dark interrogation room, greenish dim lighting, tense Demme style' },
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
    prompt: 'psychological thriller aesthetic, 50s detective look, dark stormy island, atmospheric Scorsese style' },
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
    prompt: '1960s hospital drama aesthetic, 1960s hospital pajamas, stark white walls, institutional green tiles, harsh fluorescent lighting, rebellious spirit' },
  { title: 'Психо', titleEn: 'Psycho', year: 1960,
    prompt: 'Hitchcock suspense aesthetic, 1950s attire, dark motel setting, black and white photography, gothic atmosphere' },
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
    prompt: 'samurai epic aesthetic, traditional kimono, feudal Japan countryside, black and white photography, Kurosawa dramatic style' },
  { title: 'Славные парни', titleEn: 'Goodfellas', year: 1990,
    prompt: 'mafia aesthetic, 70s Italian-American style suit, Copacabana nightclub vibe, warm amber lighting, Scorsese long-take energy' },
  { title: 'Социальная сеть', titleEn: 'The Social Network', year: 2010,
    prompt: 'modern tech drama aesthetic, casual hoodie and flip-flops, Harvard campus backdrop, blue cold lighting, Fincher sharp dialogue style' },
  { title: 'Спасти рядового Райана', titleEn: 'Saving Private Ryan', year: 1998,
    prompt: 'WWII period epic aesthetic, soldier uniform, gritty worn look, muted desaturated colors, Spielberg cinematic style' },
  { title: 'Список Шиндлера', titleEn: 'Schindler\'s List', year: 1993,
    prompt: '1940s period drama aesthetic, 1940s period clothing, black and white photography, muted tones with red accent, Spielberg emotional style' },
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
    prompt: 'martial arts aesthetic, yellow and black tracksuit, anime-inspired style, Tarantino mix of Japanese and spaghetti western' },
  { title: 'Умница Уилл Хантинг', titleEn: 'Good Will Hunting', year: 1997,
    prompt: 'Boston drama aesthetic, casual hoodies and jeans, South Boston streets, Harvard bar backdrop, warm emotional Gus Van Sant style' },
  { title: 'Унесённые призраками', titleEn: 'Spirited Away', year: 2001,
    prompt: 'Studio Ghibli magical aesthetic, whimsical spirit world vibe, colorful traditional Japanese elements, dreamlike portrait' },
  { title: 'Форрест Гамп', titleEn: 'Forrest Gump', year: 1994,
    prompt: 'wholesome American aesthetic, 50s-70s era styling, soft warm lighting, bench scene vibe, nostalgic portrait' },
  { title: 'Ходячий замок', titleEn: 'Howl\'s Moving Castle', year: 2004,
    prompt: 'Studio Ghibli anime fantasy aesthetic, magical hat and cloak, colorful steam-punk backdrop, dramatic sky, Miyazaki whimsical style' },
  { title: 'Хороший, плохой, злой', titleEn: 'The Good, the Bad and the Ugly', year: 1966,
    prompt: 'spaghetti western aesthetic, cowboy hat and poncho, arid desert landscape, harsh golden sunlight, dramatic Ennio Morricone vibe' },
  { title: 'Храброе сердце', titleEn: 'Braveheart', year: 1995,
    prompt: 'medieval epic aesthetic, blue woad face paint, Scottish kilt, misty Highland landscape, epic lighting, Gibson style' },
  { title: 'Человек дождя', titleEn: 'Rain Man', year: 1988,
    prompt: 'road trip drama aesthetic, 80s casual wear, vintage car backdrop, American highway landscape, warm nostalgic road movie feel' },
  { title: 'Чужие', titleEn: 'Aliens', year: 1986,
    prompt: 'sci-fi action aesthetic, futuristic combat gear, industrial spaceship corridors, blue-green cold lighting, James Cameron action-sci-fi style' },
  { title: 'Шестое чувство', titleEn: 'The Sixth Sense', year: 1999,
    prompt: 'psychological thriller aesthetic, red sweater, cold breath visible, dim indoor lighting, M. Night Shyamalan eerie atmospheric style' },
  { title: 'Шоу Трумана', titleEn: 'The Truman Show', year: 1998,
    prompt: 'satirical drama aesthetic, 50s retro casual wear, perfect suburban street, blue sky cyclorama, Peter Weir meta style' },
  { title: 'Это прекрасная жизнь', titleEn: 'It\'s a Wonderful Life', year: 1946,
    prompt: 'classic American aesthetic, 1940s suit, snowy small town backdrop, warm nostalgic lighting, black and white, Capra wholesome style' },
  { title: 'V — значит вендетта', titleEn: 'V for Vendetta', year: 2006,
    prompt: 'dystopian aesthetic, theatrical mask and dark trench coat, London Parliament backdrop, rainy night, dark red and black palette' }
];

// Российские фильмы (после 1991)
const RUSSIAN_MOVIES = [
  { title: 'Брат', titleEn: 'Brother', year: 1997,
    prompt: '90s Russian crime aesthetic, leather jacket, gritty St. Petersburg streets, desaturated tones, Balabanov cult style' },
  { title: 'Брат 2', titleEn: 'Brother 2', year: 2000,
    prompt: '2000s Russian action aesthetic, leather jacket and sunglasses, Chicago and Moscow, bold red and blue tones, Balabanov rock style' },
  { title: 'Утомлённые солнцем', titleEn: 'Burnt by the Sun', year: 1994,
    prompt: 'Soviet 1930s drama aesthetic, summer white suit, dacha countryside, warm golden light, bittersweet nostalgic Nikita Mikhalkov style' },
  { title: 'Сибирский цирюльник', titleEn: 'The Barber of Siberia', year: 1998,
    prompt: 'Tsarist Russia epic aesthetic, 19th century military uniform, snowy Siberian landscape, grand romantic Mikhalkov style' },
  { title: '9 рота', titleEn: 'The 9th Company', year: 2005,
    prompt: 'Afghanistan 1980s drama aesthetic, Soviet period uniform, desert mountains, gritty dusty tones, Bondarchuk epic style' },
  { title: 'Левиафан', titleEn: 'Leviathan', year: 2014,
    prompt: 'Northern Russian drama aesthetic, winter coat, Barents Sea coast, whale skeleton, cold blue tones, Zvyagintsev brooding style' },
  { title: 'Нелюбовь', titleEn: 'Loveless', year: 2017,
    prompt: 'contemporary Moscow drama aesthetic, cold modern apartment, winter forest, bleak muted palette, Zvyagintsev psychological style' },
  { title: 'Елена', titleEn: 'Elena', year: 2011,
    prompt: 'Moscow social drama aesthetic, middle-class apartment, grey concrete high-rises, subdued natural lighting, Zvyagintsev minimalist style' },
  { title: 'Остров', titleEn: 'The Island', year: 2006,
    prompt: 'Russian Orthodox monastic aesthetic, monk robe, northern island monastery, white snow and grey sea, spiritual contemplative style' },
  { title: 'Бумер', titleEn: 'Bimmer', year: 2003,
    prompt: '2000s Russian crime road movie aesthetic, black BMW, tracksuit vibe, night highway, neon Moscow lights, gritty urban style' },
  { title: 'Возвращение', titleEn: 'The Return', year: 2003,
    prompt: 'bleak Russian island aesthetic, raincoats and boots, abandoned lighthouse, grey overcast sky, Zvyagintsev stark visual poetry' },
  { title: 'Водитель для Веры', titleEn: 'A Driver for Vera', year: 2004,
    prompt: '1960s Soviet Crimea aesthetic, military uniform, seaside resort, warm golden tones, Chukhrai nostalgic drama style' },
  { title: 'Стиляги', titleEn: 'Hipsters', year: 2008,
    prompt: '1950s Soviet youth aesthetic, colorful retro suit, bright red tie, Moscow streets, vibrant musical Toddorovski style' },
  { title: 'Горько!', titleEn: 'Gorko!', year: 2013,
    prompt: 'Russian wedding comedy aesthetic, ridiculous formal wear, beach wedding backdrop, bright colorful party, chaotic fun style' },
  { title: 'Легенда №17', titleEn: 'Legend No. 17', year: 2013,
    prompt: '1970s Soviet sports aesthetic, red hockey jersey, ice rink arena, dramatic arena lighting, triumphant sports epic style' },
  { title: 'Движение вверх', titleEn: 'Going Vertical', year: 2017,
    prompt: '1970s Olympic basketball aesthetic, USSR red tracksuit, Munich arena, triumphant crowd, sports epic patriotic style' },
  { title: 'Салют-7', titleEn: 'Salyut-7', year: 2017,
    prompt: '1980s Soviet space aesthetic, cosmonaut suit, space station interior, cosmic darkness, heroic space drama style' },
  { title: 'Т-34', titleEn: 'Tanks', year: 2018,
    prompt: 'WWII period aesthetic, tanker uniform, T-34 tank interior, winter landscape, intense action style' },
  { title: 'Холоп', titleEn: 'Serf', year: 2019,
    prompt: 'satirical Russian period aesthetic, 19th century peasant costume, Russian estate, countryside, comedy time-travel style' },
  { title: 'Текст', titleEn: 'The Text', year: 2019,
    prompt: 'modern Russian cyber drama aesthetic, smartphone screen vibes, dark Moscow apartment, tense psychological thriller style' },
  { title: 'Купе номер 6', titleEn: 'Compartment No. 6', year: 2021,
    prompt: 'Finnish-Russian train journey aesthetic, winter train compartment, snowy landscape through window, intimate indie drama style' },
  { title: 'Страна глухих', titleEn: 'Land of the Deaf', year: 1998,
    prompt: 'Moscow underground aesthetic, 90s casual wear, nightclub vibe, neon colors, bold stylish crime drama style' },
  { title: 'Дылда', titleEn: 'Beanpole', year: 2019,
    prompt: 'post-WWII Leningrad aesthetic, 1940s uniform, pastel Soviet apartment, muted green tones, Balagov intimate period drama style' },
  { title: 'Аритмия', titleEn: 'Arrhythmia', year: 2017,
    prompt: 'Russian provincial hospital aesthetic, doctor white coat, ambulance interior, gritty realistic life drama, Khlebnikov slice-of-life style' },
  { title: 'Сталинград', titleEn: 'Stalingrad', year: 2013,
    prompt: 'WWII period aesthetic, Soviet soldier uniform, ruined Stalingrad city, mud and smoke, Bondarchuk historical epic style' },
  { title: 'Белый тигр', titleEn: 'White Tiger', year: 2012,
    prompt: 'WWII mystical period aesthetic, tank commander uniform, battlefield atmosphere, surreal ghost tank, dark mythological style' },
  { title: 'Кавказский пленник', titleEn: 'Prisoner of the Mountains', year: 1996,
    prompt: 'Caucasian conflict drama aesthetic, camouflage, Caucasian mountains, dusty village, Bodrov humanist drama style' },
  { title: 'Морфий', titleEn: 'Morphia', year: 2008,
    prompt: '1917 Russian revolution aesthetic, doctor coat, dim provincial hospital, snowy dreary town, Balabanov dark psychological style' },
  { title: 'Жмурки', titleEn: 'Zhmurki', year: 2005,
    prompt: '90s Russian crime comedy aesthetic, 90s tracksuit and leather, abandoned factory, wild Tarantino-esque Balabanov style' },
  { title: 'Ночной дозор', titleEn: 'Night Watch', year: 2004,
    prompt: 'Russian dark fantasy aesthetic, trench coat, gloomy Moscow rooftops, dark blue night tones, Bekmambetov stylized action style' },
  { title: 'Лед', titleEn: 'Ice', year: 2018,
    prompt: 'Russian figure skating aesthetic, sparkling ice rink costume, spotlight performance, pink and blue arena lights, sports romance style' },
  { title: 'Притяжение', titleEn: 'Attraction', year: 2017,
    prompt: 'sci-fi Moscow aesthetic, alien spaceship over Chertanovo, hoodie and jeans, grey concrete blocks, blue alien light, Bekmambetov Russian sci-fi style' },
  { title: 'Война', titleEn: 'War', year: 2002,
    prompt: 'Chechen conflict drama aesthetic, fatigues, Caucasian forest, tense atmosphere, Balabanov stark realism style' },
  { title: 'Александра', titleEn: 'Alexandra', year: 2007,
    prompt: 'Chechen conflict contemplative aesthetic, elderly woman in summer dress, military camp, Chechen landscape, Sokurov lyrical style' },
  { title: 'Русский ковчег', titleEn: 'Russian Ark', year: 2002,
    prompt: '18th-20th century Russian palace aesthetic, elegant ball gowns and military uniforms, Winter Palace interior, Sokurov single-shot dreamlike style' },
  { title: 'Изгнание', titleEn: 'The Banishment', year: 2007,
    prompt: 'Russian village aesthetic, summer countryside, wooden house, bleak emotional drama, Zvyagintsev austere visual style' },
  { title: 'Монгол', titleEn: 'Mongol', year: 2007,
    prompt: 'Mongolian epic aesthetic, warrior armor, vast steppe landscape, golden face paint, Bodrov historical epic style' },
  { title: 'Вор', titleEn: 'The Thief', year: 1997,
    prompt: 'post-WWII Soviet train aesthetic, 1950s military uniform, train compartment, noir melancholic mood, Chukhrai intimate style' },
  { title: 'Дневной дозор', titleEn: 'Day Watch', year: 2006,
    prompt: 'Russian dark fantasy aesthetic, dark coat, Moscow nocturnal setting, blue and black visuals, Bekmambetov stylized action style' },
  { title: 'Адмиралъ', titleEn: 'The Admiral', year: 2008,
    prompt: 'Russian early 20th century epic aesthetic, white naval uniform, Siberian winter, tragic romance, historical epic style' },
  { title: 'Питер FM', titleEn: 'Peter FM', year: 2006,
    prompt: '2000s St. Petersburg romantic aesthetic, casual urban wear, city rooftops, warm golden tones, light romantic comedy style' },
  { title: 'Царь', titleEn: 'Tsar', year: 2009,
    prompt: '16th century Russian medieval aesthetic, royal robe and oprichnik uniform, dark Kremlin interior, terrifying historical style' },
  { title: 'Географ глобус пропил', titleEn: 'The Geographer Drank His Globe Away', year: 2013,
    prompt: '2000s Russian provincial aesthetic, casual teacher look, Ural nature, rafting river, bittersweet coming-of-age style' },
  { title: 'Как Витька Чеснок вёз Лёху Штыря в дом инвалидов', titleEn: 'Vitya Chesnok Goes to the Nursing Home', year: 2017,
    prompt: 'Russian provincial road movie aesthetic, worn casual clothes, winter highway, grey landscapes, deadpan comedy drama style' },
  { title: 'Дурак', titleEn: 'The Fool', year: 2014,
    prompt: 'Russian provincial drama aesthetic, worker overalls, crumbling apartment building, dark night, tense social realism style' },
  { title: 'Майор', titleEn: 'The Major', year: 2013,
    prompt: 'Russian cop thriller aesthetic, police uniform, snowy city, dark emotional night, Bykov tense corrupt drama style' },
  { title: 'Мастер и Маргарита', titleEn: 'The Master and Margarita', year: 2024,
    prompt: '1930s Moscow mystical aesthetic, elegant 30s dress, Stalin-era Moscow streets, surreal demonic presence, epic mystical drama style' },
  { title: 'Чебурашка', titleEn: 'Cheburashka', year: 2023,
    prompt: 'modern Russian family fantasy aesthetic, orange fur suit, sunny seaside town, colorful friendly vibe, heartwarming family style' },
  { title: 'Вызов', titleEn: 'The Challenge', year: 2023,
    prompt: 'space drama aesthetic, cosmonaut suit, ISS interior, Earth from space, blue cosmic lighting, first-in-space movie style' },
  { title: 'Последний богатырь', titleEn: 'The Last Warrior', year: 2017,
    prompt: 'Russian fantasy epic aesthetic, bogatyr armor, magical Slavic forest, golden epic lighting, fantasy adventure style' },
  { title: 'Экипаж', titleEn: 'The Crew', year: 2016,
    prompt: 'modern aviation disaster aesthetic, pilot uniform, airplane cockpit, dramatic volcano eruption, tense action style' },
  { title: 'Викинг', titleEn: 'Viking', year: 2016,
    prompt: '10th century Kievan Rus aesthetic, prince armor and fur cloak, ancient Slavic city, winter snow epic battle, large-scale historical style' },
  { title: 'Время первых', titleEn: 'The Spacewalker', year: 2017,
    prompt: '1960s Soviet space aesthetic, spacesuit with helmet, open space, Earth below, heroic spacewalk drama style' },
  { title: '28 панфиловцев', titleEn: 'Panfilov\'s 28 Men', year: 2016,
    prompt: 'WWII period aesthetic, Soviet soldier greatcoat, snowy landscape, tank attack, defiant historical epic style' },
  { title: 'Елки', titleEn: 'Christmas Trees', year: 2010,
    prompt: '2000s Russian New Year aesthetic, winter clothes, various Russian cities, festive lights, warm holiday comedy style' },
  { title: 'Обитаемый остров', titleEn: 'The Inhabited Island', year: 2008,
    prompt: 'sci-fi dystopian aesthetic, desert camouflage, alien wasteland, strange radiation towers, epic Russian sci-fi style' },
  { title: 'Скиф', titleEn: 'The Scythian', year: 2018,
    prompt: 'ancient Scythian aesthetic, fur and leather warrior garb, Eurasian steppe, dark historical fantasy style' },
  { title: 'Дуэлянт', titleEn: 'The Duelist', year: 2016,
    prompt: '19th century St. Petersburg aesthetic, elegant nobility attire, foggy capital, stylish period drama style' },
  { title: 'Коктебель', titleEn: 'Koktebel', year: 2003,
    prompt: 'Russian road movie aesthetic, casual travel wear, southern steppe landscape, train and hitchhiking, warm minimalist style' },
  { title: 'Ржев', titleEn: 'Rzhev', year: 2019,
    prompt: 'WWII Eastern Front period aesthetic, Red Army winter uniform, snowy forest trench, intimate historical drama style' },
  { title: 'Девятаев', titleEn: 'Devyatayev', year: 2021,
    prompt: 'WWII period escape drama aesthetic, Soviet pilot uniform, tense thriller style' },
  { title: 'Рай', titleEn: 'Paradise', year: 2016,
    prompt: '1940s European drama aesthetic, 1940s elegant dress, Parisian luxury hotel, black and white, Konchalovsky epic style' },
  { title: 'Майор Гром: Чумной Доктор', titleEn: 'Major Grom: Plague Doctor', year: 2021,
    prompt: 'modern Russian superhero aesthetic, police detective trench coat, St. Petersburg rooftops, colorful comic book action style' },
  { title: 'Праведник', titleEn: 'The Righteous', year: 2023,
    prompt: '1940s partisan aesthetic, winter coat and hat, Belarusian forest, rescue mission, heroic historical drama style' },
  { title: 'Серебряные коньки', titleEn: 'Silver Skates', year: 2020,
    prompt: '1899 St. Petersburg winter aesthetic, elegant 19th century attire, frozen Neva river, festive Christmas lights, magical romance style' },
  { title: 'Балканский рубеж', titleEn: 'The Balkan Line', year: 2019,
    prompt: 'Balkan conflict aesthetic, tactical gear, Balkan airport, night operation, tense style' },
  { title: 'Сто лет тому вперёд', titleEn: 'A Hundred Years Ahead', year: 2024,
    prompt: 'sci-fi adventure aesthetic, futuristic clothing, time machine, bright neon future world, Russian sci-fi style' }
];
// Советские фильмы
const SOVIET_MOVIES = [
  { title: 'Москва слезам не верит', titleEn: 'Moscow Does Not Believe in Tears', year: 1980,
    prompt: '1950s-70s Soviet drama aesthetic, 50s floral dress, communal apartment, Moscow cityscape, warm nostalgic Menshov Oscar-winning style' },
  { title: 'Служебный роман', titleEn: 'Office Romance', year: 1977,
    prompt: '1970s Soviet office aesthetic, strict business suit, Soviet statistics office, grey bureaucratic setting, Ryazanov warm comedy style' },
  { title: 'Ирония судьбы', titleEn: 'The Irony of Fate', year: 1975,
    prompt: '1970s Soviet New Year aesthetic, fur hat and coat, typical Soviet apartment, snowy Leningrad, Ryazanov romantic comedy style' },
  { title: 'Бриллиантовая рука', titleEn: 'The Diamond Arm', year: 1968,
    prompt: '1960s Soviet comedy aesthetic, striped swim trunks, resort wear, bright southern seaside, Gaidai slapstick style' },
  { title: 'Джентльмены удачи', titleEn: 'Gentlemen of Fortune', year: 1971,
    prompt: '1970s Soviet comedy aesthetic, thief tracksuit, desert Central Asian landscape, kindergarten setting, warm-hearted comedy style' },
  { title: 'Иван Васильевич меняет профессию', titleEn: 'Ivan Vasilievich Changes Profession', year: 1973,
    prompt: '1970s Soviet sci-fi comedy aesthetic, tsar robe, 70s Soviet apartment, costume chaos, Gaidai madcap time-travel style' },
  { title: 'Кавказская пленница', titleEn: 'Kidnapping, Caucasian Style', year: 1967,
    prompt: '1960s Soviet comedy aesthetic, Caucasian traditional hat, sunny mountain resort, vintage Soviet car, Gaidai vibrant slapstick style' },
  { title: 'Операция Ы', titleEn: 'Operation Y', year: 1965,
    prompt: '1960s Soviet comedy aesthetic, student uniform, construction site, bright spring colors, Gaidai classic slapstick style' },
  { title: 'Любовь и голуби', titleEn: 'Love and Pigeons', year: 1984,
    prompt: '1980s Soviet village aesthetic, rural house clothes, pigeon loft, Siberian village life, cozy heartfelt comedy style' },
  { title: 'В бой идут одни старики', titleEn: 'Only Old Men Are Going to Battle', year: 1973,
    prompt: 'WWII Soviet aviation period aesthetic, pilot uniform, Bykov warm period drama style' },
  { title: 'А зори здесь тихие', titleEn: 'The Dawns Here Are Quiet', year: 1972,
    prompt: 'WWII Soviet period aesthetic, female military uniform, Karelian forest lake, black and white flashbacks, Rostotski poignant style' },
  { title: 'Кин-дза-дза', titleEn: 'Kin-dza-dza', year: 1986,
    prompt: 'Soviet sci-fi absurdist aesthetic, strange alien robe, desert planet, dusty yellow tones, Daneliya surreal satire style' },
  { title: 'Сталкер', titleEn: 'Stalker', year: 1979,
    prompt: 'Soviet metaphysical aesthetic, dark boiler suit, desolate industrial zone, sepia and color shifts, Tarkovsky meditative philosophical style' },
  { title: 'Солярис', titleEn: 'Solaris', year: 1972,
    prompt: 'Soviet sci-fi philosophical aesthetic, cosmonaut uniform, spaceship interior, fluid organic forms, Tarkovsky contemplative style' },
  { title: 'Белое солнце пустыни', titleEn: 'White Sun of the Desert', year: 1970,
    prompt: 'Russian civil war eastern aesthetic, Red Army uniform, Caspian desert landscape, golden sand dunes, Motyl adventure style' },
  { title: 'Экипаж', titleEn: 'The Crew', year: 1979,
    prompt: 'Soviet disaster drama aesthetic, airline pilot uniform, cockpit and airport, dramatic rescue, Mitta action style' },
  { title: 'Калина красная', titleEn: 'The Red Viburnum', year: 1974,
    prompt: 'Soviet village drama aesthetic, ex-convict style, Russian countryside, birch forest, Shukshin heartfelt realistic style' },
  { title: 'Осенний марафон', titleEn: 'Autumn Marathon', year: 1979,
    prompt: '1970s Leningrad intellectual aesthetic, tweed jacket, university courtyard, autumn park, Daneliya bittersweet comedy style' },
  { title: 'Собачье сердце', titleEn: 'Heart of a Dog', year: 1988,
    prompt: '1920s Moscow aesthetic, winter coat and hat, pre-revolutionary apartment, snowy street, Bortko satirical sci-fi style' },
  { title: 'Они сражались за Родину', titleEn: 'They Fought for Their Country', year: 1975,
    prompt: 'WWII Stalingrad period aesthetic, Red Army uniform, dusty steppe, warm golden light, Bondarchuk epic historical style' },
  { title: 'Летят журавли', titleEn: 'The Cranes Are Flying', year: 1957,
    prompt: '1940s Soviet drama aesthetic, 1940s dress, Moscow rooftops, staircase, Kalatozov expressionist black and white style' },
  { title: 'Жестокий романс', titleEn: 'A Cruel Romance', year: 1984,
    prompt: '19th century Russian merchant aesthetic, elegant dress, Volga river town, golden sunset light, Ryazanov romantic drama style' },
  { title: 'Двенадцать стульев', titleEn: 'The Twelve Chairs', year: 1971,
    prompt: '1920s Soviet adventure aesthetic, worn suit and cap, Russian provincial towns, bright comedic Gaidai treasure-hunt style' },
  { title: 'Невероятные приключения итальянцев в России', titleEn: 'The Incredible Adventures of Italians in Russia', year: 1974,
    prompt: '1970s Soviet-Italian comedy aesthetic, tourist casual wear, Moscow and Leningrad landmarks, Gaidai action comedy style' },
  { title: 'Карнавальная ночь', titleEn: 'Carnival Night', year: 1956,
    prompt: '1950s Soviet comedy musical aesthetic, elegant evening dress, New Year theatre hall, bright festive colors, Ryazanov joyful style' },
  { title: 'Место встречи изменить нельзя', titleEn: 'The Meeting Place Cannot Be Changed', year: 1979,
    prompt: '1940s Moscow noir aesthetic, 1940s detective coat and hat, dim Moscow alleys, black Volga car, Govorukhin crime thriller style' },
  { title: 'Чучело', titleEn: 'Scarecrow', year: 1983,
    prompt: '1980s Soviet school drama aesthetic, school uniform, provincial town, autumn leaves, Bykov intense heartbreaking style' },
  { title: 'Курьер', titleEn: 'Courier', year: 1986,
    prompt: '1980s Moscow youth aesthetic, casual denim jacket, Soviet courtyard, pink and teal tones, Shakhnazarov coming-of-age style' },
  { title: 'Добро пожаловать, или Посторонним вход воспрещён', titleEn: 'Welcome, or No Trespassing', year: 1964,
    prompt: '1960s Soviet pioneer camp aesthetic, pioneer uniform, bright summer camp, pine forest, Klimov satirical childhood style' },
  { title: 'Мой ласковый и нежный зверь', titleEn: 'The Gentle Beast', year: 1978,
    prompt: '19th century Russian manor aesthetic, elegant lace dress, autumn forest estate, golden warm palette, Loznitsa romantic drama style' },
  { title: 'Баллада о солдате', titleEn: 'Ballad of a Soldier', year: 1959,
    prompt: '1940s Soviet home front aesthetic, soldier uniform, rural Russian landscape, warm sepia tones, Chukhrai tender period story style' },
  { title: 'Зеркало', titleEn: 'The Mirror', year: 1975,
    prompt: 'Soviet poetic aesthetic, 1930s rural dress, wooden house garden, colour and black and white shifts, Tarkovsky autobiographical dreamlike style' },
  { title: 'Полёты во сне и наяву', titleEn: 'Flights in Dreams and Reality', year: 1982,
    prompt: '1980s Soviet midlife crisis aesthetic, casual suit, Kiev cityscape, melancholic everyday life, Balayan bittersweet style' },
  { title: 'Андрей Рублёв', titleEn: 'Andrei Rublev', year: 1966,
    prompt: '15th century Russian medieval aesthetic, monk robe, white stone cathedral, black and white photography, Tarkovsky epic historical style' },
  { title: 'Иди и смотри', titleEn: 'Come and See', year: 1985,
    prompt: '1940s Belarusian tragedy aesthetic, teenage boy in ragged clothes, burned village, dark forest, Klimov harrowing surreal period style' },
  { title: 'Война и мир', titleEn: 'War and Peace', year: 1967,
    prompt: 'Napoleonic era epic aesthetic, 19th century ball gown and formal uniform, Borodino countryside, sweeping Bondarchuk Oscar-winning epic style' },
  { title: 'Мимино', titleEn: 'Mimino', year: 1977,
    prompt: 'Soviet comedy aesthetic, pilot uniform, Georgian mountain village, Moscow big city, Daneliya warm heartfelt comedy style' },
  { title: 'Я шагаю по Москве', titleEn: 'I Step Through Moscow', year: 1963,
    prompt: '1960s Moscow youth aesthetic, casual Soviet fashion, summer Moscow streets, bright cheerful colors, Daneliya optimistic style' },
  { title: 'Афоня', titleEn: 'Afonya', year: 1975,
    prompt: '1970s Soviet everyman aesthetic, worker overalls, provincial town, vodka and blues, Daneliya bittersweet comedy style' },
  { title: 'Гараж', titleEn: 'The Garage', year: 1979,
    prompt: 'late Soviet intellectual aesthetic, 70s casual suits, cooperative garage, night confrontation, Ryazanov satirical ensemble style' },
  { title: 'Берегись автомобиля', titleEn: 'Beware of the Car', year: 1966,
    prompt: '1960s Soviet comedy aesthetic, insurance agent suit, Volga car, bright Moscow streets, Ryazanov clever comedic style' },
  { title: 'Вокзал для двоих', titleEn: 'A Station for Two', year: 1982,
    prompt: '1980s Soviet railway aesthetic, train station uniform, provincial station, snowy winter, Ryazanov bittersweet romance style' },
  { title: 'Зигзаг удачи', titleEn: 'Zigzag of Success', year: 1968,
    prompt: '1960s Soviet comedy aesthetic, photographer vest, photo studio, bright colorful and chaotic, Ryazanov satirical style' },
  { title: 'Старики-разбойники', titleEn: 'Old Robbers', year: 1971,
    prompt: '1970s Soviet comedy aesthetic, police uniform and civilian suit, Moscow city adventure, Ryazanov buddy comedy style' },
  { title: 'Не может быть!', titleEn: 'It Can\'t Be!', year: 1975,
    prompt: '1920s Soviet satire aesthetic, NEP-era suit, market scene, old mansion, Gaidai vaudeville farce style' },
  { title: 'Деловые люди', titleEn: 'Business People', year: 1963,
    prompt: 'American West comedy aesthetic, 1900s cowboy outfit, dusty wild west town, Gaidai O\'Henry adaptation style' },
  { title: 'Инкогнито из Петербурга', titleEn: 'The Incognito from Petersburg', year: 1977,
    prompt: '1840s Russian provincial aesthetic, tsarist official uniform, small town manor, Gogol satire theatrical style' },
  { title: 'Обыкновенное чудо', titleEn: 'An Ordinary Miracle', year: 1978,
    prompt: 'fairy tale aesthetic, medieval king and princess costumes, magical castle, warm golden lighting, Zakharov whimsical musical style' },
  { title: 'Тот самый Мюнхгаузен', titleEn: 'That Same Munchausen', year: 1979,
    prompt: '18th century baroque aesthetic, elegant nobleman outfit, German castle, witty philosophical comedy, Zakharov brilliant style' },
  { title: 'Формула любви', titleEn: 'The Formula of Love', year: 1984,
    prompt: '18th century Russian manor aesthetic, count attire and elegant dresses, country estate, mystical romantic comedy, Zakharov witty style' },
  { title: 'Убить дракона', titleEn: 'To Kill a Dragon', year: 1988,
    prompt: 'medieval fantasy aesthetic, knight armor, dark Gothic town square, dragon shadow, Zakharov dark satirical fantasy style' },
  { title: 'Чародеи', titleEn: 'Sorcerers', year: 1982,
    prompt: '1980s Soviet fantasy aesthetic, lab coat and wizard robe, secret research institute, magical inventions, Bromberg New Year musical style' },
  { title: 'Три мушкетёра', titleEn: 'The Three Musketeers', year: 1978,
    prompt: '17th century French aesthetic, musketeer cloak, palace of Louvre, swashbuckling adventure, Jungvald-Khilkevich musical style' },
  { title: 'Д\'Артаньян и три мушкетёра', titleEn: 'D\'Artagnan and the Three Musketeers', year: 1979,
    prompt: '17th century French aesthetic, musketeer uniform and hat, dueling grounds of Paris, vibrant adventure musical style' },
  { title: 'Семнадцать мгновений весны', titleEn: 'Seventeen Moments of Spring', year: 1973,
    prompt: 'WWII spy thriller aesthetic, 1940s German trench coat, wartime Berlin, dark offices, Lioznova tense espionage style' },
  { title: 'Щит и меч', titleEn: 'The Shield and the Sword', year: 1968,
    prompt: 'WWII spy aesthetic, Soviet officer in German uniform, wartime Europe, spy radio room, tense espionage drama style' },
  { title: 'Майор Вихрь', titleEn: 'Major Whirlwind', year: 1967,
    prompt: 'WWII spy aesthetic, Polish resistance style, Krakow old town, wartime occupation, secret mission thriller style' },
  { title: 'Адъютант его превосходительства', titleEn: 'The Adjutant of His Excellency', year: 1969,
    prompt: 'Russian Civil War aesthetic, White Army uniform, elegant 1910s attire, southern Russia, spy drama style' },
  { title: 'Неуловимые мстители', titleEn: 'The Elusive Avengers', year: 1966,
    prompt: 'Russian Civil War aesthetic, revolutionary youth clothes, western Ukraine, horse chase, Keosayan adventure western style' },
  { title: 'Золотой телёнок', titleEn: 'The Golden Calf', year: 1968,
    prompt: '1920s Soviet NEP aesthetic, worn suit and cap, Soviet road trip, bright satirical Shveitser Ostap Bender style' },
  { title: 'Доживём до понедельника', titleEn: 'We\'ll Live Till Monday', year: 1968,
    prompt: '1960s Soviet school aesthetic, teacher suit, classroom with desks, melancholic thoughtful, Rostotski pedagogical drama style' },
  { title: 'Белый Бим Чёрное ухо', titleEn: 'White Bim Black Ear', year: 1977,
    prompt: 'Soviet everyday drama aesthetic, older man in coat and hat, Russian countryside, forest and apartment, poignant animal story style' },
  { title: 'Весна на Заречной улице', titleEn: 'Spring on Zarechnaya Street', year: 1956,
    prompt: '1950s Soviet working class aesthetic, factory worker clothes, evening school, spring city streets, Khuciyev romantic drama style' },
  { title: 'Чистое небо', titleEn: 'Clear Skies', year: 1961,
    prompt: 'post-WWII Soviet aesthetic, pilot uniform, 50s civilian clothing, hopeful reconstruction, Chukhrai warm dramatic style' },
  { title: 'Девять дней одного года', titleEn: 'Nine Days of One Year', year: 1962,
    prompt: '1960s Soviet nuclear scientist aesthetic, lab coat, nuclear reactor, intellectual debate, Romm philosophical drama style' },
  { title: 'Обыкновенный фашизм', titleEn: 'Ordinary Fascism', year: 1965,
    prompt: 'WWII documentary aesthetic, archival newsreel, dramatic historical footage, Romm powerful essay film style' },
  { title: 'Июльский дождь', titleEn: 'July Rain', year: 1966,
    prompt: '1960s Moscow intellectual aesthetic, elegant 60s dress, Moscow streets and cafes, melancholic romantic, Khuciyev introspective style' },
  { title: 'Проверка на дорогах', titleEn: 'Trial on the Road', year: 1971,
    prompt: 'WWII partisan aesthetic, military uniforms, snow-covered forest, moral dilemmas, German stark war drama style' },
  { title: 'Мой друг Иван Лапшин', titleEn: 'My Friend Ivan Lapshin', year: 1984,
    prompt: '1930s Soviet provincial aesthetic, period uniform, communal apartment, bleak winter town, German naturalist drama style' },
  { title: 'Холодное лето пятьдесят третьего', titleEn: 'Cold Summer of 1953', year: 1987,
    prompt: 'post-Stalin Soviet aesthetic, ex-convict and local clothes, Siberian taiga village, tense standoff, Proshkin thriller style' },
  { title: 'Ворошиловский стрелок', titleEn: 'The Voroshilov Sharpshooter', year: 1999,
    prompt: '1990s Russian provincial drama aesthetic, elderly man in suit, small apartment, Govorukhin tense justice drama style' },
  { title: 'Председатель', titleEn: 'The Chairman', year: 1964,
    prompt: 'post-WWII Soviet village aesthetic, peasant clothes, collective farm, ruined village, Saltykov epic reconstruction drama style' },
  { title: 'Горячий снег', titleEn: 'Hot Snow', year: 1972,
    prompt: 'WWII Stalingrad period aesthetic, Red Army soldier greatcoat, snowy steppe, winter battle, Egoryev epic historical style' },
  { title: 'Освобождение', titleEn: 'Liberation', year: 1971,
    prompt: 'WWII epic military aesthetic, Red Army uniform, Kursk and Berlin, massive scale, Ozerov epic historical saga style' },
  { title: 'Битва за Москву', titleEn: 'Battle of Moscow', year: 1985,
    prompt: 'WWII Moscow defense aesthetic, Soviet winter uniform, snow-covered landscape, Kremlin backdrop, grand historical epic style' },
  { title: 'Повесть о настоящем человеке', titleEn: 'The Story of a Real Man', year: 1948,
    prompt: 'post-WWII biopic aesthetic, pilot uniform and hospital gown, winter forest, prosthetic legs, Stolper heroic true story style' },
  { title: 'Живые и мёртвые', titleEn: 'The Living and the Dead', year: 1964,
    prompt: 'WWII retreat aesthetic, Soviet officer uniform, Belarusian forest, dramatic scenes, Stolper epic historical drama style' },
  { title: 'Молодая гвардия', titleEn: 'The Young Guard', year: 1948,
    prompt: 'WWII underground aesthetic, 1940s youth clothes, occupied Krasnodon, secret meeting, Gerasimov heroic partisan style' },
  { title: 'Тихий Дон', titleEn: 'And Quiet Flows the Don', year: 1958,
    prompt: 'WWI and Civil War Cossack aesthetic, Cossack uniform and traditional dress, Don river steppe, epic family saga, Gerasimov classic style' },
  { title: 'Иваново детство', titleEn: 'Ivan\'s Childhood', year: 1962,
    prompt: '1940s Soviet aesthetic, boy in military coat, forest, river crossing, Tarkovsky poetic black and white period style' },
  { title: 'Ностальгия', titleEn: 'Nostalghia', year: 1983,
    prompt: 'Italian and Russian aesthetic, Russian intellectual coat, Italian spa town, fog and water, Tarkovsky melancholic poetic style' },
  { title: 'Жертвоприношение', titleEn: 'The Sacrifice', year: 1986,
    prompt: 'Swedish countryside aesthetic, intellectual in suit, island house, bare tree, Tarkovsky meditative final film style' },
  { title: 'Агония', titleEn: 'Agony', year: 1975,
    prompt: 'Tsarist Russia WWI aesthetic, early 20th century military and court dress, Rasputin mystic court, Klimov expressionist historical style' },
  { title: 'Звезда пленительного счастья', titleEn: 'The Star of Captivating Happiness', year: 1975,
    prompt: '1825 Decembrist aesthetic, nobility uniform and elegant dress, Senate Square, Siberian exile, Motyl romantic historical epic style' },
  { title: 'Военно-полевой роман', titleEn: 'Wartime Romance', year: 1983,
    prompt: 'post-WWII 1940s aesthetic, military coat and civilian dress, provincial town market, melancholic love, Todorovski tender style' },
  { title: 'Интердевочка', titleEn: 'Intergirl', year: 1989,
    prompt: 'late Soviet perestroika aesthetic, glamorous 80s dress, Leningrad hotel, Western cars, Todorovski provocative drama style' },
  { title: 'Бег', titleEn: 'The Flight', year: 1970,
    prompt: 'Russian Civil War refugee aesthetic, White Army uniform, Constantinople cafes, Paris boarding house, Alov epic surreal style' },
  { title: 'Тегеран-43', titleEn: 'Teheran-43', year: 1981,
    prompt: 'WWII spy thriller aesthetic, 1940s international suits and dresses, Tehran city, Alov globe-trotting style' },
  { title: 'Печки-лавочки', titleEn: 'Stove Benches', year: 1972,
    prompt: '1970s Soviet village aesthetic, Siberian worker clothes, Trans-Siberian train, southern resort, Shukshin warm road comedy style' },
  { title: 'В шесть часов вечера после войны', titleEn: 'At Six O\'Clock in the Evening After the War', year: 1944,
    prompt: '1940s home front musical aesthetic, period uniform and elegant dress, Moscow fireworks, celebrating victory, Pyryev hopeful musical style' },
  { title: 'Весёлые ребята', titleEn: 'Jolly Fellows', year: 1934,
    prompt: '1930s Soviet musical comedy aesthetic, suit and tie, jazz instruments, Moscow rooftop, Alexandrov cheerful first musical style' },
  { title: 'Цирк', titleEn: 'Circus', year: 1936,
    prompt: '1930s Soviet circus aesthetic, circus performer costume, big top arena, red star finale, Alexandrov vibrant musical style' },
  { title: 'Волга-Волга', titleEn: 'Volga-Volga', year: 1938,
    prompt: '1930s Soviet comedy musical aesthetic, steamboat captain and peasant clothes, Volga river, folk songs, Alexandrov joyful style' },
  { title: 'Морозко', titleEn: 'Morozko', year: 1964,
    prompt: 'Russian fairy tale aesthetic, traditional folk costume, snow-covered winter forest, magical grandfather frost, Row fantastical style' },
  { title: 'Варвара-краса, длинная коса', titleEn: 'Barbara the Fair with the Silken Hair', year: 1969,
    prompt: 'Russian fairy tale aesthetic, folk costume and tsar robe, underwater kingdom, magical forest, Row whimsical style' },
  { title: 'Садко', titleEn: 'Sadko', year: 1952,
    prompt: 'medieval Russian epic aesthetic, merchant robe, ship on the sea, underwater kingdom, Ptushko epic fantasy style' },
  { title: 'Илья Муромец', titleEn: 'Ilya Muromets', year: 1956,
    prompt: 'medieval Kievan Rus epic aesthetic, bogatyr armor, cathedral of St. Sophia, vast steppe, Ptushko epic fantasy style' },
  { title: 'Сказка о царе Салтане', titleEn: 'The Tale of Tsar Saltan', year: 1966,
    prompt: 'Russian fairy tale aesthetic, tsar robe and folk costumes, magical island, flying prince, Ptushko epic fairy tale style' },
  { title: 'Капитанская дочка', titleEn: 'The Captain\'s Daughter', year: 1958,
    prompt: '18th century Pugachev rebellion aesthetic, officer uniform and peasant clothes, Orenburg fortress, snowy steppe, classic Pushkin adaptation style' },
  { title: 'Гамлет', titleEn: 'Hamlet', year: 1964,
    prompt: 'medieval Danish royal aesthetic, prince black attire, Elsinore castle, dramatic black and white, Kozintsev Shakespearean epic style' },
  { title: 'Король Лир', titleEn: 'King Lear', year: 1971,
    prompt: 'medieval royal aesthetic, king robe and armor, stormy heath, ancient castle, Kozintsev Shakespearean tragic style' },
  { title: 'Тени забытых предков', titleEn: 'Shadows of Forgotten Ancestors', year: 1965,
    prompt: 'Ukrainian Carpathian aesthetic, Hutsul folk costume, mountain village, forest river, Parajanov vibrant folkloric poetic style' },
  { title: 'Цвет граната', titleEn: 'The Color of Pomegranates', year: 1969,
    prompt: 'Armenian medieval aesthetic, monk robe, ancient monastery, poetic tableau, Parajanov avant-garde visual poem style' },
  { title: 'Покаяние', titleEn: 'Repentance', year: 1984,
    prompt: 'fictional totalitarian aesthetic, 1930s official suit, small town square, surreal staged scenes, Abuladze allegorical political style' },
  { title: 'Коммунист', titleEn: 'The Communist', year: 1958,
    prompt: '1920s Soviet construction aesthetic, worker clothes, hydroelectric dam, Siberian taiga, Raizman heroic construction drama style' }
];


const CINEMA = { foreign: MOVIES, russian: RUSSIAN_MOVIES, soviet: SOVIET_MOVIES };

function getRandomMovie(category = 'foreign') {
  const list = CINEMA[category] || MOVIES;
  return list[Math.floor(Math.random() * list.length)];
}

function getMovieByIndex(category, index) {
  const list = CINEMA[category] || MOVIES;
  return list[index] || null;
}

function getMoviesPage(category, page, pageSize = 10) {
  const list = CINEMA[category] || MOVIES;
  const total = list.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = list.slice(start, start + pageSize);
  return { items, page, totalPages, total };
}

// Локации
const { LOCATIONS } = require('./locations-data');

// Автомобильные бренды и модели
const { CAR_BRANDS, getCarBrandByIndex, getCarBrandsPage, getModelsForBrand, getRandomCarModel } = require('./cars-data');
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

async function generateCarAvatar(files, brand, model, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `${model.prompt}, front grille and headlights clearly visible, car logo and badge prominent, professional automotive photography, sharp detailed front view showing the make and model of the car, model standing next to the front hood or near the driver door, stylish streetwear fashion, urban setting bright day, high-end luxury car photo shoot, person and car both in frame, car front half fully in shot${portraitTypeHint}${faceTurnHint}`,
    files.length,
    {},
    settings
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

async function generateWheelAvatar(files, brand, outputDir, settings, chatId) {
  const portraitTypeHint = settings?.portraitType
    ? (PORTRAIT_TYPE_HINTS[settings.portraitType] || '')
    : '';
  const faceTurnHint = settings?.faceTurn
    ? (FACE_TURN_HINTS[settings.faceTurn] || '')
    : '';
  const prompt = _buildPhotoPrompt(
    `driving a ${brand.name}, person behind the wheel holding the steering wheel, ${brand.prompt}, car interior visible with dashboard and windshield, or exterior shot through windshield showing the driver, professional automotive lifestyle photography, dynamic driving atmosphere, realistic photo, high quality${portraitTypeHint}${faceTurnHint}`,
    files.length,
    {},
    settings
  );
  console.log(`🎨 Генерация за рулём: ${brand.name}`);
  return _callGemini({
    files, prompt, outputDir, settings,
    metricsLabel: 'generateWheelAvatar:' + brand.id,
    metricsStyle: 'in_car',
    metricsSub: brand.id,
    logMessage: `генерация «${brand.name}»`,
    filenameBase: 'wheel_' + brand.id,
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
  // Определение пола
  detectGender,
  STYLE_PROMPTS_FEMALE,
  // Вспомогательное
  uploadPhoto,
  // Данные
  STYLE_PROMPTS,
  PROFESSIONS, SPORTS, OFFICE, MOVIES, RUSSIAN_MOVIES, SOVIET_MOVIES, CINEMA, LOCATIONS, HISTORY, LITERATURE,
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
  generateWheelAvatar,
  FACE_TURN_HINTS,
  PORTRAIT_TYPE_HINTS
};
