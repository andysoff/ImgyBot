#!/usr/bin/env node
/**
 * Yandex Cloud Monitoring — отправка метрик
 *
 * Настройка:
 *   YC_API_KEY=xxx     — API-ключ сервисного аккаунта
 *   YC_FOLDER_ID=xxx   — ID каталога в Яндекс.Облаке
 *   YC_METRICS_DEMO=1  — (опц.) логировать в stdout, не слать в облако
 *
 * Права сервисному аккаунту:
 *   yc resource-manager folder add-access-binding <folder-id> \
 *     --role monitoring.editor \
 *     --subject serviceAccount:<sa-id>
 */

const https = require('https');
const YC_API = 'https://monitoring.api.cloud.yandex.net/monitoring/v2/data/write';

// ===================== Конфигурация =====================

let config = null;
let buffer = [];
let flushTimer = null;
const FLUSH_INTERVAL_MS = 10_000;
const BATCH_MAX = 50;
let totalSent = 0;

/**
 * Инициализировать модуль метрик.
 * Вызывается один раз при старте бота.
 * @returns {boolean} true если метрики настроены
 */
function init() {
  const apiKey = process.env.YC_API_KEY || '';
  const folderId = process.env.YC_FOLDER_ID || '';
  const demo = process.env.YC_METRICS_DEMO === '1' || process.env.YC_METRICS_DEMO === 'true';

  if (!apiKey && !folderId && !demo) {
    console.log('📊 YC Monitoring: не настроен (нужны YC_API_KEY + YC_FOLDER_ID)');
    return false;
  }

  if (!apiKey || !folderId) {
    if (demo) {
      console.log('📊 YC Monitoring: ДЕМО-РЕЖИМ (лог в stdout)');
      config = { demo: true };
      startFlusher();
      return true;
    }
    console.log('📊 YC Monitoring: не настроен — не хватает ключей');
    return false;
  }

  config = { apiKey, folderId };
  console.log(`📊 YC Monitoring: инициализирован, каталог ${folderId}`);
  startFlusher();
  return true;
}

function startFlusher() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  process.on('exit', () => {
    clearInterval(flushTimer);
    flush();
  });
  process.on('SIGINT', () => { clearInterval(flushTimer); flush(); });
  process.on('SIGTERM', () => { clearInterval(flushTimer); flush(); });
}

// ===================== Отправка =====================

/**
 * Отправить пачку точек в YC Monitoring.
 */
function sendBatch(points) {
  if (!config || config.demo) {
    // Демо-режим — логируем
    if (config?.demo) {
      points.forEach(p => {
        console.log(`📊 [DEMO] ${p.name} labels=${JSON.stringify(p.labels)} ts=${p.ts}`);
      });
    }
    return;
  }

  const body = JSON.stringify({
    folderId: config.folderId,
    metrics: points.map(p => ({
      name: p.name,
      labels: p.labels || {},
      type: 'DGAUGE',
      ts: p.ts,
      value: p.value
    }))
  });

  const req = https.request(YC_API, {
    method: 'POST',
    headers: {
      'Authorization': `Api-Key ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 5000
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      if (res.statusCode === 200) {
        totalSent += points.length;
      } else {
        console.error(`📊 YC Monitoring ошибка [${res.statusCode}]: ${(data || '').slice(0, 300)}`);
      }
    });
  });
  req.on('error', err => console.error('📊 YC Monitoring network error:', err.message));
  req.write(body);
  req.end();
}

/**
 * Сбросить буфер в облако.
 */
function flush() {
  if (!buffer || buffer.length === 0) return;
  const batch = buffer.splice(0, BATCH_MAX);
  sendBatch(batch);
}

// ===================== Public API =====================

/**
 * Отправить событие-метрику.
 *
 * @param {string} eventName  — имя события (точка в дашборде)
 * @param {object} labels     — метки для группировки (telegram_id, style_id и т.д.)
 *
 * Пример:
 *   track('generation:completed', { telegram_id: '132454710', style_id: 'portrait', model: 'gemini-2.0-flash' })
 */
function track(eventName, labels = {}) {
  if (!config) return;

  // На всякий случай обрезаем telegram_id — только числовая часть
  let tid = labels.telegram_id || '';
  if (typeof tid === 'string' && tid.startsWith('@')) tid = tid.slice(1);

  const point = {
    name: `imgy.${eventName}`,
    labels: { ...labels, telegram_id: tid },
    type: 'DGAUGE',
    ts: new Date().toISOString(),
    value: 1,
  };

  buffer.push(point);

  // Если буфер переполнен — сбрасываем немедленно
  if (buffer.length >= BATCH_MAX) flush();
}

/**
 * Принудительно сбросить буфер (вызывать при shutdown).
 */
function shutdown() {
  clearInterval(flushTimer);
  flushTimer = null;
  flush();
  console.log(`📊 YC Monitoring: отправлено ${totalSent} метрик за сессию`);
}

module.exports = { init, track, shutdown };
