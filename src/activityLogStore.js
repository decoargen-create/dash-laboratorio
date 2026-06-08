// Activity log persistente — guarda las ejecuciones (done + error) cuando
// terminan, para que el user pueda ver más tarde qué se hizo y qué falló.
// Complementa al ExecutionsTray que es "in-flight + recientes" (auto-cierra
// en 3-12s). Acá viven los logs para revisar histórico.

const STORAGE_KEY = 'adslab-activity-log-v1';
const MAX_ITEMS = 100;
const listeners = new Set();

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeAll(items) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS))); } catch {}
  listeners.forEach(fn => { try { fn(items); } catch {} });
}

// Agrega un item al log. Llamado desde executionsStore.finishExecution.
//   item = { id, label, sublabel, kind, status: 'done'|'error', message, cost, durationMs, finishedAt }
export function logActivity(item) {
  if (!item?.id) return;
  const items = readAll();
  // Si ya existe (mismo id), reemplazar — un retry puede actualizar el resultado.
  const filtered = items.filter(x => x.id !== item.id);
  const next = [
    {
      ...item,
      read: false,
      loggedAt: new Date().toISOString(),
    },
    ...filtered,
  ];
  writeAll(next);
}

export function getActivity() {
  return readAll();
}

export function getUnreadCount() {
  return readAll().filter(x => !x.read).length;
}

export function getUnreadErrorCount() {
  return readAll().filter(x => !x.read && x.status === 'error').length;
}

export function markAllRead() {
  const items = readAll().map(x => ({ ...x, read: true }));
  writeAll(items);
}

export function clearActivity() {
  writeAll([]);
}

export function subscribeActivity(fn) {
  listeners.add(fn);
  try { fn(readAll()); } catch {}
  return () => listeners.delete(fn);
}
