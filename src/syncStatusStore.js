// Store global del estado de sincronización con la nube. useMarketingSync
// escribe acá su status; el SyncStatusBadge (en el header) lo lee. Pub/sub
// suelto para no hacer prop-drilling a través de StickyHeader.
//
// status: 'idle' | 'pulling' | 'pushing' | 'ok' | 'error'

let _state = { status: 'idle', lastError: null, lastOkAt: 0 };
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(_state); } catch {}
  }
}

export function setSyncStatus({ status, lastError = null }) {
  _state = {
    status,
    lastError: status === 'error' ? lastError : null,
    lastOkAt: status === 'ok' ? Date.now() : _state.lastOkAt,
  };
  emit();
}

export function getSyncStatus() {
  return _state;
}

export function subscribeSyncStatus(fn) {
  listeners.add(fn);
  try { fn(_state); } catch {}
  return () => listeners.delete(fn);
}
