// Storage de tokens Meta long-lived por user.
//
// Cuando el user conecta Meta desde el panel (OAuth), api/meta/[action].js
// callback intercambia code → short token → long token. Además de guardar
// la cookie viora-meta-session (single-tenant legacy), si el user vino con
// session de viora identificada, guardamos el long token también acá. El
// cron orchestrator lo usa para correr automations sin necesidad de la
// cookie del navegador.
//
// Layout KV:
//   meta_token:{userId}                 → { accessToken, expiresAt, metaUserId, metaUserName, savedAt }
//   meta_user_to_viora:{metaUserId}     → vioraUserId
//
// El reverse mapping (segunda key) lo usa el data-deletion-callback de
// Meta para encontrar a qué viora user pertenece un metaUserId dado
// (Meta nos manda solo el FB user_id en signed_request).
//
// El long-lived token de Meta dura ~60 días. expiresAt nos sirve para
// detectar tokens vencidos y notificar al user (Discord webhook) que hay
// que reconectar.

import { kv } from '@vercel/kv';

const KEY = (userId) => `meta_token:${userId}`;
const KEY_REVERSE = (metaUserId) => `meta_user_to_viora:${metaUserId}`;

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
  // Reverse index: para poder mapear metaUserId → vioraUserId al recibir
  // el data-deletion callback de Meta. Mismo TTL así no quedan dangling.
  if (payload.metaUserId) {
    await kv.set(KEY_REVERSE(payload.metaUserId), userId, { ex: ttl });
  }
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
 * Lookup inverso: dado un metaUserId, devuelve el vioraUserId asociado
 * (o null si no hay mapping). Usado por el data-deletion-callback.
 */
export async function findVioraUserByMetaUserId(metaUserId) {
  if (!metaUserId) return null;
  const userId = await kv.get(KEY_REVERSE(metaUserId));
  return userId || null;
}

/**
 * Borra el token (logout / revoke / data-deletion). Si conocemos el
 * metaUserId del record, también borramos el reverse mapping.
 */
export async function deleteMetaToken(userId) {
  if (!userId) return false;
  // Leemos antes de borrar para conocer el metaUserId.
  const stored = await kv.get(KEY(userId));
  await kv.del(KEY(userId));
  if (stored?.metaUserId) {
    await kv.del(KEY_REVERSE(stored.metaUserId));
  }
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
