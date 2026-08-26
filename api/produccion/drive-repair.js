// Producción — reparación de carpetas: deja UNA carpeta por tarjeta en Drive.
//
// Por qué existe: hasta el fix de nomenclatura, la carpeta de una tarjeta se
// llamaba "<Producto> [<Persona>][<d-m>]" sin nada de la tarjeta. Dos tarjetas
// del mismo producto + persona + semana resolvían al MISMO nombre y Drive las
// fusionaba (9 + 9 = 18 videos en una sola carpeta). El fix arregla las
// carpetas nuevas; esto desarma las que ya quedaron mezcladas.
//
// Cómo sabe qué archivo es de qué tarjeta: cada tarjeta guarda el driveId de
// CADA video que subió (a.archivos[].driveId). O sea que no adivinamos nada —
// movemos exactamente los archivos que esa tarjeta registró como suyos.
//
// POST { cards: [{ id, productoNombre, persona, weekKey, published?, driveIds: [] }], dryRun? }
//   dryRun: true  → no toca nada; informa qué se movería (para el confirm).
//   dryRun: false → crea la carpeta de cada tarjeta y mueve sus archivos ahí.
//
// Respuesta: { configured, cards: [{ id, folderId, folderLink, mover, yaOk,
//                                    movidos, errores: [] }], totales }
//
// Es idempotente: correrlo dos veces deja todo igual (la segunda vez todos los
// archivos ya están en su carpeta y cuentan como "yaOk").
//
// Este archivo es solo la cáscara (auth + adaptador de Drive). La lógica de qué
// se mueve y qué se deja quieto vive en _repair-core.js, que los tests corren
// con un Drive falso.

import { getUserIdFromAuth } from '../marketing/_supabase-server.js';
import { driveEnsureFolder, driveList } from '../actas/_google.js';
import { getDriveContext } from './_drive-ctx.js';
import { repararTarjetas } from './_repair-core.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';

// Tope por request: mover un archivo son 2 llamadas a Drive (get + patch) y la
// función serverless tiene tiempo limitado (maxDuration en vercel.json). El
// front manda las tarjetas de a tandas y va mostrando el progreso.
const MAX_CARDS = 12;

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// Adaptador de Drive real que consume _repair-core.
function driveAdapter(token, rootId) {
  return {
    rootId,
    ensureFolder: (parentId, name) => driveEnsureFolder(token, parentId, name),

    // Busca (sin crear) una subcarpeta por nombre. Devuelve su id o null.
    findFolder: async (parentId, name) => {
      const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${String(name).replace(/'/g, "\\'")}' and trashed=false`;
      const found = await driveList(token, { q, fields: 'files(id,name)', pageSize: 1 });
      return found.files?.[0]?.id || null;
    },

    fileInfo: async (fileId) => {
      const r = await fetch(`${DRIVE}/files/${fileId}?fields=id,name,parents,trashed&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`get ${r.status}`);
      return r.json();
    },

    moveFile: async (fileId, fromParents, toParent) => {
      const params = new URLSearchParams({
        supportsAllDrives: 'true',
        addParents: toParent,
        fields: 'id,parents',
      });
      // removeParents solo con los padres reales que tenía: pasarle uno que no
      // es suyo hace fallar el patch entero.
      const quitar = (fromParents || []).filter(p => p !== toParent);
      if (quitar.length) params.set('removeParents', quitar.join(','));
      const r = await fetch(`${DRIVE}/files/${fileId}?${params}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`move ${r.status}: ${t.slice(0, 120)}`);
      }
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const dryRun = body.dryRun !== false; // por defecto NO toca nada
  const cards = Array.isArray(body.cards) ? body.cards.slice(0, MAX_CARDS) : [];
  if (cards.length === 0) return respondJSON(res, 400, { error: 'Falta la lista de tarjetas.' });

  const ctx = await getDriveContext();
  if (!ctx) return respondJSON(res, 200, { configured: false, reason: 'drive-no-conectado' });

  try {
    const { cards: detalle, totales } = await repararTarjetas(cards, {
      drive: driveAdapter(ctx.token, ctx.rootId),
      dryRun,
    });
    return respondJSON(res, 200, { configured: true, dryRun, cards: detalle, totales });
  } catch (e) {
    return respondJSON(res, 500, { error: `Error reparando carpetas: ${e.message}` });
  }
}
