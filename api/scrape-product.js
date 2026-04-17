// Endpoint que, dada una URL de landing (Tiendanube / Shopify / etc.) y el
// nombre del proveedor, scrapea el producto y devuelve los datos listos para
// el módulo de Bocetos:
//   { nombre, imagen (data URL base64), sku }
//
// Flujo:
//   1. fetch(url) server-side → HTML
//   2. Extrae og:title, og:image, og:description con regex (no metemos un
//      parser de HTML completo para mantener esto liviano en Vercel).
//   3. fetch(imagen) → base64 (evita CORS y HTTPS mixto en el front).
//   4. Llama a Claude para generar SKU siguiendo la nomenclatura del usuario.
//   5. Devuelve todo junto.
//
// Uso: POST /api/scrape-product { url, proveedorNombre }

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_SKU = `Sos el extractor de datos de producto del sistema Senydrop. Recibís el nombre de un producto, la descripción, el proveedor y un fragmento del HTML de la landing. Devolvés: SKU siguiendo una nomenclatura específica + nombre limpio + variantes detectadas.

=== NOMENCLATURA DEL SKU ===
FORMATO: PF-{iniciales_proveedor}-{palabras_clave_mayusculas}

REGLAS:
- Prefijo fijo: PF-
- Iniciales: primera letra del nombre + primera letra del apellido del proveedor (ej: "Agustin Samara" → AS, "Lionel Mansilla" → LM).
- Palabras clave: 2 a 4 palabras del nombre, SIN conectores ("de", "para", "y", "al", "con", "sin", "la", "el", "los", "las", "un", "una", "del"), SIN marketing ("Premium", "Pro", "Plus", "Original", "Control"), SIN unidades genéricas ("unidades", "pack").
- Singularizá sustantivos obvios: "Alicates" → "ALICATE", "Paños" → "PAÑOS", "Productos" → "PRODUCTO".
- Truncá palabras muy largas a 6-7 letras: "MICROFIBRA" → "MICROF", "ORGANIZADOR" → "ORGANIZ".
- Mantené multiplicadores: "x3", "x8" → al FINAL, uppercase: "-X3", "-X8".
- Todo uppercase. Sin tildes excepto Ñ. Separador: guion medio (-). Longitud 20-40 chars.

EJEMPLOS DE SKU:
- "Agustin Samara" + "Protector de patas para sillas y muebles x8 unidades" → PF-AS-PROTECTOR-PATAS-SILLA
- "Agustin Samara" + "Mopa de MicroFibra Premium" → PF-AS-MOPA-MICROFIBRA
- "Agustin Samara" + "Paños Microfibra Premium x3" → PF-AS-PAÑOS-MICROF-X3
- "Lionel Mansilla" + "Barberina Metabo Control" → PF-LM-BARBERINA-METABO
- "Valentin Aguiar" + "Alicates para quitar clips de panel" → PF-VA-ALICATE-QUITACLIP

=== EXTRACCIÓN DE VARIANTES ===
Buscá en el HTML los selectores, opciones o listas que indiquen variantes del producto. Típicamente aparecen como:
- <select name="color"> o <option>Rojo</option>
- Botones tipo "Talle XS / S / M / L"
- Listas de "Color: Negro / Blanco / Azul"
- Schema JSON-LD con "variesBy" o "offers"
- Shopify: window.product.variants o tag "data-option-name"
- Tiendanube: "ns.product.variants" o "data-variant"

Para cada variante detectada, devolvé un objeto:
- tipo: "color" | "talle" | "medida" | "sabor" | "material" | "modelo" | "otro"
- valor: el texto visible que aparece en la landing (ej: "Rojo", "XL", "500ml")

Si no encontrás variantes claras, devolvé variantes: [].
NO inventes variantes que no estén en el HTML.

=== SALIDA ===
Devolvé JSON ESTRICTO:
{
  "sku": "PF-XX-KEYWORDS",
  "nombreLimpio": "Nombre del producto sin marketing extra. Si el nombre original ya está bien, devolvelo tal cual.",
  "variantes": [
    { "tipo": "color", "valor": "Rojo" },
    { "tipo": "color", "valor": "Negro" },
    { "tipo": "talle", "valor": "M" }
  ]
}
NO markdown. SOLO el JSON puro.`;

const MAX_IMG_BYTES = 1024 * 1024 * 2; // 2MB para poder bajar fotos grandes, después front las comprime si hace falta.
const FETCH_TIMEOUT_MS = 12000;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.end(JSON.stringify(payload));
}

// Fetch con timeout manual porque fetch del runtime de Vercel no siempre
// respeta AbortController en todos los runtimes.
async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Extrae atributo `content` de un meta tag por property o name, buscando en
// orden de prioridad (og:* > twitter:* > name genérico).
function extractMeta(html, keys) {
  for (const key of keys) {
    // Soportamos ambos órdenes: property="..." content="..." y content="..." property="..."
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return m[1].trim();
    }
  }
  return null;
}

