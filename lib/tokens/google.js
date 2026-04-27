// Storage de tokens Google OAuth por user (Fase 5).
//
// Hoy es un placeholder: loadGoogleToken siempre devuelve null. El cron
// orchestrator detecta eso y cae en fallback al Service Account global
// (GOOGLE_SA_JSON). Cuando se implemente OAuth Google real, este archivo
// va a alojar saveGoogleToken / refreshGoogleToken / etc.
//
// Layout KV (futuro): google_token:{userId} → { accessToken, refreshToken,
//   expiresAt, scopes, savedAt }
//
// El access_token de Google dura 1h. Se refresca con refresh_token cuando
// está vencido (o cerca, con margen de 5min).

import { kv } from '@vercel/kv';

const KEY = (userId) => `google_token:${userId}`;

/**
 * @param {string} userId
 * @returns {Promise<{ accessToken, refreshToken, expiresAt, scopes, savedAt } | null>}
 */
export async function loadGoogleToken(userId) {
  if (!userId) return null;
  const data = await kv.get(KEY(userId));
  if (!data) return null;
  return data;
}

/**
 * @param {string} userId
 * @param {{ accessToken: string, refreshToken?: string, expiresInSeconds?: number, scopes?: string[] }} payload
 */
export async function saveGoogleToken(userId, payload) {
  if (!userId) throw new Error('saveGoogleToken: userId requerido');
  if (!payload?.accessToken) throw new Error('saveGoogleToken: accessToken requerido');
  const ttl = payload.expiresInSeconds && payload.expiresInSeconds > 0
    ? payload.expiresInSeconds
    : 3600;
  const value = {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken || null,
    expiresAt: Math.floor(Date.now() / 1000) + ttl,
    scopes: payload.scopes || [],
    savedAt: new Date().toISOString(),
  };
  // El access_token va a expirar pronto pero NO le ponemos TTL al KV record:
  // queremos retener el refresh_token para hacer refresh transparente. El
  // expiresAt en el value lo usa el caller para decidir si refresh.
  await kv.set(KEY(userId), value);
  return value;
}

/**
 * Borra el token (data-deletion).
 */
export async function deleteGoogleToken(userId) {
  if (!userId) return false;
  await kv.del(KEY(userId));
  return true;
}
