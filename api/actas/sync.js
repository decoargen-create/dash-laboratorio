// Sincroniza las transcripciones de Drive → actas generadas.
//
//   POST { session }   → desde el panel (requiere sesión admin). Genera pocas
//                        por corrida y devuelve todas las actas + `pending`.
//   GET                → desde el cron de Vercel. Si CRON_SECRET está seteada,
//                        exige el header Authorization: Bearer <CRON_SECRET>.
//                        Genera un batch más grande.

import crypto from 'node:crypto';
import { runSync } from './_lib.js';

// --- Verificación del session token (mismo esquema HS256 que api/auth.js) ---
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}
function verifySession(token, secret) {
  if (typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())
    .toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const a = Buffer.from(s); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(p).toString('utf-8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  let maxGenerate = 5;

  if (req.method === 'GET') {
    // Camino del cron.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${cronSecret}`) return respondJSON(res, 401, { error: 'No autorizado' });
    }
    maxGenerate = 4;
  } else if (req.method === 'POST') {
    // Camino del panel: exige sesión admin.
    const body = await readBody(req);
    const payload = verifySession(body?.session, process.env.AUTH_SECRET);
    if (!payload || payload.purpose !== 'session') {
      return respondJSON(res, 401, { error: 'Sesión inválida o expirada' });
    }
    if (payload.role !== 'admin') {
      return respondJSON(res, 403, { error: 'Solo el admin puede sincronizar actas' });
    }
    maxGenerate = 4;
  } else {
    return respondJSON(res, 405, { error: 'Method not allowed' });
  }

  try {
    const result = await runSync({ maxGenerate });
    if (!result.configured) {
      return respondJSON(res, 200, { configured: false, error: result.error, actas: [] });
    }
    return respondJSON(res, 200, result);
  } catch (err) {
    console.error('[actas/sync] error:', err?.message || err);
    return respondJSON(res, 500, { error: `Falló la sincronización: ${err?.message || err}` });
  }
}