function extractTitleTag(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

// Convierte iniciales del proveedor a dos letras: "Agustin Samara" → "AS".
// Si hay una sola palabra, devuelve las dos primeras letras.
function iniciales(nombre) {
  const parts = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'XX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const body = await readBody(req);
  const { url, proveedorNombre } = body || {};

  if (!url || typeof url !== 'string') return respondJSON(res, 400, { error: 'Falta "url"' });
  if (!proveedorNombre || typeof proveedorNombre !== 'string') return respondJSON(res, 400, { error: 'Falta "proveedorNombre"' });

  let parsedUrl;
  try { parsedUrl = new URL(url); }
  catch { return respondJSON(res, 400, { error: 'URL inválida' }); }

  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return respondJSON(res, 400, { error: 'Sólo se aceptan URLs http(s)' });
  }

  // Paso 1: bajar el HTML de la landing.
  let html;
  try {
    const resp = await fetchWithTimeout(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SenydropBocetos/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) return respondJSON(res, 502, { error: `La landing respondió ${resp.status}` });
    html = await resp.text();
  } catch (err) {
    return respondJSON(res, 502, { error: `No pude acceder a la URL: ${err.message || err}` });
  }

  // Paso 2: extraer meta tags.
  const ogTitle = extractMeta(html, ['og:title', 'twitter:title']);
  const ogImage = extractMeta(html, ['og:image', 'og:image:secure_url', 'twitter:image']);
  const ogDesc = extractMeta(html, ['og:description', 'twitter:description', 'description']);
  const fallbackTitle = extractTitleTag(html);
  const titulo = ogTitle || fallbackTitle || '';

  if (!titulo) {
    return respondJSON(res, 422, { error: 'No pude detectar el título del producto en la landing (¿tiene og:title?)' });
  }

  // Paso 3: bajar la imagen y convertir a base64 (si hay).
  let imagenDataUrl = null;
  if (ogImage) {
    try {
      const imgUrl = new URL(ogImage, parsedUrl).toString(); // resuelve URLs relativas.
      const imgResp = await fetchWithTimeout(imgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SenydropBocetos/1.0)' },
      });
      if (imgResp.ok) {
        const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
        const buf = await imgResp.arrayBuffer();
        if (buf.byteLength > 0 && buf.byteLength <= MAX_IMG_BYTES) {
          const b64 = Buffer.from(buf).toString('base64');
          imagenDataUrl = `data:${contentType};base64,${b64}`;
        }
      }
    } catch {
      // Si la imagen falla, seguimos sin ella — el usuario puede subirla a mano.
    }
  }

  // Paso 4: generar SKU + detectar variantes con Claude. Si falla o no hay key,
  // fallback local (sólo SKU, sin variantes).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let sku = null;
  let nombreLimpio = titulo;
  let variantes = [];

  // Limpiamos el HTML: sacamos scripts/styles/comentarios y recortamos a 12KB.
  // Esto es más que suficiente para que Claude encuentre selects/options y
  // datos de schema.org sin quemarnos tokens con CSS inline y trackers.
  const htmlLimpio = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 12000);

  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const prompt = `Proveedor: ${proveedorNombre}
Nombre del producto: ${titulo}
${ogDesc ? `Descripción: ${ogDesc.slice(0, 400)}` : ''}

HTML limpio (primeros 12KB):
${htmlLimpio}

Generá el JSON con sku, nombreLimpio y variantes detectadas.`;
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_SKU, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt }],
      });
      const text = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.sku) sku = parsed.sku;
      if (parsed.nombreLimpio) nombreLimpio = parsed.nombreLimpio;
      if (Array.isArray(parsed.variantes)) {
        // Sanitizamos: máx 20 variantes, valores recortados a 40 chars.
        variantes = parsed.variantes
          .filter(v => v && typeof v.valor === 'string' && v.valor.trim())
          .slice(0, 20)
          .map(v => ({
            tipo: String(v.tipo || 'otro').toLowerCase().slice(0, 20),
            valor: String(v.valor).trim().slice(0, 40),
          }));
      }
    } catch (err) {
      console.error('scrape-product: fallo Claude, uso fallback', err?.message);
    }
  }

  // Fallback local: SKU simple con regex. Se usa cuando Claude no anduvo o la
  // key no está configurada.
  if (!sku) {
    const stopwords = new Set(['de','para','y','al','con','sin','la','el','los','las','un','una','del','a','en','por','premium','pro','plus','unidades','pack']);
    const words = String(titulo)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes salvo...
      .replace(/[^A-Za-zÑñ0-9\sxX]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w && !stopwords.has(w.toLowerCase()));
    const keywords = words.slice(0, 3).map(w => {
      if (/^x\d+$/i.test(w)) return w.toUpperCase();
      return w.toUpperCase().slice(0, 8);
    });
    sku = `PF-${iniciales(proveedorNombre)}-${keywords.join('-')}`;
  }

  return respondJSON(res, 200, {
    nombre: nombreLimpio,
    nombreOriginal: titulo,
    imagen: imagenDataUrl,
    imagenUrl: ogImage || null,
    sku,
    variantes,
    descripcion: ogDesc || null,
  });
}
