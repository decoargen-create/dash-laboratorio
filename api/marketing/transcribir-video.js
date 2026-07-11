// Módulo "Guiones IA" — paso 1: transcripción de un video subido por el user.
//
// El user sube el video de un ad de la competencia (validado, ya pautado)
// directo al bucket 'creativos' desde el browser (path
// `<user_id>/transcripcion/<id>.<ext>` — mismo bucket privado que la galería,
// mismo prefijo de user así las RLS policies existentes aplican). Acá:
//   1. Verificamos auth y que el storagePath pertenezca al user.
//   2. Firmamos una URL del bucket y bajamos el video.
//   3. Whisper (whisper-1, $0.006/min) con idioma AUTO-DETECTADO — los ads de
//      competencia suelen venir en inglés/portugués; forzar 'es' (como hace
//      transcribe-ad.js con ads locales) rompería la transcripción.
//
// POST /api/marketing/transcribir-video
// Body: { storagePath }
// Response: { transcript, idioma, durationSec, costUSD }
//
// La adaptación a guion rioplatense es un endpoint aparte
// (adaptar-guion-video.js) para poder re-adaptar sin re-transcribir.

import { whisperCost } from './_costs.js';
import { getUserIdFromAuth, createSignedUrlsForCreativos } from './_supabase-server.js';

const WHISPER_MAX_MB = 24; // Whisper acepta 25MB; 24 como buffer
const VIDEO_TIMEOUT_MS = 90000;
const WHISPER_TIMEOUT_MS = 150000;

export const maxDuration = 240;

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'OPENAI_API_KEY no configurada' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  const { storagePath } = await readBody(req);
  if (!storagePath || typeof storagePath !== 'string') {
    return respondJSON(res, 400, { error: 'Falta storagePath' });
  }
  // Seguridad: solo archivos del propio user (el path arranca con su user_id).
  if (!storagePath.startsWith(`${userId}/`)) {
    return respondJSON(res, 403, { error: 'storagePath no pertenece a tu cuenta' });
  }

  // Signed URL del bucket privado.
  const signedMap = await createSignedUrlsForCreativos([storagePath], 600);
  const videoUrl = signedMap.get(storagePath);
  if (!videoUrl) {
    return respondJSON(res, 404, { error: 'No pude firmar la URL del video — ¿terminó de subir?' });
  }

  // Bajar el video.
  const videoCtl = new AbortController();
  const videoTimer = setTimeout(() => videoCtl.abort(), VIDEO_TIMEOUT_MS);
  let videoBuf;
  try {
    const videoRes = await fetch(videoUrl, { signal: videoCtl.signal });
    if (!videoRes.ok) {
      clearTimeout(videoTimer);
      return respondJSON(res, 502, { error: `HTTP ${videoRes.status} bajando el video del bucket` });
    }
    videoBuf = await videoRes.arrayBuffer();
  } catch (err) {
    clearTimeout(videoTimer);
    if (err.name === 'AbortError') {
      return respondJSON(res, 504, { error: `Timeout bajando el video (${VIDEO_TIMEOUT_MS / 1000}s)` });
    }
    return respondJSON(res, 502, { error: `Error bajando video: ${err.message}` });
  }
  clearTimeout(videoTimer);

  if (videoBuf.byteLength > WHISPER_MAX_MB * 1024 * 1024) {
    return respondJSON(res, 413, {
      error: `El video pesa ${(videoBuf.byteLength / 1024 / 1024).toFixed(1)}MB — Whisper acepta hasta ${WHISPER_MAX_MB}MB. Comprimilo o recortalo (un reel de 15-60s comprimido entra sobrado).`,
    });
  }

  // Whisper — SIN forzar idioma (auto-detect) + verbose_json para obtener
  // el idioma detectado y la duración.
  const ext = (storagePath.split('.').pop() || 'mp4').toLowerCase();
  const mime = ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
  const form = new FormData();
  form.append('file', new Blob([videoBuf], { type: mime }), `video.${ext}`);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

  const whisperCtl = new AbortController();
  const whisperTimer = setTimeout(() => whisperCtl.abort(), WHISPER_TIMEOUT_MS);
  let whisperRes;
  try {
    whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
      signal: whisperCtl.signal,
    });
  } catch (err) {
    clearTimeout(whisperTimer);
    if (err.name === 'AbortError') {
      return respondJSON(res, 504, { error: `Whisper timeout (${WHISPER_TIMEOUT_MS / 1000}s)` });
    }
    return respondJSON(res, 502, { error: `Whisper error: ${err.message}` });
  }
  clearTimeout(whisperTimer);

  if (!whisperRes.ok) {
    const text = await whisperRes.text();
    return respondJSON(res, 502, { error: `Whisper ${whisperRes.status}: ${text.slice(0, 200)}` });
  }

  const data = await whisperRes.json();
  const durationSec = data.duration || 0;
  const costUSD = durationSec > 0 ? whisperCost(durationSec) : 0;
  return respondJSON(res, 200, {
    transcript: data.text || '',
    idioma: data.language || 'desconocido',
    durationSec,
    costUSD: Math.round(costUSD * 10000) / 10000,
    cost: { openai: costUSD },
  });
}
