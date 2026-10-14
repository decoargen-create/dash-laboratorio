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
import { parseFunnel, deriveFunnelRates, pickAction, ACTION_ALIASES } from './_funnel.js';
import { validarPedido, mismaCuenta, NIVELES } from './_estado.js';
import {
  META_API_VERSION, META_COOKIE_MAX_AGE, META_SCOPES,
  verifyState, signState, setMetaCookie, clearMetaCookie,
  readMetaCookie, getOrigin, respondJSON, graphGet, graphPost,
} from './_lib.js';
import {
  isSupabaseConfigured, getUserIdFromAuth,
  listMetaConnections, insertMetaConnection,
  getMetaConnectionToken, deleteMetaConnection,
  getServiceClient,
} from '../marketing/_supabase-server.js';

// Resuelve el access token a usar para un request. Dos fuentes:
//   - connection_id (query/body) → conexión guardada en Supabase (multi-cuenta).
//     Requiere JWT de Supabase en Authorization para identificar al dueño.
//   - cookie viora-meta-session → modo legacy single-token (sin Supabase).
// Devuelve { token } o { error, status }.
async function resolveAccessToken(req, url, extraConnId = null) {
  const connId = url?.searchParams?.get('connection_id') || extraConnId;
  if (connId) {
    const userId = await getUserIdFromAuth(req);
    if (!userId) return { error: 'No autenticado — falta sesión de Supabase', status: 401 };
    const token = await getMetaConnectionToken(userId, connId);
    if (!token) return { error: 'Conexión no encontrada o sin acceso', status: 404 };
    return { token };
  }
  const session = readMetaCookie(req);
  if (session?.accessToken) return { token: session.accessToken };
  return { error: 'Meta no conectado', status: 401 };
}

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

// Variante API del connect para el flujo MULTI-USUARIO: el cliente llama
// con su JWT de Supabase (Authorization header), embebemos su userId en el
// state firmado, y el callback guarda la conexión en meta_connections a
// nombre de ESE user. Así colegas/clientes conectan cada uno su Meta.
// (handleConnect legacy queda para el modo cookie single-user.)
async function handleConnectUrl(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const appId = process.env.META_APP_ID;
  const secret = process.env.AUTH_SECRET;
  if (!appId) return respondJSON(res, 500, { error: 'META_APP_ID no configurada. Falta crear la app de Meta y cargar sus credenciales en Vercel.' });
  if (!secret) return respondJSON(res, 500, { error: 'AUTH_SECRET no configurada' });

  // userId de AdsLab — requerido en este flujo (multi-usuario = DB).
  const userId = isSupabaseConfigured() ? await getUserIdFromAuth(req) : null;
  if (!userId) return respondJSON(res, 401, { error: 'Iniciá sesión en AdsLab antes de conectar Meta.' });

  let body = {};
  try {
    if (req.body && typeof req.body === 'object') body = req.body;
    else {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
  } catch {}
  let returnTo = typeof body.returnTo === 'string' ? body.returnTo : '/';
  if (!returnTo.startsWith('/')) returnTo = '/';

  const redirectUri = `${origin}/api/meta/callback`;
  const state = signState({
    nonce: crypto.randomBytes(16).toString('hex'),
    ts: Date.now(),
    returnTo,
    userId, // ← el callback lo usa para guardar en meta_connections
    label: typeof body.label === 'string' ? body.label.slice(0, 80) : null,
  }, secret);

  const authUrl = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
  authUrl.searchParams.set('client_id', appId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', META_SCOPES);
  authUrl.searchParams.set('response_type', 'code');
  return respondJSON(res, 200, { url: authUrl.toString() });
}

// Info de configuración del OAuth — el frontend decide si muestra el botón
// "Conectar con Facebook" (solo tiene sentido con la app de Meta creada).
function handleOauthConfig(req, res) {
  return respondJSON(res, 200, {
    configured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.AUTH_SECRET),
  });
}

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

  // MULTI-USUARIO: si el connect se inició logueado en AdsLab (connect-url),
  // el state trae el userId → guardamos la conexión en meta_connections a su
  // nombre. Cada colega/cliente conecta su propio Meta. Fallback a cookie
  // (legacy single-user) si no hay userId o falla el insert.
  if (state.userId && isSupabaseConfigured()) {
    try {
      await insertMetaConnection(state.userId, {
        label: state.label || me?.name || 'Meta',
        metaUserId: me?.id || null,
        metaUserName: me?.name || null,
        accessToken: longToken,
      });
      res.statusCode = 302;
      res.setHeader('Location', `${returnTo}?meta=connected`);
      res.end();
      return;
    } catch (err) {
      console.error('meta/callback insertMetaConnection error:', err);
      // seguimos al fallback cookie para no perder el login del user
    }
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

  // Reconectó OK → reseteamos el flag de "Meta caído" para que un corte
  // futuro vuelva a avisar (ver api/meta/_alert.js).
  try { const { markMetaHealthy } = await import('./_alert.js'); await markMetaHealthy(); } catch {}

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
  const url = new URL(req.url, getOrigin(req));
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });

  try {
    const data = await graphGet('me/adaccounts', token, {
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

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  // Acepta ?connection_id (conexiones guardadas en meta_connections) además
  // de la cookie legacy — es lo que usa el picker de cuenta en Productos.
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });

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
    const data = await graphGet(`${accountId}/ads`, token, {
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
// El mp4 de un video PROPIO de la cuenta (los creativos de la galería de
// Winners): Graph API expone /{video_id}?fields=source para videos del
// advertiser. La URL que devuelve es del CDN y vence — se pide en el momento
// de reproducir o de guardarlo como referencia, nunca se persiste.
async function handleVideoSource(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });

  const videoId = url.searchParams.get('video_id');
  if (!videoId || !/^\d+$/.test(videoId)) return respondJSON(res, 400, { error: 'Falta video_id (numérico)' });
  const accountId = url.searchParams.get('account_id'); // para el fallback por advideos

  // Intento 1: el nodo del video directo. Para videos de ads suele fallar con
  // (#10) permiso insuficiente — `source` en el nodo Video pide permisos de
  // página que un token de ads_read no tiene.
  try {
    const data = await graphGet(`${videoId}`, token, { fields: 'source,picture,permalink_url,length' });
    if (data.source) {
      return respondJSON(res, 200, {
        source: data.source,
        picture: data.picture || null,
        permalink: data.permalink_url || null,
        lengthSec: Number(data.length) || null,
      });
    }
  } catch (err) {
    // Si no es un tema de permisos, cortamos acá con el error real.
    const esPermiso = /#10|#100|permission|nonexisting/i.test(err.message || '');
    if (!esPermiso) return respondJSON(res, err.status || 502, { error: err.message });
  }

  // Intento 2: el listado de videos del ad account (act_X/advideos) responde
  // con el token de ads en cuentas donde el nodo directo da (#10).
  if (accountId) {
    try {
      let after = null, guard = 0;
      do {
        const params = { fields: 'id,source,picture,length', limit: 100 };
        if (after) params.after = after;
        const d = await graphGet(`${accountId}/advideos`, token, params);
        const hit = (d.data || []).find(v => String(v.id) === String(videoId));
        if (hit?.source) {
          return respondJSON(res, 200, {
            source: hit.source,
            picture: hit.picture || null,
            permalink: null,
            lengthSec: Number(hit.length) || null,
          });
        }
        after = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
        guard++;
      } while (after && guard < 5);
    } catch { /* cae al 404 de abajo */ }
  }

  return respondJSON(res, 404, {
    error: 'Meta no expone el mp4 de este video con el permiso actual del token — usá la vista previa del ad (se carga sola) o abrilo en Meta.',
    sinPermiso: true,
  });
}

// Vista previa OFICIAL de un ad (la misma que renderiza Ads Manager): Graph
// /{ad_id}/previews devuelve un iframe que reproduce el creativo real,
// video incluido, y funciona con ads_read — es el fallback de reproducción
// cuando el mp4 no está disponible. El src del iframe vence a las 24 h.
const PREVIEW_FORMATS = ['INSTAGRAM_REELS', 'INSTAGRAM_STANDARD', 'MOBILE_FEED_STANDARD', 'DESKTOP_FEED_STANDARD'];
async function handleAdPreview(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });

  const adId = url.searchParams.get('ad_id');
  if (!adId || !/^\d+$/.test(adId)) return respondJSON(res, 400, { error: 'Falta ad_id (numérico)' });
  const pedido = url.searchParams.get('format');
  const formatos = pedido && PREVIEW_FORMATS.includes(pedido)
    ? [pedido, ...PREVIEW_FORMATS.filter(f => f !== pedido)]
    : PREVIEW_FORMATS;

  let ultimoError = null;
  for (const formato of formatos) {
    try {
      const d = await graphGet(`${adId}/previews`, token, { ad_format: formato });
      const body = d.data?.[0]?.body || '';
      const m = body.match(/src="([^"]+)"/);
      if (m) {
        // El src viene HTML-escapado dentro del atributo.
        const src = m[1].replace(/&amp;/g, '&');
        return respondJSON(res, 200, { iframeSrc: src, formato });
      }
    } catch (err) {
      ultimoError = err.message;
    }
  }
  return respondJSON(res, 502, { error: `Meta no devolvió la vista previa del ad${ultimoError ? ` (${ultimoError})` : ''}` });
}

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
//   - cron-creative-refresh → cron diario: misma lógica, config via env
// ------------------------------------------------------------------------

