// Manda UN archivo de Drive a la papelera. Lo usa el flujo "Reemplazar" de
// Producción: al subir el video corregido, el viejo se papelera para que la
// carpeta no acumule versiones con el mismo nombre (que era lo que hacía que
// la siguiente subida chocara con el dedupe de drive-session: "ya estaba" /
// "versión nueva"). Papelera, NO delete definitivo: Drive la retiene 30 días,
// así que un reemplazo equivocado se recupera a mano.
//
// POST { fileId } → { ok } | { configured:false }

import { getUserIdFromAuth } from '../marketing/_supabase-server.js';
import { getDriveContext } from './_drive-ctx.js';

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
  const fileId = body?.fileId;
  if (!fileId || typeof fileId !== 'string') return respondJSON(res, 400, { error: 'Falta fileId.' });

  const ctx = await getDriveContext();
  if (!ctx || ctx.failed) return respondJSON(res, 200, { configured: false });

  try {
    const g = await fetch(`${DRIVE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (!g.ok) {
      const t = await g.text().catch(() => '');
      return respondJSON(res, 200, { ok: false, error: `Drive HTTP ${g.status}${t ? `: ${t.slice(0, 150)}` : ''}` });
    }
    return respondJSON(res, 200, { ok: true });
  } catch (err) {
    return respondJSON(res, 200, { ok: false, error: err?.message || 'error' });
  }
}
