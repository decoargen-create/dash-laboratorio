// Helpers de Google OAuth 2.0 para el flujo del panel.
//
// Diseño: similar al de api/meta/_lib.js pero más liviano. El flow OAuth
// (connect → callback) se maneja con fetch directo. Para llamadas a Drive
// API se usa googleapis (google.drive() con google.auth.OAuth2 hookeado a
// auto-refresh).
//
// Scope default: 'drive' (full) para mantener paridad con el SA actual.
// Cuando agreguemos Drive Picker en la UI (Fase 6), pasamos a 'drive.file'
// (más restrictivo, no requiere Verification de Google hasta 100 users).
//
// State: HMAC-firmado igual que Meta (signGoogleState/verifyGoogleState).

import crypto from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'openid',
  'email',
  'profile',
];

// Margen para considerar el access_token "vencido por las dudas". 5 min
// alcanza para que termine cualquier llamada Drive sin que se venza a mitad.
export const REFRESH_MARGIN_SECONDS = 5 * 60;

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf-8');
}

/**
 * Firma HS256 del state OAuth (replica del patrón de api/meta/_lib.js).
 */
export function signGoogleState(payload, secret) {
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  return `${p}.${sig}`;
}

export function verifyGoogleState(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try { return JSON.parse(b64urlDecode(p)); } catch { return null; }
}

/**
 * Arma la URL de consent de Google.
 *   access_type=offline → habilita refresh_token.
 *   prompt=consent     → fuerza re-consent (necesario para que Google
 *                         devuelva refresh_token si el user ya autorizó antes).
 */
export function buildAuthUrl({ clientId, redirectUri, state, scopes, loginHint }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', (scopes && scopes.length ? scopes : GOOGLE_SCOPES).join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

/**
 * Intercambia el code por { access_token, refresh_token, expires_in, scope, id_token? }.
 */
export async function exchangeCodeForTokens({ clientId, clientSecret, redirectUri, code }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const msg = data.error_description || data.error || `HTTP ${r.status}`;
    throw new Error(`Google token exchange falló: ${msg}`);
  }
  return data;
}

/**
 * Refresh: pide un nuevo access_token usando el refresh_token guardado.
 * Devuelve { access_token, expires_in, scope, token_type } — Google
 * normalmente NO incluye refresh_token nuevo (mantenés el viejo).
 */
export async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const msg = data.error_description || data.error || `HTTP ${r.status}`;
    const err = new Error(`Google refresh falló: ${msg}`);
    err.code = data.error;
    err.status = r.status;
    throw err;
  }
  return data;
}

/**
 * Revoca un access o refresh token (lo invalida en Google's side).
 * Si falla, no es crítico — el record de KV se borra igual.
 */
export async function revokeToken(token) {
  if (!token) return;
  try {
    const body = new URLSearchParams({ token });
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    console.warn('[google/revoke] falló', err.message);
  }
}

/**
 * Obtiene { id, email, name, picture } del user.
 */
export async function fetchUserInfo(accessToken) {
  const r = await fetch(USERINFO_URL, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.error?.message || `HTTP ${r.status}`);
  }
  return data;
}

/**
 * Decide si un token guardado necesita refresh (vencido o cerca de vencer).
 *
 * @param {{ expiresAt?: number }} token - el formato que guardamos en KV
 * @returns {boolean}
 */
export function tokenNeedsRefresh(token) {
  if (!token) return true;
  if (!token.expiresAt) return true; // safety: no sabemos cuándo vence → asumir sí
  const now = Math.floor(Date.now() / 1000);
  return now + REFRESH_MARGIN_SECONDS >= token.expiresAt;
}
