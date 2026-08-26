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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getDriveContext() {
  // 1) OAuth del dueño (preferido: sube a su Drive personal, con sus 15GB).
  //    CON REINTENTOS: un hipo transitorio de Google (el refresh del access
  //    token, o el list/create de la carpeta raíz) NO debe hacernos caer a la
  //    service account — que en este setup NO tiene storage quota y devuelve
  //    403 "Service Accounts do not have storage quota", mandando TODO a AdsLab.
  //    getGoogleOAuth también se reintenta por si el read a la tabla falla suelto.
  let conn = null;
  for (let i = 0; i < 3 && !conn; i++) {
    try { conn = await getGoogleOAuth(); } catch { conn = null; }
    if (!conn && i < 2) await sleep(300);
  }
  if (conn?.refreshToken) {
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const token = await oauthAccessFromRefresh(conn.refreshToken);
        // Carpeta raíz en SU Drive (se crea sola la primera vez).
        const rootId = await driveEnsureFolder(token, 'root', ROOT_NAME);
        return { token, rootId, mode: 'oauth', email: conn.email || null };
      } catch (e) {
        console.warn(`[drive-ctx] oauth intento ${intento}/3 falló:`, e?.message || e);
        if (intento < 3) await sleep(500 * intento);
      }
    }
    // OAuth conectado pero Google no respondió tras 3 intentos. NO usamos la
    // service account (403 sin quota → todo caería a AdsLab). Devolvemos una
    // marca de fallo transitorio para que el server informe claro; el front usa
    // AdsLab solo como último recurso (raro ya con reintentos).
    console.warn('[drive-ctx] OAuth conectado pero falló tras reintentos — NO caigo a la service account.');
    return { failed: 'oauth', email: conn.email || null };
  }

  // 2) Service account + carpeta compartida — SOLO si NO hay OAuth conectado.
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
