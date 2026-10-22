// Backfill de miniaturas de creativos (marketing_creativos.thumb_path).
//
// Los creativos generados en el server se guardaban SIN miniatura y la
// galería bajaba el PNG original (~1,5 MB) por cada cuadradito: 100 imágenes
// = ~150 MB para ver la grilla (reportado 20/10: "tarda un montón"). Los
// nuevos ya salen con thumb (uploadCreativoToBucket); este endpoint completa
// los viejos de a tandas, disparado por la galería en segundo plano.
//
// POST { ids: string[] } (máx 12 por llamada) → { thumbs: { [id]: thumbPath } }

import { getUserIdFromAuth, getServiceClient, subirThumbCreativo } from './_supabase-server.js';

const MAX_POR_LLAMADA = 12;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado' });
  const sb = getServiceClient();
  if (!sb) return respondJSON(res, 501, { error: 'Supabase no configurado' });

  const body = await readBody(req);
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean).slice(0, MAX_POR_LLAMADA);
  if (!ids.length) return respondJSON(res, 200, { thumbs: {} });

  // Solo filas DEL usuario (o de su dueño si es miembro: la RLS no aplica al
  // service role, así que filtramos explícito por user_id del caller o dueño).
  const { data: filas, error } = await sb
    .from('marketing_creativos')
    .select('id, user_id, storage_path, thumb_path')
    .in('id', ids);
  if (error) return respondJSON(res, 500, { error: error.message });

  let duenio = null;
  try {
    const { data } = await sb.from('cuenta_miembros').select('owner_id').eq('member_id', userId).maybeSingle();
    duenio = data?.owner_id || null;
  } catch { duenio = null; }
  const propias = (filas || []).filter(f => f.user_id === userId || (duenio && f.user_id === duenio));

  const thumbs = {};
  await Promise.all(propias.map(async (f) => {
    if (f.thumb_path) { thumbs[f.id] = f.thumb_path; return; }
    if (!f.storage_path) return;
    try {
      const { data: blob, error: dlErr } = await sb.storage.from('creativos').download(f.storage_path);
      if (dlErr || !blob) return;
      const buf = Buffer.from(await blob.arrayBuffer());
      const tPath = await subirThumbCreativo(sb, f.storage_path, buf);
      if (!tPath) return;
      await sb.from('marketing_creativos').update({ thumb_path: tPath }).eq('id', f.id).eq('user_id', f.user_id);
      thumbs[f.id] = tPath;
    } catch (e) {
      console.warn('[creativos-thumbs]', f.id, e.message);
    }
  }));
  return respondJSON(res, 200, { thumbs });
}
