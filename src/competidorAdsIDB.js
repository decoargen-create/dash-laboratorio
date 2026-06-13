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

const DB_NAME = 'adslab-competidor-ads-v1';
const DB_VERSION = 1;
const STORE = 'ads';

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
// cada setCompAds.
const memCache = new Map();

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
    return true;
  } catch (err) {
    console.warn('[competidorAdsIDB] set falló:', err.message);
    return false;
  }
}

export async function getCompAds(productoId, competidorId) {
  if (!productoId || !competidorId) return null;
  const key = makeKey(productoId, competidorId);
  if (memCache.has(key)) return memCache.get(key);
  try {
    const db = await openDB();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (record) memCache.set(key, record);
    return record;
  } catch (err) {
    console.warn('[competidorAdsIDB] get falló:', err.message);
    return null;
  }
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
    return true;
  } catch { return false; }
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
    if (Array.isArray(c.ads) && c.ads.length > 0) return c; // legacy inline
    const rec = await getCompAds(productoId, c.id);
    return { ...c, ads: rec?.ads || [] };
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
