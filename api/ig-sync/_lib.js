// Helpers para el módulo IG-sync (renovador diario de ad creative).
//
// Qué hace este módulo:
//   Todos los días (vía Vercel Cron), revisa si el último post del IG business
//   configurado ya está publicado como anuncio activo en la campaña indicada.
//   Si no lo está, duplica el ad set activo, crea un ad nuevo con ese post y
//   pausa el ad set viejo.
//
// Config del cron:
//   El cron no tiene acceso al localStorage del navegador, así que la config
//   vive en una env var JSON (`IG_SYNC_CONFIG`) con el shape:
//     {
//       "adAccountId": "act_1234567890",
//       "campaignId":  "1234567890",
//       "igUserId":    "17841...",      // Instagram business account ID
//       "pageId":      "10012...",      // FB Page vinculada al IG business
//       "enabled":     true
//     }
//   La UI ayuda a armar este JSON y muestra el estado actual en env.
//
// Access token:
//   Reusamos la cookie `viora-meta-session` (user access token long-lived)
//   para endpoints interactivos. Para el cron, el cookie no existe — usamos
//   `META_SYSTEM_ACCESS_TOKEN` (long-lived token que el admin pegó una vez).
//   Se recomienda generarlo con un System User del Business Manager para que
//   no expire.

import { META_API_VERSION } from '../meta/_lib.js';

// ---------- Config loader ----------

export function loadSyncConfig() {
  const raw = process.env.IG_SYNC_CONFIG;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { adAccountId, campaignId, igUserId, pageId } = parsed;
    if (!adAccountId || !campaignId || !igUserId || !pageId) return null;
    return {
      adAccountId: String(adAccountId).startsWith('act_') ? String(adAccountId) : `act_${adAccountId}`,
      campaignId: String(campaignId),
      igUserId: String(igUserId),
      pageId: String(pageId),
      enabled: parsed.enabled !== false,
    };
  } catch {
    return null;
  }
}

// Access token de servicio para el cron. Prioridad:
//   1. META_SYSTEM_ACCESS_TOKEN (system user, no expira) — ideal para cron.
//   2. META_LONG_LIVED_TOKEN (fallback: user long-lived, dura 60d).
// Si ninguno está seteado, el cron tira 500.
export function loadSystemToken() {
  return (
    process.env.META_SYSTEM_ACCESS_TOKEN ||
    process.env.META_LONG_LIVED_TOKEN ||
    null
  );
}

// ---------- Graph API helpers (GET + POST) ----------