// Resuelve el Page Access Token de la Page indicada a partir de un User
// Access Token con scope `pages_show_list`. Con el page token podemos leer
// el IG Business vinculado y su media SIN necesitar el scope `instagram_basic`
// (que Meta rechaza en la consent screen si la app no tiene el producto
// Instagram aprobado). Si no se puede resolver, devolvemos el token original
// (los System User Tokens tienen acceso hereditario y funcionan igual).
async function resolvePageToken(pageId, userToken) {
  try {
    const data = await graphGet('me/accounts', userToken, {
      fields: 'id,access_token',
      limit: 100,
    });
    const match = (data.data || []).find(p => String(p.id) === String(pageId));
    return match?.access_token || userToken;
  } catch {
    return userToken;
  }
}

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
//
// Query params: ig_id, pinned, page_id (recomendado — habilita Page Access
// Token, que es lo que permite leer IG media sin el scope instagram_basic).
async function handleLatestIgPost(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const igId = url.searchParams.get('ig_id');
  const pageId = url.searchParams.get('page_id');
  const pinned = Math.max(0, Math.min(Number(url.searchParams.get('pinned') || 0), 10));
  if (!igId) return respondJSON(res, 400, { error: 'Falta ig_id' });

  try {
    const igToken = pageId
      ? await resolvePageToken(pageId, session.accessToken)
      : session.accessToken;
    const data = await graphGet(`${igId}/media`, igToken, {
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
// Pagina hasta agotar (Meta devuelve 25-100 por página). Incluye explícitamente
// todos los effective_status no-archivados — por default Meta omite algunos
// transitorios como IN_PROCESS o WITH_ISSUES.
async function handleCampaigns(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  // resolveAccessToken en vez de solo la cookie legacy: así el selector de
  // campañas funciona también en modo conexiones multi-cuenta (connection_id).
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });
  const session = { accessToken: token };
  const accountId = url.searchParams.get('account_id');
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id' });

  // Estados que queremos ver. Meta sólo acepta estos valores en el filter
  // `effective_status` para CAMPAIGN (otros como DELETED_PENDING o SCHEDULED
  // rompen el endpoint con error 400). Con estos cubrimos todas las activas,
  // pausadas y las que están bajo review.
  const effectiveStatus = JSON.stringify([
    'ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES',
    'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED',
  ]);

  try {
    const all = [];
    let next = null;
    let guard = 0;
    do {
      const params = {
        fields: 'id,name,objective,status,effective_status,created_time',
        limit: 100,
        effective_status: effectiveStatus,
      };
      if (next) params.after = next;
      const data = await graphGet(`${accountId}/campaigns`, session.accessToken, params);
      for (const c of data.data || []) all.push(c);
      next = data.paging?.cursors?.after && data.paging?.next ? data.paging.cursors.after : null;
      guard++;
    } while (next && guard < 3); // máx ~300 campañas — cap bajo para no quemar rate limit de Meta

    const campaigns = all.map(c => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effectiveStatus: c.effective_status,
      createdTime: c.created_time,
    }));
    // Orden: más recientes primero (útil para el combobox buscable).
    campaigns.sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));
    return respondJSON(res, 200, { campaigns, total: campaigns.length, hasMore: !!next });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// Lista los conjuntos (ad sets) de una campaña. Por default trae fields
