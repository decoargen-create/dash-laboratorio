// Galería de creativos referenciales — los generados al "Adaptar al
// producto" desde un ad de Inspiración. Cada entrada guarda la imagen
// generada + la ref del ad origen + metadata. IndexedDB porque las
// imágenes pesan ~1-2 MB.

const DB_NAME = 'lab-viora-referenciales';
const DB_VERSION = 1;
const STORE = 'referenciales';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('productoId', 'productoId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Guarda un referencial. `ref` = { id, productoId, sourceAdId, sourceBrand,
//   imageBase64, mimeType, prompt, model, createdAt }.
export async function saveReferencial(ref) {
  if (!ref?.id) throw new Error('saveReferencial: falta id');
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...ref, createdAt: ref.createdAt || new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // Aviso global para que la galería se refresque al toque.
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail: { productoId: ref.productoId } })); } catch {}
  }
  return true;
}

export async function getReferencialesByProducto(productoId) {
  if (!productoId) return [];
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('productoId');
      const req = idx.getAll(String(productoId));
      req.onsuccess = () => {
        const items = (req.result || []).slice().sort((a, b) =>
          (b.createdAt || '').localeCompare(a.createdAt || '')
        );
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

// Marca uno o varios referenciales con un patch (ej. { descargada: true,
// descargadaAt: timestamp }). Devuelve la cantidad de items actualizados.
export async function patchReferenciales(ids, patch) {
  if (!Array.isArray(ids) || ids.length === 0 || !patch) return 0;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let updated = 0;
      ids.forEach((id) => {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) {
            store.put({ ...req.result, ...patch });
            updated++;
          }
        };
      });
      tx.oncomplete = () => {
        if (typeof window !== 'undefined') {
          try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail: {} })); } catch {}
        }
        resolve(updated);
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return 0;
  }
}

export async function deleteReferencial(id) {
  if (!id) return false;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}
