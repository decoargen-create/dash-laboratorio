// Landings — checklist de cambios por landing (una por producto).
//
// Mirror simple de produccionStore: cache local (localStorage) + sync a la nube
// (tabla `landings`, RLS por owner_id) + realtime. Los ítems del checklist viven
// como jsonb DENTRO de la fila de la landing (como los archivos en Producción);
// las imágenes de referencia van al bucket público `landing-refs` y guardamos su
// URL, así la fila queda liviana.
//
// v1 = lado admin (el dueño crea/gestiona el checklist). El login del editor para
// tildar queda para fase 2 (creator_id ya existe en la fila para eso).

import { supabase, getCurrentUser } from './supabase.js';
import { comprimirImagen } from './productoImagen.js';

const TABLE = 'landings';
const BUCKET = 'landing-refs';
const LS_KEY = 'adslab-landings-v1';

let _cache = readLocal();
let _user = null;
let _channel = null;
const _subs = new Set();

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function writeLocal(arr) {
  _cache = arr;
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {}
  notify();
}
function notify() { _subs.forEach(fn => { try { fn(); } catch {} }); }

export function subscribeLandings(fn) { _subs.add(fn); return () => _subs.delete(fn); }
export function listLandings() { return _cache; }
export function getLanding(id) { return _cache.find(l => l.id === id) || null; }
export function uid(p = 'l') { return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

// ── mapping nube ↔ local ──────────────────────────────────────────────
function rowToLocal(r) {
  return {
    id: r.id, ownerId: r.owner_id || null, creatorId: r.creator_id || null,
    productoId: r.producto_id || null, productoNombre: r.producto_nombre || '',
    url: r.url || '', estado: r.estado || 'revision', editor: r.editor || '',
    items: Array.isArray(r.items) ? r.items : [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function localToRow(l) {
  return {
    id: l.id, owner_id: l.ownerId || _user || null, creator_id: l.creatorId || null,
    producto_id: l.productoId || null, producto_nombre: l.productoNombre || '',
    url: l.url || '', estado: l.estado || 'revision', editor: l.editor || '',
    items: l.items || [], updated_at: new Date().toISOString(),
  };
}

async function push(l) {
  if (!supabase || !_user) return;
  try {
    const { error } = await supabase.from(TABLE).upsert(localToRow(l), { onConflict: 'id' });
    if (error) throw error;
  } catch (e) {
    console.warn('[landings] push falló:', e.message);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('viora:landings-sync-error'));
  }
}
async function removeRow(id) {
  if (!supabase || !_user) return;
  try { await supabase.from(TABLE).delete().eq('id', id); }
  catch (e) { console.warn('[landings] delete falló:', e.message); }
}

// ── init / sync ───────────────────────────────────────────────────────
let _initPromise = null;
export function initLandings() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!supabase) { notify(); return; }
    try { const user = await getCurrentUser(); _user = user?.id || null; }
    catch { _user = null; }
    await hydrate();
    startRealtime();
  })();
  return _initPromise;
}
async function hydrate() {
  if (!supabase || !_user) return;
  try {
    const { data, error } = await supabase.from(TABLE).select('*');
    if (error) throw error;
    writeLocal((data || []).map(rowToLocal).sort(byUpdated));
  } catch (e) { console.warn('[landings] hydrate falló:', e.message); }
}
function byUpdated(a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); }