// mínimos (id, name, status, created_time) — suficiente para que el combobox
// del form de Auto IG pueda mostrarlos. Si el caller pide `with_ads=1`
// (p. ej. alguna vista que muestre el creative actual), agrega la expansión
// `ads{...creative{...}}` — esa expansión es costosa en Meta y puede tardar
// varios segundos si hay muchos ad sets.
async function handleCampaignAdsets(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  // Ídem handleCampaigns: cookie legacy O conexión guardada (connection_id).
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });
  const session = { accessToken: token };
  const campaignId = url.searchParams.get('campaign_id');
  const withAds = url.searchParams.get('with_ads') === '1';
  if (!campaignId) return respondJSON(res, 400, { error: 'Falta campaign_id' });

  const fieldsMinimal = 'id,name,status,effective_status,created_time,updated_time';
  // ads.limit(100): la expansión anidada pagina a 25 por default y el loop de
  // abajo pagina los ADSETS, no este edge — sin el limit, un conjunto de
  // testeo con 30+ ads mostraba solo los primeros 25 en el selector.
  const fieldsHeavy = fieldsMinimal + ',ads.limit(100){id,name,status,effective_status,creative{id,name,object_story_id,instagram_permalink_url,thumbnail_url,effective_instagram_media_id}}';
  const fields = withAds ? fieldsHeavy : fieldsMinimal;

  try {
    const all = [];
    let next = null;
    let guard = 0;
    do {
      const params = { fields, limit: 100 };
      if (next) params.after = next;
      const data = await graphGet(`${campaignId}/adsets`, session.accessToken, params);
      for (const s of data.data || []) all.push(s);
      next = data.paging?.cursors?.after && data.paging?.next ? data.paging.cursors.after : null;
      guard++;
    } while (next && guard < 3); // máx ~300 ad sets — cap bajo para proteger rate limit

    const adsets = all.map(s => {
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
        // La LISTA COMPLETA de ads del conjunto — el publicador de campañas
        // la usa como tercera columna del selector de template. Antes solo
        // viajaba mainAd y el picker decía "Sin ads en este conjunto".
        ads: ads.map(ad => ({
          id: ad.id,
          name: ad.name,
          status: ad.status,
          effectiveStatus: ad.effective_status,
          thumbnailUrl: ad.creative?.thumbnail_url || null,
        })),
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
    adsets.sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));
    return respondJSON(res, 200, { adsets, total: adsets.length, hasMore: !!next });
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

  // Dual-auth: cookie de user (UI manual) o header de cron (Vercel Cron).
  // Vercel envía `x-vercel-cron: 1`; además aceptamos un Bearer secret para
  // disparar el cron desde un scheduler externo. En modo cron usamos
  // META_SYSTEM_ACCESS_TOKEN (long-lived, idealmente System User de Business
  // Manager — no expira).
  // SEGURIDAD: `x-vercel-cron` es un header informativo que cualquier request
  // externo puede falsificar → no es un límite de seguridad. Exigimos el Bearer
  // secret (Vercel Cron lo envía automáticamente cuando CRON_SECRET está seteado
  // en el proyecto). Sin secreto configurado, cronAuth es false (default seguro).
  const cronSecret = process.env.IG_REFRESH_CRON_SECRET || process.env.CRON_SECRET;
  const cronAuth = !!cronSecret &&
    req.headers.authorization === `Bearer ${cronSecret}`;

  let accessToken;
  if (cronAuth) {
    accessToken = process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_LONG_LIVED_TOKEN;
    if (!accessToken) {
      return respondJSON(res, 500, {
        error: 'Cron sin META_SYSTEM_ACCESS_TOKEN — seteá el env var antes de agendar.',
      });
    }
  } else {
    const session = readMetaCookie(req);
    if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });
    accessToken = session.accessToken;
  }

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

  const token = accessToken;
  // Page Access Token para todo lo que sea IG API (media list + likes).
  // `instagram_basic` no está en el scope; el page token hereda permisos
  // de la Page y alcanza para leer el IG Business vinculado.
  const igToken = await resolvePageToken(pageId, token);
  const log = [];
  const paused = [];
  let created = null;
  let detectedPost = null;
  let actionTaken = 'no-change';

  const now = new Date().toISOString();
  const activeAdsets = Array.isArray(state.activeAdsets) ? [...state.activeAdsets] : [];

  try {
    // --- Paso 1: último post del feed IG ---
    const feed = await graphGet(`${igId}/media`, igToken, {
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
      const { likes, permalink, error } = await fetchIgPostLikes(entry.postId, igToken);
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

// ========================================================================
// CRON CREATIVE REFRESH — dispara run-creative-refresh todos los días
// ========================================================================
// Vercel Cron llama GET /api/meta/cron-creative-refresh con header
// `x-vercel-cron: 1`. Este handler:
//   1. Verifica autorización (header Vercel o Bearer secret).
//   2. Lee la config del producto desde env var CREATIVE_REFRESH_CONFIG
//      (JSON con accountId, campaignId, baseAdsetId, igId, pageId,
//      threshold, pinnedPosts, webhookUrl, enabled).
//   3. Deriva el `state` leyendo los adsets activos de la campaña (no hay
//      KV server-side, entonces el "estado" vive en Meta).
//   4. Construye un req sintético con headers de cron + body y llama al
//      handler existente de run-creative-refresh.
async function handleCronCreativeRefresh(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return respondJSON(res, 405, { error: 'Method not allowed' });
  }

  // Autorización: header Vercel Cron o Bearer secret.
  // SEGURIDAD: `x-vercel-cron` es un header informativo que cualquier request
  // externo puede falsificar → no es un límite de seguridad. Exigimos el Bearer
  // secret (Vercel Cron lo envía automáticamente cuando CRON_SECRET está seteado
  // en el proyecto). Sin secreto configurado, cronAuth es false (default seguro).
  const cronSecret = process.env.IG_REFRESH_CRON_SECRET || process.env.CRON_SECRET;
  const cronAuth = !!cronSecret &&
    req.headers.authorization === `Bearer ${cronSecret}`;
  if (!cronAuth) return respondJSON(res, 401, { error: 'Cron no autorizado' });

  // Aviso PREVENTIVO de vencimiento del token de Meta (best-effort): corre
  // en este cron diario aunque el creative-refresh no esté configurado.
  let metaExpiry = null;
  try {
    const { warnMetaExpiryIfDue } = await import('./_alert.js');
    metaExpiry = await warnMetaExpiryIfDue();
  } catch (e) { console.warn('[cron] warn meta expiry:', e.message); }

  // ⭐ Winners automáticos (best-effort): marca en Producción los videos que
  // Meta muestra como ganadores — solo productos con data; el resto sigue
  // manual. Corre acá aunque el creative-refresh no esté configurado.
  let autoWinners = null;
  try {
    const { correrAutoWinners } = await import('../produccion/auto-winners.js');
    autoWinners = await correrAutoWinners();
  } catch (e) {
    autoWinners = { error: e.message };
    console.warn('[cron] auto-winners:', e.message);
  }

  // Config desde env var.
  const raw = process.env.CREATIVE_REFRESH_CONFIG;
  if (!raw) {
    return respondJSON(res, 200, { skipped: true, reason: 'CREATIVE_REFRESH_CONFIG no configurada', metaExpiry, autoWinners });
  }
  let cfg;
  try { cfg = JSON.parse(raw); } catch {
    return respondJSON(res, 500, { error: 'CREATIVE_REFRESH_CONFIG inválida (JSON)' });
  }
  if (cfg.enabled === false) {
    return respondJSON(res, 200, { skipped: true, reason: 'CREATIVE_REFRESH_CONFIG.enabled=false' });
  }

  const required = ['accountId', 'campaignId', 'baseAdsetId', 'igId', 'pageId'];
  const missing = required.filter(k => !cfg[k]);
  if (missing.length) {
    return respondJSON(res, 500, { error: `CREATIVE_REFRESH_CONFIG incompleta: ${missing.join(', ')}` });
  }

  const accessToken = process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_LONG_LIVED_TOKEN;
  if (!accessToken) {
    return respondJSON(res, 500, { error: 'Falta META_SYSTEM_ACCESS_TOKEN para el cron' });
  }

  // Derivar state desde la campaña (stateless — no usamos KV). Listamos los
  // adsets ACTIVOS con el IG media que tiene cada uno; así el handler de
  // refresh puede saber si el último post ya está publicado y qué adsets
  // candidatos hay para pausar.
  let derivedState = { lastPostId: null, activeAdsets: [] };
  try {
    const adsetsData = await graphGet(`${cfg.campaignId}/adsets`, accessToken, {
      fields: 'id,status,effective_status,ads{id,status,effective_status,creative{id,effective_instagram_media_id}}',
      limit: 100,
    });
    const active = (adsetsData.data || []).filter(
      s => s.effective_status === 'ACTIVE' || s.status === 'ACTIVE'
    );
    const activeAdsets = [];
    for (const s of active) {
      const ad = (s.ads?.data || [])[0];
      const postId = ad?.creative?.effective_instagram_media_id || null;
      if (postId) activeAdsets.push({ adsetId: s.id, postId, createdAt: null, postPermalink: null });
    }
    // lastPostId: usamos el postId del adset más reciente como proxy (si
    // coincide con el último de IG, no hay cambio). Si hay empate o no hay
    // data, null hace que el handler trate cualquier post como "nuevo".
    derivedState.activeAdsets = activeAdsets;
    derivedState.lastPostId = activeAdsets[0]?.postId || null;
  } catch (err) {
    console.warn('[cron-creative-refresh] no pude derivar state:', err.message);
  }

  // Construir req sintético para re-entrar por handleRunCreativeRefresh con
  // las mismas headers de cron (así toma el branch de auth de cron).
  const synthReq = {
    method: 'POST',
    headers: {
      'x-vercel-cron': req.headers['x-vercel-cron'] || '1',
      authorization: req.headers.authorization || '',
      host: req.headers.host,
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'https',
      'x-forwarded-host': req.headers['x-forwarded-host'],
    },
    body: {
      accountId: cfg.accountId,
      campaignId: cfg.campaignId,
      baseAdsetId: cfg.baseAdsetId,
      igId: cfg.igId,
      pageId: cfg.pageId,
      threshold: Number(cfg.threshold || 50),
      pinnedPosts: Number(cfg.pinnedPosts || 0),
      webhookUrl: cfg.webhookUrl || null,
      state: derivedState,
      dryRun: false,
    },
    query: { action: 'run-creative-refresh' },
    url: '/api/meta/run-creative-refresh',
    on() {},
  };
  return handleRunCreativeRefresh(synthReq, res);
}

// Resuelve una URL pública de Instagram (ej. https://www.instagram.com/xyz/)
// a un { igUserId, pageId, username, pageName } buscando entre las IG
// Business Accounts conectadas a las Pages del user.
//
// Nota: para crear un ad con un post de IG necesitamos sí o sí que esa
// cuenta esté conectada a una Page del Business Manager del user. La URL
// pública nos sirve para identificarla sin pedirle al user que "conecte IG"
// explícitamente — pero la cuenta tiene que existir en su Business.
async function handleResolveIgUrl(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const igUrl = url.searchParams.get('ig_url');
  if (!igUrl) return respondJSON(res, 400, { error: 'Falta ig_url' });

  // Parse username desde la URL. Formatos aceptados:
  //   https://www.instagram.com/username/
  //   https://instagram.com/username
  //   instagram.com/username
  //   @username
  //   username
  let username;
  try {
    const raw = igUrl.trim();
    if (raw.startsWith('@')) {
      username = raw.slice(1);
    } else if (raw.includes('instagram.com')) {
      const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      const parts = u.pathname.split('/').filter(Boolean);
      username = parts[0] || '';
    } else {
      username = raw;
    }
    username = username.toLowerCase().replace(/[^a-z0-9._]/g, '');
    if (!username) throw new Error('vacío');
  } catch {
    return respondJSON(res, 400, { error: 'No pude extraer el username de la URL' });
  }

  try {
    const data = await graphGet('me/accounts', session.accessToken, {
      fields: 'id,name,instagram_business_account{id,username}',
      limit: 100,
    });
    const pages = data.data || [];
    const match = pages.find(p => {
      const u = p.instagram_business_account?.username;
      return u && String(u).toLowerCase() === username;
    });
    if (!match) {
      return respondJSON(res, 404, {
        error: `No encontré @${username} entre las IG Business vinculadas a tus Pages. Asegurate de que esa cuenta esté convertida a Business y linkeada a una Page de tu Business Manager.`,
      });
    }
    return respondJSON(res, 200, {
      igUserId: match.instagram_business_account.id,
      pageId: match.id,
      username,
      pageName: match.name,
    });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// ========================================================================
// CONEXIÓN POR ACCESS TOKEN (sin OAuth)
// ========================================================================
// Alternativa simple al flujo OAuth: el user pega un access token de larga
// duración (System User token del Business Manager, o uno generado en el
// Graph API Explorer) y lo guardamos en la MISMA cookie firmada que usa
// todo el resto de /api/meta/*. Así reutilizamos ad-accounts, campaigns,
// insights, etc. sin tocar nada más.
//
// Por qué existe: crear una app de Meta Developer + pasar App Review para
// ads_read/ads_management es lento (y a veces inviable si la cuenta de
// developer está bloqueada). Un token pegado funciona al instante para uso
// propio sobre tu propia cuenta publicitaria.
//
// Body JSON: { accessToken: "EAAB..." }
async function handleConnectToken(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) return respondJSON(res, 500, { error: 'AUTH_SECRET no configurada en el servidor' });

  // Parsear body (Vercel no auto-parsea siempre en POST).
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

  const accessToken = String(body?.accessToken || '').trim();
  if (!accessToken) return respondJSON(res, 400, { error: 'Falta accessToken' });

  // Validamos el token llamando a /me. Si Meta devuelve error, el token es
  // inválido, expiró, o no tiene permisos básicos.
  let me;
  try {
    me = await fetchMe(accessToken);
  } catch (err) {
    return respondJSON(res, 502, { error: `No pude validar el token contra Meta: ${err.message}` });
  }
  if (me?.error || !me?.id) {
    const msg = me?.error?.message || 'Meta no devolvió un user id — el token es inválido o expiró.';
    return respondJSON(res, 401, { error: `Token inválido: ${msg}` });
  }

  // CANJE A LARGA DURACIÓN: un token pegado a mano suele ser el corto del
  // Graph Explorer (horas) — guardarlo tal cual era una desconexión segura a
  // los pocos días. Si el canje falla (token de otra app, o de System User,
  // que no vence y no se canjea), se guarda el original: no es fatal.
  let tokenFinal = accessToken;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (appId && appSecret) {
    try {
      const long = await exchangeForLongLived(appId, appSecret, accessToken);
      if (long?.access_token) tokenFinal = long.access_token;
    } catch { /* token de otra app o de System User → se usa el original */ }
  }

  // Si hay Supabase + JWT del user, guardamos la conexión en DB (multi-cuenta):
  // así se pueden tener varias cuentas/clientes conectados a la vez.
  const userId = isSupabaseConfigured() ? await getUserIdFromAuth(req) : null;
  if (userId) {
    try {
      const connection = await insertMetaConnection(userId, {
        label: body?.label,
        metaUserId: me.id,
        metaUserName: me.name || null,
        accessToken: tokenFinal,
      });
      // Token nuevo OK → resetear el flag de "Meta caído".
      try { const { markMetaHealthy } = await import('./_alert.js'); await markMetaHealthy(); } catch {}
      return respondJSON(res, 200, {
        stored: 'db',
        connection,
        user: { id: me.id, name: me.name || null },
      });
    } catch (err) {
      return respondJSON(res, 502, { error: `No pude guardar la conexión: ${err.message}` });
    }
  }

  // Fallback legacy: sin Supabase guardamos en cookie (una sola conexión).
  const cookiePayload = {
    accessToken: tokenFinal,
    metaUserId: me.id,
    metaUserName: me.name || null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + META_COOKIE_MAX_AGE,
  };
  setMetaCookie(res, signState(cookiePayload, authSecret));

  // Token nuevo OK → resetear el flag de "Meta caído".
  try { const { markMetaHealthy } = await import('./_alert.js'); await markMetaHealthy(); } catch {}

  return respondJSON(res, 200, {
    stored: 'cookie',
    connected: true,
    user: { id: me.id, name: me.name || null },
  });
}

// Lista (GET) y borra (DELETE) las conexiones guardadas del user. Requiere
// JWT de Supabase. La lista NUNCA incluye el access_token.
async function handleConnections(req, res) {
  if (req.method === 'GET') {
    if (!isSupabaseConfigured()) {
      // Sin Supabase no hay multi-conexión: el front cae a modo cookie.
      return respondJSON(res, 200, { supabase: false, authenticated: false, connections: [] });
    }
    const userId = await getUserIdFromAuth(req);
    if (!userId) return respondJSON(res, 200, { supabase: true, authenticated: false, connections: [] });
    try {
      const connections = await listMetaConnections(userId);
      return respondJSON(res, 200, { supabase: true, authenticated: true, connections });
    } catch (err) {
      return respondJSON(res, 502, { error: err.message });
    }
  }
  if (req.method === 'DELETE') {
    const userId = await getUserIdFromAuth(req);
    if (!userId) return respondJSON(res, 401, { error: 'No autenticado' });
    const url = new URL(req.url, getOrigin(req));
    const connId = url.searchParams.get('connection_id');
    if (!connId) return respondJSON(res, 400, { error: 'Falta connection_id' });
    try {
      await deleteMetaConnection(userId, connId);
      return respondJSON(res, 200, { ok: true });
    } catch (err) {
      return respondJSON(res, 502, { error: err.message });
    }
  }
  return respondJSON(res, 405, { error: 'Method not allowed' });
}

// ========================================================================
// CAMPAÑAS CON INSIGHTS — la tabla de tracking
// ========================================================================
// Lista las campañas de una ad account con sus métricas agregadas para un
// período (date_preset). Es el endpoint que alimenta la tabla de "Campañas".
// Reusa parseInsights() para derivar ROAS/CPA/compras del bloque actions.
//
// Query params:
//   account_id   (obligatorio, con prefijo act_)
//   date_preset  (opcional, default last_7d)
async function handleCampaignsInsights(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });

  const accountId = url.searchParams.get('account_id');
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id (con prefijo act_)' });

  // Período. Sólo aceptamos presets que Meta soporta — cualquier otro cae a
  // last_7d para no romper el call.
  const allowedPresets = [
    'today', 'yesterday', 'last_7d', 'last_14d', 'last_30d',
    'last_90d', 'this_month', 'last_month', 'maximum',
  ];
  let datePreset = url.searchParams.get('date_preset') || 'last_7d';
  if (!allowedPresets.includes(datePreset)) datePreset = 'last_7d';

  const effectiveStatus = JSON.stringify([
    'ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES',
    'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED',
  ]);

  try {
    const all = [];
    let next = null;
    let guard = 0;
    do {
      const params = {
        fields: [
          'id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time',
          `insights.date_preset(${datePreset}){impressions,clicks,ctr,cpc,cpm,spend,actions,action_values,reach,frequency}`,
        ].join(','),
        limit: 100,
        effective_status: effectiveStatus,
      };
      if (next) params.after = next;
      const data = await graphGet(`${accountId}/campaigns`, token, params);
      for (const c of data.data || []) all.push(c);
      next = data.paging?.cursors?.after && data.paging?.next ? data.paging.cursors.after : null;
      guard++;
    } while (next && guard < 5); // máx ~500 campañas

    const campaigns = all.map(c => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effectiveStatus: c.effective_status,
      // Meta devuelve budgets en centavos de la moneda de la cuenta.
      dailyBudget: c.daily_budget != null ? Number(c.daily_budget) / 100 : null,
      lifetimeBudget: c.lifetime_budget != null ? Number(c.lifetime_budget) / 100 : null,
      createdTime: c.created_time,
      insights: parseInsights(c.insights?.data?.[0]),
    }));
    // Orden: mayor gasto primero (lo que más importa trackear arriba).
    campaigns.sort((a, b) => (b.insights?.spend || 0) - (a.insights?.spend || 0));

    // Totales agregados para la fila de resumen de la tabla.
    const totals = campaigns.reduce((t, c) => {
      const i = c.insights;
      if (!i) return t;
      t.spend += i.spend || 0;
      t.impressions += i.impressions || 0;
      t.clicks += i.clicks || 0;
      t.purchases += i.purchases || 0;
      t.revenue += i.revenue || 0;
      return t;
    }, { spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 });
    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
    totals.cpa = totals.purchases > 0 ? totals.spend / totals.purchases : 0;

    return respondJSON(res, 200, {
      accountId,
      datePreset,
      total: campaigns.length,
      totals,
      campaigns,
    });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// ========================================================================
// Embudo de compra por campaña — el endpoint que alimenta la sección
// "Métricas". A diferencia de campaigns-insights (que devuelve el total
// plano del período), acá pedimos TODOS los pasos del funnel para poder
// mostrar dónde se cae la gente:
//
//   impresiones → clicks al enlace → landing page views → add to cart
//   → iniciar pago → compras
//
// Usamos {account}/insights con level=campaign en vez de expandir insights
// dentro de /campaigns: una sola llamada devuelve una fila por campaña ya
// agregada, y Meta la resuelve mucho más rápido.
//
// Query params:
//   account_id     (obligatorio, con prefijo act_)
//   date_preset    (opcional, default last_7d)
//   connection_id  (opcional — conexión guardada; si no, cookie)
async function handleFunnelInsights(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });

  const accountId = url.searchParams.get('account_id');
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id (con prefijo act_)' });

  const allowedPresets = [
    'today', 'yesterday', 'last_7d', 'last_14d', 'last_30d',
    'last_90d', 'this_month', 'last_month', 'maximum',
  ];
  let datePreset = url.searchParams.get('date_preset') || 'last_7d';
  // Rango personalizado del calendario: "custom_YYYY-MM-DD_YYYY-MM-DD".
  const customEmbudo = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(datePreset);
  if (!customEmbudo && !allowedPresets.includes(datePreset)) datePreset = 'last_7d';

  try {
    const rows = [];
    let next = null;
    let guard = 0;
    do {
      const params = {
        level: 'campaign',
        ...(customEmbudo
          ? { time_range: JSON.stringify({ since: customEmbudo[1], until: customEmbudo[2] }) }
          : { date_preset: datePreset }),
        fields: [
          'campaign_id', 'campaign_name', 'objective',
          'impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm', 'reach', 'frequency',
          'inline_link_clicks', 'inline_link_click_ctr', 'cost_per_inline_link_click',
          'actions', 'action_values', 'cost_per_action_type',
        ].join(','),
        limit: 100,
      };
      if (next) params.after = next;
      const data = await graphGet(`${accountId}/insights`, token, params);
      for (const r of data.data || []) rows.push(r);
      next = data.paging?.cursors?.after && data.paging?.next ? data.paging.cursors.after : null;
      guard++;
    } while (next && guard < 5); // máx ~500 campañas

    const campaigns = rows.map(r => ({
      id: r.campaign_id,
      name: r.campaign_name,
      objective: r.objective || null,
      funnel: parseFunnel(r),
    }));
    campaigns.sort((a, b) => (b.funnel?.spend || 0) - (a.funnel?.spend || 0));

    // Totales de la cuenta: sumamos los crudos y recalculamos los ratios.
    // Promediar ratios por campaña daría un número que no existe (una
    // campaña de $2 pesaría igual que una de $2000).
    const totals = campaigns.reduce((t, c) => {
      const f = c.funnel;
      if (!f) return t;
      for (const k of ['spend', 'impressions', 'clicks', 'linkClicks', 'landingPageViews',
        'addToCart', 'initiateCheckout', 'purchases', 'revenue']) {
        t[k] += f[k] || 0;
      }
      return t;
    }, {
      spend: 0, impressions: 0, clicks: 0, linkClicks: 0, landingPageViews: 0,
      addToCart: 0, initiateCheckout: 0, purchases: 0, revenue: 0,
    });
    Object.assign(totals, deriveFunnelRates(totals));

    return respondJSON(res, 200, {
      accountId,
      datePreset,
      total: campaigns.length,
      totals,
      campaigns,
    });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// ========================================================================
// Testeos — todo lo que necesita el tablero de KPIs en una sola llamada.
//
// Devuelve tres cosas distintas porque responden tres preguntas distintas:
//   1. campaigns → cómo viene cada tanda de testeos (cohortes semanales).
//   2. adsToday  → la ronda de optimización: qué pausar HOY.
//   3. ads7d     → prospectadores: quién sigue trayendo gente nueva.
//
// El server NO clasifica nada: manda los números crudos normalizados y la
// clasificación (qué es testeo, quién ganó, qué pausar) la hace el cliente
// con src/testeosCore.js. Así, al mover un umbral, el tablero se recalcula al
// instante sin volver a pegarle a Meta.
//
// Query: account_id, connection_id?, date_preset? (campañas, default last_30d)
async function handleTestingInsights(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });

  const accountId = url.searchParams.get('account_id');
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id (con prefijo act_)' });

  const allowed = ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month', 'maximum'];
  let preset = url.searchParams.get('date_preset') || 'last_30d';
  // Rango personalizado del calendario: "custom_YYYY-MM-DD_YYYY-MM-DD".
  const custom = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(preset);
  if (!custom && !allowed.includes(preset)) preset = 'last_30d';
  const insSel = custom
    ? `insights.time_range({"since":"${custom[1]}","until":"${custom[2]}"})`
    : `insights.date_preset(${preset})`;

  // Campos de insights que alimentan el embudo y las reglas.
  const INS = 'impressions,clicks,ctr,cpc,cpm,spend,reach,frequency,actions,action_values';

  const effectiveStatus = JSON.stringify([
    'ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED',
  ]);

  try {
    // TODAS las llamadas a Meta salen EN PARALELO (antes campañas y conjuntos
    // iban en serie delante del resto y la carga tardaba el doble o más). El
    // join de presupuestos se hace al final, cuando ya está todo en memoria.

    // ── 1. Campañas con su acumulado del período ──
    const traerCampanas = async () => {
      const lista = [];
      let after = null, guard = 0;
      do {
        const params = {
          fields: `id,name,status,effective_status,daily_budget,lifetime_budget,created_time,start_time,${insSel}{${INS}}`,
          limit: 100,
          effective_status: effectiveStatus,
        };
        if (after) params.after = after;
        const d = await graphGet(`${accountId}/campaigns`, token, params);
        for (const c of d.data || []) {
          lista.push({
            id: c.id,
            name: c.name,
            status: c.status,
            effectiveStatus: c.effective_status,
            // Meta manda los presupuestos en centavos de la moneda de la cuenta.
            dailyBudget: c.daily_budget != null ? Number(c.daily_budget) / 100 : null,
            lifetimeBudget: c.lifetime_budget != null ? Number(c.lifetime_budget) / 100 : null,
            createdTime: c.created_time,
            // "Fecha de inicio" real del Calendario de la campaña (con el huso
            // de la cuenta). Las cohortes semanales se arman con esto, no con
            // la fecha escrita en el nombre.
            startTime: c.start_time || null,
            insights: parseFunnel(c.insights?.data?.[0]) || null,
          });
        }
        after = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
        guard++;
      } while (after && guard < 6);
      return lista;
    };

    // ── 2. Presupuestos de los conjuntos (para la plata en riesgo) ──
    // En ABO el presupuesto vive en el conjunto, no en la campaña.
    const traerAdsets = async () => {
      const mapa = new Map();
      try {
        let a2 = null, g2 = 0;
        do {
          const params = { fields: 'id,name,daily_budget,campaign_id', limit: 200 };
          if (a2) params.after = a2;
          const d = await graphGet(`${accountId}/adsets`, token, params);
          for (const s of d.data || []) {
            mapa.set(s.id, {
              name: s.name,
              campaignId: s.campaign_id,
              dailyBudget: s.daily_budget != null ? Number(s.daily_budget) / 100 : null,
            });
          }
          a2 = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
          g2++;
        } while (a2 && g2 < 6);
      } catch (e) {
        console.warn('meta/testing-insights adsets:', e.message);
      }
      return mapa;
    };

    // Trae insights a nivel anuncio para un período. Una sola llamada por
    // período: {cuenta}/insights?level=ad devuelve una fila por anuncio.
    const adsDe = async (datePreset) => {
      const filas = [];
      let a = null, g = 0;
      do {
        const params = {
          level: 'ad',
          date_preset: datePreset,
          fields: `ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,${INS}`,
          limit: 200,
        };
        if (a) params.after = a;
        const d = await graphGet(`${accountId}/insights`, token, params);
        for (const r of d.data || []) {
          // El presupuesto del padre se pega DESPUÉS del Promise.all (los
          // conjuntos y campañas se están trayendo en paralelo con esto).
          filas.push({
            id: r.ad_id,
            name: r.ad_name,
            adsetId: r.adset_id,
            adsetName: r.adset_name,
            campaignId: r.campaign_id,
            campaignName: r.campaign_name,
            insights: parseFunnel(r),
          });
        }
        a = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
        g++;
      } while (a && g < 6);
      return filas;
    };

    // Insights de HOY a nivel campaña. Es el nivel donde se decide de verdad
    // cuando el presupuesto es CBO: pausar un anuncio adentro de una campaña
    // no ahorra nada (la campaña gasta igual), pausar la campaña sí.
    const campanasHoy = async () => {
      const filas = [];
      let a = null, g = 0;
      do {
        const params = {
          level: 'campaign',
          date_preset: 'today',
          fields: `campaign_id,campaign_name,${INS}`,
          limit: 200,
        };
        if (a) params.after = a;
        const d = await graphGet(`${accountId}/insights`, token, params);
        for (const r of d.data || []) {
          filas.push({
            id: r.campaign_id,
            name: r.campaign_name,
            campaignName: r.campaign_name,
            // dailyBudget se pega después del Promise.all.
            nivelPresupuesto: 'campaña',
            insights: parseFunnel(r),
          });
        }
        a = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
        g++;
      } while (a && g < 6);
      return filas;
    };

    // Estado de cada anuncio. Los insights NO lo traen: /insights devuelve
    // rendimiento, no configuración. Sin esto la ronda no puede dibujar un
    // botón de prender/pausar, porque no sabe de qué lado está el interruptor
    // (ni distinguir "todavía anda" de "ya lo pausaste a media mañana", que
    // igual aparece con gasto de hoy).
    const estadosDeAnuncios = async () => {
      const mapa = new Map();
      try {
        let a = null, g = 0;
        do {
          const params = { fields: 'id,status,effective_status', limit: 500, effective_status: effectiveStatus };
          if (a) params.after = a;
          const d = await graphGet(`${accountId}/ads`, token, params);
          for (const ad of d.data || []) {
            mapa.set(ad.id, { status: ad.status, effectiveStatus: ad.effective_status });
          }
          a = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
          g++;
        } while (a && g < 10);
      } catch (e) {
        // Sin estados la ronda sigue sirviendo para mirar; solo se queda sin
        // los botones. No es motivo para tirar abajo toda la respuesta.
        console.warn('meta/testing-insights estados de anuncios:', e.message);
      }
      return mapa;
    };

    // ── 3. TODO junto: campañas, conjuntos, hoy, 7 días y estados ──
    const [campanas, adsets, adsToday, ads7d, campaignsToday, estadosAds] = await Promise.all([
      traerCampanas(), traerAdsets(), adsDe('today'), adsDe('last_7d'), campanasHoy(), estadosDeAnuncios(),
    ]);

    // Join de presupuestos: el del conjunto si es ABO, si no el de la campaña
    // (CBO). Es contra esto que se mide lo que queda por gastar.
    const budgetPorCampana = new Map(campanas.map(c => [c.id, c.dailyBudget]));
    for (const ad of [...adsToday, ...ads7d]) {
      const conjunto = adsets.get(ad.adsetId) || null;
      ad.dailyBudget = conjunto?.dailyBudget ?? budgetPorCampana.get(ad.campaignId) ?? null;
      ad.nivelPresupuesto = conjunto?.dailyBudget != null ? 'conjunto' : 'campaña';
    }
    for (const c of campaignsToday) c.dailyBudget = budgetPorCampana.get(c.id) ?? null;

    // Pegar el estado a cada fila. La campaña ya lo trae de la llamada 1.
    const estadoCampana = new Map(campanas.map(c => [c.id, { status: c.status, effectiveStatus: c.effectiveStatus }]));
    for (const c of campaignsToday) Object.assign(c, estadoCampana.get(c.id) || {});
    for (const ad of [...adsToday, ...ads7d]) Object.assign(ad, estadosAds.get(ad.id) || {});

    // Gasto de hoy por padre: sirve para prorratear la plata en riesgo de un
    // anuncio dentro de una campaña que reparte un presupuesto común.
    const gastoPorPadre = {};
    for (const ad of adsToday) {
      const k = ad.nivelPresupuesto === 'conjunto' ? `as:${ad.adsetId}` : `c:${ad.campaignId}`;
      gastoPorPadre[k] = (gastoPorPadre[k] || 0) + (ad.insights?.spend || 0);
    }
    for (const ad of adsToday) {
      const k = ad.nivelPresupuesto === 'conjunto' ? `as:${ad.adsetId}` : `c:${ad.campaignId}`;
      ad.parentKey = k;
      ad.parentSpend = gastoPorPadre[k] || 0;
    }

    return respondJSON(res, 200, {
      accountId,
      datePreset: preset,
      campaigns: campanas,
      campaignsToday,
      adsToday,
      ads7d,
      totales: {
        campanas: campanas.length,
        campanasHoy: campaignsToday.length,
        adsHoy: adsToday.length,
        ads7d: ads7d.length,
      },
    });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}


