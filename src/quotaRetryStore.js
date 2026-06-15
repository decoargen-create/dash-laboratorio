// Cola de scrapes que fallaron por quota de Apify (hard limit mensual).
// Cuando el user sube el plan de Apify, puede clickear "Reintentar todos"
// para re-disparar todos los scrapes encolados sin tener que ir uno por uno.
//
// Persistido en localStorage por si el user cierra la pestaña entre el
// fallo y el reintento. Cap a 50 entries para no explotar.
//
// API:
//   trackQuotaFailure({ kind, id, productoId, nombre })  → push si no existe
//   getQuotaQueue() → array
//   clearQuotaQueue() → wipe
//   removeFromQuotaQueue(id) → cuando un reintento individual sale OK
//   subscribeQuotaQueue(fn) → unsubscribe
//   isQuotaError(message) → bool helper, regex compartida entre callers

const STORAGE_KEY = 'lab-quota-retry-queue';
const MAX_ENTRIES = 50;
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(arr) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(-MAX_ENTRIES)));
  } catch {}
  listeners.forEach(fn => { try { fn(arr); } catch {} });
}

// Detecta el error "Apify hit monthly hard limit" — copiado de Arranque.jsx
// y de la rama del cron donde estaba duplicado. Centralizado acá para que
// todos los callers usen la misma regex.
export function isQuotaError(message) {
  if (!message || typeof message !== 'string') return false;
  return /usage hard limit|monthly|platform-feature-disabled|quota|limite mensual|límite mensual/i.test(message);
}

export function trackQuotaFailure({ kind, id, productoId, nombre }) {
  if (!kind || !id) return;
  const queue = read();
  // Dedupe por (kind, id, productoId). Si el mismo comp falla 2 veces seguidas
  // por quota, no inflamos la cola — actualizamos timestamp del existente.
  const key = `${kind}:${id}:${productoId || ''}`;
  const idx = queue.findIndex(e => `${e.kind}:${e.id}:${e.productoId || ''}` === key);
  const entry = {
    kind, id, productoId: productoId || null, nombre: nombre || id,
    timestamp: Date.now(),
  };
  if (idx >= 0) queue[idx] = entry;
  else queue.push(entry);
  write(queue);
}

export function removeFromQuotaQueue(kind, id, productoId) {
  const queue = read();
  const key = `${kind}:${id}:${productoId || ''}`;
  const next = queue.filter(e => `${e.kind}:${e.id}:${e.productoId || ''}` !== key);
  if (next.length !== queue.length) write(next);
}

export function clearQuotaQueue() {
  write([]);
}

export function getQuotaQueue() {
  return read();
}

export function subscribeQuotaQueue(fn) {
  listeners.add(fn);
  try { fn(read()); } catch {}
  return () => listeners.delete(fn);
}