let _rtTimer = null;
function startRealtime() {
  if (!supabase || _channel || typeof window === 'undefined') return;
  try {
    _channel = supabase.channel(`landings-rt-${_user || 'anon'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => {
        clearTimeout(_rtTimer); _rtTimer = setTimeout(() => { hydrate(); }, 400);
      })
      .subscribe();
  } catch {}
}

// ── landings CRUD ─────────────────────────────────────────────────────
export function createLanding({ productoId, productoNombre, url = '', editor = '' }) {
  const now = new Date().toISOString();
  const l = {
    id: uid('lnd'), ownerId: _user, creatorId: null,
    productoId: productoId || null, productoNombre: productoNombre || '',
    url: url || '', estado: 'revision', editor: editor || '', items: [],
    createdAt: now, updatedAt: now,
  };
  writeLocal([l, ..._cache]);
  push(l);
  return l;
}
export function updateLanding(id, patch) {
  let updated = null;
  writeLocal(_cache.map(l => {
    if (l.id !== id) return l;
    updated = { ...l, ...patch, updatedAt: new Date().toISOString() };
    return updated;
  }));
  if (updated) push(updated);
}
export function deleteLanding(id) {
  writeLocal(_cache.filter(l => l.id !== id));
  removeRow(id);
}

// ── ítems del checklist ───────────────────────────────────────────────
function mutateItems(landingId, fn) {
  const l = getLanding(landingId); if (!l) return;
  const items = fn((l.items || []).map(i => ({ ...i })));
  updateLanding(landingId, { items });
}
export function addItem(landingId, { texto, prioridad = '' }) {
  mutateItems(landingId, items => {
    const orden = items.length ? Math.max(...items.map(i => i.orden || 0)) + 1 : 0;
    items.push({ id: uid('it'), texto: texto || '', prioridad: prioridad || '', hecho: false, orden, imagenes: [], links: [], ts: new Date().toISOString() });
    return items;
  });
}
export function updateItem(landingId, itemId, patch) {
  mutateItems(landingId, items => items.map(i => i.id === itemId ? { ...i, ...patch } : i));
}
export function removeItem(landingId, itemId) {
  mutateItems(landingId, items => items.filter(i => i.id !== itemId));
}
export function toggleItem(landingId, itemId) {
  mutateItems(landingId, items => items.map(i => i.id === itemId ? { ...i, hecho: !i.hecho, hechoAt: !i.hecho ? new Date().toISOString() : null } : i));
}
// Reordena SOLO los pendientes según orderedIds; los hechos conservan su orden.
export function reorderItems(landingId, orderedIds) {
  mutateItems(landingId, items => {
    const pos = new Map(orderedIds.map((id, i) => [id, i]));
    return items.map(i => pos.has(i.id) ? { ...i, orden: pos.get(i.id) } : i);
  });
}
export function addItemLink(landingId, itemId, url, label = '') {
  const clean = (url || '').trim(); if (!clean) return;
  mutateItems(landingId, items => items.map(i => i.id === itemId ? { ...i, links: [...(i.links || []), { url: clean, label: (label || clean).trim() }] } : i));
}
export function removeItemLink(landingId, itemId, idx) {
  mutateItems(landingId, items => items.map(i => i.id === itemId ? { ...i, links: (i.links || []).filter((_, k) => k !== idx) } : i));
}

// ── imágenes de referencia (bucket landing-refs) ──────────────────────
function dataUrlToBlob(dataUrl) {
  const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!m) throw new Error('dataUrl inválido');
  const bytes = atob(m[2]); const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: m[1] });
}
export async function uploadItemImage(landingId, itemId, file) {
  if (!supabase || !_user) throw new Error('Necesitás estar logueado para subir imágenes.');
  const dataUrl = await comprimirImagen(file, 1400, 0.85);
  const blob = dataUrlToBlob(dataUrl);
  const path = `${_user}/${landingId}/${itemId}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message);
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const img = { path, url: pub?.publicUrl || '', name: file.name || 'imagen.jpg' };
  mutateItems(landingId, items => items.map(i => i.id === itemId ? { ...i, imagenes: [...(i.imagenes || []), img] } : i));
  return img;
}
export async function removeItemImage(landingId, itemId, idx) {
  const l = getLanding(landingId); if (!l) return;
  const it = (l.items || []).find(i => i.id === itemId); if (!it) return;
  const img = (it.imagenes || [])[idx]; if (!img) return;
  mutateItems(landingId, items => items.map(i => i.id === itemId ? { ...i, imagenes: (i.imagenes || []).filter((_, k) => k !== idx) } : i));
  if (supabase && img.path) { try { await supabase.storage.from(BUCKET).remove([img.path]); } catch {} }
}

// ── helpers ───────────────────────────────────────────────────────────
export const ESTADOS_LANDING = ['revision', 'progreso', 'lista'];
export const ESTADO_LANDING_LABEL = { revision: 'En revisión', progreso: 'En progreso', lista: 'Lista' };
export function progresoDe(l) {
  const items = (l && l.items) || [];
  const done = items.filter(i => i.hecho).length;
  return { done, total: items.length, pct: items.length ? Math.round(done / items.length * 100) : 0 };
}
// Pendientes ordenados por orden manual (drag) y, a igual orden, por prioridad.
const PRIO_RANK = { alta: 2, media: 1, '': 0 };
export function itemsOrdenados(l) {
  const items = ((l && l.items) || []).map(i => ({ ...i }));
  const pend = items.filter(i => !i.hecho).sort((a, b) => (a.orden - b.orden) || (PRIO_RANK[b.prioridad || ''] - PRIO_RANK[a.prioridad || '']));
  const done = items.filter(i => i.hecho);
  return { pend, done };
}
