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

// El archivo conserva su nombre original (la carpeta ya da todo el contexto:
// Producto / Persona - fecha).
function finalFileName(filename) {
  const ext = (String(filename).split('.').pop() || 'mp4').toLowerCase().slice(0, 5);
  const base = clean(String(filename).replace(/\.[^.]+$/, ''), 'video').slice(0, 80);
  return `${base}.${ext}`;
}

// Fecha de hoy (horario AR) → 'YYYY-MM-DD', para nombrar la carpeta de la subida.
function hoyAR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
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

  // Sondeo liviano del front (sin efectos): ¿Drive está configurado?
  // Lo usan el cartel de la tarjeta y el botón "Drive" del header del tablero.
  // rootLink = la carpeta raíz de creativos, para entrar a ver todo.
  if (body.probe) {
    const ready = driveReady();
    const rootId = process.env.DRIVE_CREATIVOS_FOLDER_ID || null;
    const out = {
      configured: ready,
      rootLink: ready && rootId ? `https://drive.google.com/drive/folders/${rootId}` : null,
    };
    // Si el probe viene con un producto, aseguramos su carpeta y devolvemos el
    // link directo — así el detalle ofrece "carpeta de Drive" aunque la tarjeta
    // todavía no tenga videos subidos a Drive.
    if (ready && rootId && body.productoNombre) {
      try {
        const token = await getAccessToken();
        const prodFolder = await driveEnsureFolder(token, rootId, clean(body.productoNombre, 'Producto'));
        out.prodLink = `https://drive.google.com/drive/folders/${prodFolder}`;
      } catch { /* devolvemos al menos el root */ }
    }
    // AUTO-TEST de CORS: abrimos una sesión efímera atada al Origin del
    // navegador y le preguntamos a Google (preflight OPTIONS) si aceptaría el
    // PUT desde esa web. Si no, el front lo muestra con el detalle exacto —
    // diagnóstico sin depender de la consola del usuario.
    if (ready && rootId) {
      const origin = req.headers.origin || '';
      try {
        const token = await getAccessToken();
        const init = await fetch(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            ...(origin ? { Origin: origin } : {}),
          },
          body: JSON.stringify({ name: 'selftest.tmp', parents: [rootId] }),
        });
        const uri = init.headers.get('location');
        if (!init.ok || !uri) {
          const t = await init.text().catch(() => '');
          out.cors = { ok: false, fase: 'init', status: init.status, detail: t.slice(0, 160) };
        } else {
          const pre = await fetch(uri, {
            method: 'OPTIONS',
            headers: {
              ...(origin ? { Origin: origin } : {}),
              'Access-Control-Request-Method': 'PUT',
              'Access-Control-Request-Headers': 'content-type',
            },
          });
          const allow = pre.headers.get('access-control-allow-origin') || '';
          out.cors = {
            ok: !!allow && (allow === '*' || allow === origin),
            status: pre.status,
            allowOrigin: allow || null,
            origin: origin || null,
          };
        }
      } catch (e) {
        out.cors = { ok: false, fase: 'exception', detail: String(e?.message || e).slice(0, 160) };
      }
    }
    return respondJSON(res, 200, out);
  }

  const { productoNombre, persona, filename, mimeType, size } = body;
  if (!filename) return respondJSON(res, 400, { error: 'Falta el nombre del archivo.' });

  // Drive no configurado → el browser guarda en AdsLab (Supabase). No es error.
  if (!driveReady()) {
    return respondJSON(res, 200, { configured: false, reason: 'drive-no-configurado' });
  }

  try {
    const token = await getAccessToken();

    // Raíz: si hay carpeta dedicada de creativos, va directo ahí. Si caemos a la
    // de transcripciones, metemos todo bajo "Creativos" para no mezclar con actas.
    let rootId = process.env.DRIVE_CREATIVOS_FOLDER_ID;
    if (!rootId) rootId = await driveEnsureFolder(token, process.env.DRIVE_TRANSCRIPTS_FOLDER_ID, 'Creativos');

    // Estructura: <raíz>/<Producto>/<Persona> - <fecha>/
    // Cada producto su carpeta; adentro, una carpeta por persona+día de subida.
    const prodFolder = await driveEnsureFolder(token, rootId, clean(productoNombre, 'Producto'));
    const subFolder = await driveEnsureFolder(token, prodFolder, `${clean(persona, 'Equipo')} - ${hoyAR()}`);

    const finalName = finalFileName(filename);
    const contentType = mimeType || 'video/mp4';

    // Abrir la resumable session. Google devuelve la session URI en Location.
    // CLAVE: pasamos el Origin del navegador — Google "ata" la sesión a ese
    // origin y recién entonces responde los headers CORS en el PUT del browser.
    // Sin esto, el PUT directo browser→Google es bloqueado por CORS y la subida
    // caía siempre al fallback de AdsLab (bug detectado en producción).
    const browserOrigin = req.headers.origin || '';
    const initResp = await fetch(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': contentType,
        ...(size ? { 'X-Upload-Content-Length': String(size) } : {}),
        ...(browserOrigin ? { Origin: browserOrigin } : {}),
      },
      body: JSON.stringify({ name: finalName, parents: [subFolder] }),
    });

    if (!initResp.ok) {
      const t = await initResp.text().catch(() => '');
      return respondJSON(res, 502, { error: `Drive no aceptó la subida (${initResp.status}): ${t.slice(0, 180)}` });
    }
    const sessionUri = initResp.headers.get('location');
    if (!sessionUri) {
      return respondJSON(res, 502, { error: 'Drive no devolvió la URL de subida.' });
    }

    const folderLink = `https://drive.google.com/drive/folders/${subFolder}`;
    return respondJSON(res, 200, { configured: true, sessionUri, finalName, folderId: subFolder, folderLink, contentType });
  } catch (err) {
    return respondJSON(res, 500, { error: `Error abriendo la subida a Drive: ${err.message}` });
  }
}
