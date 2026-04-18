// Callback del OAuth con Meta: recibe code + state, verifica state, intercambia
// code → short-lived token → long-lived token, guarda en cookie firmada,
// redirige al `returnTo` (o /acceso).

import {
  META_API_VERSION, META_COOKIE_MAX_AGE,
  verifyState, signState, setMetaCookie, getOrigin, respondJSON,
} from './_lib.js';

async function exchangeCodeForToken(appId, appSecret, code, redirectUri) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', code);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error?.message || `HTTP ${resp.status}`);
  return data; // { access_token, token_type, expires_in }
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
  return data; // { access_token, token_type, expires_in? }
}

async function fetchMe(accessToken) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/me`);
  url.searchParams.set('fields', 'id,name');
  url.searchParams.set('access_token', accessToken);
  const resp = await fetch(url.toString());
  return await resp.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const authSecret = process.env.AUTH_SECRET;
  if (!appId || !appSecret) return respondJSON(res, 500, { error: 'META_APP_ID / META_APP_SECRET no configuradas' });
  if (!authSecret) return respondJSON(res, 500, { error: 'AUTH_SECRET no configurada' });

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const errorFromMeta = url.searchParams.get('error');

  if (errorFromMeta) {
    const desc = url.searchParams.get('error_description') || errorFromMeta;
    return respondJSON(res, 400, { error: `Meta rechazó el login: ${desc}` });
  }
  if (!code || !stateRaw) return respondJSON(res, 400, { error: 'Falta code o state' });

  const state = verifyState(stateRaw, authSecret);
  if (!state) return respondJSON(res, 403, { error: 'State inválido o adulterado' });
  // Rechazamos states viejos (>10 min) para mitigar replays.
  if (Date.now() - (state.ts || 0) > 10 * 60 * 1000) {
    return respondJSON(res, 403, { error: 'State expirado, reiniciá el login' });
  }

  const redirectUri = `${origin}/api/meta/callback`;

  let shortToken, longToken, me;
  try {
    const short = await exchangeCodeForToken(appId, appSecret, code, redirectUri);
    shortToken = short.access_token;
    const long = await exchangeForLongLived(appId, appSecret, shortToken);
    longToken = long.access_token;
    me = await fetchMe(longToken);
  } catch (err) {
    console.error('meta/callback exchange error:', err);
    return respondJSON(res, 502, { error: `Intercambio de token falló: ${err.message}` });
  }

  // Firmamos la cookie con el access_token + datos del usuario Meta.
  const cookiePayload = {
    accessToken: longToken,
    metaUserId: me?.id || null,
    metaUserName: me?.name || null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + META_COOKIE_MAX_AGE,
  };
  const signed = signState(cookiePayload, authSecret);
  setMetaCookie(res, signed);

  const returnTo = (state.returnTo || '/acceso').startsWith('/') ? state.returnTo : '/acceso';
  res.statusCode = 302;
  res.setHeader('Location', `${returnTo}?meta=connected`);
  res.end();
}
