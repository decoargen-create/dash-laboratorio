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
import { driveEnsureFolder } from '../actas/_google.js';
import { getDriveContext } from './_drive-ctx.js';

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

const TZ = 'America/Argentina/Buenos_Aires';

// Saca caracteres que rompen nombres de archivo/carpeta en Drive.
function clean(s, fallback = '') {
  const t = String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || fallback;
}

// Abreviatura del producto para el nombre de archivo: iniciales de las palabras
// significativas (saltea conectores). La carpeta ya lleva el nombre completo, así
// que acá va corto y reconocible. Un producto de una sola palabra usa sus 1as
// letras. Ej: "Cepillo Drenaje Linfatico" → "CDL"; "Colageno" → "Colage".
function abreviarProducto(nombre) {
  const stop = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'por', 'a', 'en', 'the']);
  const words = clean(nombre, '').split(' ').filter(w => w && !stop.has(w.toLowerCase()));
  if (words.length === 0) return 'PROD';
  if (words.length === 1) return words[0].slice(0, 8);
  return words.slice(0, 4).map(w => w[0].toUpperCase()).join('');
}

// Sello de subida en horario AR: 'YYYY-MM-DD HH.MM' (fecha + hora, así dos videos
// del mismo día no colisionan en el nombre).
function selloAR() {
  const now = new Date();
  const fecha = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const hora = now.toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${fecha} ${hora.replace(':', '.')}`;
}

// Nomenclatura del archivo: "<Persona> - <fecha subida> - <Producto abreviado>".
// Autoexplicativo aunque el video se baje fuera de su carpeta (dice quién lo
// hizo, cuándo lo subió y de qué producto es). Ej:
// "Fran - 2026-08-17 14.05 - CDL.mp4".
function finalFileName(filename, productoNombre, persona) {
  const ext = (String(filename).split('.').pop() || 'mp4').toLowerCase().slice(0, 5);
  const per = clean(persona, 'Equipo');
  const abrev = abreviarProducto(productoNombre);
  return `${per} - ${selloAR()} - ${abrev}.${ext}`;
}

// Fecha de hoy (horario AR) → 'YYYY-MM-DD', para nombrar la carpeta de la subida.
function hoyAR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

// Nombre ESTABLE de la carpeta de una tarjeta: <Persona> - sem <d>-<m>. Como
// depende de la semana (no del día de subida), todos los videos de la misma
// tarjeta caen en la MISMA carpeta, sin importar en qué día se suben.
function cardFolderName(persona, weekKey) {
  const p = clean(persona, 'Equipo');
  if (!weekKey || !/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) return `${p} - ${hoyAR()}`;
  const [, m, d] = weekKey.split('-');
  return `${p} - sem ${Number(d)}-${Number(m)}`;
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
    const ctx = await getDriveContext();
    const out = {
      configured: !!ctx,
      mode: ctx?.mode || null,
      email: ctx?.email || null,
      rootLink: ctx ? `https://drive.google.com/drive/folders/${ctx.rootId}` : null,
    };
    // Si el probe viene con un producto, aseguramos su carpeta y devolvemos el
    // link directo — así el detalle ofrece "carpeta de Drive" aunque la tarjeta
    // todavía no tenga videos subidos a Drive.
    if (ctx && body.productoNombre) {
      try {
        const prodFolder = await driveEnsureFolder(ctx.token, ctx.rootId, clean(body.productoNombre, 'Producto'));
        out.prodLink = `https://drive.google.com/drive/folders/${prodFolder}`;
        if (body.persona || body.weekKey) {
          const cardFolder = await driveEnsureFolder(ctx.token, prodFolder, cardFolderName(body.persona, body.weekKey));
          out.cardLink = `https://drive.google.com/drive/folders/${cardFolder}`;
        }
      } catch { /* devolvemos al menos el root */ }
    }
    return respondJSON(res, 200, out);
  }

  const { productoNombre, persona, weekKey, filename, mimeType, size } = body;
  if (!filename) return respondJSON(res, 400, { error: 'Falta el nombre del archivo.' });

  // ¿Hay forma de subir a Drive (OAuth del user o service account)?
  const ctx = await getDriveContext();
  if (!ctx) {
    return respondJSON(res, 200, { configured: false, reason: 'drive-no-conectado' });
  }

  try {
    const token = ctx.token;
    const rootId = ctx.rootId;

    // Estructura: <raíz>/<Producto>/<Persona> - sem d-m/
    const prodFolder = await driveEnsureFolder(token, rootId, clean(productoNombre, 'Producto'));
    // Carpeta ESTABLE por tarjeta (producto × persona × semana): todos los
    // videos de la tarjeta caen acá, aunque se suban en días distintos.
    const subFolder = await driveEnsureFolder(token, prodFolder, cardFolderName(persona, weekKey));

    const finalName = finalFileName(filename, productoNombre, persona);
    const contentType = mimeType || 'video/mp4';

    // Abrir la resumable session (con node:https crudo, no fetch: garantiza el
    // header Origin, que en el fetch de undici de Vercel se descartaba/rompía
    // y hacía fallar la apertura — la causa real de que todo cayera a AdsLab).
    //
    // El Origin ATA la sesión al navegador para que el PUT directo browser→Google
    // reciba headers CORS. Si por lo que sea la apertura CON Origin falla,
    // REINTENTAMOS SIN Origin: la sesión igual sirve para el relay server-side
    // (server→Google no tiene CORS), así que la subida a Drive nunca depende de
    // este detalle.
    // Abrimos la sesión con fetch simple, SIN el header Origin. La subida real
    // NO va directa del navegador (eso requería CORS y rompía todo): va por el
    // RELAY server-side (/api/produccion/drive-chunk), que es inmune a CORS. Por
    // eso devolvemos corsBound:false y el front sube siempre por el relay.
    const initResp = await fetch(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': contentType,
        ...(size ? { 'X-Upload-Content-Length': String(size) } : {}),
      },
      body: JSON.stringify({ name: finalName, parents: [subFolder] }),
    });

    if (!initResp.ok) {
      const t = await initResp.text().catch(() => '');
      return respondJSON(res, 502, { error: `Drive no aceptó la subida (${initResp.status}): ${t.slice(0, 180)}` });
    }
    const sessionUri = initResp.headers.get('location');
    if (!sessionUri) return respondJSON(res, 502, { error: 'Drive no devolvió la URL de subida.' });

    const folderLink = `https://drive.google.com/drive/folders/${subFolder}`;
    return respondJSON(res, 200, { configured: true, sessionUri, finalName, folderId: subFolder, folderLink, contentType, corsBound: false });
  } catch (err) {
    return respondJSON(res, 500, { error: `Error abriendo la subida a Drive: ${err.message}` });
  }
}
