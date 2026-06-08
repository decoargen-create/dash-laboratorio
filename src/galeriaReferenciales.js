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

// `opts.includeArchived = false` (default): solo los activos.
// Los archivados se cargan a pedido (cuando el user toggle "ver archivados")
// para no inflar la memoria del browser con imágenes que no quiere ver.
export async function getReferencialesByProducto(productoId, opts = {}) {
  const { includeArchived = false } = opts;
  if (!productoId) return [];
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('productoId');
      const req = idx.getAll(String(productoId));
      req.onsuccess = () => {
        const all = req.result || [];
        const filtered = includeArchived ? all : all.filter(it => !it.archivado);
        const items = filtered.slice().sort((a, b) =>
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

// Cuenta items por producto SIN cargar las imágenes a memoria — usa cursor
// y solo lee los flags. Útil para mostrar "X archivados" en el header sin
// pagar el costo de leer 100MB de base64. Devuelve { total, active, archived,
// downloaded }.
export async function countReferencialesByProducto(productoId) {
  if (!productoId) return { total: 0, active: 0, archived: 0, downloaded: 0 };
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('productoId');
      const req = idx.openCursor(String(productoId));
      let total = 0, archived = 0, downloaded = 0;
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          total++;
          if (cursor.value.archivado) archived++;
          if (cursor.value.descargada) downloaded++;
          cursor.continue();
        } else {
          resolve({ total, active: total - archived, archived, downloaded });
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return { total: 0, active: 0, archived: 0, downloaded: 0 };
  }
}

// Archivar/desarchivar un referencial. Soft-hide: no se borra, queda
// disponible para restaurar. Por default la galería no los muestra (filtra
// por archivado=false), pero el counter del header sí los cuenta.
export async function archiveReferencial(id, archived = true) {
  if (!id) return false;
  return patchReferenciales([id], archived
    ? { archivado: true, archivadoAt: new Date().toISOString() }
    : { archivado: false, archivadoAt: null }
  ).then(n => n > 0);
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

// Devuelve un Set con los sourceAdId que ya fueron usados para generar
// creativos en este producto. Usado por InspiracionSection para marcar
// visualmente los thumbs ya procesados.
// IMPORTANTE: usa cursor para iterar SIN cargar imageBase64 a memoria.
// Antes hacía getAll() que cargaba todos los 5-15MB por item → 500MB+ al
// inicio del workspace y crash del renderer de Chrome (error code 5).
export async function getUsedAdIdsForProducto(productoId) {
  if (!productoId) return new Set();
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('productoId');
      const req = idx.openCursor(String(productoId));
      const set = new Set();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          // Solo leemos sourceAdId — imageBase64 NO entra a la memoria del JS.
          if (cursor.value.sourceAdId) set.add(String(cursor.value.sourceAdId));
          cursor.continue();
        } else {
          resolve(set);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return new Set();
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
