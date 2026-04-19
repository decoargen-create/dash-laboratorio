// Matcher IA — dado el producto y una lista de ads de la cuenta publicitaria,
// identifica cuáles son DEL producto (no otros productos de la misma marca).
//
// POST /api/marketing/match-product-ads
// Body: {
//   producto: { nombre, descripcion?, landingUrl? },
//   ads: [ { id, name, creative: { title, body, ... }, insights: {...} }, ... ]
// }
//
// Output: {
//   matches: [ { adId, confidence: 'high'|'medium'|'low', reason }, ... ],
//   total, matched, model, generatedAt
// }

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Sos un analista de cuentas publicitarias. Tu trabajo: dado un producto puntual y una lista de ads activos de una cuenta publicitaria, identificar qué ads promueven ESE producto específico.

Reglas:
- Un ad matchea si promueve el producto en cuestión, NO si es de la misma marca pero otro producto.
- Si el nombre del producto aparece literal en title/body/name → confidence "high".
- Si hay overlap claro de keywords o contexto (ingredientes, beneficios, url de landing coincidente) → "medium".
- Si es ambiguo pero plausible → "low".
- Si no tiene nada que ver → NO lo incluyas.

Devolvé ÚNICAMENTE JSON en este shape:
{
  "matches": [
    { "adId": "string", "confidence": "high" | "medium" | "low", "reason": "por qué matchea, 1 oración" }
  ]
}

Sin texto antes ni después. Sin \`\`\`json wrappers. Si ningún ad matchea, devolvé matches: [].`;

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

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const body = await readBody(req);
  const { producto, ads } = body || {};
  if (!producto?.nombre) return respondJSON(res, 400, { error: 'Falta producto.nombre' });
  if (!Array.isArray(ads) || ads.length === 0) return respondJSON(res, 400, { error: 'Falta ads[] no vacío' });

  const client = new Anthropic({ apiKey: anthropicKey });

  // Empaquetamos ads de forma compacta para no quemar tokens — solo lo que
  // necesita el modelo para decidir si matchea.
  const adsLite = ads.slice(0, 100).map(ad => ({
    id: ad.id,
    name: ad.name || '',
    title: ad.creative?.title || '',
    body: String(ad.creative?.body || '').slice(0, 400),
  }));

  const prompt = [
    '## PRODUCTO',
    `Nombre: ${producto.nombre}`,
    producto.descripcion ? `Descripción: ${producto.descripcion}` : null,
    producto.landingUrl ? `Landing: ${producto.landingUrl}` : null,
    '',
    '## ADS DE LA CUENTA',
    JSON.stringify(adsLite, null, 2),
    '',
    'Devolvé el JSON con los matches.',
  ].filter(Boolean).join('\n');

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('Claude no devolvió texto');

    let jsonStr = textBlock.text.trim();
    const m = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) jsonStr = m[1];

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      throw new Error(`JSON inválido: ${err.message}. Raw: ${jsonStr.slice(0, 200)}`);
    }
    const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];

    // Sanitizamos + filtramos a los adIds que realmente existen.
    const validIds = new Set(ads.map(a => a.id));
    const clean = matches
      .filter(m => m?.adId && validIds.has(m.adId))
      .map(m => ({
        adId: m.adId,
        confidence: ['high', 'medium', 'low'].includes(m.confidence) ? m.confidence : 'medium',
        reason: String(m.reason || '').slice(0, 300),
      }));

    return respondJSON(res, 200, {
      matches: clean,
      total: ads.length,
      matched: clean.length,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost: { anthropic: anthropicCost(resp.usage, MODEL) },
    });
  } catch (err) {
    console.error('match-product-ads error:', err);
    return respondJSON(res, 502, { error: err.message || 'Error en el matcher' });
  }
}
