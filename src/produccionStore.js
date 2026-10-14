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
import {
  PAGO_POR_PRODUCTO, VIDEOS_POR_PRODUCTO, DEFAULT_BONUS_TRAMOS,
  bonusObjetivo, pagoProductoDeCfg, bonusDeCfg, resumenVideosPorProducto, monthOfWeek } from './produccionCalc.js';
// Re-exportamos la lógica pura para no romper a quien la importaba desde acá.
export { PAGO_POR_PRODUCTO, VIDEOS_POR_PRODUCTO, DEFAULT_BONUS_TRAMOS, bonusObjetivo, resumenVideosPorProducto };

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
// ¿La base ya tiene la columna `material_link` (migración 0028)? Igual que
// _histCloud: si es false, el link de material se guarda local pero NO se manda
// a la nube (para no romper writes cuando la migración todavía no se aplicó).
let _materialCloud = false;
// Ídem `winners` (migración 0030).
let _winnersCloud = false;
// Ídem `etiqueta` (migración 0035) — etiqueta de campaña ("Día de la Madre").
let _etiquetaCloud = false;
// Ídem `prioridad` (migración 0039).
let _prioridadCloud = false;
// Ídem `referencias` (migración 0036) — reels de IG de referencia para el editor.
let _referenciasCloud = false;
// Contador de escrituras locales. Sirve para que un hydrate/refetch NO pise un
// cambio optimista que ocurrió mientras traíamos la data de la nube.
let _writeSeq = 0;

// Columnas del kanban (como las listas de Trello del equipo).
export const ESTADOS = ['porhacer', 'revision', 'aprobado', 'publicado', 'archivado'];
export const ESTADO_LABELS = {
  porhacer: 'Por hacer', revision: 'En revisión', aprobado: 'Aprobado', publicado: 'Publicado', archivado: 'Archivado',
};
// Estados que un creator puede setear (aprobar/publicar es del admin).
export const ESTADOS_CREATOR = ['porhacer', 'revision'];
// Estados viejos → nuevos (antes había 'asignado' y 'subido').
const ESTADO_MIGRACION = { asignado: 'porhacer', subido: 'porhacer' };
function normEstado(e) { return ESTADO_MIGRACION[e] || e || 'porhacer'; }
// PAGO_POR_PRODUCTO / VIDEOS_POR_PRODUCTO / bonusObjetivo ahora viven en
// produccionCalc.js (importados + re-exportados arriba).

// Un producto cuenta como "completado" (para pago/objetivo) cuando está
// aprobado, publicado o archivado (archivado = publicado que ya pasó a histórico,
// sigue contando) — NO cuando solo se subió.
const COMPLETO = new Set(['aprobado', 'publicado', 'archivado']);
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
    materialLink: r.material_link || '',
    winners: Array.isArray(r.winners) ? r.winners : [],
    referencias: Array.isArray(r.referencias) ? r.referencias : [],
    etiqueta: r.etiqueta || '',
    prioridad: r.prioridad != null ? r.prioridad : null,
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
  // Ídem con material_link (migración 0028).
  if (_materialCloud) row.material_link = a.materialLink || '';
  // Ídem winners (migración 0030).
  if (_winnersCloud) row.winners = Array.isArray(a.winners) ? a.winners : [];
  // Ídem referencias (migración 0036).
  if (_referenciasCloud) row.referencias = Array.isArray(a.referencias) ? a.referencias : [];
  // Ídem etiqueta (migración 0035).
  if (_etiquetaCloud) row.etiqueta = a.etiqueta || null;
  // Ídem prioridad (migración 0039): 1 alta · 2 media · 3 baja · null sin.
  if (_prioridadCloud) row.prioridad = a.prioridad != null ? a.prioridad : null;
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
// Ids BORRADAS localmente cuyo DELETE a la nube falló. Persistido: así el hydrate
// no las resucita y se reintenta el delete (sino un borrado que falló por red
// reaparecía en el próximo refetch).
const DELETED_KEY = 'adslab-produccion-deleted-v1';
let _deleted = (() => { try { return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || '[]')); } catch { return new Set(); } })();
function persistDeleted() { try { localStorage.setItem(DELETED_KEY, JSON.stringify([..._deleted])); } catch {} }
function markDeleted(id, bad) {
  if (bad) { if (!_deleted.has(id)) { _deleted.add(id); persistDeleted(); } }
  else if (_deleted.delete(id)) { persistDeleted(); }
}
function emitSyncError(msg) {
  try { window.dispatchEvent(new CustomEvent('viora:produccion-sync-error', { detail: { message: msg || 'error' } })); } catch {}
}

// Ids de tarjetas CREADAS en esta máquina cuyo INSERT todavía no llegó a la
// nube. Distinto de _unsynced (updates fallidos): solo lo creado acá puede
// re-insertarse en el hydrate — antes cualquier _unsynced "que no está en la
// nube" se re-agregaba, y eso RESUCITABA tarjetas borradas por otra sesión.
const CREATED_KEY = 'adslab-produccion-created-v1';
let _created = (() => { try { return new Set(JSON.parse(localStorage.getItem(CREATED_KEY) || '[]')); } catch { return new Set(); } })();
function persistCreated() { try { localStorage.setItem(CREATED_KEY, JSON.stringify([..._created])); } catch {} }
function markCreated(id, bad) {
  if (bad) { if (!_created.has(id)) { _created.add(id); persistCreated(); } }
  else if (_created.delete(id)) { persistCreated(); }
}

// UPDATES POR COLUMNA (auditoría #1): cada push lleva SOLO las columnas que
// ese cambio tocó, acumuladas acá por tarjeta. null = fila completa (callers
// legacy / insert). Así el admin cambiando la etiqueta ya no pisa el estado
// que el editor acaba de mover, ni al revés.
const _patchKeys = new Map(); // id -> Set<claveLocal> | null (fila completa)
function addPatchKeys(id, keys) {
  if (!keys) { _patchKeys.set(id, null); return; }
  const cur = _patchKeys.get(id);
  if (cur === null) return;
  const set = cur || new Set();
  for (const k of keys) set.add(k);
  _patchKeys.set(id, set);
}
// ── DELTAS DE ARCHIVOS (auditoría #2) ────────────────────────────────────────
// Cada mutación de `archivos` registra acá QUÉ archivos tocó (upsert por su ts)
// o borró. El push los manda por la RPC produccion_merge_archivos, que mergea
// contra la lista REAL del server con lock de fila: el editor subiendo y el
// admin aprobando a la vez ya no se pisan la lista entera. Si la base no tiene
// la RPC (migración 0041 sin aplicar) se cae al camino viejo (columna completa).
let _mergeRpc = null;   // null = sin probar; false = la base no la tiene
let _winnersRpc = null; // ídem produccion_winners_apply
const _archivoOps = new Map(); // id -> { up: Map(clave -> archivo), rm: Set(clave) }
const archivoKey = (f) => String(f?.ts || f?.driveId || f?.name || '') || null;
const esRpcInexistente = (e) =>
  !!e && (e.code === 'PGRST202' || /does not exist|schema cache/i.test(String(e.message || '')));