// Prende o pausa campañas, conjuntos o anuncios. ES EL ÚNICO ENDPOINT QUE
// ESCRIBE EN LA CUENTA PUBLICITARIA — todo lo demás de este archivo lee.
//
// Antes de tocar nada se verifica que cada entidad viva en la cuenta que el
// pedido dice. Sin ese chequeo, un id equivocado (o pegado de otra pestaña)
// pausaría algo en OTRA cuenta del mismo usuario, y el toast diría que salió
// todo bien. Es una llamada extra por entidad y vale la pena: son máximo 25.
//
// Las entidades se procesan de a una y en serie, cada una con su resultado.
// Si la número 3 falla por permisos, las otras igual quedaron cambiadas y el
// front sabe cuáles: un all-or-nothing acá sería mentira, porque Meta no da
// transacciones.
// Desglose de UNA campaña: sus conjuntos y los anuncios de cada uno con los
// números del preset pedido (default: hoy). Es lo que ve la Ronda de
// optimización al expandir una campaña — los niveles del Ads Manager sin
// cambiar de vista. Una sola llamada a Graph (fields anidados).
// GET ?account_id=act_X&campaign_id=123&preset=today[&connection_id=...]
async function handleCampaignBreakdown(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error });

  const campaignId = String(url.searchParams.get('campaign_id') || '').trim();
  const preset = /^[a-z0-9_]+$/.test(url.searchParams.get('preset') || '') ? url.searchParams.get('preset') : 'today';
  if (!/^\d+$/.test(campaignId)) return respondJSON(res, 400, { error: 'campaign_id inválido' });

  const INS = 'spend,actions,action_values';
  const parse = (row) => {
    const ins = row?.insights?.data?.[0] || null;
    const spend = Number(ins?.spend || 0);
    const compras = ins ? pickAction(ins.actions, ACTION_ALIASES.purchases) : 0;
    const revenue = ins ? pickAction(ins.action_values, ACTION_ALIASES.purchases) : 0;
    const atc = ins ? pickAction(ins.actions, ACTION_ALIASES.addToCart) : 0;
    const chk = ins ? pickAction(ins.actions, ACTION_ALIASES.initiateCheckout) : 0;
    return {
      spend, compras,
      roas: spend > 0 ? revenue / spend : 0,
      costoATC: atc > 0 ? spend / atc : null,
      costoCheckout: chk > 0 ? spend / chk : null,
    };
  };

  try {
    const d = await graphGet(`${campaignId}/adsets`, token, {
      fields: `id,name,effective_status,daily_budget,insights.date_preset(${preset}){${INS}},ads.limit(50){id,name,effective_status,insights.date_preset(${preset}){${INS}}}`,
      limit: 50,
    });
    const adsets = (d.data || []).map(s => ({
      id: s.id,
      name: s.name,
      effectiveStatus: s.effective_status,
      dailyBudget: s.daily_budget != null ? Number(s.daily_budget) / 100 : null,
      ...parse(s),
      ads: (s.ads?.data || [])
        .map(ad => ({ id: ad.id, name: ad.name, effectiveStatus: ad.effective_status, ...parse(ad) }))
        .sort((a, b) => b.spend - a.spend),
    })).sort((a, b) => b.spend - a.spend);
    return respondJSON(res, 200, { adsets });
  } catch (e) {
    return respondJSON(res, e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

// Cambia el presupuesto DIARIO de una campaña (CBO) o un conjunto (ABO) —
// el equivalente al doble click en la columna Presupuesto del Ads Manager.
// POST { account_id, connection_id?, level: 'campaign'|'adset', id, dailyBudget }
// `dailyBudget` viene en moneda de la cuenta; Meta lo quiere en centavos.
async function handleSetBudget(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

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

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status: authStatus } = await resolveAccessToken(req, url, body?.connection_id || null);
  if (!token) return respondJSON(res, authStatus || 401, { error: error || 'Meta no conectado' });

  const accountId = String(body.account_id || '').trim();
  const id = String(body.id || '').trim();
  const level = body.level === 'adset' ? 'adset' : 'campaign';
  const monto = Number(body.dailyBudget);
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id (con prefijo act_)' });
  if (!/^\d+$/.test(id)) return respondJSON(res, 400, { error: 'id inválido' });
  if (!Number.isFinite(monto) || monto <= 0) return respondJSON(res, 400, { error: 'Presupuesto inválido' });

  const nombre = level === 'adset' ? 'conjunto' : 'campaña';
  try {
    // 1. ¿Existe, es de esta cuenta y tiene presupuesto diario PROPIO?
    const actual = await graphGet(id, token, { fields: 'id,name,daily_budget,account_id' });
    if (!mismaCuenta(actual.account_id, accountId)) {
      return respondJSON(res, 400, { error: `Esa ${nombre} no es de la cuenta ${accountId}.` });
    }
    if (actual.daily_budget == null) {
      return respondJSON(res, 400, {
        error: level === 'campaign'
          ? 'Esta campaña no tiene presupuesto diario propio (ABO: el presupuesto vive en sus conjuntos).'
          : 'Este conjunto no tiene presupuesto diario propio (CBO: el presupuesto vive en la campaña).',
      });
    }
    const anterior = Number(actual.daily_budget) / 100;
    // 2. El cambio (Meta trabaja en centavos de la moneda de la cuenta).
    await graphPost(id, token, { daily_budget: String(Math.round(monto * 100)) });
    return respondJSON(res, 200, { ok: true, id, name: actual.name, anterior, nuevo: monto });
  } catch (e) {
    return respondJSON(res, e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

async function handleSetStatus(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

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

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status: authStatus } = await resolveAccessToken(req, url, body?.connection_id || null);
  if (!token) return respondJSON(res, authStatus || 401, { error: error || 'Meta no conectado' });

  const pedido = validarPedido(body);
  if (!pedido.ok) return respondJSON(res, 400, { error: pedido.error });

  const accountId = String(body.account_id || '').trim();
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id (con prefijo act_)' });

  const nombreNivel = NIVELES[pedido.level].singular;
  const resultados = [];

  for (const id of pedido.ids) {
    try {
      // 1. ¿Existe y es de esta cuenta?
      const actual = await graphGet(id, token, { fields: 'id,name,status,effective_status,account_id' });
      if (!mismaCuenta(actual.account_id, accountId)) {
        resultados.push({ id, ok: false, error: `Esa ${nombreNivel} no es de la cuenta ${accountId}.` });
        continue;
      }
      // 2. Ya está como se pide: no gastamos una escritura al pedo.
      if (actual.status === pedido.status) {
        resultados.push({ id, ok: true, name: actual.name, status: actual.status, sinCambio: true });
        continue;
      }
      // 3. El cambio.
      await graphPost(id, token, { status: pedido.status });
      resultados.push({ id, ok: true, name: actual.name, status: pedido.status, anterior: actual.status });
    } catch (e) {
      resultados.push({ id, ok: false, error: e.message || 'Error de Meta' });
    }
  }

  // 207 cuando salió a medias: el front distingue "todo bien" de "revisá".
  const fallaron = resultados.filter(r => !r.ok).length;
  const code = fallaron === 0 ? 200 : (fallaron === resultados.length ? 502 : 207);
  return respondJSON(res, code, { level: pedido.level, status: pedido.status, resultados });
}

// ========================================================================
// ADS MANAGER — la tabla clásica por niveles (pestaña "Campañas y anuncios")
// ========================================================================
// Una fila por entidad del nivel pedido (campaign | adset | ad) con los
// números del período: gasto, compras, ingresos, ROAS, CPA. Las filas salen
// de /insights a nivel cuenta (una llamada paginada) y se les une estado y
// presupuesto desde el listado de entidades (otra llamada) — insights no
// trae effective_status.
// GET ?account_id=act_X&level=campaign&date_preset=last_7d|custom_A_B[&connection_id]
async function handleManagerTable(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error });

  const accountId = String(url.searchParams.get('account_id') || '').trim();
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id' });
  const level = ['campaign', 'adset', 'ad'].includes(url.searchParams.get('level'))
    ? url.searchParams.get('level') : 'campaign';

  let preset = url.searchParams.get('date_preset') || 'last_7d';
  const custom = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(preset);
  if (!custom && !/^[a-z0-9_]+$/.test(preset)) preset = 'last_7d';
  const rango = custom
    ? { time_range: JSON.stringify({ since: custom[1], until: custom[2] }) }
    : { date_preset: preset };

  const CAMPOS = {
    campaign: 'campaign_id,campaign_name',
    adset: 'adset_id,adset_name,campaign_name',
    ad: 'ad_id,ad_name,adset_name,campaign_name',
  }[level];
  const EDGE = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' }[level];
  const ENT_FIELDS = level === 'ad'
    ? 'id,effective_status'
    : 'id,effective_status,daily_budget' + (level === 'campaign' ? ',lifetime_budget' : '');

  try {
    const traerInsights = async () => {
      const filas = [];
      let after = null, guard = 0;
      do {
        const params = { level, fields: `${CAMPOS},spend,actions,action_values`, limit: 250, ...rango };
        if (after) params.after = after;
        const d = await graphGet(`${accountId}/insights`, token, params);
        filas.push(...(d.data || []));
        after = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
        guard++;
      } while (after && guard < 8);
      return filas;
    };
    const traerEntidades = async () => {
      const map = new Map();
      let after = null, guard = 0;
      do {
        const params = { fields: ENT_FIELDS, limit: 500 };
        if (after) params.after = after;
        const d = await graphGet(`${accountId}/${EDGE}`, token, params);
        for (const e of d.data || []) map.set(e.id, e);
        after = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
        guard++;
      } while (after && guard < 6);
      return map;
    };
    const [insights, entidades] = await Promise.all([traerInsights(), traerEntidades()]);

    const rows = insights.map(r => {
      const id = r[`${level}_id`];
      const ent = entidades.get(id) || {};
      const spend = Number(r.spend || 0);
      const compras = pickAction(r.actions, ACTION_ALIASES.purchases);
      const revenue = pickAction(r.action_values, ACTION_ALIASES.purchases);
      return {
        id,
        name: r[`${level}_name`] || id,
        sub: level === 'campaign' ? null
          : level === 'adset' ? (r.campaign_name || null)
          : [r.adset_name, r.campaign_name].filter(Boolean).join(' · ') || null,
        effectiveStatus: ent.effective_status || null,
        dailyBudget: ent.daily_budget != null ? Number(ent.daily_budget) / 100 : null,
        spend, compras, revenue,
        roas: spend > 0 ? revenue / spend : 0,
        cpa: compras > 0 ? spend / compras : null,
      };
    }).filter(r => r.spend > 0 || r.compras > 0);

    const totals = rows.reduce((t, r) => {
      t.spend += r.spend; t.compras += r.compras; t.revenue += r.revenue; return t;
    }, { spend: 0, compras: 0, revenue: 0 });
    totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
    totals.cpa = totals.compras > 0 ? totals.spend / totals.compras : null;

    return respondJSON(res, 200, { level, rows, totals, total: rows.length });
  } catch (e) {
    return respondJSON(res, e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

// ========================================================================
// PUBLICAR CAMPAÑAS — el lanzador de AdsLab
// ========================================================================
// Crea en Meta una estructura completa de venta a partir de posts existentes
// (nombre + post id), con las tres recetas del equipo:
//   cbo_deep    → CBO sin tope de puja (deep pocket): presupuesto en la
//                 campaña, LOWEST_COST_WITHOUT_CAP.
//   cbo_costcap → CBO con costo objetivo: presupuesto en la campaña,
//                 COST_CAP, la puja (costo por compra objetivo) va como
//                 bid_amount en cada conjunto.
//   abo_bidcap  → ABO con tope de puja: presupuesto POR CONJUNTO,
//                 LOWEST_COST_WITH_BID_CAP + bid_amount en cada conjunto.
// Todo se crea PAUSADO salvo que pidan activar: revisás en Meta y encendés.

// Prerrequisitos del formulario: páginas del usuario y píxeles de la cuenta.
// GET ?account_id=act_X[&connection_id=...]
async function handleLaunchPrereqs(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error });
  const accountId = String(url.searchParams.get('account_id') || '').trim();
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id' });
  try {
    const [pixelsR, pagesR] = await Promise.allSettled([
      graphGet(`${accountId}/adspixels`, token, { fields: 'id,name', limit: 25 }),
      graphGet('me/accounts', token, { fields: 'id,name', limit: 50 }),
    ]);
    return respondJSON(res, 200, {
      pixels: pixelsR.status === 'fulfilled' ? (pixelsR.value.data || []) : [],
      pages: pagesR.status === 'fulfilled' ? (pagesR.value.data || []) : [],
    });
  } catch (e) {
    return respondJSON(res, 500, { error: e.message });
  }
}

// POST { account_id, connection_id?, estructura, nombre, presupuesto, puja,
//        conjuntos, pageId, pixelId, pais, edadMin, edadMax,
//        ads: [{ name, postId }], activar }
async function handleLaunchCampaign(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

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

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status: authStatus } = await resolveAccessToken(req, url, body?.connection_id || null);
  if (!token) return respondJSON(res, authStatus || 401, { error: error || 'Meta no conectado' });

  const accountId = String(body.account_id || '').trim();
  const estructura = ['cbo_deep', 'cbo_costcap', 'abo_bidcap'].includes(body.estructura) ? body.estructura : null;
  const nombre = String(body.nombre || '').trim();
  const presupuesto = Number(body.presupuesto);
  const puja = Number(body.puja || 0);
  const conjuntos = Math.min(5, Math.max(1, Math.round(Number(body.conjuntos) || 1)));
  const pageId = String(body.pageId || '').trim();
  const pixelId = String(body.pixelId || '').trim();
  const pais = /^[A-Z]{2}$/.test(String(body.pais || '').toUpperCase()) ? String(body.pais).toUpperCase() : 'AR';
  const edadMin = Math.min(65, Math.max(13, Math.round(Number(body.edadMin) || 18)));
  const edadMax = Math.min(65, Math.max(edadMin, Math.round(Number(body.edadMax) || 65)));
  const activar = body.activar === true;
  const ads = (Array.isArray(body.ads) ? body.ads : [])
    .map(a => ({ name: String(a?.name || '').trim(), postId: String(a?.postId || '').trim() }))
    .filter(a => a.postId);

  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id' });
  if (!estructura) return respondJSON(res, 400, { error: 'Estructura inválida' });
  if (!nombre) return respondJSON(res, 400, { error: 'Falta el nombre de la campaña' });
  if (!Number.isFinite(presupuesto) || presupuesto <= 0) return respondJSON(res, 400, { error: 'Presupuesto inválido' });
  if ((estructura === 'cbo_costcap' || estructura === 'abo_bidcap') && (!Number.isFinite(puja) || puja <= 0)) {
    return respondJSON(res, 400, { error: estructura === 'cbo_costcap' ? 'Falta la puja (costo por compra objetivo)' : 'Falta la puja (tope de puja)' });
  }
  if (!pixelId) return respondJSON(res, 400, { error: 'Falta el píxel (va en promoted_object del conjunto)' });
  if (!ads.length) return respondJSON(res, 400, { error: 'Pasá al menos un anuncio (nombre + post id)' });
  if (ads.length > 20) return respondJSON(res, 400, { error: 'Máximo 20 anuncios por tirada' });
  const sinPagina = ads.some(a => !a.postId.includes('_'));
  if (sinPagina && !pageId) return respondJSON(res, 400, { error: 'Hay post ids sin página (sin "_"): elegí la página para componer pageId_postId' });

  const estado = activar ? 'ACTIVE' : 'PAUSED';
  const bidStrategy = estructura === 'cbo_deep' ? 'LOWEST_COST_WITHOUT_CAP'
    : estructura === 'cbo_costcap' ? 'COST_CAP' : 'LOWEST_COST_WITH_BID_CAP';
  const esCbo = estructura !== 'abo_bidcap';

  const resumen = { campaignId: null, adsets: [], errores: [] };
  try {
    // 1. Campaña.
    const campParams = {
      name: nombre,
      objective: 'OUTCOME_SALES',
      buying_type: 'AUCTION',
      special_ad_categories: [],
      bid_strategy: bidStrategy,
      status: estado,
    };
    if (esCbo) campParams.daily_budget = String(Math.round(presupuesto * 100));
    const camp = await graphPost(`${accountId}/campaigns`, token, campParams);
    resumen.campaignId = camp.id;

    // 2. Conjuntos. Los ads se REPARTEN en orden entre los conjuntos
    //    (2 conjuntos y 6 ads → 3 y 3), como en los testeos del equipo.
    const grupos = Array.from({ length: conjuntos }, () => []);
    ads.forEach((a, i) => grupos[i % conjuntos].push(a));

    for (let i = 0; i < grupos.length; i++) {
      const grupo = grupos[i];
      if (!grupo.length) continue;
      const adsetParams = {
        name: conjuntos > 1 ? `${nombre} · C${i + 1}` : nombre,
        campaign_id: camp.id,
        status: estado,
        optimization_goal: 'OFFSITE_CONVERSIONS',
        billing_event: 'IMPRESSIONS',
        promoted_object: { pixel_id: pixelId, custom_event_type: 'PURCHASE' },
        targeting: {
          geo_locations: { countries: [pais] },
          age_min: edadMin,
          age_max: edadMax,
          // Advantage+ audience: que Meta expanda — es como arma los testeos
          // el equipo. Las ubicaciones quedan automáticas (sin placements).
          targeting_automation: { advantage_audience: 1 },
        },
      };
      if (!esCbo) adsetParams.daily_budget = String(Math.round(presupuesto * 100));
      if (estructura !== 'cbo_deep') adsetParams.bid_amount = String(Math.round(puja * 100));
      let adset;
      try {
        adset = await graphPost(`${accountId}/adsets`, token, adsetParams);
      } catch (e) {
        resumen.errores.push(`Conjunto C${i + 1}: ${e.message}`);
        continue;
      }
      const fila = { id: adset.id, name: adsetParams.name, ads: [] };
      resumen.adsets.push(fila);

      // 3. Anuncios del conjunto: creative desde el post existente + ad.
      for (const ad of grupo) {
        const storyId = ad.postId.includes('_') ? ad.postId : `${pageId}_${ad.postId}`;
        const adName = ad.name || `Ad ${storyId.split('_')[1] || storyId}`;
        try {
          const creative = await graphPost(`${accountId}/adcreatives`, token, {
            name: adName,
            object_story_id: storyId,
          });
          const nuevo = await graphPost(`${accountId}/ads`, token, {
            name: adName,
            adset_id: adset.id,
            creative: { creative_id: creative.id },
            status: estado,
          });
          fila.ads.push({ name: adName, id: nuevo.id, ok: true });
        } catch (e) {
          fila.ads.push({ name: adName, ok: false, error: e.message });
        }
      }
    }

    const creados = resumen.adsets.reduce((s, x) => s + x.ads.filter(a => a.ok).length, 0);
    return respondJSON(res, 200, {
      ok: resumen.errores.length === 0 && creados > 0,
      ...resumen,
      creados,
      estado,
    });
  } catch (e) {
    // Si la campaña no llegó a crearse, no quedó nada colgado en Meta.
    return respondJSON(res, e.status && e.status < 500 ? e.status : 500, {
      error: e.message,
      ...resumen,
    });
  }
}

// ========================================================================
// PUBLICAR CAMPAÑAS — el "Ads Uploader" propio: los videos aprobados de una
// tarjeta de Producción se suben a Meta y se crea campaña → conjuntos → ads
// clonando la configuración (targeting, pixel, página, CTA) de un ad
// template elegido por el usuario. Todo con el token de la conexión (los
// writes ya estaban probados por set-status / run-creative-refresh).
//
// El flujo es en 3 pasos orquestados por el front (así ningún request de
// Vercel espera el procesamiento de video de Meta):
//   1. upload-ad-videos  → act/advideos con file_url (Meta baja el archivo).
//   2. videos-status     → polling hasta que cada video esté ready + picture.
//   3. create-campaign-structure → campaña + conjuntos + creatives + ads.
// ========================================================================

// Meta devuelve el MISMO error críptico ("Unsupported post request. Object
// with ID 'act_X' does not exist, cannot be loaded due to missing
// permissions...") cuando el token puede LEER la cuenta pero no ESCRIBIR —
// p. ej. una conexión OAuth hecha cuando AdsLab pedía solo ads_read. Lo
// traducimos a algo accionable en vez de mandar al usuario a la doc de Graph.
function traducirErrorMetaEscritura(msg) {
  const m = String(msg || '');
  if (/Unsupported post request|missing permissions|\(#200\)|\(#10\)|requires (the extended permission|ads_management)/i.test(m)) {
    return 'Tu conexión de Meta no tiene permisos de ESCRITURA (se conectó pidiendo solo lectura). Andá a Conectar Meta, reconectá la cuenta aceptando los permisos nuevos (gestión de anuncios y páginas) y reintentá. Detalle de Meta: ' + m.slice(0, 220);
  }
  return m;
}

// Config normalizada del ad template: lo que se clona al publicar.
async function handleTemplateConfig(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });
  const adId = url.searchParams.get('ad_id');
  if (!adId || !/^\d+$/.test(adId)) return respondJSON(res, 400, { error: 'Falta ad_id (numérico)' });

  try {
    const d = await graphGet(adId, token, {
      fields: 'id,name,campaign{id,name,objective,special_ad_categories},adset{id,name,targeting,optimization_goal,billing_event,promoted_object,destination_type},creative{id,object_story_spec}',
    });
    const oss = d.creative?.object_story_spec || {};
    const vd = oss.video_data || {};
    const ld = oss.link_data || {};
    const cta = vd.call_to_action || ld.call_to_action || null;

    // El GET de targeting trae campos read-only/deprecados que Graph RECHAZA
    // al re-postearlos en act/adsets (#100): se sanitiza acá, una sola vez.
    const targeting = d.adset?.targeting ? { ...d.adset.targeting } : null;
    if (targeting) {
      delete targeting.targeting_optimization;
      delete targeting.targeting_relaxation_types;
      // Internos que Meta devuelve pero NO acepta en escritura — re-postearlos
      // tira "(#3) Application does not have the capability" (verificado
      // 14/10/2026 con un adset real de la cuenta Vya).
      delete targeting.subscriber_universe;
      delete targeting.user_age_unknown;
      delete targeting.age_range;
    }

    // instagram_actor_id legacy puede ser una cuenta PBIA que
    // instagram_user_id no acepta: lo resolvemos contra la página real y si
    // no hay IG vinculada, se omite (Meta usa la de la página o PBIA solo).
    let instagramUserId = oss.instagram_user_id || null;
    if (!instagramUserId && oss.page_id) {
      try {
        const pg = await graphGet(oss.page_id, token, { fields: 'instagram_business_account' });
        instagramUserId = pg.instagram_business_account?.id || null;
      } catch { instagramUserId = null; }
    }

    return respondJSON(res, 200, {
      adName: d.name,
      campaign: {
        id: d.campaign?.id || null,
        name: d.campaign?.name || null,
        objective: d.campaign?.objective || null,
        specialAdCategories: d.campaign?.special_ad_categories || [],
      },
      adset: {
        id: d.adset?.id || null,
        name: d.adset?.name || null,
        targeting,
        optimizationGoal: d.adset?.optimization_goal || null,
        billingEvent: d.adset?.billing_event || null,
        promotedObject: d.adset?.promoted_object || null,
        destinationType: d.adset?.destination_type || null,
      },
      pageId: oss.page_id || null,
      instagramUserId,
      link: cta?.value?.link || ld.link || null,
      ctaType: cta?.type || 'SHOP_NOW',
      defaultMessage: vd.message || ld.message || '',
    });
  } catch (err) {
    return respondJSON(res, err.status || 502, { error: err.message });
  }
}

