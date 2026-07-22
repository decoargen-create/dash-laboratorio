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

import { supabase } from './supabase.js';

const STORAGE_KEY = 'adslab-costs-log-v1';

// Ids de logs que YA estaban sincronizados al cloud cuando cargó el módulo.
// Esos se excluyen de los totales LOCALES (los cuenta el fetch cloud). Los
// que se sincronizan DURANTE la sesión siguen contando local — el fetch
// cloud de Arranque corre al mount y no los incluye, así no se duplica.
let SYNCED_AT_LOAD = new Set();
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    for (const l of JSON.parse(raw)) {
      if (l?.synced && l?.id) SYNCED_AT_LOAD.add(l.id);
    }
  }
} catch {}

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

// Mapea el prefijo de la descripcion a una categoría de gasto legible.
// Así el caller no tiene que pasar `kind` a mano — la descripcion ya lo
// codifica ('apify-ingest · Marca' → scrape, 'deep-analyze · ...' → análisis).
const KIND_PATTERNS = [
  { kind: 'scrape',     re: /^(apify-ingest|inspiracion(?!-global)|scrape)/i },
  { kind: 'análisis',   re: /^(deep-analyze|ocr|whisper|post-research-analysis|match-product-ads|score-hooks|suggest-competitors)/i },
  { kind: 'ideas',      re: /^(generate-ideas|generador rápido|bulk-bandeja|adapt-inspiracion|adapt-guion)/i },
  { kind: 'creativos',  re: /^(crear-creativo-referencial|crear-imagen-desde-idea|creativos|winners|inspiracion-global)/i },
  { kind: 'research',   re: /^(research|docs|generate\b)/i },
  { kind: 'copy',       re: /^(generate-copy|copy)/i },
  { kind: 'copilot',    re: /^copilot/i },
];

// Dual-write al cloud (marketing_costs) — best effort, fire and forget.
// Requiere sesión Supabase + migration 0018 (insert policy + client_id).
// Si falla (offline, sin sesión, migration pendiente), el log queda local
// como siempre — cero regresión.
async function syncLogToCloud(log) {
  if (!supabase || !log?.productoId) return false;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return false;
    const { error } = await supabase.from('marketing_costs').upsert({
      user_id: user.id,
      producto_id: String(log.productoId),
      auto_tipo: log.autoTipo,
      amount: log.amount,
      descripcion: log.descripcion,
      kind: log.kind || null,
      source: 'client',
      client_id: log.id,
      created_at: log.ts,
    }, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
    if (error) {
      console.warn('[costs] cloud sync falló (¿migration 0018?):', error.message);
      return false;
    }
    return true;
  } catch { return false; }
}

// Recomputa el set de exclusión con TODOS los logs ya sincronizados.
// El caller (Arranque) lo llama justo DESPUÉS de refetchear los totales
// cloud y ANTES de empujar el backlog: así lo que el fetch ya cuenta se
// deja de contar local, y lo que se sincronice después del fetch sigue
// contando local hasta el próximo refetch. Sin esto, navegar fuera y
// volver a Productos duplicaba lo sincronizado durante la sesión.
export function promoteSyncedCosts() {
  const s = new Set();
  for (const l of loadLogs()) {
    if (l?.synced && l?.id) s.add(l.id);
  }
  SYNCED_AT_LOAD = s;
}

function markSynced(id) {
  try {
    const logs = loadLogs();
    const l = logs.find(x => x.id === id);
    if (l) { l.synced = true; saveLogs(logs); }
  } catch {}
}

function inferKind(descripcion) {
  const d = String(descripcion || '');
  for (const p of KIND_PATTERNS) {
    if (p.re.test(d)) return p.kind;
  }
  return 'otros';
}

// Agrega un log. amount en USD. autoTipo = categoría del servicio.
// productoId (opcional): atribuye el gasto a un producto — habilita el
// resumen de costos por producto. kind (opcional): categoría de la
// operación; si no viene, se infiere de la descripcion.
export function logCost({ autoTipo, amount, descripcion, productoId = null, kind = null }) {
  if (!autoTipo || !(amount > 0)) return;
  const logs = loadLogs();
  const nuevo = {
    id: genId(),
    ts: new Date().toISOString(),
    autoTipo,
    amount: Math.round(amount * 10000) / 10000, // 4 decimales (centavos del centavo)
    descripcion: String(descripcion || '').slice(0, 200),
    productoId: productoId != null ? String(productoId) : null,
    kind: kind || inferKind(descripcion),
  };
  // Capamos a últimos 5000 logs para no explotar localStorage.
  const next = [nuevo, ...logs].slice(0, 5000);
  saveLogs(next);
  // Aviso global para que widgets de saldo se actualicen al toque.
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('viora:cost-logged', { detail: nuevo })); } catch {}
  }
  // Dual-write cloud (cross-device). Fire and forget.
  syncLogToCloud(nuevo).then(ok => { if (ok) markSynced(nuevo.id); });
  return nuevo;
}

// Empuja al cloud los logs locales con productoId que aún no se sincronizaron
// (histórico previo a la migration 0018 + fallos de red). Idempotente por
// (user_id, client_id). Llamar una vez por sesión desde la UI.
export async function pushUnsyncedCostsToCloud({ max = 300 } = {}) {
  if (!supabase) return 0;
  const pendientes = loadLogs().filter(l => l.productoId && !l.synced).slice(0, max);
  if (pendientes.length === 0) return 0;
  let ok = 0;
  // Secuencial en chunks chicos para no saturar; upsert ignora duplicados.
  for (const l of pendientes) {
    if (await syncLogToCloud(l)) { markSynced(l.id); ok++; }
    else break; // primer fallo (sin sesión / sin migration) → cortar, no insistir
  }
  return ok;
}