// `up` admite archivos con `_replaces: <ts viejo>` (flujo "Reemplazar": el
// server lo pone EN EL LUGAR del viejo, conservando el número de video).
function noteArchivoOps(id, { up = [], rm = [] } = {}) {
  if (_mergeRpc === false) return; // sin RPC viaja la columna entera; no acumular
  let ops = _archivoOps.get(id);
  if (!ops) { ops = { up: new Map(), rm: new Set() }; _archivoOps.set(id, ops); }
  for (const f of up) {
    const kReal = archivoKey(f);
    let k = f?._replaces || kReal;
    if (!k) continue;
    if (!f?._replaces && kReal) {
      // Si hay un replace PENDIENTE que produce este mismo archivo (reemplazó y
      // enseguida lo aprobaron, antes del push), actualizamos ESA entrada: si
      // no, el push mandaría el reemplazo viejo más un duplicado al final.
      let fusionado = false;
      for (const [ke, fe] of ops.up) {
        if (ke !== kReal && fe?._replaces && archivoKey(fe) === kReal) {
          ops.up.set(ke, { ...f, _replaces: fe._replaces });
          fusionado = true; break;
        }
      }
      if (fusionado) continue;
    }
    ops.up.set(k, f);
    ops.rm.delete(k);
  }
  for (const k of rm) {
    if (!k) continue;
    const ks = String(k);
    ops.rm.add(ks);
    ops.up.delete(ks);
  }
}
// Saca de la cola los ops pendientes de una tarjeta (el caller los restaura si
// el push falla). null = no hay nada que mandar por delta.
function tomarArchivoOps(id) {
  const ops = _archivoOps.get(id);
  if (!ops || (ops.up.size === 0 && ops.rm.size === 0)) return null;
  _archivoOps.delete(id);
  return ops;
}
function restaurarArchivoOps(id, ops) {
  if (!ops) return;
  const cur = _archivoOps.get(id);
  if (!cur) { _archivoOps.set(id, ops); return; }
  // Lo anotado MIENTRAS el push fallido viajaba es más nuevo: le gana a lo restaurado.
  for (const [k, f] of ops.up) if (!cur.up.has(k) && !cur.rm.has(k)) cur.up.set(k, f);
  for (const k of ops.rm) if (!cur.up.has(k)) cur.rm.add(k);
}
// Manda los deltas de archivos de una tarjeta por la RPC de merge. Devuelve:
// 'ok' (viajaron), 'sin-rpc' (la base no la tiene → columna completa),
// 'nada' (no había deltas) o 'error' (transitorio: ops restaurados, reintentar).
async function pushArchivosDelta(id) {
  if (_mergeRpc === false) return 'sin-rpc';
  const ops = tomarArchivoOps(id);
  if (!ops) return 'nada';
  const { error } = await supabase.rpc('produccion_merge_archivos', {
    p_id: id,
    p_up: [...ops.up.values()],
    p_rm: [...ops.rm],
  });
  if (!error) { _mergeRpc = true; return 'ok'; }
  if (esRpcInexistente(error)) { _mergeRpc = false; return 'sin-rpc'; }
  console.warn('[produccion] merge archivos:', error.message);
  restaurarArchivoOps(id, ops);
  emitSyncError(error.message);
  return 'error';
}

// clave local → columna de la tabla (subset de localToRow).
const COLMAP = {
  weekKey: 'week_key', productoId: 'producto_id', productoNombre: 'producto_nombre',
  persona: 'persona', creatorId: 'creator_id', tipo: 'tipo', estado: 'estado',
  videosTotal: 'videos_total', videosAprobados: 'videos_aprobados', brief: 'brief',
  nota: 'nota', pagado: 'pagado', archivos: 'archivos', historial: 'historial',
  materialLink: 'material_link', winners: 'winners', referencias: 'referencias',
  etiqueta: 'etiqueta', prioridad: 'prioridad',
};

function pushRow(id, evento = null, opts = {}) {
  addPatchKeys(id, opts.patch ? Object.keys(opts.patch) : null);
  return enqueue(id, () => doPushRow(id, evento, opts));
}
function pushDelete(id) { return enqueue(id, () => doPushDelete(id)); }

// Empuja una fila (insert/update) a la nube. Admin → tabla directa; creator →
// RPC acotada (solo estado permitido + archivos de SU tarjeta). `evento` es la
// entrada de historial a registrar (para el creator viaja por la RPC).
async function doPushRow(id, evento = null, opts = {}) {
  if (!cloudReady()) return;
  const a = ensureCache().find(x => x.id === id);
  if (!a) return;
  if (_role === 'admin') {
    // INSERT solo para tarjetas creadas en ESTA máquina: un upsert de una
    // tarjeta que otra sesión borró la resucitaría (auditoría #5).
    if (_created.has(id)) {
      const row = localToRow(a);
      const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'id' });
      if (error) { console.warn('[produccion] insert(admin):', error.message); markUnsynced(id, true); emitSyncError(error.message); }
      else { markUnsynced(id, false); markCreated(id, false); _patchKeys.delete(id); }
      return;
    }
    // UPDATE POR COLUMNA (auditoría #1): solo lo tocado desde el último push
    // OK. Un update sobre fila borrada afecta 0 filas (no resucita nada), y
    // dos sesiones editando CAMPOS distintos de la misma tarjeta ya no se
    // pisan la fila entera. skipArchivos queda por compatibilidad: con
    // patches, archivos solo viaja cuando el cambio lo tocó.
    const keys = _patchKeys.get(id);
    _patchKeys.delete(id);
    // ARCHIVOS POR DELTA (auditoría #2): si este push tocó archivos y la base
    // tiene la RPC de merge, los deltas viajan por ahí (el server mergea con
    // lock) y la columna entera NO viaja — así no pisamos lo que otra sesión
    // subió o aprobó en el medio. Sin RPC, 'archivos' queda en keys y viaja la
    // columna completa como siempre.
    if (keys && keys.has('archivos')) {
      const r = await pushArchivosDelta(id);
      // Solo si el delta viajó sacamos la columna del patch; con 'sin-rpc' o
      // 'nada' (cambio sin delta anotado) viaja la columna completa (legacy).
      if (r === 'ok') keys.delete('archivos');
      else if (r === 'error') {
        // Transitorio: re-anotar TODO el patch (los ops ya se restauraron) y
        // reintentar en el próximo push — no mandamos la columna entera, que
        // podría pisar al resto con nuestra cache.
        addPatchKeys(id, [...keys]);
        markUnsynced(id, true);
        return;
      }
    } else if (keys == null) {
      // Push de fila completa: la columna archivos viaja entera; los deltas
      // pendientes quedan superseded.
      _archivoOps.delete(id);
    }
    const full = localToRow(a);
    let row;
    if (keys == null) {
      row = { ...full };
      delete row.id; delete row.created_at; delete row.owner_id; delete row.creator_id;
    } else {
      row = {};
      for (const k of keys) {
        const col = COLMAP[k];
        if (col && col in full) row[col] = full[col];
      }
      // Un cambio con evento registra historial; sin _histCloud no viaja.
      if (evento && _histCloud) row.historial = full.historial;
    }
    if (opts.skipArchivos) delete row.archivos;
    if (Object.keys(row).length === 0) { markUnsynced(id, false); return; }
    const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select('id');
    if (error) {
      console.warn('[produccion] update(admin):', error.message);
      addPatchKeys(id, keys ? [...keys] : null); // re-anotar lo no sincronizado
      markUnsynced(id, true); emitSyncError(error.message);
    } else if (!data || data.length === 0) {
      // La fila ya no existe en la nube (borrada en otra sesión): no la
      // resucitamos; el próximo hydrate la saca del cache local.
      console.warn(`[produccion] update sobre tarjeta inexistente ${id} — borrada en otra sesión, se descarta`);
      markUnsynced(id, false);
    } else {
      markUnsynced(id, false);
    }
  } else if (_role === 'creator') {
    // Solo mandamos p_estado si ESTE push viene de un cambio de estado real
    // (evento tipo 'estado'). Un push de solo-archivos NO debe tocar el estado:
    // con cache vieja, mandar el estado local podía revertir una aprobación que
    // el admin acababa de hacer.
    const estado = (evento && evento.tipo === 'estado' && ESTADOS_CREATOR.includes(a.estado)) ? a.estado : null;
    // ARCHIVOS POR DELTA también para el editor (la RPC de merge autoriza por
    // creator_id): el editor subiendo y el admin aprobando a la vez ya no se
    // pisan la lista. Sin RPC en la base, viaja la lista completa (legacy).
    const r = await pushArchivosDelta(id);
    if (r === 'error') { markUnsynced(id, true); return; }
    const mandaArchivos = r === 'sin-rpc'; // con delta OK (o sin cambios) no se toca
    const params = { p_id: id, p_estado: estado, p_archivos: mandaArchivos ? (a.archivos || []) : null };
    if (_histCloud && evento) params.p_evento = evento; // solo si la base lo soporta
    // Si los archivos ya viajaron por delta y no hay estado ni evento, no queda
    // nada que mandar por la RPC del creator.
    if (!mandaArchivos && estado == null && !params.p_evento) { markUnsynced(id, false); return; }
    const { error } = await supabase.rpc('produccion_creator_update', params);
    if (error) { console.warn('[produccion] push(creator):', error.message); markUnsynced(id, true); emitSyncError(error.message); }
    else markUnsynced(id, false);
  }
}

