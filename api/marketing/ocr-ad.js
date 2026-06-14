// OCR de un ad: extrae el texto VISIBLE en la imagen del ad (overlay,
// botones, claims) y lo devuelve. Se usa para que la lupa de búsqueda
// pueda matchear texto que está EN la imagen (no solo en el body / headline
// del ad).
//
// Modelo: Claude Haiku (más barato que Sonnet, suficiente para OCR).
// Costo: ~$0.0004 por imagen vs $0.003 con Sonnet.
//
// POST /api/marketing/ocr-ad
// Body: { imageUrl }  o  { ads: [{id, imageUrl}, ...] }   (batch)
// Response:
//   single: { ocrText, costUSD }
//   batch:  { results: [{id, ocrText, error}], costUSD }

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';
import { safeFetch } from './_security.js';

const MODEL = 'claude-haiku-4-5';
const PROMPT = `Sos Santi. Extraé EXACTAMENTE el texto visible en esta imagen de un ad de Meta. Devuelve SOLO el texto literal (claims, headlines, botones, precios, descuentos, etiquetas, watermarks, etc), preservando saltos de línea. Sin parafrasear, sin agregar comentarios. Si no hay texto visible, devolvé exactamente "(sin texto)".`;

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

async function fetchImageBase64(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const r = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VioraBot/1.0)' },
    }, { timeoutMs: 10000 });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    // Detectar mime simple — Claude acepta image/jpeg, image/png, image/gif, image/webp.
    const ct = r.headers.get('content-type') || 'image/jpeg';
    const mime = ct.split(';')[0].trim();
    const base64 = Buffer.from(buf).toString('base64');
    return { base64, mime };
  } catch (err) {
    return null;
  }
}

async function ocrOne(client, imageUrl) {
  const img = await fetchImageBase64(imageUrl);
  if (!img) {
    return { ocrText: null, error: 'no pude bajar la imagen', tokens: { input: 0, output: 0 } };
  }
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  const text = resp.content?.[0]?.type === 'text' ? resp.content[0].text.trim() : '';
  return {
    ocrText: text === '(sin texto)' ? '' : text,
    tokens: { input: resp.usage?.input_tokens || 0, output: resp.usage?.output_tokens || 0 },
  };
}

export const maxDuration = 180;

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const body = await readBody(req);
  const client = new Anthropic({ apiKey });

  // Single OCR.
  if (body.imageUrl && !body.ads) {
    try {
      const r = await ocrOne(client, body.imageUrl);
      // FIX audit #1: anthropicCost(usage, model) — usage es OBJETO con
      // input_tokens/output_tokens, no posicional. Antes pasábamos
      // (MODEL, in, out) y NaN se silenciaba a 0 — todo OCR costo $0.
      const costUSD = anthropicCost({ input_tokens: r.tokens.input, output_tokens: r.tokens.output }, MODEL);
      // FIX audit #2: si hubo error en fetchImageBase64, lo surface como 502.
      if (r.error) {
        return respondJSON(res, 502, { error: r.error });
      }
      return respondJSON(res, 200, {
        ocrText: r.ocrText,
        costUSD: Math.round(costUSD * 10000) / 10000,
        cost: { anthropic: costUSD },
      });
    } catch (err) {
      // FIX audit #3: si es rate-limit de Anthropic, devolvemos retry-after.
      if (err.status === 429 || /rate.?limit|too.?many/i.test(err.message || '')) {
        return respondJSON(res, 429, {
          error: 'Anthropic rate limit — reintentá en 20s',
          retryAfter: err.headers?.['retry-after'] || 20,
        });
      }
      return respondJSON(res, 502, { error: err.message || 'OCR falló' });
    }
  }

  // Batch OCR.
  if (Array.isArray(body.ads) && body.ads.length > 0) {
    // Cap defensivo a 50 imgs por request para no quemar timeout.
    const cap = body.ads.slice(0, 50);
    const results = [];
    let totalIn = 0;
    let totalOut = 0;
    // Concurrency=3 para acelerar sin saturar rate limits.
    const CONCURRENCY = 3;
    let idx = 0;
    async function worker() {
      while (idx < cap.length) {
        const i = idx++;
        const item = cap[i];
        let attempt = 0;
        while (attempt < 3) {
          try {
            const r = await ocrOne(client, item.imageUrl);
            totalIn += r.tokens.input;
            totalOut += r.tokens.output;
            results[i] = { id: item.id, ocrText: r.ocrText, error: r.error || null };
            break;
          } catch (err) {
            // Backoff exponencial en rate limit (audit #3).
            const isRateLimit = err.status === 429 || /rate.?limit|too.?many/i.test(err.message || '');
            if (isRateLimit && attempt < 2) {
              const retryAfter = Number(err.headers?.['retry-after']) || (2 ** attempt) * 5;
              await new Promise(r => setTimeout(r, retryAfter * 1000));
              attempt++;
              continue;
            }
            results[i] = { id: item.id, ocrText: null, error: `${err.status || ''} ${err.message?.slice(0, 180)}`.trim() };
            break;
          }
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const costUSD = anthropicCost({ input_tokens: totalIn, output_tokens: totalOut }, MODEL);
    return respondJSON(res, 200, {
      results,
      processed: results.filter(r => r.ocrText !== null && !r.error).length,
      errors: results.filter(r => r.error).length,
      costUSD: Math.round(costUSD * 10000) / 10000,
      cost: { anthropic: costUSD },
    });
  }

  return respondJSON(res, 400, { error: 'Mandá imageUrl (single) o ads:[{id, imageUrl}] (batch).' });
}