function buildUrl(path) {
  const clean = path.replace(/^\//, '');
  return new URL(`https://graph.facebook.com/${META_API_VERSION}/${clean}`);
}

export async function graphGet(path, accessToken, params = {}) {
  const url = buildUrl(path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('access_token', accessToken);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!resp.ok || data.error) {
    const msg = data.error?.message || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function graphPost(path, accessToken, body = {}) {
  const url = buildUrl(path);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  form.append('access_token', accessToken);
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) {
    const msg = data.error?.message || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- IG + Meta Marketing helpers ----------

// Último post publicado en el IG business indicado. Usamos /media (no
// /stories) porque queremos feed posts que se puedan promocionar como ads.
// Filtramos por timestamp descendente (Meta ya lo devuelve así por default).
export async function fetchLatestIgPost(igUserId, token) {
  const data = await graphGet(`${igUserId}/media`, token, {
    fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username',
    limit: 5,
  });
  const items = Array.isArray(data.data) ? data.data : [];
  if (items.length === 0) return null;
  // Ya vienen ordenados por fecha desc. Tomamos el primero.
  return items[0];
}

// Ads activos de una campaña, con el IG media de su creative (si tiene).
// Filtramos por `effective_status` para sólo traer los que están corriendo
// (ACTIVE, PENDING_REVIEW, etc. — todo menos PAUSED/DELETED/ARCHIVED).
export async function fetchActiveAdsInCampaign(campaignId, token) {
  const data = await graphGet(`${campaignId}/ads`, token, {
    fields: [
      'id,name,status,effective_status,created_time',
      'adset{id,name,status,effective_status}',
      'creative{id,name,effective_instagram_media_id,instagram_permalink_url,effective_object_story_id,object_story_spec}',
    ].join(','),
    effective_status: JSON.stringify(['ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS', 'WITH_ISSUES']),
    limit: 100,
  });
  return Array.isArray(data.data) ? data.data : [];
}

// Dado un ad, intenta extraer el IG media ID del creative. Meta lo expone
// en varios campos según cómo se creó el ad:
//   - effective_instagram_media_id (el más directo)
//   - instagram_permalink_url → parseamos el shortcode y no lo resolvemos
//     a media_id (sería otra llamada). Por ahora sólo lo usamos para logs.
//   - object_story_spec.instagram_actor_id + ...
// Devolvemos el ID o null.
export function extractIgMediaId(ad) {
  const c = ad?.creative;
  if (!c) return null;
  if (c.effective_instagram_media_id) return String(c.effective_instagram_media_id);
  return null;
}

// Metadata completa del ad set (para poder duplicarlo con el mismo targeting,
// budget, schedule, optimization_goal, billing_event, etc.).
export async function fetchAdSet(adsetId, token) {
  return await graphGet(adsetId, token, {
    fields: [
      'id,name,campaign_id,status,daily_budget,lifetime_budget,bid_amount,',
      'billing_event,optimization_goal,targeting,start_time,end_time,',
      'promoted_object,attribution_spec,destination_type,pacing_type,',
      'bid_strategy',
    ].join(''),
  });
}

// Duplica un ad set dentro de la misma campaña. Meta expone
// POST /{adset_id}/copies que clona el targeting + settings con un suffix
// de nombre automático; pero preferimos usar POST /act_{id}/adsets con los
// campos explícitos para tener control total sobre el name y status.
//
// El clon queda en PAUSED hasta que creamos el ad adentro y lo activamos.
export async function cloneAdSet({ sourceAdSet, adAccountId, newName, token }) {
  const body = {
    name: newName,
    campaign_id: sourceAdSet.campaign_id,
    status: 'PAUSED',
    billing_event: sourceAdSet.billing_event,
    optimization_goal: sourceAdSet.optimization_goal,
    targeting: sourceAdSet.targeting,
    destination_type: sourceAdSet.destination_type,
    bid_strategy: sourceAdSet.bid_strategy,
  };
  if (sourceAdSet.daily_budget) body.daily_budget = sourceAdSet.daily_budget;
  if (sourceAdSet.lifetime_budget) body.lifetime_budget = sourceAdSet.lifetime_budget;
  if (sourceAdSet.bid_amount) body.bid_amount = sourceAdSet.bid_amount;
  if (sourceAdSet.promoted_object) body.promoted_object = sourceAdSet.promoted_object;
  if (sourceAdSet.attribution_spec) body.attribution_spec = sourceAdSet.attribution_spec;
  if (sourceAdSet.pacing_type) body.pacing_type = sourceAdSet.pacing_type;
  // start_time: desde ahora (si el source era una fecha fija del pasado, no
  // sirve reusarla). end_time lo dejamos abierto salvo que el source lo tenga
  // explícito y sea futuro.
  body.start_time = new Date().toISOString();
  if (sourceAdSet.end_time && new Date(sourceAdSet.end_time) > new Date()) {
    body.end_time = sourceAdSet.end_time;
  }

  return await graphPost(`${adAccountId}/adsets`, token, body);
}

// Crea un adcreative que usa un IG media existente como source. Según docs
// de Marketing API v19+, el campo correcto para esto es
// `source_instagram_media_id` combinado con `instagram_user_id`.
// Ref: https://developers.facebook.com/docs/marketing-api/reference/ad-creative
export async function createAdCreativeFromIgMedia({
  adAccountId, igUserId, igMediaId, pageId, name, token,
}) {
  const body = {
    name: name || `IG auto-renew · ${igMediaId}`,
    object_story_spec: JSON.stringify({
      page_id: pageId,
      instagram_user_id: igUserId,
    }),
    source_instagram_media_id: igMediaId,
    instagram_user_id: igUserId,
  };
  return await graphPost(`${adAccountId}/adcreatives`, token, body);
}

// Crea un ad adentro de un ad set, usando un creative existente.
export async function createAd({ adAccountId, adsetId, creativeId, name, token }) {
  return await graphPost(`${adAccountId}/ads`, token, {
    name: name || `IG auto-renew · ${new Date().toISOString().slice(0, 10)}`,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'ACTIVE',
  });
}

// Pausa un ad set entero (todos sus ads dejan de servir).
export async function pauseAdSet({ adsetId, token }) {
  return await graphPost(adsetId, token, { status: 'PAUSED' });
}

// Activa un ad set.
export async function activateAdSet({ adsetId, token }) {
  return await graphPost(adsetId, token, { status: 'ACTIVE' });
}

// ---------- Core sync logic (dry-run + real) ----------

// Plan: inspecciona el estado actual y devuelve qué debería pasar.
// No escribe nada en Meta.
export async function buildSyncPlan(config, token) {
  const { campaignId, igUserId, pageId, adAccountId } = config;

  const [latest, ads] = await Promise.all([
    fetchLatestIgPost(igUserId, token),
    fetchActiveAdsInCampaign(campaignId, token),
  ]);

  if (!latest) {
    return {
      action: 'skip',
      reason: 'No se encontraron posts en el IG business',
      latest: null,
      activeAds: ads.length,
    };
  }

  const latestId = String(latest.id);
  const adsWithThisMedia = ads.filter(a => extractIgMediaId(a) === latestId);

  if (adsWithThisMedia.length > 0) {
    return {
      action: 'skip',
      reason: 'El último post ya está publicado como ad activo',
      latest: { id: latestId, permalink: latest.permalink, timestamp: latest.timestamp, caption: latest.caption?.slice(0, 160) },
      matchedAdIds: adsWithThisMedia.map(a => a.id),
      activeAds: ads.length,
    };
  }

  // Elegimos el ad set activo más reciente como fuente para duplicar.
  // "Más reciente" se mide por created_time del ad (proxy del adset).
  const activeAds = ads.filter(a => a.effective_status === 'ACTIVE' || a.status === 'ACTIVE');
  if (activeAds.length === 0) {
    return {
      action: 'skip',
      reason: 'La campaña no tiene ad sets activos para duplicar',
      latest: { id: latestId, permalink: latest.permalink, timestamp: latest.timestamp },
      activeAds: 0,
    };
  }
  activeAds.sort((a, b) => new Date(b.created_time) - new Date(a.created_time));
  const sourceAd = activeAds[0];
  const sourceAdsetId = sourceAd.adset?.id;
  if (!sourceAdsetId) {
    return {
      action: 'skip',
      reason: 'No pude identificar el ad set activo a duplicar',
      latest: { id: latestId, permalink: latest.permalink, timestamp: latest.timestamp },
    };
  }

  return {
    action: 'renew',
    latest: {
      id: latestId,
      permalink: latest.permalink,
      timestamp: latest.timestamp,
      mediaType: latest.media_type,
      caption: latest.caption?.slice(0, 160) || null,
      thumbnailUrl: latest.thumbnail_url || latest.media_url || null,
    },
    source: {
      adId: sourceAd.id,
      adName: sourceAd.name,
      adsetId: sourceAdsetId,
      adsetName: sourceAd.adset?.name,
    },
    willCloneAdSet: true,
    willCreateAdWithMediaId: latestId,
    willPauseAdSetId: sourceAdsetId,
    context: { adAccountId, campaignId, igUserId, pageId },
  };
}

// Ejecuta el plan: clona ad set, crea creative, crea ad, pausa viejo.
// Cada step loggea al array `log` para que el caller lo pueda exponer.
export async function executeSyncPlan(plan, token) {
  if (plan.action !== 'renew') return { status: 'noop', plan };

  const log = [];
  const push = (level, msg, data) => log.push({ level, msg, data, ts: new Date().toISOString() });

  try {
    push('info', 'Leyendo ad set fuente', { adsetId: plan.source.adsetId });
    const sourceAdSet = await fetchAdSet(plan.source.adsetId, token);

    const dateTag = new Date().toISOString().slice(0, 10);
    const newAdsetName = `${sourceAdSet.name || 'AdSet'} · auto-renew ${dateTag}`;

    push('info', 'Clonando ad set', { name: newAdsetName });
    const clone = await cloneAdSet({
      sourceAdSet, adAccountId: plan.context.adAccountId, newName: newAdsetName, token,
    });
    push('ok', 'Ad set clonado', { adsetId: clone.id });

    push('info', 'Creando ad creative con el último post de IG', { mediaId: plan.latest.id });
    const creative = await createAdCreativeFromIgMedia({
      adAccountId: plan.context.adAccountId,
      igUserId: plan.context.igUserId,
      igMediaId: plan.latest.id,
      pageId: plan.context.pageId,
      name: `IG auto-renew · ${dateTag}`,
      token,
    });
    push('ok', 'Creative creado', { creativeId: creative.id });

    push('info', 'Creando ad en el nuevo ad set');
    const newAd = await createAd({
      adAccountId: plan.context.adAccountId,
      adsetId: clone.id,
      creativeId: creative.id,
      name: `IG auto-renew · ${dateTag}`,
      token,
    });
    push('ok', 'Ad creado y activo', { adId: newAd.id });

    push('info', 'Activando el nuevo ad set');
    await activateAdSet({ adsetId: clone.id, token });
    push('ok', 'Ad set clonado activado');

    push('info', 'Pausando el ad set viejo', { adsetId: plan.willPauseAdSetId });
    await pauseAdSet({ adsetId: plan.willPauseAdSetId, token });
    push('ok', 'Ad set viejo pausado');

    return {
      status: 'done',
      plan,
      results: {
        newAdsetId: clone.id,
        newCreativeId: creative.id,
        newAdId: newAd.id,
        pausedAdsetId: plan.willPauseAdSetId,
      },
      log,
    };
  } catch (err) {
    push('error', err.message, err.data || null);
    return {
      status: 'failed',
      plan,
      error: err.message,
      errorData: err.data || null,
      log,
    };
  }
}
