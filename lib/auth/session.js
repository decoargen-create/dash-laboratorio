// Validación de la session JWT-like emitida por api/auth.js.
//
// Diseño actual: la session vive en localStorage del front y se manda en
// cada request del panel (api/auth.js usa { action: 'me', session } en body).
// Para los endpoints multi-tenant nuevos (automations, etc.) acepto la
// session en el header Authorization: Bearer <session>. Es más limpio que
// duplicar el patrón del body.
//
// La firma JWT-like (header.payload.sig en base64url, HS256) viene de
// api/auth.js — replico el verifyToken acá para no duplicar archivos pero
// referenciar el mismo AUTH_SECRET.

import crypto from 'node:crypto';

function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Valida la firma HS256 y la expiración del JWT.
 *
 * @param {string} token
 * @param {string} secret
 * @returns {object | null} payload si es válido, null si no
 */
function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(p).toString('utf-8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Lee y valida la session del request. Soporta:
 *   - Header `Authorization: Bearer <session>` (preferido para REST nuevo)
 *   - Body `{ session: '...' }` (compat con el patrón viejo de api/auth.js)
 *
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   user?: { id: string, username?: string, email?: string, role: string, name?: string }
 * }}
 */
export function validateSession(req, body) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { ok: false, reason: 'AUTH_SECRET no configurada' };

  let token = null;

  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (m) token = m[1].trim();
  else if (body?.session && typeof body.session === 'string') token = body.session.trim();

  if (!token) return { ok: false, reason: 'no-credentials' };

  const payload = verifyToken(token, secret);
  if (!payload) return { ok: false, reason: 'invalid-or-expired' };
  if (payload.purpose !== 'session') return { ok: false, reason: 'wrong-purpose' };

  // Identidad estable para keys KV: preferimos username; si no hay (login
  // por magic link), usamos email. Siempre lowercased y normalizado.
  const id = (payload.username || payload.email || '').toString().trim().toLowerCase();
  if (!id) return { ok: false, reason: 'no-identity' };

  return {
    ok: true,
    user: {
      id,
      username: payload.username,
      email: payload.email,
      role: payload.role || 'mentor',
      name: payload.name,
    },
  };
}

/**
 * Helper para parsear body JSON (sigue el patrón del repo).
 */
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}