// Sube videos a act/advideos por URL. El server resuelve la URL de cada
// archivo de la tarjeta: storagePath (bucket creativos, firmada con el rol
// de servicio — el admin no puede firmar paths del editor desde el client) o
// driveId (link directo de descarga de Drive; funciona con archivos
// compartidos por link, que es como viven las carpetas de Producción).
async function handleUploadAdVideos(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  let body;
  try {
    if (req.body && typeof req.body === 'object') body = req.body;
    else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
  } catch { return respondJSON(res, 400, { error: 'Body JSON inválido' }); }

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url, body?.connection_id || null);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });

  const accountId = String(body.account_id || '').trim();
  const videos = Array.isArray(body.videos) ? body.videos.slice(0, 30) : [];
  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id (con prefijo act_)' });
  if (videos.length === 0) return respondJSON(res, 400, { error: 'Sin videos para subir' });

  const sb = getServiceClient();

  // URL de descarga directa para un archivo de Drive. drive.usercontent es
  // el host que hoy sirve bytes directos; uc?export=download devuelve una
  // página interstitial (virus-scan) para archivos grandes y Meta terminaba
  // bajando HTML → "Video Fetch Failed". Validamos con un HEAD que lo que se
  // le manda a Meta sea realmente un video, para dar un error accionable.
  const resolverDriveUrl = async (driveId) => {
    const id = encodeURIComponent(String(driveId));
    const candidatas = [
      `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
      `https://drive.google.com/uc?export=download&id=${id}&confirm=t`,
    ];
    for (const u of candidatas) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 12000);
        // GET con Range (1 byte) en vez de HEAD: algunos endpoints de Drive
        // responden 405 o sin content-type útil a HEAD.
        const h = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctl.signal, headers: { Range: 'bytes=0-0' } });
        clearTimeout(timer);
        try { h.body?.cancel?.(); } catch {}
        const tipo = (h.headers.get('content-type') || '').toLowerCase();
        if ((h.ok || h.status === 206) && (tipo.startsWith('video/') || tipo.includes('octet-stream'))) return u;
      } catch { /* probamos la siguiente */ }
    }
    throw new Error('Drive no entrega el archivo directo (¿está compartido como "cualquiera con el link"? ¿pesa >100MB?)');
  };

  const subirUno = async (v) => {
    const name = String(v?.name || 'video').slice(0, 90);
    // `index` viaja de ida y vuelta: es la clave con la que el cliente une
    // cada resultado con SU archivo. Mapear por nombre rompía con nombres
    // duplicados o >90 chars (el slice de arriba cambiaba la clave).
    const index = Number.isInteger(v?.index) ? v.index : null;
    try {
      let fileUrl = String(v?.fileUrl || '').trim();
      if (!fileUrl && v?.storagePath) {
        if (!sb) throw new Error('Supabase no está configurado en el server (SUPABASE_SERVICE_ROLE_KEY) — no puedo firmar archivos de AdsLab');
        const { data, error: e } = await sb.storage.from('creativos').createSignedUrl(String(v.storagePath), 3600);
        if (e || !data?.signedUrl) throw new Error(`No pude firmar el archivo (${e?.message || 'sin URL'})`);
        fileUrl = data.signedUrl;
      }
      if (!fileUrl && v?.driveId) fileUrl = await resolverDriveUrl(v.driveId);
      if (!fileUrl) throw new Error('El archivo no tiene storagePath ni driveId');
      const up = await graphPost(`${accountId}/advideos`, token, { file_url: fileUrl, name });
      return { name, index, ok: true, videoId: up.id };
    } catch (e) {
      return { name, index, ok: false, error: traducirErrorMetaEscritura(e.message) || 'Error subiendo a Meta' };
    }
  };

  // Tandas de 4: paraleliza sin pegarle de lleno al rate limit de Marketing API.
  const resultados = [];
  for (let i = 0; i < videos.length; i += 4) {
    const tanda = await Promise.all(videos.slice(i, i + 4).map(subirUno));
    resultados.push(...tanda);
  }
  const fallaron = resultados.filter(r => !r.ok).length;
  const code = fallaron === 0 ? 200 : (fallaron === resultados.length ? 502 : 207);
  return respondJSON(res, code, {
    // Con 502 el front corta en metaApi: el detalle por video viaja en `error`.
    ...(code === 502 ? { error: resultados.map(r => `${r.name}: ${r.error}`).join(' | ').slice(0, 600) } : {}),
    resultados,
  });
}

