// Producción — inicia una subida de video DIRECTA a Google Drive.
//
// Por qué directa: los videos pesan más que el límite de body de Vercel
// (4.5MB), así que NO pueden pasar por una función serverless. En su lugar:
//   1. Acá (server) creamos/aseguramos la carpeta correcta en Drive y
//      abrimos una "resumable upload session" con el token de la service
//      account. Google devuelve una session URI ya pre-autorizada.
//   2. El browser hace un PUT del video directo a esa session URI (los bytes
//      viajan browser → Google, nunca tocan Vercel).
//
// Nomenclatura y ubicación las decide el server (el equipo no tiene que
// acordarse de nada): Producción / <Producto> / <Persona>, y el archivo se
// renombra a un formato consistente.
//
// Si Drive no está configurado, devolvemos { configured:false } y el browser
// cae a guardar en el bucket de AdsLab (Supabase) — así la subida siempre
// funciona aunque todavía no hayas conectado la carpeta de Drive.

import { getUserIdFromAuth } from '../marketing/_supabase-server.js';
import { getCreds, getAccessToken, driveEnsureFolder } from '../actas/_google.js';

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

// Carpeta raíz de creativos en Drive. Preferimos una dedicada; si no está,
// caemos a la de transcripciones (creando un subfolder "Producción" adentro,
// así los creativos NO se mezclan con las actas).
function creativosRootId() {
  return process.env.DRIVE_CREATIVOS_FOLDER_ID || process.env.DRIVE_TRANSCRIPTS_FOLDER_ID || null;
}

function driveReady() {
  const creds = getCreds();
  return !!(creds?.client_email && creds?.private_key && creativosRootId());
}

// Saca caracteres que rompen nombres de archivo/carpeta en Drive.
function clean(s, fallback = '') {
  const t = String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || fallback;
}

// Nomenclatura del archivo final: "<Producto> - <Persona> - <tipo> - <fecha> - <original>".
function buildName({ productoNombre, persona, tipo, weekKey, filename }) {
  const ext = (String(filename).split('.').pop() || 'mp4').toLowerCase().slice(0, 5);
  const base = clean(String(filename).replace(/\.[^.]+$/, ''), 'video').slice(0, 60);
  const parts = [
    clean(productoNombre, 'Producto'),
    clean(persona, 'Equipo'),
    clean(tipo, 'renovado'),
    clean(weekKey),
    base,
  ].filter(Boolean);
  return `${parts.join(' - ')}.${ext}`;
}

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  // Body puede venir como objeto (Vercel lo parsea) o como string.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const { productoNombre, persona, tipo, weekKey, filename, mimeType, size } = body;
  if (!filename) return respondJSON(res, 400, { error: 'Falta el nombre del archivo.' });

  // Drive no configurado → el browser guarda en AdsLab (Supabase). No es error.
  if (!driveReady()) {
    return respondJSON(res, 200, { configured: false, reason: 'drive-no-configurado' });
  }

  try {
    const token = await getAccessToken();
    const rootId = creativosRootId();

    // Carpeta: [raíz]/Producción/<Producto>/<Persona>
    // (si la raíz ya es la carpeta de creativos, igual queda ordenado adentro).
    const prodRoot = await driveEnsureFolder(token, rootId, 'Producción');
    const prodFolder = await driveEnsureFolder(token, prodRoot, clean(productoNombre, 'Producto'));
    const personaFolder = await driveEnsureFolder(token, prodFolder, clean(persona, 'Equipo'));

    const finalName = buildName({ productoNombre, persona, tipo, weekKey, filename });
    const contentType = mimeType || 'video/mp4';

    // Abrir la resumable session. Google devuelve la session URI en Location.
    const initResp = await fetch(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': contentType,
        ...(size ? { 'X-Upload-Content-Length': String(size) } : {}),
      },
      body: JSON.stringify({ name: finalName, parents: [personaFolder] }),
    });

    if (!initResp.ok) {
      const t = await initResp.text().catch(() => '');
      return respondJSON(res, 502, { error: `Drive no aceptó la subida (${initResp.status}): ${t.slice(0, 180)}` });
    }
    const sessionUri = initResp.headers.get('location');
    if (!sessionUri) {
      return respondJSON(res, 502, { error: 'Drive no devolvió la URL de subida.' });
    }

    const folderLink = `https://drive.google.com/drive/folders/${personaFolder}`;
    return respondJSON(res, 200, { configured: true, sessionUri, finalName, folderId: personaFolder, folderLink, contentType });
  } catch (err) {
    return respondJSON(res, 500, { error: `Error abriendo la subida a Drive: ${err.message}` });
  }
}
