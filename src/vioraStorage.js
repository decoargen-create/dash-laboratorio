// Storage de Viora en IndexedDB.
//
// Por qué no localStorage:
//   El módulo Marketing/MetaAds/Senydrop está en desarrollo y a veces hace
//   falta resetear el state (`?reset=1`, botón "Limpiar todo y reiniciar"
//   del ErrorBoundary, o "Clear site data" de DevTools). Esos resets hacen
//   `localStorage.clear()` total y borrarían también los datos productivos
//   de Viora. IndexedDB es un storage paralelo: localStorage.clear() no lo
//   toca, así Viora sobrevive a los resets de dev.
//
// Caveat: "Clear site data" de DevTools sí borra IndexedDB también si el
// user no destilda esa casilla. Para protegerse de eso necesitamos backend
// (out-of-scope por ahora).
//
// API del módulo:
//   loadVioraState()  → Promise<state | null>
//   saveVioraState(s) → Promise<void> (debounced internamente desde el caller)
//   clearVioraState() → Promise<void>
//   listBackups()     → Promise<[{ts, key}]>  // snapshots automáticos
//   restoreBackup(ts) → Promise<state>
//
// Migración: en el primer load chequeamos si hay state legacy en
// localStorage bajo la key `viora-state-v2`. Si sí, lo copiamos a
// IndexedDB y limpiamos la key vieja para que el próximo
// localStorage.clear() ya no la encuentre.

const DB_NAME = 'lab-viora';
const DB_VERSION = 1;
const STORE = 'state';
const STATE_KEY = 'current';
const BACKUP_PREFIX = 'backup-';
const LEGACY_LOCALSTORAGE_KEY = 'viora-state-v2';

// Backups: cuántos guardamos. 24 cubre ~1 día con 1 backup/hora, suficiente
// como red de seguridad sin explotar el storage.
const MAX_BACKUPS = 24;

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

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbKeys() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Valida que un state tenga la forma esperada. No es schema validation
// estricto — sólo verifica que sea un objeto con los arrays principales.
// Si vienen como otro tipo, los reemplazamos por arrays vacíos para que
// `state.X.map/filter/reduce` no crashee.
function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    products: Array.isArray(raw.products) ? raw.products : [],
    clients: Array.isArray(raw.clients) ? raw.clients : [],
    mentors: Array.isArray(raw.mentors) ? raw.mentors : [],
    sales: Array.isArray(raw.sales) ? raw.sales : [],
  };
}

// Carga el state. Si IndexedDB tiene algo, lo devolvemos. Si no, miramos
// localStorage por compat (migración) — si encontramos el state legacy lo
// copiamos a IndexedDB y limpiamos la key vieja, así el próximo
// localStorage.clear() (de un reset de dev) ya no nos pisa los datos.
//
// Siempre saneamos el shape antes de devolver, así un state corrupto
// (escrito a mano en DevTools, restauración mala) no rompe la app.
export async function loadVioraState() {
  try {
    const stored = await idbGet(STATE_KEY);
    if (stored) {
      const safe = sanitizeState(stored);
      if (safe) return safe;
      console.warn('[vioraStorage] state en IndexedDB con shape inválido — descarto');
    }
  } catch (err) {
    console.warn('[vioraStorage] IndexedDB load falló:', err.message);
  }

  // Migración desde localStorage (one-shot).
  try {
    if (typeof localStorage !== 'undefined') {
      const legacy = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const safe = sanitizeState(parsed);
        if (safe) {
          await idbPut(STATE_KEY, safe).catch(() => {});
          // Limpiamos la key legacy SOLO después de confirmar que se guardó.
          // Si el put falló silenciosamente, dejamos la key vieja intacta.
          const verified = await idbGet(STATE_KEY).catch(() => null);
          if (verified) {
            try { localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY); } catch {}
          }
          return safe;
        }
      }
    }
  } catch (err) {
    console.warn('[vioraStorage] migración legacy falló:', err.message);
  }

  return null;
}

// Guarda el state. El caller debería debouncear (ya hay un useEffect que
// dispara con cada cambio del state — usar setTimeout o similar para no
// pegarle a IndexedDB con cada keystroke).
export async function saveVioraState(state) {
  if (!state || typeof state !== 'object') return;
  await idbPut(STATE_KEY, state);
}

export async function clearVioraState() {
  await idbDelete(STATE_KEY);
}

// Backup automático. El caller decide cuándo llamarlo (cada N min, al cerrar
// pestaña, etc.). Guarda el state con clave `backup-<ISOtimestamp>` y purga
// los más viejos para mantener MAX_BACKUPS.
export async function createBackup(state) {
  if (!state || typeof state !== 'object') return;
  const ts = new Date().toISOString();
  await idbPut(`${BACKUP_PREFIX}${ts}`, state);

  // Purgar viejos.
  try {
    const keys = await idbKeys();
    const backups = keys
      .filter(k => typeof k === 'string' && k.startsWith(BACKUP_PREFIX))
      .sort(); // ISO timestamps ordenan alfabéticamente bien
    const toRemove = backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS));
    for (const k of toRemove) await idbDelete(k);
  } catch (err) {
    console.warn('[vioraStorage] purga de backups falló:', err.message);
  }
}

export async function listBackups() {
  try {
    const keys = await idbKeys();
    return keys
      .filter(k => typeof k === 'string' && k.startsWith(BACKUP_PREFIX))
      .map(k => ({ key: k, ts: k.slice(BACKUP_PREFIX.length) }))
      .sort((a, b) => b.ts.localeCompare(a.ts));
  } catch {
    return [];
  }
}

export async function restoreBackup(ts) {
  const key = `${BACKUP_PREFIX}${ts}`;
  const raw = await idbGet(key);
  // Saneamos el shape también acá — un backup viejo puede tener forma rara.
  return sanitizeState(raw);
}
