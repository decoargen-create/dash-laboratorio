// Cache + precarga de los tableros de Meta (Métricas: testing-insights, y
// Winners: ads-with-insights).
//
// La idea: pegarle a Meta UNA vez, guardar el payload en localStorage y de
// ahí en más la UI abre al instante con lo último que se trajo, mientras
// refresca en segundo plano. prefetchMetricas() se dispara apenas hay sesión
// (App.jsx), así cuando el admin entra a la sección ya está todo cargado.
//
// - Un fetch en vuelo por URL (dedup): si la precarga y la sección piden lo
//   mismo a la vez, viaja un solo request.
// - El cache guardado vence a las 24 h (después de eso mejor spinner que
//   mostrar un tablero de ayer como si fuera de hoy).

import { authHeaders } from './MetaConnect.jsx';

const TTL_GUARDADO = 24 * 60 * 60 * 1000;
const PREFIJO = 'adslab-meta-cache-';
// Mismas claves que usa MetricasSection para la cuenta/preset elegidos.
const LS_ACCOUNT = 'adslab-testeos-account';
const LS_PRESET = 'adslab-testeos-preset';
const LS_CONNID = 'adslab-testeos-connid';

const _inflight = new Map();

function claveDe(path) {
  // La connection no cambia el contenido (es auth), así que no entra en la clave.
  return `${PREFIJO}${path}`;
}

export function leerCacheMeta(path) {
  try {
    const raw = localStorage.getItem(claveDe(path));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (!ts || !data || Date.now() - ts > TTL_GUARDADO) return null;
    return { ts, data };
  } catch { return null; }
}

function guardarCacheMeta(path, data) {
  try {
    localStorage.setItem(claveDe(path), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Cuota llena: limpiamos nuestros caches viejos y reintentamos una vez.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIJO)) localStorage.removeItem(k);
      }
      localStorage.setItem(claveDe(path), JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  }
}

// Guarda la conexión elegida para que la precarga del próximo login sepa con
// qué credencial pedir (MetricasSection la llama al cambiar de cuenta).
export function recordarConnId(connId) {
  try {
    if (connId && connId !== '__cookie__') localStorage.setItem(LS_CONNID, connId);
    else localStorage.removeItem(LS_CONNID);
  } catch {}
}

// Fetch con dedup + cache. Devuelve el payload fresco (y lo deja guardado).
export async function fetchMeta(path, { connId } = {}) {
  let u = `/api/meta/${path}`;
  if (connId && connId !== '__cookie__') {
    u += `${u.includes('?') ? '&' : '?'}connection_id=${encodeURIComponent(connId)}`;
  }
  if (_inflight.has(u)) return _inflight.get(u);
  const p = (async () => {
    const r = await fetch(u, { headers: await authHeaders(false) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    guardarCacheMeta(path, d);
    return d;
  })().finally(() => _inflight.delete(u));
  _inflight.set(u, p);
  return p;
}

export function pathTestingInsights(accountId, preset) {
  return `testing-insights?account_id=${encodeURIComponent(accountId)}&date_preset=${encodeURIComponent(preset)}`;
}

export function pathAdsWithInsights(accountId) {
  return `ads-with-insights?account_id=${encodeURIComponent(accountId)}&limit=100`;
}

// Precarga en segundo plano de la ÚLTIMA cuenta usada: el tablero de hoy +
// las cohortes (testing-insights) y los creativos para Winners. Fire &
// forget — si falla (sin Meta conectado, token vencido), no molesta.
export function prefetchMetricas() {
  let accountId = '';
  let preset = 'last_30d';
  let connId = null;
  try {
    accountId = localStorage.getItem(LS_ACCOUNT) || '';
    preset = localStorage.getItem(LS_PRESET) || 'last_30d';
    connId = localStorage.getItem(LS_CONNID) || null;
  } catch {}
  if (!accountId) return;
  fetchMeta(pathTestingInsights(accountId, preset), { connId }).catch(() => {});
  fetchMeta(pathAdsWithInsights(accountId), { connId }).catch(() => {});
}
