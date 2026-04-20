// Pipeline de generación de creativos para Meta Ads.
// Basado en el prompt v2.0 del SOP de MARK BUILDS BRANDS.
//
// POST /api/marketing/creatives
// Body: { action, productoContext, ... }
//
// Acciones:
//   - 'hooks': genera diagnóstico + 15-25 hooks categorizados por ángulo.
//   - 'visual-plan': planifica visualmente cada pieza seleccionada.
//   - 'brief': brief completo en markdown para pasar al diseñador.

import Anthropic from '@anthropic-ai/sdk';

const MODEL_SONNET = 'claude-sonnet-4-6';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

const HOOKS_SYSTEM = `Sos un estratega de direct-response + copywriter + director de arte especializado en Meta Ads para ecommerce argentino. Combinás insights de Alex Hormozi (big idea, curiosidad, pattern interrupt), copywriting argento coloquial (voseo, no neutro, no español de España), criterio de marca y ojo visual.

Sos directo y honesto. No validás por validar. Preferís menos ideas bien desarrolladas antes que listas infinitas mediocres.

Recibís el contexto del producto (research, avatar, offer brief) + configuración del cliente (tono, restricciones, objetivo). Devolvés JSON ESTRICTO con esta estructura:

{
  "diagnostico": {
    "beneficios": ["..."],
    "dolores": ["..."],
    "tonoActual": "...",
    "vaciosComunicacion": ["dolores emocionales no capitalizados en la landing — acá está el oro"]
  },
  "angulosElegidos": [
    { "id": "A", "nombre": "Sarcasmo / vulgar jugado", "porQueSirve": "..." },
    { "id": "B", "nombre": "Insight incómodo", "porQueSirve": "..." }
  ],
  "hooks": [
    {
      "id": 1,
      "angulo": "A",
      "texto": "Hook corto de máximo 12 palabras",
      "riesgoMeta": false,
      "motivoRiesgoMeta": null
    }
  ],
  "observaciones": [
    "Observación estratégica 1: vacíos de comunicación destacables, activos de marca subutilizados, etc.",
    "Observación 2..."
  ]
}

REGLAS:
- Elegí 4-5 ángulos (no los 6 siempre). Los 6 típicos son:
  A. Sarcasmo / vulgar jugado (pattern interrupt por shock)
  B. Insight incómodo (rompe tabú)
  C. Situación relatable / POV ("cuando te pasa X")
  D. Curiosidad / doble sentido visual
  E. Autoridad / solución (BOFU)
  F. Testimonio / voz del cliente
- Generá entre 15-25 hooks en total, distribuidos entre los ángulos elegidos.
- Cada hook: máximo 12 palabras, debe funcionar como PRIMERA línea sin contexto.
- Stopping power obligatorio: shock, humor, curiosidad o identificación.
- Originalidad: si podría estar en cualquier otra marca del rubro, NO sirve.
- Marcá riesgoMeta:true si el hook tiene palabras gatillo (vagina, sexo, infección, desnudo, etc.) y explicá el motivo.
- 2-3 observaciones estratégicas relevantes (vacíos, activos de marca, segmentación, advertencias de Meta).
- Argentino rioplatense (vos, che). NO español neutro. NO "tú", "vosotros".
- NO markdown. SOLO JSON puro.`;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
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
  const { action, producto, config } = body || {};

  if (!producto || typeof producto !== 'object') {
    return respondJSON(res, 400, { error: 'Falta el producto con su context (research/avatar/offerBrief)' });
  }

  if (action === 'hooks') {
    const client = new Anthropic({ apiKey });
    const userContent = `Producto: ${producto.productoNombre || 'sin nombre'}
URL: ${producto.productoUrl || 'sin URL'}
Descripción: ${producto.descripcion || 'sin descripción'}
Resumen ejecutivo: ${producto.resumenEjecutivo || ''}

Tono deseado: ${config?.tono || 'argentino coloquial, directo, sin marketing fluff'}
Objetivo de campaña: ${config?.objetivo || 'TOFU / prospecting'}
Restricciones de marca: ${config?.restricciones || 'ninguna en particular'}

RESEARCH DOC (extracto):
${(producto.docs?.research || '').slice(0, 4000)}

AVATAR (extracto):
${(producto.docs?.avatar || '').slice(0, 2000)}

OFFER BRIEF (extracto):
${(producto.docs?.offerBrief || '').slice(0, 2000)}

CREENCIAS NECESARIAS:
${(producto.docs?.beliefs || '').slice(0, 1500)}

${producto.competidores?.length ? `
COMPETIDORES RELEVANTES (y sus hooks detectados):
${producto.competidores.slice(0, 5).map(c => `- ${c.nombre}: ${(c.ads || []).slice(0, 3).map(a => (a.bodies?.[0] || '').slice(0, 100)).filter(Boolean).join(' | ')}`).join('\n')}
` : ''}

${producto.memoria?.aprendizajes?.length ? `
APRENDIZAJES PREVIOS (TENER EN CUENTA):
${producto.memoria.aprendizajes.slice(0, 8).map(a => `- ${a.texto}`).join('\n')}
` : ''}

Generá el JSON de diagnóstico + ángulos + hooks + observaciones.`;

    try {
      const message = await client.messages.create({
        model: MODEL_SONNET,
        max_tokens: 3072,
        system: [{ type: 'text', text: HOOKS_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      });
      const text = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      let parsed;
      try { parsed = JSON.parse(cleaned); }
      catch { return respondJSON(res, 502, { error: 'No pude parsear la respuesta de Claude', raw: text }); }
      return respondJSON(res, 200, { action, generatedAt: new Date().toISOString(), ...parsed });
    } catch (err) {
      console.error('creatives hooks error:', err);
      return respondJSON(res, 500, { error: err?.message || 'Error generando hooks' });
    }
  }

  // Fases 2-4 se implementan en siguientes iteraciones (visual-plan, brief).
  return respondJSON(res, 400, { error: `action "${action}" no implementada todavía. Disponibles: hooks` });
}
