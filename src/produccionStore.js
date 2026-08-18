// Store de PRODUCCIÓN del equipo creativo.
//
// Reemplaza los dos Excels: la planilla master de control + el detalle por
// persona. Guarda ASIGNACIONES semanales (producto × persona), cada una con su
// ESTADO (por hacer → revisión → aprobado → publicado) y calcula el pago del
// equipo. Se integra con los productos que YA existen (productoId de
// marketing_productos), no crea un catálogo aparte.
//
// FASE 2 — la nube: antes el control vivía SOLO en localStorage (por-navegador),
// lo que impedía que cada creativo entrara desde su compu. Ahora sincroniza con
// Supabase (tabla produccion_asignaciones + produccion_pagos, con RLS):
//   - Los admin ven/editan TODO. Un creator ve SOLO sus tarjetas y solo puede
//     cambiar estado (por hacer/revisión) y subir creativos — vía la RPC
//     produccion_creator_update.
//   - La API pública sigue siendo SÍNCRONA: escribimos optimista en un cache en
//     memoria (con espejo en localStorage para pintar al instante) y empujamos
//     el cambio a la nube en segundo plano. Así ProduccionSection/CreativaDashboard
//     no cambian.
//   - initProduccionSync({role,userId}) arranca el sync al loguear; hidrata de
//     la nube y, la primera vez de un admin, migra la data local existente.

import { supabase } from './supabase.js';

const KEY = 'adslab-produccion-v1';
const PAGOS_KEY = 'adslab-produccion-pagos-v1';
const MIGRATED_KEY = 'adslab-produccion-migrated-v1';
const OWNER_KEY = 'adslab-produccion-owner-v1'; // último userId dueño del cache local
const UNSYNCED_KEY = 'adslab-produccion-unsynced-v1'; // ids cuyo push a la nube falló
const TABLE = 'produccion_asignaciones';
const PAGOS_TABLE = 'produccion_pagos';

const listeners = new Set();

// ── Estado del módulo (sync con la nube) ──
let _role = null;      // 'admin' | 'creator' | null (null = modo 100% local)
let _userId = null;
let _actorName = null; // nombre para el historial ("quién hizo qué")
let _cache = null;     // asignaciones en memoria; null hasta el primer read()
let _pagos = null;     // { 'weekKey|persona': { paid, paidAt } }
let _refetchBound = false;
// ¿La base ya tiene la columna `historial` (migración 0021)? Se detecta al
// hidratar. Si es false, el historial se registra local pero NO se manda a la
// nube (para no romper writes cuando la migración todavía no se aplicó).
let _histCloud = false;
// Contador de escrituras locales. Sirve para que un hydrate/refetch NO pise un
// cambio optimista que ocurrió mientras traíamos la data de la nube.
let _writeSeq = 0;

// Columnas del kanban (como las listas de Trello del equipo).
export const ESTADOS = ['porhacer', 'revision', 'aprobado', 'publicado'];
export const ESTADO_LABELS = {
  porhacer: 'Por hacer', revision: 'En revisión', aprobado: 'Aprobado', publicado: 'Publicado',
};
// Estados que un creator puede setear (aprobar/publicar es del admin).
export const ESTADOS_CREATOR = ['porhacer', 'revision'];
// Estados viejos → nuevos (antes había 'asignado' y 'subido').
const ESTADO_MIGRACION = { asignado: 'porhacer', subido: 'porhacer' };
function normEstado(e) { return ESTADO_MIGRACION[e] || e || 'porhacer'; }
export const VIDEOS_POR_PRODUCTO = 9;
export const PAGO_POR_PRODUCTO = 42000; // ARS por producto completo y aprobado.

// Bonus por objetivo semanal (productos COMPLETADOS en la semana).
export function bonusObjetivo(completados) {
  if (completados >= 5) return 36000;
  if (completados === 4) return 30000;
  if (completados === 3) return 24000;
  return 0;
}

// Un producto cuenta como "completado" (para pago/objetivo) cuando está
// aprobado o publicado — NO cuando solo se subió.
const COMPLETO = new Set(['aprobado', 'publicado']);
export function esCompleto(estado) { return COMPLETO.has(estado); }

// =========================================================================
// Cache local (espejo en localStorage para pintar al instante)
// =========================================================================
function readLocalRaw() {
  try {
    const r = localStorage.getItem(KEY);
    const arr = r ? JSON.parse(r) : [];
    return arr.map(a => ({ ...a, estado: normEstado(a.estado) }));
  } catch { return []; }
}
function persistLocal(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch {}
}
function ensureCache() {
  if (_cache == null) _cache = readLocalRaw();
  return _cache;
}
function read() { return ensureCache(); }

function notify() {
  listeners.forEach(fn => { try { fn(); } catch {} });
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('viora:produccion-changed')); } catch {}
  }
}

