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

// Devuelve los ads activos de una ad account con su creativo + insights básicos
// (7 días: impressions, clicks, CTR, spend, cpc, CPM).
// Usado para que el user seleccione cuáles son del producto que está analizando.
async function handleAdsWithInsights(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const session = readMetaCookie(req);
  if (!session?.accessToken) return respondJSON(res, 401, { error: 'Meta no conectado' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const accountId = url.searchParams.get('account_id');
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);
  const datePreset = url.searchParams.get('date_preset') || 'last_7d';

  if (!accountId) return respondJSON(res, 400, { error: 'Falta account_id (con prefijo act_)' });

  try {
    // Traemos ads activos con creativo + insights inline.
    // La API de Meta permite expandir creative{...} e insights{...} en un solo call.
    const data = await graphGet(`${accountId}/ads`, session.accessToken, {
      fields: [
        'id,name,status,effective_status,created_time,updated_time',
        `creative{id,name,title,body,thumbnail_url,image_url,video_id,object_story_spec,effective_object_story_id}`,
        `insights.date_preset(${datePreset}){impressions,clicks,ctr,spend,cpc,cpm,actions,cost_per_action_type,reach,frequency}`,
      ].join(','),
      limit,
      effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
    });

    const ads = (data.data || []).map(ad => {
      const creative = ad.creative || {};
      const insightsArr = ad.insights?.data || [];
      const ins = insightsArr[0] || null;
      const actions = ins?.actions || [];
      const purchases = actions.find(a => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
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
        insights: ins ? {
          impressions: Number(ins.impressions || 0),
          clicks: Number(ins.clicks || 0),
          ctr: Number(ins.ctr || 0),
          spend: Number(ins.spend || 0),
          cpc: Number(ins.cpc || 0),
          cpm: Number(ins.cpm || 0),
          reach: Number(ins.reach || 0),
          frequency: Number(ins.frequency || 0),
          purchases: purchases ? Number(purchases.value || 0) : 0,
        } : null,
      };
    });

    return respondJSON(res, 200, {
      accountId,
      datePreset,
      total: ads.length,
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
