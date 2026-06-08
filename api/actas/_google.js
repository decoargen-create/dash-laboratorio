// Acceso a Google Drive vía service account, sin la librería googleapis
// (firmamos el JWT a mano con crypto para mantener el bundle liviano).
//
// Requiere la env var GOOGLE_SERVICE_ACCOUNT_JSON con el JSON de la cuenta de
// servicio (o ese JSON en base64). La carpeta de transcripciones tiene que
// estar compartida con el client_email de la service account como Editor.

import crypto from 'node:crypto';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let cachedToken = null; // { token, exp(ms) }

export function getCreds() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch {
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')); }
    catch { return null; }
  }
}

export function driveConfigured() {
  const creds = getCreds();
  return !!(creds?.client_email && creds?.private_key && process.env.DRIVE_TRANSCRIPTS_FOLDER_ID);
}

export async function getAccessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;

  const creds = getCreds();
  if (!creds?.client_email || !creds?.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ausente o inválida');
  }
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;

  const key = creds.private_key.includes('\\n')
    ? creds.private_key.replace(/\\n/g, '\n')
    : creds.private_key;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(key).toString('base64url');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Google token: ${data.error_description || data.error || resp.status}`);
  }
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function authedFetch(token, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Drive ${init.method || 'GET'} ${r.status}: ${body.slice(0, 200)}`);
  }
  return r;
}

export async function driveList(token, params) {
  const u = new URL(`${DRIVE}/files`);
  u.search = new URLSearchParams({ supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...params }).toString();
  return (await authedFetch(token, u)).json();
}

// Exporta un Google Doc a texto plano.
export async function driveExportDoc(token, fileId) {
  const u = `${DRIVE}/files/${fileId}/export?mimeType=text/plain&supportsAllDrives=true`;
  return (await authedFetch(token, u)).text();
}

// Lee el contenido (JSON) de un archivo subido.
export async function driveGetJson(token, fileId) {
  const u = `${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`;
  return (await authedFetch(token, u)).json();
}

// Crea un archivo JSON dentro de un folder (multipart: metadata + contenido).
export async function driveCreateJson(token, parentId, name, obj) {
  const boundary = 'acta_' + crypto.randomBytes(8).toString('hex');
  const metadata = { name, parents: [parentId], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n` +
    `--${boundary}--`;
  const r = await authedFetch(token, `${UPLOAD}?uploadType=multipart&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return r.json();
}

// Crea un archivo binario (PNG, JPG, etc.) dentro de un folder de Drive.
// Devuelve { id, name, webViewLink }.
export async function driveCreateBinary(token, parentId, name, mimeType, buffer) {
  const boundary = 'bin_' + crypto.randomBytes(8).toString('hex');
  const metadata = { name, parents: [parentId], mimeType };
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head, 'utf-8'), Buffer.from(buffer), Buffer.from(tail, 'utf-8')]);
  const r = await authedFetch(token, `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return r.json();
}

// Devuelve el id del subfolder `name` dentro de parentId, creándolo si no existe.
export async function driveEnsureFolder(token, parentId, name) {
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`;
  const found = await driveList(token, { q, fields: 'files(id,name)', pageSize: 1 });
  if (found.files?.length) return found.files[0].id;
  const r = await authedFetch(token, `${DRIVE}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  return (await r.json()).id;
}
