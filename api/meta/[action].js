// api/meta/[action].js
//
// DISPATCHER ÚNICO para /api/meta/*
//
// Consolida callback + connect + disconnect + me en una sola función
// serverless. Motivo: el plan Hobby de Vercel limita 12 functions por
// deployment. Tener cada acción como archivo separado nos dejaba 0
// margen para nuevas rutas.
//
// Rutas públicas SIN CAMBIOS (Vercel dynamic routes matcheen el path):
//   GET  /api/meta/connect     → inicia OAuth con Meta
//   GET  /api/meta/callback    → recibe redirect de Meta tras consent
//   GET  /api/meta/me          → estado de conexión del usuario
//   GET|POST /api/meta/disconnect → borra la cookie

import crypto from 'node:crypto';
import {
  META_API_VERSION, META_COOKIE_MAX_AGE, META_SCOPES,
  verifyState, signState, setMetaCookie, clearMetaCookie,
  readMetaCookie, getOrigin, respondJSON, graphGet, graphPost,
} from './_lib.js';

// --- helpers locales ---

function redirectWithError(res, origin, returnTo, reason) {
  const path = (returnTo || '/acceso').startsWith('/') ? returnTo : '/acceso';
  const url = new URL(path, origin);
  url.searchParams.set('meta', 'error');
  url.searchParams.set('reason', reason.slice(0, 200));
  res.statusCode = 302;
  res.setHeader('Location', url.toString());
  res.end();
}

async function exchangeCodeForToken(appId, appSecret, code, redirectUri) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', code);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error?.message || `HTTP ${resp.status}`);
  return data;
}

async function exchangeForLongLived(appId, appSecret, shortToken) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('fb_exchange_token', shortToken);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error?.message || `HTTP ${resp.status}`);
  return data;
}

