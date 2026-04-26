// Auth para el endpoint del Meta Ads Publisher.
//
// Acepta DOS formas:
//   1. Header `x-vercel-cron: 1` — lo inyecta Vercel cuando dispara la cron
//      definida en vercel.json. Es la fuente legítima de la ejecución
//      programada y NO se puede falsificar desde afuera (Vercel lo strippea
//      en requests externos).
//   2. Header `Authorization: Bearer <IG_REFRESH_CRON_SECRET>` — para disparo
//      manual de testing (curl). Solo válido si la env var está seteada.
//
// Cualquier otro request → no autorizado.

import crypto from 'node:crypto';

/**
 * @param {import('http').IncomingMessage} req
 * @returns {{ ok: boolean, source?: 'vercel-cron' | 'bearer', reason?: string }}
 */
export function checkAuth(req) {
  const headers = req.headers || {};

  // Vercel Cron header (lowercase keys en Node http).
  if (headers['x-vercel-cron'] === '1') {
    return { ok: true, source: 'vercel-cron' };
  }

  const authHeader = headers.authorization || headers.Authorization || '';
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: 'no-credentials' };

  const provided = match[1].trim();
  const expected = process.env.IG_REFRESH_CRON_SECRET || '';
  if (!expected) return { ok: false, reason: 'secret-not-configured' };

  // Comparación constant-time para evitar timing attacks.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'bad-token' };
  try {
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-token' };
  } catch {
    return { ok: false, reason: 'bad-token' };
  }
  return { ok: true, source: 'bearer' };
}
