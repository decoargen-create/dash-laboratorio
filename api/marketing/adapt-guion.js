// Adaptación de guión de video para los editores.
//
// POST /api/marketing/adapt-guion
// Body: {
//   idea: { titulo, hook, angulo, painPoint, copy, guionReferencia, formato },
//   producto: { nombre, descripcion, research, avatar, stage },
//   competidorRef?: string
// }
//
// Toma el patrón ganador de un ad de la competencia (hook + análisis +
// transcripción de referencia) y devuelve un guión NUEVO, adaptado al
// producto del user y al castellano rioplatense, listo para que un editor
// argentino lo produzca sin preguntar nada.

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Sos un director creativo de video para Meta Ads (Reels/Stories) en Argentina. Tu trabajo: tomar un patrón ganador de la competencia y adaptarlo en un guión NUEVO para el producto del cliente, tan claro que un editor lo pueda producir sin preguntar nada.

REGLAS:
- El guión es para un EDITOR argentino. Claridad total: qué se ve, qué se escucha, qué texto aparece en pantalla, cuánto dura cada beat.
- Castellano rioplatense en TODO el VO y los textos en pantalla. Voseo. Modismos naturales ("posta", "mirá", "che", "te re", "de una"). NUNCA español neutro ni de España.
- Tomá el PATRÓN del ganador de referencia (estructura, tipo de hook, ritmo, triggers) — NO copies su contenido. Adaptalo 100% al producto del cliente con info real del research.
- CRÍTICO: el guión es para el PRODUCTO DEL CLIENTE, no para el de la competencia. NUNCA menciones el nombre, la marca ni el caso de uso del producto del competidor. Si el ganador de referencia habla de otro problema o categoría, traducí el PATRÓN al problema real que resuelve el producto del cliente (sale del research). El resultado tiene que sentirse 100% del cliente.
- Hook en los primeros 3 segundos — tiene que frenar el scroll. No mostrar el producto ni la marca en el arranque si el patrón ganador no lo hace.
- Formato vertical 9:16 (Reels/Stories). Duración realista: 15-40 segundos.
- VO escrito como lo diría una persona real en una historia de IG, no una locutora. Beats cortos, naturales.
- No inventar claims — solo beneficios reales del producto (del research).

Devolvés el guión llamando a la tool \`submit_guion\`.`;

const SUBMIT_GUION_TOOL = {
  name: 'submit_guion',
  description: 'Envía el guión de video adaptado.',
  input_schema: {
    type: 'object',
    properties: {
      duracionSegundos: { type: 'integer', description: 'Duración total estimada del video, en segundos (15-40).' },
      tono: { type: 'string', description: 'Tono / mood del video en 3-6 palabras. Ej: "cercano, gracioso, ritmo rápido".' },
      ganchoVisual: { type: 'string', description: 'Qué pasa en el primer segundo para frenar el scroll. ≤200 chars.' },
      beats: {
        type: 'array',
        description: 'Los beats del video, en orden. Entre 3 y 8.',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer', description: 'Número de beat, empezando en 1.' },
            timecode: { type: 'string', description: 'Rango de tiempo. Ej: "0-3s", "3-8s".' },
            visual: { type: 'string', description: 'Qué se ve en pantalla — encuadre, acción, qué muestra. Detallado para el editor.' },
            voz: { type: 'string', description: 'Qué se dice (voz en off o a cámara), textual, en rioplatense. Vacío si el beat no tiene voz.' },
            textoEnPantalla: { type: 'string', description: 'Texto sobreimpreso en ese beat, si lo hay. Vacío si no.' },
          },
          required: ['n', 'timecode', 'visual', 'voz', 'textoEnPantalla'],
        },
      },
      musicaSugerida: { type: 'string', description: 'Tipo de música/audio sugerido. ≤120 chars.' },
      notasParaEditor: { type: 'string', description: 'Indicaciones generales de producción: ritmo, transiciones, subtítulos, etc. ≤500 chars.' },
    },
    required: ['duracionSegundos', 'tono', 'ganchoVisual', 'beats', 'musicaSugerida', 'notasParaEditor'],
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
  const idea = body?.idea;
  const producto = body?.producto;
  if (!idea || !(idea.hook || idea.titulo)) {
    return respondJSON(res, 400, { error: 'Falta idea.hook / idea.titulo en el body' });
  }

  // Contexto: la idea + el patrón de referencia + el producto.
  const parts = [];
  parts.push('## IDEA A PRODUCIR EN VIDEO');
  if (idea.titulo) parts.push(`Título: ${idea.titulo}`);
  if (idea.hook) parts.push(`Hook: ${idea.hook}`);
  if (idea.angulo) parts.push(`Ángulo: ${idea.angulo}`);
  if (idea.painPoint) parts.push(`Punto de dolor: ${idea.painPoint}`);
  if (idea.copy) parts.push(`Copy/patrones de referencia: ${String(idea.copy).slice(0, 800)}`);
  if (idea.guionReferencia) {
    parts.push(`\n## GUIÓN DEL GANADOR DE REFERENCIA${body?.competidorRef ? ` (competidor: ${body.competidorRef})` : ''}\nEste es el video de la competencia que funcionó — usá su ESTRUCTURA y RITMO como molde, NO su contenido:\n${String(idea.guionReferencia).slice(0, 4000)}`);
  }
  if (producto) {
    parts.push('\n## PRODUCTO DEL CLIENTE (para esto es el guión)');
    if (producto.nombre) parts.push(`Nombre: ${producto.nombre}`);
    if (producto.descripcion) parts.push(`Descripción: ${producto.descripcion}`);
    if (producto.stage) parts.push(`Stage del prospect: ${producto.stage}`);
    if (producto.research) parts.push(`\n--- RESEARCH ---\n${String(producto.research).slice(0, 15000)}`);
    if (producto.avatar) parts.push(`\n--- AVATAR ---\n${String(producto.avatar).slice(0, 6000)}`);
  }
  parts.push('\nGenerá el guión de video adaptado al producto del cliente, en rioplatense, con la tool submit_guion.');

  const client = new Anthropic({ apiKey });

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      tools: [SUBMIT_GUION_TOOL],
      tool_choice: { type: 'tool', name: 'submit_guion' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: parts.join('\n') }],
    });

    const toolUse = (resp.content || []).find(c => c.type === 'tool_use');
    if (!toolUse || !Array.isArray(toolUse.input?.beats)) {
      return respondJSON(res, 502, { error: 'Claude no devolvió un guión válido' });
    }
    const g = toolUse.input;

    return respondJSON(res, 200, {
      guion: {
        duracionSegundos: Math.max(5, Math.min(90, Number(g.duracionSegundos) || 20)),
        tono: String(g.tono || '').slice(0, 200),
        ganchoVisual: String(g.ganchoVisual || '').slice(0, 400),
        beats: g.beats.slice(0, 12).map((b, i) => ({
          n: Number(b.n) || i + 1,
          timecode: String(b.timecode || '').slice(0, 40),
          visual: String(b.visual || '').slice(0, 800),
          voz: String(b.voz || '').slice(0, 600),
          textoEnPantalla: String(b.textoEnPantalla || '').slice(0, 300),
        })),
        musicaSugerida: String(g.musicaSugerida || '').slice(0, 200),
        notasParaEditor: String(g.notasParaEditor || '').slice(0, 700),
      },
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost: { anthropic: anthropicCost(resp.usage, MODEL) },
    });
  } catch (err) {
    console.error('adapt-guion error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error adaptando el guión' });
  }
}
