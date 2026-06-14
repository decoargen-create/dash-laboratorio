// Almacén local de ads scrapeados por competidor — IndexedDB.
//
// POR QUÉ EXISTE:
// Antes los ads de cada competidor vivían adentro de
// `producto.competidores[i].ads` (array de objetos con body, headlines, URLs,
// platforms, etc.). Con 3-5 competidores × 200 ads × ~5KB cada uno → ~5MB ya
// solo en ads. localStorage cap es 5-10MB total → el blob de productos
// reventaba quota en cuanto el user agregaba un producto más.
//
// Ahora: localStorage SOLO tiene metadata por competidor (adsTotal,
// winnersCount, lastAdsCheck, consecutiveZeroAds). Los ads viven en este
// store IDB con key = `<productoId>:<competidorId>` y un objeto
// `{ ads, ts, total, winners }`. Sin límite práctico de tamaño.
//
// API minimalista para hacer el refactor reversible:
//   setCompAds(productoId, competidorId, payload)
//   getCompAds(productoId, competidorId) → payload | null
//   getCompAdsCount(productoId, competidorId)
//   removeCompAds(productoId, competidorId)
//   removeAllForProducto(productoId)
//   migrateFromInlineAds(producto) — moverá ads inline de un producto legacy
//                                    al IDB, devolviendo el producto stripped.
//
// SHAPE persistido:
//   { ads: [...], total: N, winners: M, lastAdsCheck: ISO, ts: epoch }

import { supabase, getCurrentUser } from './supabase.js';
import { logEvent } from './debugLog.js';

const DB_NAME = 'adslab-competidor-ads-v1';
const DB_VERSION = 1;
const STORE = 'ads';
const BUCKET = 'creativos';

// Path en Supabase Storage para los ads de un (producto, competidor).
// El uid VA PRIMERO — la policy RLS exige foldername[1] = auth.uid().
function cloudPath(uid, productoId, competidorId) {
  return `${uid}/competitor-ads/${String(productoId)}-${String(competidorId)}.json`;
}

// Sube el payload de ads al bucket — best effort. Sin esto los ads viven solo
// en IDB local y la otra PC no los ve hasta re-scrapear.
async function uploadAdsToCloud(productoId, competidorId, payload) {
  if (!supabase) return null;
  try {
    const user = await getCurrentUser();
    if (!user) {
      logEvent({ kind: 'fetch-error', label: '[comp-ads] sin auth — no se sube al cloud', meta: { productoId, competidorId } });
      return null;
    }
    const path = cloudPath(user.id, productoId, competidorId);
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: 'application/json', upsert: true });
    if (error) {
      console.warn('[competidorAdsIDB] cloud upload falló:', error.message);
      // SILENT FAIL FIX: antes el error se tiraba a la basura y el caller
      // creía que estaba sincronizado. Ahora queda en el debugLog para que
      // el user pueda exportar y mostrarme exactamente qué falló.
      logEvent({
        kind: 'fetch-error',
        label: `[comp-ads] upload falló: ${error.message}`,
        meta: { productoId, competidorId, path, errorMsg: error.message, sizeBytes: blob.size },
      });
      return null;
    }
    return path;
  } catch (err) {
    console.warn('[competidorAdsIDB] cloud upload error:', err.message);
    logEvent({ kind: 'fetch-error', label: `[comp-ads] upload exception: ${err.message}`, meta: { productoId, competidorId } });
    return null;
  }
}

// Baja el payload del cloud — usado cuando IDB no tiene nada pero la
// metadata del producto dice que hubo un scrape (cross-PC).
async function downloadAdsFromCloud(productoId, competidorId) {
  if (!supabase) return null;
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const path = cloudPath(user.id, productoId, competidorId);
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    const text = await data.text();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (parseErr) {
      logEvent({ kind: 'fetch-error', label: `[comp-ads] cloud JSON corrupto`, meta: { productoId, competidorId, error: parseErr.message } });
      return null;
    }
    // SHAPE VALIDATION: archivos corruptos NO se cachean en IDB.
    if (!parsed || !Array.isArray(parsed.ads)) {
      logEvent({ kind: 'fetch-error', label: `[comp-ads] cloud shape inválido`, meta: { productoId, competidorId, hasAds: !!parsed?.ads } });
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[competidorAdsIDB] cloud download falló:', err.message);
    return null;
  }
}

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('productoId', 'productoId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function makeKey(productoId, competidorId) {
  return `${String(productoId)}:${String(competidorId)}`;
}

