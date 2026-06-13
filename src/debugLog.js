// Debug log persistente — captura TODO lo que pasa en la app para que cuando
// algo falle el user pueda exportar un JSON y pasármelo y yo reproduzca el
// flow completo: qué endpoints se llamaron, qué errores ocurrieron, qué
// rejections de promises, console.errors, etc.
//
// API:
//   logEvent({ kind, label, meta })  — log manual desde código
//   installDebugLog()                 — instala hooks globales (llamar 1 vez)
//   getDebugLog()                     — leer eventos en memoria
//   clearDebugLog()                   — vaciar
//   exportDebugLog()                  — descarga JSON con el log completo
//
// Storage: in-memory ring buffer de últimos 500 eventos. Replica los últimos
// 100 a localStorage para sobrevivir a refresh (errores que crashean la app
// quedan persistidos). Los buffer-only de memoria son los detalles completos
// (request bodies + stacks) — localStorage solo lleva resumen.
//
// Kinds soportados:
//   - 'fetch'        — todas las llamadas fetch (URL, método, status, duración)
//   - 'fetch-error'  — fetch que tiró excepción
//   - 'error'        — window.error capturado
//   - 'rejection'    — unhandledrejection
//   - 'console-err'  — console.error
//   - 'user'         — click/acción del user (manual desde código)
//   - 'info'         — log manual genérico
//
// Privacy: NO logueamos request bodies completos (pueden tener PII / auth).
// Solo URL + status + duración. El user puede activar verbose con
// localStorage.setItem('adslab-debug-verbose', '1') para incluir bodies cortos.

const MAX_MEMORY = 500;
const MAX_LOCALSTORAGE = 100;
const STORAGE_KEY = 'adslab-debug-log-v1';
const VERBOSE_KEY = 'adslab-debug-verbose';

const buffer = [];
const listeners = new Set();
let installed = false;
let originalFetch = null;
let originalConsoleError = null;

function isVerbose() {
  try { return localStorage.getItem(VERBOSE_KEY) === '1'; } catch { return false; }
}

