// Post-research analysis — corre después de generar el research doc + avatar
// y devuelve 2 cosas:
//   1. stage del prospect inferido (problem_aware / solution_aware / product_aware)
//   2. searchKeywords: 5-8 keywords concretos para buscar competidores en
//      Meta Ad Library (mucho mejor que usar solo el hostname de la landing).
//
// POST /api/marketing/post-research-analysis
// Body: { producto: { nombre, landingUrl?, descripcion? }, research: string, avatar?: string }
// Output: { stage, stageReason, searchKeywords, model, generatedAt }

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Sos analista senior de marketing DTC. Dado un research doc profundo de un producto, extraés 2 cosas clave:

1. **Stage del prospect** (awareness según Schwartz):
   - "problem_aware": sabe que tiene el problema, NO conoce las soluciones. Los ads deben agitar el dolor antes de mostrar producto.
   - "solution_aware": conoce categorías de solución (serum, cremas, etc.), NO conoce esta marca. Los ads diferencian tu approach.
   - "product_aware": ya conoce la marca/producto, falta decidir. Los ads apilan prueba y remueven objeciones.

Criterios para decidir el stage:
   - Si "existing solutions" en el research es corto o vago → problem_aware (el mercado no sabe cómo resolverse).
   - Si "existing solutions" es amplio + comparaciones + la landing enfoca diferenciación → solution_aware.
   - Si hay clientes repetidos, brand equity, testimonios destacados en la landing → product_aware.

2. **Search keywords para Meta Ad Library** — 5 a 8 keywords concretos que los competidores DIRECTOS de este producto probablemente usan en sus ads. Pensá qué buscás para encontrar tiendas que venden CASI lo mismo.

Ejemplos:
- Para un serum con retinol → ["retinol", "serum antiedad", "arrugas", "skincare natural", "rejuvenecimiento facial"]
- Para un protector solar químico → ["protector solar", "protección UV", "antiaging solar", "FPS rostro"]

Reglas de keywords:
- Castellano rioplatense. Sin español de España.
- NO el nombre de la marca propia.
- Mezclar: keywords del problema ("arrugas", "acné") + keywords de categoría ("serum", "crema") + keywords del ángulo ("antiedad", "hidratación profunda").
- 2-3 palabras cada uno máximo.

Devolvé vía la tool "submit_analysis".`;

const SUBMIT_ANALYSIS_TOOL = {
  name: 'submit_analysis',
  description: 'Envía el análisis post-research con stage + keywords.',
  input_schema: {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        enum: ['problem_aware', 'solution_aware', 'product_aware'],
        description: 'Stage de awareness del prospect inferido del research.',
      },
      stageReason: {
        type: 'string',
        description: '1-2 oraciones explicando por qué inferiste este stage.',
      },
      searchKeywords: {
        type: 'array',
        description: '5-8 keywords para buscar competidores en Meta Ad Library.',
        items: { type: 'string' },
      },
    },
    required: ['stage', 'stageReason', 'searchKeywords'],
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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const body = await readBody(req);
  const { producto, research, avatar } = body || {};
  if (!producto?.nombre) return respondJSON(res, 400, { error: 'Falta producto.nombre' });
  if (!research || research.length < 200) {
    return respondJSON(res, 400, { error: 'Research doc muy corto o ausente — corré primero el pipeline de documentación' });
  }

  const client = new Anthropic({ apiKey: anthropicKey });

  const userContent = [
    '## PRODUCTO',
    `Nombre: ${producto.nombre}`,
    producto.landingUrl ? `Landing: ${producto.landingUrl}` : null,
    producto.descripcion ? `Descripción: ${producto.descripcion}` : null,
    '',
    '## RESEARCH DOC',
    research,
    '',
    avatar ? '## AVATAR SHEET' : null,
    avatar ? avatar.slice(0, 4000) : null,
    '',
    'Analizá y llamá a submit_analysis.',
  ].filter(Boolean).join('\n');

  try {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      tools: [SUBMIT_ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'submit_analysis' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });
    const resp = await stream.finalMessage();

    const toolUse = resp.content.find(b => b.type === 'tool_use' && b.name === 'submit_analysis');
    if (!toolUse?.input) throw new Error('Claude no llamó a submit_analysis');

    const { stage, stageReason, searchKeywords } = toolUse.input;
    const cleanKeywords = Array.isArray(searchKeywords)
      ? searchKeywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()).slice(0, 8)
      : [];

    return respondJSON(res, 200, {
      stage: ['problem_aware', 'solution_aware', 'product_aware'].includes(stage) ? stage : 'problem_aware',
      stageReason: String(stageReason || '').slice(0, 500),
      searchKeywords: cleanKeywords,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost: { anthropic: anthropicCost(resp.usage, MODEL) },
    });
  } catch (err) {
    console.error('post-research-analysis error:', err);
    return respondJSON(res, 502, { error: err.message || 'Error analizando post-research' });
  }
}
