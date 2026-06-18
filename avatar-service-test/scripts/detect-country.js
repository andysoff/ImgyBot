#!/usr/bin/env node
/**
 * Определение страны пользователя на основе Telegram language_code.
 *
 * Telegram передаёт язык интерфейса пользователя (BCP47),
 * мы сопоставляем его со страной (ISO 3166-1 alpha-2).
 *
 * Используется:
 *   - при регистрации (handlePhotosReceived) — сохраняется в users.json
 *   - при отправке любых событий (metrics) — если country ещё не сохранён,
 *     детектится на лету из сохранённого language пользователя
 *
 * Экспорт:
 *   detectCountry(languageCode) → 'RU' | 'US' | ...
 *   getCountryFromIP() → опционально (IP-based fallback)
 */

// ----- Маппинг language → страна -----
// Ключ: BCP47 language tag (язык интерфейса Telegram)
// Значение: ISO 3166-1 alpha-2 код страны
const LANGUAGE_TO_COUNTRY = {
  // СНГ / постсоветское пространство
  'ru': 'RU',
  'uk': 'UA',
  'be': 'BY',
  'kk': 'KZ',
  'ky': 'KG',
  'uz': 'UZ',
  'tk': 'TM',
  'tg': 'TJ',
  'hy': 'AM',
  'az': 'AZ',
  'ka': 'GE',
  'mo': 'MD',
  'lv': 'LV',
  'lt': 'LT',
  'et': 'EE',

  // Европа
  'en': 'US',
  'en-GB': 'GB',
  'de': 'DE',
  'fr': 'FR',
  'es': 'ES',
  'it': 'IT',
  'pt': 'PT',
  'pt-BR': 'BR',
  'nl': 'NL',
  'pl': 'PL',
  'cs': 'CZ',
  'sk': 'SK',
  'hu': 'HU',
  'ro': 'RO',
  'bg': 'BG',
  'sr': 'RS',
  'hr': 'HR',
  'sl': 'SI',
  'bs': 'BA',
  'mk': 'MK',
  'sq': 'AL',
  'el': 'GR',
  'sv': 'SE',
  'no': 'NO',
  'nb': 'NO',
  'nn': 'NO',
  'da': 'DK',
  'fi': 'FI',
  'is': 'IS',
  'mt': 'MT',
  'ga': 'IE',
  'cy': 'GB',
  'eu': 'ES',
  'ca': 'ES',
  'gl': 'ES',

  // Ближний Восток / Южная Азия
  'ar': 'SA',
  'he': 'IL',
  'fa': 'IR',
  'ur': 'PK',
  'ps': 'AF',
  'ku': 'IQ',
  'ckb': 'IQ',
  'tr': 'TR',

  // Индия / Южная Азия
  'hi': 'IN',
  'bn': 'BD',
  'ta': 'IN',
  'te': 'IN',
  'mr': 'IN',
  'gu': 'IN',
  'kn': 'IN',
  'ml': 'IN',
  'pa': 'IN',
  'or': 'IN',
  'as': 'IN',
  'sd': 'PK',
  'ne': 'NP',
  'si': 'LK',
  'dv': 'MV',

  // Юго-Восточная Азия
  'th': 'TH',
  'vi': 'VN',
  'id': 'ID',
  'ms': 'MY',
  'fil': 'PH',
  'tl': 'PH',
  'km': 'KH',
  'lo': 'LA',
  'my': 'MM',
  'mn': 'MN',

  // Восточная Азия
  'ja': 'JP',
  'ko': 'KR',
  'zh': 'CN',
  'zh-CN': 'CN',
  'zh-TW': 'TW',
  'zh-HK': 'HK',

  // Африка
  'sw': 'TZ',
  'ha': 'NG',
  'yo': 'NG',
  'ig': 'NG',
  'zu': 'ZA',
  'xh': 'ZA',
  'af': 'ZA',
  'am': 'ET',
  'so': 'SO',
  'rw': 'RW',
  'sn': 'ZW',
  'st': 'ZA',
  'tn': 'ZA',
  'ts': 'ZA',
  've': 'ZA',
  'nr': 'ZA',
  'ss': 'ZA',
  'mg': 'MG',
  'ny': 'MW',

  // Америка
  'en-US': 'US',
  'en-CA': 'CA',
  'fr-CA': 'CA',
  'es-MX': 'MX',
  'es-AR': 'AR',
  'es-CL': 'CL',
  'es-CO': 'CO',
  'es-PE': 'PE',
  'es-VE': 'VE',
  'pt-BR': 'BR',
  'nl-SR': 'SR',
  'gn': 'PY',
  'ay': 'BO',
  'qu': 'PE',

  // Океания
  'en-AU': 'AU',
  'en-NZ': 'NZ',
  'mi': 'NZ',
  'fj': 'FJ',
  'sm': 'WS',
  'to': 'TO',
};

/** Страна по умолчанию, если не удалось определить */
const DEFAULT_COUNTRY = 'US';

/**
 * Определить страну по языковому коду Telegram.
 *
 * @param {string} languageCode — BCP47 tag (напр. 'ru', 'en-US', 'zh-CN')
 * @returns {string} — ISO 3166-1 alpha-2 код страны
 *
 * Примеры:
 *   detectCountry('ru')       → 'RU'
 *   detectCountry('en-US')    → 'US'
 *   detectCountry('zh-CN')    → 'CN'
 *   detectCountry('')         → 'US'
 *   detectCountry(null)       → 'US'
 */
function detectCountry(languageCode) {
  if (!languageCode) return DEFAULT_COUNTRY;

  // 1. Точное совпадение (включая региональные варианты)
  const normalized = languageCode.trim();
  if (LANGUAGE_TO_COUNTRY[normalized]) {
    return LANGUAGE_TO_COUNTRY[normalized];
  }

  // 2. Особый случай: en_XX → детектим по региону
  // Должен быть ДО primary fallback, иначе en всегда → US
  const primary = normalized.split('-')[0];
  if (primary === 'en' && normalized.includes('-')) {
    const region = normalized.split('-')[1];
    const regionToCountry = {
      'US': 'US', 'GB': 'GB', 'CA': 'CA', 'AU': 'AU',
      'NZ': 'NZ', 'IE': 'IE', 'ZA': 'ZA', 'IN': 'IN',
      'SG': 'SG', 'HK': 'HK', 'PH': 'PH', 'MY': 'MY',
      'NG': 'NG', 'KE': 'KE', 'GH': 'GH',
    };
    if (regionToCountry[region]) return regionToCountry[region];
    // Если регион не найден — вернём US ниже через primary fallback
  }

  // 3. Совпадение по primary language subtag (часть до первого дефиса)
  if (primary && LANGUAGE_TO_COUNTRY[primary]) {
    return LANGUAGE_TO_COUNTRY[primary];
  }

  return DEFAULT_COUNTRY;
}

/**
 * Проверить, является ли страна постсоветской / СНГ.
 * Полезно для определения региона в метриках.
 */
function isCIS(countryCode) {
  return ['RU', 'UA', 'BY', 'KZ', 'KG', 'UZ', 'TM', 'TJ', 'AZ', 'AM', 'MD', 'GE'].includes(countryCode);
}

module.exports = { detectCountry, isCIS, LANGUAGE_TO_COUNTRY, DEFAULT_COUNTRY };
