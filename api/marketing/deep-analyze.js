// Análisis profundo de un ad ganador (Fase 2 del pipeline de Marketing).
//
// POST /api/marketing/deep-analyze
// Body: {
//   ad: {
//     id, body, headline, cta, ctaLink,
//     pageName, imageUrls, videoUrls,
//     daysRunning, platforms, isMultiplatform,
//     score, variantes,
//   },
//   transcribe?: boolean (default true)  // si hay video, transcribir con Whisper
// }
//
// Pipeline:
//   1. Si hay videoUrls[0] y transcribe=true → Whisper (OpenAI) → transcripción
//   2. Si hay imageUrls[0] → Claude Vision con URL directa (no re-download)
//   3. Claude Sonnet sintetiza body + headline + transcripción + visual en
//      insights estructurados (hooks, ángulo, triggers, audience, offers,
//      CTA, objections, copy patterns, visual, why_it_works)
//
// Response: {
//   adId, transcript, transcriptStatus,
//   analysis: { hooks, angle, triggers, audience, offers, cta, objections, copy_patterns, visual, why_it_works },
//   model, generatedAt
// }

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';
const WHISPER_MAX_MB = 25;

const SYSTEM_PROMPT = `Sos un analista senior de ads de competencia para DTC de cosméticos en Argentina. Tu output son insights accionables para replicar el éxito de los ganadores, no descripciones neutras ni genéricas.

Te paso info de un ad ganador (criterio: ≥17 días corriendo o ≥2 variantes). Extraé y devolvé en JSON con EXACTAMENTE estas claves:

- "hooks": array de strings. Los primeros 3 segundos del mensaje — lo primero que engancha al scroll. 2 a 4 hooks concretos.
- "angle": string corto. El ángulo emocional principal (ej: "autoridad científica", "transformación antes/después", "FOMO escasez", "social proof", "miedo al problema", "curiosidad").
- "triggers": array de strings. Disparadores emocionales, 3 a 5 ordenados por impacto.
- "audience": string. Perfil implícito del target (edad, género, pain points, lifestyle).
- "offers": array de strings. Ofertas/ganchos monetarios visibles (descuentos, bundles, bonos, garantías, cuotas).
- "cta": object { "texto": string, "ubicacion": string, "urgencia": string }. Análisis del call-to-action.
- "objections": array de strings. Objeciones del comprador que el ad aborda proactivamente.
- "copy_patterns": array de strings. Patrones reutilizables del copy (estructura, tono, palabras gatillo, fórmulas).
- "visual": string. Descripción del visual/mood si hay imagen o video. Qué hace poderosa la composición.
- "why_it_works": string. Por qué este ad lleva tantos días corriendo. 2 a 3 razones concretas.

IMPORTANTE: devolvé ÚNICAMENTE el JSON. Nada antes ni después. Sin comentarios, sin \`\`\`json\`\`\` wrappers.`;

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

