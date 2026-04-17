// Agent que acompaña al scrape de productos Senydrop. Dos acciones:
//
//   action: 'summarize'
//     input: { productos: Product[] }
//     output: { resumen: string, puntos: string[] }
//     Devuelve un resumen narrativo tipo "traje 25, detecté X, marqué Y"
//     para que el user entienda qué hizo la IA sin revisar uno por uno.
//
//   action: 'refine'
//     input: { productos: Product[], instruccion: string, instruccionesPrevias?: string }
//     output: { productosActualizados: Product[], explicacion: string, instruccionAprendida: string }
//     El user dice "quitale X del nombre", "unificá colores Y", etc. Claude
//     aplica el cambio a todos los productos donde corresponde y devuelve
//     una instrucción corta para sumar al config y que se aplique a futuros
//     scrapes (aprendizaje continuo).

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_SUMMARIZE = `Sos el asistente de análisis del sistema Senydrop. Recibís un array de productos que recién se scrapearon y generás un resumen ejecutivo para el admin.

Formato:
{
  "resumen": "2-3 oraciones con el pulso general: cuántos trajiste, de qué cliente, qué se destaca",
  "puntos": [
    "Puntos específicos que conviene que vea el admin, uno por línea.",
    "Cada punto es 1 oración, con datos concretos (cantidades, nombres)."
  ]
}

REGLAS para los puntos destacados:
- Mencioná productos con variantes (cuántas, de qué tipo: color, talle, oferta).
- Si hay títulos que parecían ser el nombre de la tienda y los corregiste, listalos.
- Si hay productos con imagen riesgosa, contá cuántos y por qué.
- Si detectaste productos con nombres muy parecidos (posibles duplicados), avisá.
- Si detectaste patrones (muchos productos con "premium" en el nombre, repetición de palabras), mencionalo — al admin le puede interesar hacer una corrección masiva.
- Máximo 6 puntos.

Castellano rioplatense, tono de colega directo. NO markdown. SOLO JSON puro.`;

const SYSTEM_REFINE = `Sos el agente de corrección del sistema Senydrop. El admin te está dando feedback sobre un batch de productos ya scrapeados y querés (a) aplicar el cambio a ESTOS productos, y (b) destilar el feedback en una instrucción corta que se guarda en la config de IA para que se aplique a todos los scrapes futuros.

Input:
- Array de productos con {nombre, sku, variantes, url, etc.}
- Un mensaje del admin en lenguaje natural (ej: "quitale 'Plegable' del nombre", "los colores Rosa y Rosado son el mismo, dejá sólo Rosa", "los SKUs son muy largos, acortá a máx 25 chars").
- Las instrucciones custom que ya tenía guardadas previamente (para que no contradigas nada).

Output JSON ESTRICTO:
{
  "productosActualizados": [ { ...cada producto con los mismos keys que vinieron, modificados donde corresponda. DEVOLVELOS TODOS, incluso los que NO cambiaste } ],
  "explicacion": "1-2 oraciones contándole al user qué hiciste, con números (ej: 'Saqué Plegable de 7 productos. 2 ya no lo tenían.')",
  "instruccionAprendida": "La regla destilada, máx 120 caracteres, redactada para agregar a la config. Ej: 'No incluir la palabra Plegable en el nombre del producto.'. Si el feedback no es generalizable (ej: 'cambiá ESTE producto específico a X'), devolvé empty string."
}

REGLAS:
- Modificá SOLO lo que el usuario pidió. No cambies cosas que no tocó.
- Si el feedback afecta nombres, actualizá también el SKU en consecuencia (si el nombre cambió, regenera el SKU usando PF-{iniciales}-{keywords} con la nomenclatura habitual de Senydrop).
- Si se pide unificar variantes (ej "Rosa y Rosado son el mismo"), dejá SOLO UNA de las variantes unificadas.
- Si se pide borrar algo que no existe, no es error: devolvé los productos sin cambios y aclaralo en la explicación.
- NO devuelvas productos nuevos ni borres productos.
- Mantené EXACTAMENTE la cantidad y el orden de los productos que te llegaron.
- Tono castellano rioplatense. NO markdown. SOLO JSON puro.`;

const ACTIONS = {
  summarize: { system: SYSTEM_SUMMARIZE, maxTokens: 1024 },
  refine: { system: SYSTEM_REFINE, maxTokens: 4096 },
};

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

// Productos pueden traer imágenes base64 grandes. Las STRIP antes de mandar a
// Claude (no necesita ver la imagen para corregir un nombre/SKU y gastaríamos
// tokens al pedo).
function stripImages(productos) {
  return productos.map(p => ({ ...p, imagen: p.imagen ? '[base64 omitido]' : null }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const body = await readBody(req);
  const { action, productos, instruccion, instruccionesPrevias } = body || {};

  if (!action || !ACTIONS[action]) {
    return respondJSON(res, 400, { error: `action debe ser uno de: ${Object.keys(ACTIONS).join(', ')}` });
  }
  if (!Array.isArray(productos) || productos.length === 0) {
    return respondJSON(res, 400, { error: 'Falta productos[] (array con al menos uno)' });
  }
  if (action === 'refine' && (!instruccion || typeof instruccion !== 'string')) {
    return respondJSON(res, 400, { error: 'refine requiere una instruccion del user' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const config = ACTIONS[action];
  const client = new Anthropic({ apiKey });

  const productosLimpios = stripImages(productos);

  let userContent;
  if (action === 'summarize') {
    userContent = `Productos traídos (${productosLimpios.length}):\n\n${JSON.stringify(productosLimpios, null, 2)}\n\nGenerá el JSON con el resumen.`;
  } else {
    userContent = `Productos actuales (${productosLimpios.length}):
${JSON.stringify(productosLimpios, null, 2)}

${instruccionesPrevias ? `Instrucciones custom YA guardadas (respetalas):\n${instruccionesPrevias.slice(0, 1500)}\n\n` : ''}Feedback del admin:
"${instruccion}"

Aplicá el cambio. Devolvé el JSON con productosActualizados (todos, con los mismos keys que recibiste), explicacion e instruccionAprendida.`;
  }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: config.maxTokens,
      system: [{ type: 'text', text: config.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });
    const text = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      console.error('agent-refine parse error', e, 'raw:', text);
      return respondJSON(res, 502, { error: 'No pude parsear la respuesta del agente', raw: text });
    }

    // En refine, el agente devuelve productosActualizados SIN imagen (porque
    // le mandamos el placeholder). Hay que pegar la imagen original de vuelta
    // desde el array que vino para que el frontend no las pierda.
    if (action === 'refine' && Array.isArray(parsed.productosActualizados)) {
      parsed.productosActualizados = parsed.productosActualizados.map((p, i) => ({
        ...p,
        imagen: productos[i]?.imagen ?? p.imagen,
        _imagenOriginal: productos[i]?._imagenOriginal,
        _bgRemoved: productos[i]?._bgRemoved,
        _normalized: productos[i]?._normalized,
        _tempId: productos[i]?._tempId,
      }));
    }

    return respondJSON(res, 200, { action, ...parsed });
  } catch (err) {
    console.error('agent-refine error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error desconocido' });
  }
}
