#!/usr/bin/env node
/**
 * Google Analytics 4 — отправка событий через Measurement Protocol
 *
 * Настройка:
 *   GA_MEASUREMENT_ID=G-XXXXXXXX  — ID потока данных в GA4
 *   GA_API_SECRET=xxx              — секрет Measurement Protocol (Admin → Data Streams → Measurement Protocol API secrets)
 *   GA_DEMO=1                      — (опц.) логировать в stdout, не слать в GA
 *
 * Каждое событие отправляется с client_id = telegram_id пользователя
 * и user_properties (атрибуты пользователя: генерации, число аватаров и т.д.).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const detectCountry = require('./detect-country').detectCountry;

let config = null;
let buffer = [];
let flushTimer = null;
let totalSent = 0;

const FLUSH_INTERVAL_MS = 5_000;    // сбрасывать каждые 5 секунд
const BATCH_MAX_EVENTS = 25;         // GA4 лимит — 25 событий на хит

/**
 * Инициализировать модуль.
 * @returns {boolean}
 */
function init() {
  const measurementId = process.env.GA_MEASUREMENT_ID || '';
  const apiSecret = process.env.GA_API_SECRET || '';
  const demo = process.env.GA_DEMO === '1' || process.env.GA_DEMO === 'true';

  if (!measurementId && !apiSecret && !demo) {
    console.log('📊 GA4: не настроен (нужны GA_MEASUREMENT_ID + GA_API_SECRET)');
    return false;
  }

  if (!measurementId || !apiSecret) {
    if (demo) {
      console.log('📊 GA4: ДЕМО-РЕЖИМ (лог в stdout)');
      config = { demo: true };
      startFlusher();
      return true;
    }
    console.log('📊 GA4: не настроен — не хватает ключей');
    return false;
  }

  config = { measurementId, apiSecret };
  console.log(`📊 GA4: инициализирован, measurementId=${measurementId}`);
  startFlusher();
  return true;
}

function startFlusher() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  process.on('exit', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ===================== Загрузка данных пользователя =====================

/**
 * Найти пользователя по telegramId в users.json.
 * Возвращает user-объект или null.
 */
function findUserByTelegram(telegramId) {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    return users.find(u => u.telegram === `@${telegramId}`) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Собрать user_properties для GA4 из данных пользователя.
 * Возвращает объект вида { key: { value: '...' }, ... }.
 */
function buildUserProperties(user, telegramId) {
  const props = {};

  if (user) {
    props.generations_remaining = { value: String(user.generationsRemaining ?? 0) };
    props.total_avatars = { value: String((user.avatars || []).length) };
    props.user_id_internal = { value: user.id };
    props.has_purchased = { value: String((user.generationsRemaining ?? 0) > 5 || false) };
    if (user.language) props.language = { value: user.language };

    // Страна: из сохранённой или детектим из языка
    let country = user.country || '';
    if (!country && user.language) {
      country = detectCountry(user.language);
    }
    if (country) props.country = { value: country };
    if (user.isPremium !== undefined) {
      props.is_premium = { value: String(user.isPremium) };
    }
  } else {
    // Неизвестный пользователь — хотя бы id передаём
    props.generations_remaining = { value: '0' };
    props.total_avatars = { value: '0' };
  }

  props.telegram_id = { value: telegramId };

  return props;
}

// ===================== Отправка в GA4 =====================

/**
 * Отправить запрос для одного пользователя (одна пачка событий одного client_id).
 */
function sendUserBatch(clientId, userEvents) {
  if (!config || config.demo) {
    if (config?.demo) {
      const user = findUserByTelegram(clientId);
      const userProps = buildUserProperties(user, clientId);
      console.log(`📊 [DEMO] client=${clientId} props=${JSON.stringify(userProps)}`);
      userEvents.forEach(e => {
        const params = Object.entries(e.params || {})
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        console.log(`📊 [DEMO]   → ${e.name} ${params}`);
      });
    }
    return;
  }

  // Подтягиваем данные пользователя
  const user = findUserByTelegram(clientId);
  const userProps = buildUserProperties(user, clientId);

  const body = JSON.stringify({
    client_id: clientId,
    user_properties: userProps,
    events: userEvents.map(e => ({
      name: e.name,
      params: {
        ...e.params,
        engagement_time_msec: 1
      }
    }))
  });

  const url = `https://www.google-analytics.com/mp/collect?api_secret=${config.apiSecret}&measurement_id=${config.measurementId}`;

  const req = https.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 5000
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      if (res.statusCode === 204 || res.statusCode === 200) {
        totalSent += userEvents.length;
      } else {
        console.error(`📊 GA4 ошибка [${res.statusCode}] user=${clientId}: ${(data || '').slice(0, 300)}`);
      }
    });
  });
  req.on('error', err => console.error('📊 GA4 network error:', err.message));
  req.write(body);
  req.end();
}

/**
 * Отправить пачку событий в GA4.
 * Группирует по client_id и отправляет отдельный запрос для каждого пользователя.
 */
function sendBatch(events) {
  if (!config || events.length === 0) return;

  // Группируем события по client_id
  const groups = {};
  for (const e of events) {
    const cid = e.client_id || 'unknown';
    if (!groups[cid]) groups[cid] = [];
    groups[cid].push(e);
  }

  for (const [clientId, userEvents] of Object.entries(groups)) {
    sendUserBatch(clientId, userEvents);
  }
}

function flush() {
  if (!buffer || buffer.length === 0) return;
  const batch = buffer.splice(0, BATCH_MAX_EVENTS);
  sendBatch(batch);
}

// ===================== Public API =====================

/**
 * Отправить событие в GA4.
 *
 * @param {string} eventName — имя события (латиница, без пробелов)
 * @param {object} params    — параметры события
 *
 * Пример:
 *   track('generation_completed', { style_id: 'portrait', model: 'gemini-2.0-flash', telegram_id: '12345' })
 */
function track(eventName, params = {}) {
  if (!config) return;

  // Извлекаем telegram_id для client_id
  let clientId = params.telegram_id || '';
  if (typeof clientId === 'string' && clientId.startsWith('@')) clientId = clientId.slice(1);

  // Убираем telegram_id из params — client_id уже несёт эту информацию
  const cleanParams = { ...params };
  delete cleanParams.telegram_id;

  buffer.push({
    name: eventName.replace(/:/g, '_'),
    client_id: clientId || 'unknown',
    params: cleanParams
  });

  if (buffer.length >= BATCH_MAX_EVENTS) flush();
}

function shutdown() {
  clearInterval(flushTimer);
  flushTimer = null;
  flush();
  console.log(`📊 GA4: отправлено ${totalSent} событий за сессию`);
}

module.exports = { init, track, shutdown };
