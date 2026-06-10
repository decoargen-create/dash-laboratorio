// Store global del progreso de bulk-gen (Inspiración u otros bulks). Antes
// vivía como state local de InspiracionSection — al cambiar de sección o
// refrescar se perdía. Ahora:
//   - Single source of truth (store global)
//   - Persiste a localStorage para sobrevivir refresh
//   - BulkProgressBar se renderiza al nivel de App (flotante, siempre visible)
//
// El shape es el mismo que tenía el state local (total, completed, currentIdx,
// startedAt, adsList, errors, adDurations, current) más:
//   - origin: 'inspiracion-bulk' | 'bandeja-bulk' | etc — para que el UI muestre
//     un label distinto
//   - finishedAt: cuando termina; se auto-clear 8s después

const KEY = 'adslab-bulk-progress-v1';
let _state = null;
const listeners = new Set();

function emit() {
  listeners.forEach(fn => {
    try { fn(_state); } catch {}
  });
}

function persist() {
  try {
    if (_state) localStorage.setItem(KEY, JSON.stringify(_state));
    else localStorage.removeItem(KEY);
  } catch {}
}

// Re-hidratamos del localStorage al cargar el módulo. Si está muy viejo
// (>30 min sin actualizar), lo descartamos — probablemente quedó zombie.
(function rehydrate() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return;
    const age = Date.now() - (s.startedAt || 0);
    if (age > 30 * 60 * 1000) {
      localStorage.removeItem(KEY);
      return;
    }
    // Si vino con finishedAt y ya pasaron 8s, también descartar.
    if (s.finishedAt && Date.now() - s.finishedAt > 8000) {
      localStorage.removeItem(KEY);
      return;
    }
    _state = s;
  } catch {}
})();

export function startBulk({ origin, total, ads }) {
  _state = {
    origin: origin || 'bulk',
    startedAt: Date.now(),
    total,
    completed: 0,
    currentIdx: 0,
    adDurations: [],
    errors: [],
    adsList: (ads || []).map(a => ({ adId: a.id, brandNombre: a.brandNombre, status: 'pending' })),
    current: ads && ads[0] ? { adId: ads[0].id, brandNombre: ads[0].brandNombre, adHeadline: ads[0].headline || '' } : null,
    finishedAt: null,
  };
  persist();
  emit();
}

// Patch parcial del state. Útil para actualizar progress sin replazar todo.
export function patchBulk(patcher) {
  if (!_state) return;
  const next = typeof patcher === 'function' ? patcher(_state) : { ..._state, ...patcher };
  _state = next;
  persist();
  emit();
}

// Marca un ad como done/error y actualiza contadores. Centraliza la lógica
// para que los callers no tengan que recordar setear todo.
export function reportAdFinished(adIndex, { ok, errorBrand }) {
  if (!_state) return;
  const next = { ..._state };
  next.completed = (_state.completed || 0) + 1;
  next.currentIdx = Math.min((_state.currentIdx || 0) + 1, _state.total - 1);
  next.adDurations = [..._state.adDurations, Date.now() - _state.startedAt];
  next.adsList = (_state.adsList || []).map((x, i) =>
    i === adIndex ? { ...x, status: ok ? 'done' : 'error' } : x
  );
  if (!ok && errorBrand) next.errors = [..._state.errors, errorBrand];
  _state = next;
  persist();
  emit();
}

export function finishBulk() {
  if (!_state) return;
  _state = { ..._state, finishedAt: Date.now() };
  persist();
  emit();
  // Auto-clear después de 8s para que el user vea el "✓ completo".
  setTimeout(() => {
    if (_state?.finishedAt) clearBulk();
  }, 8000);
}

export function clearBulk() {
  _state = null;
  persist();
  emit();
}

export function getBulk() {
  return _state;
}

export function subscribeBulk(fn) {
  listeners.add(fn);
  try { fn(_state); } catch {}
  return () => listeners.delete(fn);
}
