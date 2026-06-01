#!/usr/bin/env node
/**
 * Модуль оплаты через ЮMoney (ЮKassa)
 *
 * Создание платежей, проверка статуса, начисление генераций.
 *
 * API документация: https://yookassa.ru/developers/api
 */

const https = require('https');

const YOOKASSA_API = 'https://api.yookassa.ru/v3';

// Пакеты генераций
const PACKAGES = [
  { id: 'gen_10',  label: '🔟 10 генераций',  generations: 10,  price: 50 },
  { id: 'gen_30',  label: '📦 30 генераций',  generations: 30,  price: 150 },
  { id: 'gen_100', label: '🚀 100 генераций', generations: 100, price: 500 },
];

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
 * Проверить, что ЮKassa настроена
 */
function isConfigured() {
  const cfg = getConfig();
  return !!(cfg.shopId && cfg.secretKey);
}

/**
 * Создать платёж в ЮKassa
 *
 * @param {number} telegramId — ID пользователя в Telegram
 * @param {string} packageId  — ID пакета (gen_10, gen_30, gen_100)
 * @returns {Promise<{paymentId: string, confirmationUrl: string}>}
 */
async function createPayment(telegramId, packageId) {
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
 * Проверить статус платежа
 *
 * @param {string} paymentId — ID платежа в ЮKassa
 * @returns {Promise<{status: string, paid: boolean, metadata: object|null}>}
 */
async function checkPayment(paymentId) {
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

module.exports = {
  PACKAGES,
  isConfigured,
  createPayment,
  checkPayment,
};
