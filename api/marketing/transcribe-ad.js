// Transcripción de UN solo video de un ad (o batch). Usa Whisper de
// OpenAI. Se usa para que la lupa pueda matchear lo que se DICE en el video.
//
// Modelo: whisper-1 ($0.006 / minuto).
//
// POST /api/marketing/transcribe-ad
// Body: { videoUrl }  o  { ads: [{id, videoUrl}, ...] }   (batch)
// Response:
//   single: { transcript, durationSec, costUSD }
//   batch:  { results: [{id, transcript, durationSec, error}], costUSD }

import { whisperCost } from './_costs.js';

const WHISPER_MAX_MB = 24; // Whisper 25MB, tomamos 24 como buffer
const VIDEO_TIMEOUT_MS = 60000;
const WHISPER_TIMEOUT_MS = 120000;

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

async function transcribeOne(videoUrl, openaiKey) {
  // HEAD check para skipear videos pesados.
  let size = 0;
  try {
    const headCtl = new AbortController();
    const headTimer = setTimeout(() => headCtl.abort(), 10000);
    const head = await fetch(videoUrl, { method: 'HEAD', signal: headCtl.signal });
    clearTimeout(headTimer);
    size = Number(head.headers.get('content-length') || 0);
  } catch {}
  if (size > WHISPER_MAX_MB * 1024 * 1024) {
    return { transcript: null, error: `Video ${(size / 1024 / 1024).toFixed(1)}MB > ${WHISPER_MAX_MB}MB`, durationSec: 0 };
  }

  const videoCtl = new AbortController();
  const videoTimer = setTimeout(() => videoCtl.abort(), VIDEO_TIMEOUT_MS);
  let videoRes;
  try {
    videoRes = await fetch(videoUrl, { signal: videoCtl.signal });
  } catch (err) {
    clearTimeout(videoTimer);
    if (err.name === 'AbortError') {
      return { transcript: null, error: `Video timeout (${VIDEO_TIMEOUT_MS / 1000}s)`, durationSec: 0 };
    }
    throw err;
  }
  clearTimeout(videoTimer);
  if (!videoRes.ok) {
    return { transcript: null, error: `HTTP ${videoRes.status} bajando video`, durationSec: 0 };
  }
  const videoBuf = await videoRes.arrayBuffer();
  if (videoBuf.byteLength > WHISPER_MAX_MB * 1024 * 1024) {
    return { transcript: null, error: `Video ${(videoBuf.byteLength / 1024 / 1024).toFixed(1)}MB`, durationSec: 0 };
  }

  const form = new FormData();
  form.append('file', new Blob([videoBuf], { type: 'video/mp4' }), 'ad.mp4');
  form.append('model', 'whisper-1');
  form.append('language', 'es');
  form.append('response_format', 'verbose_json');

  const whisperCtl = new AbortController();
  const whisperTimer = setTimeout(() => whisperCtl.abort(), WHISPER_TIMEOUT_MS);
  let whisperRes;
  try {
    whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body: form,
      signal: whisperCtl.signal,
    });
  } catch (err) {
    clearTimeout(whisperTimer);
    if (err.name === 'AbortError') {
      return { transcript: null, error: `Whisper timeout (${WHISPER_TIMEOUT_MS / 1000}s)`, durationSec: 0 };
    }
    throw err;
  }
  clearTimeout(whisperTimer);

  if (!whisperRes.ok) {
    const text = await whisperRes.text();
    return { transcript: null, error: `Whisper ${whisperRes.status}: ${text.slice(0, 200)}`, durationSec: 0 };
  }

  const data = await whisperRes.json();
  return {
    transcript: data.text || '',
    durationSec: data.duration || 0,
  };
}

export const maxDuration = 240;

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'OPENAI_API_KEY no configurada' });

  const body = await readBody(req);

  // Single.
  if (body.videoUrl && !body.ads) {
    try {
      const r = await transcribeOne(body.videoUrl, apiKey);
      const costUSD = r.durationSec > 0 ? whisperCost(r.durationSec) : 0;
      return respondJSON(res, 200, {
        transcript: r.transcript,
        durationSec: r.durationSec,
        error: r.error || null,
        costUSD: Math.round(costUSD * 10000) / 10000,
        cost: { openai: costUSD },
      });
    } catch (err) {
      return respondJSON(res, 502, { error: err.message || 'Whisper falló' });
    }
  }

  // Batch.
  if (Array.isArray(body.ads) && body.ads.length > 0) {
    // Cap 20 videos — whisper es lento (5-30s c/u). Más de 20 excede 240s.
    const cap = body.ads.slice(0, 20);
    const results = [];
    let totalDur = 0;
    // Concurrency=2 — whisper API es 50 RPM pero los videos pesan; tranquilo.
    const CONCURRENCY = 2;
    let idx = 0;
    async function worker() {
      while (idx < cap.length) {
        const i = idx++;
        const item = cap[i];
        try {
          const r = await transcribeOne(item.videoUrl, apiKey);
          totalDur += r.durationSec || 0;
          results[i] = { id: item.id, transcript: r.transcript, durationSec: r.durationSec, error: r.error || null };
        } catch (err) {
          results[i] = { id: item.id, transcript: null, durationSec: 0, error: err.message?.slice(0, 200) };
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const costUSD = whisperCost(totalDur);
    return respondJSON(res, 200, {
      results,
      processed: results.filter(r => r.transcript && !r.error).length,
      errors: results.filter(r => r.error).length,
      totalDurationSec: Math.round(totalDur),
      costUSD: Math.round(costUSD * 10000) / 10000,
      cost: { openai: costUSD },
    });
  }

  return respondJSON(res, 400, { error: 'Mandá videoUrl (single) o ads:[{id, videoUrl}] (batch).' });
}
