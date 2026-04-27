// State persistente del Meta Ads Publisher en Vercel KV.
//
// Multi-tenant: una key por automation.
//   - tenantId 'cellu-legacy' → key 'meta_ads_publisher:state' (preserva
//     la key sin sufijo del modo single-tenant para no perder el state que
//     ya está cargado en KV).
//   - cualquier otro tenantId → key 'meta_ads_publisher:state:{tenantId}'.
//
// Shape:
//   {
//     published_folders: string[],     // IDs de carpetas Drive ya publicadas
//     log: LogEntry[],                  // historial completo de publicaciones
//     last_run: string | null,          // ISO timestamp del último run
//     last_run_status: string | null,   // resumen humano
//   }
//
// Un LogEntry shape:
//   {
//     run_at: string,                   // ISO
//     folder_id: string,
//     folder_name: string,
//     product: string,                  // 'Probiotico', 'Cepillo', etc.
//     source: 'Videos' | 'Estaticos',
//     campaign_id: string,
//     adset_id: string,
//     ad_ids: string[],
//     ad_details: { ad_id, ad_name, creative_id, media_id, media_kind }[],
//     status: 'ACTIVE' | 'PARTIAL' | 'FAILED',
//     warnings?: string[],
//   }
//
// Buscamos el reference ad mirando log[] en orden inverso para mismo
// product+source con status ACTIVE → ad_ids[0].

import { kv } from '@vercel/kv';

const LEGACY_KEY = 'meta_ads_publisher:state';
const KEY_PREFIX = 'meta_ads_publisher:state:';

/**
 * Calcula la key KV para un tenantId. 'cellu-legacy' (o vacío) usa la key
 * vieja sin sufijo, así no perdemos el state ya cargado.
 *
 * @param {string} [tenantId]
 */
export function stateKey(tenantId) {
  if (!tenantId || tenantId === 'cellu-legacy') return LEGACY_KEY;
  return `${KEY_PREFIX}${tenantId}`;
}

const EMPTY_STATE = Object.freeze({
  published_folders: [],
  log: [],
  last_run: null,
  last_run_status: null,
});

/**
 * @param {string} [tenantId]
 * @returns {Promise<{
 *   published_folders: string[],
 *   log: any[],
 *   last_run: string | null,
 *   last_run_status: string | null
 * }>}
 */
export async function loadState(tenantId) {
  const data = await kv.get(stateKey(tenantId));
  if (!data || typeof data !== 'object') return { ...EMPTY_STATE, published_folders: [], log: [] };
  // Defensive: garantizar shape aún si quedó corrupto.
  return {
    published_folders: Array.isArray(data.published_folders) ? data.published_folders : [],
    log: Array.isArray(data.log) ? data.log : [],
    last_run: typeof data.last_run === 'string' ? data.last_run : null,
    last_run_status: typeof data.last_run_status === 'string' ? data.last_run_status : null,
  };
}

/**
 * @param {string} tenantId
 * @param {object} state
 */
export async function saveState(tenantId, state) {
  await kv.set(stateKey(tenantId), state);
}

/**
 * Busca el reference ad más reciente para un product+source dado.
 * @param {{ log: any[] }} state
 * @param {string} product
 * @param {'Videos'|'Estaticos'} source
 * @returns {string | null} ad_id de referencia o null si no hay
 */
export function findReferenceAdId(state, product, source) {
  const log = state.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.product === product && e.source === source && e.status === 'ACTIVE') {
      const adIds = Array.isArray(e.ad_ids) ? e.ad_ids : [];
      if (adIds.length > 0) return adIds[0];
    }
  }
  return null;
}
