// Contexto de subida a Drive: decide con QUÉ cuenta subir.
//   1) OAuth del dueño del lab (Drive personal @gmail) — preferido, sube COMO
//      el usuario usando sus 15GB. Resuelve el 403 "service accounts have no
//      storage quota".
//   2) Service account + carpeta compartida (sirve con Google Workspace /
//      shared drives). Fallback.
// Devuelve { token, rootId, mode:'oauth'|'sa', email? } o null si no hay forma.

import { getGoogleOAuth } from '../marketing/_supabase-server.js';
import { getCreds, getAccessToken, oauthAccessFromRefresh, driveEnsureFolder } from '../actas/_google.js';

const ROOT_NAME = 'Creativos AdsLab';

export async function getDriveContext() {
  // 1) OAuth del usuario
  try {
    const conn = await getGoogleOAuth();
    if (conn?.refreshToken) {
      const token = await oauthAccessFromRefresh(conn.refreshToken);
      // Carpeta raíz en SU Drive (se crea sola la primera vez).
      const rootId = await driveEnsureFolder(token, 'root', ROOT_NAME);
      return { token, rootId, mode: 'oauth', email: conn.email || null };
    }
  } catch (e) {
    console.warn('[drive-ctx] oauth falló:', e?.message || e);
  }

  // 2) Service account + carpeta compartida
  const creds = getCreds();
  const dedic = process.env.DRIVE_CREATIVOS_FOLDER_ID;
  const trans = process.env.DRIVE_TRANSCRIPTS_FOLDER_ID;
  if (creds?.client_email && creds?.private_key && (dedic || trans)) {
    try {
      const token = await getAccessToken();
      const rootId = dedic || await driveEnsureFolder(token, trans, 'Creativos');
      return { token, rootId, mode: 'sa' };
    } catch (e) {
      console.warn('[drive-ctx] service account falló:', e?.message || e);
    }
  }
  return null;
}