// Cache en memoria — para no martillar IDB en cada render. Se invalida en
// cada setCompAds Y cuando otro componente/tab emite el evento de cambio.
const memCache = new Map();

// Export para que logout pueda limpiarlo + cerrar la conexión IDB. Sin esto,
// user B logueando en la misma PC heredaba ads del memCache de user A.
export function _resetForLogout() {
  memCache.clear();
  if (dbPromise) {
    dbPromise.then(db => { try { db.close(); } catch {} }).catch(() => {});
    dbPromise = null;
  }
  if (_compAdsChannel) { try { _compAdsChannel.close(); } catch {} _compAdsChannel = null; }
}

// CROSS-COMPONENT INVALIDATION: cuando otra parte de la app llama setCompAds
// el evento se emite pero el memCache de OTROS módulos seguía sirviendo el
// valor viejo. Acá lo limpiamos para que la próxima getCompAds vuelva a IDB.
if (typeof window !== 'undefined') {
  window.addEventListener('adslab:comp-ads-changed', (e) => {
    try {
      const { productoId, competidorId } = e.detail || {};
      if (productoId && competidorId) {
        memCache.delete(makeKey(productoId, competidorId));
      }
    } catch {}
  });
}

// CROSS-TAB SYNC: window events solo se entregan dentro de la MISMA tab. Si
// el user scrapea en tab A, la tab B no ve los nuevos ads hasta que refresca
// (IDB sí está sincronizado, pero el memCache de tab B sirve el valor viejo).
// BroadcastChannel propaga el evento entre tabs del mismo origen → tab B
// limpia su memCache y la próxima getCompAds() lee fresco de IDB.
let _compAdsChannel = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    _compAdsChannel = new BroadcastChannel('viora-comp-ads');
    _compAdsChannel.onmessage = (e) => {
      try {
        const { productoId, competidorId } = e.data || {};
        if (productoId && competidorId) {
          memCache.delete(makeKey(productoId, competidorId));
          // Re-dispatch como CustomEvent local para que los componentes
          // suscritos al evento window (sin BC) también se enteren.
          try {
            window.dispatchEvent(new CustomEvent('adslab:comp-ads-changed', {
              detail: { productoId, competidorId, total: e.data?.total },
            }));
          } catch {}
        }
      } catch {}
    };
  } catch {}
}

export async function setCompAds(productoId, competidorId, payload) {
  if (!productoId || !competidorId) return false;
  const key = makeKey(productoId, competidorId);
  const record = {
    key,
    productoId: String(productoId),
    competidorId: String(competidorId),
    ads: payload.ads || [],
    total: payload.total ?? (payload.ads?.length || 0),
    winners: payload.winners ?? 0,
    lastAdsCheck: payload.lastAdsCheck || new Date().toISOString(),
    ts: Date.now(),
  };
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    memCache.set(key, record);
    // Notificar UI que hay ads nuevos para este (producto, competidor).
    try {
      window.dispatchEvent(new CustomEvent('adslab:comp-ads-changed', {
        detail: { productoId: String(productoId), competidorId: String(competidorId), total: record.total },
      }));
    } catch {}
    // CROSS-TAB SYNC: propagamos a las demás tabs via BroadcastChannel para que
    // sus memCaches se invaliden — si no, la otra tab sigue sirviendo el valor
    // viejo hasta un hard refresh.
    try {
      _compAdsChannel?.postMessage({
        type: 'comp-ads-updated',
        productoId: String(productoId),
        competidorId: String(competidorId),
        total: record.total,
      });
    } catch {}
    // Sync al cloud en background (best effort). Sin esto, los ads viven solo
    // local y la otra PC tiene que re-scrapear para verlos. Con el upload,
    // PC2 los baja on-demand cuando getCompAds() no encuentra en IDB.
    uploadAdsToCloud(productoId, competidorId, record).catch(() => {});
    return true;
  } catch (err) {
    console.warn('[competidorAdsIDB] set falló:', err.message);
    return false;
  }
}