async function fetchMe(accessToken) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/me`);
  url.searchParams.set('fields', 'id,name');
  url.searchParams.set('access_token', accessToken);
  const resp = await fetch(url.toString());
  return await resp.json();
}

// --- handlers (idénticos a los originales, inline) ---

function handleConnect(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const origin = getOrigin(req);
  let returnTo = req.url?.includes('?')
    ? new URL(req.url, origin).searchParams.get('returnTo') || '/acceso'
    : '/acceso';
  if (!returnTo.startsWith('/')) returnTo = '/acceso';

  const appId = process.env.META_APP_ID;
  const secret = process.env.AUTH_SECRET;
  if (!appId) return redirectWithError(res, origin, returnTo, 'META_APP_ID no está configurada en el servidor. Agregala en Vercel → Settings → Environment Variables y redeployá.');
  if (!secret) return redirectWithError(res, origin, returnTo, 'AUTH_SECRET no configurada en el servidor');

  const redirectUri = `${origin}/api/meta/callback`;

  const state = signState({
    nonce: crypto.randomBytes(16).toString('hex'),
    ts: Date.now(),
    returnTo,
  }, secret);

  const authUrl = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
  authUrl.searchParams.set('client_id', appId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', META_SCOPES);
  authUrl.searchParams.set('response_type', 'code');

  res.statusCode = 302;
  res.setHeader('Location', authUrl.toString());
  res.end();
}

async function handleCallback(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const origin = getOrigin(req);

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const authSecret = process.env.AUTH_SECRET;
  if (!appId || !appSecret) return redirectWithError(res, origin, '/acceso', 'META_APP_ID o META_APP_SECRET faltan en el servidor');
  if (!authSecret) return redirectWithError(res, origin, '/acceso', 'AUTH_SECRET no configurada');

  const url = new URL(req.url, origin);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const errorFromMeta = url.searchParams.get('error');

  if (errorFromMeta) {
    const desc = url.searchParams.get('error_description') || errorFromMeta;
    return redirectWithError(res, origin, '/acceso', `Meta rechazó el login: ${desc}`);
  }
  if (!code || !stateRaw) return redirectWithError(res, origin, '/acceso', 'Callback incompleto (falta code o state)');

  const state = verifyState(stateRaw, authSecret);
  if (!state) return redirectWithError(res, origin, '/acceso', 'State inválido o adulterado');
  if (Date.now() - (state.ts || 0) > 10 * 60 * 1000) {
    return redirectWithError(res, origin, state.returnTo || '/acceso', 'State expirado, reiniciá el login');
  }

  const redirectUri = `${origin}/api/meta/callback`;
  const returnTo = (state.returnTo || '/acceso').startsWith('/') ? state.returnTo : '/acceso';

  let longToken, me;
  try {
    const short = await exchangeCodeForToken(appId, appSecret, code, redirectUri);
    const long = await exchangeForLongLived(appId, appSecret, short.access_token);
    longToken = long.access_token;
    me = await fetchMe(longToken);
  } catch (err) {
    console.error('meta/callback exchange error:', err);
    return redirectWithError(res, origin, returnTo, `Intercambio de token falló: ${err.message}`);
  }

  const cookiePayload = {
    accessToken: longToken,
    metaUserId: me?.id || null,
    metaUserName: me?.name || null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + META_COOKIE_MAX_AGE,
  };
  const signed = signState(cookiePayload, authSecret);
  setMetaCookie(res, signed);

  res.statusCode = 302;
  res.setHeader('Location', `${returnTo}?meta=connected`);
  res.end();
}

function handleDisconnect(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return respondJSON(res, 405, { error: 'Method not allowed' });
  }
  clearMetaCookie(res);
  return respondJSON(res, 200, { ok: true });
}

async function handleMe(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const session = readMetaCookie(req);
  if (!session || !session.accessToken) {
    return respondJSON(res, 200, { connected: false });
  }
  if (session.exp && session.exp < Math.floor(Date.now() / 1000)) {
    return respondJSON(res, 200, { connected: false, reason: 'expired' });
  }

  return respondJSON(res, 200, {
    connected: true,
    user: {
      id: session.metaUserId || null,
      name: session.metaUserName || null,
    },
    expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
  });
}

// Lista las cuentas publicitarias del user conectado. Devuelve id, name,
// account_status, currency, timezone_name — lo suficiente para que el user
// elija en un dropdown de "¿cuál usamos?".
async function handleAdAccounts(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  try {
    const data = await graphGet('me/adaccounts', session.accessToken, {
      fields: 'id,account_id,name,account_status,currency,timezone_name,business_name',
      limit: 100,
    });
    // account_status: 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, 7=PENDING_RISK_REVIEW, ...
    const accounts = (data.data || [])
      .filter(a => a.account_status === 1)
      .map(a => ({
        id: a.id, // con prefijo act_
        accountId: a.account_id,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone_name,
        business: a.business_name || null,
      }));
    return respondJSON(res, 200, { accounts, total: accounts.length });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// Helper: extrae métricas relevantes de un objeto insights crudo de Meta.
// Ahora calcula ROAS, CPA y thumb-stop rate (para video) además de las
// métricas básicas — esos 3 son los indicadores más predictivos de fatigue
// y de calidad del creativo.
function parseInsights(ins) {
  if (!ins) return null;
  const actions = ins.actions || [];
  const actionValues = ins.action_values || [];

  const isPurchase = (a) =>
    a.action_type === 'purchase' ||
    a.action_type === 'offsite_conversion.fb_pixel_purchase';

  const purchases = actions.find(isPurchase);
  const purchaseValue = actionValues.find(isPurchase);

  const impressions = Number(ins.impressions || 0);
  const spend = Number(ins.spend || 0);
  const purchasesCount = purchases ? Number(purchases.value || 0) : 0;
  const revenue = purchaseValue ? Number(purchaseValue.value || 0) : 0;

  // Thumb-stop rate: % de viewers que ven ≥3s del video.
  // Meta no expone `video_3_sec_watched_actions` como field válido en
  // insights (tira error 100), pero el mismo dato viene dentro de
  // `actions` con action_type = 'video_view' (que Meta define como views
  // de ≥3s). Lo extraemos de ahí.
  const video3sAction = actions.find(a => a.action_type === 'video_view');
  const video3sTotal = video3sAction ? Number(video3sAction.value || 0) : 0;
  const thumbStopRate = impressions > 0 ? (video3sTotal / impressions) * 100 : 0;

  return {
    impressions,
    clicks: Number(ins.clicks || 0),
    ctr: Number(ins.ctr || 0),
    spend,
    cpc: Number(ins.cpc || 0),
    cpm: Number(ins.cpm || 0),
    reach: Number(ins.reach || 0),
    frequency: Number(ins.frequency || 0),
    purchases: purchasesCount,
    revenue,
    // Métricas derivadas — calculamos nosotros (Meta no las manda formateadas).
    roas: spend > 0 ? revenue / spend : 0,                    // return on ad spend
    cpa: purchasesCount > 0 ? spend / purchasesCount : 0,     // cost per acquisition
    thumbStopRate,                                             // % que ven ≥3s (video)
    video3sViews: video3sTotal,
  };
}

// Mínimo de impressions por período para que el CTR sea estadísticamente
// significativo. Abajo de 1000 imp, CTR es ruido — un solo click cambia %
// demasiado. En DTC con targeting apretado, 1000 imp equivale a ~24-48h de
// runtime normal en un set activo.
const MIN_IMPRESSIONS_FOR_FATIGUE = 1000;

// Calcula el estado de fatigue comparando las métricas del último 14d con
// los 14d previos (days -28 a -14). Ventana más larga que 7d vs 7d porque
// en DTC los creativos viven 60-90 días — 7d es ruido, 14d captura la
// tendencia real sin reaccionar a picos puntuales.
//
//   healthy   → CTR estable o subiendo
//   warming   → CTR bajó algo pero spend sigue subiendo (escala normal)
//   fatiguing → CTR cayó > 20% respecto al período anterior
//   dying     → CTR cayó > 40% O > 20% con freq > 4 (audiencia quemada)
//   new       → no hay datos suficientes (<1000 imp en algún período)
//
// Ajustes por audienceSegment:
//   - retargeting (warm): CTR 2-5% es normal, tolera más freq (5-8) antes
//     de quemarse. Pero cuando fatiga, fatiga rápido.
//   - prospecting (cold): CTR 0.8-1.5% es normal, freq >4 quema rápido.
//     Threshold de fatigue más estricto (cae cualquier cosa → reaccionar).
function computeFatigue(recent, prev, opts = {}) {
  const { audienceSegment = 'prospecting' } = opts;
  const freqThreshold = audienceSegment === 'retargeting' ? 6 : 4;
  if (!recent || recent.impressions < MIN_IMPRESSIONS_FOR_FATIGUE) {
    return { status: 'new', reason: `Aún no hay datos suficientes (${recent?.impressions || 0} imp · mín ${MIN_IMPRESSIONS_FOR_FATIGUE})` };
  }
  if (!prev || prev.impressions < MIN_IMPRESSIONS_FOR_FATIGUE) {
    return { status: 'new', reason: `Sin período previo significativo para comparar (${prev?.impressions || 0} imp)` };
  }

  const ctrRecent = recent.ctr;
  const ctrPrev = prev.ctr;
  if (ctrPrev === 0) return { status: 'new', reason: 'CTR previo inválido' };

  const ctrChangePct = Math.round(((ctrRecent - ctrPrev) / ctrPrev) * 100);
  const freqOverload = recent.frequency > freqThreshold;

  // ROAS change — señal secundaria pero muy fuerte. Si ROAS cae mientras
  // CTR se mantiene, puede ser audience decay (los que clickean compran menos).
  let roasChangePct = null;
  if (prev.roas > 0 && recent.roas >= 0) {
    roasChangePct = Math.round(((recent.roas - prev.roas) / prev.roas) * 100);
  }
  const roasCollapse = roasChangePct != null && roasChangePct < -30;

  let status = 'healthy';
  let reason = `CTR estable (${ctrChangePct >= 0 ? '+' : ''}${ctrChangePct}%) · ROAS ${recent.roas.toFixed(2)}`;

  if (ctrChangePct < -40 || (ctrChangePct < -20 && freqOverload)) {
    status = 'dying';
    reason = `CTR cayó ${Math.abs(ctrChangePct)}% vs 14d previos · freq ${recent.frequency.toFixed(1)} — audiencia quemada`;
  } else if (ctrChangePct < -20 || roasCollapse) {
    status = 'fatiguing';
    if (roasCollapse && ctrChangePct >= -20) {
      reason = `ROAS cayó ${Math.abs(roasChangePct)}% — los que clickean ya no compran`;
    } else {
      reason = `CTR cayó ${Math.abs(ctrChangePct)}% vs 14d previos` + (roasCollapse ? ` + ROAS ${Math.abs(roasChangePct)}%` : '');
    }
  } else if (ctrChangePct < -5 && recent.spend > prev.spend * 1.1) {
    status = 'warming';
    reason = `CTR bajó ${Math.abs(ctrChangePct)}% pero spend subió — normal al escalar`;
  }

  return {
    status,
    reason,
    audienceSegment,
    ctrRecent, ctrPrev, ctrChangePct,
    roasRecent: recent.roas,
    roasPrev: prev.roas,
    roasChangePct,
    cpaRecent: recent.cpa,
    frequencyRecent: recent.frequency,
    thumbStopRate: recent.thumbStopRate,
  };
}

// Formato "YYYY-MM-DD" para rangos custom en Meta API.
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// Devuelve los ads activos de una ad account con su creativo + insights.
// Trae 2 rangos de insights (últimos 7 días y los 7 días previos a ese) y
// computa estado de fatigue por ad. Usado para que el generador priorice
// iteraciones sobre creativos que están fatigando.
async function handleAdsWithInsights(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const accountId = url.searchParams.get('account_id');
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);

  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id (con prefijo act_)' });

  // Ventanas de comparación: últimos 14d vs 14d previos (días -28 a -14).
  // En DTC los creativos viven 60-90 días — 7d es muy ruidoso, 14d captura
  // tendencia real con buffer de significancia estadística.
  const now = new Date();
  const recentSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const recentRange = JSON.stringify({ since: ymd(recentSince), until: ymd(now) });
  const prevSince = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const prevUntil = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const prevRange = JSON.stringify({ since: ymd(prevSince), until: ymd(prevUntil) });

  try {
    // Un solo call a Graph API con dos expansiones de insights.
    const data = await graphGet(`${accountId}/ads`, session.accessToken, {
      fields: [
        'id,name,status,effective_status,created_time,updated_time',
        `campaign{id,name,objective}`,
        `adset{id,name,optimization_goal,targeting}`,
        `creative{id,name,title,body,thumbnail_url,image_url,video_id,object_story_spec,effective_object_story_id}`,
        `insights.time_range(${recentRange}).as(recent){impressions,clicks,ctr,spend,cpc,cpm,actions,action_values,reach,frequency}`,
        `insights.time_range(${prevRange}).as(previous){impressions,clicks,ctr,spend,cpc,cpm,actions,action_values,reach,frequency}`,
      ].join(','),
      limit,
      effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
    });

    const ads = (data.data || []).map(ad => {
      const creative = ad.creative || {};
      const campaign = ad.campaign || {};
      const adset = ad.adset || {};
      const recent = parseInsights(ad.recent?.data?.[0]);
      const previous = parseInsights(ad.previous?.data?.[0]);

      // Audience segment: prospecting (cold) vs retargeting (warm).
      // Heurística: si el targeting tiene custom_audiences → retargeting.
      // Si no, prospecting. Se usa para benchmarks diferentes de fatigue.
      const targeting = adset.targeting || {};
      const hasCustomAudiences = Array.isArray(targeting.custom_audiences) && targeting.custom_audiences.length > 0;
      const audienceSegment = hasCustomAudiences ? 'retargeting' : 'prospecting';

      const fatigue = computeFatigue(recent, previous, { audienceSegment });

      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        effectiveStatus: ad.effective_status,
        createdTime: ad.created_time,
        updatedTime: ad.updated_time,
        campaign: {
          id: campaign.id || null,
          name: campaign.name || null,
          objective: campaign.objective || null,
        },
        adset: {
          id: adset.id || null,
          name: adset.name || null,
          optimizationGoal: adset.optimization_goal || null,
        },
        audienceSegment,
        creative: {
          id: creative.id,
          name: creative.name,
          title: creative.title,
          body: creative.body,
          thumbnailUrl: creative.thumbnail_url,
          imageUrl: creative.image_url,
          videoId: creative.video_id || null,
          storyId: creative.effective_object_story_id || null,
        },
        insights: recent,
        insightsPrev: previous,
        fatigue,
      };
    });

    // Contador de cada status para que el front muestre un resumen.
    const fatigueSummary = ads.reduce((acc, a) => {
      const s = a.fatigue?.status || 'new';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    return respondJSON(res, 200, {
      accountId,
      total: ads.length,
      fatigueSummary,
      ads,
    });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// Performance de UN ad específico — usado cuando el user marca una idea
// de la Bandeja como "usada" con un adId real, para cerrar el loop de
// aprendizaje (hipótesis vs resultado real).
async function handleAdPerformance(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const adId = url.searchParams.get('ad_id');
  if (!adId) return respondJSON(res, 400, { error: 'Falta ad_id' });

  try {
    // Metadata del ad + insights desde el lanzamiento + insights 14d recientes.
    const data = await graphGet(adId, session.accessToken, {
      fields: [
        'id,name,status,effective_status,created_time,campaign{id,name,objective}',
        `creative{id,name,title,body,thumbnail_url,image_url}`,
        `insights.date_preset(maximum).as(lifetime){impressions,clicks,ctr,spend,cpc,cpm,actions,action_values,reach,frequency}`,
        `insights.date_preset(last_14d).as(recent){impressions,clicks,ctr,spend,cpc,cpm,actions,action_values,reach,frequency}`,
      ].join(','),
    });

    const lifetime = parseInsights(data.lifetime?.data?.[0]);
    const recent = parseInsights(data.recent?.data?.[0]);

    return respondJSON(res, 200, {
      ad: {
        id: data.id,
        name: data.name,
        status: data.status,
        effectiveStatus: data.effective_status,
        createdTime: data.created_time,
        campaign: data.campaign ? {
          id: data.campaign.id, name: data.campaign.name, objective: data.campaign.objective,
        } : null,
        creative: data.creative ? {
          id: data.creative.id, name: data.creative.name,
          title: data.creative.title, body: data.creative.body,
          thumbnailUrl: data.creative.thumbnail_url, imageUrl: data.creative.image_url,
        } : null,
      },
      lifetime,
      recent,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// ========================================================================
// AUTOMATIZACIÓN DE RENOVACIÓN DE CREATIVOS
// ========================================================================
// Conjunto de actions que implementan la lógica del prompt de Cowork
// portado a server-side:
//   - ig-accounts       → lista IG Business Accounts (via Pages)
//   - latest-ig-post    → último post del feed (saltando fijados)
//   - campaigns         → campañas de una ad account
//   - campaign-adsets   → conjuntos (ad sets) de una campaña + ad principal
//   - run-creative-refresh → motor: detecta, duplica, asigna creativo, pausa
// ------------------------------------------------------------------------

// Lista las cuentas de Instagram Business conectadas a las Pages del user.
// IG Business sólo se puede leer via Pages — cada Page tiene 0 o 1 IG
// asociada en el campo `instagram_business_account`.
async function handleIgAccounts(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  try {
    // 1. Traer las Pages del user.
    const pagesData = await graphGet('me/accounts', session.accessToken, {
      fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
      limit: 100,
    });
    const accounts = [];
    for (const page of pagesData.data || []) {
      const ig = page.instagram_business_account;
      if (!ig?.id) continue;
      accounts.push({
        igId: ig.id,
        igUsername: ig.username || null,
        igName: ig.name || null,
        igAvatar: ig.profile_picture_url || null,
        pageId: page.id,
        pageName: page.name,
        // El `pageAccessToken` es distinto del user token — lo necesitamos
        // para publicar ads que usen posts de esa Page.
        pageAccessToken: page.access_token || null,
      });
    }
    return respondJSON(res, 200, { accounts, total: accounts.length });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// Último post del feed de una IG Business Account, saltando los N fijados.
// IG Graph API devuelve los posts ordenados por fecha desc, con los fijados
// primero. Por eso pedimos N+3 y salteamos los primeros N (configurable).
async function handleLatestIgPost(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const igId = url.searchParams.get('ig_id');
  const pinned = Math.max(0, Math.min(Number(url.searchParams.get('pinned') || 0), 10));
  if (!igId) return respondJSON(res, 400, { error: 'Falta ig_id' });

  try {
    const data = await graphGet(`${igId}/media`, session.accessToken, {
      fields: 'id,caption,permalink,timestamp,media_type,media_url,thumbnail_url,like_count,comments_count',
      limit: pinned + 5,
    });
    const posts = (data.data || []).slice(pinned);
    if (posts.length === 0) return respondJSON(res, 200, { post: null });
    const p = posts[0];
    return respondJSON(res, 200, {
      post: {
        id: p.id,
        caption: p.caption || '',
        permalink: p.permalink,
        timestamp: p.timestamp,
        mediaType: p.media_type,
        mediaUrl: p.media_url || p.thumbnail_url || null,
        thumbnailUrl: p.thumbnail_url || null,
        likes: Number(p.like_count || 0),
        comments: Number(p.comments_count || 0),
      },
    });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// Likes actuales de un IG media puntual. Usado por run-creative-refresh
// para decidir si un conjunto debe pausarse.
async function fetchIgPostLikes(igMediaId, accessToken) {
  try {
    const data = await graphGet(igMediaId, accessToken, {
      fields: 'id,like_count,permalink,caption',
    });
    return {
      id: data.id,
      likes: Number(data.like_count || 0),
      permalink: data.permalink || null,
      caption: data.caption || '',
    };
  } catch (err) {
    return { id: igMediaId, likes: 0, error: err.message };
  }
}

// Lista campañas de una ad account — para que el user elija cuál renovar.
async function handleCampaigns(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const accountId = url.searchParams.get('account_id');
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id' });

  try {
    const data = await graphGet(`${accountId}/campaigns`, session.accessToken, {
      fields: 'id,name,objective,status,effective_status,created_time',
      limit: 100,
    });
    const campaigns = (data.data || []).map(c => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effectiveStatus: c.effective_status,
      createdTime: c.created_time,
    }));
    return respondJSON(res, 200, { campaigns, total: campaigns.length });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// Lista los conjuntos (ad sets) de una campaña, con el ad principal y su
// creativo para identificar qué post promueve cada uno.
async function handleCampaignAdsets(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const campaignId = url.searchParams.get('campaign_id');
  if (!campaignId) return respondJSON(res, 400, { error: 'Falta campaign_id' });

  try {
    const data = await graphGet(`${campaignId}/adsets`, session.accessToken, {
      fields: [
        'id,name,status,effective_status,created_time,updated_time',
        'ads{id,name,status,effective_status,creative{id,name,object_story_id,instagram_permalink_url,thumbnail_url,effective_instagram_media_id}}',
      ].join(','),
      limit: 100,
    });
    const adsets = (data.data || []).map(s => {
      const ads = s.ads?.data || [];
      const mainAd = ads[0] || null;
      const creative = mainAd?.creative || null;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        effectiveStatus: s.effective_status,
        createdTime: s.created_time,
        updatedTime: s.updated_time,
        mainAd: mainAd ? {
          id: mainAd.id,
          name: mainAd.name,
          status: mainAd.status,
          effectiveStatus: mainAd.effective_status,
          creative: creative ? {
            id: creative.id,
            name: creative.name,
            objectStoryId: creative.object_story_id || null,
            instagramPermalink: creative.instagram_permalink_url || null,
            instagramMediaId: creative.effective_instagram_media_id || null,
            thumbnailUrl: creative.thumbnail_url || null,
          } : null,
        } : null,
      };
    });
    return respondJSON(res, 200, { adsets, total: adsets.length });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// ========================================================================
// RUN CREATIVE REFRESH — el motor
// ========================================================================
// Body JSON:
//   {
//     accountId: "act_XXX",
//     campaignId: "123",
//     baseAdsetId: "456",     // conjunto base a duplicar
//     igId: "17841XXX",       // IG Business Account
//     pageId: "10015XXX",     // Facebook Page dueña del IG
//     threshold: 50,          // likes para desactivar viejo
//     pinnedPosts: 0,         // posts fijados a saltear en el feed IG
//     webhookUrl: "https://discord.com/..." | null,
//     state: {
//       lastPostId: "IG_MEDIA_ID" | null,
//       activeAdsets: [
//         { adsetId, postId, postPermalink, createdAt }
//       ],
//     },
//     dryRun: false,          // true = simular sin mutar
//   }
//
// Response:
//   {
//     action: "refreshed" | "reviewed" | "no-change",
//     detectedPost: {...} | null,
//     adsetsChecked: [{ adsetId, postId, likes, action }],
//     created: { adsetId, adId, creativeId } | null,
//     paused: [adsetId, ...],
//     newState: {...},
//     log: [string, ...],
//     webhook: { sent: bool, status: number? },
//   }
async function handleRunCreativeRefresh(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  // Parsear body JSON (Vercel no lo auto-parsea siempre para POST).
  let body;
  try {
    if (req.body && typeof req.body === 'object') body = req.body;
    else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
  } catch {
    return respondJSON(res, 400, { error: 'Body JSON inválido' });
  }

  const {
    accountId, campaignId, baseAdsetId, igId, pageId,
    threshold = 50, pinnedPosts = 0, webhookUrl = null,
    state = { lastPostId: null, activeAdsets: [] },
    dryRun = false,
  } = body || {};

  const missing = [];
  if (!accountId) missing.push('accountId');
  if (!campaignId) missing.push('campaignId');
  if (!baseAdsetId) missing.push('baseAdsetId');
  if (!igId) missing.push('igId');
  if (!pageId) missing.push('pageId');
  if (missing.length) return respondJSON(res, 400, { error: `Faltan campos: ${missing.join(', ')}` });

  const token = session.accessToken;
  const log = [];
  const paused = [];
  let created = null;
  let detectedPost = null;
  let actionTaken = 'no-change';

  const now = new Date().toISOString();
  const activeAdsets = Array.isArray(state.activeAdsets) ? [...state.activeAdsets] : [];

  try {
    // --- Paso 1: último post del feed IG ---
    const feed = await graphGet(`${igId}/media`, token, {
      fields: 'id,caption,permalink,timestamp,like_count,media_type',
      limit: pinnedPosts + 5,
    });
    const posts = (feed.data || []).slice(pinnedPosts);
    const latest = posts[0] || null;
    if (!latest) {
      log.push('El feed de Instagram está vacío o todos los posts son fijados.');
      return respondJSON(res, 200, {
        action: 'no-change', detectedPost: null, adsetsChecked: [],
        created: null, paused: [], newState: state, log,
      });
    }
    detectedPost = {
      id: latest.id,
      caption: (latest.caption || '').slice(0, 280),
      permalink: latest.permalink,
      timestamp: latest.timestamp,
      likes: Number(latest.like_count || 0),
    };
    log.push(`Último post IG detectado: ${latest.id} (${detectedPost.caption.slice(0, 60)}…)`);

    const isNewPost = state.lastPostId !== latest.id;
    log.push(isNewPost ? '→ Post NUEVO respecto al estado.' : '→ Post sin cambios; solo revisaré engagement.');

    // --- Paso 2: engagement por conjunto activo ---
    const adsetsChecked = [];
    for (const entry of activeAdsets) {
      if (!entry.postId) continue;
      const { likes, permalink, error } = await fetchIgPostLikes(entry.postId, token);
      adsetsChecked.push({
        adsetId: entry.adsetId,
        postId: entry.postId,
        postPermalink: permalink || entry.postPermalink,
        likes,
        error: error || null,
        meetsThreshold: likes >= threshold,
      });
    }
    for (const ch of adsetsChecked) {
      log.push(`  · adset ${ch.adsetId} → post ${ch.postId} · ${ch.likes} likes ${ch.meetsThreshold ? '(≥ umbral)' : ''}`);
    }

    // --- Paso 3/4/5: si hay post nuevo, duplicar + asignar creativo ---
    if (isNewPost && !dryRun) {
      // 3.1 Duplicar conjunto base. deep_copy=true lleva también los ads.
      const copyResp = await graphPost(`${baseAdsetId}/copies`, token, {
        deep_copy: true,
        status_option: 'PAUSED', // lo activamos más abajo, después de cambiar creativo
        rename_options: { rename_suffix: ` · refresh ${now.slice(0, 10)}` },
      });
      const newAdsetId = copyResp.copied_adset_id || copyResp.ad_object_ids?.[0] || null;
      if (!newAdsetId) throw new Error(`Duplicación no devolvió nuevo adset id · ${JSON.stringify(copyResp).slice(0, 200)}`);
      log.push(`✓ Adset duplicado: ${baseAdsetId} → ${newAdsetId}`);

      // 3.2 Listar los ads del nuevo adset (típicamente 1, el duplicado).
      const newAdsData = await graphGet(`${newAdsetId}/ads`, token, {
        fields: 'id,name,status,creative{id}',
        limit: 10,
      });
      const newAd = (newAdsData.data || [])[0];
      if (!newAd) throw new Error('El adset duplicado no tiene ads');

      // 3.3 Crear creativo nuevo que use el post de IG como "publicación
      // existente" via object_story_id = pageId_postId. Funciona si el IG
      // post está publicado por la IG Business Account vinculada a la Page.
      const creativeResp = await graphPost(`${accountId}/adcreatives`, token, {
        name: `Refresh ${now.slice(0, 10)} · IG ${latest.id}`,
        object_story_id: `${pageId}_${latest.id}`,
      });
      const newCreativeId = creativeResp.id;
      log.push(`✓ Creative creado: ${newCreativeId}`);

      // 3.4 Asignar creativo al ad duplicado.
      await graphPost(`${newAd.id}`, token, {
        creative: { creative_id: newCreativeId },
      });
      log.push(`✓ Creative asignado al ad ${newAd.id}`);

      // 3.5 Activar el adset duplicado.
      await graphPost(`${newAdsetId}`, token, { status: 'ACTIVE' });
      await graphPost(`${newAd.id}`, token, { status: 'ACTIVE' });
      log.push(`✓ Adset ${newAdsetId} ACTIVO`);

      created = { adsetId: newAdsetId, adId: newAd.id, creativeId: newCreativeId };
      activeAdsets.push({
        adsetId: newAdsetId,
        postId: latest.id,
        postPermalink: latest.permalink,
        createdAt: now,
      });
      actionTaken = 'refreshed';
    } else if (isNewPost && dryRun) {
      log.push('[dry-run] Saltando duplicación/creación de creativo.');
      actionTaken = 'refreshed';
    }

    // --- Paso 6: pausar viejos con engagement ≥ umbral ---
    // Regla de seguridad: nunca dejar la campaña sin conjuntos activos.
    // Solo pauseamos si queda al menos 1 activo que no estemos pauseando
    // y que sea más reciente (o el recién creado).
    const candidates = adsetsChecked
      .filter(c => c.meetsThreshold)
      .map(c => c.adsetId);
    const willRemainActive = activeAdsets
      .filter(a => !candidates.includes(a.adsetId))
      .length;
    if (willRemainActive >= 1) {
      for (const adsetId of candidates) {
        if (!dryRun) await graphPost(adsetId, token, { status: 'PAUSED' });
        paused.push(adsetId);
        log.push(`✓ Adset ${adsetId} PAUSADO (likes ≥ ${threshold})`);
      }
    } else if (candidates.length) {
      log.push(`⚠ ${candidates.length} adset(s) cumplen el umbral pero no hay reemplazo activo — no se pausa ninguno.`);
    }

    // --- Paso 7: nuevo estado ---
    const newState = {
      lastPostId: latest.id,
      lastRunAt: now,
      activeAdsets: activeAdsets.filter(a => !paused.includes(a.adsetId)),
      history: [
        ...(Array.isArray(state.history) ? state.history.slice(-49) : []),
        {
          at: now,
          action: actionTaken,
          detectedPostId: latest.id,
          createdAdsetId: created?.adsetId || null,
          pausedAdsetIds: paused,
        },
      ],
    };

    // --- Paso 8: webhook Discord ---
    let webhookResult = { sent: false };
    if (webhookUrl && typeof webhookUrl === 'string' && webhookUrl.startsWith('https://')) {
      const summary = [
        `**Renovación de creativos — ${now.slice(0, 16).replace('T', ' ')}**`,
        `Acción: **${actionTaken}**`,
        `Post detectado: ${detectedPost?.permalink || '—'}`,
        `Likes post nuevo: ${detectedPost?.likes ?? '—'}`,
        created ? `✓ Adset creado: ${created.adsetId}` : null,
        paused.length ? `✓ Adsets pausados: ${paused.join(', ')}` : null,
        adsetsChecked.length ? `Chequeo: ${adsetsChecked.map(c => `${c.adsetId}=${c.likes}♥`).join(' · ')}` : null,
      ].filter(Boolean).join('\n');
      try {
        const wr = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: summary }),
        });
        webhookResult = { sent: true, status: wr.status };
      } catch (err) {
        webhookResult = { sent: false, error: err.message };
      }
    }

    return respondJSON(res, 200, {
      action: actionTaken,
      detectedPost,
      adsetsChecked,
      created,
      paused,
      newState,
      log,
      webhook: webhookResult,
    });
  } catch (err) {
    log.push(`✗ Error: ${err.message}`);
    return respondJSON(res, err.status || 502, {
      error: err.message,
      log,
      detectedPost,
      created, // puede quedar a mitad; el front muestra el log para diagnosticar
      paused,
    });
  }
}

// --- dispatcher ---

const actions = {
  connect: handleConnect,
  callback: handleCallback,
  disconnect: handleDisconnect,
  me: handleMe,
  'ad-accounts': handleAdAccounts,
  'ads-with-insights': handleAdsWithInsights,
  'ad-performance': handleAdPerformance,
  'ig-accounts': handleIgAccounts,
  'latest-ig-post': handleLatestIgPost,
  'campaigns': handleCampaigns,
  'campaign-adsets': handleCampaignAdsets,
  'run-creative-refresh': handleRunCreativeRefresh,
};

export default async function handler(req, res) {
  const action = req.query.action;
  const h = actions[action];
  if (!h) return respondJSON(res, 404, { error: `Unknown meta action: ${action}` });
  return h(req, res);
}
