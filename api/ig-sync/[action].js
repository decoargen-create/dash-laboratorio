// Dispatcher para /api/ig-sync/*
//
// Rutas:
//   GET  /api/ig-sync/campaigns?ad_account_id=...&objective=engagement
//     → Lista campañas del ad account (filtradas por objective si viene).
//   GET  /api/ig-sync/ig-accounts
//     → Lista IG business accounts disponibles (iterando pages del user).
//       Devuelve { igUserId, username, pageId, pageName } para cada match.
//   POST /api/ig-sync/check
//     body: { adAccountId, campaignId, igUserId, pageId }
//     → Dry-run: devuelve el plan (renew vs skip) sin escribir nada.
//   POST /api/ig-sync/run
//     body: { adAccountId, campaignId, igUserId, pageId }
//     → Ejecuta el plan. Los 4 campos vienen del body (localStorage del UI)
//       así el user puede probar sin setear env vars.
//   POST /api/ig-sync/cron
//     headers: { authorization: "Bearer {IG_SYNC_CRON_SECRET}" } o se
//             acepta también el header `x-vercel-cron: 1` que Vercel injecta.
//     → Lee config de IG_SYNC_CONFIG env, ejecuta el plan si enabled. Si está
//       deshabilitado o no hay config, devuelve 200 con skip reason.
//
// Los endpoints interactivos (campaigns, ig-accounts, check, run) usan la
// cookie `viora-meta-session` del user conectado. El cron usa
// META_SYSTEM_ACCESS_TOKEN.

import { readMetaCookie, respondJSON } from '../meta/_lib.js';
import {
  graphGet,
  loadSyncConfig, loadSystemToken,
  buildSyncPlan, executeSyncPlan,
} from './_lib.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function getSessionToken(req) {
  const session = readMetaCookie(req);
  if (!session?.accessToken) return null;
  if (session.exp && session.exp < Math.floor(Date.now() / 1000)) return null;
  return session.accessToken;
}

// ----- GET /campaigns -----

async function handleCampaigns(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const token = getSessionToken(req);
  if (!token) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const url = new URL(req.url, 'http://x');
  const adAccountId = url.searchParams.get('ad_account_id');
  const objectiveFilter = url.searchParams.get('objective'); // 'engagement' | null
  if (!adAccountId) return respondJSON(res, 400, { error: 'Falta ad_account_id' });

  try {
    const data = await graphGet(`${adAccountId}/campaigns`, token, {
      fields: 'id,name,objective,status,effective_status,created_time,updated_time',
      effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
      limit: 100,
    });
    let campaigns = (data.data || []).map(c => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effectiveStatus: c.effective_status,
      createdTime: c.created_time,
    }));
    // Filtro por tipo de objective. "engagement" matchea varios objectives
    // según la versión de Meta: POST_ENGAGEMENT (legacy), OUTCOME_ENGAGEMENT
    // (ODAX). Incluimos ambos.
    if (objectiveFilter === 'engagement') {
      const match = new Set([
        'OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT', 'PAGE_LIKES',
        'EVENT_RESPONSES', 'MESSAGES',
      ]);
      campaigns = campaigns.filter(c => match.has(c.objective));
    }
    return respondJSON(res, 200, { campaigns, total: campaigns.length });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// ----- GET /ig-accounts -----
// Para cada Page que el user administra, consultamos su IG business account
// vinculado (si tiene). Devolvemos la lista combinada.

