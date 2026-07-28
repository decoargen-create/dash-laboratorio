// Relay de chunks: browser → Vercel → Google Drive (resumable session).
//
// Existe como PLAN B de la subida directa browser→Google: si el PUT directo
// falla (CORS u otro bloqueo del navegador), el front parte el video en
// chunks (< 4MB, bajo el límite de body de Vercel de 4.5MB) y los manda acá;
// nosotros se los reenviamos a Google con Content-Range. Server→Google no
// tiene CORS, así que este camino funciona siempre.
//
// Protocolo de Google: cada chunk PUT con "Content-Range: bytes a-b/total".
// Respuesta 308 = chunk recibido, mandá el siguiente. 200/201 = archivo
// completo (el body trae el JSON del archivo).

import { getUserIdFromAuth } from '../marketing/_supabase-server.js';

function respondJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// Body crudo del request. @vercel/node puede haberlo parseado ya (Buffer para
// application/octet-stream); si no, leemos el stream a mano.
async function readRawBody(req, limit = 4_500_000) {
  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  }
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) { reject(new Error('chunk demasiado grande')); try { req.destroy(); } catch {} return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  const sessionUri = req.headers['x-session-uri'];
  const contentRange = req.headers['x-content-range'];
  const contentType = req.headers['x-upload-content-type'] || 'application/octet-stream';

  // Solo relayamos a sesiones de subida de Google (la sessionUri ya viene
  // pre-autorizada por nuestra service account vía drive-session).
  // DRIVE_CHUNK_TEST_PREFIX permite apuntar a un mock en los tests locales.
  const esGoogle = sessionUri && /^https:\/\/[a-z0-9.-]*googleapis\.com\//i.test(sessionUri);
  const esTest = process.env.DRIVE_CHUNK_TEST_PREFIX && sessionUri && sessionUri.startsWith(process.env.DRIVE_CHUNK_TEST_PREFIX);
  if (!esGoogle && !esTest) {
    return respondJSON(res, 400, { error: 'x-session-uri inválida' });
  }
  if (!contentRange || !/^bytes \d+-\d+\/\d+$/.test(contentRange)) {
    return respondJSON(res, 400, { error: 'x-content-range inválido (esperado "bytes a-b/total")' });
  }

  let body;
  try { body = await readRawBody(req); } catch (e) { return respondJSON(res, 413, { error: e.message }); }
  if (!body || body.length === 0) return respondJSON(res, 400, { error: 'chunk vacío' });

  try {
    const up = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Range': contentRange, 'Content-Type': contentType },
      body,
    });
    const text = await up.text().catch(() => '');
    const done = up.status === 200 || up.status === 201;
    let file = null;
    if (done) { try { file = JSON.parse(text || '{}'); } catch { file = {}; } }
    return respondJSON(res, 200, {
      status: up.status,
      done,
      file,
      range: up.headers.get('range') || null,
      error: up.status >= 400 ? text.slice(0, 300) : null,
    });
  } catch (e) {
    return respondJSON(res, 502, { error: `relay: ${String(e?.message || e).slice(0, 300)}` });
  }
}
