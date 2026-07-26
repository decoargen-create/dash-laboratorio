// Capa de moneda de la plataforma.
//
// Los costos internos están en USD (así los devuelven las APIs). Este store
// agrega:
//  1. Preferencia de display ARS / USD (switch global) + tipo de cambio editable.
//  2. fmtMoney(usd): formatea un monto USD en la moneda elegida.
//  3. Saldo cargado por PERSONA (responsable): cada persona (Vito, Lucas, VYA…)
//     transfiere plata; se registra cuánto cargó para llevar su saldo aparte,
//     aunque todo corra bajo el mismo login.

const KEY = 'adslab-money-v1';
const PEOPLE_KEY = 'adslab-people-loaded-v1';
const DEFAULT_RATE = 1400; // ARS por USD — editable desde el switch.

const listeners = new Set();

function read(k, fallback) {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
function write(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  listeners.forEach(fn => { try { fn(); } catch {} });
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('viora:money-changed')); } catch {}
  }
}
const normalize = (name) => (name || '').trim().toLowerCase();

// ---- moneda de display + tipo de cambio ----
export function getCurrency() { return read(KEY, {}).currency === 'ARS' ? 'ARS' : 'USD'; }
export function getRate() { const r = Number(read(KEY, {}).rate); return r > 0 ? r : DEFAULT_RATE; }
export function setCurrency(c) { const s = read(KEY, {}); s.currency = c === 'ARS' ? 'ARS' : 'USD'; write(KEY, s); }
export function setRate(r) { const s = read(KEY, {}); s.rate = Math.max(1, Number(r) || DEFAULT_RATE); write(KEY, s); }
export function toggleCurrency() { setCurrency(getCurrency() === 'USD' ? 'ARS' : 'USD'); }

export function subscribeMoney(fn) {
  listeners.add(fn);
  const on = () => { try { fn(); } catch {} };
  if (typeof window !== 'undefined') window.addEventListener('viora:money-changed', on);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('viora:money-changed', on);
  };
}

// Convierte un monto en `currency` a USD (base interna).
export function toUSD(amount, currency) {
  const a = Number(amount) || 0;
  return currency === 'ARS' ? a / getRate() : a;
}

// Formatea un monto USD en la moneda de display actual.
// USD → "US$12.34" · ARS → "$17.276" (pesos, sin decimales, separador de miles).
export function fmtMoney(usd, opts = {}) {
  if (usd == null || isNaN(usd)) return '—';
  if (getCurrency() === 'ARS') {
    const ars = usd * getRate();
    const dec = opts.decimals != null ? opts.decimals : 0;
    return '$' + new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(ars);
  }
  const dec = opts.decimals != null ? opts.decimals : 2;
  return 'US$' + new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(usd);
}

// ---- LEDGER de cargas por persona ----
// Guardamos un ARRAY de entradas { amount, currency, ts } por persona: cada
// transferencia se ACUMULA (no se pisa). Así llevás el historial de ingresos y
// el "cargó" total es la suma. Cada entrada conserva su moneda original (pueden
// cargar pesos un día y dólares otro).
function readPeople() {
  const raw = read(PEOPLE_KEY, {});
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (Array.isArray(v)) out[k] = v;
    // Migración del formato viejo (single { amount, currency, setAt }) → 1 entrada.
    else if (v && typeof v === 'object' && v.amount != null) {
      out[k] = [{ amount: v.amount, currency: v.currency || 'ARS', ts: v.setAt || new Date().toISOString() }];
    }
  }
  return out;
}

// Todas las cargas de una persona (array de { amount, currency, ts }).
export function getPersonLoads(name) {
  return readPeople()[normalize(name)] || [];
}
// Agrega UNA carga (se acumula sobre las anteriores).
export function addPersonLoad(name, amount, currency) {
  const key = normalize(name);
  if (!key || !(Number(amount) > 0)) return;
  const all = readPeople();
  const entry = { amount: Number(amount), currency: currency === 'ARS' ? 'ARS' : 'USD', ts: new Date().toISOString() };
  all[key] = [...(all[key] || []), entry];
  write(PEOPLE_KEY, all);
}
// Borra una carga puntual por su timestamp.
export function removePersonLoad(name, ts) {
  const key = normalize(name);
  const all = readPeople();
  if (!all[key]) return;
  all[key] = all[key].filter(e => e.ts !== ts);
  if (all[key].length === 0) delete all[key];
  write(PEOPLE_KEY, all);
}
// Total cargado por la persona, en USD (base) para restarle el gasto.
export function getPersonLoadedUSD(name) {
  return getPersonLoads(name).reduce((s, e) => s + toUSD(e.amount, e.currency), 0);
}