// Estado de procesamiento de los videos subidos (y su thumbnail, que el
// creative necesita como image_url).
async function handleVideosStatus(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status } = await resolveAccessToken(req, url);
  if (!token) return respondJSON(res, status || 401, { error: error || 'Meta no conectado' });
  const ids = String(url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).slice(0, 30);
  if (ids.length === 0) return respondJSON(res, 400, { error: 'Falta ids (coma-separados)' });

  const videos = [];
  for (const id of ids) {
    try {
      const d = await graphGet(id, token, { fields: 'status,picture' });
      const st = d.status?.video_status || 'unknown';
      // `ready` exige TAMBIÉN el thumbnail: el creative lleva picture como
      // image_url OBLIGATORIO, y Meta suele publicar el picture un rato
      // después del video_status ready. Sin esto, publicar "apenas está
      // listo" creaba todos los creatives sin imagen y fallaban en bloque.
      videos.push({ id, status: st, ready: st === 'ready' && !!d.picture, picture: d.picture || null });
    } catch (e) {
      videos.push({ id, status: 'error', ready: false, error: e.message });
    }
  }
  return respondJSON(res, 200, { videos, todosListos: videos.every(v => v.ready) });
}

// Crea campaña → conjuntos → creatives → ads con la config del template.
// CBO: el presupuesto vive en la campaña; los conjuntos van sin budget.
async function handleCreateCampaignStructure(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  let body;
  try {
    if (req.body && typeof req.body === 'object') body = req.body;
    else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
  } catch { return respondJSON(res, 400, { error: 'Body JSON inválido' }); }

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const { token, error, status: authStatus } = await resolveAccessToken(req, url, body?.connection_id || null);
  if (!token) return respondJSON(res, authStatus || 401, { error: error || 'Meta no conectado' });

  const accountId = String(body.account_id || '').trim();
  const campaignName = String(body.campaignName || '').trim();
  const dailyBudget = Number(body.dailyBudget);
  const adsPerSet = Math.max(1, Math.min(10, Number(body.adsPerSet) || 3));
  const estado = body.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
  const template = body.template || {};
  const message = String(body.message || '').slice(0, 2000);
  const headline = String(body.headline || '').slice(0, 120);
  const ads = (Array.isArray(body.ads) ? body.ads : []).filter(a => a?.videoId).slice(0, 30);

  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id' });
  if (!campaignName) return respondJSON(res, 400, { error: 'Falta el nombre de la campaña' });
  if (!(dailyBudget > 0)) return respondJSON(res, 400, { error: 'Presupuesto diario inválido' });
  if (ads.length === 0) return respondJSON(res, 400, { error: 'Sin videos listos para crear ads' });
  if (!template.pageId) return respondJSON(res, 400, { error: 'El template no tiene page_id — elegí otro ad de referencia' });

  const log = [];
  try {
    // Objetivos legacy (pre-ODAX): Meta NO deja crear campañas nuevas con
    // ellos — si el template es viejo, se mapea al OUTCOME_* equivalente.
    const ODAX = {
      CONVERSIONS: 'OUTCOME_SALES', PRODUCT_CATALOG_SALES: 'OUTCOME_SALES',
      LINK_CLICKS: 'OUTCOME_TRAFFIC', VIDEO_VIEWS: 'OUTCOME_ENGAGEMENT',
      POST_ENGAGEMENT: 'OUTCOME_ENGAGEMENT', PAGE_LIKES: 'OUTCOME_ENGAGEMENT',
      MESSAGES: 'OUTCOME_ENGAGEMENT', REACH: 'OUTCOME_AWARENESS',
      BRAND_AWARENESS: 'OUTCOME_AWARENESS', LEAD_GENERATION: 'OUTCOME_LEADS',
      APP_INSTALLS: 'OUTCOME_APP_PROMOTION',
    };
    const rawObjetivo = template.campaign?.objective || 'OUTCOME_SALES';
    const objective = rawObjetivo.startsWith('OUTCOME_') ? rawObjetivo : (ODAX[rawObjetivo] || 'OUTCOME_SALES');
    if (objective !== rawObjetivo) log.push(`Objetivo legacy ${rawObjetivo} → ${objective}`);

    // Monedas sin centavos: el budget va en la unidad mínima — para ARS/USD
    // se multiplica por 100, para CLP/COP/PYG etc. NO (si no, gasta 100x).
    const SIN_CENTAVOS = new Set(['CLP', 'COP', 'PYG', 'VND', 'JPY', 'KRW', 'HUF', 'TWD', 'ISK', 'CRC']);
    const currency = String(body.currency || '').toUpperCase();
    const budgetMinUnit = Math.round(dailyBudget * (SIN_CENTAVOS.has(currency) ? 1 : 100));

    // 1. Campaña (CBO) — SIEMPRE nace PAUSED: si algo falla a mitad de
    // camino no queda una campaña activa a medias gastando. Se activa al
    // final, en una sola escritura, solo si hubo al menos un ad creado OK.
    const camp = await graphPost(`${accountId}/campaigns`, token, {
      name: campaignName,
      objective,
      status: 'PAUSED',
      special_ad_categories: Array.isArray(template.campaign?.specialAdCategories) ? template.campaign.specialAdCategories : [],
      daily_budget: budgetMinUnit,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    });
    log.push(`✓ Campaña creada: ${camp.id} (pausada hasta el final)`);

    // Rollback: si de acá en adelante NADA útil se creó (ni un ad), borramos
    // la campaña para no dejar basura pausada en el Ads Manager.
    let huboAdsOk = false; // con ≥1 ad creado, el rollback NUNCA borra
    const borrarCampana = async () => {
      if (huboAdsOk) return;
      try {
        await graphPost(String(camp.id), token, { status: 'DELETED' });
        log.push('↺ Campaña borrada (rollback: no se creó ningún anuncio)');
      } catch (e) {
        log.push(`⚠ No pude borrar la campaña ${camp.id}: ${e.message} — borrala desde Meta`);
      }
    };

    try {

    // Patrón de nombre de conjunto: {index}, {index:01}, {date}. La fecha la
    // manda el CLIENTE (la del nombre de campaña = mañana, regla del equipo)
    // para que preview y realidad coincidan; fallback: hoy en AR.
    const hoyAr = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric' });
    const fechaPatron = String(body.fecha || hoyAr).slice(0, 20);
    const nombreConjunto = (i) => {
      const base = String(body.adsetNamePattern || 'Ad Set {index:01}');
      return base
        .replaceAll('{index:01}', String(i + 1).padStart(2, '0'))
        .replaceAll('{index}', String(i + 1))
        .replaceAll('{date}', fechaPatron)
        .replaceAll('{filename}', '')
        .trim()
        .slice(0, 100) || `Ad Set ${i + 1}`;
    };

    // 2. Conjuntos — clonando targeting/optimización/pixel del template.
    const nSets = Math.ceil(ads.length / adsPerSet);
    const adsetIds = [];
    for (let i = 0; i < nSets; i++) {
      const payload = {
        name: nombreConjunto(i),
        campaign_id: camp.id,
        targeting: template.adset?.targeting || { geo_locations: { countries: ['AR'] } },
        optimization_goal: template.adset?.optimizationGoal || 'OFFSITE_CONVERSIONS',
        billing_event: template.adset?.billingEvent || 'IMPRESSIONS',
        status: estado,
      };
      if (template.adset?.promotedObject) payload.promoted_object = template.adset.promotedObject;
      if (template.adset?.destinationType) payload.destination_type = template.adset.destinationType;
      const as = await graphPost(`${accountId}/adsets`, token, payload);
      adsetIds.push(as.id);
      log.push(`✓ Conjunto ${i + 1}/${nSets}: ${as.id}`);
    }

    // 3. Creatives + ads — en tandas de 4 (71 POSTs secuenciales rozaban el
    // maxDuration de Vercel; en tandas entra holgado sin reventar el rate
    // limit de Marketing API).
    const crearAd = async (ad, j) => {
      const adsetId = adsetIds[Math.floor(j / adsPerSet)];
      try {
        // El thumbnail es OBLIGATORIO en video_data: si el polling lo dejó
        // pasar sin picture, se reintenta acá; sin picture el ad falla con
        // mensaje claro en vez de mandar un POST inválido.
        let picture = ad.picture || null;
        if (!picture) {
          try { picture = (await graphGet(String(ad.videoId), token, { fields: 'picture' })).picture || null; } catch {}
        }
        if (!picture) throw new Error('Meta todavía no generó el thumbnail del video — reintentá en 1 minuto');

        const videoData = {
          video_id: String(ad.videoId),
          image_url: picture,
          message,
        };
        if (headline) videoData.title = headline;
        if (template.link) videoData.call_to_action = { type: template.ctaType || 'SHOP_NOW', value: { link: template.link } };
        const oss = { page_id: String(template.pageId), video_data: videoData };
        if (template.instagramUserId) oss.instagram_user_id = String(template.instagramUserId);

        const creative = await graphPost(`${accountId}/adcreatives`, token, {
          name: `${String(ad.name || 'video').slice(0, 80)} · creative`,
          object_story_spec: oss,
        });
        const nuevo = await graphPost(`${accountId}/ads`, token, {
          name: String(ad.name || `Ad ${j + 1}`).slice(0, 100),
          adset_id: adsetId,
          creative: { creative_id: creative.id },
          status: estado,
        });
        return { name: ad.name, ok: true, adId: nuevo.id, adsetId };
      } catch (e) {
        return { name: ad.name, ok: false, error: traducirErrorMetaEscritura(e.message) };
      }
    };
    const resultados = [];
    for (let j = 0; j < ads.length; j += 4) {
      const tanda = await Promise.all(ads.slice(j, j + 4).map((ad, k) => crearAd(ad, j + k)));
      resultados.push(...tanda);
    }
    for (const [j, r] of resultados.entries()) log.push(r.ok ? `✓ Ad ${j + 1}/${ads.length}: ${r.adId}` : `✗ Ad ${j + 1}/${ads.length}: ${r.error}`);

    // 4. Activación final: una sola escritura, solo con ≥1 ad OK.
    const okAds = resultados.filter(r => !r.ok ? false : true).length;
    huboAdsOk = okAds > 0;
    let estadoFinal = 'PAUSED';
    if (estado === 'ACTIVE' && okAds > 0) {
      await graphPost(camp.id, token, { status: 'ACTIVE' });
      estadoFinal = 'ACTIVE';
      log.push('✓ Campaña ACTIVADA');
    } else if (okAds === 0) {
      log.push('✗ Ningún ad se creó');
      await borrarCampana();
    }

    const fallaron = resultados.filter(r => !r.ok).length;
    return respondJSON(res, fallaron === 0 ? 200 : 207, {
      campaignId: camp.id,
      adsetIds,
      resultados,
      log,
      estado: okAds === 0 ? 'DELETED' : estadoFinal,
    });

    } catch (errInterno) {
      // Falló antes de crear ningún ad (p. ej. el primer conjunto): no
      // dejamos la campaña vacía tirada en el Ads Manager.
      await borrarCampana();
      throw errInterno;
    }
  } catch (err) {
    log.push(`✗ ${err.message}`);
    return respondJSON(res, err.status || 502, { error: traducirErrorMetaEscritura(err.message), log });
  }
}

