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

=== EVALUACIÓN DE LA IMAGEN (con visión) ===
Cuando te adjuntan la imagen real del producto, MIRALA con tu capacidad de visión y evaluá si va a ser difícil de procesar con un modelo automático de remoción de fondo. Marcala como riesgosa si VES alguno de estos casos:

- Tiene PERSONAS o manos sosteniendo el producto (el modelo puede recortar a la persona también).
- Es una ESCENA compleja (producto en ambiente, sobre una mesa con objetos, en un contexto de uso).
- Tiene TEXTO superpuesto grande (banners de descuento, logos, marca de agua).
- El producto está CORTADO por los bordes de la imagen.
- El producto se fusiona con el fondo (colores similares, baja contraste).
- Es un FOTOMONTAJE o collage de varios productos.

Si la imagen parece ser un producto limpio sobre fondo uniforme (blanco, gris, degradé suave), imagenRiesgosa: false.

=== SALIDA ===
Devolvé JSON ESTRICTO:
{
  "sku": "PF-XX-KEYWORDS",
  "nombreLimpio": "Nombre técnico y descriptivo del producto detectado en la página.",
  "tituloOriginalEraDeTienda": true,
  "variantes": [ { "tipo": "color", "valor": "Rojo" } ],
  "imagenRiesgosa": false,
  "imagenRiesgosaMotivo": "si imagenRiesgosa es true, explicalo en máx 80 chars (ej: 'persona sosteniendo el producto', 'escena con varios objetos', 'texto superpuesto')"
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

// Intenta bajar datos estructurados del producto si es Shopify: `/products/slug`
// tiene un endpoint `.json` con todo servido limpio (título, vendor, variantes
// con options, imágenes). Es 10x más confiable que parsear HTML.
async function tryShopifyJson(url) {
  try {
    const u = new URL(url);
    if (!u.pathname.match(/\/products\/[^/]+/)) return null;
    const jsonUrl = u.origin + u.pathname.split('?')[0].replace(/\/$/, '') + '.json';
    const resp = await fetchWithTimeout(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SenydropBocetos/1.0)',
        'Accept': 'application/json',
      },
    }, 8000);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    const data = await resp.json();
    if (!data?.product || !data.product.title) return null;
    return data.product;
  } catch { return null; }
}

// Extrae datos Product de JSON-LD (schema.org). Funciona bien en tiendas
// modernas (Tiendanube, Wordpress/Woo, varias plataformas).
function extractJsonLdProduct(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of matches) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const obj of arr) {
        const t = obj?.['@type'];
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return obj;
      }
    } catch {}
  }
  return null;
}

