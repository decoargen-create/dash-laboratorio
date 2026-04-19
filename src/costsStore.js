// Store de costos reales de ejecución.
//
// Cada vez que el cliente llama un endpoint que cuesta plata (Claude,
// Whisper, Apify, Meta), después de recibir la respuesta logueamos el
// costo real (que el backend devuelve en el field `cost` de la response).
//
// GastosStack consume estos logs para mostrar "gasto acumulado del mes"
// por servicio, en lugar de que el user tenga que cargar el número
// manualmente en el dashboard de billing de cada plataforma.
//
// Shape del log:
//   {
//     id, ts (ISO), autoTipo: 'anthropic'|'openai'|'apify'|'meta',
//     amount (USD), descripcion: 'deep-analyze · ad abc' ...
//   }

const STORAGE_KEY = 'viora-costs-log-v1';

function loadLogs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveLogs(logs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(logs)); } catch {}
}

function genId() {
  return `cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Agrega un log. amount en USD. autoTipo = categoría del servicio.
export function logCost({ autoTipo, amount, descripcion }) {
  if (!autoTipo || !(amount > 0)) return;
  const logs = loadLogs();
  const nuevo = {
    id: genId(),
    ts: new Date().toISOString(),
    autoTipo,
    amount: Math.round(amount * 10000) / 10000, // 4 decimales (centavos del centavo)
    descripcion: String(descripcion || '').slice(0, 200),
  };
  // Capamos a últimos 5000 logs para no explotar localStorage.
  const next = [nuevo, ...logs].slice(0, 5000);
  saveLogs(next);
  return nuevo;
}

// Helper: loguea de una sola los costs que vinieron en una response del backend.
// Devuelve el breakdown + total, para que el caller pueda acumular el gasto
// de la corrida actual en vivo (además de quedar persistido en el store).
export function logCostsFromResponse(respData, descripcion) {
  const zero = { anthropic: 0, openai: 0, apify: 0, meta: 0, total: 0 };
  if (!respData?.cost) return zero;
  const { anthropic = 0, openai = 0, apify = 0, meta = 0 } = respData.cost;
  if (anthropic > 0) logCost({ autoTipo: 'anthropic', amount: anthropic, descripcion });
  if (openai > 0) logCost({ autoTipo: 'openai', amount: openai, descripcion });
  if (apify > 0) logCost({ autoTipo: 'apify', amount: apify, descripcion });
  if (meta > 0) logCost({ autoTipo: 'meta', amount: meta, descripcion });
  return {
    anthropic: anthropic || 0,
    openai: openai || 0,
    apify: apify || 0,
    meta: meta || 0,
    total: (anthropic || 0) + (openai || 0) + (apify || 0) + (meta || 0),
  };
}

// Devuelve el gasto acumulado de un autoTipo dado en el mes actual
// (según horario Argentina) o en un rango custom.
export function spendThisMonth(autoTipo) {
  const logs = loadLogs();
  const now = new Date();
  const yyyymm = now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
  return logs
    .filter(l => l.autoTipo === autoTipo)
    .filter(l => l.ts.slice(0, 10).toLocaleString().startsWith(yyyymm) || (() => {
      try {
        return new Date(l.ts).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).startsWith(yyyymm);
      } catch { return false; }
    })())
    .reduce((sum, l) => sum + (l.amount || 0), 0);
}

export function spendToday(autoTipo) {
  const logs = loadLogs();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  return logs
    .filter(l => l.autoTipo === autoTipo)
    .filter(l => {
      try {
        return new Date(l.ts).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) === today;
      } catch { return false; }
    })
    .reduce((sum, l) => sum + (l.amount || 0), 0);
}

// Para la UI, devuelve los últimos N logs (más recientes primero).
export function recentLogs(n = 100) {
  return loadLogs().slice(0, n);
}

// Borra todos los logs (útil para reset mensual manual).
export function clearLogs() {
  saveLogs([]);
}

// Catálogo de autoTipos conocidos — usado por GastosStack para mapear
// logs a servicios.
export const AUTO_TIPO_LABELS = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI (Whisper)',
  apify: 'Apify',
  meta: 'Meta Ads',
};
