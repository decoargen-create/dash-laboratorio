// Adapta un ad de "inspiración" (de cualquier rubro) al producto actual.
// Genera 2-3 ideas creativas que tomen la ESTÉTICA visual + estructura
// compositiva del ad inspiración, pero aplicadas al producto del user.
//
// Diferencia con generate-ideas: este endpoint trabaja sobre UN solo ad
// fuente y prioriza adaptación visual, no análisis de competencia.
//
// POST /api/marketing/adapt-inspiracion
// Body: {
//   producto: { nombre, descripcion?, landingUrl?, research?, avatar?, activoVisual? },
//   inspiracion: {
//     brandNombre: string,
//     ad: {
//       id, headline, body, imageUrls, snapshotUrl, daysRunning, ...
//     }
//   }
// }
//
// Response: {
//   ideas: [ { titulo, hook, descripcionImagen, promptGeneradorImagen,
//              textoEnImagen, copyPostMeta, formato, estiloVisual,
//              razonamiento }, ... ],
//   model, generatedAt, cost
// }

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Sos un director de arte + copywriter argentino porteño. Recibís UN estático de inspiración (puede ser de cualquier rubro — bebidas, ropa, tech, comida) y tenés que ADAPTAR su estética y estructura compositiva al producto del cliente.

REGLAS:
1. **Conservás la ESTÉTICA, NO el ángulo** — la paleta, composición, tipografía, mood, ritmo visual. NO el ángulo argumentativo del original.
2. **Aplicás al producto del cliente** — el resultado tiene que sentirse del producto del cliente, no de la marca inspiración.
3. **Tono PORTEÑO obligatorio** — vos/tuyo, modismos argentinos (bancar, posta, quilombo, viste, mirá, che). NUNCA tú/tienes/puedes/genial/mola.
4. Generá 2-3 variaciones (mínimo 2, máximo 3) — cada una explora una versión diferente de la adaptación.
5. Cada idea es un static (no video) — pensá composición fija.
6. **promptGeneradorImagen** en INGLÉS, listo para Nano Banana / Midjourney. Cerralo siempre con "1:1 square composition, photorealistic, commercial ad quality".
7. **textoEnImagen** detallado: layout, jerarquía tipográfica, qué dice cada bloque (en porteño).
8. **copyPostMeta** corto, en porteño, pensado como caption del feed.
9. **razonamiento** explica QUÉ tomaste del ad inspiración (paleta, composición, hook structure, etc.) y CÓMO lo adaptaste.

OUTPUT: JSON puro, sin \`\`\` wrappers, sin texto antes ni después.

Schema:
{
  "ideas": [
    {
      "titulo": "string corto (3-6 palabras)",
      "hook": "string en porteño, max 12 palabras",
      "formato": "static",
      "estiloVisual": "categoría concreta",
      "descripcionImagen": "string en español argento, detallada",
      "promptGeneradorImagen": "string en inglés",
      "textoEnImagen": "string con layout + jerarquía",
      "copyPostMeta": "string en porteño, 100-300 chars",
      "razonamiento": "qué tomaste del ad inspiración y cómo lo adaptaste"
    }
  ]
}`;

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
  const { producto, inspiracion } = body || {};
  if (!producto?.nombre) return respondJSON(res, 400, { error: 'Falta producto.nombre' });
  if (!inspiracion?.ad) return respondJSON(res, 400, { error: 'Falta inspiracion.ad' });

  const ad = inspiracion.ad;
  const imageUrl = ad.imageUrls?.[0];

  // Armamos el contexto del producto.
  const productoCtx = [
    `## PRODUCTO DEL CLIENTE`,
    `Nombre: ${producto.nombre}`,
    producto.descripcion ? `Descripción: ${producto.descripcion}` : null,
    producto.landingUrl ? `Landing: ${producto.landingUrl}` : null,
    producto.activoVisual?.descripcion ? `Activo visual icónico: ${producto.activoVisual.descripcion}` : null,
    producto.research ? `\nResearch:\n${String(producto.research).slice(0, 3000)}` : null,
    producto.avatar ? `\nAvatar:\n${String(producto.avatar).slice(0, 2000)}` : null,
  ].filter(Boolean).join('\n');

  const inspiracionCtx = [
    `## AD DE INSPIRACIÓN`,
    `Marca: ${inspiracion.brandNombre}`,
    `Headline: ${ad.headline || '(sin headline)'}`,
    `Body: ${(ad.body || '').slice(0, 500) || '(sin body)'}`,
    ad.daysRunning ? `Días corriendo: ${ad.daysRunning}` : null,
    ad.snapshotUrl ? `Link Ad Library: ${ad.snapshotUrl}` : null,
  ].filter(Boolean).join('\n');

  // Si tenemos image URL, la mandamos como bloque de imagen para que
  // Claude la analice visualmente (paleta, composición, mood).
  const userContent = [];
  if (imageUrl) {
    userContent.push({
      type: 'image',
      source: { type: 'url', url: imageUrl },
    });
  }
  userContent.push({
    type: 'text',
    text: `${productoCtx}\n\n${inspiracionCtx}\n\nGenerá 2-3 adaptaciones del ad de inspiración al producto. Devolvé JSON.`,
  });

  const client = new Anthropic({ apiKey });
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('Claude no devolvió texto');

    let jsonStr = textBlock.text.trim();
    const m = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) jsonStr = m[1];

    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch (err) {
      throw new Error(`JSON inválido: ${err.message}. Raw: ${jsonStr.slice(0, 200)}`);
    }

    const ideas = Array.isArray(parsed?.ideas) ? parsed.ideas : [];
    if (ideas.length === 0) throw new Error('El modelo no devolvió ideas');

    return respondJSON(res, 200, {
      ideas: ideas.map(i => ({
        titulo: String(i.titulo || '').slice(0, 200),
        hook: String(i.hook || '').slice(0, 300),
        formato: 'static',
        estiloVisual: String(i.estiloVisual || '').slice(0, 200),
        descripcionImagen: String(i.descripcionImagen || '').slice(0, 2500),
        promptGeneradorImagen: String(i.promptGeneradorImagen || '').slice(0, 2500),
        textoEnImagen: String(i.textoEnImagen || '').slice(0, 2000),
        copyPostMeta: String(i.copyPostMeta || '').slice(0, 3000),
        razonamiento: String(i.razonamiento || '').slice(0, 1000),
      })),
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost: { anthropic: anthropicCost(resp.usage, MODEL) },
    });
  } catch (err) {
    console.error('adapt-inspiracion error:', err);
    return respondJSON(res, 502, { error: err.message || 'Error al adaptar' });
  }
}
