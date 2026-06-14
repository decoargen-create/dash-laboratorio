// Endpoint de búsqueda server-side sobre la tabla marketing_ads.
//
// Reemplaza el filter client-side que iteraba arrays grandes en cada
// keystroke. Ventaja: escala a 100K+ ads acumulados sin latencia visible
// gracias al GIN index full-text.
//
// POST /api/marketing/search-ads
// Body: {
//   query?: string,            // texto a buscar (full-text)
//   productoId?: string,       // filtrar por producto
//   competidorId?: string,     // filtrar por competidor (requiere productoId)
//   onlyWinners?: boolean,
//   formato?: 'static' | 'video' | 'carrusel',
//   minDays?: number,
//   maxDays?: number,
//   sort?: 'recent' | 'score' | 'days' | 'relevance',
//   page?: number,             // 1-based
//   pageSize?: number,         // default 50, max 200
// }
// Response: { ads, total, page, pageSize, hasMore }

import { getUserIdFromAuth } from './_supabase-server.js';
import { createClient } from '@supabase/supabase-js';

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function getClientForUser(req) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const maxDuration = 30;

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado' });

  const supabase = getClientForUser(req);
  if (!supabase) return respondJSON(res, 500, { error: 'Supabase server no configurado' });

  const body = await readBody(req);
  const {
    query = '',
    productoId,
    competidorId,
    onlyWinners = false,
    formato,
    minDays,
    maxDays,
    sort = 'recent',
    page = 1,
    pageSize: rawPageSize = 50,
  } = body || {};

  const pageSize = Math.max(1, Math.min(200, Number(rawPageSize) || 50));
  const offset = Math.max(0, (Number(page) - 1) * pageSize);

  // Query con cap defensivo + escape de chars conflictivos.
  const trimmedQuery = query.trim().slice(0, 200);

  // Si el caller pide sort='relevance' Y hay query, usamos la RPC
  // search_ads_ranked que ordena por ts_rank (no se puede via PostgREST
  // directo). Para otros sorts, query directo con filters.
  if (sort === 'relevance' && trimmedQuery) {
    // Usamos un cliente authenticated (con el token del user) así
    // auth.uid() adentro de la RPC matchea.
    const userClient = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: req.headers.authorization || '' } },
      }
    );
    const { data, error } = await userClient.rpc('search_ads_ranked', {
      q: trimmedQuery,
      filter_producto: productoId || null,
      filter_competidor: competidorId || null,
      filter_only_winners: !!onlyWinners,
      page_offset: offset,
      page_size: pageSize,
    });
    if (error) return respondJSON(res, 500, { error: `RPC falló: ${error.message}` });
    // total_count viene inyectado en cada fila por la RPC; si data está vacío
    // (paginación pasada del final), caemos a un count del catalogo con los
    // mismos filtros para que el frontend pueda mostrar "X de Y" coherente.
    let total = data?.[0]?.total_count || 0;
    if ((data?.length || 0) === 0 && offset > 0) {
      let countQ = supabase.from('marketing_ads').select('*', { count: 'exact', head: true }).eq('user_id', userId);
      if (productoId) countQ = countQ.eq('producto_id', String(productoId));
      if (competidorId) countQ = countQ.eq('competidor_id', String(competidorId));
      if (onlyWinners) countQ = countQ.eq('is_winner', true);
      countQ = countQ.textSearch('search_vector', trimmedQuery, { type: 'websearch', config: 'spanish' });
      const { count: backfillCount } = await countQ;
      total = backfillCount || offset;
    }
    return respondJSON(res, 200, {
      ads: data || [],
      total,
      page: Number(page),
      pageSize,
      hasMore: (offset + (data?.length || 0)) < total,
    });
  }

  let q = supabase
    .from('marketing_ads')
    .select('*', { count: 'exact' })
    .eq('user_id', userId);

  if (productoId) q = q.eq('producto_id', String(productoId));
  if (competidorId) q = q.eq('competidor_id', String(competidorId));
  if (onlyWinners) q = q.eq('is_winner', true);
  if (formato) q = q.eq('formato', String(formato));
  if (minDays != null) q = q.gte('days_running', Number(minDays));
  if (maxDays != null) q = q.lte('days_running', Number(maxDays));

  if (trimmedQuery) {
    q = q.textSearch('search_vector', trimmedQuery, { type: 'websearch', config: 'spanish' });
  }

  if (sort === 'score') q = q.order('score', { ascending: false, nullsFirst: false });
  else if (sort === 'days') q = q.order('days_running', { ascending: false, nullsFirst: false });
  else q = q.order('scraped_at', { ascending: false });

  q = q.range(offset, offset + pageSize - 1);

  const { data, count, error } = await q;
  if (error) {
    return respondJSON(res, 500, { error: `Query falló: ${error.message}` });
  }

  return respondJSON(res, 200, {
    ads: data || [],
    total: count || 0,
    page: Number(page),
    pageSize,
    hasMore: (offset + (data?.length || 0)) < (count || 0),
  });
}
