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
// transcripción de referencia) y devuelve un GUIÓN de texto corrido,
// adaptado al producto del cliente y al castellano rioplatense — el
// libreto hablado, listo para que un editor argentino lo produzca.
// NO desglosa por escenas/beats — solo el texto del guión.

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Sos un guionista de video para Meta Ads (Reels/Stories) en Argentina. Tu trabajo: tomar un patrón ganador de la competencia y escribir un GUIÓN nuevo para el producto del cliente.

QUÉ DEVOLVÉS:
- SOLO el guión: el libreto hablado del video, de principio a fin, corrido.
- NADA de desglose por escenas, beats, timecodes ni indicaciones de cámara. El editor se encarga de lo visual. Vos entregás lo que se dice/narra.
- Texto plano, listo para leer en voz alta. Podés usar saltos de línea para separar ideas, nada más.

REGLAS DEL GUIÓN:
- Castellano rioplatense, 100%. Voseo. Modismos naturales ("posta", "mirá", "che", "te re", "de una"). NUNCA español neutro ni de España.
- Escribilo como lo diría una persona real en una historia de IG — cercano, natural, con ritmo hablado. No locutora profesional.
- Tomá el PATRÓN del ganador de referencia (estructura, tipo de hook, ritmo) pero el contenido es 100% del producto del cliente, con info real del research.
- CRÍTICO: NUNCA menciones la marca, el nombre ni el caso de uso del producto del competidor. Si el ganador habla de otro problema, traducí el patrón al problema real que resuelve el producto del cliente.
- Arrancá con un hook fuerte en la primera frase — tiene que frenar el scroll.
- Largo: el de un Reel de 15-40 segundos hablados. Conciso.
- No inventar claims — solo beneficios reales del producto (del research).

Devolvé ÚNICAMENTE el texto del guión. Sin títulos, sin "GUIÓN:", sin comillas, sin preámbulo. Empezá directo con la primera frase del guión.`;

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

  const parts = [];
  parts.push('## IDEA A PRODUCIR EN VIDEO');
  if (idea.titulo) parts.push(`Título: ${idea.titulo}`);
  if (idea.hook) parts.push(`Hook: ${idea.hook}`);
  if (idea.angulo) parts.push(`Ángulo: ${idea.angulo}`);
  if (idea.painPoint) parts.push(`Punto de dolor: ${idea.painPoint}`);
  if (idea.copy) parts.push(`Copy/patrones de referencia: ${String(idea.copy).slice(0, 800)}`);
  if (idea.guionReferencia) {
    parts.push(`\n## GUIÓN DEL GANADOR DE REFERENCIA${body?.competidorRef ? ` (competidor: ${body.competidorRef})` : ''}\nUsá su ESTRUCTURA y RITMO como molde, NO su contenido:\n${String(idea.guionReferencia).slice(0, 4000)}`);
  }
  if (producto) {
    parts.push('\n## PRODUCTO DEL CLIENTE (para esto es el guión)');
    if (producto.nombre) parts.push(`Nombre: ${producto.nombre}`);
    if (producto.descripcion) parts.push(`Descripción: ${producto.descripcion}`);
    if (producto.stage) parts.push(`Stage del prospect: ${producto.stage}`);
    if (producto.research) parts.push(`\n--- RESEARCH ---\n${String(producto.research).slice(0, 15000)}`);
    if (producto.avatar) parts.push(`\n--- AVATAR ---\n${String(producto.avatar).slice(0, 6000)}`);
  }
  parts.push('\nEscribí el guión de video adaptado al producto del cliente, en rioplatense. Solo el texto del guión.');

  const client = new Anthropic({ apiKey });

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: parts.join('\n') }],
    });

    const textBlock = (resp.content || []).find(c => c.type === 'text');
    const guion = textBlock?.text?.trim() || '';
    if (!guion) return respondJSON(res, 502, { error: 'Claude no devolvió un guión' });

    return respondJSON(res, 200, {
      guion,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost: { anthropic: anthropicCost(resp.usage, MODEL) },
    });
  } catch (err) {
    console.error('adapt-guion error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error adaptando el guión' });
  }
}
