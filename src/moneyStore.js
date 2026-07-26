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

// ---- saldo cargado por persona ----
// Guardamos { amount, currency, setAt } con el monto ORIGINAL que transfirió
// (en pesos o USD) para no perder el valor exacto que puso.
export function getPersonLoaded(name) {
  return read(PEOPLE_KEY, {})[normalize(name)] || null;
}
export function setPersonLoaded(name, amount, currency) {
  const all = read(PEOPLE_KEY, {});
  const key = normalize(name);
  if (!key) return;
  if (!(Number(amount) > 0)) delete all[key];
  else all[key] = { amount: Number(amount), currency: currency === 'ARS' ? 'ARS' : 'USD', setAt: new Date().toISOString() };
  write(PEOPLE_KEY, all);
}
// Lo que cargó la persona, expresado en USD (base) para restarle el gasto.
export function getPersonLoadedUSD(name) {
  const e = getPersonLoaded(name);
  return e ? toUSD(e.amount, e.currency) : 0;
}
