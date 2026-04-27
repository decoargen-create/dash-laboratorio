// Helper centralizado para borrar TODOS los datos de un user del sistema.
// Usado por:
//   - api/auth/delete-account.js (el user pide borrar su cuenta).
//   - api/auth/data-deletion-callback.js (Meta recibe la pedida y nos
//     llama por backend según su spec de Data Deletion Request).
//
// Lo que borra:
//   1. Todas las automations del user + su state KV
//      (deleteAllAutomationsForUser cubre estas dos cosas).
//   2. El Meta token (+ el reverse index meta_user_to_viora).
//   3. El Google token (revocando primero en Google's side si tiene
//      refresh_token; si falla, igualmente borra del KV).
//
// Lo que NO borra (y NO debería):
//   - El record en AUTH_USERS (env var, read-only desde el código).
//   - Logs de Vercel (los administra el laboratorio).
//
// Idempotente: llamarlo dos veces no rompe nada.

import { deleteAllAutomationsForUser } from '../automations/store.js';
import { deleteMetaToken, loadMetaToken } from '../tokens/meta.js';
import { deleteGoogleToken, loadGoogleToken } from '../tokens/google.js';
import { revokeToken } from '../google/oauth.js';

/**
 * @param {string} userId
 * @returns {Promise<{
 *   ok: true,
 *   automations_deleted: number,
 *   meta_token_deleted: boolean,
 *   google_token_deleted: boolean,
 *   google_revoked: boolean,
 *   errors: string[]
 * }>}
 */
export async function purgeUserData(userId) {
  if (!userId) throw new Error('purgeUserData: userId requerido');

  const errors = [];

  let automationsDeleted = 0;
  try {
    automationsDeleted = await deleteAllAutomationsForUser(userId);
  } catch (err) {
    errors.push(`automations: ${err.message}`);
  }

  // Meta: borrar el token. No revocamos en Meta (no es necesario para
  // GDPR/Meta data deletion — basta con borrar nuestro lado).
  let metaDeleted = false;
  try {
    const existed = await loadMetaToken(userId);
    if (existed) {
      await deleteMetaToken(userId);
      metaDeleted = true;
    }
  } catch (err) {
    errors.push(`meta token: ${err.message}`);
  }

  // Google: intentar revoke + borrar.
  let googleDeleted = false;
  let googleRevoked = false;
  try {
    const existing = await loadGoogleToken(userId);
    if (existing) {
      // Revocar el refresh_token revoca toda la cadena. Si falla, igual
      // borramos del KV — lo importante es no usarlo nunca más.
      try {
        if (existing.refreshToken) {
          await revokeToken(existing.refreshToken);
          googleRevoked = true;
        } else if (existing.accessToken) {
          await revokeToken(existing.accessToken);
          googleRevoked = true;
        }
      } catch (err) {
        errors.push(`google revoke: ${err.message}`);
      }
      await deleteGoogleToken(userId);
      googleDeleted = true;
    }
  } catch (err) {
    errors.push(`google token: ${err.message}`);
  }

  return {
    ok: true,
    automations_deleted: automationsDeleted,
    meta_token_deleted: metaDeleted,
    google_token_deleted: googleDeleted,
    google_revoked: googleRevoked,
    errors,
  };
}
