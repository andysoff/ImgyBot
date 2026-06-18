#!/usr/bin/env node
/**
 * Модуль оплаты через ЮMoney (ЮKassa) / Режим демонстрации
 *
 * Реальная оплата:  YOOKASSA_SHOP_ID + YOOKASSA_SECRET_KEY
 * Демо-режим:       PAYMENT_DEMO_MODE=true (или пустые ключи)
 *
 * В демо-режиме:
 *   - Создаётся фейковый платёж с ссылкой на заглушку
 *   - Генерации начисляются автоматически через 2 секунды
 *   - Никаких реальных API-запросов
 *
 * API документация (реальная): https://yookassa.ru/developers/api
 */

const https = require('https');
const crypto = require('crypto');

const YOOKASSA_API = 'https://api.yookassa.ru/v3';

// Пакеты генераций
const PACKAGES = [
  { id: 'gen_10',  label: '👌 10 генераций',  generations: 10,  price: 100, priceLabel: '100₽', savings: 0, savingsPercent: 0, buyEmoji: '' },
  { id: 'gen_50',  label: '👍 50 генераций',   generations: 50,  price: 400, priceLabel: '400₽', savings: 100, savingsPercent: 20, buyEmoji: '👍' },
  { id: 'gen_100', label: '🔥 100 генераций', generations: 100, price: 700, priceLabel: '700₽', savings: 300, savingsPercent: 30, buyEmoji: '🔥' },
];

// Переопределение демо-режима через runtime (из settings.debug)
let _demoOverride;

/**
 * Установить демо-режим через runtime (из settings.debug админа).
 * @param {boolean|undefined} val — true=демо, false=реальная оплата, undefined=авто
 */
function setDemoOverride(val) {
  _demoOverride = val;
  console.log('💳 Демо-режим:', val === undefined ? 'авто' : val ? 'включён 🧪' : 'выключен');
}

/**
 * Включён ли демо-режим?
 */
function isDemoMode() {
  if (_demoOverride !== undefined) return _demoOverride;
  const shopId = process.env.YOOKASSA_SHOP_ID || '';
  const secretKey = process.env.YOOKASSA_SECRET_KEY || '';
  return !shopId && !secretKey;
}

/**
 * Прочитать ключи ЮKassa из .env
 */
function getConfig() {
  return {
    shopId: process.env.YOOKASSA_SHOP_ID || '',
    secretKey: process.env.YOOKASSA_SECRET_KEY || '',
    returnUrl: process.env.YOOKASSA_RETURN_URL || 'https://t.me/Imgy_bot',
  };
}

/**
 * Проверить, настроена ли оплата (реальная или демо)
 */
function isConfigured() {
  const cfg = getConfig();
  // Даже если ключи не заполнены — считаем настроенным в демо-режиме
  return !!(cfg.shopId && cfg.secretKey) || isDemoMode();
}

// =============================
// ДЕМО-РЕЖИМ — заглушка
// =============================

/**
 * Создать демо-платёж
 */
async function createDemoPayment(telegramId, packageId) {
  const pkg = PACKAGES.find(p => p.id === packageId);
  if (!pkg) throw new Error(`Неизвестный пакет: ${packageId}`);

  // Генерируем UUID-образный ID
  const paymentId = `demo_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

  console.log(`💳 [DEMO] Создан платёж ${paymentId} для ${telegramId}: ${pkg.label} — ${pkg.price}₽`);

  // Демо-ссылка на Telegram-бота (реальная страница для показа)
  const confirmationUrl = 'https://t.me/Imgy_bot?start=payment_demo';

  return {
    paymentId,
    confirmationUrl,
    status: 'pending',
  };
}

/**
 * Проверить статус демо-платежа — всегда успешно
 */
async function checkDemoPayment(paymentId) {
  console.log(`💳 [DEMO] Статус платежа ${paymentId}: succeeded ✅`);
  return {
    status: 'succeeded',
    paid: true,
    metadata: null,
    amount: null,
  };
}

// =============================
// РЕАЛЬНАЯ ЮKASSA
// =============================

/**
 * Создать платёж в ЮKassa
 */
async function createRealPayment(telegramId, packageId) {
  const pkg = PACKAGES.find(p => p.id === packageId);
  if (!pkg) throw new Error(`Неизвестный пакет: ${packageId}`);

  const cfg = getConfig();
  if (!cfg.shopId || !cfg.secretKey) {
    throw new Error('ЮKassa не настроена. Нет shopId или secretKey.');
  }

  const payload = JSON.stringify({
    amount: {
      value: String(pkg.price),
      currency: 'RUB',
    },
    confirmation: {
      type: 'redirect',
      return_url: cfg.returnUrl,
    },
    capture: true,
    description: `${pkg.label} в Imgy Bot`,
    metadata: {
      telegramId: String(telegramId),
      packageId: pkg.id,
      generations: String(pkg.generations),
    },
  });

  const auth = Buffer.from(`${cfg.shopId}:${cfg.secretKey}`).toString('base64');

  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      `${YOOKASSA_API}/payments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
          'Idempotence-Key': `${telegramId}_${packageId}_${Date.now()}`,
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`ЮKassa error: ${JSON.stringify(parsed.error)}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`ЮKassa parse error: ${data.slice(0, 500)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ЮKassa timeout')); });
    req.write(payload);
    req.end();
  });

  if (!result.confirmation?.confirmation_url) {
    throw new Error(`ЮKassa: нет confirmation_url. Ответ: ${JSON.stringify(result).slice(0, 300)}`);
  }

  console.log(`💳 Создан платёж ${result.id} для ${telegramId}: ${pkg.label} — ${pkg.price}₽`);

  return {
    paymentId: result.id,
    confirmationUrl: result.confirmation.confirmation_url,
    status: result.status,
  };
}

/**
 * Проверить статус платежа (реальный)
 */
async function checkRealPayment(paymentId) {
  const cfg = getConfig();
  const auth = Buffer.from(`${cfg.shopId}:${cfg.secretKey}`).toString('base64');

  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      `${YOOKASSA_API}/payments/${paymentId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`ЮKassa parse error: ${data.slice(0, 500)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ЮKassa timeout')); });
    req.end();
  });

  const paid = result.status === 'succeeded';
  console.log(`💳 Статус платежа ${paymentId}: ${result.status}${paid ? ' ✅' : ''}`);

  return {
    status: result.status,
    paid,
    metadata: result.metadata || null,
    amount: result.amount,
  };
}

// =============================
// ЕДИНЫЙ ИНТЕРФЕЙС
// =============================

/**
 * Создать платёж (автовыбор: реальный или демо)
 */
async function createPayment(telegramId, packageId) {
  if (isDemoMode()) {
    return createDemoPayment(telegramId, packageId);
  }
  return createRealPayment(telegramId, packageId);
}

/**
 * Проверить статус платежа (автовыбор: реальный или демо)
 */
async function checkPayment(paymentId) {
  if (paymentId && paymentId.startsWith('demo_')) {
    return checkDemoPayment(paymentId);
  }
  return checkRealPayment(paymentId);
}

module.exports = {
  PACKAGES,
  isConfigured,
  isDemoMode,
  isDemoMode,
  setDemoOverride,
  createPayment,
  checkPayment,
};
