// Dispatcher único para /api/auth/* (acciones nuevas, multi-tenant).
//
// NO toca el endpoint legacy /api/auth (api/auth.js) que maneja login,
// me, send, verify y create_invite. Este dispatcher agrega acciones
// nuevas relacionadas a borrar la cuenta y al callback de Meta.
//
// Rutas:
//   POST /api/auth/delete-account        → user borra su cuenta y datos.
//                                          Auth: Bearer session.
//   POST /api/auth/meta-data-deletion    → callback que Meta llama (signed_request).
//                                          NO usa session — autentica por HMAC del body.
//
// Sigue el patrón de api/meta/[action].js / api/google/[action].js para
// mantener bajo el count de functions del plan Hobby de Vercel.

import crypto from 'node:crypto';
import { validateSession, readBody } from '../../lib/auth/session.js';
import { purgeUserData } from '../../lib/auth/purge.js';
import { findVioraUserByMetaUserId } from '../../lib/tokens/meta.js';

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res) {
  return respondJSON(res, 405, { error: 'Method not allowed' });
}

// =====================================================================
// delete-account: el user pide borrar su cuenta y todos sus datos.
// =====================================================================
async function handleDeleteAccount(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const body = await readBody(req);
  const sessionRes = validateSession(req, body);
  if (!sessionRes.ok) {
    return respondJSON(res, 401, { error: 'Unauthorized', reason: sessionRes.reason });
  }

  const userId = sessionRes.user.id;
  try {
    const result = await purgeUserData(userId);
    return respondJSON(res, 200, { ok: true, userId, ...result });
  } catch (err) {
    console.error('[auth/delete-account] error', userId, err);
    return respondJSON(res, 500, { error: err.message || 'error borrando cuenta' });
  }
}

// =====================================================================
// meta-data-deletion: callback que Meta llama tras user pedido de borrado.
// Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
// =====================================================================
function b64urlDecode(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

/**
 * Parsea body application/x-www-form-urlencoded. NO usamos readBody (asume JSON).
 */
async function readFormBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  return Object.fromEntries(new URLSearchParams(raw || ''));
}

/**
 * Verifica HMAC-SHA256 del signed_request y devuelve el payload o null.
 */
function parseSignedRequest(signedRequest, appSecret) {
  if (!signedRequest || typeof signedRequest !== 'string') return null;
  const [sigB64, payloadB64] = signedRequest.split('.');
  if (!sigB64 || !payloadB64) return null;

  const expected = crypto.createHmac('sha256', appSecret).update(payloadB64).digest();
  const provided = b64urlDecode(sigB64);
  if (expected.length !== provided.length) return null;
  try {
    if (!crypto.timingSafeEqual(expected, provided)) return null;
  } catch { return null; }

  try {
    const json = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
    if (json.algorithm !== 'HMAC-SHA256') return null;
    return json;
  } catch {
    return null;
  }
}

async function handleMetaDataDeletion(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('[meta-data-deletion] META_APP_SECRET no configurada');
    return respondJSON(res, 500, { error: 'app_secret no configurada' });
  }

  let body;
  try {
    body = await readFormBody(req);
  } catch {
    return respondJSON(res, 400, { error: 'body unreadable' });
  }

  const parsed = parseSignedRequest(body.signed_request, appSecret);
  if (!parsed) {
    console.warn('[meta-data-deletion] signed_request inválido');
    return respondJSON(res, 400, { error: 'signed_request inválido' });
  }

  const metaUserId = String(parsed.user_id || '');
  if (!metaUserId) {
    return respondJSON(res, 400, { error: 'user_id ausente en signed_request' });
  }

  // Confirmation code: ID único reproducible por user + timestamp.
  const confirmationCode = crypto
    .createHash('sha256')
    .update(`${metaUserId}|${Date.now()}|${crypto.randomBytes(8).toString('hex')}`)
    .digest('hex')
    .slice(0, 24);

  // Mapear meta user → viora user. Si no hay mapping (user nunca conectó
  // o ya fue borrado), igualmente respondemos 200 con confirmation code.
  let vioraUserId = null;
  try {
    vioraUserId = await findVioraUserByMetaUserId(metaUserId);
  } catch (err) {
    console.error('[meta-data-deletion] reverse lookup falló', err);
  }

  if (vioraUserId) {
    try {
      const result = await purgeUserData(vioraUserId);
      console.log('[meta-data-deletion] purged', vioraUserId, JSON.stringify(result));
    } catch (err) {
      console.error('[meta-data-deletion] purge falló', vioraUserId, err);
      // Igual respondemos 200 a Meta con el code; investigamos en logs.
    }
  } else {
    console.log('[meta-data-deletion] sin mapping para metaUserId', metaUserId);
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'laboratorio-viora.vercel.app';
  const url = `${proto}://${host}/data-deletion-status?code=${confirmationCode}`;

  return respondJSON(res, 200, { url, confirmation_code: confirmationCode });
}

// ---------------- dispatcher ----------------
const actions = {
  'delete-account': handleDeleteAccount,
  'meta-data-deletion': handleMetaDataDeletion,
};

export default async function handler(req, res) {
  const action = req.query?.action;
  const h = actions[action];
  if (!h) return respondJSON(res, 404, { error: `unknown auth action: ${action}` });
  return h(req, res);
}
