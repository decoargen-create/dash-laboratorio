// Helpers compartidos entre los endpoints de /api/meta/*.
//
// Diseño del flow OAuth:
//   1. /api/meta/connect redirige a la consent screen de Meta con un `state`
//      firmado (CSRF-proof). state incluye { userId, nonce, ts }.
//   2. Meta redirige de vuelta a /api/meta/callback con code + state.
//   3. callback verifica la firma del state, intercambia code → short-lived
//      token, short-lived → long-lived (~60d), y lo guarda en cookie HttpOnly
//      firmada.
//   4. Endpoints posteriores (/api/meta/accounts, /campaigns, etc.) leen la
//      cookie, validan firma, y usan el access_token para llamar Graph API.
//
// Requiere las env vars:
//   META_APP_ID         — ID de la Meta Developer app
//   META_APP_SECRET     — secret de la Meta Developer app
//   AUTH_SECRET         — se reusa del auth principal para firmar cookies/state
//
// Cookie: viora-meta-session. HttpOnly, Secure en prod, SameSite=Lax.
// Payload: { accessToken, userId?, expiresAt, iat } firmado con HS256.

import crypto from 'node:crypto';

export const META_API_VERSION = 'v21.0';
export const META_COOKIE_NAME = 'viora-meta-session';
export const META_COOKIE_MAX_AGE = 60 * 60 * 24 * 55; // 55 días (el long-lived dura ~60)

// Scopes que pedimos en el OAuth. Si cambiás acá también hay que sincronizar
// en la Meta Developer app (pero los scopes se piden en la URL del OAuth, no
// están hardcodeados en el dashboard de Meta — salvo los que requieren review).
//
// Para la automatización de renovación de creativos leemos el feed de IG
// Business y `like_count` de posts vía Page Access Token (hereda permisos
// de la Page sin necesitar el scope `instagram_basic`). Ese scope requería
// agregar el producto "Instagram" a la app Meta y habilitarlo en la consent
// screen, y Meta rechaza el OAuth con "Invalid Scopes" si no está aprobado.
// `pages_show_list` + `pages_read_engagement` alcanzan.
export const META_SCOPES = [
  'ads_read',
  'ads_management',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

// Firma HS256 simplificada (como JWT pero sin header). Payload JSON → b64url.
// Firma sobre `payload_b64`. Retorna `{payload}.{sig}`.
export function signState(payload, secret) {
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  return `${p}.${sig}`;
}

export function verifyState(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  // Comparación constant-time.
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try { return JSON.parse(b64urlDecode(p)); } catch { return null; }
}

export function setMetaCookie(res, value, maxAgeSeconds = META_COOKIE_MAX_AGE) {
  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const parts = [
    `${META_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearMetaCookie(res) {
  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const parts = [
    `${META_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function readMetaCookie(req) {
  const raw = req.headers?.cookie || '';
  const match = raw.split(';').map(s => s.trim()).find(s => s.startsWith(`${META_COOKIE_NAME}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.substring(META_COOKIE_NAME.length + 1));
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return verifyState(value, secret);
}

// URL absoluta del servicio (para armar el redirect_uri del OAuth).
export function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

export function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.end(JSON.stringify(payload));
}

// Wrapper para llamar a Graph API con el access_token de la cookie.
export async function graphGet(path, accessToken, params = {}) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${path.replace(/^\//, '')}`);
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

// POST contra Graph API. Meta acepta tanto JSON como form-url-encoded;
// usamos form-url-encoded porque algunos endpoints de Marketing API
// (p.ej. /{adset-id}/copies) son explícitos en pedirlo así.
export async function graphPost(path, accessToken, body = {}) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${path.replace(/^\//, '')}`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  form.set('access_token', accessToken);
  const resp = await fetch(url, {
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
