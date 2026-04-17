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

// Productos traen varios blobs base64 (imagen actual + backup original) y un
// montón de flags internos (_tempId, _bgRemoving, _normalized, etc.) que no
// sirven para corregir nombres/SKUs. Extraemos SOLO los campos relevantes para
// mantener el request chico y bajo el rate limit.
//
// El _tempId se preserva como clave para poder re-mergear la respuesta con
// los productos originales.
function toSlim(productos) {
  return productos.map(p => ({
    _tempId: p._tempId,
    nombre: p.nombre,
    sku: p.sku,
    url: p.url,
    variantes: p.variantes || [],
    imagenRiesgosa: p.imagenRiesgosa || false,
    imagenRiesgosaMotivo: p.imagenRiesgosaMotivo || null,
    tituloOriginalEraDeTienda: p.tituloOriginalEraDeTienda || false,
    nombreOriginal: p.nombreOriginal || null,
    clienteNombre: p.clienteNombre || null,
    peso: p.peso,
    largo: p.largo,
    ancho: p.ancho,
    alto: p.alto,
    _manual: p._manual || false,
    _expandVariantes: p._expandVariantes || false,
  }));
}

// Divide un array en chunks de tamaño N.
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const CHUNK_SIZE = 10; // 10 productos por request evita rate limit y mejora calidad.

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

  // ---- Wrapper para llamar a Claude con UN chunk. Maneja el parseo JSON. ----
  async function callClaude(userContent) {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: config.maxTokens,
      system: [{ type: 'text', text: config.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });
    const text = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  }

  // ---- SUMMARIZE: un solo call con TODOS los productos en versión slim. ----
  // 25-50 productos slim entran cómodos en el rate limit.
  if (action === 'summarize') {
    const slim = toSlim(productos);
    const userContent = `Productos traídos (${slim.length}):\n\n${JSON.stringify(slim, null, 2)}\n\nGenerá el JSON con el resumen.`;
    try {
      const parsed = await callClaude(userContent);
      return respondJSON(res, 200, { action, ...parsed });
    } catch (err) {
      console.error('agent-refine summarize error:', err?.message);
      return respondJSON(res, 502, { error: `No pude generar el resumen: ${err?.message || err}` });
    }
  }

  // ---- REFINE: chunkeo si hay muchos. Merge por _tempId (robusto). ----
  const slim = toSlim(productos);
  const chunks = chunk(slim, CHUNK_SIZE);

  const actualizadosPorId = new Map();
  const explicacionesChunks = [];
  let instruccionAprendida = '';

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const userContent = `Productos actuales (${c.length} de ${slim.length} totales, chunk ${i + 1}/${chunks.length}):
${JSON.stringify(c, null, 2)}

${instruccionesPrevias ? `Instrucciones custom YA guardadas (respetalas):\n${instruccionesPrevias.slice(0, 1500)}\n\n` : ''}Feedback del admin:
"${instruccion}"

Aplicá el cambio al chunk. Devolvé el JSON con productosActualizados (EXACTAMENTE los ${c.length} productos que te llegaron, con los mismos keys y el mismo _tempId), explicacion e instruccionAprendida.`;

    try {
      const parsed = await callClaude(userContent);
      if (Array.isArray(parsed.productosActualizados)) {
        for (const p of parsed.productosActualizados) {
          if (p._tempId != null) actualizadosPorId.set(p._tempId, p);
        }
      }
      if (parsed.explicacion) explicacionesChunks.push(parsed.explicacion);
      if (parsed.instruccionAprendida && !instruccionAprendida) {
        instruccionAprendida = parsed.instruccionAprendida;
      }
    } catch (err) {
      console.error(`agent-refine chunk ${i + 1} error:`, err?.message);
      // Si un chunk falla por rate limit u otra cosa, esperamos 2s y reintentamos UNA vez.
      if (err?.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const parsed = await callClaude(userContent);
          if (Array.isArray(parsed.productosActualizados)) {
            for (const p of parsed.productosActualizados) {
              if (p._tempId != null) actualizadosPorId.set(p._tempId, p);
            }
          }
          if (parsed.explicacion) explicacionesChunks.push(parsed.explicacion);
          if (parsed.instruccionAprendida && !instruccionAprendida) {
            instruccionAprendida = parsed.instruccionAprendida;
          }
        } catch (err2) {
          return respondJSON(res, 502, { error: `Rate limit persistente. Probá con menos productos a la vez o esperá 1 minuto.` });
        }
      } else {
        return respondJSON(res, 502, { error: `Error en chunk ${i + 1}/${chunks.length}: ${err?.message}` });
      }
    }
  }

  // Merge: para cada producto original, buscamos su versión actualizada por
  // _tempId. Si no está, dejamos el original sin cambios. Preservamos los
  // campos internos (imagen, _imagenOriginal, _bgRemoved, etc.) que Claude
  // no vio y no tiene por qué tocar.
  const productosActualizados = productos.map(orig => {
    const fromAi = actualizadosPorId.get(orig._tempId);
    if (!fromAi) return orig;
    return {
      ...orig,           // base: original intacto con imágenes y flags
      ...fromAi,         // override: lo que Claude cambió (nombre, sku, variantes, etc.)
      imagen: orig.imagen,              // nunca pisamos la imagen real
      _imagenOriginal: orig._imagenOriginal,
      _bgRemoved: orig._bgRemoved,
      _normalized: orig._normalized,
      _bgRemoving: orig._bgRemoving,
      _tempId: orig._tempId,
    };
  });

  const explicacion = explicacionesChunks.length <= 1
    ? (explicacionesChunks[0] || 'Correcciones aplicadas.')
    : `${explicacionesChunks.length} chunks procesados: ${explicacionesChunks.join(' ')}`;

  return respondJSON(res, 200, {
    action,
    productosActualizados,
    explicacion,
    instruccionAprendida,
  });
}
