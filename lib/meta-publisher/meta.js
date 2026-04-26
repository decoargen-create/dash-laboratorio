// Helpers de Meta Graph API (v21.0) para el publisher.
//
// Todas las llamadas usan METASYSTEM_ACCESS_TOKEN (System User long-lived).
// Diseño: cada función hace UNA cosa y devuelve el JSON parseado, o tira un
// Error con .status / .data / .code para que el caller pueda decidir.
//
// Convenciones de la cuenta Cellu (vienen del prompt del usuario):
//   daily_budget = 4000 (centavos en USD → $40)
//   bid_strategy = LOWEST_COST_WITHOUT_CAP
//   billing_event = IMPRESSIONS
//   optimization_goal = OFFSITE_CONVERSIONS
//   custom_event_type = PURCHASE
//   targeting AR, age 18-65, advantage_audience habilitado
//   attribution: 7d click + 1d view
//   text_optimizations OPT_IN (no standard_enhancements)

const META_API = 'https://graph.facebook.com/v21.0';

function getToken() {
  const t = process.env.META_SYSTEM_ACCESS_TOKEN;
  if (!t) throw new Error('META_SYSTEM_ACCESS_TOKEN no configurada');
  return t;
}

function buildErr(data, status) {
  const msg = data?.error?.message || `HTTP ${status}`;
  const e = new Error(msg);
  e.status = status;
  e.data = data;
  e.code = data?.error?.code;
  e.subcode = data?.error?.error_subcode;
  e.fbtraceId = data?.error?.fbtrace_id;
  return e;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * GET contra Graph API.
 */
export async function metaGet(path, params = {}) {
  const url = new URL(`${META_API}/${String(path).replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  url.searchParams.set('access_token', getToken());
  const r = await fetch(url.toString());
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) throw buildErr(data, r.status);
  return data;
}

/**
 * POST contra Graph API con form-urlencoded (lo que Marketing API espera).
 */
export async function metaPost(path, body = {}) {
  const url = `${META_API}/${String(path).replace(/^\//, '')}`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  form.set('access_token', getToken());
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) throw buildErr(data, r.status);
  return data;
}

// --- Reference ad / creative spec ---

/**
 * Trae el object_story_spec de un ad existente para clonarlo.
 * @returns {Promise<object>} el object_story_spec base
 */
export async function getReferenceObjectStorySpec(refAdId) {
  const data = await metaGet(refAdId, { fields: 'creative{object_story_spec}' });
  const spec = data?.creative?.object_story_spec;
  if (!spec) throw new Error(`Reference ad ${refAdId}: no tiene creative.object_story_spec`);
  return spec;
}

// --- Campaign ---

/**
 * Crea una campaign CBO.
 */
export async function createCampaign(adAccountId, { name, dailyBudgetCents }) {
  const data = await metaPost(`${adAccountId}/campaigns`, {
    name,
    objective: 'OUTCOME_SALES',
    buying_type: 'AUCTION',
    status: 'ACTIVE',
    daily_budget: String(dailyBudgetCents),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    special_ad_categories: [],
  });
  if (!data?.id) throw new Error(`Campaign create no devolvió id: ${JSON.stringify(data)}`);
  return data.id;
}

// --- Adset ---

/**
 * Crea un adset con la config estándar Cellu.
 */
export async function createAdset(adAccountId, { name, campaignId, pixelId, startTimeIso }) {
  const targeting = {
    age_min: 18,
    age_max: 65,
    geo_locations: {
      countries: ['AR'],
      location_types: ['home', 'recent'],
    },
    brand_safety_content_filter_levels: ['FACEBOOK_RELAXED', 'AN_RELAXED'],
    targeting_automation: { advantage_audience: 1 },
  };
  const promotedObject = { pixel_id: pixelId, custom_event_type: 'PURCHASE' };
  const attributionSpec = [
    { event_type: 'CLICK_THROUGH', window_days: 7 },
    { event_type: 'VIEW_THROUGH', window_days: 1 },
  ];
  const data = await metaPost(`${adAccountId}/adsets`, {
    name,
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    promoted_object: promotedObject,
    targeting,
    attribution_spec: attributionSpec,
    start_time: startTimeIso,
    status: 'ACTIVE',
  });
  if (!data?.id) throw new Error(`Adset create no devolvió id: ${JSON.stringify(data)}`);
  return data.id;
}

// --- Video upload ---

/**
 * Sube un video a /act_X/advideos. Meta procesa async; devuelve { id }.
 * Para esperar a que esté ready, usar pollVideoReady.
 */
export async function uploadVideo(adAccountId, fileName, buffer) {
  const url = `${META_API}/${adAccountId}/advideos`;
  const form = new FormData();
  // Blob/FormData son globales en Node 18+ runtime de Vercel.
  const blob = new Blob([buffer], { type: 'video/mp4' });
  form.append('source', blob, fileName);
  form.append('name', fileName);
  form.append('access_token', getToken());
  const r = await fetch(url, { method: 'POST', body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) throw buildErr(data, r.status);
  if (!data?.id) throw new Error(`Video upload no devolvió id: ${JSON.stringify(data)}`);
  return data.id;
}

/**
 * Polling de status del video hasta que esté ready.
 * Default: timeout 90s, intervalo 5s.
 */
export async function pollVideoReady(videoId, { timeoutMs = 90000, intervalMs = 5000 } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    const data = await metaGet(videoId, { fields: 'status' });
    last = data?.status;
    const s = last?.video_status;
    if (s === 'ready') return data;
    if (s === 'error') {
      throw new Error(`Video ${videoId} processing error: ${JSON.stringify(last)}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Video ${videoId} timeout esperando ready (last=${JSON.stringify(last)})`);
}

/**
 * Trae el thumbnail preferido (el que Meta marca is_preferred), o el primero.
 * @returns {Promise<string>} URI del thumbnail
 */
export async function getPreferredThumbnailUri(videoId) {
  const data = await metaGet(`${videoId}/thumbnails`);
  const list = data?.data || [];
  const preferred = list.find(t => t.is_preferred) || list[0];
  if (!preferred?.uri) throw new Error(`Video ${videoId}: no se encontraron thumbnails`);
  return preferred.uri;
}

// --- Image upload ---

/**
 * Sube una imagen a /act_X/adimages. Devuelve { hash, url }.
 * El field name del multipart es el filename (Meta lo usa como key en el response).
 */
export async function uploadImage(adAccountId, fileName, buffer) {
  const url = `${META_API}/${adAccountId}/adimages`;
  const form = new FormData();
  const isPng = /\.png$/i.test(fileName);
  const blob = new Blob([buffer], { type: isPng ? 'image/png' : 'image/jpeg' });
  // Meta espera el filename como NAME del field. Es raro pero documentado.
  form.append(fileName, blob, fileName);
  form.append('access_token', getToken());
  const r = await fetch(url, { method: 'POST', body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) throw buildErr(data, r.status);
  const info = data?.images?.[fileName];
  if (!info?.hash) throw new Error(`Image upload sin hash para ${fileName}: ${JSON.stringify(data)}`);
  return { hash: info.hash, url: info.url };
}

// --- Adcreative ---

/**
 * Crea un adcreative clonando el object_story_spec base y reemplazando la media.
 *
 * Para Videos: setea video_data.video_id + video_data.image_url (preferred thumb).
 * Para Estaticos: setea link_data.image_hash.
 */
export async function createAdCreative(adAccountId, { name, baseSpec, kind, videoId, thumbnailUri, imageHash }) {
  const spec = JSON.parse(JSON.stringify(baseSpec)); // deep clone

  if (kind === 'Videos') {
    if (!videoId || !thumbnailUri) throw new Error('createAdCreative Videos: faltan videoId o thumbnailUri');
    if (!spec.video_data) spec.video_data = {};
    spec.video_data.video_id = videoId;
    spec.video_data.image_url = thumbnailUri;
    // Si el reference vino con link_data (estático), removerlo para no confundir.
    delete spec.link_data;
  } else if (kind === 'Estaticos') {
    if (!imageHash) throw new Error('createAdCreative Estaticos: falta imageHash');
    if (!spec.link_data) spec.link_data = {};
    spec.link_data.image_hash = imageHash;
    delete spec.video_data;
  } else {
    throw new Error(`createAdCreative: kind desconocido "${kind}"`);
  }

  const degreesOfFreedomSpec = {
    creative_features_spec: {
      text_optimizations: { enroll_status: 'OPT_IN' },
    },
  };

  const data = await metaPost(`${adAccountId}/adcreatives`, {
    name,
    object_story_spec: spec,
    degrees_of_freedom_spec: degreesOfFreedomSpec,
  });
  if (!data?.id) throw new Error(`Adcreative create no devolvió id: ${JSON.stringify(data)}`);
  return data.id;
}

// --- Ad ---

/**
 * Crea un ad linkeando un creative existente al adset.
 */
export async function createAd(adAccountId, { name, adsetId, creativeId }) {
  const data = await metaPost(`${adAccountId}/ads`, {
    name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: 'ACTIVE',
  });
  if (!data?.id) throw new Error(`Ad create no devolvió id: ${JSON.stringify(data)}`);
  return data.id;
}

// --- Verificación post-publicación ---

/**
 * Verifica que la campaign esté ACTIVE con el budget esperado.
 */
export async function verifyCampaign(campaignId, { expectedBudgetCents }) {
  const data = await metaGet(campaignId, { fields: 'name,status,daily_budget,effective_status' });
  const ok = data.status === 'ACTIVE' && Number(data.daily_budget) === Number(expectedBudgetCents);
  return { ok, data };
}

/**
 * Verifica que un ad esté ACTIVE con creative asignado. Reintenta hasta 3
 * veces con 5s de delay si todavía no propagó.
 */
export async function verifyAdActive(adId, { retries = 3, delayMs = 5000 } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const data = await metaGet(adId, { fields: 'name,status,effective_status,creative' });
    last = data;
    if (data.status === 'ACTIVE' && data.creative?.id) return { ok: true, data };
    if (attempt < retries) await sleep(delayMs);
  }
  return { ok: false, data: last };
}

export { META_API };
