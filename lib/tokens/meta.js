// Storage de tokens Meta long-lived por user.
//
// Cuando el user conecta Meta desde el panel (OAuth), api/meta/[action].js
// callback intercambia code → short token → long token. Además de guardar
// la cookie viora-meta-session (single-tenant legacy), si el user vino con
// session de viora identificada, guardamos el long token también acá. El
// cron orchestrator lo usa para correr automations sin necesidad de la
// cookie del navegador.
//
// Layout KV: meta_token:{userId} → { accessToken, expiresAt, metaUserId, metaUserName, savedAt }
//
// El long-lived token de Meta dura ~60 días. expiresAt nos sirve para
// detectar tokens vencidos y notificar al user (Discord webhook) que hay
// que reconectar.

import { kv } from '@vercel/kv';

const KEY = (userId) => `meta_token:${userId}`;

// Long-lived dura ~60d. Damos 55d al guardar para tener buffer y warning
// proactivo antes del vencimiento.
const DEFAULT_TTL_SECONDS = 55 * 24 * 60 * 60;

/**
 * @param {string} userId
 * @param {{ accessToken: string, expiresInSeconds?: number, metaUserId?: string, metaUserName?: string }} payload
 */
export async function saveMetaToken(userId, payload) {
  if (!userId) throw new Error('saveMetaToken: userId requerido');
  if (!payload?.accessToken) throw new Error('saveMetaToken: accessToken requerido');

  const ttl = payload.expiresInSeconds && payload.expiresInSeconds > 0
    ? payload.expiresInSeconds
    : DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const value = {
    accessToken: payload.accessToken,
    expiresAt: now + ttl,
    metaUserId: payload.metaUserId || null,
    metaUserName: payload.metaUserName || null,
    savedAt: new Date().toISOString(),
  };
  // KV con TTL: el record se borra solo cuando expira el long-lived. Nice.
  await kv.set(KEY(userId), value, { ex: ttl });
  return value;
}

/**
 * @param {string} userId
 * @returns {Promise<{ accessToken, expiresAt, metaUserId, metaUserName, savedAt } | null>}
 */
export async function loadMetaToken(userId) {
  if (!userId) return null;
  const data = await kv.get(KEY(userId));
  if (!data) return null;
  // Defensive: si está vencido, no devolverlo.
  if (data.expiresAt && Math.floor(Date.now() / 1000) >= data.expiresAt) return null;
  return data;
}

/**
 * Borra el token (logout / revoke / data-deletion).
 */
export async function deleteMetaToken(userId) {
  if (!userId) return false;
  await kv.del(KEY(userId));
  return true;
}

/**
 * Días que faltan hasta que expire. Útil para warnings al user.
 */
export function daysUntilExpiry(token) {
  if (!token?.expiresAt) return null;
  const secs = token.expiresAt - Math.floor(Date.now() / 1000);
  return Math.max(0, Math.floor(secs / (24 * 60 * 60)));
}
