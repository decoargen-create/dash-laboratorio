// Busca videos por NOMBRE en TODO el Drive conectado (no solo la carpeta
// histórica). Es el plan B del buscador de winners: cuando un creativo viejo
// no aparece en el listado del archivo (carpeta gigante, otra carpeta, lo que
// sea), esto le pregunta directo a Google por el nombre — donde esté, lo trae.
//
// POST { q } → { ok, files: [{ id, name, link, folder, fecha, sizeMB }] }
//
// Drive tokeniza por palabras: "name contains 'francisco'" matchea
// "[c1][Francisco][13-4][...]". Cada token del query va como un AND.

import { getUserIdFromAuth, getUserRole } from '../marketing/_supabase-server.js';
import { getDriveContext } from './_drive-ctx.js';
import { driveList } from '../actas/_google.js';

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });
  const role = await getUserRole(userId);
  if (role === 'creator') return respondJSON(res, 403, { error: 'Solo el admin puede buscar en Drive.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  // Tokens alfanuméricos del query (los corchetes/llaves de la convención
  // [C5][Francisco][20-7] no le sirven a Drive — busca por palabras).
  const toks = String(body?.q || '').toLowerCase().split(/[^a-z0-9áéíóúüñ]+/i).filter(t => t.length >= 2).slice(0, 6);
  if (toks.length === 0) return respondJSON(res, 400, { error: 'Escribí algo para buscar (2+ letras).' });

  const ctx = await getDriveContext();
  if (!ctx || ctx.failed) return respondJSON(res, 200, { configured: false });

  try {
    const esc = (t) => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = [
      'trashed=false',
      "mimeType contains 'video/'",
      ...toks.map(t => `name contains '${esc(t)}'`),
    ].join(' and ');
    const data = await driveList(ctx.token, {
      q,
      fields: 'files(id,name,mimeType,size,webViewLink,modifiedTime,parents)',
      pageSize: '60',
      orderBy: 'modifiedTime desc',
    });
    if (data?.error) throw new Error(data.error.message || 'Drive rechazó la búsqueda');

    const files = (data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      folder: null, // resolver nombres de carpetas serían N llamadas más — no suma
      fecha: f.modifiedTime || null,
      sizeMB: f.size ? +(Number(f.size) / 1024 / 1024).toFixed(1) : null,
    }));
    return respondJSON(res, 200, { ok: true, configured: true, files });
  } catch (err) {
    return respondJSON(res, 502, { error: err?.message || 'No pude buscar en Drive.' });
  }
}
