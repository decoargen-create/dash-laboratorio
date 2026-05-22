// QA visual del creativo estático generado.
//
// POST /api/marketing/qa-creative
// Body: { imageBase64, mimeType?, hook?, textoEnImagen? }
//
// Manda la imagen generada (gpt-image-1) a Claude Vision para que evalúe
// si está lista para producción: texto legible, hook que frena el scroll,
// jerarquía visual, sin errores de render. gpt-image-1 a veces saca texto
// deforme/cortado — este QA lo detecta antes de que el creativo se use.

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Sos un director de arte senior de performance marketing, especializado en creativos para Meta Ads (Facebook/Instagram) de e-commerce. Tu trabajo: revisar un creativo estático YA GENERADO y decidir si está listo para producción o hay que regenerarlo.

Evaluás contra estos criterios:
- LEGIBILIDAD DEL TEXTO: ¿el texto se lee bien? ¿hay letras deformes, cortadas, superpuestas, con typos o caracteres raros? (los generadores de imagen fallan seguido acá — es lo más importante a revisar).
- SAFE ZONES DE META: el creativo es 1:1 (feed) o 9:16 (stories/reels). En stories/reels, Meta tapa con su propia UI el ~10% superior y el ~20% inferior — NADA crítico (hook, CTA, sello, logo) puede caer ahí o queda oculto. En feed, los botones de la app comen las esquinas. Si hay texto o el CTA pegados a un borde donde Meta los va a tapar, es un problema serio.
- DENSIDAD DE TEXTO: Meta penaliza el alcance de las imágenes saturadas de texto. El hook tiene que DOMINAR; si la pieza parece un volante con párrafos, está mal. Mucho texto chico = bajón de performance. Marcá si hay sobrecarga.
- CTA: ¿hay un call-to-action claro, legible, con contraste suficiente y en una zona visible (no en una safe zone tapada)? Un creativo sin CTA visible o con CTA ilegible NO está listo.
- HOOK / PATTERN INTERRUPT: ¿el mensaje principal se entiende en 1 segundo? ¿frena el scroll?
- JERARQUÍA VISUAL: ¿hay un foco claro? ¿el texto importante resalta sobre el secundario?
- COMPOSICIÓN: ¿está equilibrado? ¿el producto/escena se ve profesional, no amateur ni "con olor a IA" (piel plástica, manos raras, iluminación irreal, simetría artificial)?
- COHERENCIA: ¿los colores y el estilo se ven de una marca real?

Sé EXIGENTE y honesto. Un creativo con texto cortado/deforme, con elementos críticos en una safe zone tapada, saturado de texto, o sin CTA legible NO está aprobado, aunque la imagen sea linda. Preferí mandar a regenerar antes que dejar pasar algo mediocre. Cada problema concreto va en \`problemas\`.

Devolvés tu evaluación llamando a la tool \`submit_qa\`. En español rioplatense, conciso y accionable.`;

const SUBMIT_QA_TOOL = {
  name: 'submit_qa',
  description: 'Envía la evaluación de QA del creativo.',
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 1, maximum: 10, description: 'Puntaje global de calidad del creativo, 1-10.' },
      veredicto: {
        type: 'string',
        enum: ['aprobado', 'revisar', 'regenerar'],
        description: 'aprobado = listo para usar. revisar = usable con retoques manuales. regenerar = tiene fallas serias (texto roto, etc), conviene generarlo de nuevo.',
      },
      textoLegible: { type: 'boolean', description: 'true si todo el texto de la imagen se lee bien y sin errores de render.' },
      problemas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista de problemas concretos detectados. Vacío si no hay. Cada uno ≤120 chars.',
      },
      fortalezas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lo que el creativo hace bien. 1-3 items, ≤120 chars.',
      },
      sugerencia: {
        type: 'string',
        description: 'Una recomendación accionable principal (qué cambiar / cómo mejorarlo). ≤200 chars.',
      },
    },
    required: ['score', 'veredicto', 'textoLegible', 'problemas', 'fortalezas', 'sugerencia'],
  },
};

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const body = await readBody(req);
  const imageBase64 = body?.imageBase64;
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return respondJSON(res, 400, { error: 'Falta imageBase64 en el body' });
  }
  const mimeType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(body?.mimeType)
    ? body.mimeType : 'image/png';

  const contexto = [];
  if (body?.hook) contexto.push(`Hook que el creativo debería comunicar: "${String(body.hook).slice(0, 300)}"`);
  if (body?.textoEnImagen) contexto.push(`Texto que se esperaba renderizar:\n${String(body.textoEnImagen).slice(0, 800)}`);

  const client = new Anthropic({ apiKey });

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [SUBMIT_QA_TOOL],
      tool_choice: { type: 'tool', name: 'submit_qa' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `Revisá este creativo estático para Meta Ads.${contexto.length ? '\n\n' + contexto.join('\n\n') : ''}\n\nDevolvé tu QA con la tool submit_qa.`,
          },
        ],
      }],
    });

    const toolUse = (resp.content || []).find(c => c.type === 'tool_use');
    if (!toolUse || !toolUse.input) {
      return respondJSON(res, 502, { error: 'Claude no devolvió una evaluación válida' });
    }
    const qa = toolUse.input;

    return respondJSON(res, 200, {
      qa: {
        score: Math.max(1, Math.min(10, Number(qa.score) || 5)),
        veredicto: ['aprobado', 'revisar', 'regenerar'].includes(qa.veredicto) ? qa.veredicto : 'revisar',
        textoLegible: !!qa.textoLegible,
        problemas: Array.isArray(qa.problemas) ? qa.problemas.slice(0, 8).map(p => String(p).slice(0, 200)) : [],
        fortalezas: Array.isArray(qa.fortalezas) ? qa.fortalezas.slice(0, 5).map(p => String(p).slice(0, 200)) : [],
        sugerencia: String(qa.sugerencia || '').slice(0, 300),
      },
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost: { anthropic: anthropicCost(resp.usage, MODEL) },
    });
  } catch (err) {
    console.error('qa-creative error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error evaluando el creativo' });
  }
}
