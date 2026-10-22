// Guarda la copia permanente de imágenes de ads de la competencia cuya URL
// del CDN de Meta todavía funciona (ver guardarImagenAd). Lo dispara el
// cliente en segundo plano cuando logra ver un ad que aún no tiene copia.
//
// POST { ads: [{ id, url }] } (máx 20) → { guardados: n }

import { getUserIdFromAuth, getServiceClient, guardarImagenAd } from './_supabase-server.js';

function respondJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

// Solo URLs de los CDN de Meta: el endpoint no baja cualquier cosa.
const esCdnMeta = (u) => {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.endsWith('.fbcdn.net') || h.endsWith('.cdninstagram.com') || h === 'fbcdn.net';
  } catch { return false; }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado' });
  const sb = getServiceClient();
  if (!sb) return respondJSON(res, 501, { error: 'Supabase no configurado' });

  // Un miembro guarda en la carpeta de SU dueño (es donde la buscan todos).
  let carpeta = userId;
  try {
    const { data } = await sb.from('cuenta_miembros').select('owner_id').eq('member_id', userId).maybeSingle();
    if (data?.owner_id) carpeta = data.owner_id;
  } catch { /* cuenta normal */ }

  const body = await readBody(req);
  const ads = (Array.isArray(body.ads) ? body.ads : [])
    .filter(a => a?.id && a?.url && esCdnMeta(a.url))
    .slice(0, 20);
  let guardados = 0;
  await Promise.all(ads.map(async (a) => {
    const u = await guardarImagenAd(sb, carpeta, String(a.id), String(a.url));
    if (u) guardados++;
  }));
  return respondJSON(res, 200, { guardados });
}
