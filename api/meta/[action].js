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
  readMetaCookie, getOrigin, respondJSON, graphGet,
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
function parseInsights(ins) {
  if (!ins) return null;
  const actions = ins.actions || [];
  const purchases = actions.find(a =>
    a.action_type === 'purchase' ||
    a.action_type === 'offsite_conversion.fb_pixel_purchase'
  );
  return {
    impressions: Number(ins.impressions || 0),
    clicks: Number(ins.clicks || 0),
    ctr: Number(ins.ctr || 0),
    spend: Number(ins.spend || 0),
    cpc: Number(ins.cpc || 0),
    cpm: Number(ins.cpm || 0),
    reach: Number(ins.reach || 0),
    frequency: Number(ins.frequency || 0),
    purchases: purchases ? Number(purchases.value || 0) : 0,
  };
}

// Calcula el estado de fatigue comparando las métricas de los últimos 7 días
// con los 7 días previos (days -14 a -7).
//
//   healthy   → todo OK, CTR estable o subiendo
//   warming   → CTR bajó algo pero spend sigue subiendo (normal al escalar)
//   fatiguing → CTR cayó > 20% respecto al período anterior
//   dying     → CTR cayó > 40% + freq > 4
//   new       → no hay datos suficientes de período previo
//
// Si frequency > 5 y CTR cayendo → ya está quemado en la audiencia.
function computeFatigue(recent, prev) {
  if (!recent || recent.impressions < 100) return { status: 'new', reason: 'Aún no hay datos suficientes' };
  if (!prev || prev.impressions < 100) return { status: 'new', reason: 'Sin período previo para comparar' };

  const ctrRecent = recent.ctr;
  const ctrPrev = prev.ctr;
  if (ctrPrev === 0) return { status: 'new', reason: 'CTR previo inválido' };

  const ctrChangePct = Math.round(((ctrRecent - ctrPrev) / ctrPrev) * 100);
  const freqOverload = recent.frequency > 4;

  let status = 'healthy';
  let reason = `CTR estable (${ctrChangePct >= 0 ? '+' : ''}${ctrChangePct}% vs 7d previos)`;

  if (ctrChangePct < -40 || (ctrChangePct < -20 && freqOverload)) {
    status = 'dying';
    reason = `CTR cayó ${Math.abs(ctrChangePct)}% · freq ${recent.frequency.toFixed(1)} — audiencia quemada`;
  } else if (ctrChangePct < -20) {
    status = 'fatiguing';
    reason = `CTR cayó ${Math.abs(ctrChangePct)}% vs 7d previos — fatiguing`;
  } else if (ctrChangePct < -5 && recent.spend > prev.spend * 1.1) {
    status = 'warming';
    reason = `CTR bajó ${Math.abs(ctrChangePct)}% pero spend subió — normal al escalar`;
  }

  return {
    status,
    reason,
    ctrRecent, ctrPrev, ctrChangePct,
    frequencyRecent: recent.frequency,
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

  // Rango previo: días -14 a -7 (los 7 días anteriores al "last_7d" de Meta).
  const now = new Date();
  const prevSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const prevUntil = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevRange = JSON.stringify({ since: ymd(prevSince), until: ymd(prevUntil) });

  try {
    // Un solo call a Graph API con dos expansiones de insights (distintos
    // date_preset vs time_range). Meta permite alias de expansiones con
    // `.as()`: as(recent) / as(previous).
    const data = await graphGet(`${accountId}/ads`, session.accessToken, {
      fields: [
        'id,name,status,effective_status,created_time,updated_time',
        `creative{id,name,title,body,thumbnail_url,image_url,video_id,object_story_spec,effective_object_story_id}`,
        `insights.date_preset(last_7d).as(recent){impressions,clicks,ctr,spend,cpc,cpm,actions,reach,frequency}`,
        `insights.time_range(${prevRange}).as(previous){impressions,clicks,ctr,spend,cpc,cpm,actions,reach,frequency}`,
      ].join(','),
      limit,
      effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
    });

    const ads = (data.data || []).map(ad => {
      const creative = ad.creative || {};
      const recent = parseInsights(ad.recent?.data?.[0]);
      const previous = parseInsights(ad.previous?.data?.[0]);
      const fatigue = computeFatigue(recent, previous);

      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        effectiveStatus: ad.effective_status,
        createdTime: ad.created_time,
        updatedTime: ad.updated_time,
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

// --- dispatcher ---

const actions = {
  connect: handleConnect,
  callback: handleCallback,
  disconnect: handleDisconnect,
  me: handleMe,
  'ad-accounts': handleAdAccounts,
  'ads-with-insights': handleAdsWithInsights,
};

export default async function handler(req, res) {
  const action = req.query.action;
  const h = actions[action];
  if (!h) return respondJSON(res, 404, { error: `Unknown meta action: ${action}` });
  return h(req, res);
}
