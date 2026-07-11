// Módulo "Guiones IA" — paso 2: traducción + adaptación del guion.
//
// Recibe la transcripción cruda de un video ad de la competencia (que ya
// está pautado = fórmula validada con plata real) y devuelve:
//   1. traduccion  — la transcripción fiel en español neutro (qué dice el ad)
//   2. guion       — guion NUEVO adaptado: castellano rioplatense, el avatar,
//                    pain points y oferta REALES del producto del user.
//                    Mantiene la ESTRUCTURA validada del original (tipo de
//                    hook, ritmo, orden de beats, mecánica de persuasión).
//   3. hooksAlternativos — 3 hooks extra para testear (distinto ángulo de
//                    entrada, misma estrategia).
//   4. notasEditor — indicaciones de producción para el editor (tono, ritmo,
//                    momentos clave, referencias visuales del original).
//
// POST /api/marketing/adaptar-guion-video
// Body: { transcript, idioma?, producto: { nombre, descripcion, research,
//         avatar, stage, ofertasReales }, notas? }
// Response: { traduccion, guion, hooksAlternativos, notasEditor, costUSD }

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';
import { getUserIdFromAuth } from './_supabase-server.js';

const MODEL = 'claude-sonnet-4-6';

export const maxDuration = 120;

const SYSTEM_PROMPT = `Sos un media buyer + guionista senior de Meta Ads (Reels/Stories) especializado en DTC argentino. Tu especialidad: tomar VSLs y video-ads GANADORES de la competencia (ya validados con pauta real) y reescribirlos para otro producto y otro mercado sin perder la mecánica de persuasión que los hace funcionar.

Vas a recibir:
- La TRANSCRIPCIÓN cruda de un video ad de la competencia (puede venir en inglés, portugués o español).
- El CONTEXTO del producto del cliente: nombre, descripción, research de mercado, avatar, stage de conciencia y ofertas/precios REALES.

Devolvés EXACTAMENTE este JSON (sin markdown, sin texto extra):
{
  "traduccion": "traducción FIEL de la transcripción al español neutro. Traducís lo que dice, sin adaptar nada. Si ya está en español, copiala prolijada (sin muletillas de transcripción).",
  "estructuraDetectada": "1-2 líneas: qué mecánica usa el ad (ej: 'hook de curiosidad + testimonio en primera persona + demo + urgencia de oferta'). Es el PATRÓN que vas a preservar.",
  "guion": "el guion NUEVO completo, listo para grabar/locutar.",
  "hooksAlternativos": ["hook alternativo 1", "hook alternativo 2", "hook alternativo 3"],
  "notasEditor": "indicaciones de producción para el editor: tono de voz, ritmo, dónde van los cortes/beats respecto del original, qué mostrar en cámara en cada tramo, textos en pantalla sugeridos. Concreto y accionable, en bullets con \\n."
}

REGLAS DEL GUION (las más importantes):
- Castellano RIOPLATENSE 100%. Voseo. Modismos porteños naturales ("posta", "mirá", "te juro", "de una", "me re pasaba"). JAMÁS español neutro ni de España ni mexicanismos.
- Escrito como habla una persona real en una historia de IG — cercano, imperfecto, con ritmo hablado. NO locutor profesional, NO lenguaje publicitario acartonado.
- PRESERVÁ la estructura del original: mismo tipo de hook, mismo orden de beats, mismo mecanismo de persuasión, duración hablada similar. Eso es lo validado. Lo que CAMBIA es el contenido: producto, problema, avatar, país, oferta.
- CASO DE USO REAL: el problema/zona del cuerpo/beneficio sale del research del producto del cliente, NUNCA del ad original. Si el original vende otra cosa, traducí el patrón al problema real del cliente.
- JAMÁS menciones la marca, producto o claims del competidor.
- OFERTA: si el cliente tiene ofertas/precios reales declarados, integrá UNA al cierre (como lo hace el original si lo hace). Si no hay ofertas declaradas, cerrá con CTA sin precio ("probalo", "conocelo") — NUNCA inventes descuentos ni precios.
- CLAIMS: solo beneficios que estén en el research/descripción. Nada de "aprobado por X" ni resultados garantizados si no están declarados.
- STAGE: ajustá el nivel de explicación al stage del avatar (problem-aware explica más el problema; solution/product-aware va más directo a diferenciación y oferta).
- Duración objetivo: la del original (estimala de la transcripción). Si el original es >60s, comprimí a 30-45s manteniendo los beats esenciales.

HOOKS ALTERNATIVOS: 3 primeras frases DISTINTAS para testear — cada una ataca desde otro ángulo (dolor directo / curiosidad / social proof), pero todas compatibles con el mismo guion (reemplazan solo la apertura).`;

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
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

function parseJSONFromClaude(text) {
  let jsonStr = (text || '').trim();
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) jsonStr = match[1];
  return JSON.parse(jsonStr);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  const { transcript, idioma, producto, notas } = await readBody(req);
  if (!transcript || String(transcript).trim().length < 20) {
    return respondJSON(res, 400, { error: 'Transcripción vacía o demasiado corta para adaptar.' });
  }
  if (!producto?.nombre) {
    return respondJSON(res, 400, { error: 'Falta el producto (nombre como mínimo).' });
  }

  const productCtx = [
    `Producto: ${producto.nombre}`,
    producto.descripcion ? `Descripción: ${String(producto.descripcion).slice(0, 600)}` : '',
    producto.stage ? `Stage del avatar: ${producto.stage}` : '',
    producto.avatar ? `Avatar:\n${String(producto.avatar).slice(0, 1500)}` : '',
    producto.research ? `Research (mercado, dolores, lenguaje del avatar):\n${String(producto.research).slice(0, 3000)}` : '',
    producto.ofertasReales
      ? `OFERTAS / PRECIOS REALES (los ÚNICOS que podés mencionar):\n${String(producto.ofertasReales).slice(0, 800)}`
      : 'SIN OFERTAS DECLARADAS — cerrá con CTA sin precio, no inventes descuentos.',
    notas ? `Notas extra del user para esta adaptación: ${String(notas).slice(0, 500)}` : '',
  ].filter(Boolean).join('\n\n');

  const userPrompt = `# Producto del cliente
${productCtx}

# Transcripción del video ad de la competencia${idioma ? ` (idioma detectado: ${idioma})` : ''}
"""
${String(transcript).slice(0, 8000)}
"""

Devolvé el JSON pedido.`;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 3500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) return respondJSON(res, 502, { error: 'Claude no devolvió texto' });

    let parsed;
    try {
      parsed = parseJSONFromClaude(textBlock.text);
    } catch {
      // Si el JSON vino roto, devolvemos el texto crudo como guion para no
      // perder el trabajo (el user igual puede copiarlo).
      parsed = { traduccion: '', guion: textBlock.text.slice(0, 6000), hooksAlternativos: [], notasEditor: '' };
    }
    const costUSD = anthropicCost(resp.usage, MODEL);
    return respondJSON(res, 200, {
      traduccion: parsed.traduccion || '',
      estructuraDetectada: parsed.estructuraDetectada || '',
      guion: parsed.guion || '',
      hooksAlternativos: Array.isArray(parsed.hooksAlternativos) ? parsed.hooksAlternativos.slice(0, 5) : [],
      notasEditor: parsed.notasEditor || '',
      costUSD: Math.round(costUSD * 10000) / 10000,
      cost: { anthropic: costUSD },
    });
  } catch (err) {
    return respondJSON(res, 502, { error: `Adaptación falló: ${err.message}` });
  }
}
