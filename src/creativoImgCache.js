// Cache local (IndexedDB) de los bytes de cada creativo, keyed por su
// `storagePath` del bucket de Supabase (estable e inmutable por creativo:
// `creativos/<user_id>/<id>.png`, donde <id> es único por creativo).
//
// POR QUÉ EXISTE: el bucket 'creativos' es privado, así que la galería sirve
// las imágenes con SIGNED URLs que cambian de token cada vez que se re-firman
// (cada 5 min / 1 h). Como la URL cambia, el browser las trata como recursos
// nuevos y RE-DESCARGA el PNG full cada vez → quema el egress de Supabase
// (fue lo que disparó el `exceed_egress_quota`).
//
// CON ESTE CACHE: la imagen se baja UNA vez por dispositivo y después se sirve
// desde IndexedDB (blob local), sin importar cuántas veces se re-firme la URL
// ni cuántas veces se reabra la galería → el egress repetido se va a cero.
//
// Es best-effort: si IndexedDB no está disponible (modo incógnito, error,
// SSR) cualquier función devuelve null y el caller cae a la signed URL directa
// (el comportamiento de antes). Nunca rompe el render.

const DB_NAME = 'adslab-creativo-img-cache';
const STORE = 'imgs';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idbGet(key) {
  return openDB().then(db => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  });
}

function idbPut(key, blob) {
  return openDB().then(db => {
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  });
}

// Devuelve un objectURL (blob:) servido desde el cache si la imagen ya está
// guardada; si no, baja la signed URL UNA vez, la cachea por storagePath y
// devuelve el objectURL. El caller es responsable de revocar el objectURL
// (lo hace el hook useBlobUrls al desmontar / cambiar items).
//
// Devuelve null si no hay cache disponible o si la descarga falla → el caller
// usa la signed URL directa como fallback.
export async function getCachedCreativoUrl(storagePath, signedUrl) {
  if (!storagePath || !signedUrl) return null;
  try {
    let blob = await idbGet(storagePath);
    if (!blob) {
      const resp = await fetch(signedUrl);
      if (!resp.ok) return null;
      blob = await resp.blob();
      // Guardado best-effort — si el put falla (quota, etc.) igual servimos
      // el blob recién bajado; solo nos perdemos el cache para la próxima.
      idbPut(storagePath, blob);
    }
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// Borra todo el cache de imágenes (por si hace falta liberar espacio o forzar
// re-descarga). No se usa en el render — utilitario para mantenimiento.
export async function clearCreativoImgCache() {
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
  } catch { /* noop */ }
}
