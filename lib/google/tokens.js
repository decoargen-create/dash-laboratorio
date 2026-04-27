// Wrapper sobre lib/tokens/google.js + lib/google/oauth.js que garantiza
// un access_token vigente. Si el guardado en KV está vencido, hace refresh
// con el refresh_token y persiste el nuevo en KV.
//
// El cron orchestrator y el endpoint api/google/list-folders lo usan.
// IMPORTANTE: si el refresh falla con error 'invalid_grant' (refresh_token
// revocado/expirado), borra el token de KV y devuelve null. El user va a
// tener que reconectar Google manualmente.

import { loadGoogleToken, saveGoogleToken, deleteGoogleToken } from '../tokens/google.js';
import { refreshAccessToken, tokenNeedsRefresh } from './oauth.js';

/**
 * Devuelve un token vigente para el user, refrescando si hace falta.
 * Si el user no tiene token guardado o el refresh falla irrecuperablemente,
 * devuelve null.
 *
 * @param {string} userId
 * @returns {Promise<{ accessToken: string, refreshToken: string|null, expiresAt: number, scopes: string[] } | null>}
 */
export async function getValidGoogleToken(userId) {
  const stored = await loadGoogleToken(userId);
  if (!stored) return null;

  if (!tokenNeedsRefresh(stored)) return stored;

  // Necesita refresh.
  if (!stored.refreshToken) {
    console.warn(`[google/tokens] user ${userId}: token vencido pero no hay refresh_token. Borrando.`);
    await deleteGoogleToken(userId);
    return null;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID/SECRET no configuradas — no puedo refrescar tokens');
  }

  let refreshed;
  try {
    refreshed = await refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: stored.refreshToken,
    });
  } catch (err) {
    // invalid_grant es irrecuperable: el user revocó la app en Google o
    // el refresh_token expiró por inactividad (>6 meses). Borramos KV.
    if (err.code === 'invalid_grant') {
      console.warn(`[google/tokens] user ${userId}: invalid_grant, borrando token`);
      await deleteGoogleToken(userId);
      return null;
    }
    throw err;
  }

  // Persistir el nuevo access_token. Google a veces NO devuelve un nuevo
  // refresh_token (mantenés el viejo), así que solo updateamos lo que vino.
  const persisted = await saveGoogleToken(userId, {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || stored.refreshToken,
    expiresInSeconds: refreshed.expires_in,
    scopes: stored.scopes || (refreshed.scope ? refreshed.scope.split(' ') : []),
  });

  return persisted;
}