export async function getCompAds(productoId, competidorId, opts = {}) {
  const { skipCloud = false } = opts;
  if (!productoId || !competidorId) return null;
  const key = makeKey(productoId, competidorId);
  if (memCache.has(key)) return memCache.get(key);
  // 1) Intentar IDB
  try {
    const db = await openDB();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (record) { memCache.set(key, record); return record; }
  } catch (err) {
    console.warn('[competidorAdsIDB] get IDB falló:', err.message);
  }
  // PERFORMANCE: si el caller no quiere cloud fallback (ej: scrape pipeline
  // que solo necesita "los ads previos para diff"), salir aca. Sin esto, la
  // primera vez que un producto se scrapea, getCompAds tira N llamadas al
  // cloud (1-3s cada una) bloqueando la UI.
  if (skipCloud) return null;
  // 2) Fallback al cloud — caso "entré desde otra PC". Bajamos del bucket
  // y cacheamos local para próximas lecturas.
  const cloudRec = await downloadAdsFromCloud(productoId, competidorId);
  if (cloudRec && Array.isArray(cloudRec.ads)) {
    try {
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ ...cloudRec, key, productoId: String(productoId), competidorId: String(competidorId) });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
    memCache.set(key, cloudRec);
    return cloudRec;
  }
  return null;
}

export async function getCompAdsCount(productoId, competidorId) {
  const rec = await getCompAds(productoId, competidorId);
  return rec?.total || rec?.ads?.length || 0;
}

export async function removeCompAds(productoId, competidorId) {
  if (!productoId || !competidorId) return false;
  const key = makeKey(productoId, competidorId);
  memCache.delete(key);
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
  // Borrar también del cloud para no dejar archivos huérfanos consumiendo
  // bucket. Best effort — si falla no es crítico.
  if (supabase) {
    try {
      const user = await getCurrentUser();
      if (user) {
        const path = cloudPath(user.id, productoId, competidorId);
        await supabase.storage.from(BUCKET).remove([path]);
      }
    } catch {}
  }
  return true;
}

export async function removeAllForProducto(productoId) {
  if (!productoId) return 0;
  let removed = 0;
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const idx = tx.objectStore(STORE).index('productoId');
      const req = idx.openCursor(IDBKeyRange.only(String(productoId)));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          memCache.delete(cursor.value.key);
          cursor.delete();
          removed++;
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
  return removed;
}

// Hidrata el array `ads` en cada competidor desde IDB. Devuelve un nuevo
// array de competidores con `ads` poblado. Si IDB no tiene nada para un
// (producto, competidor), respeta `c.ads` legacy inline si existe (sino [] ).
// Útil en pipelines/handlers que iteran ads sin tener UI state.
export async function hydrateCompetidoresAds(competidores, productoId) {
  if (!Array.isArray(competidores) || !productoId) return competidores || [];
  return await Promise.all(competidores.map(async (c) => {
    // PRIORITY: IDB primero (datos frescos), inline legacy SOLO si IDB vacía.
    // Antes priorizábamos inline si existía, lo que dejaba productos
    // parcialmente migrados leyendo 5 ads viejos en vez de 50 nuevos en IDB.
    const rec = await getCompAds(productoId, c.id);
    if (rec?.ads?.length) return { ...c, ads: rec.ads };
    if (Array.isArray(c.ads) && c.ads.length > 0) return c;
    return { ...c, ads: [] };
  }));
}

// Migración lazy: detecta ads inline en producto.competidores[].ads, los
// mueve a IDB, y devuelve el producto con los ads stripped (solo metadata).
// Idempotente — si ya migró, devuelve el mismo producto sin cambios.
export async function migrateFromInlineAds(producto) {
  if (!producto?.id || !Array.isArray(producto.competidores)) return producto;
  let migrated = false;
  const newComps = await Promise.all(producto.competidores.map(async (c) => {
    if (!Array.isArray(c.ads) || c.ads.length === 0) return c;
    // Hay ads inline — mover a IDB.
    await setCompAds(producto.id, c.id, {
      ads: c.ads,
      total: c.adsTotal ?? c.ads.length,
      winners: c.winnersCount ?? 0,
      lastAdsCheck: c.lastAdsCheck,
    });
    migrated = true;
    const { ads, ...meta } = c;
    return { ...meta, adsTotal: c.adsTotal ?? c.ads.length };
  }));
  return migrated ? { ...producto, competidores: newComps } : producto;
}
