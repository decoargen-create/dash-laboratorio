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
import { clean, cardFolderName } from './_naming.js';

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

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
    const usable = !!(ctx && !ctx.failed);
    const out = {
      configured: usable,
      ...(ctx?.failed ? { transient: true, reason: 'drive-oauth-transitorio' } : {}),
      mode: usable ? ctx.mode : null,
      email: (ctx && ctx.email) || null,
      rootLink: usable ? `https://drive.google.com/drive/folders/${ctx.rootId}` : null,
    };
    // Si el probe viene con un producto, aseguramos su carpeta y devolvemos el
    // link directo — así el detalle ofrece "carpeta de Drive" aunque la tarjeta
    // todavía no tenga videos subidos a Drive.
    if (usable && body.productoNombre) {
      try {
        // Si la tarjeta ya tiene carpeta (folderId), linkeamos directo a esa.
        if (body.folderId) {
          out.cardLink = `https://drive.google.com/drive/folders/${body.folderId}`;
        }
        const prodFolder = await driveEnsureFolder(ctx.token, ctx.rootId, clean(body.productoNombre, 'Producto'));
        out.prodLink = `https://drive.google.com/drive/folders/${prodFolder}`;
        if (body.persona) {
          const personaFolder = await driveEnsureFolder(ctx.token, prodFolder, clean(body.persona, 'Equipo'));
          out.personaLink = `https://drive.google.com/drive/folders/${personaFolder}`;
          if (!out.cardLink && body.cardId) {
            const cardFolder = await driveEnsureFolder(ctx.token, personaFolder, cardFolderName(body.productoNombre, body.persona, body.weekKey));
            out.cardLink = `https://drive.google.com/drive/folders/${cardFolder}`;
          }
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
  if (ctx.failed) {
    // Drive está conectado pero el OAuth falló transitoriamente (ya se reintentó
    // 3× del lado del server). NO usamos la service account (403 sin quota, que
    // mandaba todo a AdsLab). Que el front reintente / lo diga claro.
    return respondJSON(res, 200, { configured: false, reason: 'drive-oauth-transitorio', error: 'Drive está conectado pero Google no respondió en este momento. Reintentá en unos segundos.' });
  }

  try {
    const token = ctx.token;
    const rootId = ctx.rootId;

    // Carpeta de la tarjeta. Si ya la tenemos (subidas previas), la reusamos por
    // ID — así no depende del nombre, que pudo renombrarse a "… — PUBLICADO".
    // Si no, armamos la ruta: <raíz>/<Producto>/<Persona>/<sem d-m · id>/.
    let subFolder;
    if (body.folderId) {
      subFolder = body.folderId;
    } else {
      const prodFolder = await driveEnsureFolder(token, rootId, clean(productoNombre, 'Producto'));
      const personaFolder = await driveEnsureFolder(token, prodFolder, clean(persona, 'Equipo'));
      subFolder = await driveEnsureFolder(token, personaFolder, cardFolderName(productoNombre, persona, weekKey));
    }

    // Respetamos el nombre TAL CUAL se sube (el equipo ya usa su convención, ej:
    // "[C1][Ponzio][15-08][…].mp4"). Solo sacamos saltos de línea/tabs por las
    // dudas; Drive acepta corchetes, espacios y acentos sin problema.
    const finalName = String(filename || '').replace(/[\r\n\t]+/g, ' ').trim() || 'video.mp4';
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
