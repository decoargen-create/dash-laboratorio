// Galería de creativos referenciales.
//
// MODO DUAL (post Opción A de cloud sync):
// - Si Supabase está configurado + user logueado → CLOUD primero:
//     • saveReferencial: sube bytes al bucket 'creativos' y metadata a
//       tabla marketing_creativos. La galería va a leer image_url del row.
//     • IDB local se sigue usando como cache (fallback offline + speed).
// - Si NO hay cloud (sin Supabase o sin sesión) → solo IDB (modo viejo).
//
// La API pública NO cambia: los componentes que ya consumen estas
// funciones siguen funcionando.

import {
  isCloudReady,
  saveReferencialCloud,
  getReferencialesByProductoCloud,
  countReferencialesByProductoCloud,
  getUsedAdIdsForProductoCloud,
  patchReferencialesCloud,
  archiveReferencialCloud,
  deleteReferencialCloud,
} from './galeriaReferencialesCloud.js';

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

function notify(detail = {}) {
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail })); } catch {}
  }
}

// ============================================================
// SAVE
// ============================================================
export async function saveReferencial(ref) {
  if (!ref?.id) throw new Error('saveReferencial: falta id');
  const cloud = await isCloudReady();

  if (cloud) {
    try {
      const enriched = await saveReferencialCloud(ref);
      // Cache local de metadata (sin imageBase64 para no inflar IDB con la
      // misma imagen 2 veces — el bucket ya la tiene).
      try {
        const { imageBase64, ...metaOnly } = enriched;
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ ...metaOnly, createdAt: enriched.createdAt || new Date().toISOString() });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {}
      notify({ productoId: ref.productoId, cloud: true });
      return true;
    } catch (err) {
      // Si la nube falla (red, quota, política), caemos a IDB para no perder
      // el creativo. El user lo va a tener local; al re-loguear se podría
      // re-subir con una migración (TODO opcional). Disparamos evento para
      // que la UI muestre un toast — el user debe saber que el cloud falló.
      console.warn('[galería] cloud save falló, cae a IDB:', err.message);
      try {
        window.dispatchEvent(new CustomEvent('viora:referencial-cloud-failed', {
          detail: { id: ref.id, productoId: ref.productoId, error: err.message },
        }));
      } catch {}
    }
  }

  // Path IDB (cloud no disponible o falló).
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...ref, createdAt: ref.createdAt || new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notify({ productoId: ref.productoId, cloud: false });
  return true;
}

// ============================================================
// READ
// ============================================================
export async function getReferencialesByProducto(productoId, opts = {}) {
  if (!productoId) return [];
  const cloud = await isCloudReady();
  let cloudItems = [];
  if (cloud) {
    try {
      cloudItems = await getReferencialesByProductoCloud(productoId, opts);
    } catch (err) {
      console.warn('[galería] cloud read falló, cae a IDB:', err.message);
    }
  }
  // SIEMPRE intentamos leer IDB también — algunos creativos pueden estar
  // solo local (fallback de cloud, generados antes del bucket setup, etc).
  // Dedupe por id, cloud gana si hay conflicto.
  const { includeArchived = false } = opts;
  let idbItems = [];
  try {
    const db = await openDB();
    idbItems = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('productoId');
      const req = idx.getAll(String(productoId));
      req.onsuccess = () => {
        const all = req.result || [];
        const filtered = includeArchived ? all : all.filter(it => !it.archivado);
        resolve(filtered);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {}

  // Merge cloud + IDB con dedupe por id. Cloud gana.
  const byId = new Map();
  for (const it of cloudItems) byId.set(it.id, it);
  for (const it of idbItems) if (!byId.has(it.id)) byId.set(it.id, it);
  const merged = Array.from(byId.values());
  merged.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return merged;
}

export async function countReferencialesByProducto(productoId) {
  if (!productoId) return { total: 0, active: 0, archived: 0, downloaded: 0 };
  const cloud = await isCloudReady();
  if (cloud) {
    try {
      // Cloud es source of truth — si cloud devuelve 0 es 0. Antes el
      // fallback a IDB hacía que items legacy locales aparezcan después
      // de un bulk-delete cloud → user pensaba que el delete no funcionó.
      return await countReferencialesByProductoCloud(productoId);
    } catch (err) {
      console.warn('[galería] cloud count falló, cae a IDB:', err.message);
    }
  }
  // Path IDB — solo si cloud no está disponible o falló.
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

export async function getUsedAdIdsForProducto(productoId) {
  if (!productoId) return new Set();
  const cloud = await isCloudReady();
  if (cloud) {
    try {
      return await getUsedAdIdsForProductoCloud(productoId);
    } catch (err) {
      console.warn('[galería] cloud usedAdIds falló:', err.message);
    }
  }
  // Path IDB (cursor para no cargar imageBase64 — ver PR #122)
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

// ============================================================
// PATCH (archive, download flags)
// ============================================================
export async function patchReferenciales(ids, patch) {
  if (!Array.isArray(ids) || ids.length === 0 || !patch) return 0;
  const cloud = await isCloudReady();
  let updated = 0;
  if (cloud) {
    try {
      updated = await patchReferencialesCloud(ids, patch);
    } catch (err) {
      console.warn('[galería] cloud patch falló:', err.message);
    }
  }
  // Patch IDB también — para que el cache local refleje los cambios.
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      ids.forEach((id) => {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) store.put({ ...req.result, ...patch });
        };
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  notify({});
  return cloud ? updated : ids.length;
}

export async function archiveReferencial(id, archived = true) {
  if (!id) return false;
  return patchReferenciales([id], archived
    ? { archivado: true, archivadoAt: new Date().toISOString() }
    : { archivado: false, archivadoAt: null }
  ).then(n => n > 0);
}

// Marca/desmarca un creativo como winner — el user lo publicó en Meta, corrió,
// y concluyó que rinde lo suficiente para escalar / iterar. metrics es un
// objeto libre con CTR, ROAS, CPA, ad_id, qué funcionó, notas, etc. (ver
// migración 0007 para shape sugerido).
export async function markAsWinner(id, metrics = {}) {
  if (!id) return false;
  return patchReferenciales([id], {
    winner: true,
    winnerAt: new Date().toISOString(),
    winnerMetrics: metrics,
  }).then(n => n > 0);
}

export async function unmarkWinner(id) {
  if (!id) return false;
  return patchReferenciales([id], {
    winner: false,
    winnerAt: null,
    winnerMetrics: null,
  }).then(n => n > 0);
}

// ============================================================
// DELETE
// ============================================================
export async function deleteReferencial(id) {
  if (!id) return false;
  const cloud = await isCloudReady();
  let cloudOk = true;
  if (cloud) {
    try {
      await deleteReferencialCloud(id);
    } catch (err) {
      console.warn('[galería] cloud delete falló:', err.message);
      cloudOk = false;
      try {
        window.dispatchEvent(new CustomEvent('viora:referencial-cloud-failed', {
          detail: { id, op: 'delete', error: err.message },
        }));
      } catch {}
    }
  }
  // Borrar también del cache local
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  notify({});
  return cloudOk;
}
