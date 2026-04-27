// Dispatcher único para /api/google/* (OAuth Drive del user).
//
// Rutas:
//   GET  /api/google/connect      → redirige a consent screen Google.
//                                   Query: ?viora_session=… (obligatorio)
//                                          ?returnTo=/ruta (opcional)
//   GET  /api/google/callback     → Google redirige acá tras consent.
//   POST /api/google/disconnect   → revoca + borra del KV.
//                                   Auth: Authorization: Bearer <session>
//   GET  /api/google/me           → ¿el user tiene Google conectado?
//   GET  /api/google/list-folders → lista subcarpetas. Query: ?parent=ROOT_ID
//                                   o ?parent=root para My Drive del user.
//
// Sigue el patrón del repo (cf. api/meta/[action].js): un solo serverless,
// dispatcher por action. La identidad del user viaja en `viora_session`
// (query param o Authorization header), validada con AUTH_SECRET.

import crypto from 'node:crypto';
import { google } from 'googleapis';
import {
  GOOGLE_SCOPES, buildAuthUrl, exchangeCodeForTokens,
  signGoogleState, verifyGoogleState, fetchUserInfo, revokeToken,
} from '../../lib/google/oauth.js';
import { getValidGoogleToken } from '../../lib/google/tokens.js';
import { saveGoogleToken, loadGoogleToken, deleteGoogleToken } from '../../lib/tokens/google.js';
import { validateSession, readBody } from '../../lib/auth/session.js';

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
function redirectWithError(res, origin, returnTo, reason) {
  const path = (returnTo || '/acceso').startsWith('/') ? returnTo : '/acceso';
  const url = new URL(path, origin);
  url.searchParams.set('google', 'error');
  url.searchParams.set('reason', String(reason).slice(0, 200));
  res.statusCode = 302;
  res.setHeader('Location', url.toString());
  res.end();
}

// Identidad del user a partir del request. Acepta:
//   - query ?viora_session=… (para handlers GET con redirect — connect/callback)
//   - header Authorization: Bearer <session> (para POST/GET con fetch)
function resolveUser(req, body, opts = {}) {
  const origin = getOrigin(req);
  const url = req.url?.includes('?') ? new URL(req.url, origin) : null;
  const fromQuery = url?.searchParams.get('viora_session');

  let synthReq = req;
  if (fromQuery && !req.headers?.authorization) {
    synthReq = { ...req, headers: { ...req.headers, authorization: `Bearer ${fromQuery}` } };
  }
  return validateSession(synthReq, body);
}

// ---------------- connect ----------------
function handleConnect(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const origin = getOrigin(req);
  const reqUrl = req.url?.includes('?') ? new URL(req.url, origin) : null;
  let returnTo = reqUrl?.searchParams.get('returnTo') || '/acceso';
  if (!returnTo.startsWith('/')) returnTo = '/acceso';

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const authSecret = process.env.AUTH_SECRET;
  if (!clientId) return redirectWithError(res, origin, returnTo, 'GOOGLE_OAUTH_CLIENT_ID no configurada');
  if (!authSecret) return redirectWithError(res, origin, returnTo, 'AUTH_SECRET no configurada');

  // Multi-tenant requiere identidad del user — sin viora_session no podemos
  // saber a quién pertenece el token que vamos a recibir.
  const sessionRes = resolveUser(req, null);
  if (!sessionRes.ok) return redirectWithError(res, origin, returnTo, `Login requerido (${sessionRes.reason})`);
  const vioraUserId = sessionRes.user.id;

  const redirectUri = `${origin}/api/google/callback`;
  const state = signGoogleState({
    nonce: crypto.randomBytes(16).toString('hex'),
    ts: Date.now(),
    returnTo,
    vioraUserId,
  }, authSecret);

  const authUrl = buildAuthUrl({
    clientId,
    redirectUri,
    state,
    loginHint: sessionRes.user.email || undefined,
  });

  res.statusCode = 302;
  res.setHeader('Location', authUrl);
  res.end();
}

