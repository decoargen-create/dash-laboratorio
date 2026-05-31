// Generación del creativo estático con gpt-image-2 (OpenAI).
// Modelo lanzado el 2026-04-21 — soporta texto multilingüe (incluido
// español) bien renderizado dentro de la imagen y razonamiento O-series.
//
// POST /api/marketing/generate-creative
// Body: { idea: { hook, titulo, promptGeneradorImagen, descripcionImagen,
//                  textoEnImagen, copyPostMeta, estiloVisual, formato }, quality? }

const MODEL = 'gpt-image-2';

// Costo estimado por imagen — gpt-image-2 cobra por tokens, pero para
// loguear en GastosStack usamos un promedio razonable según calidad.
const COST_ESTIMATE = { low: 0.03, medium: 0.07, high: 0.18 };

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
  const prompt = buildPrompt(idea);

  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, prompt, size, quality, n: 1 }),
    });
    const raw = await resp.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      return respondJSON(res, 502, {
        error: `OpenAI devolvió una respuesta no-JSON (HTTP ${resp.status}) — error transitorio del servicio. Reintentá.`,
      });
    }
    if (!resp.ok) {
      const msg = data?.error?.message || `HTTP ${resp.status}`;
      return respondJSON(res, resp.status === 429 ? 429 : 502, {
        error: `OpenAI rechazó la generación: ${msg}`,
      });
    }
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return respondJSON(res, 502, { error: 'OpenAI no devolvió imagen (b64_json ausente).' });

    return respondJSON(res, 200, {
      imageBase64: b64,
      mimeType: 'image/png',
      size,
      quality,
      formato: idea.formato || 'static',
      model: MODEL,
      generatedAt: new Date().toISOString(),
      usage: data?.usage || null,
      cost: { openai: COST_ESTIMATE[quality] ?? 0.07 },
    });
  } catch (err) {
    console.error('generate-creative (gpt-image-2) error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error generando el creativo' });
  }
}
