// Generador de copy para Meta Ads. Stream SSE de N variaciones de copy
// (headline + body + cta) basadas en:
//   - El producto: nombre, descripción, formato, ofertasReales
//   - Sus winners marcados (que dan la pista de qué ángulo rinde)
//   - Avatar + research (qué pain points/lenguaje habla a tu audiencia)
//
// Por qué este endpoint y no el generador de ideas:
//   El generador de ideas devuelve briefs visuales completos. Esto es más
//   chico y especializado: solo COPY listo para pegar en Meta Ads (primary
//   text + headline + descripción). Más rápido, más barato, menos tokens.

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';
export const maxDuration = 120;

function sseWrite(res, data) {
  try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
}

function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

const SUBMIT_COPIES_TOOL = {
  name: 'submit_copies',
  description: 'Devolvé el array de copies generados.',
  input_schema: {
    type: 'object',
    properties: {
      copies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            angulo: { type: 'string', description: 'Tag corto del ángulo (ej "pain-noche", "social-proof", "transformacion")' },
            primaryText: { type: 'string', description: 'Texto principal del ad (50-150 palabras). Voseo. Sin emojis salvo 1-2 si encajan.' },
            headline: { type: 'string', description: 'Headline corto (max 40 chars). Va abajo del visual.' },
            description: { type: 'string', description: 'Descripción opcional bajo el headline (max 30 chars).' },
            cta: { type: 'string', enum: ['Comprar', 'Saber más', 'Reservar', 'Suscribirse', 'Probar gratis', 'Descargar'] },
            por_que_rinde: { type: 'string', description: 'En 1 línea: qué pivote estratégico usa este copy y por qué.' },
          },
          required: ['angulo', 'primaryText', 'headline', 'cta', 'por_que_rinde'],
        },
      },
    },
    required: ['copies'],
  },
};

function buildContext({ producto, winners, n }) {
  const parts = [];
  parts.push(`# PRODUCTO`);
  parts.push(`Nombre: ${producto?.nombre || 'N/A'}`);
  if (producto?.formato) parts.push(`Formato físico: ${producto.formato}`);
  if (producto?.descripcion) parts.push(`Descripción: ${producto.descripcion.slice(0, 600)}`);
  const ofertas = (producto?.ofertasReales || producto?.docs?.offerBrief || '').toString().trim();
  if (ofertas) {
    parts.push('');
    parts.push(`**OFERTAS / PRECIOS REALES** (usá ÚNICAMENTE estas — no inventes promos ni precios):`);
    parts.push(ofertas.slice(0, 800));
  } else {
    parts.push('**SIN OFERTAS DECLARADAS** — no inventes descuentos, promos ni claims regulados.');
  }
  const avatar = (producto?.avatar || producto?.docs?.avatar || '').toString().trim();
  const research = (producto?.research || producto?.docs?.research || '').toString().trim();
  const ctx = [
    avatar ? `### AVATAR\n${avatar}` : '',
    research ? `### RESEARCH\n${research}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 3000);
  if (ctx) {
    parts.push('');
    parts.push(`# AVATAR + RESEARCH (usá esto para HABLAR como ellos)`);
    parts.push(ctx);
  }
  // Winners — pistas concretas de qué rinde para este producto.
  if (Array.isArray(winners) && winners.length > 0) {
    parts.push('');
    parts.push(`# WINNERS DE ESTE PRODUCTO (qué pivotes ya están rindiendo)`);
    for (const w of winners.slice(0, 8)) {
      const m = w.winnerMetrics || {};
      const parts2 = [];
      if (w.sourceHeadline) parts2.push(`"${w.sourceHeadline.slice(0, 200)}"`);
      if (m.que_funciono?.length) parts2.push(`Pivote: ${m.que_funciono.join(', ')}`);
      if (m.roas) parts2.push(`ROAS ${m.roas}`);
      if (m.ctr) parts2.push(`CTR ${m.ctr}%`);
      if (parts2.length) parts.push(`- ${parts2.join(' · ')}`);
    }
  }
  parts.push('');
  parts.push(`# TAREA`);
  parts.push(`Generá ${n} copies para Meta Ads, DIVERSOS entre sí en ángulo:`);
  parts.push(`- 1 con pain point fuerte`);
  parts.push(`- 1 con social proof / testimonial`);
  parts.push(`- 1 con transformación / resultado`);
  parts.push(`- 1 con curiosidad / pregunta retórica`);
  parts.push(`- Resto: variar entre autoridad, oferta concreta, urgencia (si tenés ofertas reales).`);
  parts.push('');
  parts.push(`REGLAS:`);
  parts.push(`- Voseo argentino natural. Modismos OK si encajan.`);
  parts.push(`- Primary text: 50-150 palabras. Que el primer renglón "frene el scroll".`);
  parts.push(`- Headline: max 40 chars, claim concreto.`);
  parts.push(`- NUNCA inventes precios ni promos. Si no hay ofertas declaradas, usá un CTA neutro.`);
  parts.push(`- NO uses claims médicos absolutos ("cura", "elimina 100%"). Suavizá con "ayuda a", "potencia", etc.`);
  parts.push(`- Si el producto tiene formato físico declarado, NO menciones formatos equivocados (no "cápsulas" si es crema, etc).`);
  parts.push(`- Cada copy debe pivotear sobre un ÁNGULO DISTINTO.`);
  return parts.join('\n');
}

const SYSTEM_PROMPT = `Sos copywriter senior de DTC argentino con foco en Meta Ads (Facebook + Instagram). Tu trabajo es generar copies que pasan el scroll, conectan emocionalmente con el target, y respetan los claims reales del producto sin inventar.

Voseo natural. Sin emojis decorativos salvo 1-2 si encajan. Headlines cortos y CONCRETOS. Sin claims médicos absolutos. Si no hay ofertas declaradas, NO inventes promos.

Devolvés el array completo de copies con la tool submit_copies. Cada copy pivotea sobre un ángulo distinto para que el user tenga variedad real para testear.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { error: 'Method not allowed' });
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return respond(res, 500, { error: 'ANTHROPIC_API_KEY missing' });

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  } catch {
    return respond(res, 400, { error: 'Invalid JSON body' });
  }

  const { producto, winners = [], n: rawN } = body || {};
  const n = Math.max(2, Math.min(8, Number(rawN) || 4));
  if (!producto?.nombre) return respond(res, 400, { error: 'producto.nombre required' });

  const userContent = buildContext({ producto, winners, n });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: 4000 + n * 800,
      tools: [SUBMIT_COPIES_TOOL],
      tool_choice: { type: 'tool', name: 'submit_copies' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });

    // No streameamos por copy (output chico) — esperamos finalMessage y
    // devolvemos el array completo en `complete`.
    const finalMsg = await stream.finalMessage();
    const toolUse = (finalMsg.content || []).find(b => b.type === 'tool_use');
    const copies = toolUse?.input?.copies || [];
    const cost = { anthropic: anthropicCost(finalMsg.usage, MODEL) };

    sseWrite(res, { type: 'complete', copies, model: MODEL, cost, generatedAt: new Date().toISOString() });
    res.end();
  } catch (err) {
    console.error('generate-copy error:', err);
    sseWrite(res, { type: 'error', error: err.message || 'Error generando copies' });
    res.end();
  }
}
