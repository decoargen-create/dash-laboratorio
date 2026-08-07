// Capa de moneda de la plataforma.
//
// Los costos internos están en USD (así los devuelven las APIs). Este store
// agrega:
//  1. Preferencia de display ARS / USD (switch global) + tipo de cambio editable.
//  2. fmtMoney(usd): formatea un monto USD en la moneda elegida.
//  3. Saldo cargado por PERSONA (responsable): cada persona (Vito, Lucas, VYA…)
//     transfiere plata; se registra cuánto cargó para llevar su saldo aparte,
//     aunque todo corra bajo el mismo login.

import { supabase } from './supabase.js';

const KEY = 'adslab-money-v1';
const PEOPLE_KEY = 'adslab-people-loaded-v1';
const DEFAULT_RATE = 1400; // ARS por USD — editable desde el switch.
const TABLE = 'money_settings';

const listeners = new Set();

// ── Estado del sync con la nube ──
let _userId = null;      // uuid del dueño logueado (null = modo 100% local)
let _ready = false;      // ya hidratamos de la nube
let _pushTimer = null;   // debounce del push
let _pendingPush = false;// hubo un cambio local mientras hidratábamos

function read(k, fallback) {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
// Notifica a la UI (sin tocar la nube).
function notify() {
  listeners.forEach(fn => { try { fn(); } catch {} });
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('viora:money-changed')); } catch {}
  }
}
// Escribe local + notifica + agenda push a la nube. Es el camino de TODA
// escritura del usuario (moneda, tipo de cambio, cargas por persona).
function write(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  notify();
  schedulePush();
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

// =========================================================================
// SYNC CON LA NUBE (Supabase, tabla money_settings — una fila por usuario).
// Patrón igual al de Producción: escribimos local al instante (para pintar ya)
// y empujamos a la nube en segundo plano. Al loguear, hidratamos de la nube.
// =========================================================================

// Saldos de APIs (Anthropic/OpenAI) que administra balanceStore.js. Los
// leemos/escribimos por su clave de localStorage (sin importar el módulo, para
// no acoplar) y viajan dentro del MISMO blob → moneyStore es el ÚNICO escritor
// de money_settings, así no hay clobber entre módulos.
const BALANCES_KEY = 'adslab-balances-v1';
function readBalances() {
  try { const r = localStorage.getItem(BALANCES_KEY); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}

// Snapshot del estado local → blob que guardamos en la nube.
function snapshot() {
  const s = read(KEY, {});
  return {
    currency: s.currency === 'ARS' ? 'ARS' : 'USD',
    rate: Number(s.rate) > 0 ? Number(s.rate) : DEFAULT_RATE,
    people: readPeople(),
    balances: readBalances(),
  };
}

// ¿Hay algo local que valga la pena sembrar en la nube vacía?
function hasLocalContent() {
  if (Object.keys(readPeople()).length > 0) return true;
  if (Object.keys(readBalances()).length > 0) return true;
  const s = read(KEY, {});
  return s.currency != null || s.rate != null;
}

// Aplica un blob de la nube al localStorage y refresca la UI — SIN re-empujar.
function applyToLocal(data) {
  if (!data || typeof data !== 'object') return;
  const s = read(KEY, {});
  if (data.currency) s.currency = data.currency === 'ARS' ? 'ARS' : 'USD';
  if (Number(data.rate) > 0) s.rate = Number(data.rate);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  if (data.people && typeof data.people === 'object') {
    try { localStorage.setItem(PEOPLE_KEY, JSON.stringify(data.people)); } catch {}
  }
  if (data.balances && typeof data.balances === 'object') {
    try { localStorage.setItem(BALANCES_KEY, JSON.stringify(data.balances)); } catch {}
    // Avisamos a balanceStore/BalanceBar que los saldos cambiaron (cross-módulo).
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('viora:balances-changed')); } catch {}
    }
  }
  notify();
}

// Lo llama balanceStore cuando el user cambia un saldo de API: agenda el push
// del blob (que ya incluye los balances vía snapshot). Así balanceStore no
// escribe money_settings directo (evita clobber) — moneyStore sigue siendo el
// único escritor.
export function pokeMoneySync() {
  schedulePush();
}

function schedulePush() {
  if (!_userId || !supabase) return;
  if (!_ready) { _pendingPush = true; return; } // todavía hidratando
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(pushCloud, 400);
}

async function pushCloud() {
  _pushTimer = null;
  if (!_userId || !supabase) return;
  try {
    await supabase.from(TABLE).upsert(
      { user_id: _userId, data: snapshot(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  } catch { /* queda local; se reintenta en la próxima escritura */ }
}

// Arranca el sync al loguear. Hidrata de la nube (o siembra la nube con lo que
// haya local la primera vez). Idempotente por userId.
export async function initMoneySync({ userId } = {}) {
  if (!userId || !supabase) return;
  if (_userId === userId && _ready) return;
  _userId = userId;
  _ready = false;
  _pendingPush = false;
  try {
    const { data: row, error } = await supabase
      .from(TABLE).select('data').eq('user_id', userId).maybeSingle();
    if (!error && row) {
      // La nube manda: aplicamos lo guardado (puede ser {} si nunca cargó nada).
      applyToLocal(row.data || {});
    } else if (!error && hasLocalContent()) {
      // No hay fila en la nube pero este dispositivo TIENE datos → sembramos.
      _ready = true;
      await pushCloud();
    }
  } catch { /* seguimos en modo local */ }
  _ready = true;
  if (_pendingPush) { _pendingPush = false; schedulePush(); }
}

export function teardownMoneySync() {
  _userId = null;
  _ready = false;
  _pendingPush = false;
  if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null; }
}
