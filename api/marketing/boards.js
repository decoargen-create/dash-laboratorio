// CRUD de boards (colecciones cross-producto del user).
//
// Endpoints:
//   GET    /api/marketing/boards                → lista mis boards (con count)
//   POST   /api/marketing/boards                → crear (body: {nombre, descripcion?, color?, icon?})
//   PATCH  /api/marketing/boards?id=X           → editar
//   DELETE /api/marketing/boards?id=X           → borrar (cascade items)
//   POST   /api/marketing/boards?id=X&items     → agregar items (body: {items:[{productoId, competidorId, adId, notas?}]})
//   DELETE /api/marketing/boards?id=X&adId=Y    → quitar item
//   GET    /api/marketing/boards?id=X&items     → items de un board (con ads JOINeados)
//
// Auth: requireAuth (token Bearer).

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

function getServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const maxDuration = 30;

export default async function handler(req, res) {
  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado' });

  const supabase = getServerClient();
  if (!supabase) return respondJSON(res, 500, { error: 'Supabase server no configurado' });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const boardId = url.searchParams.get('id');
  const itemsFlag = url.searchParams.has('items');
  const removeAdId = url.searchParams.get('adId');

  // GET — listar boards o items.
  if (req.method === 'GET') {
    if (boardId && itemsFlag) {
      // Items con join a marketing_ads.
      const { data: items, error: itemsErr } = await supabase
        .from('marketing_board_items')
        .select('*')
        .eq('board_id', boardId)
        .eq('user_id', userId)
        .order('added_at', { ascending: false });
      if (itemsErr) return respondJSON(res, 500, { error: itemsErr.message });
      // Hidratar el ad de cada item.
      const adKeys = items.map(it => `${it.producto_id}|${it.competidor_id}|${it.ad_id}`);
      const ads = [];
      if (items.length > 0) {
        const { data: adsData } = await supabase
          .from('marketing_ads')
          .select('*')
          .eq('user_id', userId)
          .in('ad_id', items.map(it => it.ad_id));
        // Manual filter — la consulta de arriba puede traer falsos positivos
        // si dos comps de mismo user comparten ad_id (raro pero).
        for (const it of items) {
          const match = (adsData || []).find(a =>
            a.producto_id === it.producto_id &&
            a.competidor_id === it.competidor_id &&
            a.ad_id === it.ad_id
          );
          ads.push({ ...it, ad: match || null });
        }
      }
      return respondJSON(res, 200, { items: ads });
    }
    // Lista de boards con conteo de items.
    const { data: boards, error } = await supabase
      .from('marketing_boards')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) return respondJSON(res, 500, { error: error.message });
    // Item count per board.
    const counts = {};
    if (boards.length > 0) {
      const { data: itemRows } = await supabase
        .from('marketing_board_items')
        .select('board_id')
        .eq('user_id', userId);
      for (const r of itemRows || []) counts[r.board_id] = (counts[r.board_id] || 0) + 1;
    }
    return respondJSON(res, 200, {
      boards: boards.map(b => ({ ...b, itemCount: counts[b.id] || 0 })),
    });
  }

  // POST — crear board o agregar items.
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (boardId && itemsFlag) {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return respondJSON(res, 400, { error: 'items array vacío' });
      const rows = items.map(it => ({
        board_id: boardId,
        user_id: userId,
        producto_id: String(it.productoId),
        competidor_id: String(it.competidorId),
        ad_id: String(it.adId),
        notas: it.notas || null,
      }));
      const { error } = await supabase
        .from('marketing_board_items')
        .upsert(rows, { onConflict: 'board_id,ad_id' });
      if (error) return respondJSON(res, 500, { error: error.message });
      // Touch updated_at del board.
      await supabase
        .from('marketing_boards')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', boardId).eq('user_id', userId);
      return respondJSON(res, 200, { added: rows.length });
    }
    // Crear board.
    if (!body.nombre?.trim()) return respondJSON(res, 400, { error: 'nombre requerido' });
    const { data, error } = await supabase
      .from('marketing_boards')
      .insert({
        user_id: userId,
        nombre: body.nombre.trim(),
        descripcion: body.descripcion?.trim() || null,
        color: body.color || 'amber',
        icon: body.icon || 'star',
      })
      .select()
      .single();
    if (error) return respondJSON(res, 500, { error: error.message });
    return respondJSON(res, 201, { board: data });
  }

  // PATCH — editar board.
  if (req.method === 'PATCH') {
    if (!boardId) return respondJSON(res, 400, { error: 'id requerido' });
    const body = await readBody(req);
    const patch = {};
    if (body.nombre) patch.nombre = body.nombre.trim();
    if (body.descripcion !== undefined) patch.descripcion = body.descripcion?.trim() || null;
    if (body.color) patch.color = body.color;
    if (body.icon) patch.icon = body.icon;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('marketing_boards')
      .update(patch)
      .eq('id', boardId).eq('user_id', userId)
      .select().single();
    if (error) return respondJSON(res, 500, { error: error.message });
    return respondJSON(res, 200, { board: data });
  }

  // DELETE — borrar board o item.
  if (req.method === 'DELETE') {
    if (!boardId) return respondJSON(res, 400, { error: 'id requerido' });
    if (removeAdId) {
      const { error } = await supabase
        .from('marketing_board_items')
        .delete()
        .eq('board_id', boardId)
        .eq('user_id', userId)
        .eq('ad_id', removeAdId);
      if (error) return respondJSON(res, 500, { error: error.message });
      return respondJSON(res, 200, { removed: true });
    }
    const { error } = await supabase
      .from('marketing_boards')
      .delete()
      .eq('id', boardId).eq('user_id', userId);
    if (error) return respondJSON(res, 500, { error: error.message });
    return respondJSON(res, 200, { deleted: true });
  }

  return respondJSON(res, 405, { error: 'Method not allowed' });
}
