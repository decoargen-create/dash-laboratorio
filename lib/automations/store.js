// Store KV de automations del Meta Ads Publisher.
//
// Una "automation" representa la config de UN tenant (cliente) para que el
// cron orchestrator (Fase 4) la procese cada run.
//
// Layout en KV:
//   automation:{id}                  → JSON del automation
//   automations:by-user:{userId}     → set de IDs (lista del user en UI)
//   automations:enabled              → set de IDs habilitadas (cron iter)
//
// Un userId es el `id` que devuelve validateSession (username || email,
// lowercased). Estable mientras el user no cambie su identidad.
//
// Límites:
//   AUTOMATIONS_MAX_PER_USER (env, default 5)

import { kv } from '@vercel/kv';
import crypto from 'node:crypto';

const KEY_AUTO = (id) => `automation:${id}`;
const KEY_BY_USER = (userId) => `automations:by-user:${userId}`;
const KEY_ENABLED = 'automations:enabled';

/**
 * @typedef {Object} Automation
 * @property {string} id
 * @property {string} userId             - estable (username/email lowercased)
 * @property {string} name               - display name de la automation
 * @property {boolean} enabled
 * @property {string} adAccountId        - "act_XXXXX"
 * @property {string} pageId
 * @property {string} pixelId
 * @property {string} igUserId
 * @property {string} productLink
 * @property {string} driveRootFolderId
 * @property {string|null} discordWebhookUrl
 * @property {number} dailyBudgetCents
 * @property {string} [campaignNameTemplate]
 * @property {string} createdAt          - ISO
 * @property {string} updatedAt          - ISO
 * @property {string} [lastRunAt]        - ISO, escrito por el cron
 * @property {string} [lastRunStatus]    - human-readable
 */

export const DEFAULT_MAX_PER_USER = 5;

function maxPerUser() {
  const n = Number(process.env.AUTOMATIONS_MAX_PER_USER);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PER_USER;
}

function newId() {
  // Short, URL-safe ID. Suficientemente único para 50 tenants × 5 automations.
  return crypto.randomBytes(8).toString('hex');
}

/**
 * @param {string} id
 * @returns {Promise<Automation | null>}
 */
export async function getAutomation(id) {
  if (!id) return null;
  const data = await kv.get(KEY_AUTO(id));
  return data || null;
}

/**
 * Trae varios automations en una pasada. Útil para list/listEnabled.
 * @param {string[]} ids
 * @returns {Promise<Automation[]>}
 */
export async function getManyAutomations(ids) {
  if (!ids || ids.length === 0) return [];
  // mget devuelve array paralelo a ids (null para los inexistentes).
  const keys = ids.map(KEY_AUTO);
  const data = await kv.mget(...keys);
  return (data || []).filter(Boolean);
}

/**
 * Lista las automations de un user (todas, enabled y disabled).
 *
 * @param {string} userId
 * @returns {Promise<Automation[]>}
 */
export async function listAutomationsByUser(userId) {
  if (!userId) return [];
  const ids = await kv.smembers(KEY_BY_USER(userId));
  return getManyAutomations(ids || []);
}

/**
 * Lista TODAS las automations enabled del sistema. Lo usa el cron orchestrator.
 * @returns {Promise<Automation[]>}
 */
export async function listEnabledAutomations() {
  const ids = await kv.smembers(KEY_ENABLED);
  const all = await getManyAutomations(ids || []);
  // Defensive: si una entry quedó en el set enabled pero su flag es false
  // o se borró, la filtramos acá (el set podría quedar desync por bug).
  return all.filter(a => a && a.enabled);
}

/**
 * Cuenta cuántas automations tiene un user (para enforcer del límite).
 */
export async function countAutomationsByUser(userId) {
  if (!userId) return 0;
  const n = await kv.scard(KEY_BY_USER(userId));
  return n || 0;
}

/**
 * Crea una nueva automation. Asume que `data` ya está validado por el caller.
 *
 * @param {string} userId
 * @param {Omit<Automation, 'id' | 'userId' | 'createdAt' | 'updatedAt'>} data
 * @returns {Promise<Automation>}
 */
export async function createAutomation(userId, data) {
  if (!userId) throw new Error('createAutomation: userId requerido');

  const limit = maxPerUser();
  const current = await countAutomationsByUser(userId);
  if (current >= limit) {
    const err = new Error(`Llegaste al límite de ${limit} automations por user`);
    err.code = 'limit-reached';
    throw err;
  }

  const id = newId();
  const now = new Date().toISOString();
  const automation = {
    id,
    userId,
    name: data.name,
    enabled: !!data.enabled,
    adAccountId: data.adAccountId,
    pageId: data.pageId,
    pixelId: data.pixelId,
    igUserId: data.igUserId,
    productLink: data.productLink,
    driveRootFolderId: data.driveRootFolderId,
    discordWebhookUrl: data.discordWebhookUrl || null,
    dailyBudgetCents: Number(data.dailyBudgetCents) || 4000,
    campaignNameTemplate: data.campaignNameTemplate || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await kv.set(KEY_AUTO(id), automation);
  await kv.sadd(KEY_BY_USER(userId), id);
  if (automation.enabled) await kv.sadd(KEY_ENABLED, id);

  return automation;
}

/**
 * Actualiza campos de una automation existente. Solo permite editar campos
 * que el user puede tocar (no userId, id, createdAt).
 *
 * @param {string} id
 * @param {Partial<Automation>} patch
 * @returns {Promise<Automation>}
 */
export async function updateAutomation(id, patch) {
  const current = await getAutomation(id);
  if (!current) {
    const err = new Error('automation no existe');
    err.code = 'not-found';
    throw err;
  }
  const editable = [
    'name', 'enabled',
    'adAccountId', 'pageId', 'pixelId', 'igUserId', 'productLink',
    'driveRootFolderId', 'discordWebhookUrl',
    'dailyBudgetCents', 'campaignNameTemplate',
  ];
  const next = { ...current };
  for (const k of editable) {
    if (patch[k] !== undefined) next[k] = patch[k];
  }
  next.updatedAt = new Date().toISOString();

  await kv.set(KEY_AUTO(id), next);

  // Mantener el set 'enabled' sincronizado.
  const wasEnabled = !!current.enabled;
  const isEnabled = !!next.enabled;
  if (wasEnabled && !isEnabled) await kv.srem(KEY_ENABLED, id);
  else if (!wasEnabled && isEnabled) await kv.sadd(KEY_ENABLED, id);

  return next;
}

/**
 * Borra una automation. NO toca el state KV de runs (queda como histórico).
 * Si querés limpiar el state también, llamar deleteAutomationState aparte.
 */
export async function deleteAutomation(id) {
  const current = await getAutomation(id);
  if (!current) return false;
  await kv.del(KEY_AUTO(id));
  await kv.srem(KEY_BY_USER(current.userId), id);
  await kv.srem(KEY_ENABLED, id);
  return true;
}

/**
 * Borra TODAS las automations de un user + el state KV de cada una.
 * Usado por data-deletion (Fase 7).
 */
export async function deleteAllAutomationsForUser(userId) {
  const ids = await kv.smembers(KEY_BY_USER(userId)) || [];
  for (const id of ids) {
    await kv.del(KEY_AUTO(id));
    await kv.srem(KEY_ENABLED, id);
    // El state KV (meta_ads_publisher:state:{id}) lo borramos también.
    await kv.del(`meta_ads_publisher:state:${id}`);
  }
  await kv.del(KEY_BY_USER(userId));
  return ids.length;
}
