// Store del valor del dólar cripto (Argentina) — para mostrar costos USD
// también en ARS y que el usuario sepa cuánto está gastando en plata real.
//
// Fuente: dolarapi.com — pública, sin auth, con CORS abierto.
// Endpoint: GET https://dolarapi.com/v1/dolares/cripto
// Devuelve: { moneda, casa, nombre, compra, venta, fechaActualizacion }
//
// Usamos "venta" (lo que pagás para convertir USD → ARS), porque es lo que
// más se acerca al costo real de comprar dólares.
//
// Cache: 30 min en localStorage. Si falla la API, devolvemos el último valor
// cacheado (mejor mostrar algo viejo que nada).

const CACHE_KEY = 'adslab-dolar-cripto-v1';
const TTL_MS = 30 * 60 * 1000; // 30 min

let inflight = null;
const listeners = new Set();

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}

function emit() {
  const r = readCache();
  listeners.forEach(fn => { try { fn(r); } catch {} });
}

// Devuelve el valor sincronicamente desde cache (o null).
export function getDolarCriptoCached() {
  const c = readCache();
  if (!c?.venta) return null;
  return { venta: c.venta, compra: c.compra, fetchedAt: c.fetchedAt };
}

// Trae el dólar cripto. Usa cache si está fresco (<30min). Si no, fetchea.
// Si la API falla, devuelve cache aunque esté viejo. Coalesces requests.
export async function fetchDolarCripto() {
  const cached = readCache();
  if (cached?.venta && cached.fetchedAt && (Date.now() - cached.fetchedAt) < TTL_MS) {
    return cached;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const resp = await fetch('https://dolarapi.com/v1/dolares/cripto', {
        headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const out = {
        venta: Number(data.venta) || 0,
        compra: Number(data.compra) || 0,
        fechaActualizacion: data.fechaActualizacion,
        fetchedAt: Date.now(),
      };
      if (out.venta > 0) {
        writeCache(out);
        emit();
        return out;
      }
      // Si vino sin venta, fallback a cache.
      return cached;
    } catch (err) {
      console.warn('fetchDolarCripto falló:', err.message);
      return cached; // mejor algo viejo que nada
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Suscripción: el componente se entera cuando el rate se actualiza.
export function subscribeDolar(fn) {
  listeners.add(fn);
  // Disparar una vez con el valor actual del cache.
  try { fn(readCache()); } catch {}
  return () => listeners.delete(fn);
}

// ── Dólar BLUE ───────────────────────────────────────────────────────────────
// Mismo mecanismo que el cripto pero con su propia cache y listeners. Lo usa
// la pill del header (pedido del user: "el tipo de cambio arriba deberías
// traerlo vos directamente, el dólar blue venta").
const BLUE_KEY = 'adslab-dolar-blue-v1';
let inflightBlue = null;
const listenersBlue = new Set();

function readCacheBlue() {
  try { const raw = localStorage.getItem(BLUE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function emitBlue() {
  const r = readCacheBlue();
  listenersBlue.forEach(fn => { try { fn(r); } catch {} });
}

export function getDolarBlueCached() {
  const c = readCacheBlue();
  if (!c?.venta) return null;
  return { venta: c.venta, compra: c.compra, fetchedAt: c.fetchedAt };
}

export async function fetchDolarBlue() {
  const cached = readCacheBlue();
  if (cached?.venta && cached.fetchedAt && (Date.now() - cached.fetchedAt) < TTL_MS) {
    return cached;
  }
  if (inflightBlue) return inflightBlue;
  inflightBlue = (async () => {
    try {
      const resp = await fetch('https://dolarapi.com/v1/dolares/blue', {
        headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const out = {
        venta: Number(data.venta) || 0,
        compra: Number(data.compra) || 0,
        fechaActualizacion: data.fechaActualizacion,
        fetchedAt: Date.now(),
      };
      if (out.venta > 0) {
        try { localStorage.setItem(BLUE_KEY, JSON.stringify(out)); } catch {}
        emitBlue();
        return out;
      }
      return cached;
    } catch (err) {
      console.warn('fetchDolarBlue falló:', err.message);
      return cached; // mejor algo viejo que nada
    } finally {
      inflightBlue = null;
    }
  })();
  return inflightBlue;
}

export function subscribeDolarBlue(fn) {
  listenersBlue.add(fn);
  try { fn(readCacheBlue()); } catch {}
  return () => listenersBlue.delete(fn);
}

// Format helper: convierte USD a ARS y devuelve string corto tipo "$1.234 ARS".
// Si no hay rate, devuelve vacío.
export function usdToArsString(usd, rate) {
  if (!rate || !rate.venta || !usd) return '';
  const ars = Number(usd) * rate.venta;
  return `$${Math.round(ars).toLocaleString('es-AR')} ARS`;
}