// --- dispatcher ---

const actions = {
  connect: handleConnect,
  'connect-url': handleConnectUrl,
  'oauth-config': handleOauthConfig,
  callback: handleCallback,
  'connect-token': handleConnectToken,
  connections: handleConnections,
  disconnect: handleDisconnect,
  me: handleMe,
  'ad-accounts': handleAdAccounts,
  'campaigns-insights': handleCampaignsInsights,
  'funnel-insights': handleFunnelInsights,
  'testing-insights': handleTestingInsights,
  'ads-with-insights': handleAdsWithInsights,
  'ad-performance': handleAdPerformance,
  'video-source': handleVideoSource,
  'ad-preview': handleAdPreview,
  'template-config': handleTemplateConfig,
  'upload-ad-videos': handleUploadAdVideos,
  'videos-status': handleVideosStatus,
  'create-campaign-structure': handleCreateCampaignStructure,
  'ig-accounts': handleIgAccounts,
  'latest-ig-post': handleLatestIgPost,
  'campaigns': handleCampaigns,
  'campaign-adsets': handleCampaignAdsets,
  'run-creative-refresh': handleRunCreativeRefresh,
  'cron-creative-refresh': handleCronCreativeRefresh,
  'resolve-ig-url': handleResolveIgUrl,
  'set-status': handleSetStatus,
  'set-budget': handleSetBudget,
  'campaign-breakdown': handleCampaignBreakdown,
  'manager-table': handleManagerTable,
  'launch-prereqs': handleLaunchPrereqs,
  'launch-campaign': handleLaunchCampaign,
};

export default async function handler(req, res) {
  const action = req.query.action;
  const h = actions[action];
  if (!h) return respondJSON(res, 404, { error: `Unknown meta action: ${action}` });
  return h(req, res);
}
