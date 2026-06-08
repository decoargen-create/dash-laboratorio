// Generación del creativo estático con gpt-image-2 (OpenAI).
// Modelo lanzado el 2026-04-21 — soporta texto multilingüe (incluido
// español) bien renderizado dentro de la imagen y razonamiento O-series.
//
// POST /api/marketing/generate-creative
// Body: { idea: { hook, titulo, promptGeneradorImagen, descripcionImagen,
//                  textoEnImagen, copyPostMeta, estiloVisual, formato }, quality? }
//
// Robustez (alineada con crear-creativo-referencial):
// - sanitizePromptForSafety con auto-detección de high-risk (wellness/íntimo)
// - retry agresivo automático tras safety reject
// - moderation: 'low' (el setting más permisivo permitido por OpenAI)
// - mensajes accionables para errors comunes (sin saldo, key inválida, etc.)

import {
  sanitizePromptForSafety,
  isHighRiskText,
  isSafetyError,
  friendlyOpenAIError,
} from './_safety.js';

const MODEL = 'gpt-image-2';

// Tabla size+quality-aware igual que crear-creativo-referencial (PR #122).
// Antes era flat 0.03/0.07/0.18 sin considerar size — subestimaba 3-4x.
const COST_ESTIMATE_BY_SIZE = {
  low:    { '1024x1024': 0.013, '1024x1536': 0.020, '1536x1024': 0.020, '2048x2048': 0.050 },
  medium: { '1024x1024': 0.046, '1024x1536': 0.068, '1536x1024': 0.068, '2048x2048': 0.175 },
  high:   { '1024x1024': 0.180, '1024x1536': 0.262, '1536x1024': 0.262, '2048x2048': 0.680 },
};
function estimateImageCost(quality, size) {
  return COST_ESTIMATE_BY_SIZE[quality]?.[size] ?? COST_ESTIMATE_BY_SIZE.medium['1024x1024'];
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

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sizeForFormato(formato) {
  if (formato === 'video') return '1024x1536';
  return '1024x1024';
}

// Prompt en formato denso — la dirección creativa + escena + texto a
// renderizar. Aprovechamos que gpt-image-2 renderiza texto multilingüe
// bien para meter el hook y el layout directo en la imagen (sin canvas).
function buildPrompt(idea) {
  const escena = (idea.promptGeneradorImagen || idea.descripcionImagen || idea.hook || idea.titulo || '').trim();
  const hook = (idea.hook || '').trim();
  const textoEnImagen = (idea.textoEnImagen || '').trim();
  const estilo = (idea.estiloVisual || '').trim();

  const parts = [];
  parts.push('Premium DTC creative for Meta Ads (Facebook/Instagram), scroll-stop design for the Argentine / LatAm market. Editorial composition, cinematic lighting with direction, real props with tangible materiality. Realistic premium product photography, NO AI plastic look, NO uncanny faces.');
  if (estilo) parts.push(`Visual style: ${estilo}.`);

  parts.push('');
  parts.push('SCENE:');
  parts.push(escena);

  if (hook || textoEnImagen) {
    parts.push('');
    parts.push('TEXT TO RENDER IN THE IMAGE — render in Spanish, exactly as written, perfectly legible, no typos, modern bold sans-serif typography integrated with the design:');
    if (hook) parts.push(`Main headline: "${hook.slice(0, 140)}"`);
    if (textoEnImagen && textoEnImagen !== hook) {
      parts.push(`Layout details:\n${textoEnImagen.slice(0, 600)}`);
    }
  }

  parts.push('');
  parts.push('NO watermarks, NO extra text outside the specified. High-contrast typography, clear visual hierarchy, single hero focus.');
  return parts.join('\n');
}

// Helper: pega a OpenAI con retry agresivo si safety filter rechaza.
// 2 intentos máximo (el primero con sanitización normal, el segundo con
// agresiva). Si llega start=true desde detector de high-risk, ambos van
// agresivos.
async function callOpenAIImage({ apiKey, rawPrompt, size, quality, startAggressive = false }) {
  let aggressive = startAggressive;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = sanitizePromptForSafety(rawPrompt, aggressive);
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, prompt, size, quality, n: 1, moderation: 'low' }),
    });
    const raw = await resp.text();
    let data;
    try { data = JSON.parse(raw); }
    catch {
      throw new Error(`OpenAI devolvió respuesta no-JSON (HTTP ${resp.status}). Reintentá en unos segundos.`);
    }
    if (resp.ok) {
      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI no devolvió imagen (b64_json ausente).');
      // Defensiva: detección de imagen vacía
      if (b64.length < 10000) {
        throw new Error('OpenAI devolvió imagen sospechosamente chica — probable safety silent. Probá otro ángulo.');
      }
      return { imageBase64: b64, usage: data?.usage || null, aggressiveUsed: aggressive };
    }
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const code = data?.error?.code || data?.error?.type || '';
    // Si fue safety reject y NO estábamos agresivo → retry agresivo
    if (isSafetyError(msg, code) && !aggressive) {
      aggressive = true;
      continue;
    }
    // Fallar con mensaje friendly
    lastErr = new Error(friendlyOpenAIError(msg, code, resp.status, MODEL));
    lastErr.code = code;
    lastErr.status = resp.status;
    throw lastErr;
  }
  throw lastErr || new Error('Generación falló después de los retries.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respondJSON(res, 500, {
      error: 'OPENAI_API_KEY no configurada en el servidor. Agregala en Vercel → Settings → Environment Variables.',
    });
  }

  const body = await readBody(req);
  const idea = body?.idea;
  if (!idea || !(idea.promptGeneradorImagen || idea.descripcionImagen || idea.hook || idea.titulo)) {
    return respondJSON(res, 400, { error: 'La idea no tiene contenido suficiente (falta hook/título/descripción).' });
  }
  const quality = ['low', 'medium', 'high'].includes(body?.quality) ? body.quality : 'medium';
  const size = sizeForFormato(idea.formato);
  const rawPrompt = buildPrompt(idea);

  // Auto-detección: si el texto de la idea tiene triggers wellness/íntimo,
  // arrancamos agresivo desde el primer call (ahorra 1 round-trip).
  const startAggressive = isHighRiskText(
    [idea.hook, idea.titulo, idea.descripcionImagen, idea.textoEnImagen, idea.copyPostMeta]
      .filter(Boolean).join(' ')
  );

  try {
    const result = await callOpenAIImage({ apiKey, rawPrompt, size, quality, startAggressive });
    return respondJSON(res, 200, {
      imageBase64: result.imageBase64,
      mimeType: 'image/png',
      size,
      quality,
      formato: idea.formato || 'static',
      model: MODEL,
      generatedAt: new Date().toISOString(),
      usage: result.usage,
      aggressiveSanitization: result.aggressiveUsed,
      cost: { openai: estimateImageCost(quality, size) },
    });
  } catch (err) {
    console.error('generate-creative error:', err.message);
    return respondJSON(res, 502, { error: err.message || 'Error generando el creativo' });
  }
}