// write() = actualiza cache + espejo local + avisa. NO empuja a la nube (eso lo
// hace cada mutador con pushRow/pushDelete, que sabe el tipo de operación).
function write(arr) {
  _cache = arr;
  _writeSeq++;
  persistLocal(arr);
  notify();
}
function genId() { return `prodasig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

export function subscribeProduccion(fn) {
  listeners.add(fn);
  const on = () => { try { fn(); } catch {} };
  if (typeof window !== 'undefined') window.addEventListener('viora:produccion-changed', on);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('viora:produccion-changed', on);
  };
}

// =========================================================================
// Sync con la nube (Supabase)
// =========================================================================
function cloudReady() { return !!supabase && !!_role; }

function rowToLocal(r) {
  return {
    id: r.id,
    weekKey: r.week_key,
    productoId: r.producto_id != null ? String(r.producto_id) : null,
    productoNombre: r.producto_nombre || '',
    persona: r.persona || '',
    creatorId: r.creator_id || null,
    ownerId: r.owner_id || null,
    tipo: r.tipo === 'testeo' ? 'testeo' : 'renovado',
    estado: normEstado(r.estado),
    videosTotal: r.videos_total != null ? r.videos_total : VIDEOS_POR_PRODUCTO,
    videosAprobados: r.videos_aprobados != null ? r.videos_aprobados : 0,
    brief: r.brief || '',
    nota: r.nota || '',
    pagado: !!r.pagado,
    archivos: Array.isArray(r.archivos) ? r.archivos : [],
    historial: Array.isArray(r.historial) ? r.historial : [],
    createdAt: r.created_at || new Date().toISOString(),
    updatedAt: r.updated_at || new Date().toISOString(),
  };
}
function localToRow(a) {
  const row = {
    id: a.id,
    week_key: a.weekKey,
    producto_id: a.productoId != null ? String(a.productoId) : null,
    producto_nombre: a.productoNombre || '',
    persona: a.persona || '',
    creator_id: a.creatorId || null,
    // Dueño del tablero (aislamiento por inquilino): la RLS deja escribir/leer
    // solo tus propias filas. Si la fila no lo trae, usamos el usuario actual.
    owner_id: a.ownerId || _userId || null,
    tipo: a.tipo === 'testeo' ? 'testeo' : 'renovado',
    estado: a.estado || 'porhacer',
    videos_total: a.videosTotal != null ? a.videosTotal : VIDEOS_POR_PRODUCTO,
    videos_aprobados: a.videosAprobados != null ? a.videosAprobados : 0,
    brief: a.brief || '',
    nota: a.nota || '',
    pagado: !!a.pagado,
    archivos: Array.isArray(a.archivos) ? a.archivos : [],
    created_at: a.createdAt || new Date().toISOString(),
  };
  // Solo mandamos historial si la base lo soporta (evita romper el write
  // cuando la migración 0021 todavía no se aplicó).
  if (_histCloud) row.historial = Array.isArray(a.historial) ? a.historial : [];
  return row;
}

// Crea un evento de historial con el actor actual.
function nuevoEvento(tipo, extra = {}) {
  return {
    ts: new Date().toISOString(),
    tipo,
    by: _userId || null,
    byName: _actorName || 'Alguien',
    ...extra,
  };
}

// Serializamos los push POR tarjeta: en una subida cada archivo dispara un
// push con la lista acumulada; si se resolvieran fuera de orden, uno viejo
// (con menos archivos) podría pisar al nuevo. La cadena por id garantiza que
// el último en encolarse (lista completa) es el último en escribir. Además
// contamos los push en vuelo para no dejar que un refetch por foco pise un
// cambio optimista que todavía no llegó al server.
const _pushChains = new Map();
let _inflight = 0;

function enqueue(id, fn) {
  const prev = _pushChains.get(id) || Promise.resolve();
  _inflight++;
  const next = prev
    .then(fn)
    .catch(e => console.warn('[produccion] push chain:', e?.message || e))
    .finally(() => {
      _inflight = Math.max(0, _inflight - 1);
      if (_pushChains.get(id) === next) _pushChains.delete(id);
    });
  _pushChains.set(id, next);
  return next;
}

// Ids de tarjetas cuyo push a la nube falló (RLS/red). Persistido para sobrevivir
// un reload. Sirve para (a) preservarlas en el hydrate en vez de descartarlas, y
// (b) avisarle al usuario que un cambio NO se guardó (en vez de perderlo callado).
let _unsynced = (() => { try { return new Set(JSON.parse(localStorage.getItem(UNSYNCED_KEY) || '[]')); } catch { return new Set(); } })();
function persistUnsynced() { try { localStorage.setItem(UNSYNCED_KEY, JSON.stringify([..._unsynced])); } catch {} }
function markUnsynced(id, bad) {
  if (bad) { if (!_unsynced.has(id)) { _unsynced.add(id); persistUnsynced(); } }
  else if (_unsynced.delete(id)) { persistUnsynced(); }
}
function emitSyncError(msg) {
  try { window.dispatchEvent(new CustomEvent('viora:produccion-sync-error', { detail: { message: msg || 'error' } })); } catch {}
}

function pushRow(id, evento = null, opts = {}) { return enqueue(id, () => doPushRow(id, evento, opts)); }
function pushDelete(id) { return enqueue(id, () => doPushDelete(id)); }

// Empuja una fila (insert/update) a la nube. Admin → tabla directa; creator →
// RPC acotada (solo estado permitido + archivos de SU tarjeta). `evento` es la
// entrada de historial a registrar (para el creator viaja por la RPC).
async function doPushRow(id, evento = null, opts = {}) {
  if (!cloudReady()) return;
  const a = ensureCache().find(x => x.id === id);
  if (!a) return;
  if (_role === 'admin') {
    // El historial ya está dentro de la fila (localToRow lo incluye si _histCloud).
    const row = localToRow(a);
    // Un update que NO toca archivos (estado / brief / nota / asignación) omite
    // la columna `archivos` del upsert. Como el upsert solo pisa las columnas del
    // payload, así NO borra videos que el editor subió concurrentemente (el
    // last-writer-wins de la fila entera se los comía). Los cambios de archivos
    // (addArchivos/removeArchivo/nueva tarjeta) NO pasan skipArchivos.
    if (opts.skipArchivos) delete row.archivos;
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'id' });
    if (error) { console.warn('[produccion] push(admin):', error.message); markUnsynced(id, true); emitSyncError(error.message); }
    else markUnsynced(id, false);
  } else if (_role === 'creator') {
    // Solo mandamos p_estado si ESTE push viene de un cambio de estado real
    // (evento tipo 'estado'). Un push de solo-archivos NO debe tocar el estado:
    // con cache vieja, mandar el estado local podía revertir una aprobación que
    // el admin acababa de hacer.
    const estado = (evento && evento.tipo === 'estado' && ESTADOS_CREATOR.includes(a.estado)) ? a.estado : null;
    const params = { p_id: id, p_estado: estado, p_archivos: a.archivos || [] };
    if (_histCloud && evento) params.p_evento = evento; // solo si la base lo soporta
    const { error } = await supabase.rpc('produccion_creator_update', params);
    if (error) { console.warn('[produccion] push(creator):', error.message); markUnsynced(id, true); emitSyncError(error.message); }
    else markUnsynced(id, false);
  }
}

async function doPushDelete(id) {
  if (!cloudReady() || _role !== 'admin') return;
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) { console.warn('[produccion] delete:', error.message); emitSyncError(error.message); }
  else markUnsynced(id, false);
}

// Devuelve true solo si el upsert confirmó OK (para no marcar la migración
// como hecha si en realidad falló — sino se podría perder el tablero).
async function pushMany(rows) {
  if (!cloudReady() || _role !== 'admin' || rows.length === 0) return false;
  try {
    const { error } = await supabase.from(TABLE).upsert(rows.map(localToRow), { onConflict: 'id' });
    if (error) { console.warn('[produccion] migrate:', error.message); return false; }
    return true;
  } catch (e) { console.warn('[produccion] migrate ex:', e?.message || e); return false; }
}

// Trae de la nube y reemplaza el cache. La RLS ya acota: admin=todo, creator=lo
// suyo. La primera vez de un admin con cloud vacío, migra la data local.
async function hydrate() {
  if (!cloudReady()) return;
  try {
    // Detecta si la base ya tiene la columna `historial` (migración 0021).
    try {
      const probe = await supabase.from(TABLE).select('historial').limit(1);
      _histCloud = !probe.error;
    } catch { _histCloud = false; }

    const seqBefore = _writeSeq;
    const { data, error } = await supabase.from(TABLE).select('*');
    if (error) { console.warn('[produccion] pull:', error.message); return; }

    // Si mientras traíamos la data hubo un cambio optimista local (o quedan
    // push en vuelo), NO pisamos el cache: el push ya persiste en el server y
    // el próximo refetch reconcilia. Evita que un refetch revierta un cambio.
    if (_writeSeq !== seqBefore || _inflight > 0) return;

    const cloud = (data || []).map(rowToLocal);
    if (cloud.length > 0) {
      const cloudIds = new Set(cloud.map(r => r.id));
      // Las que ya aparecen en la nube dejaron de estar "sin sincronizar".
      for (const id of [..._unsynced]) if (cloudIds.has(id)) markUnsynced(id, false);
      // Filas locales que FALLARON al subir (marcadas) y NO están en la nube: las
      // conservamos y reintentamos, en vez de descartarlas (sino se perdían). Las
      // borradas remotamente NO están marcadas → se dejan ir (no se resucitan).
      // Solo aplica al admin (el creator no crea filas).
      const keep = (_role === 'admin')
        ? readLocalRaw().filter(a => _unsynced.has(a.id) && !cloudIds.has(a.id))
        : [];
      if (keep.length > 0) {
        pushMany(keep).then(ok => { if (ok) keep.forEach(a => markUnsynced(a.id, false)); }).catch(() => {});
        write([...cloud, ...keep]);
      } else {
        write(cloud);
      }
    } else {
      const local = readLocalRaw();
      const yaMigro = !!localStorage.getItem(MIGRATED_KEY);
      if (_role === 'admin' && local.length > 0 && !yaMigro) {
        // Migración one-time. Solo marcamos MIGRATED si el upsert confirmó OK,
        // y SIEMPRE mantenemos el tablero local (si falló, se reintenta luego).
        const ok = await pushMany(local);
        if (ok) { try { localStorage.setItem(MIGRATED_KEY, '1'); } catch {} }
        write(local);
      } else if (_role === 'admin' && local.length > 0) {
        // Ya migramos antes pero la nube volvió vacía. NO borramos el tablero
        // (podría ser un fallo transitorio); mantenemos lo local.
        write(local);
      } else {
        // Creator sin asignaciones, o admin sin nada local → vacío de verdad.
        write([]);
      }
    }
    await hydratePagos();
    await hydratePagoConfig();
  } catch (e) { console.warn('[produccion] hydrate ex:', e?.message || e); }
}

export function refreshProduccion() { return hydrate(); }

// Arranca (o reinicia) el sync. Llamar al loguear con el rol resuelto.
export async function initProduccionSync({ role, userId, name } = {}) {
  _role = role || null;
  _userId = userId || null;
  _actorName = name || _actorName || null;

  // Si cambió el dueño del cache local (otro user en el mismo navegador),
  // limpiamos el espejo para no mostrar data ajena mientras hidrata.
  try {
    const prevOwner = localStorage.getItem(OWNER_KEY);
    if (_userId && prevOwner && prevOwner !== _userId) {
      localStorage.removeItem(KEY);
      localStorage.removeItem(PAGOS_KEY);
      localStorage.removeItem(MIGRATED_KEY);
      localStorage.removeItem(MIGRATED_KEY + '-pagos');
      _cache = null; _pagos = null;
    }
    if (_userId) localStorage.setItem(OWNER_KEY, _userId);
  } catch {}

  if (!supabase || !_role) return; // sin nube → modo local puro (compat)
  setupRefetch();
  await hydrate();
}

export function teardownProduccionSync() {
  _role = null;
  _userId = null;
}

// Refresca al volver a la pestaña (así admin ve lo que subió el creator y
// viceversa) sin necesidad de realtime.
function setupRefetch() {
  if (_refetchBound || typeof window === 'undefined') return;
  _refetchBound = true;
  const onVisible = () => {
    // No refrescamos si hay push optimistas en vuelo: el server todavía no
    // tiene el último cambio y traerlo pisaría el cache con data vieja.
    if (document.visibilityState === 'visible' && cloudReady() && _inflight === 0) hydrate();
  };
  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);
}

// Lunes (horario AR) de la semana de una fecha → 'YYYY-MM-DD'. Es la clave de
// semana con la que se agrupan las asignaciones.
export function weekKeyOf(date = new Date()) {
  const s = date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 dom .. 6 sab
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); // al lunes
  return dt.toISOString().slice(0, 10);
}

// Etiqueta legible de una semana: "Semana 4 · 27/7 al 2/8" (lunes a domingo).
// El número es la semana del mes (base lunes). El rango de fechas es lo que
// pidió el user (como el Excel): de lunes a domingo.
export function weekLabel(weekKey) {
  if (!weekKey) return '';
  const [y, m, d] = weekKey.split('-').map(Number);
  const monday = new Date(Date.UTC(y, m - 1, d));
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const n = Math.floor((d - 1) / 7) + 1;
  const f = dt => `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`;
  return `Semana ${n} · ${f(monday)} al ${f(sunday)}`;
}

// Solo el número de semana (para chips compactos).
export function weekNumber(weekKey) {
  if (!weekKey) return '';
  const d = Number(weekKey.split('-')[2]);
  return Math.floor((d - 1) / 7) + 1;
}
// Solo el rango de fechas "27/7 al 2/8".
export function weekRange(weekKey) {
  if (!weekKey) return '';
  const [y, m, d] = weekKey.split('-').map(Number);
  const monday = new Date(Date.UTC(y, m - 1, d));
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const f = dt => `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`;
  return `${f(monday)} al ${f(sunday)}`;
}

export function listAssignments(weekKey) {
  return read().filter(a => a.weekKey === weekKey);
}
export function allWeekKeys() {
  return [...new Set(read().map(a => a.weekKey))].sort().reverse();
}

// Personas (labels de texto) que aparecen en las tarjetas de TODAS las semanas,
// con cuántas tarjetas tienen y si alguna ya quedó atada a una cuenta real
// (creatorId). Sirve para ofrecer, en el panel de Equipo, "creale la cuenta a
// Fran" a partir de los nombres que ya venís usando, sin tener que retipearlos.
export function personasEnTarjetas() {
  const map = new Map(); // persona -> { persona, tarjetas, conCuenta }
  for (const a of read()) {
    const p = (a.persona || '').trim();
    if (!p) continue;
    const cur = map.get(p) || { persona: p, tarjetas: 0, conCuenta: false };
    cur.tarjetas++;
    if (a.creatorId) cur.conCuenta = true;
    map.set(p, cur);
  }
  return [...map.values()].sort((x, y) => y.tarjetas - x.tarjetas);
}

export function addAssignment({ weekKey, productoId, productoNombre, persona, creatorId = null, tipo = 'renovado', brief = '' }) {
  const per = (persona || '').trim();
  // persona es opcional: una tarjeta puede quedar "sin asignar" hasta que se le
  // cuelgue la persona (como en Trello, agregás el label después).
  if (!weekKey) return null;
  const arr = read().slice();
  const nueva = {
    id: genId(),
    weekKey,
    productoId: productoId != null ? String(productoId) : null,
    productoNombre: productoNombre || '',
    persona: per,
    creatorId: creatorId || null,
    ownerId: _userId || null, // dueño = quien crea la tarjeta (aislamiento por inquilino)
    tipo: tipo === 'testeo' ? 'testeo' : 'renovado',
    estado: 'porhacer',
    videosTotal: VIDEOS_POR_PRODUCTO,
    videosAprobados: 0,
    brief: brief || '',
    nota: '',
    pagado: false,
    archivos: [],
    historial: [nuevoEvento('creacion')],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  arr.push(nueva);
  write(arr);
  pushRow(nueva.id);
  return nueva;
}

// Paso 1 — el admin le pasa a Fran los productos de la semana (cuáles y
// cuántos). Quedan SIN persona ("por distribuir"). Evita duplicar un producto
// que ya está en la semana.
export function addProductoSemana({ weekKey, productoId, productoNombre, tipo = 'renovado' }) {
  if (!weekKey) return null;
  const pid = productoId != null ? String(productoId) : null;
  const arr = read();
  const dup = arr.find(a => a.weekKey === weekKey &&
    (pid != null ? String(a.productoId) === pid : (a.productoNombre || '') === (productoNombre || '')));
  if (dup) return dup; // ya está en la semana
  return addAssignment({ weekKey, productoId, productoNombre, persona: '', tipo });
}

// Paso 2 — Fran reparte: le pone (o le cambia) el agente a un producto.
export function assignPersona(id, persona) {
  updateAssignment(id, { persona: (persona || '').trim() });
}

// Asigna una tarjeta a un creator (cuenta del equipo). Setea creator_id (para
// la RLS/scope del creator) y, por comodidad, la persona (label) con su nombre.
export function assignCreator(id, { creatorId, persona }) {
  const patch = { creatorId: creatorId || null };
  if (persona !== undefined) patch.persona = (persona || '').trim();
  updateAssignment(id, patch);
}

export function updateAssignment(id, patch) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  const before = arr[i];
  // Si cambia el estado, dejamos registro en el historial (KPIs de tiempos).
  let evento = null;
  if (patch.estado && patch.estado !== before.estado) {
    evento = nuevoEvento('estado', { from: before.estado, to: patch.estado });
  }
  const historial = evento ? [...(before.historial || []), evento] : before.historial;
  arr[i] = { ...before, ...patch, historial, updatedAt: new Date().toISOString() };
  write(arr);
  // updateAssignment nunca modifica `archivos` (eso va por addArchivos/removeArchivo)
  // → skipArchivos para no pisar los videos que el editor subió en paralelo.
  pushRow(id, evento, { skipArchivos: true });
}
export function removeAssignment(id) {
  markUnsynced(id, false); // borrada a propósito → no la preservemos en el hydrate
  write(read().filter(a => a.id !== id));
  pushDelete(id);
}

// Busca la asignación (semana × producto × persona); si no existe, la crea.
// Es lo que usa "Subir creativos": el equipo elige producto y sube, sin tener
// que armar la asignación a mano. `key` de producto: id si hay, si no el nombre.
export function findOrCreateAssignment({ weekKey, productoId, productoNombre, persona, tipo = 'renovado' }) {
  const per = (persona || '').trim();
  if (!weekKey || !per) return null;
  const pid = productoId != null ? String(productoId) : null;
  const arr = read();
  const found = arr.find(a =>
    a.weekKey === weekKey &&
    a.persona === per &&
    (pid != null
      ? String(a.productoId) === pid
      : (a.productoNombre || '') === (productoNombre || '')));
  if (found) return found;
  return addAssignment({ weekKey, productoId, productoNombre, persona: per, tipo });
}

// Registra archivos subidos en una tarjeta. Cada archivo:
// { name, driveId?, link?, destino:'drive'|'adslab', storagePath?, sizeMB?, ts }.
// NO cambia la columna: el estado se mueve arrastrando la tarjeta (Trello-like).
export function addArchivos(id, archivos) {
  if (!Array.isArray(archivos) || archivos.length === 0) return;
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  const prev = arr[i].archivos || [];
  arr[i] = { ...arr[i], archivos: [...prev, ...archivos], updatedAt: new Date().toISOString() };
  write(arr);
  pushRow(id);
  return arr[i];
}

export function removeArchivo(id, ts) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  arr[i] = { ...arr[i], archivos: (arr[i].archivos || []).filter(f => f.ts !== ts), updatedAt: new Date().toISOString() };
  write(arr);
  pushRow(id);
}

// ── Config de pago POR PERSONA (monto por producto + tramos de bono) ─────────
// Sin config para una persona → se usan los defaults globales (PAGO_POR_PRODUCTO
// + bonusObjetivo). El dueño la edita en "Equipo"; se guarda en la tabla
// produccion_pago_config (RLS por dueño; el editor solo lee la suya por creatorId).
export const DEFAULT_BONUS_TRAMOS = [{ min: 3, monto: 24000 }, { min: 4, monto: 30000 }, { min: 5, monto: 36000 }];
const PAGOS_CONFIG_TABLE = 'produccion_pago_config';
const PAGOS_CONFIG_KEY = 'adslab-produccion-pago-config-v1';
const cfgKey = (persona) => (persona || '').trim().toLowerCase();
function readPagoConfigLocal() { try { return JSON.parse(localStorage.getItem(PAGOS_CONFIG_KEY) || '{}') || {}; } catch { return {}; } }
let _pagoConfig = readPagoConfigLocal();
function writePagoConfigLocal(obj) {
  _pagoConfig = obj || {};
  try { localStorage.setItem(PAGOS_CONFIG_KEY, JSON.stringify(_pagoConfig)); } catch {}
  notify();
}

// Monto por producto (9 videos) de una persona (o el default si no configuró).
export function pagoProductoDe(persona) {
  const c = _pagoConfig[cfgKey(persona)];
  return Number.isFinite(c?.pagoProducto) ? c.pagoProducto : PAGO_POR_PRODUCTO;
}
// Bono de una persona según sus completados de la semana. Sin config → default
// global; con config → el tramo más alto que alcanzó (o 0 si no tiene tramos).
export function bonusDe(persona, completados) {
  const c = _pagoConfig[cfgKey(persona)];
  if (!c) return bonusObjetivo(completados);
  const tramos = Array.isArray(c.bonusTramos) ? c.bonusTramos : [];
  let monto = 0;
  for (const t of tramos) { if (completados >= (t.min || 0)) monto = Math.max(monto, t.monto || 0); }
  return monto;
}
// Config completa de una persona para la UI (con defaults si no hay fila).
export function getPagoConfig(persona) {
  const c = _pagoConfig[cfgKey(persona)];
  return {
    persona,
    pagoProducto: Number.isFinite(c?.pagoProducto) ? c.pagoProducto : PAGO_POR_PRODUCTO,
    bonusTramos: Array.isArray(c?.bonusTramos) ? c.bonusTramos.map(t => ({ ...t })) : DEFAULT_BONUS_TRAMOS.map(t => ({ ...t })),
    tieneConfig: !!c,
  };
}
export function listPagoConfigs() { return { ..._pagoConfig }; }

// Guarda la config de una persona (solo dueño). creatorId opcional: si la
// persona es una cuenta, lo guardamos para que ESE editor pueda leer su config.
export function setPagoConfig(persona, { pagoProducto, bonusTramos, creatorId } = {}) {
  const key = cfgKey(persona);
  if (!key) return;
  const cfg = {
    persona: (persona || '').trim(),
    pagoProducto: Number.isFinite(pagoProducto) ? Math.max(0, Math.round(pagoProducto)) : PAGO_POR_PRODUCTO,
    bonusTramos: (Array.isArray(bonusTramos) ? bonusTramos : [])
      .filter(t => Number.isFinite(t?.min) && Number.isFinite(t?.monto))
      .map(t => ({ min: Math.max(1, Math.round(t.min)), monto: Math.max(0, Math.round(t.monto)) }))
      .sort((a, b) => a.min - b.min),
    creatorId: creatorId || _pagoConfig[key]?.creatorId || null,
  };
  writePagoConfigLocal({ ..._pagoConfig, [key]: cfg });
  pushPagoConfig(cfg);
}

async function pushPagoConfig(cfg) {
  if (!cloudReady() || _role !== 'admin') return;
  try {
    const { error } = await supabase.from(PAGOS_CONFIG_TABLE).upsert({
      owner_id: _userId, persona: cfg.persona, creator_id: cfg.creatorId || null,
      pago_producto: cfg.pagoProducto, bonus_tramos: cfg.bonusTramos, updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,persona' });
    if (error) { console.warn('[produccion] pushPagoConfig:', error.message); emitSyncError(error.message); }
  } catch (e) { console.warn('[produccion] pushPagoConfig ex:', e?.message || e); }
}

async function hydratePagoConfig() {
  if (!cloudReady()) return;
  try {
    const { data, error } = await supabase.from(PAGOS_CONFIG_TABLE).select('*');
    if (error) { console.warn('[produccion] pull pago-config:', error.message); return; }
    const obj = {};
    for (const r of (data || [])) {
      obj[cfgKey(r.persona)] = {
        persona: r.persona,
        pagoProducto: r.pago_producto,
        bonusTramos: Array.isArray(r.bonus_tramos) ? r.bonus_tramos : [],
        creatorId: r.creator_id || null,
      };
    }
    writePagoConfigLocal(obj);
  } catch (e) { console.warn('[produccion] hydrate pago-config ex:', e?.message || e); }
}

// Resumen de pago por persona para una semana. Montos en ARS (así paga el user).
export function paymentSummary(weekKey) {
  const asigs = listAssignments(weekKey);
  const byPersona = {};
  for (const a of asigs) {
    const p = a.persona;
    if (!p) continue; // "por distribuir" no cuenta para el pago todavía
    if (!byPersona[p]) byPersona[p] = { persona: p, asignados: 0, completados: 0, pagados: 0 };
    byPersona[p].asignados++;
    if (esCompleto(a.estado)) byPersona[p].completados++;
    if (a.pagado) byPersona[p].pagados++;
  }
  return Object.values(byPersona).map(x => {
    const montoProductos = x.completados * pagoProductoDe(x.persona);
    const bonus = bonusDe(x.persona, x.completados);
    return { ...x, montoProductos, bonus, totalArs: montoProductos + bonus };
  }).sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
}

// Inversión (pago al equipo) acumulada POR PRODUCTO, sumando TODAS las semanas.
// Cada tarjeta completada (aprobado/publicado) = PAGO_POR_PRODUCTO invertido en
// ese producto. No incluye el bonus por objetivo (es un incentivo por persona/
// semana, no atribuible a un producto puntual). Devuelve
// [{ key, productoId, productoNombre, tarjetas, completados, enProceso, invertido }]
// ordenado por invertido desc.
export function inversionPorProducto() {
  const byProd = {};
  for (const wk of allWeekKeys()) {
    for (const a of listAssignments(wk)) {
      const nombre = (a.productoNombre || '').trim() || 'Sin nombre';
      const key = a.productoId != null && String(a.productoId) ? `id:${a.productoId}` : `n:${nombre.toLowerCase()}`;
      if (!byProd[key]) {
        byProd[key] = { key, productoId: a.productoId ?? null, productoNombre: nombre, tarjetas: 0, completados: 0, enProceso: 0, invertido: 0 };
      }
      const p = byProd[key];
      p.tarjetas++;
      if (esCompleto(a.estado)) { p.completados++; p.invertido += pagoProductoDe(a.persona); }
      else p.enProceso++;
    }
  }
  return Object.values(byProd).sort((a, b) => b.invertido - a.invertido || a.productoNombre.localeCompare(b.productoNombre, 'es'));
}

// Rol actual del sync ('admin' | 'creator' | null). La UI lo usa para mostrar
// cosas que son solo del admin (ej: el aviso de entregas nuevas).
export function getRole() { return _role; }

// Momento de subida de un archivo: el `ts` de uid() arranca con Date.now().
function tsSubida(f) {
  const n = parseInt(String(f?.ts || '').split('-')[0], 10);
  return Number.isFinite(n) ? n : 0;
}

// Última subida registrada en TODA la producción (epoch ms, 0 si no hay nada).
// Sirve para saber "hay algo nuevo desde X" sin recorrer todo en el render.
export function ultimaSubidaTs() {
  let max = 0;
  for (const a of read()) {
    for (const f of (a.archivos || [])) {
      const t = tsSubida(f);
      if (t > max) max = t;
    }
  }
  return max;
}

// Entregas (videos subidos por el equipo) más nuevas que `sinceTs`, agrupadas
// por tarjeta. Es el corazón del aviso "🆕 Entregas nuevas" del admin: en vez de
// revisar tarjeta por tarjeta, ve de una lo que se subió y no miró todavía.
// Recorre TODAS las semanas. Devuelve
// [{ id, weekKey, productoId, productoNombre, persona, nuevos, lastTs, archivos }]
// ordenado por lo más reciente primero.
export function entregasNuevas(sinceTs = 0) {
  const out = [];
  for (const wk of allWeekKeys()) {
    for (const a of listAssignments(wk)) {
      const nuevos = (a.archivos || []).filter(f => tsSubida(f) > sinceTs);
      if (nuevos.length === 0) continue;
      const lastTs = nuevos.reduce((m, f) => Math.max(m, tsSubida(f)), 0);
      out.push({
        id: a.id,
        weekKey: wk,
        productoId: a.productoId ?? null,
        productoNombre: (a.productoNombre || '').trim() || 'Sin nombre',
        persona: a.persona || '',
        estado: a.estado,
        nuevos: nuevos.length,
        lastTs,
        archivos: nuevos,
      });
    }
  }
  return out.sort((a, b) => b.lastTs - a.lastTs);
}

// Pulso de la semana: cuántos videos (archivos) subió el equipo cada día,
// lunes→domingo. Alimenta el mini-gráfico de barras del Home. Bucket por el
// día real de subida (ts del archivo). Devuelve { labels, counts, total }.
export function entregasPorDiaSemana(weekKey = weekKeyOf()) {
  const labels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const a of listAssignments(weekKey)) {
    for (const f of (a.archivos || [])) {
      const t = tsSubida(f);
      if (!t) continue;
      // getDay(): 0=domingo..6=sábado → índice lunes-primero.
      const idx = (new Date(t).getDay() + 6) % 7;
      counts[idx]++;
    }
  }
  return { labels, counts, total: counts.reduce((s, n) => s + n, 0) };
}

// =========================================================================
// PAGOS + RESUMEN MENSUAL (para el dashboard de Área creativa) — SOLO admin.
// =========================================================================
// El pago se salda por (semana × persona) — es la unidad natural porque el
// bonus por objetivo es semanal. Guardamos el estado "pagado" aparte de las
// asignaciones así no ensucia el tablero operativo. Espejo en produccion_pagos.

const pagoKey = (weekKey, persona) => `${weekKey}|${persona}`;

function readPagosLocal() {
  try { const r = localStorage.getItem(PAGOS_KEY); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function ensurePagos() {
  if (_pagos == null) _pagos = readPagosLocal();
  return _pagos;
}
function persistPagos(obj) {
  try { localStorage.setItem(PAGOS_KEY, JSON.stringify(obj)); } catch {}
}
function writePagos(obj) {
  _pagos = obj;
  persistPagos(obj);
  notify();
}

async function hydratePagos() {
  if (!cloudReady() || _role !== 'admin') return; // pagos son cosa del admin
  try {
    const { data, error } = await supabase.from(PAGOS_TABLE).select('*');
    if (error) { console.warn('[produccion] pull pagos:', error.message); return; }
    if ((data || []).length > 0) {
      const obj = {};
      data.forEach(r => { if (r.paid) obj[pagoKey(r.week_key, r.persona)] = { paid: true, paidAt: r.paid_at }; });
      writePagos(obj);
      return;
    }
    // Cloud vacío → migrar los pagos locales existentes (una vez).
    const local = readPagosLocal();
    const yaMigro = !!localStorage.getItem(MIGRATED_KEY + '-pagos');
    const entries = Object.entries(local).filter(([, v]) => v?.paid);
    if (entries.length > 0 && !yaMigro) {
      const payload = entries.map(([k, v]) => {
        const [wk, ...rest] = k.split('|');
        return { week_key: wk, persona: rest.join('|'), owner_id: _userId, paid: true, paid_at: v.paidAt || new Date().toISOString() };
      });
      const { error: upErr } = await supabase.from(PAGOS_TABLE).upsert(payload, { onConflict: 'owner_id,week_key,persona' });
      // Solo marcamos MIGRATED si el upsert CONFIRMÓ (sino perderíamos el pago:
      // si la RLS lo rechazó y marcamos migrado, la próxima vez se borraría lo
      // local sin haber llegado nunca a la nube). Igual mantenemos lo local.
      if (upErr) console.warn('[produccion] migrate pagos:', upErr.message);
      else { try { localStorage.setItem(MIGRATED_KEY + '-pagos', '1'); } catch {} }
      writePagos(local);
    } else if (entries.length > 0) {
      // Ya migramos antes pero la nube volvió vacía → NO borrar (puede ser un
      // fallo transitorio); preservamos lo local (espeja la lógica de asignaciones).
      writePagos(local);
    } else {
      writePagos({});
    }
  } catch (e) { console.warn('[produccion] hydrate pagos ex:', e?.message || e); }
}

async function pushPago(weekKey, persona, paid) {
  if (!cloudReady() || _role !== 'admin') return;
  try {
    if (paid) {
      const { error } = await supabase.from(PAGOS_TABLE)
        .upsert({ week_key: weekKey, persona, owner_id: _userId, paid: true, paid_at: new Date().toISOString() }, { onConflict: 'owner_id,week_key,persona' });
      if (error) console.warn('[produccion] pushPago:', error.message);
    } else {
      const { error } = await supabase.from(PAGOS_TABLE).delete().match({ owner_id: _userId, week_key: weekKey, persona });
      if (error) console.warn('[produccion] pushPago del:', error.message);
    }
  } catch (e) { console.warn('[produccion] pushPago ex:', e?.message || e); }
}

export function isWeekPaid(weekKey, persona) {
  return !!ensurePagos()[pagoKey(weekKey, persona)]?.paid;
}
export function setWeekPaid(weekKey, persona, paid = true) {
  const p = { ...ensurePagos() };
  const k = pagoKey(weekKey, persona);
  if (paid) p[k] = { paid: true, paidAt: new Date().toISOString() };
  else delete p[k];
  writePagos(p);
  pushPago(weekKey, persona, paid);
}

// Mes (horario AR) → 'YYYY-MM'. Una semana pertenece al mes de su lunes.
export function monthKeyOf(date = new Date()) {
  const s = date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  return s.slice(0, 7);
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function monthLabel(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}
export function allMonthKeys() {
  const set = new Set(read().map(a => (a.weekKey || '').slice(0, 7)).filter(Boolean));
  return [...set].sort().reverse();
}
export function weeksInMonth(monthKey) {
  return [...new Set(read().filter(a => (a.weekKey || '').slice(0, 7) === monthKey).map(a => a.weekKey))].sort();
}

// Resumen del mes por persona: total a pagar, pagado, pendiente, y el detalle
// semana por semana (con su estado de pago). Solo incluye a quien tiene algo
// para cobrar (productos completos/aprobados).
export function monthlySummary(monthKey) {
  const weeks = weeksInMonth(monthKey);
  const byPersona = {};
  for (const wk of weeks) {
    for (const r of paymentSummary(wk)) {
      if (r.totalArs <= 0) continue; // sin nada aprobado esa semana
      if (!byPersona[r.persona]) {
        byPersona[r.persona] = { persona: r.persona, completados: 0, montoProductos: 0, bonus: 0, total: 0, pagado: 0, pendiente: 0, semanas: [] };
      }
      const p = byPersona[r.persona];
      const paid = isWeekPaid(wk, r.persona);
      p.completados += r.completados;
      p.montoProductos += r.montoProductos;
      p.bonus += r.bonus;
      p.total += r.totalArs;
      if (paid) p.pagado += r.totalArs; else p.pendiente += r.totalArs;
      p.semanas.push({ weekKey: wk, completados: r.completados, montoProductos: r.montoProductos, bonus: r.bonus, total: r.totalArs, paid });
    }
  }
  const personas = Object.values(byPersona)
    .map(p => ({ ...p, semanas: p.semanas.sort((a, b) => a.weekKey.localeCompare(b.weekKey)) }))
    .sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
  const totals = personas.reduce((t, p) => ({
    total: t.total + p.total, pagado: t.pagado + p.pagado, pendiente: t.pendiente + p.pendiente,
    completados: t.completados + p.completados,
  }), { total: 0, pagado: 0, pendiente: 0, completados: 0 });
  return { personas, totals, weeks };
}
