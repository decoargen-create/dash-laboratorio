// Wrapper de Google Drive API con Service Account para el Meta Ads Publisher.
//
// El SA se carga de GOOGLE_SA_JSON (JSON completo en una sola línea, single
// env var). Necesita estar invitado como Editor al folder root y a todas las
// subcarpetas (al ser hijas de un folder shared, lo hereda).
//
// Scopes: drive (full) — necesario para renombrar carpetas (files.update).

import { google } from 'googleapis';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

let _driveClientPromise = null;

/**
 * @returns {Promise<import('googleapis').drive_v3.Drive>}
 */
export function getDriveClient() {
  if (_driveClientPromise) return _driveClientPromise;
  _driveClientPromise = (async () => {
    const raw = process.env.GOOGLE_SA_JSON;
    if (!raw) throw new Error('GOOGLE_SA_JSON no configurada');
    let sa;
    try {
      sa = JSON.parse(raw);
    } catch (err) {
      throw new Error(`GOOGLE_SA_JSON no es JSON válido: ${err.message}`);
    }
    if (!sa.client_email || !sa.private_key) {
      throw new Error('GOOGLE_SA_JSON le faltan client_email o private_key');
    }
    const auth = new google.auth.JWT({
      email: sa.client_email,
      // Las private_key suelen tener \n escapados al pasar por env vars.
      key: sa.private_key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    await auth.authorize();
    return google.drive({ version: 'v3', auth });
  })();
  return _driveClientPromise;
}

/**
 * Lista los hijos directos de un folder (no recursivo).
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {string} parentId
 * @returns {Promise<Array<{ id: string, name: string, mimeType: string }>>}
 */
export async function listChildren(drive, parentId) {
  const all = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 200,
      // includeItemsFromAllDrives + supportsAllDrives son inocuos con My Drive
      // y necesarios si alguna vez se mueve a un Shared Drive.
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageToken,
      orderBy: 'name',
    });
    all.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

/**
 * Filtra solo subfolders.
 */
export function onlyFolders(items) {
  return items.filter(i => i.mimeType === 'application/vnd.google-apps.folder');
}

/**
 * Filtra archivos (excluye folders).
 */
export function onlyFiles(items) {
  return items.filter(i => i.mimeType !== 'application/vnd.google-apps.folder');
}

/**
 * Determina mes+año actual en zona horaria Argentina (UTC-3 fijo, sin DST).
 * @returns {{ month: string, year: number }}
 */
export function currentMonthYearAR() {
  const now = new Date();
  const arMs = now.getTime() - 3 * 60 * 60 * 1000;
  const ar = new Date(arMs);
  return { month: MONTHS_ES[ar.getUTCMonth()], year: ar.getUTCFullYear() };
}

/**
 * Busca dentro de root la subcarpeta cuyo nombre matchea "{Mes} {Año}".
 * Match flexible: case-insensitive, ignora espacios extra.
 * @returns {{id: string, name: string} | null}
 */
export async function findCurrentMonthFolder(drive, rootFolderId) {
  const { month, year } = currentMonthYearAR();
  const children = onlyFolders(await listChildren(drive, rootFolderId));
  const monthLower = month.toLowerCase();
  const yearStr = String(year);
  const found = children.find(f => {
    const n = f.name.toLowerCase();
    return n.includes(monthLower) && n.includes(yearStr);
  });
  return found ? { id: found.id, name: found.name, expectedTag: `${month} ${year}` } : { id: null, name: null, expectedTag: `${month} ${year}` };
}

/**
 * Descarga un archivo Drive como Buffer.
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {string} fileId
 * @returns {Promise<Buffer>}
 */
export async function downloadFile(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data);
}

/**
 * Renombra una carpeta agregando " PUBLICADO" al final si no lo tiene.
 * @returns {Promise<string>} el nuevo nombre
 */
export async function markFolderPublished(drive, folderId, currentName) {
  if (/PUBLICADO\s*$/i.test(currentName)) return currentName;
  const newName = `${currentName.replace(/\s+$/, '')} PUBLICADO`;
  await drive.files.update({
    fileId: folderId,
    requestBody: { name: newName },
    supportsAllDrives: true,
  });
  return newName;
}

/**
 * Clasifica los archivos de una carpeta según su tipo.
 * @param {Array<{id, name, mimeType}>} files
 * @returns {{ kind: 'Videos'|'Estaticos'|'Empty'|'Mixed', items: Array<{id, name, mimeType}>, ignored?: Array }}
 */
export function classifyFolderFiles(files) {
  const real = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
  if (real.length === 0) return { kind: 'Empty', items: [] };

  const videos = real.filter(f => /\.mp4$/i.test(f.name) || (f.mimeType || '').startsWith('video/'));
  const images = real.filter(f => /\.(png|jpe?g)$/i.test(f.name) || (f.mimeType || '').startsWith('image/'));

  if (videos.length > 0 && images.length === 0) return { kind: 'Videos', items: videos };
  if (images.length > 0 && videos.length === 0) return { kind: 'Estaticos', items: images };
  if (videos.length > 0 && images.length > 0) {
    // Mixto → spec dice preferir Videos e ignorar el resto, con warning.
    return { kind: 'Mixed', items: videos, ignored: images };
  }
  return { kind: 'Empty', items: [] };
}

/**
 * Extrae el "número" del archivo de estático: "Copia de 1.png" → "1".
 * Si no matchea el patrón, intenta cualquier número en el nombre.
 * Si nada matchea, devuelve el nombre sin extensión.
 */
export function extractStaticNumber(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  const copia = base.match(/Copia de\s+(.+)/i);
  if (copia) return copia[1].trim();
  const num = base.match(/(\d+)/);
  if (num) return num[1];
  return base;
}

export { MONTHS_ES };