// Convierte variantes de Shopify (que vienen como combinaciones) en un array
// de { tipo, valor } único. Ej: si el producto tiene options [Color, Talle]
// con valores Rojo/Azul y M/L, devolvemos: [color:Rojo, color:Azul, talle:M, talle:L].
function variantesFromShopifyOptions(options) {
  if (!Array.isArray(options)) return [];
  const out = [];
  for (const opt of options) {
    if (!opt?.name) continue;
    const tipoRaw = String(opt.name).toLowerCase();
    const tipo = tipoRaw.includes('color') ? 'color'
      : tipoRaw.includes('talle') || tipoRaw.includes('size') ? 'talle'
      : tipoRaw.includes('medida') ? 'medida'
      : tipoRaw.includes('sabor') || tipoRaw.includes('flavor') ? 'sabor'
      : tipoRaw.includes('material') ? 'material'
      : tipoRaw.includes('modelo') || tipoRaw.includes('model') ? 'modelo'
      : 'otro';
    for (const v of (opt.values || [])) {
      const valor = String(v).trim();
      if (valor && !out.some(x => x.tipo === tipo && x.valor.toLowerCase() === valor.toLowerCase())) {
        out.push({ tipo, valor: valor.slice(0, 40) });
      }
    }
  }
  return out.slice(0, 20);
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

  // Paso 1a: probar Shopify JSON endpoint (la forma más confiable de sacar
  // datos estructurados cuando la tienda es Shopify).
  const shopifyProduct = await tryShopifyJson(url);

  // Paso 1b: bajar HTML. Incluso si tenemos Shopify JSON, queremos el HTML
  // para JSON-LD y otros datos complementarios. Con retry si el primer UA
  // se come un 403 (algunas tiendas bloquean bots obvios).
  let html;
  const uaPool = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (compatible; SenydropBocetos/1.0)',
  ];
  for (const ua of uaPool) {
    try {
      const resp = await fetchWithTimeout(parsedUrl.toString(), {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5',
        },
      });
      if (resp.ok) { html = await resp.text(); break; }
    } catch {}
  }
  if (!html) {
    // Si Shopify JSON sí respondió pero el HTML falló, podemos seguir con
    // sólo la info del JSON (suficiente para muchos casos).
    if (!shopifyProduct) return { ok: false, error: 'No pude acceder a la landing (HTTP 403 o timeout)', url };
    html = '';
  }

  // Paso 2: extraer metadata combinando Shopify > JSON-LD > og: > <title>.
  const ldProduct = html ? extractJsonLdProduct(html) : null;
  const ogTitle = html ? extractMeta(html, ['og:title', 'twitter:title']) : null;
  const ogImage = html ? extractMeta(html, ['og:image', 'og:image:secure_url', 'twitter:image']) : null;
  const ogDesc = html ? extractMeta(html, ['og:description', 'twitter:description', 'description']) : null;
  const fallbackTitle = html ? extractTitleTag(html) : null;

  const tituloShopify = shopifyProduct?.title || null;
  const tituloLd = ldProduct?.name || null;
  const imagenShopify = shopifyProduct?.images?.[0]?.src || null;
  const imagenLd = Array.isArray(ldProduct?.image) ? ldProduct.image[0] : ldProduct?.image || null;
  const descShopify = shopifyProduct?.body_html
    ? shopifyProduct.body_html.replace(/<[^>]+>/g, '').trim().slice(0, 400)
    : null;
  const descLd = ldProduct?.description || null;

  // Prioridad del título: Shopify > JSON-LD > og: > <title>.
  const titulo = tituloShopify || tituloLd || ogTitle || fallbackTitle || '';
  const descripcion = descShopify || descLd || ogDesc || null;
  const imagenPreferida = imagenShopify || imagenLd || ogImage || null;

  if (!titulo) return { ok: false, error: 'No pude detectar el título del producto', url };

  // Variantes estructuradas de Shopify (si las tenemos, evitamos que Claude
  // tenga que adivinarlas del HTML).
  const variantesShopify = shopifyProduct ? variantesFromShopifyOptions(shopifyProduct.options) : [];

  let imagenDataUrl = null;
  let imagenB64 = null;
  let imagenContentType = null;
  if (imagenPreferida) {
    try {
      const imgUrl = new URL(imagenPreferida, parsedUrl).toString();
      const imgResp = await fetchWithTimeout(imgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SenydropBocetos/1.0)' },
      });
      if (imgResp.ok) {
        const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
        const buf = await imgResp.arrayBuffer();
        if (buf.byteLength > 0 && buf.byteLength <= MAX_IMG_BYTES) {
          const b64 = Buffer.from(buf).toString('base64');
          imagenDataUrl = `data:${contentType};base64,${b64}`;
          imagenB64 = b64;
          imagenContentType = contentType;
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
  let imagenRiesgosa = false;
  let imagenRiesgosaMotivo = null;

  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const instruccionesUser = (customInstructions || '').trim();
      const fuente = shopifyProduct ? 'shopify-json' : ldProduct ? 'json-ld' : 'html-meta';
      const prompt = `Cliente: ${clienteNombre}
Fuente de datos: ${fuente}
Título detectado: ${titulo}
${descripcion ? `Descripción: ${descripcion.slice(0, 400)}` : ''}
URL: ${url}
${variantesShopify.length > 0 ? `\nVariantes estructuradas ya extraídas (no re-detectes, usalas tal cual):\n${JSON.stringify(variantesShopify)}` : ''}

HTML limpio (primeros 12KB):
${htmlLimpio}
${instruccionesUser ? `\n=== INSTRUCCIONES ADICIONALES DEL USER (priorizalas sobre defaults) ===\n${instruccionesUser.slice(0, 1500)}\n` : ''}
${imagenB64 ? 'TENÉS LA IMAGEN ADJUNTA. Mirá la foto real (no sólo el HTML) para evaluar si va a fallar al remover el fondo: personas, escenas, texto grande, cortes, fusión con fondo. Si la foto está limpia sobre fondo uniforme, imagenRiesgosa: false.' : ''}

Generá el JSON con sku, nombreLimpio (técnico y real), variantes, y evaluación de la imagen.`;

      const userContent = [{ type: 'text', text: prompt }];
      // Si tenemos la imagen bajada, la pasamos como content block (Haiku 4.5
      // soporta vision). Así Claude la ve real en vez de adivinar por HTML.
      if (imagenB64 && imagenContentType && /^image\/(jpeg|png|webp|gif)$/i.test(imagenContentType)) {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: imagenContentType, data: imagenB64 },
        });
      }

      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_SKU, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      });
      const text = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.sku) sku = parsed.sku;
      if (parsed.nombreLimpio) nombreLimpio = parsed.nombreLimpio;
      if (typeof parsed.tituloOriginalEraDeTienda === 'boolean') tituloOriginalEraDeTienda = parsed.tituloOriginalEraDeTienda;
      if (typeof parsed.imagenRiesgosa === 'boolean') imagenRiesgosa = parsed.imagenRiesgosa;
      if (typeof parsed.imagenRiesgosaMotivo === 'string') imagenRiesgosaMotivo = parsed.imagenRiesgosaMotivo.slice(0, 80);
      if (Array.isArray(parsed.variantes)) {
        variantes = parsed.variantes
          .filter(v => v && typeof v.valor === 'string' && v.valor.trim())
          .slice(0, 20)
          .map(v => ({
            tipo: String(v.tipo || 'otro').toLowerCase().slice(0, 20),
            valor: String(v.valor).trim().slice(0, 40),
          }));
      }
      // Si Shopify nos dio variantes estructuradas, esas ganan (son perfectas).
      if (variantesShopify.length > 0) variantes = variantesShopify;
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
      imagenRiesgosa,
      imagenRiesgosaMotivo,
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
