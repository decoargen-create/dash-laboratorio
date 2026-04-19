// Generador multi-tipo de ideas creativas.
//
// POST /api/marketing/generate-ideas
// Body: {
//   producto: { nombre, descripcion, landingUrl, research?, avatar?, offerBrief? },
//   competidoresAnalisis: [
//     { competidorNombre, adId, adHeadline, adBody, analysis: {...} },
//     ...
//   ],
//   ideasExistentes: [ { titulo, angulo, tipo }, ... ],  // para que no repita
//   propiosAds?: [ { headline, body, metrics } ]  // (opcional, futuro)
// }
//
// Output: {
//   ideas: [
//     { titulo, tipo, angulo, painPoint, hook, copy, guion, formato, razonamiento },
//     ...
//   ],
//   generatedAt, model
// }
//
// Estrategia: un solo request a Claude Sonnet que devuelve 10 ideas
// clasificadas en 3 tipos (replica / diferenciacion / desde_cero).
// Iteracion requiere data de los propios ads (Meta insights) — lo agregamos
// cuando esté conectado el pull de insights.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Sos director creativo senior de DTC cosméticos en Argentina. Tu trabajo es generar ideas de creativos accionables para Meta Ads. Tus ideas no son genéricas: son específicas al producto, al avatar y al contexto de la competencia.

Tenés que devolver EXACTAMENTE 10 ideas en un JSON array, clasificadas en 3 tipos:

- 3 ideas tipo "replica": tomá los ángulos más fuertes que detectaste en la competencia y adaptalos al producto. NO copies literal — extraé el patrón (estructura, trigger, formato) y aplícalo al producto propio de forma que se sienta nuestra. Dejá claro en "razonamiento" qué ganador te inspiró.

- 3 ideas tipo "diferenciacion": identificá qué ángulos/ganchos NINGÚN competidor está usando todavía. Pensá en el blue ocean. Lo repetido entre varios competidores está saturado — buscá lo que falta. En "razonamiento" explicá por qué nadie lo hizo.

- 4 ideas tipo "desde_cero": ángulos originales basados en el producto + avatar. Cada idea debe explorar un pain distinto, un trigger distinto o un beneficio distinto. Diversificá formatos (mezclá video + static + carrusel).

Por cada idea devolvé este shape EXACTO:
{
  "titulo": "string corto y concreto, ≤ 80 chars",
  "tipo": "replica" | "diferenciacion" | "desde_cero",
  "angulo": "el ángulo emocional o estratégico",
  "painPoint": "el pain específico que toca",
  "hook": "primer frame o primeras 3 líneas que paran el scroll",
  "copy": "copy completo sugerido (2-5 oraciones)",
  "guion": "si es video, script corto esquemático en rioplatense. Si es static, dejá string vacío.",
  "formato": "video" | "static" | "carrusel",
  "razonamiento": "1-2 oraciones: por qué esta idea, qué la hace fuerte"
}

DEVOLVÉ ÚNICAMENTE el array JSON (empezá con "[" y terminá con "]"). Sin texto antes ni después. Sin \`\`\`json wrappers. 10 ideas en total.`;

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

