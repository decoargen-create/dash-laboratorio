// Renombra la carpeta de UNA tarjeta en Drive para reflejar su estado: al
// publicar le agrega " — PUBLICADO" al final; al despublicar se lo saca. Así el
// orden del Drive espeja el tablero. Idempotente: recalcula desde el nombre base.
//
// POST { folderId, published }  → { ok, name, changed } | { configured:false }

import { getUserIdFromAuth } from '../marketing/_supabase-server.js';
import { getDriveContext } from './_drive-ctx.js';
import { nombrePublicado } from './_naming.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';

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
  const folderId = body.folderId;
  const published = !!body.published;
  if (!folderId) return respondJSON(res, 400, { error: 'Falta folderId.' });

  const ctx = await getDriveContext();
  if (!ctx) return respondJSON(res, 200, { configured: false });

  try {
    const token = ctx.token;
    // Nombre actual de la carpeta.
    const g = await fetch(`${DRIVE}/files/${folderId}?fields=name&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!g.ok) {
      const t = await g.text().catch(() => '');
      return respondJSON(res, 502, { error: `Drive get: ${g.status} ${t.slice(0, 140)}` });
    }
    const actual = (await g.json())?.name || '';
    const nuevo = nombrePublicado(actual, published);
    if (nuevo === actual) return respondJSON(res, 200, { ok: true, name: actual, changed: false });

    const p = await fetch(`${DRIVE}/files/${folderId}?supportsAllDrives=true&fields=id,name`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nuevo }),
    });
    if (!p.ok) {
      const t = await p.text().catch(() => '');
      return respondJSON(res, 502, { error: `Drive rename: ${p.status} ${t.slice(0, 140)}` });
    }
    return respondJSON(res, 200, { ok: true, name: nuevo, changed: true });
  } catch (e) {
    return respondJSON(res, 500, { error: `Error renombrando la carpeta: ${e.message}` });
  }
}