async function doPushDelete(id) {
  if (!cloudReady() || _role !== 'admin') return;
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) {
    console.warn('[produccion] delete:', error.message);
    markDeleted(id, true); // recordamos que hay que reintentar el delete
    emitSyncError(error.message);
  } else {
    markUnsynced(id, false);
    markDeleted(id, false);
  }
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
    // Ídem `material_link` (migración 0028).
    try {
      const probe = await supabase.from(TABLE).select('material_link').limit(1);
      _materialCloud = !probe.error;
    } catch { _materialCloud = false; }
    // Ídem `winners` (migración 0030).
    try {
      const probe = await supabase.from(TABLE).select('winners').limit(1);
      _winnersCloud = !probe.error;
    } catch { _winnersCloud = false; }
    // Ídem `etiqueta` (migración 0035).
    try {
      const probe = await supabase.from(TABLE).select('etiqueta').limit(1);
      _etiquetaCloud = !probe.error;
    } catch { _etiquetaCloud = false; }
    // Ídem `prioridad` (migración 0039).
    try {
      const probe = await supabase.from(TABLE).select('prioridad').limit(1);
      _prioridadCloud = !probe.error;
    } catch { _prioridadCloud = false; }
    // Ídem `referencias` (migración 0036).
    try {
      const probe = await supabase.from(TABLE).select('referencias').limit(1);
      _referenciasCloud = !probe.error;
    } catch { _referenciasCloud = false; }

    const seqBefore = _writeSeq;
    const { data, error } = await supabase.from(TABLE).select('*');
    if (error) { console.warn('[produccion] pull:', error.message); return; }

    // Si mientras traíamos la data hubo un cambio optimista local (o quedan
    // push en vuelo), NO pisamos el cache: el push ya persiste en el server y
    // el próximo refetch reconcilia. Evita que un refetch revierta un cambio.
    if (_writeSeq !== seqBefore || _inflight > 0) {
      // Antes se DESCARTABA el refetch y una sesión activa podía quedar con
      // cache viejo indefinidamente (auditoría #4). Ahora se reintenta.
      scheduleRealtimeRefetch();
      return;
    }

    const cloud = (data || []).map(rowToLocal);
    if (cloud.length > 0) {
      const cloudById = new Map(cloud.map(r => [r.id, r]));
      const localById = new Map(readLocalRaw().map(r => [r.id, r]));
      // Merge reconciliando lo que NO llegó a la nube (solo admin; el creator no
      // crea/borra filas). Reglas:
      //   - _deleted (delete que falló) → se saca de la nube y se reintenta borrar.
      //   - _unsynced (insert/update que falló) → gana la versión LOCAL (no la pisa
      //     la nube) y se reintenta el push. Si no está en la nube (insert), se agrega.
      // Un cambio que SÍ sincronizó ya se limpió de _unsynced en el push OK, así
      // que acá toma la versión de la nube normalmente.
      const esAdmin = _role === 'admin';
      const merged = [];
      for (const r of cloud) {
        if (esAdmin && _deleted.has(r.id)) continue;
        // Preservamos los updates locales sin sincronizar para AMBOS roles: un
        // creator que editó su tarjeta (mover de estado, corrección, subir video)
        // y cuya sync falló NO debe perder el cambio cuando el refetch trae la
        // versión vieja de la nube. Antes esto era solo-admin y el creator perdía
        // el cambio callado.
        if (_unsynced.has(r.id) && localById.has(r.id)) merged.push(localById.get(r.id));
        else merged.push(r);
      }
      // Re-agregar filas que nunca llegaron a la nube (insert que falló) es una
      // operación de admin: el creator no crea filas, solo actualiza las suyas.
      if (esAdmin) {
        for (const id of _unsynced) {
          // SOLO tarjetas creadas en esta máquina (insert pendiente). Un update
          // fallido de una tarjeta que ya no está en la nube significa que OTRA
          // sesión la borró — re-agregarla la resucitaba (auditoría #5).
          if (!cloudById.has(id) && !_deleted.has(id) && localById.has(id) && _created.has(id)) {
            merged.push(localById.get(id));
          }
        }
      }
      // Limpieza de fantasmas (ambos roles): un pendiente cuya tarjeta ya no
      // existe en la nube y NO fue creada acá no tiene nada que sincronizar —
      // sin esto, el creator quedaba con una "tarjeta fantasma" permanente.
      for (const id of [..._unsynced]) {
        if (!cloudById.has(id) && !_created.has(id)) markUnsynced(id, false);
      }
      write(merged);
      // Reintentamos los pendientes (fire & forget; si vuelven a fallar, siguen
      // marcados). El reintento de updates aplica a AMBOS roles (para el creator
      // re-empuja sus archivos por la RPC). Los deletes solo los hace el admin.
      for (const id of _unsynced) if (localById.has(id)) pushRow(id);
      if (esAdmin) {
        for (const id of [..._deleted]) pushDelete(id);
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

// Escape hatch: DESCARTA el cache local (y las marcas de sin-sincronizar) y
// vuelve a traer todo de la nube (la fuente de verdad). Sirve cuando quedó una
// tarjeta "fantasma" local que nunca sincronizó y no querés que vuelva. Ojo:
// descarta cambios locales que todavía no llegaron al server.
export async function resyncDesdeNube() {
  _unsynced = new Set();
  _deleted = new Set();
  try {
    localStorage.removeItem(UNSYNCED_KEY);
    localStorage.removeItem(DELETED_KEY);
    localStorage.removeItem(MIGRATED_KEY);
    localStorage.removeItem(MIGRATED_KEY + '-pagos');
  } catch {}
  _cache = [];
  try { localStorage.setItem(KEY, '[]'); } catch {}
  notify();
  return hydrate();
}

// ⚠️ Vacía TODO lo de producción del dueño actual (tarjetas + pagos + config de
// pagos), en la nube y local, para arrancar de cero. Borra SOLO las filas del
// owner (owner_id = _userId), nunca de otros negocios de la base compartida. NO
// toca las cuentas del equipo (eso lo hace la UI con removeMember). Devuelve
// { asignaciones, error? } con lo borrado.
export async function vaciarTodo() {
  let borradas = 0;
  if (cloudReady() && _role === 'admin' && _userId) {
    try {
      // Contamos antes para reportar, y borramos acotado por owner_id.
      const { data: prev } = await supabase.from(TABLE).select('id').eq('owner_id', _userId);
      borradas = (prev || []).length;
      const d1 = await supabase.from(TABLE).delete().eq('owner_id', _userId);
      if (d1.error) return { asignaciones: 0, error: d1.error.message };
      await supabase.from(PAGOS_TABLE).delete().eq('owner_id', _userId);
      await supabase.from(PAGOS_CONFIG_TABLE).delete().eq('owner_id', _userId);
    } catch (e) {
      return { asignaciones: 0, error: e?.message || String(e) };
    }
  }
  // Limpieza local completa (cache en memoria + espejos en localStorage).
  _cache = [];
  _pagos = {};
  _pagoConfig = {};
  _unsynced = new Set();
  _deleted = new Set();
  try {
    localStorage.setItem(KEY, '[]');
    localStorage.removeItem(PAGOS_KEY);
    localStorage.removeItem(PAGOS_CONFIG_KEY);
    localStorage.removeItem(UNSYNCED_KEY);
    localStorage.removeItem(DELETED_KEY);
    localStorage.removeItem(MIGRATED_KEY);
    localStorage.removeItem(MIGRATED_KEY + '-pagos');
  } catch {}
  notify();
  return { asignaciones: borradas };
}

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
  teardownRealtime(); // por si cambió de usuario en el mismo navegador
  setupRefetch();
  await hydrate();
  setupRealtime();
}

export function teardownProduccionSync() {
  teardownRealtime();
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
    if (document.visibilityState === 'visible' && cloudReady()) {
      if (_inflight === 0) hydrate();
      else scheduleRealtimeRefetch(); // ocupado: reintentar apenas se libere
    }
  };
  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);
}

