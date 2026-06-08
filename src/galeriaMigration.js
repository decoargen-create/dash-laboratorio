// Migración soft de creativos IDB → cloud. Se ejecuta una sola vez al
// primer login con Supabase activo, si hay creativos en IDB y nada (o casi
// nada) en la tabla marketing_creativos del cloud.
//
// Idempotente — usa un marker en la tabla profiles para no re-migrar.

import { supabase, getCurrentUser } from './supabase.js';
import { saveReferencialCloud } from './galeriaReferencialesCloud.js';

const IDB_NAME = 'lab-viora-referenciales';
const IDB_STORE = 'referenciales';
const MARKER_KEY = 'viora-creativos-cloud-migrated-v1';

// Lee todos los creativos del IDB (full data, incluyendo imageBase64).
async function readAllIDBReferenciales() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve([]);
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      // Si por algún motivo no existe la DB, la creamos vacía.
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const getAll = tx.objectStore(IDB_STORE).getAll();
        getAll.onsuccess = () => resolve(getAll.result || []);
        getAll.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    };
  });
}

// Devuelve true si ya migramos antes (chequeando localStorage marker +
// también si hay filas en marketing_creativos > 0 — defensa por si el
// localStorage se borró).
async function alreadyMigrated() {
  try {
    if (localStorage.getItem(MARKER_KEY) === '1') return true;
  } catch {}
  if (!supabase) return false;
  const user = await getCurrentUser();
  if (!user) return false;
  // Si hay 5+ en cloud y 5+ local, asumimos que ya estaba migrado.
  const { count } = await supabase
    .from('marketing_creativos')
    .select('id', { count: 'exact', head: true });
  if ((count || 0) >= 5) {
    try { localStorage.setItem(MARKER_KEY, '1'); } catch {}
    return true;
  }
  return false;
}

// Marca como migrado.
function markMigrated() {
  try { localStorage.setItem(MARKER_KEY, '1'); } catch {}
}

// Ejecuta la migración. Devuelve { skipped, migrated, failed } con counts.
export async function migrateIDBCreativosToCloud({ onProgress } = {}) {
  if (!supabase) return { skipped: true, reason: 'no-supabase' };
  const user = await getCurrentUser();
  if (!user) return { skipped: true, reason: 'no-user' };

  if (await alreadyMigrated()) {
    return { skipped: true, reason: 'already-migrated' };
  }

  const items = await readAllIDBReferenciales();
  // Solo los que tienen imageBase64 — los puros metadata (cache de cloud)
  // los saltamos.
  const conImagen = items.filter(it => it && it.imageBase64);
  if (conImagen.length === 0) {
    markMigrated();
    return { skipped: true, reason: 'idb-empty' };
  }

  let migrated = 0;
  let failed = 0;
  for (let i = 0; i < conImagen.length; i++) {
    const ref = conImagen[i];
    try {
      await saveReferencialCloud(ref);
      migrated++;
    } catch (err) {
      console.warn(`[migración] no pude subir creativo ${ref.id}:`, err.message);
      failed++;
    }
    if (onProgress) {
      try { onProgress({ done: i + 1, total: conImagen.length, migrated, failed }); } catch {}
    }
  }

  markMigrated();
  return { migrated, failed, total: conImagen.length };
}

// Helper: cuenta cuántos creativos hay en IDB sin subirlos. Útil para
// avisar al user antes de migrar.
export async function countIDBCreativos() {
  const items = await readAllIDBReferenciales();
  return items.filter(it => it && it.imageBase64).length;
}
