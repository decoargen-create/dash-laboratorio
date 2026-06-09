// Copiloto de Marketing — chat contextual sobre un producto.
//
// POST /api/marketing/copilot
// Body: {
//   messages: [{ role: 'user'|'assistant', content: string }, ...],
//   productoContext: { nombre, descripcion, stage, research, avatar,
//                      offerBrief, beliefs, competidoresResumen, ideasResumen }
// }
//
// Responde con Claude usando el research/avatar/competencia del producto
// como contexto. El system prompt (que incluye el contexto pesado) va con
// prompt caching → los turnos siguientes del chat pagan barato.

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_BASE = `Sos el copiloto de marketing de Viora — un estratega de direct-response + copywriter experto en Meta Ads para e-commerce argentino. Asistís al user a pensar campañas, hooks, ángulos y creativos para SU producto.

Cómo respondés:
- Castellano rioplatense, directo, sin vueltas. Tono de colega experto, no de chatbot corporativo.
- Concreto y accionable. Si te piden hooks, devolvés hooks listos para usar, no teoría.
- Te apoyás en el research, el avatar y el análisis de competencia del producto (te los paso abajo). Si algo no está en ese contexto, decilo en vez de inventar.
- Honesto: si una idea del user es floja, decíselo y proponé algo mejor.
- Conciso. Respuestas de chat, no ensayos. Usá bullets y formato cuando ayude.

Podés ayudar con: ideas de hooks y ángulos, análisis de la competencia, qué testear, copy de ads, estrategia de funnel (TOFU/MOFU/BOFU), interpretación del avatar, y feedback sobre ideas que el user te traiga.`;

// Contexto ESTABLE del producto (research, avatar, etc) — va en el system
// prompt con cache_control. No cambia entre turnos → se cachea y los turnos
// siguientes pagan barato.
function buildEstableBlock(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const parts = ['\n\n=== CONTEXTO DEL PRODUCTO ==='];
  if (ctx.nombre) parts.push(`Producto: ${ctx.nombre}`);
  if (ctx.descripcion) parts.push(`Descripción: ${ctx.descripcion}`);
  if (ctx.stage) parts.push(`Stage del prospect: ${ctx.stage}`);
  if (ctx.research) parts.push(`\n--- RESEARCH DOC ---\n${String(ctx.research).slice(0, 20000)}`);
  if (ctx.avatar) parts.push(`\n--- AVATAR ---\n${String(ctx.avatar).slice(0, 8000)}`);
  if (ctx.offerBrief) parts.push(`\n--- OFFER BRIEF ---\n${String(ctx.offerBrief).slice(0, 8000)}`);
  if (ctx.beliefs) parts.push(`\n--- CREENCIAS NECESARIAS ---\n${String(ctx.beliefs).slice(0, 4000)}`);
  if (parts.length === 1) {
    parts.push('(El producto todavía no tiene research. Corré el pipeline para que el copiloto tenga material — por ahora respondé con criterio general.)');
  }
  return parts.join('\n');
}

// Contexto VOLÁTIL (competencia, ideas) — cambia a medida que el user
// trabaja. Va anexado al último mensaje del user, NO al system, para no
// invalidar el cache del system prompt en cada turno.
function buildVolatilBlock(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const parts = [];
  if (ctx.competidoresResumen) parts.push(`--- COMPETENCIA (estado actual) ---\n${String(ctx.competidoresResumen).slice(0, 4000)}`);
  if (ctx.ideasResumen) parts.push(`--- BANDEJA DE IDEAS (estado actual, con el detalle de las accionables) ---\n${String(ctx.ideasResumen).slice(0, 9000)}`);
  return parts.length ? `\n\n[Contexto actualizado — no respondas a esto, solo usalo como referencia]\n${parts.join('\n\n')}` : '';
}

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
  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  // Sanitizamos: solo roles válidos, content string no vacío, cap 30 turnos.
  const messages = rawMessages
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-30)
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (messages.length === 0) {
    return respondJSON(res, 400, { error: 'Falta messages[] con al menos un mensaje del user' });
  }
  if (messages[messages.length - 1].role !== 'user') {
    return respondJSON(res, 400, { error: 'El último mensaje debe ser del user' });
  }

  const ctx = body?.productoContext;
  // System = base + contexto estable (research/avatar/etc) → cacheable.
  const systemText = SYSTEM_BASE + buildEstableBlock(ctx);
  // El contexto volátil (competencia/ideas) se anexa al último mensaje del
  // user, así no invalida el cache del system en cada turno.
  const volatil = buildVolatilBlock(ctx);
  const finalMessages = messages.map((m, i) =>
    (volatil && i === messages.length - 1)
      ? { ...m, content: m.content + volatil }
      : m
  );
  const client = new Anthropic({ apiKey });

  try {
    const resp = await client.messages.create({
      model: MODEL,
      // Antes 2048 truncaba respuestas como "dame 20 hooks" — Claude
      // cortaba a mitad de lista. 4096 alcanza para chats normales sin
      // gastar mucho más (solo se cobra lo que efectivamente sale).
      max_tokens: 4096,
      // El contexto estable del producto es pesado y no cambia entre turnos
      // → cache_control lo abarata a partir del 2do turno.
      system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
      messages: finalMessages,
    });

    const textBlock = (resp.content || []).find(c => c.type === 'text');
    const reply = textBlock?.text?.trim() || '';
    if (!reply) return respondJSON(res, 502, { error: 'El copiloto no devolvió respuesta' });

    return respondJSON(res, 200, {
      reply,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost: { anthropic: anthropicCost(resp.usage, MODEL) },
    });
  } catch (err) {
    console.error('copilot error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error en el copiloto' });
  }
}