// ── Realtime: cambios de otros usuarios impactan al instante ─────────────────
// Escuchamos cambios en las tablas de Producción vía Supabase Realtime. La RLS
// se respeta (cada uno recibe solo los cambios de las filas que puede ver), así
// que un admin ve cuando el editor sube/mueve, y el editor ve cuando el admin
// aprueba/reasigna, sin refrescar. Ante cualquier cambio, re-fetch (debounced).
let _rtChannel = null;
let _rtTimer = null;
function scheduleRealtimeRefetch() {
  if (_rtTimer) clearTimeout(_rtTimer);
  _rtTimer = setTimeout(() => {
    _rtTimer = null;
    // El guard de hydrate (_writeSeq/_inflight) evita pisar un cambio propio en
    // vuelo; para cambios ajenos, trae lo nuevo.
    if (cloudReady() && _inflight === 0) hydrate().catch(() => {});
    else if (cloudReady()) scheduleRealtimeRefetch(); // ocupado: reintentar, no descartar
  }, 250);
}
function setupRealtime() {
  if (!supabase || _rtChannel || typeof window === 'undefined') return;
  try {
    _rtChannel = supabase
      .channel(`produccion-rt-${_userId || 'anon'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, scheduleRealtimeRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: PAGOS_TABLE }, scheduleRealtimeRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: PAGOS_CONFIG_TABLE }, scheduleRealtimeRefetch)
      .subscribe();
  } catch (e) { console.warn('[produccion] realtime setup:', e?.message || e); }
}
function teardownRealtime() {
  if (_rtTimer) { clearTimeout(_rtTimer); _rtTimer = null; }
  if (_rtChannel) { try { supabase.removeChannel(_rtChannel); } catch {} _rtChannel = null; }
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
// TODAS las tarjetas (todas las semanas). El tablero ya NO se parte por semana:
// muestra todo junto (el auto-archivo de lo publicado hace +48h lo mantiene
// limpio). La semana solo importa para el PAGO, que sigue agrupando por weekKey.
// Orden: semana más nueva primero, luego por nombre de producto.
export function listAllAssignments() {
  return read().slice().sort((a, b) =>
    (b.weekKey || '').localeCompare(a.weekKey || '') ||
    (a.productoNombre || '').localeCompare(b.productoNombre || '', 'es'));
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

// Busca el link de material de un producto en cualquier tarjeta existente del
// mismo producto (así el link es "por producto": se setea una vez y se reusa).
export function materialLinkDeProducto(productoId, productoNombre) {
  const pid = productoId != null ? String(productoId) : null;
  const nom = (productoNombre || '').trim().toLowerCase();
  for (const a of read()) {
    const match = pid != null ? String(a.productoId) === pid : (a.productoNombre || '').trim().toLowerCase() === nom;
    if (match && (a.materialLink || '').trim()) return a.materialLink.trim();
  }
  return '';
}

// Setea el link de material para TODAS las tarjetas de un producto (por eso es
// "por producto"): el admin lo pone una vez y queda en todas. Devuelve cuántas
// tarjetas tocó.
export function setMaterialLinkProducto(productoId, productoNombre, url) {
  const pid = productoId != null ? String(productoId) : null;
  const nom = (productoNombre || '').trim().toLowerCase();
  const link = (url || '').trim();
  let n = 0;
  for (const a of read()) {
    const match = pid != null ? String(a.productoId) === pid : (a.productoNombre || '').trim().toLowerCase() === nom;
    if (match && (a.materialLink || '') !== link) { updateAssignment(a.id, { materialLink: link }); n++; }
  }
  return n;
}

// ── Winners por producto ─────────────────────────────────────────────────────
// Un winner es un video que vendió, marcado como material de referencia. Se
// guarda por producto (copiado a todas sus tarjetas, como materialLink) para que
// el editor asignado lo vea. Identidad del winner: driveId, o link, o nombre.
const winnerKey = (w) => String(w?.driveId || w?.link || w?.name || '').trim().toLowerCase();
const mismoProducto = (a, productoId, productoNombre) => {
  const pid = productoId != null ? String(productoId) : null;
  return pid != null ? String(a.productoId) === pid
    : (a.productoNombre || '').trim().toLowerCase() === (productoNombre || '').trim().toLowerCase();
};

// Winners de un producto: unión (dedup) de los winners de todas sus tarjetas,
// más recientes primero.
export function winnersDeProducto(productoId, productoNombre) {
  const seen = new Set(); const out = [];
  for (const a of read()) {
    if (!mismoProducto(a, productoId, productoNombre)) continue;
    for (const w of (a.winners || [])) {
      const k = winnerKey(w);
      if (k && !seen.has(k)) { seen.add(k); out.push(w); }
    }
  }
  return out.sort((x, y) => (y.ts || 0) - (x.ts || 0));
}

// Escribe la lista de winners en TODAS las tarjetas del producto (así queda igual
// en cada una y la ve el editor). Devuelve cuántas tarjetas tocó.
export function setWinnersProducto(productoId, productoNombre, winners) {
  const arr = Array.isArray(winners) ? winners : [];
  const target = JSON.stringify(arr);
  let n = 0;
  for (const a of read()) {
    // Solo tocamos las tarjetas que REALMENTE cambian (evita bumpear updatedAt en
    // tarjetas sin cambios, que reiniciaría su reloj de auto-archivo, y evita un
    // storm de writes a la nube).
    if (mismoProducto(a, productoId, productoNombre) && JSON.stringify(a.winners || []) !== target) {
      updateAssignment(a.id, { winners: arr }); n++;
    }
  }
  return n;
}

// ── Referencias (reels de IG) por producto ──────────────────────────────────
// Las referencias son POR TARJETA, a diferencia de winners y materialLink.
//
// Arrancaron copiadas a todas las tarjetas del producto (patrón winners), y
// estaba mal: un reel de referencia es la consigna de UN video puntual. Si se
// pega en la tarjeta de Ponzio, es para que Ponzio replique ESE reel — no para
// que las otras tres tarjetas del mismo producto hereden una consigna que
// nadie les dio. La columna jsonb sigue igual (desnormalizada en la fila, que
// es lo que deja que el editor la lea con su RLS); lo que cambia es que se
// escribe en una sola fila.
//
// Shape: { id, url, shortcode, caption, owner, angle, hooks, guion,
//          notasEditor, hooksAlternativos, ts }.
const refKey = (r) => String(r?.id || r?.shortcode || r?.url || '').trim().toLowerCase();

export function referenciasDeTarjeta(cardId) {
  const a = read().find(x => x.id === cardId);
  return Array.isArray(a?.referencias) ? a.referencias : [];
}

// Agrega (o actualiza, si ya estaba) una referencia en UNA tarjeta.
// Devuelve true si quedó agregada, false si ya estaba igual.
export function addReferenciaATarjeta(cardId, ref) {
  const k = refKey(ref);
  if (!k || !cardId) return false;
  const actuales = referenciasDeTarjeta(cardId);
  const nuevas = [{ ...ref, ts: ref.ts || Date.now() }, ...actuales.filter(r => refKey(r) !== k)];
  if (JSON.stringify(nuevas) === JSON.stringify(actuales)) return false;
  updateAssignment(cardId, { referencias: nuevas });
  return true;
}

export function removeReferenciaDeTarjeta(cardId, refOrId) {
  const k = typeof refOrId === 'string' ? refOrId.trim().toLowerCase() : refKey(refOrId);
  const actuales = referenciasDeTarjeta(cardId);
  const nuevas = actuales.filter(r => refKey(r) !== k);
  if (nuevas.length === actuales.length) return false;
  updateAssignment(cardId, { referencias: nuevas });
  return true;
}

// Tarjetas del tablero para el picker "enviar a tarjeta" de Marketing →
// Referencias. Antes se elegía un PRODUCTO y la referencia caía en todas sus
// tarjetas; ahora se elige la tarjeta, que es la unidad real de trabajo.
// Se ordenan por semana descendente: lo que se está produciendo ahora primero.
export function tarjetasParaReferencia() {
  return read()
    .filter(a => a.estado !== 'archivado')
    .map(a => ({
      id: a.id,
      productoNombre: a.productoNombre || '(sin producto)',
      persona: a.persona || '',
      weekKey: a.weekKey,
      estado: a.estado,
      referencias: (a.referencias || []).length,
    }))
    .sort((x, y) => String(y.weekKey || '').localeCompare(String(x.weekKey || ''))
      || (x.productoNombre || '').localeCompare(y.productoNombre || '', 'es')
      || (x.persona || '').localeCompare(y.persona || '', 'es'));
}

// Productos únicos presentes en el tablero (para el picker "enviar a tarjeta").
export function productosEnTablero() {
  const seen = new Map();
  for (const a of read()) {
    const key = a.productoId != null ? `id:${a.productoId}` : `nom:${(a.productoNombre || '').trim().toLowerCase()}`;
    if (!a.productoNombre && a.productoId == null) continue;
    if (!seen.has(key)) seen.set(key, { productoId: a.productoId, productoNombre: a.productoNombre || '', tarjetas: 0 });
    seen.get(key).tarjetas++;
  }
  return [...seen.values()].sort((x, y) => (x.productoNombre || '').localeCompare(y.productoNombre || ''));
}

export function esWinner(rec, productoId, productoNombre) {
  const k = winnerKey(rec);
  return winnersDeProducto(productoId, productoNombre).some(w => winnerKey(w) === k);
}

// Aplica una lista de winners a todas las tarjetas del producto SOLO en el
// cache local (sin push por tarjeta): la usa el camino atómico, donde el server
// ya escribió por la RPC y acá solo reflejamos.
function aplicarWinnersLocal(productoId, productoNombre, winners) {
  const lista = Array.isArray(winners) ? winners : [];
  const target = JSON.stringify(lista);
  const arr = read().slice();
  let cambio = false;
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (mismoProducto(a, productoId, productoNombre) && JSON.stringify(a.winners || []) !== target) {
      arr[i] = { ...a, winners: lista, updatedAt: new Date().toISOString() };
      cambio = true;
    }
  }
  if (cambio) write(arr);
}

// Marca/desmarca un video como winner del producto. `rec` = { name, link,
// driveId, fecha, ts }. Devuelve el nuevo estado (true = quedó marcado).
//
// Con nube: viaja por la RPC produccion_winners_apply (auditoría #3), que
// RE-LEE los winners actuales del producto con lock y mergea el delta — dos
// sesiones (o el cron de auto-winners) marcando a la vez ya no se pisan el
// array entero. Sin nube o sin la RPC, camino viejo (columna por tarjeta).
export function toggleWinner(rec, productoId, productoNombre) {
  const k = winnerKey(rec);
  const actuales = winnersDeProducto(productoId, productoNombre);
  const estaba = actuales.some(w => winnerKey(w) === k);
  const nuevoRec = { name: rec.name || 'video', link: rec.link || null, driveId: rec.driveId || null, fecha: rec.fecha || '', ts: rec.ts || 0 };
  const nuevos = estaba
    ? actuales.filter(w => winnerKey(w) !== k)
    : [nuevoRec, ...actuales];
  if (cloudReady() && _role === 'admin' && _winnersRpc !== false) {
    // Optimista: reflejo local ya, el server mergea atómico y reconciliamos.
    aplicarWinnersLocal(productoId, productoNombre, nuevos);
    supabase.rpc('produccion_winners_apply', {
      p_producto_id: productoId != null ? String(productoId) : null,
      p_producto_nombre: productoNombre || '',
      p_add: estaba ? [] : [nuevoRec],
      p_remove: estaba ? [k] : [],
    }).then(({ data, error }) => {
      if (error) {
        if (esRpcInexistente(error)) _winnersRpc = false;
        else console.warn('[produccion] winners rpc:', error.message);
        // Fallback: el camino viejo (columna winners por tarjeta, con push).
        setWinnersProducto(productoId, productoNombre, nuevos);
      } else if (Array.isArray(data)) {
        // Reconciliar con el merge REAL del server (pudo traer winners de otra
        // sesión que no teníamos).
        aplicarWinnersLocal(productoId, productoNombre, data);
      }
    });
  } else {
    setWinnersProducto(productoId, productoNombre, nuevos);
  }
  return !estaba;
}

export function addAssignment({ weekKey, productoId, productoNombre, persona, creatorId = null, tipo = 'renovado', brief = '', materialLink = '' }) {
  const per = (persona || '').trim();
  // persona es opcional: una tarjeta puede quedar "sin asignar" hasta que se le
  // cuelgue la persona (como en Trello, agregás el label después).
  if (!weekKey) return null;
  const arr = read().slice();
  // El link de material es por producto: si no lo pasan, lo heredamos de otra
  // tarjeta del mismo producto. Los winners también son por producto → los
  // heredamos, así una tarjeta nueva de Cepillo ya trae sus winners de referencia.
  //
  // Las referencias NO se heredan: son de la tarjeta. Una tarjeta nueva nace
  // sin reels y se le pegan los que correspondan a ese video.
  const material = (materialLink || '').trim() || materialLinkDeProducto(productoId, productoNombre);
  const winnersHeredados = winnersDeProducto(productoId, productoNombre);
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
    materialLink: material,
    winners: winnersHeredados,
    referencias: [],
    pagado: false,
    archivos: [],
    historial: [nuevoEvento('creacion')],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  arr.push(nueva);
  write(arr);
  markCreated(nueva.id, true); // insert pendiente: solo lo creado acá puede re-insertarse
  pushRow(nueva.id);
  // Aviso de "producto nuevo" (canal 1). Fire & forget; el server decide.
  notificarEventoDiscord(nueva, 'nuevo');
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
  // CONSISTENCIA TABLERO ↔ TARJETA: pasar la tarjeta a Aprobado/Publicado —
  // arrastrándola o con cualquier botón — aprueba TODO su contenido. Sin esto,
  // un pase manual "desde afuera" dejaba la tarjeta en la columna Aprobado
  // diciendo "0/9 aprob." adentro (le pasó al user). Marcar el ✓ de cada video
  // limpia además su corrección pendiente (aprobar gana), igual que
  // setAprobadoVideo. La vuelta atrás (Aprobado → Revisión) NO desaprueba
  // nada: eso es información real que el revisor puede querer conservar.
  let archivosAprobados = null;
  const aprobadosNuevos = []; // para el delta de archivos (solo los que cambian)
  const pasaACompleto = patch.estado && patch.estado !== before.estado
    && (patch.estado === 'aprobado' || patch.estado === 'publicado');
  if (pasaACompleto && (before.archivos || []).some(f => !f.aprobado)) {
    archivosAprobados = (before.archivos || []).map(f => {
      if (f.aprobado) return f;
      const { correccion, ...rest } = f;
      const nuevo = { ...rest, aprobado: { por: _actorName || 'Equipo', ts: new Date().toISOString() } };
      aprobadosNuevos.push(nuevo);
      return nuevo;
    });
  }
  arr[i] = {
    ...before, ...patch, historial,
    ...(archivosAprobados ? { archivos: archivosAprobados, videosAprobados: archivosAprobados.length } : {}),
    updatedAt: new Date().toISOString(),
  };
  write(arr);
  // Push con PATCH: viajan solo las columnas que este cambio tocó (más
  // archivos/aprobados cuando el pase a Aprobado marcó los ✓).
  if (aprobadosNuevos.length) noteArchivoOps(id, { up: aprobadosNuevos });
  pushRow(id, evento, {
    patch: {
      ...patch,
      ...(archivosAprobados ? { archivos: 1, videosAprobados: 1 } : {}),
    },
  });
  // Aviso a Discord del cambio de columna (fire & forget). Lo dispara quien hizo
  // el cambio (admin o editor); el server decide si hay webhook y si el estado
  // se notifica. Nunca frena la UI ni rompe si falla.
  if (patch.estado && patch.estado !== before.estado) notificarEventoDiscord(arr[i], patch.estado, before.estado);
  // Si la tarjeta cruzó el borde de "publicado", reflejamos el estado en el
  // nombre de su carpeta de Drive (le agrega/saca "— PUBLICADO"). Solo el dueño.
  if (patch.estado && patch.estado !== before.estado && _role === 'admin') {
    const esPub = patch.estado === 'publicado';
    if ((before.estado === 'publicado') !== esPub) {
      const folderId = (before.archivos || []).find(f => f.folderId)?.folderId;
      if (folderId) renombrarPublicado(folderId, esPub);
    }
  }
}

// Renombra la carpeta de Drive de una tarjeta para reflejar "publicado" (fire &
// forget; si Drive no está o falla, no rompe nada).
async function renombrarPublicado(folderId, published) {
  if (!supabase) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const t = session?.access_token;
    await fetch('/api/produccion/drive-rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify({ folderId, published }),
    });
  } catch (e) { console.warn('[produccion] rename folder:', e?.message || e); }
}

// Avisa a Discord un EVENTO de la tarjeta (fire & forget). `event` puede ser
// 'nuevo' (producto recién creado) o un estado ('revision'|'aprobado'|
// 'publicado'). El server decide, según la config del dueño, a qué canal
// (webhook) manda y a quién menciona. Acá solo pasamos el contexto.
async function notificarEventoDiscord(a, event, from, extra = {}) {
  if (!supabase) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const t = session?.access_token;
    await fetch('/api/produccion/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify({
        event,
        cardId: a.id,
        productoNombre: a.productoNombre || '',
        persona: a.persona || '',
        from: from || '',
        to: event === 'nuevo' ? '' : event,
        actor: _actorName || '',
        // Link DIRECTO a la tarjeta en AdsLab (abre esa tarjeta puntual, no el
        // tablero entero) → para que el editor sepa exactamente cuál es.
        cardUrl: (typeof window !== 'undefined' && a.id) ? `${window.location.origin}/?prod=${encodeURIComponent(a.id)}` : '',
        // Semana de la tarjeta, como contexto extra en el aviso.
        weekKey: a.weekKey || '',
        // Detalle opcional (ej: el texto de la corrección pedida).
        ...(extra && extra.detalle ? { detalle: String(extra.detalle) } : {}),
        // Link a la carpeta de Drive de la tarjeta (donde están los videos), para
        // entrar directo desde Discord. Puede no existir si no se subió nada.
        folderLink: (a.archivos || []).find(f => f.folderLink)?.folderLink || '',
      }),
    });
  } catch (e) { console.warn('[produccion] notify:', e?.message || e); }
}

// Config de notificaciones de Discord del dueño (qué estados avisan + a quién
// mencionar). Vive en produccion_notif_config (RLS por dueño).
const NOTIF_CONFIG_TABLE = 'produccion_notif_config';
export async function loadNotifConfig() {
  if (!cloudReady() || !_userId) return null;
  try {
    const { data } = await supabase.from(NOTIF_CONFIG_TABLE).select('config').eq('owner_id', _userId).maybeSingle();
    return data?.config || null;
  } catch { return null; }
}
export async function saveNotifConfig(config) {
  if (!cloudReady() || !_userId) return { error: 'Iniciá sesión de nuevo.' };
  try {
    const { error } = await supabase.from(NOTIF_CONFIG_TABLE)
      .upsert({ owner_id: _userId, config, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
    return { error: error?.message || null };
  } catch (e) { return { error: e?.message || String(e) }; }
}

// Manda un mensaje de PRUEBA a Discord. `webhooks` = URLs a probar (las que están
// cargadas en el modal, aunque no se hayan guardado). Devuelve el JSON del server:
// { sent, total, errors? } | { sent:false, reason } | { sent:false, error }.
export async function probarDiscord(webhooks) {
  if (!supabase) return { sent: false, reason: 'sin-supabase' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const t = session?.access_token;
    const r = await fetch('/api/produccion/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify({ probe: true, webhooks: Array.isArray(webhooks) ? webhooks : [] }),
    });
    return await r.json().catch(() => ({ sent: false, reason: 'respuesta-invalida' }));
  } catch (e) { return { sent: false, error: e?.message || String(e) }; }
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
  // Comparación NORMALIZADA (trim + lowercase) para persona y nombre de producto:
  // así "Cepillo" y "cepillo " no crean una segunda tarjeta del mismo producto
  // (lo que duplicaría el conteo de pago).
  const perN = per.toLowerCase();
  const nomN = (productoNombre || '').trim().toLowerCase();
  const found = arr.find(a =>
    a.weekKey === weekKey &&
    (a.persona || '').trim().toLowerCase() === perN &&
    (pid != null
      ? String(a.productoId) === pid
      : (a.productoNombre || '').trim().toLowerCase() === nomN));
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
  noteArchivoOps(id, { up: archivos });
  pushRow(id, null, { patch: { archivos: 1 } });
  return arr[i];
}

// Reapunta TODOS los archivos de Drive de una tarjeta a una carpeta nueva.
// Lo usa la reparación de carpetas: después de mover los videos en Drive hay
// que dejar registrado el folderId nuevo, si no la próxima subida vuelve a la
// carpeta compartida vieja (que es la que la tarjeta tenía anotada).
export function setArchivosFolder(id, { folderId, folderLink }) {
  if (!folderId) return;
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  const archivos = (arr[i].archivos || []).map(f =>
    f.destino === 'drive' ? { ...f, folderId, folderLink: folderLink || f.folderLink } : f);
  arr[i] = { ...arr[i], archivos, updatedAt: new Date().toISOString() };
  write(arr);
  noteArchivoOps(id, { up: archivos.filter(f => f.destino === 'drive') });
  pushRow(id, null, { patch: { archivos: 1 } });
  return arr[i];
}

// Reemplaza UN archivo de la tarjeta (por su ts) por otro, EN SU LUGAR — el
// video conserva su número (Video 1/2/3…) en la lista. Lo usa el flujo
// "Reemplazar" de correcciones: el archivo nuevo entra sin `correccion`, así
// que el pedido de corrección del viejo queda saldado en el mismo acto.
export function replaceArchivo(id, ts, archivo) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  // Si el reemplazo viene marcado como corrección cumplida (f.corregido), le
  // estampamos QUIÉN la hizo — el actor lo conoce el store, no el uploader.
  const conActor = archivo?.corregido && !archivo.corregido.por
    ? { ...archivo, corregido: { ...archivo.corregido, por: _actorName || 'Equipo' } }
    : archivo;
  arr[i] = {
    ...arr[i],
    archivos: (arr[i].archivos || []).map(f => (f.ts === ts ? conActor : f)),
    updatedAt: new Date().toISOString(),
  };
  write(arr);
  // Delta: si el archivo nuevo tiene OTRO ts, viaja con _replaces para que el
  // server lo ponga en el lugar del viejo (conserva el número de video).
  noteArchivoOps(id, { up: [conActor?.ts && conActor.ts !== ts ? { ...conActor, _replaces: ts } : conActor] });
  pushRow(id, null, { patch: { archivos: 1 } });
}

// Aprobación POR VIDEO (la marca el revisor con el ✓ de cada fila). Al
// aprobar se limpia cualquier corrección pendiente de ese video (aprobar
// gana). El contador a.videosAprobados se DERIVA de estas marcas — es el
// mismo campo numérico de siempre (videos_aprobados en la DB), así que los
// bonos y resúmenes que lo leen siguen funcionando sin tocarse.
export function setAprobadoVideo(id, ts, on) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  const archivos = (arr[i].archivos || []).map(f => {
    if (f.ts !== ts) return f;
    if (on) {
      const { correccion, ...rest } = f;
      return { ...rest, aprobado: { por: _actorName || 'Equipo', ts: new Date().toISOString() } };
    }
    const { aprobado, ...rest } = f;
    return rest;
  });
  arr[i] = {
    ...arr[i],
    archivos,
    videosAprobados: archivos.filter(f => f.aprobado).length,
    updatedAt: new Date().toISOString(),
  };
  write(arr);
  const mod = archivos.find(f => f.ts === ts);
  if (mod) noteArchivoOps(id, { up: [mod] });
  pushRow(id, null, { patch: { archivos: 1, videosAprobados: 1 } });
}

// Marca TODOS los videos subidos como aprobados (botón "Aprobar todos").
// No toca el estado de la tarjeta — eso lo decide el caller vía
// updateAssignment (que además dispara el aviso de Discord del cambio).
export function aprobarTodosVideos(id) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  const cambiados = [];
  const archivos = (arr[i].archivos || []).map(f => {
    if (f.aprobado) return f;
    const { correccion, ...rest } = f;
    const nuevo = { ...rest, aprobado: { por: _actorName || 'Equipo', ts: new Date().toISOString() } };
    cambiados.push(nuevo);
    return nuevo;
  });
  arr[i] = {
    ...arr[i],
    archivos,
    videosAprobados: archivos.length,
    updatedAt: new Date().toISOString(),
  };
  write(arr);
  if (cambiados.length) noteArchivoOps(id, { up: cambiados });
  pushRow(id, null, { patch: { archivos: 1, videosAprobados: 1 } });
}

// Saca la marca verde "Corregido" de un video (la usa quien revisa con el
// botón "Visto"). La marca también deja de mostrarse sola al aprobar la
// tarjeta — esto es para limpiarla antes si el revisor ya lo chequeó.
export function clearCorregidoVideo(id, ts) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  arr[i] = {
    ...arr[i],
    archivos: (arr[i].archivos || []).map(f => {
      if (f.ts !== ts || !f.corregido) return f;
      const { corregido, ...rest } = f;
      return rest;
    }),
    updatedAt: new Date().toISOString(),
  };
  write(arr);
  const visto = (arr[i].archivos || []).find(f => f.ts === ts);
  if (visto) noteArchivoOps(id, { up: [visto] });
  pushRow(id, null, { patch: { archivos: 1 } });
}

// Publicación POR VIDEO (pedido del user): al salir como anuncio en Meta,
// cada video queda marcado con publicadoAd (fecha ISO). El Publicador los
// oculta por defecto; la tarjeta recién pasa a Publicado cuando no le queda
// ningún video publicable sin marcar.
export function marcarVideosPublicados(id, tsList) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return { completo: false, marcados: 0, estado: null };
  const setTs = new Set((tsList || []).map(String));
  const nuevos = [];
  const archivos = (arr[i].archivos || []).map(f => {
    if (!setTs.has(String(f.ts)) || f.publicadoAd) return f;
    const nuevo = { ...f, publicadoAd: new Date().toISOString() };
    nuevos.push(nuevo);
    return nuevo;
  });
  if (nuevos.length === 0) {
    const pub = (arr[i].archivos || []).filter(f => f.driveId || f.storagePath);
    return { completo: pub.length > 0 && pub.every(f => f.publicadoAd), marcados: 0, estado: arr[i].estado };
  }
  arr[i] = { ...arr[i], archivos, updatedAt: new Date().toISOString() };
  write(arr);
  noteArchivoOps(id, { up: nuevos });
  pushRow(id, null, { patch: { archivos: 1 } });
  const publicables = archivos.filter(f => f.driveId || f.storagePath);
  const completo = publicables.length > 0 && publicables.every(f => f.publicadoAd);
  return { completo, marcados: nuevos.length, estado: arr[i].estado };
}

export function removeArchivo(id, ts) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  arr[i] = { ...arr[i], archivos: (arr[i].archivos || []).filter(f => f.ts !== ts), updatedAt: new Date().toISOString() };
  write(arr);
  noteArchivoOps(id, { rm: [ts] });
  pushRow(id, null, { patch: { archivos: 1 } });
}

// Pide (o limpia) una corrección sobre un VIDEO puntual (por su ts). La
// corrección viaja DENTRO del archivo (f.correccion = { texto, por, ts }) para
// que se sincronice como el resto de los videos (pushRow completo, sin
// skipArchivos). texto vacío/blanco = limpiar la corrección de ese video.
export function setCorreccionVideo(id, ts, texto) {
  const arr = read().slice();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  const txt = (texto || '').trim();
  const archivos = (arr[i].archivos || []).map(f => {
    if (f.ts !== ts) return f;
    if (!txt) { const { correccion, ...rest } = f; return rest; }
    return { ...f, correccion: { texto: txt, por: _actorName || 'Equipo', ts: new Date().toISOString() } };
  });
  // Si se pide una corrección sobre una tarjeta YA terminada (aprobada/publicada/
  // archivada), la REABRIMOS a "Por hacer" para que caiga en la cola del editor
  // (antes quedaba enterrada en su columna con un badge y "no aparecía").
  const reabrir = !!txt && ['aprobado', 'publicado', 'archivado'].includes(arr[i].estado);
  arr[i] = { ...arr[i], archivos, ...(reabrir ? { estado: 'porhacer' } : {}), updatedAt: new Date().toISOString() };
  write(arr);
  const tocado = archivos.find(f => f.ts === ts);
  if (tocado) noteArchivoOps(id, { up: [tocado] });
  pushRow(id, null, { patch: { archivos: 1, ...(reabrir ? { estado: 1 } : {}) } });
  // Aviso a Discord (canal 'correccion'): antes pedir una corrección era 100%
  // silencioso. Solo cuando se SETEA (no al limpiar). Fire & forget; el server
  // decide si hay webhook y a quién menciona.
  if (txt) notificarEventoDiscord(arr[i], 'correccion', null, { detalle: txt });
}

// ── Config de pago POR PERSONA (monto por producto + tramos de bono) ─────────
// Sin config para una persona → se usan los defaults globales (PAGO_POR_PRODUCTO
// + bonusObjetivo). El dueño la edita en "Equipo"; se guarda en la tabla
// produccion_pago_config (RLS por dueño; el editor solo lee la suya por creatorId).
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

// Monto y bono de una persona = la lógica pura (produccionCalc) aplicada a SU
// config guardada (o los defaults si no configuró).
export function pagoProductoDe(persona) { return pagoProductoDeCfg(_pagoConfig[cfgKey(persona)]); }
export function bonusDe(persona, completados) { return bonusDeCfg(_pagoConfig[cfgKey(persona)], completados); }
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

// resumenVideosPorProducto vive ahora en produccionCalc.js (importado y
// re-exportado arriba), para que la app y los tests usen el mismo código.

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

// Mes (horario AR) → 'YYYY-MM'. Una semana pertenece al mes de su DOMINGO —
// el día que se ENTREGA (ver monthOfWeek en produccionCalc.js). Ojo: para
// "el mes actual" igual usamos la fecha de HOY: si hoy cae en una semana que
// entrega el mes que viene, esa semana ya aparece bajo el mes que viene.
export function monthKeyOf(date = new Date()) {
  // El "mes actual" sigue a la SEMANA en curso (que pertenece al mes de su
  // domingo de entrega). Ej: sábado 6/9 → semana del lunes 31/8 → entrega el
  // domingo 6/9 → mes actual = septiembre. Así el selector por defecto
  // siempre muestra la semana que se está trabajando.
  return monthOfWeek(weekKeyOf(date)) || date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function monthLabel(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}
export function allMonthKeys() {
  const set = new Set(read().map(a => monthOfWeek(a.weekKey)).filter(Boolean));
  return [...set].sort().reverse();
}
export function weeksInMonth(monthKey) {
  return [...new Set(read().filter(a => monthOfWeek(a.weekKey) === monthKey).map(a => a.weekKey))].sort();
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