// Total gastado para un autoTipo DESDE un timestamp ISO.
// Usado por el widget de saldo: vos cargás saldo $20 a las 10am, después
// el widget muestra $20 - (lo gastado desde las 10am).
export function spendSince(autoTipo, sinceIso) {
  if (!sinceIso) return 0;
  const sinceMs = new Date(sinceIso).getTime();
  if (isNaN(sinceMs)) return 0;
  return loadLogs()
    .filter(l => l.autoTipo === autoTipo)
    .filter(l => new Date(l.ts).getTime() >= sinceMs)
    .reduce((sum, l) => sum + (l.amount || 0), 0);
}

// Helper: loguea de una sola los costs que vinieron en una response del backend.
// Devuelve el breakdown + total, para que el caller pueda acumular el gasto
// de la corrida actual en vivo (además de quedar persistido en el store).
// opts.productoId: atribuye el gasto al producto (para el resumen per-product).
export function logCostsFromResponse(respData, descripcion, opts = {}) {
  const zero = { anthropic: 0, openai: 0, apify: 0, meta: 0, total: 0 };
  if (!respData?.cost) return zero;
  const { anthropic = 0, openai = 0, apify = 0, meta = 0 } = respData.cost;
  const { productoId = null, kind = null } = opts;
  if (anthropic > 0) logCost({ autoTipo: 'anthropic', amount: anthropic, descripcion, productoId, kind });
  if (openai > 0) logCost({ autoTipo: 'openai', amount: openai, descripcion, productoId, kind });
  if (apify > 0) logCost({ autoTipo: 'apify', amount: apify, descripcion, productoId, kind });
  if (meta > 0) logCost({ autoTipo: 'meta', amount: meta, descripcion, productoId, kind });
  return {
    anthropic: anthropic || 0,
    openai: openai || 0,
    apify: apify || 0,
    meta: meta || 0,
    total: (anthropic || 0) + (openai || 0) + (apify || 0) + (meta || 0),
  };
}

// Resumen de gasto de UN producto: total + breakdown por servicio (autoTipo)
// + breakdown por tipo de operación (kind) + últimos N logs. La base para el
// panel "cuánto gasté en este producto".
export function spendByProducto(productoId, { sinceIso = null, recentN = 30 } = {}) {
  const pid = String(productoId || '');
  if (!pid) return { total: 0, byService: {}, byKind: {}, recent: [], count: 0 };
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : null;
  const logs = loadLogs().filter(l => {
    if (l.productoId !== pid) return false;
    if (SYNCED_AT_LOAD.has(l.id)) return false; // los cuenta el cloud fetch
    if (sinceMs != null) {
      const t = new Date(l.ts).getTime();
      if (isNaN(t) || t < sinceMs) return false;
    }
    return true;
  });
  const byService = {};
  const byKind = {};
  let total = 0;
  for (const l of logs) {
    total += l.amount || 0;
    byService[l.autoTipo] = (byService[l.autoTipo] || 0) + (l.amount || 0);
    const k = l.kind || 'otros';
    byKind[k] = (byKind[k] || 0) + (l.amount || 0);
  }
  return { total, byService, byKind, recent: logs.slice(0, recentN), count: logs.length };
}

// Totales por producto para TODOS los productos con gasto — para mostrar el
// chip "$X" en cada card de la lista sin computar N veces.
export function spendAllProductos() {
  const map = {};
  for (const l of loadLogs()) {
    if (!l.productoId) continue;
    // Sincronizados ANTES de esta carga → los cuenta el fetch cloud de
    // Arranque; excluirlos acá evita el doble conteo. Los sincronizados
    // durante la sesión siguen contando local (el fetch cloud fue al mount).
    if (SYNCED_AT_LOAD.has(l.id)) continue;
    map[l.productoId] = (map[l.productoId] || 0) + (l.amount || 0);
  }
  return map;
}

// Logs crudos de un producto (para que el modal pueda mergear con los
// costos cloud del cron y computar los agregados él mismo).
export function logsForProducto(productoId) {
  const pid = String(productoId || '');
  if (!pid) return [];
  return loadLogs().filter(l => l.productoId === pid);
}

// ============================================================
// BACKFILL — atribuir logs HISTÓRICOS (sin productoId) por nombre.
// Las descripciones viejas codifican el nombre del producto, competidor
// o brand ('apify-ingest · Femflorabrand', 'generate-ideas · Tiva',
// 'crear-creativo-referencial · MarcaX · 1/4'). El caller construye el
// mapa {nombreNormalizado → productoId} desde su lista de productos +
// competidores + brands, descartando nombres ambiguos (mismo nombre en
// 2 productos). Corre una vez (el caller guarda el flag done).
// ============================================================
export function normalizeCostName(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function backfillProductoIds(nameToProductoId) {
  if (!nameToProductoId || Object.keys(nameToProductoId).length === 0) return 0;
  const logs = loadLogs();
  let changed = 0;
  for (const l of logs) {
    if (l.productoId) continue;
    // Segmentos de la descripcion: 'op · nombre · resto' o 'op → nombre'.
    const segs = String(l.descripcion || '').split(/[·→]/).map(s => s.trim()).filter(Boolean);
    // Probamos cada segmento DESPUÉS del primero (el primero es la operación).
    for (let i = 1; i < segs.length; i++) {
      const pid = nameToProductoId[normalizeCostName(segs[i])];
      if (pid) {
        l.productoId = String(pid);
        if (!l.kind) l.kind = inferKind(l.descripcion);
        changed++;
        break;
      }
    }
  }
  if (changed > 0) saveLogs(logs);
  return changed;
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
