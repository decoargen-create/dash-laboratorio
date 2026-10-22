// Detecta con IA el formato físico de un producto y sus medidas reales,
// leyendo su landing (texto + foto principal). Lo usa el alta de producto
// (Estáticos → Nueva carga, paso "Formato") para completarlo solo.
//
// POST { nombre, landingUrl } → { formato, medidas, palancas, imagenUrl, motivo, cost }
// `formato` es siempre una de las claves de FORMATOS (las mismas del select
// del front) o '' si no se pudo decidir.

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';
import { safeFetch, requireAuth } from './_security.js';
import { getUserIdFromAuth } from './_supabase-server.js';

const MODEL = 'claude-opus-5-5';

// Palancas de oferta que se buscan en la landing (las mismas que el paso
// "Ofertas" del alta en src/Arranque.jsx).
const PALANCAS = {
  precio: 'Precio (con moneda)',
  descuento: 'Descuento o % OFF',
  combo: '2x1, 3x2 o combo',
  cuotas: 'Cuotas sin interés',
  envio: 'Envío gratis',
  garantia: 'Garantía o devolución',
  regalo: 'Regalo con la compra',
  urgencia: 'Urgencia o stock limitado',
};

// Las mismas claves que FORMATOS_PRODUCTO en src/Arranque.jsx.
const FORMATOS = {
  gomitas: 'Gomitas / gummies',
  'cápsulas': 'Cápsulas / softgels / pastillas',
  comprimidos: 'Comprimidos / tabletas',
  polvo: 'Polvo (mix)',
  gotas: 'Gotas / liquid drops',
  shot: 'Shot líquido',
  sachet: 'Sachet / stick individual',
  'sérum': 'Sérum',
  crema: 'Crema / loción / emulsión',
  aceite: 'Aceite',
  'bálsamo': 'Bálsamo',
  spray: 'Spray',
  stick: 'Stick / barra',
  mascarilla: 'Mascarilla / máscara',
  parches: 'Parches',
  cepillo: 'Cepillo / masajeador / gua sha',
  gadget: 'Gadget / dispositivo',
  herramienta: 'Herramienta / accesorio',
  textil: 'Textil / prenda',
  hogar: 'Hogar / organizador',
  jardin: 'Jardín / exterior (luces, deco)',
  otros: 'Otros',
};

function respondJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

const meta = (html, prop) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  return (html.match(re) || html.match(re2) || [])[1] || '';
};

// Texto legible de la landing: título, descripción y el cuerpo sin scripts ni
// estilos, recortado (la descripción del producto suele estar arriba).
function textoDeLanding(html) {
  const limpio = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.slice(0, 9000);
}

