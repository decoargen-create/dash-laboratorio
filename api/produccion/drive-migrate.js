// Producción — MUEVE un video que quedó en AdsLab (Supabase Storage) a Google
// Drive. Corre 100% server-side porque:
//   - El bucket 'creativos' es por-usuario (RLS): un admin NO puede leer el
//     archivo que subió un editor desde el navegador. El service role sí.
//   - Sube a Drive con el OAuth del dueño (getDriveContext), igual que una subida
//     normal, a la MISMA carpeta de la tarjeta.
//
// Seguridad de datos: SOLO borra la copia de AdsLab DESPUÉS de confirmar que el
// archivo quedó en Drive (id devuelto por Google). Si algo falla antes, no toca
// nada — el video sigue intacto en AdsLab.
//
// POST { cardId, storagePath } → { ok, archivo } | { error }

import { getUserIdFromAuth, getServiceClient } from '../marketing/_supabase-server.js';
import { getDriveContext } from './_drive-ctx.js';
import { driveEnsureFolder } from '../actas/_google.js';
import { clean, cardFolderName } from './_naming.js';

export const config = { maxDuration: 300 };

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const BUCKET = 'creativos';

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { cardId, storagePath } = body;
  if (!cardId || !storagePath) return respondJSON(res, 400, { error: 'Faltan cardId o storagePath.' });

  const svc = getServiceClient();
  if (!svc) return respondJSON(res, 500, { error: 'Server sin acceso a la base.' });

  // 1) Tarjeta (autoridad = la base, no el cliente). Chequeo de acceso.
  const { data: card, error: cardErr } = await svc
    .from('produccion_asignaciones')
    .select('id, owner_id, creator_id, producto_nombre, persona, week_key, archivos')
    .eq('id', cardId)
    .maybeSingle();
  if (cardErr || !card) return respondJSON(res, 404, { error: 'No encontré la tarjeta.' });
  if (userId !== card.owner_id && userId !== card.creator_id) {
    return respondJSON(res, 403, { error: 'No tenés acceso a esta tarjeta.' });
  }

  const archivos = Array.isArray(card.archivos) ? card.archivos : [];
  // El storagePath tiene que pertenecer a un archivo de ESTA tarjeta (no aceptamos
  // un path arbitrario) y tiene que ser de AdsLab.
  const archivo = archivos.find(f => f && f.storagePath === storagePath && f.destino !== 'drive');
  if (!archivo) return respondJSON(res, 400, { error: 'Ese archivo no es un video de AdsLab de esta tarjeta.' });

  // 2) Contexto de Drive (OAuth del dueño). Si falla transitoriamente, NO tocamos
  // nada — el video sigue en AdsLab y se reintenta luego.
  const ctx = await getDriveContext();
  if (!ctx || ctx.failed) {
    return respondJSON(res, 503, { error: ctx?.failed ? 'Drive está conectado pero Google no respondió ahora. Reintentá.' : 'Drive no está conectado.' });
  }
  const token = ctx.token;

  try {
    // 3) Carpeta destino: reusamos la de la tarjeta si ya existe (otros videos ya
    // en Drive), sino armamos la ruta <raíz>/<Producto>/<Persona>/<tarjeta>.
    let subFolder = archivos.find(f => f && f.folderId)?.folderId || null;
    if (!subFolder) {
      const prodFolder = await driveEnsureFolder(token, ctx.rootId, clean(card.producto_nombre, 'Producto'));
      const personaFolder = await driveEnsureFolder(token, prodFolder, clean(card.persona, 'Equipo'));
      // cardId al final: cada TARJETA tiene su propia carpeta (fix de #438). Sin
      // pasarlo, el video migrado caería en la carpeta vieja compartida.
      subFolder = await driveEnsureFolder(token, personaFolder, cardFolderName(card.producto_nombre, card.persona, card.week_key, card.id));
    }

    // 4) Bajamos los bytes del bucket (service role → sin RLS).
    const dl = await svc.storage.from(BUCKET).download(storagePath);
    if (dl.error || !dl.data) return respondJSON(res, 404, { error: `No pude leer el video de AdsLab: ${dl.error?.message || 'sin datos'}` });
    const buf = Buffer.from(await dl.data.arrayBuffer());
    if (buf.length === 0) return respondJSON(res, 422, { error: 'El video de AdsLab está vacío (0 bytes) — no lo muevo.' });

    const finalName = String(archivo.name || 'video.mp4').replace(/[\r\n\t]+/g, ' ').trim() || 'video.mp4';
    const ext = (finalName.split('.').pop() || 'mp4').toLowerCase();
    const contentType = /^(mp4|m4v)$/.test(ext) ? 'video/mp4' : (/^mov|qt$/.test(ext) ? 'video/quicktime' : (/^webm$/.test(ext) ? 'video/webm' : 'video/mp4'));

    // 5) Abrimos sesión resumable y subimos el archivo entero (server→Google, sin
    // límite de body de Vercel; sin CORS).
    const initResp = await fetch(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,size`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': contentType,
        'X-Upload-Content-Length': String(buf.length),
      },
      body: JSON.stringify({ name: finalName, parents: [subFolder] }),
    });
    if (!initResp.ok) {
      const t = await initResp.text().catch(() => '');
      return respondJSON(res, 502, { error: `Drive no aceptó la subida (${initResp.status}): ${t.slice(0, 180)}` });
    }
    const sessionUri = initResp.headers.get('location');
    if (!sessionUri) return respondJSON(res, 502, { error: 'Drive no devolvió la URL de subida.' });

    const put = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': String(buf.length) },
      body: buf,
    });
    if (!put.ok) {
      const t = await put.text().catch(() => '');
      return respondJSON(res, 502, { error: `Falló la subida a Drive (${put.status}): ${t.slice(0, 180)}` });
    }
    const meta = await put.json().catch(() => ({}));
    if (!meta.id) return respondJSON(res, 502, { error: 'Drive no confirmó el archivo (sin id).' });

    // 6) VERIFICACIÓN antes de borrar: el tamaño en Drive tiene que coincidir con
    // el que subimos. Solo si coincide, damos por buena la copia.
    const driveSize = Number(meta.size || 0);
    if (driveSize && driveSize !== buf.length) {
      return respondJSON(res, 502, { error: `El archivo en Drive quedó incompleto (${driveSize}/${buf.length} bytes) — NO borro el de AdsLab.` });
    }

    // 7) Reemplazamos el archivo en la tarjeta (adslab → drive), preservando ts y
    // la corrección si tenía. Escribimos con read-modify-write sobre la fila.
    const nuevo = {
      name: finalName,
      driveId: meta.id,
      link: meta.webViewLink || `https://drive.google.com/file/d/${meta.id}/view`,
      folderLink: `https://drive.google.com/drive/folders/${subFolder}`,
      folderId: subFolder,
      destino: 'drive',
      sizeMB: archivo.sizeMB != null ? archivo.sizeMB : +(buf.length / 1024 / 1024).toFixed(1),
      ts: archivo.ts,
      ...(archivo.correccion ? { correccion: archivo.correccion } : {}),
    };
    // Releemos por si cambió mientras subíamos (subida puede tardar).
    const { data: fresh } = await svc.from('produccion_asignaciones').select('archivos').eq('id', cardId).maybeSingle();
    const base = Array.isArray(fresh?.archivos) ? fresh.archivos : archivos;
    // Identificamos el archivo por storagePath (clave ÚNICA y ya validada), NO
    // por ts: los videos viejos de AdsLab se guardaron con ts:0 (rec.ts||0), así
    // que matchear por ts colapsaría TODOS los ts:0 en uno → pérdida de datos.
    const nuevos = base.map(f => (f && f.storagePath === storagePath) ? nuevo : f);
    const { error: upErr } = await svc.from('produccion_asignaciones')
      .update({ archivos: nuevos, updated_at: new Date().toISOString() })
      .eq('id', cardId);
    if (upErr) {
      // El video YA está en Drive; solo falló actualizar el registro. NO borramos
      // AdsLab (así no queda huérfano) y avisamos para reintentar.
      return respondJSON(res, 500, { error: `El video subió a Drive pero no pude actualizar la tarjeta: ${upErr.message}. Reintentá.` });
    }

    // 8) Recién ahora borramos la copia de AdsLab (ya confirmada en Drive y con la
    // tarjeta apuntando a Drive). Best-effort: si falla, no rompe (queda huérfano).
    try { await svc.storage.from(BUCKET).remove([storagePath]); } catch { /* best-effort */ }

    return respondJSON(res, 200, { ok: true, archivo: nuevo });
  } catch (err) {
    return respondJSON(res, 500, { error: `Error moviendo a Drive: ${err.message}` });
  }
}
