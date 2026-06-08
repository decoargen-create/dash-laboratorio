// Scoring de hooks post-generación.
//
// POST /api/marketing/score-hooks
// Body: { ideas: [{ id, titulo, hook, tipo, anguloCategoria }, ...] }
//
// Usa Haiku 4.5 (barato, rápido) para puntuar cada hook 1-10 contra
// criterios fijos: pattern-interrupt, especificidad, tono porteño,
// no-claims-inventados. Devuelve scores + reason corta.
//
// El cliente filtra los <6 y los marca en bandeja con flag lowScore para
// que el user los archive con un click. Esto evita que la bandeja se llene
// de hooks genéricos / corporativos que el generator deja pasar a veces
// (ningún piso de calidad antes de este step).

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Sos un editor senior de copy para Meta Ads en e-commerce argentino. Tu trabajo: scorear hooks de creativos publicitarios y descartar los flojos antes de que vayan a producción.

CRITERIOS DE SCORING (1-10):
- 9-10: hook scroll-stopping. Pattern interrupt fuerte + especificidad + tono porteño natural + dispara curiosidad / dolor / shock. Le pondrías plata personal.
- 7-8: hook sólido pero no excepcional. Tiene gancho pero le falta filo o es predecible.
- 5-6: hook OK pero genérico. Podría estar en cualquier marca del rubro. No memorable.
- 3-4: hook flojo. Corporativo, neutro, español de España, claims vacíos tipo "alucinante / brutal / increíble".
- 1-2: hook roto. Truncado, sin sentido, claims inventados, palabras prohibidas (cure, garantía 100%, sin esfuerzo).

PENALIZACIONES AUTOMÁTICAS:
- Uso de "tú/tu/tienes/puedes" → máx 4
- "Genial / alucinante / brutal / increíble" sin justificación → máx 5
- Claim vago tipo "el mejor / único / revolucionario" → máx 5
- Mayor a 15 palabras → máx 6 (los hooks largos no frenan el scroll)
- Tono clínico/médico distante en producto que NO es médico → máx 5

BONIFICACIONES:
- Número concreto en el hook (ej: "4 cremas", "62 años", "23 días") → +1
- Pregunta retórica filosa que rompe burbuja → +1
- Modismo argentino auténtico (che, posta, zafar, quilombo, laburo) → +1
- Doble sentido o metáfora visual potente → +2

DEVOLVÉS la respuesta llamando a la tool \`submit_scores\`. Reason debe ser ≤ 100 chars, accionable, en castellano rioplatense.`;

const SUBMIT_SCORES_TOOL = {
  name: 'submit_scores',
  description: 'Devuelve el array de scores correspondiente al array de hooks recibido.',
  input_schema: {
    type: 'object',
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'El id que vino en el input.' },
            score: { type: 'integer', minimum: 1, maximum: 10 },
            reason: { type: 'string', description: 'Por qué ese score, ≤100 chars, en porteño accionable.' },
          },
          required: ['id', 'score', 'reason'],
        },
      },
    },
    required: ['scores'],
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
  const ideas = Array.isArray(body?.ideas) ? body.ideas : [];
  if (ideas.length === 0) return respondJSON(res, 400, { error: 'Falta ideas[] en el body' });

  // Limitamos a 100 por call para no exceder context y mantener latencia baja.
  // Si el run pidió más, el cliente puede chunkear y llamar varias veces.
  const capped = ideas.slice(0, 100);

  const client = new Anthropic({ apiKey });

  const userContent = `Hooks a scorear:\n\n${capped.map((i, idx) => {
    return `${idx + 1}. id="${i.id || ''}" tipo=${i.tipo || '?'} angulo=${i.anguloCategoria || '?'}\n   titulo: ${String(i.titulo || '').slice(0, 200)}\n   hook: "${String(i.hook || '').slice(0, 300)}"`;
  }).join('\n\n')}\n\nDevolvé un score (1-10) + reason corta para cada uno. El array debe tener exactamente ${capped.length} entries en el mismo orden.`;

  try {
    // max_tokens: Haiku 4.5 acepta hasta 8192. Para 100 ideas (cap del
    // endpoint), cada score serializado pesa ~60 tokens (id + score + reason
    // + JSON overhead). 100 × 60 = 6000 + overhead → 8192 suficiente.
    // Antes era 4096 que se quedaba corto y Claude truncaba la tool_use
    // → llegaba malformada al server.
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: Math.min(8192, 200 + capped.length * 80),
      tools: [SUBMIT_SCORES_TOOL],
      tool_choice: { type: 'tool', name: 'submit_scores' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });

    // Buscamos la tool_use. Si no hay (Claude se desvió a text — raro con
    // tool_choice forzado), intentamos parsear JSON del text como fallback.
    let scores = null;
    const toolUse = (resp.content || []).find(c => c.type === 'tool_use');
    if (toolUse?.input?.scores && Array.isArray(toolUse.input.scores)) {
      scores = toolUse.input.scores;
    } else {
      // Fallback: text con JSON adentro
      const textBlock = (resp.content || []).find(c => c.type === 'text');
      if (textBlock?.text) {
        const match = textBlock.text.match(/\{[\s\S]*"scores"[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed.scores)) scores = parsed.scores;
          } catch {}
        }
      }
    }

    if (!scores) {
      // No hubo forma de extraer scores. Devolvemos array vacío + warning
      // (NO 500) para que el cliente NO muestre toast de error rojo. Las
      // ideas igual entraron a Bandeja, solo no se filtran las flojas.
      return respondJSON(res, 200, {
        scores: [],
        warning: 'Claude no devolvió scores válidos. Las ideas están en Bandeja sin marcar score.',
        stopReason: resp.stop_reason,
        model: MODEL,
        generatedAt: new Date().toISOString(),
        cost: { anthropic: anthropicCost(resp.usage, MODEL) },
      });
    }

    // Sanitizamos: clamp 1-10. Si Claude NO devolvió un score numérico,
    // queda `null` — NO 5. Antes el fallback a 5 marcaba como "floja"
    // (score < 6) cualquier idea sin score real.
    const clean = scores.map(s => {
      const n = Number(s.score);
      return {
        id: String(s.id || ''),
        score: Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : null,
        reason: String(s.reason || '').slice(0, 200),
      };
    });

    return respondJSON(res, 200, {
      scores: clean,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost: { anthropic: anthropicCost(resp.usage, MODEL) },
    });
  } catch (err) {
    console.error('score-hooks error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error scorando hooks' });
  }
}
