// Endpoint que scrapea productos de landings (Tiendanube / Shopify / etc.)
// y devuelve datos listos para el módulo de Bocetos Senydrop.
//
// Tres modos de uso:
//
//   1. Single (back-compat):
//      { url: "https://...", clienteNombre: "Agustin Samara" }
//      → devuelve { productos: [ { nombre, imagen, sku, variantes, ... } ] }
//
//   2. Batch (varias URLs explícitas):
//      { urls: ["https://...", "https://..."], clienteNombre: "..." }
//      → scrapea cada una en paralelo, devuelve { productos: [...] }
//
//   3. Collection (una URL apuntando a una página con muchos productos):
//      { collectionUrl: "https://tienda.com/productos/...", clienteNombre: "..." }
//      → detecta links a productos en el HTML, los scrapea en paralelo.
//
// Internamente: extrae og:title / og:image / og:description, baja la imagen
// a base64, y usa Claude (Haiku 4.5) para generar SKU + detectar variantes.
//
// Compatibilidad: sigue aceptando `proveedorNombre` como alias de `clienteNombre`
// para no romper clientes viejos.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_SKU = `Sos el extractor de datos de producto del sistema Senydrop. Recibís el título que levantó el scraper, la descripción, el cliente y un fragmento del HTML de la landing. Devolvés: un nombre de producto técnico y limpio + SKU + variantes detectadas.

=== IMPORTANTE: PRIORIDAD PARA EL NOMBRE DEL PRODUCTO ===
El título que te llega viene de og:title, pero muchas landings ponen ahí el NOMBRE DE LA TIENDA (ej: "Main Lab", "Mi Tienda Online", "Shopify Store") en vez del producto. Vos tenés que ANALIZAR el HTML entero y detectar el verdadero nombre del producto, en este orden de prioridad:

  1. JSON-LD: buscá <script type="application/ld+json"> con "@type":"Product" y tomá su "name".
  2. <h1> de la página (casi siempre tiene el nombre real del producto).
  3. Atributo "data-product-name", "product-title" o similar.
  4. El título de og:title SOLO si parece un nombre de producto (2+ palabras, descriptivo).
  5. <title> de la página (último recurso, sacando el sufijo " - NombreTienda").

SEÑALES de que un título NO es el producto (y tenés que ignorarlo):
  - Tiene menos de 3 palabras Y es igual/parecido al nombre del dominio/URL
  - Aparece frases tipo "Tienda Online", "Shop", "E-commerce"
  - Es una sola palabra genérica ("Home", "Productos", "Inicio")

Si detectás que el título original era el nombre de la tienda, reemplazalo por el real del producto.
El nombre final tiene que ser TÉCNICO y DESCRIPTIVO: "Mopa de Microfibra Premium 360°", "Protector Antideslizante para Patas de Silla x8", no "Promoción" ni "Nuevo producto".

=== NOMENCLATURA DEL SKU ===
FORMATO: PF-{iniciales_cliente}-{palabras_clave_mayusculas}

REGLAS:
- Prefijo fijo: PF-
- Iniciales: primera letra del nombre + primera letra del apellido del cliente (ej: "Agustin Samara" → AS, "Lionel Mansilla" → LM).
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
Buscá en el HTML los selectores, opciones o listas que indiquen variantes:
- <select name="color"> / <option>
- Botones "Talle XS / S / M / L"
- Schema JSON-LD con "variesBy" o "offers"
- Shopify: window.product.variants, data-option-name
- Tiendanube: ns.product.variants, data-variant

Cada variante:
- tipo: "color" | "talle" | "medida" | "sabor" | "material" | "modelo" | "otro"
- valor: texto visible (ej: "Rojo", "XL", "500ml")

Si no hay variantes claras, devolvé variantes: []. NO inventes variantes.