// Serializamos el contexto en un string estructurado y legible para Claude.
function buildContext({ producto, competidoresAnalisis, ideasExistentes }) {
  const parts = [];

  parts.push('## PRODUCTO PROPIO');
  parts.push(`Nombre: ${producto?.nombre || '(sin nombre)'}`);
  if (producto?.landingUrl) parts.push(`Landing: ${producto.landingUrl}`);
  if (producto?.descripcion) parts.push(`Descripción: ${producto.descripcion}`);
  // Opcionalmente, si el user corrió el research pipeline, pasamos research/avatar.
  if (producto?.research) parts.push(`\nResearch (snippet):\n${String(producto.research).slice(0, 2000)}`);
  if (producto?.avatar) parts.push(`\nAvatar (snippet):\n${String(producto.avatar).slice(0, 1500)}`);
  if (producto?.offerBrief) parts.push(`\nOffer Brief (snippet):\n${String(producto.offerBrief).slice(0, 1500)}`);

  parts.push('\n## COMPETENCIA — ANÁLISIS DE GANADORES');
  if (!competidoresAnalisis?.length) {
    parts.push('(Sin análisis de competencia todavía. Igual generá ideas pero marcá que las "replica" son genéricas.)');
  } else {
    competidoresAnalisis.slice(0, 8).forEach((c, i) => {
      parts.push(`\n### ${i + 1}. ${c.competidorNombre || 'Competidor'} — ad ${c.adId || ''}`);
      if (c.adHeadline) parts.push(`Headline: ${c.adHeadline}`);
      if (c.adBody) parts.push(`Body: ${String(c.adBody).slice(0, 400)}`);
      const a = c.analysis || {};
      if (a.angle) parts.push(`Ángulo: ${a.angle}`);
      if (Array.isArray(a.hooks)) parts.push(`Hooks: ${a.hooks.join(' | ')}`);
      if (Array.isArray(a.triggers)) parts.push(`Triggers: ${a.triggers.join(', ')}`);
      if (a.audience) parts.push(`Audience: ${a.audience}`);
      if (a.why_it_works) parts.push(`Por qué funciona: ${a.why_it_works}`);
    });
  }

  if (ideasExistentes?.length) {
    parts.push('\n## IDEAS YA EN LA BANDEJA (NO repitas, generá nuevas)');
    ideasExistentes.slice(0, 30).forEach(i => {
      parts.push(`- [${i.tipo}] ${i.titulo}${i.angulo ? ' — ' + String(i.angulo).slice(0, 100) : ''}`);
    });
  }

  parts.push('\n## INSTRUCCIÓN');
  parts.push('Generá 10 ideas nuevas siguiendo el formato JSON pedido en el system prompt. Empezá directo con "[".');

  return parts.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });
  }

  const body = await readBody(req);
  const { producto, competidoresAnalisis = [], ideasExistentes = [] } = body || {};
  if (!producto || !producto.nombre) {
    return respondJSON(res, 400, { error: 'Falta producto.nombre en el body' });
  }

  const client = new Anthropic({ apiKey: anthropicKey });
  const userContent = buildContext({ producto, competidoresAnalisis, ideasExistentes });

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: userContent },
      ],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('Claude no devolvió texto');

    let jsonStr = textBlock.text.trim();
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) jsonStr = match[1];
    // Si viene envuelto en "ideas": [...] lo desenvolvemos.
    if (jsonStr.startsWith('{')) {
      try {
        const obj = JSON.parse(jsonStr);
        if (Array.isArray(obj.ideas)) jsonStr = JSON.stringify(obj.ideas);
      } catch {}
    }

    let ideas;
    try {
      ideas = JSON.parse(jsonStr);
    } catch (err) {
      throw new Error(`JSON inválido del modelo: ${err.message}. Primeros 200 chars: ${jsonStr.slice(0, 200)}`);
    }
    if (!Array.isArray(ideas)) {
      throw new Error('La respuesta no es un array');
    }

    // Filtrado defensivo: solo ideas con titulo + tipo válido.
    const tiposValidos = new Set(['replica', 'iteracion', 'diferenciacion', 'desde_cero']);
    const clean = ideas
      .filter(i => i && typeof i.titulo === 'string' && tiposValidos.has(i.tipo))
      .map(i => ({
        titulo: String(i.titulo).slice(0, 150),
        tipo: i.tipo,
        angulo: String(i.angulo || '').slice(0, 500),
        painPoint: String(i.painPoint || '').slice(0, 500),
        hook: String(i.hook || '').slice(0, 500),
        copy: String(i.copy || '').slice(0, 1500),
        guion: String(i.guion || '').slice(0, 3000),
        formato: ['video', 'static', 'carrusel'].includes(i.formato) ? i.formato : 'static',
        razonamiento: String(i.razonamiento || '').slice(0, 500),
      }));

    return respondJSON(res, 200, {
      ideas: clean,
      count: clean.length,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      usage: resp.usage,
    });
  } catch (err) {
    console.error('generate-ideas error:', err);
    return respondJSON(res, 502, { error: err.message || 'Error generando ideas' });
  }
}