// Transcribe un video de Meta CDN con Whisper. Los URLs de Meta CDN expiran
// ~24h después del scrape, así que esto conviene hacerlo ASAP.
async function transcribeVideo(videoUrl, openaiKey) {
  // HEAD check — evitamos bajar el video si es > límite de Whisper (25MB).
  let size = 0;
  try {
    const head = await fetch(videoUrl, { method: 'HEAD' });
    size = Number(head.headers.get('content-length') || 0);
  } catch {
    // Si HEAD falla seguimos con GET pero chequeamos en el fetch.
  }
  if (size > WHISPER_MAX_MB * 1024 * 1024) {
    return { skipped: true, reason: `Video ${(size / 1024 / 1024).toFixed(1)}MB > ${WHISPER_MAX_MB}MB (límite Whisper)` };
  }

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) {
    return { skipped: true, reason: `HTTP ${videoRes.status} bajando video (¿URL expirado?)` };
  }

  const videoBuf = await videoRes.arrayBuffer();
  if (videoBuf.byteLength > WHISPER_MAX_MB * 1024 * 1024) {
    return { skipped: true, reason: `Video ${(videoBuf.byteLength / 1024 / 1024).toFixed(1)}MB > ${WHISPER_MAX_MB}MB` };
  }

  const form = new FormData();
  form.append('file', new Blob([videoBuf], { type: 'video/mp4' }), 'ad.mp4');
  form.append('model', 'whisper-1');
  form.append('language', 'es');
  form.append('response_format', 'json');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}` },
    body: form,
  });

  if (!whisperRes.ok) {
    const text = await whisperRes.text();
    return { skipped: true, reason: `Whisper ${whisperRes.status}: ${text.slice(0, 200)}` };
  }

  const data = await whisperRes.json();
  return { text: data.text || '', duration: data.duration };
}

// Envía el ad (con image URL + transcripción si aplica) a Claude Sonnet y
// parsea el JSON estructurado de vuelta.
async function analyzeAd(ad, transcript, client) {
  const content = [];

  // Claude Vision — pasamos la URL de la imagen directo (no re-download).
  const firstImage = ad.imageUrls?.[0];
  if (firstImage) {
    content.push({
      type: 'image',
      source: { type: 'url', url: firstImage },
    });
  }

  const adContext = [
    'AD CONTEXT',
    '==========',
    `Página: ${ad.pageName || 'N/A'}`,
    `Días corriendo: ${ad.daysRunning || 0}`,
    `Plataformas: ${(ad.platforms || []).join(', ') || 'N/A'}`,
    `Multiplataforma: ${ad.isMultiplatform ? 'Sí' : 'No'}`,
    `Score: ${ad.score ?? 'N/A'} · Variantes detectadas: ${ad.variantes ?? 0}`,
    '',
    `Headline: ${ad.headline || '(sin headline)'}`,
    `CTA: ${ad.cta || '(sin CTA)'}`,
    `Link CTA: ${ad.ctaLink || 'N/A'}`,
    '',
    'Body del ad:',
    '"""',
    (ad.body || '(sin body)').slice(0, 3000),
    '"""',
    transcript ? `\nTranscripción del video (Whisper):\n"""\n${transcript.slice(0, 3000)}\n"""` : '',
  ].filter(Boolean).join('\n');

  content.push({ type: 'text', text: adContext });

  // Adaptive thinking: ayuda a sintetizar mejor los signals visuales + texto
  // en insights accionables. Streaming para evitar timeout con thinking.
  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });
  const resp = await stream.finalMessage();

  const textBlock = resp.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('Claude no devolvió texto');

  let jsonStr = textBlock.text.trim();
  // Por si el modelo igualmente devuelve ```json ... ``` wrappers:
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) jsonStr = match[1];

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`JSON inválido de Claude: ${err.message}. Raw: ${jsonStr.slice(0, 200)}...`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return respondJSON(res, 500, {
      error: 'ANTHROPIC_API_KEY no configurada',
      hint: 'Agregala en Vercel → Settings → Environment Variables.',
    });
  }

  const body = await readBody(req);
  const { ad, transcribe = true } = body || {};
  if (!ad || !ad.id) {
    return respondJSON(res, 400, { error: 'Falta ad.id en el body' });
  }
  if (!ad.body && !ad.headline && !(ad.imageUrls?.length) && !(ad.videoUrls?.length)) {
    return respondJSON(res, 400, { error: 'El ad no tiene contenido suficiente para analizar' });
  }

  const client = new Anthropic({ apiKey: anthropicKey });

  // Paso 1 — transcripción (si hay video y está habilitado)
  let transcript = null;
  let transcriptStatus = 'no_video';
  const videoUrl = ad.videoUrls?.[0];
  if (transcribe && videoUrl) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      transcriptStatus = 'no_openai_key';
    } else {
      try {
        const result = await transcribeVideo(videoUrl, openaiKey);
        if (result.text) {
          transcript = result.text;
          transcriptStatus = 'ok';
        } else {
          transcriptStatus = `skipped: ${result.reason}`;
        }
      } catch (err) {
        transcriptStatus = `error: ${err.message}`;
      }
    }
  }

  // Paso 2 — análisis estructurado con Claude Vision
  try {
    const analysis = await analyzeAd(ad, transcript, client);
    return respondJSON(res, 200, {
      adId: ad.id,
      transcript,
      transcriptStatus,
      analysis,
      model: MODEL,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('deep-analyze error:', err);
    return respondJSON(res, 502, {
      error: err.message || 'Error analizando ad',
      transcriptStatus,
    });
  }
}
