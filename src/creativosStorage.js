// Storage de los creativos generados (imágenes estáticas producidas por
// /api/marketing/generate-creative).
//
// Vive en IndexedDB —NO en localStorage— porque cada imagen PNG en base64
// pesa ~1-2 MB y localStorage tiene un techo de ~5 MB total. Guardar
// creativos ahí lo reventaría en 2-3 imágenes.
//
// Cada creativo se guarda con la key = id de la idea de la Bandeja, así
// al expandir una idea sabemos si ya tiene su creativo producido.

const DB_NAME = 'lab-viora-creativos';
const DB_VERSION = 1;
const STORE = 'creativos';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible en este navegador'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Guarda el creativo de una idea. `creativo` = { imageBase64, mimeType,
// formato, size, quality, model, generatedAt }.
export async function saveCreativo(ideaId, creativo) {
  if (!ideaId) return false;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(creativo, String(ideaId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Aviso global para que la Bandeja refresque los badges/thumbnails al
    // toque, sin esperar el polling de 4s.
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('viora:creativo-saved', { detail: { ideaId: String(ideaId) } })); } catch {}
    }
    return true;
  } catch (err) {
    console.error('saveCreativo error:', err);
    return false;
  }
}

// Devuelve el creativo guardado de una idea, o null si no tiene.
export async function getCreativo(ideaId) {
  if (!ideaId) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(String(ideaId));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('getCreativo error:', err);
    return null;
  }
}

// Devuelve el Set de ids de ideas que ya tienen un creativo producido.
// Una sola lectura para toda la Bandeja — evita disparar un getCreativo por
// card del kanban (que con 50+ ideas sería costoso).
export async function getAllCreativoIds() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(new Set((req.result || []).map(String)));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return new Set();
  }
}

// Borra el creativo de una idea (al regenerar o al eliminar la idea).
export async function deleteCreativo(ideaId) {
  if (!ideaId) return false;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(String(ideaId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (err) {
    console.error('deleteCreativo error:', err);
    return false;
  }
}