// ---------------- callback ----------------
async function handleCallback(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const origin = getOrigin(req);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const authSecret = process.env.AUTH_SECRET;
  if (!clientId || !clientSecret) return redirectWithError(res, origin, '/acceso', 'Google OAuth client no configurado');
  if (!authSecret) return redirectWithError(res, origin, '/acceso', 'AUTH_SECRET no configurada');

  const url = new URL(req.url, origin);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  if (errParam) {
    const desc = url.searchParams.get('error_description') || errParam;
    return redirectWithError(res, origin, '/acceso', `Google rechazó el consent: ${desc}`);
  }
  if (!code || !stateRaw) return redirectWithError(res, origin, '/acceso', 'Callback incompleto');

  const state = verifyGoogleState(stateRaw, authSecret);
  if (!state) return redirectWithError(res, origin, '/acceso', 'State inválido o adulterado');
  if (Date.now() - (state.ts || 0) > 10 * 60 * 1000) {
    return redirectWithError(res, origin, state.returnTo || '/acceso', 'State expirado');
  }
  if (!state.vioraUserId) {
    return redirectWithError(res, origin, state.returnTo || '/acceso', 'State sin vioraUserId — reintentá conectar');
  }

  const redirectUri = `${origin}/api/google/callback`;
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ clientId, clientSecret, redirectUri, code });
  } catch (err) {
    return redirectWithError(res, origin, state.returnTo || '/acceso', err.message);
  }

  // tokens shape: { access_token, refresh_token?, expires_in, scope, token_type, id_token? }
  // refresh_token solo viene la primera vez (o cuando prompt=consent fuerza el reissue).
  if (!tokens.refresh_token) {
    // Si el user ya autorizó antes y prompt=consent NO forzó refresh_token,
    // no podemos correr cron (sin refresh, no puedo renovar el access).
    // Pedimos al user revoke + reconnect.
    return redirectWithError(
      res,
      origin,
      state.returnTo || '/acceso',
      'Google no devolvió refresh_token. Revocá el acceso desde myaccount.google.com/permissions y reconectá.',
    );
  }

  let userInfo = null;
  try {
    userInfo = await fetchUserInfo(tokens.access_token);
  } catch (err) {
    console.warn('[google/callback] fetchUserInfo falló (no crítico)', err.message);
  }

  try {
    await saveGoogleToken(state.vioraUserId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
      scopes: (tokens.scope || GOOGLE_SCOPES.join(' ')).split(' '),
    });
  } catch (err) {
    console.error('[google/callback] saveGoogleToken falló', err);
    return redirectWithError(res, origin, state.returnTo || '/acceso', `No pude guardar el token: ${err.message}`);
  }

  // Pasamos el email a la URL de retorno para que la UI muestre quién
  // quedó conectado.
  const returnTo = state.returnTo || '/acceso';
  const target = new URL(returnTo, origin);
  target.searchParams.set('google', 'connected');
  if (userInfo?.email) target.searchParams.set('email', userInfo.email);
  res.statusCode = 302;
  res.setHeader('Location', target.toString());
  res.end();
}

// ---------------- disconnect ----------------
async function handleDisconnect(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return respondJSON(res, 405, { error: 'Method not allowed' });
  }
  const body = req.method === 'POST' ? await readBody(req) : null;
  const sessionRes = resolveUser(req, body);
  if (!sessionRes.ok) return respondJSON(res, 401, { error: 'Unauthorized', reason: sessionRes.reason });
  const userId = sessionRes.user.id;

  const stored = await loadGoogleToken(userId);
  if (stored?.refreshToken) {
    // Revocar el refresh_token revoca toda la cadena de access_tokens también.
    await revokeToken(stored.refreshToken);
  } else if (stored?.accessToken) {
    await revokeToken(stored.accessToken);
  }
  await deleteGoogleToken(userId);
  return respondJSON(res, 200, { ok: true });
}

// ---------------- me ----------------
async function handleMe(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const sessionRes = resolveUser(req, null);
  if (!sessionRes.ok) return respondJSON(res, 401, { error: 'Unauthorized', reason: sessionRes.reason });
  const userId = sessionRes.user.id;

  const stored = await loadGoogleToken(userId);
  if (!stored) return respondJSON(res, 200, { connected: false });
  return respondJSON(res, 200, {
    connected: true,
    expiresAt: stored.expiresAt ? new Date(stored.expiresAt * 1000).toISOString() : null,
    scopes: stored.scopes || [],
  });
}

// ---------------- list-folders ----------------
// Lista subcarpetas del parent dado. Usado por la UI antes de tener Drive
// Picker para que el user elija el root folder. parent='root' = My Drive.
async function handleListFolders(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });
  const sessionRes = resolveUser(req, null);
  if (!sessionRes.ok) return respondJSON(res, 401, { error: 'Unauthorized', reason: sessionRes.reason });
  const userId = sessionRes.user.id;

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const parent = url.searchParams.get('parent') || 'root';

  const token = await getValidGoogleToken(userId);
  if (!token) {
    return respondJSON(res, 401, {
      error: 'Google no conectado o token expirado/revocado',
      hint: 'Reconectá Google desde el panel.',
    });
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    );
    auth.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
    });
    const drive = google.drive({ version: 'v3', auth });
    const r = await drive.files.list({
      q: `'${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 200,
      orderBy: 'name',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    return respondJSON(res, 200, { parent, folders: r.data.files || [] });
  } catch (err) {
    return respondJSON(res, err.code || 502, { error: err.message });
  }
}

// ---------------- dispatcher ----------------
const actions = {
  connect: handleConnect,
  callback: handleCallback,
  disconnect: handleDisconnect,
  me: handleMe,
  'list-folders': handleListFolders,
};

export default async function handler(req, res) {
  const action = req.query?.action;
  const h = actions[action];
  if (!h) return respondJSON(res, 404, { error: `unknown action: ${action}` });
  return h(req, res);
}