async function imagenBase64(url) {
  try {
    const r = await safeFetch(url, {}, { timeoutMs: 8000 });
    if (!r.ok) return null;
    const tipo = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(tipo)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4.5 * 1024 * 1024) return null;
    return { media_type: tipo, data: buf.toString('base64') };
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  const userId = await requireAuth(req, res, getUserIdFromAuth);
  if (!userId) return;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const body = await readBody(req);
  const nombre = String(body.nombre || '').trim().slice(0, 200);
  const landingUrl = String(body.landingUrl || '').trim();
  if (!nombre && !landingUrl) return respondJSON(res, 400, { error: 'Falta el nombre o la URL de la landing' });

  // Leer la landing (si no se puede, se decide solo con el nombre).
  let titulo = '', descripcion = '', texto = '', imagen = null, imagenUrl = '';
  if (/^https?:\/\//i.test(landingUrl)) {
    try {
      const r = await safeFetch(landingUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Kombialo)' } }, { timeoutMs: 10000 });
      if (r.ok) {
        const html = await r.text();
        titulo = meta(html, 'og:title') || (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
        descripcion = meta(html, 'og:description') || meta(html, 'description');
        texto = textoDeLanding(html);
        const og = meta(html, 'og:image');
        if (og) { imagenUrl = new URL(og, landingUrl).href; imagen = await imagenBase64(imagenUrl); }
      }
    } catch { /* landing caída o bloqueada: seguimos con el nombre */ }
  }

  const lista = Object.entries(FORMATOS).map(([k, v]) => `- "${k}": ${v}`).join('\n');
  const prompt = `Producto: ${nombre || '(sin nombre)'}
Landing: ${landingUrl || '(sin landing)'}
Título de la página: ${titulo || '-'}
Descripción: ${descripcion || '-'}
Texto de la página (recortado):
${texto || '-'}

Decidí en qué FORMATO FÍSICO viene este producto, eligiendo UNA clave de esta lista:
${lista}

Reglas:
- Basate en el producto que se vende (la foto, si está, manda), no en lo que se promete.
- Si la página no alcanza para saberlo, devolvé formato "" en vez de adivinar.
- "medidas": el tamaño real del producto si la página lo dice (alto, largo, diámetro, ml, g, cm), en una frase corta en español rioplatense y comparándolo con algo cotidiano si se puede (ej: "13 cm de largo, entra en la palma de la mano"). Si la página no lo dice, "".
- "palancas": para cada palanca de venta, si la página la muestra de verdad ("tiene") y el texto exacto a usar en un anuncio, corto ("texto", ej: "3 cuotas sin interés", "$29.900", "Envío gratis a todo el país"). Palancas: ${Object.entries(PALANCAS).map(([k, v]) => `${k} (${v})`).join(', ')}. Si no aparece, tiene=false y texto="". No inventes.
- "motivo": una frase corta en español explicando qué te hizo elegir ese formato.`;

  const content = [];
  if (imagen) content.push({ type: 'image', source: { type: 'base64', media_type: imagen.media_type, data: imagen.data } });
  content.push({ type: 'text', text: prompt });

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Clasificar y extraer: no hace falta pensar mucho.
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              formato: { type: 'string', enum: ['', ...Object.keys(FORMATOS)] },
              medidas: { type: 'string' },
              palancas: {
                type: 'object',
                properties: Object.fromEntries(Object.keys(PALANCAS).map(k => [k, {
                  type: 'object',
                  properties: { tiene: { type: 'boolean' }, texto: { type: 'string' } },
                  required: ['tiene', 'texto'],
                  additionalProperties: false,
                }])),
                required: Object.keys(PALANCAS),
                additionalProperties: false,
              },
              motivo: { type: 'string' },
            },
            required: ['formato', 'medidas', 'palancas', 'motivo'],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content }],
    });
    if (resp.stop_reason === 'refusal') return respondJSON(res, 422, { error: 'La IA no pudo analizar este producto.' });
    const txt = resp.content.find(b => b.type === 'text')?.text || '{}';
    let out = {};
    try { out = JSON.parse(txt); } catch { out = {}; }
    const formato = Object.prototype.hasOwnProperty.call(FORMATOS, out.formato) ? out.formato : '';
    const costUSD = anthropicCost(resp.usage, MODEL);
    return respondJSON(res, 200, {
      formato,
      medidas: String(out.medidas || '').slice(0, 200),
      palancas: Object.fromEntries(Object.keys(PALANCAS).map(k => {
        const v = out.palancas?.[k] || {};
        return [k, { tiene: !!v.tiene, texto: String(v.texto || '').slice(0, 120) }];
      })),
      imagenUrl,
      motivo: String(out.motivo || '').slice(0, 300),
      leyoLanding: !!texto,
      vioFoto: !!imagen,
      cost: { anthropic: costUSD },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return respondJSON(res, 429, { error: 'La IA está ocupada: probá de nuevo en unos segundos.' });
    if (err instanceof Anthropic.APIError) return respondJSON(res, 502, { error: `La IA respondió con error (${err.status}).` });
    return respondJSON(res, 502, { error: err.message || 'No se pudo analizar el producto.' });
  }
}