=== SALIDA ===
Devolvé JSON ESTRICTO:
{
  "sku": "PF-XX-KEYWORDS",
  "nombreLimpio": "Nombre técnico y descriptivo del producto detectado en la página. Si el título que te llegó era el nombre de la tienda, reemplazalo acá por el real.",
  "tituloOriginalEraDeTienda": true,
  "variantes": [ { "tipo": "color", "valor": "Rojo" } ]
}
NO markdown. SOLO el JSON puro.`;

const MAX_IMG_BYTES = 1024 * 1024 * 2;
const FETCH_TIMEOUT_MS = 12000;
const MAX_BATCH_SIZE = 25; // límite por request para no matar Vercel ni la API key.

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

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractMeta(html, keys) {
  for (const key of keys) {
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

function iniciales(nombre) {
  const parts = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'XX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Detecta si una URL apunta a una colección/listado de productos viendo si
// el HTML tiene muchos links a /products/{slug} o /productos/{slug} distintos.
// Devuelve array de URLs únicas (absolutas) o null si parece ser un producto simple.
function extractProductLinksFromCollection(html, baseUrl) {
  // Patrones típicos de plataformas:
  //   Shopify:  /products/slug-producto
  //   Tiendanube: /productos/slug-producto
  //   Mercado Shops: similares
  const re = /href=["']([^"']*\/(?:products|productos)\/[a-zA-Z0-9._-]+[^"'#?]*)["']/gi;
  const seen = new Set();
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).toString().split('#')[0].split('?')[0];
      // Evitar links del tipo /products/ sin slug (listados) y duplicados.
      if (!abs.match(/\/(products|productos)\/[a-zA-Z0-9._-]+/)) continue;
      if (!seen.has(abs)) {
        seen.add(abs);
        results.push(abs);
      }
    } catch {}
  }
  return results;
}

// Scrapea UN producto y genera su JSON. Devuelve { ok, error?, data? }.
// `customInstructions` (opcional) son instrucciones del user para ajustar el
// comportamiento (se inyectan al prompt como contexto adicional).
async function scrapeSingleProduct(url, clienteNombre, apiKey, customInstructions) {
  let parsedUrl;
  try { parsedUrl = new URL(url); }
  catch { return { ok: false, error: 'URL inválida', url }; }

  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return { ok: false, error: 'Sólo http(s)', url };
  }

  let html;
  try {
    const resp = await fetchWithTimeout(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SenydropBocetos/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}`, url };
    html = await resp.text();
  } catch (err) {
    return { ok: false, error: err.message || String(err), url };
  }

  const ogTitle = extractMeta(html, ['og:title', 'twitter:title']);
  const ogImage = extractMeta(html, ['og:image', 'og:image:secure_url', 'twitter:image']);
  const ogDesc = extractMeta(html, ['og:description', 'twitter:description', 'description']);
  const fallbackTitle = extractTitleTag(html);
  const titulo = ogTitle || fallbackTitle || '';

  if (!titulo) return { ok: false, error: 'Sin og:title detectable', url };

  let imagenDataUrl = null;
  if (ogImage) {
    try {
      const imgUrl = new URL(ogImage, parsedUrl).toString();
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
    } catch {}
  }

  const htmlLimpio = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 12000);

  let sku = null;
  let nombreLimpio = titulo;
  let variantes = [];
  let tituloOriginalEraDeTienda = false;

  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const instruccionesUser = (customInstructions || '').trim();
      const prompt = `Cliente: ${clienteNombre}
Título detectado por scraper (puede ser de tienda): ${titulo}
${ogDesc ? `Descripción: ${ogDesc.slice(0, 400)}` : ''}
URL: ${url}

HTML limpio (primeros 12KB):
${htmlLimpio}
${instruccionesUser ? `\n=== INSTRUCCIONES ADICIONALES DEL USER (priorizalas sobre defaults) ===\n${instruccionesUser.slice(0, 1500)}\n` : ''}
Generá el JSON con sku, nombreLimpio (técnico y real, no el de la tienda) y variantes detectadas.`;
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
      if (typeof parsed.tituloOriginalEraDeTienda === 'boolean') tituloOriginalEraDeTienda = parsed.tituloOriginalEraDeTienda;
      if (Array.isArray(parsed.variantes)) {
        variantes = parsed.variantes
          .filter(v => v && typeof v.valor === 'string' && v.valor.trim())
          .slice(0, 20)
          .map(v => ({
            tipo: String(v.tipo || 'otro').toLowerCase().slice(0, 20),
            valor: String(v.valor).trim().slice(0, 40),
          }));
      }
    } catch (err) {
      console.error('scrapeSingleProduct: fallo Claude', err?.message);
    }
  }

  if (!sku) {
    const stopwords = new Set(['de','para','y','al','con','sin','la','el','los','las','un','una','del','a','en','por','premium','pro','plus','unidades','pack']);
    const words = String(titulo)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-zÑñ0-9\sxX]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w && !stopwords.has(w.toLowerCase()));
    const keywords = words.slice(0, 3).map(w => {
      if (/^x\d+$/i.test(w)) return w.toUpperCase();
      return w.toUpperCase().slice(0, 8);
    });
    sku = `PF-${iniciales(clienteNombre)}-${keywords.join('-')}`;
  }

  return {
    ok: true,
    data: {
      url,
      nombre: nombreLimpio,
      nombreOriginal: titulo,
      tituloOriginalEraDeTienda,
      imagen: imagenDataUrl,
      imagenUrl: ogImage || null,
      sku,
      variantes,
      descripcion: ogDesc || null,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const body = await readBody(req);
  // Compat: aceptamos cliente o proveedor, url o urls, collectionUrl.
  const clienteNombre = body.clienteNombre || body.proveedorNombre;
  const singleUrl = body.url;
  const batchUrls = Array.isArray(body.urls) ? body.urls : null;
  const collectionUrl = body.collectionUrl;
  const customInstructions = typeof body.customInstructions === 'string' ? body.customInstructions : '';

  if (!clienteNombre || typeof clienteNombre !== 'string') {
    return respondJSON(res, 400, { error: 'Falta "clienteNombre"' });
  }
  if (!singleUrl && !batchUrls && !collectionUrl) {
    return respondJSON(res, 400, { error: 'Enviá "url", "urls" o "collectionUrl"' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Resolver la lista final de URLs a scrapear.
  let urlsToScrape = [];
  let expandedFromCollection = false;

  if (collectionUrl) {
    // Bajamos la colección y extraemos links a productos.
    try {
      const resp = await fetchWithTimeout(collectionUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SenydropBocetos/1.0)' },
      });
      if (!resp.ok) return respondJSON(res, 502, { error: `La colección respondió HTTP ${resp.status}` });
      const html = await resp.text();
      urlsToScrape = extractProductLinksFromCollection(html, collectionUrl);
      expandedFromCollection = true;
      if (urlsToScrape.length === 0) {
        return respondJSON(res, 422, { error: 'No encontré links a productos en esa página (busco /products/ o /productos/)' });
      }
    } catch (err) {
      return respondJSON(res, 502, { error: `No pude acceder a la colección: ${err.message}` });
    }
  } else if (batchUrls) {
    urlsToScrape = batchUrls.filter(u => typeof u === 'string' && u.trim()).map(u => u.trim());
  } else {
    urlsToScrape = [singleUrl];
  }

  if (urlsToScrape.length === 0) {
    return respondJSON(res, 400, { error: 'No hay URLs válidas para scrapear' });
  }
  if (urlsToScrape.length > MAX_BATCH_SIZE) {
    // Recortamos y avisamos por logs — el front puede paginar si necesita más.
    console.warn(`scrape-product: recorto batch de ${urlsToScrape.length} a ${MAX_BATCH_SIZE}`);
    urlsToScrape = urlsToScrape.slice(0, MAX_BATCH_SIZE);
  }

  // Scrapeamos en paralelo (con un poco de concurrencia limitada no haría
  // falta porque Vercel ya tiene límites, y además son pocos).
  const results = await Promise.all(
    urlsToScrape.map(u => scrapeSingleProduct(u, clienteNombre, apiKey, customInstructions))
  );

  const productos = results.filter(r => r.ok).map(r => r.data);
  const errores = results.filter(r => !r.ok).map(r => ({ url: r.url, error: r.error }));

  return respondJSON(res, 200, {
    productos,
    errores,
    total: urlsToScrape.length,
    expandedFromCollection,
  });
}