async function handleIgAccounts(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const token = getSessionToken(req);
  if (!token) return respondJSON(res, 401, { error: 'Meta no conectado' });

  try {
    const pagesData = await graphGet('me/accounts', token, {
      fields: 'id,name,instagram_business_account{id,username,profile_picture_url}',
      limit: 100,
    });
    const accounts = (pagesData.data || [])
      .filter(p => p.instagram_business_account?.id)
      .map(p => ({
        igUserId: p.instagram_business_account.id,
        username: p.instagram_business_account.username || null,
        profilePictureUrl: p.instagram_business_account.profile_picture_url || null,
        pageId: p.id,
        pageName: p.name,
      }));
    return respondJSON(res, 200, { accounts, total: accounts.length });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// ----- POST /check -----

async function handleCheck(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  const token = getSessionToken(req);
  if (!token) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const body = await readBody(req);
  const { adAccountId, campaignId, igUserId, pageId } = body || {};
  if (!adAccountId || !campaignId || !igUserId || !pageId) {
    return respondJSON(res, 400, { error: 'Faltan adAccountId, campaignId, igUserId o pageId' });
  }

  const config = {
    adAccountId: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
    campaignId: String(campaignId),
    igUserId: String(igUserId),
    pageId: String(pageId),
  };

  try {
    const plan = await buildSyncPlan(config, token);
    return respondJSON(res, 200, { ok: true, plan, dryRun: true });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message, data: err.data || null });
  }
}

// ----- POST /run -----

async function handleRun(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  const token = getSessionToken(req);
  if (!token) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const body = await readBody(req);
  const { adAccountId, campaignId, igUserId, pageId } = body || {};
  if (!adAccountId || !campaignId || !igUserId || !pageId) {
    return respondJSON(res, 400, { error: 'Faltan adAccountId, campaignId, igUserId o pageId' });
  }

  const config = {
    adAccountId: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
    campaignId: String(campaignId),
    igUserId: String(igUserId),
    pageId: String(pageId),
  };

  try {
    const plan = await buildSyncPlan(config, token);
    if (plan.action !== 'renew') {
      return respondJSON(res, 200, { ok: true, skipped: true, plan });
    }
    const result = await executeSyncPlan(plan, token);
    return respondJSON(res, result.status === 'failed' ? 500 : 200, { ok: result.status !== 'failed', ...result });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message, data: err.data || null });
  }
}

// ----- POST /cron -----

function isAuthorizedCron(req) {
  // Vercel Cron envía header `x-vercel-cron: 1` en cada ejecución. También
  // aceptamos un Bearer token manual (IG_SYNC_CRON_SECRET) por si alguien
  // quiere dispararlo a mano desde un cron externo.
  if (req.headers['x-vercel-cron']) return true;
  const secret = process.env.IG_SYNC_CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${secret}`;
}

async function handleCron(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return respondJSON(res, 405, { error: 'Method not allowed' });
  }
  if (!isAuthorizedCron(req)) {
    return respondJSON(res, 401, { error: 'Cron no autorizado' });
  }

  const config = loadSyncConfig();
  if (!config) {
    return respondJSON(res, 200, {
      skipped: true,
      reason: 'IG_SYNC_CONFIG no configurada o inválida',
    });
  }
  if (!config.enabled) {
    return respondJSON(res, 200, { skipped: true, reason: 'IG_SYNC_CONFIG.enabled=false' });
  }

  const token = loadSystemToken();
  if (!token) {
    return respondJSON(res, 500, {
      error: 'Falta META_SYSTEM_ACCESS_TOKEN (o META_LONG_LIVED_TOKEN) para que el cron llame a Graph API sin cookie',
    });
  }

  try {
    const plan = await buildSyncPlan(config, token);
    console.log('[ig-sync/cron] plan:', JSON.stringify(plan));
    if (plan.action !== 'renew') {
      return respondJSON(res, 200, { ok: true, skipped: true, plan });
    }
    const result = await executeSyncPlan(plan, token);
    console.log('[ig-sync/cron] result:', JSON.stringify({
      status: result.status,
      results: result.results,
      error: result.error,
    }));
    return respondJSON(res, result.status === 'failed' ? 500 : 200, { ok: result.status !== 'failed', ...result });
  } catch (err) {
    console.error('[ig-sync/cron] error:', err);
    return respondJSON(res, err.status || 502, { error: err.message, data: err.data || null });
  }
}

// ----- Dispatcher -----

const actions = {
  campaigns: handleCampaigns,
  'ig-accounts': handleIgAccounts,
  check: handleCheck,
  run: handleRun,
  cron: handleCron,
};

export default async function handler(req, res) {
  const action = req.query.action;
  const h = actions[action];
  if (!h) return respondJSON(res, 404, { error: `Unknown ig-sync action: ${action}` });
  return h(req, res);
}
