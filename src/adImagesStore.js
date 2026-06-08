// Cache local de imágenes de ads scrapeados.
//
// Por qué: las URLs del CDN de Meta expiran en ~24h. Si scrapeamos hoy y
// querés regenerar mañana, las imágenes ya no cargan. Solución mínima sin
// backend: bajar el blob al toque, guardarlo en IndexedDB indexado por adId,
// y servir esos blobs al render.
//
// Almacenamiento: IndexedDB "lab-viora-ads-images" store "images".
// Schema: { adId (key), blob, mime, sourceUrl, cachedAt, productoId, brandId }
//
// Cuando una imagen se cachea, dispatch evento "viora:ad-image-cached" para
// que cualquier <img> que la esté mostrando pueda refresh al blob URL.

const DB_NAME = 'lab-viora-ads-images';
const DB_VERSION = 1;
const STORE = 'images';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'adId' });
        store.createIndex('productoId', 'productoId', { unique: false });
        store.createIndex('cachedAt', 'cachedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Object URL cache en memoria — evitamos crear/revocar mil veces el mismo URL.
const objectUrlCache = new Map(); // adId → objectURL

export async function getCachedAdImageUrl(adId) {
  if (!adId) return null;
  if (objectUrlCache.has(adId)) return objectUrlCache.get(adId);
  try {
    const db = await openDB();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(String(adId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!rec?.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    objectUrlCache.set(adId, url);
    return url;
  } catch {
    return null;
  }
}

export async function hasCachedAdImage(adId) {
  if (!adId) return false;
  if (objectUrlCache.has(adId)) return true;
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count(String(adId));
      req.onsuccess = () => resolve((req.result || 0) > 0);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

// Cachea UN ad: baja vía proxy (CORS-safe), guarda Blob en IndexedDB.
// Idempotente — si ya está cacheado, no re-baja.
export async function cacheAdImage({ adId, sourceUrl, productoId, brandId }) {
  if (!adId || !sourceUrl) return { skipped: 'missing' };
  if (await hasCachedAdImage(adId)) return { skipped: 'cached' };
  try {
    const proxyUrl = `/api/marketing/proxy-image?url=${encodeURIComponent(sourceUrl)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) return { skipped: `http_${resp.status}` };
    const blob = await resp.blob();
    if (blob.size === 0) return { skipped: 'empty' };

    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        adId: String(adId),
        blob,
        mime: blob.type || 'image/jpeg',
        sourceUrl,
        cachedAt: new Date().toISOString(),
        productoId: productoId ? String(productoId) : null,
        brandId: brandId ? String(brandId) : null,
        size: blob.size,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('viora:ad-image-cached', { detail: { adId } })); } catch {}
    }
    return { ok: true, size: blob.size };
  } catch (err) {
    return { skipped: `error_${err.message}` };
  }
}

// Cachea muchos ads en paralelo limitado (evita saturar al proxy y al browser).
export async function cacheAdImagesBatch(ads, { productoId, brandId, concurrency = 4, onProgress } = {}) {
  const items = (ads || []).filter(a => a?.id && a?.imageUrls?.[0]);
  let done = 0;
  let cached = 0;
  let skipped = 0;
  const queue = [...items];

  async function worker() {
    while (queue.length > 0) {
      const ad = queue.shift();
      const r = await cacheAdImage({
        adId: ad.id,
        sourceUrl: ad.imageUrls[0],
        productoId, brandId,
      });
      done++;
      if (r.ok) cached++; else skipped++;
      try { onProgress?.({ done, total: items.length, cached, skipped }); } catch {}
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return { done, cached, skipped, total: items.length };
}

// Stats globales (sumario): cantidad cacheada, tamaño total.
export async function getCacheStats() {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        const totalSize = items.reduce((s, x) => s + (x.size || 0), 0);
        resolve({ count: items.length, totalSize });
      };
      req.onerror = () => resolve({ count: 0, totalSize: 0 });
    });
  } catch {
    return { count: 0, totalSize: 0 };
  }
}

// Borra todo el cache (útil si crece mucho).
export async function clearCache() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    objectUrlCache.forEach(url => { try { URL.revokeObjectURL(url); } catch {} });
    objectUrlCache.clear();
    return true;
  } catch {
    return false;
  }
}