function persistSnapshot() {
  try {
    // Solo guardamos los últimos 100 con campos chicos (sin stacks largos
    // ni bodies) para no inflar localStorage.
    const slim = buffer.slice(-MAX_LOCALSTORAGE).map(e => ({
      t: e.t,
      kind: e.kind,
      label: e.label,
      meta: e.meta ? slimMeta(e.meta) : null,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {}
}

function slimMeta(meta) {
  // Truncar strings largos en meta para no quemarse localStorage.
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (v == null) continue;
    if (typeof v === 'string') {
      out[k] = v.length > 500 ? v.slice(0, 500) + `… [+${v.length - 500} chars]` : v;
    } else if (typeof v === 'object') {
      try {
        const s = JSON.stringify(v);
        out[k] = s.length > 500 ? s.slice(0, 500) + '…' : v;
      } catch { out[k] = '[unserializable]'; }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit() {
  listeners.forEach(fn => { try { fn(buffer); } catch {} });
}

export function logEvent({ kind = 'info', label, meta = null }) {
  const event = {
    t: new Date().toISOString(),
    kind,
    label: String(label || ''),
    meta,
  };
  buffer.push(event);
  if (buffer.length > MAX_MEMORY) buffer.shift();
  // Persistir solo cada N eventos para no martillar localStorage en cada fetch.
  if (buffer.length % 5 === 0 || kind === 'error' || kind === 'rejection' || kind === 'fetch-error') {
    persistSnapshot();
  }
  emit();
  return event;
}

export function getDebugLog() {
  return [...buffer];
}

export function clearDebugLog() {
  buffer.length = 0;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  emit();
}

export function subscribeDebugLog(fn) {
  listeners.add(fn);
  try { fn(buffer); } catch {}
  return () => listeners.delete(fn);
}

// Devuelve el log con metadata del browser para mandar a Claude.
function buildExportPayload() {
  let prev = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) prev = JSON.parse(raw);
  } catch {}
  return {
    exportedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    url: typeof location !== 'undefined' ? location.href : '',
    buildVersion: typeof window !== 'undefined' ? window.__VIORA_BUILD__ || null : null,
    eventsInMemory: buffer.length,
    events: buffer,
    persistedTail: prev,
  };
}

export function exportDebugLog() {
  const payload = buildExportPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  a.download = `adslab-debug-log-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload;
}

// ---------- INSTALACIÓN DE HOOKS GLOBALES ----------

export function installDebugLog() {
  if (installed) return;
  installed = true;

  // 1. Hidratar buffer con lo último persistido (errores que cause un crash
  //    quedan disponibles en próximo arranque).
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const prev = JSON.parse(raw);
      if (Array.isArray(prev)) {
        for (const e of prev.slice(-50)) buffer.push({ ...e, _restored: true });
      }
    }
  } catch {}

  // 2. window.error — runtime errors (TDZ crashes, undefined refs, etc.)
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (ev) => {
      logEvent({
        kind: 'error',
        label: ev.message || 'window.error',
        meta: {
          filename: ev.filename,
          line: ev.lineno,
          col: ev.colno,
          stack: ev.error?.stack || null,
        },
      });
    });

    // 3. unhandledrejection — promises sin catch
    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason;
      logEvent({
        kind: 'rejection',
        label: String(reason?.message || reason || 'unhandled rejection'),
        meta: { stack: reason?.stack || null },
      });
    });
  }

  // 4. console.error — engancha pero NO lo silencia (mantiene el log normal).
  if (typeof console !== 'undefined' && console.error) {
    originalConsoleError = console.error;
    console.error = function patchedError(...args) {
      try {
        const label = args.map(a => {
          if (typeof a === 'string') return a;
          if (a instanceof Error) return a.message;
          try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' ');
        logEvent({
          kind: 'console-err',
          label: label.slice(0, 500),
          meta: args[0]?.stack ? { stack: args[0].stack } : null,
        });
      } catch {}
      return originalConsoleError.apply(this, args);
    };
  }

  // 5. fetch — wrappear para loggear URL, status, duración, errores.
  //    Solo loggeamos calls a `/api/` (los propios) para no espamear con
  //    Supabase, Sentry, analytics, etc.
  if (typeof window !== 'undefined' && window.fetch) {
    originalFetch = window.fetch.bind(window);
    window.fetch = async function patchedFetch(input, init) {
      const url = typeof input === 'string' ? input : (input?.url || '');
      const isOwnApi = /^\/api\//.test(url) || url.startsWith(location.origin + '/api/');
      if (!isOwnApi) return originalFetch(input, init);

      const t0 = performance.now();
      const method = (init?.method || 'GET').toUpperCase();
      const verbose = isVerbose();
      const bodyPreview = verbose && init?.body
        ? (typeof init.body === 'string' ? init.body.slice(0, 300) : '[non-string body]')
        : null;
      try {
        const resp = await originalFetch(input, init);
        const ms = Math.round(performance.now() - t0);
        logEvent({
          kind: resp.ok ? 'fetch' : 'fetch-error',
          label: `${method} ${url} → ${resp.status}`,
          meta: {
            status: resp.status,
            ok: resp.ok,
            ms,
            ...(bodyPreview ? { reqBody: bodyPreview } : {}),
          },
        });
        return resp;
      } catch (err) {
        const ms = Math.round(performance.now() - t0);
        logEvent({
          kind: 'fetch-error',
          label: `${method} ${url} — ${err.message}`,
          meta: { ms, error: err.message, stack: err.stack },
        });
        throw err;
      }
    };
  }

  // Log inicial — referencia para saber desde cuándo está el buffer.
  logEvent({ kind: 'info', label: 'debug-log instalado' });
}

// Atajo de teclado: Ctrl+Shift+L exporta el log inmediato (útil cuando algo
// está roto y querés un snapshot sin tener que buscar el botón).
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      try { exportDebugLog(); } catch (err) { console.warn('exportDebugLog falló', err); }
    }
  });
}
