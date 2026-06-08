// Genera N variaciones de creativo "referencial" — replicando la FÓRMULA
// VALIDADA de un ad ganador de competencia, ejecutada con el producto propio.
//
// Flujo (v3 — Meta Ads Strategist):
// 1. Bajamos la imagen de referencia (Meta CDN, URL corta vida) a buffer.
// 2. Claude Sonnet 4.6 actúa como "Meta Ads Strategist":
//    a) Lee el ad ganador y extrae VISUAL skeleton + STRATEGY layer
//       (ángulo, awareness stage, hook type, avatar target, badges purpose).
//    b) ADAPTA los badges/claims a contenido válido para NUESTRO producto
//       (ej: si dice "FDA Approved" y no aplica, sugiere "ANMAT" o equivalente).
//    c) Planea N ejecuciones distintas de la MISMA fórmula validada
//       (mismo concepto, distinto modelo/ángulo/prop/luz).
//    → ~$0.04 por análisis, ~15s con thinking.
// 3. Por cada variación, construimos un prompt específico que combina:
//    - El visual skeleton (composición a copiar)
//    - Los badges adaptados (qué contenido va en cada sello)
//    - El execution diff de esa variación específica
// 4. Llamamos a gpt-image-2 /v1/images/edits N veces EN PARALELO, cada una
//    con n=1 (prompts distintos por variación):
//    image[0] = la ref del competidor (composición a clonar)
//    image[1] = la foto del producto (objeto a respetar EXACTO)
//    + input_fidelity: high
//    → size 2048x2048 1:1 / 1024x1536 portrait, quality high
// 5. Devolvemos los N base64 + plan + per-variation metadata.
//
// Fallback: si Sonnet falla o no hay API key, caemos al pipeline v2 (Haiku
// skeleton + UNA llamada con n=N a gpt-image-2).

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL_IMAGE = 'gpt-image-2';
const MODEL_STRATEGIST = 'claude-sonnet-4-6';
const MODEL_VISION_FALLBACK = 'claude-haiku-4-5-20251001';
const DEFAULT_SIZE = '2048x2048';
const FALLBACK_SIZE = '1024x1024';
const DEFAULT_QUALITY = 'high';
const COST_ESTIMATE = { low: 0.03, medium: 0.07, high: 0.18 };

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

// Detecta el tipo real de imagen por magic bytes — el content-type del CDN
// a veces miente y OpenAI rechaza si declaramos mal el mime.
function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

function extForMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

async function fetchImage(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`No pude bajar la ref (HTTP ${resp.status})`);
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  const mime = detectImageType(buf) || 'image/jpeg';
  return { buf, mime };
}

// Helper: extrae JSON de la respuesta de Claude — saca fences markdown si los tiene.
function parseJSONFromClaude(text) {
  let jsonStr = (text || '').trim();
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) jsonStr = match[1];
  return JSON.parse(jsonStr);
}

// Paso 2 v3 — Sonnet actúa como Meta Ads Strategist. Lee la ref, extrae
// visual skeleton + strategy layer + badges adaptados a NUESTRO producto +
// N variaciones distintas (mismo concepto, distinta ejecución).
//
// Devuelve { plan: {...}, cost: number } o { plan: null } si falla.
async function planStrategyAndVariations({ apiKey, refImgBuf, refMime, producto, accentColor, n }) {
  const client = new Anthropic({ apiKey });
  const b64 = refImgBuf.toString('base64');

  const research = (producto?.research || producto?.docs?.research || '').slice(0, 2000);
  const productCtx = [
    `Producto: ${producto?.nombre || 'N/A'}`,
    producto?.descripcion ? `Descripción: ${producto.descripcion.slice(0, 400)}` : '',
    research ? `Research / audiencia / pain points:\n${research}` : '',
    accentColor ? `Color de acento de la marca: ${accentColor}` : '',
  ].filter(Boolean).join('\n');

  const system = `Sos un experto en Meta Ads de DTC (LATAM). Tu trabajo es leer un ad ganador de un competidor y devolver un PLAN para replicar su fórmula validada con el producto del usuario.

NO inventes ángulos nuevos — el competidor ya validó este ángulo con su plata. Tu trabajo es:
1. Leer EXACTAMENTE qué hace el ad ganador (visual + estrategia).
2. Adaptar sus badges/claims a contenido VÁLIDO para nuestro producto (sin inventar regulaciones que no tengamos).
3. Planear N ejecuciones distintas de la MISMA fórmula (cambia modelo/edad/ángulo cámara/prop secundario/momento del día — NO cambia el concepto).

Pensá como un media buyer experimentado de Meta — qué hace este ad funcionar, y cómo lo replicaría con cambios mínimos para testear ejecuciones.`;

  const userPrompt = `# Producto del usuario
${productCtx}

# Tarea
Analizá la imagen del ad ganador adjunto y devolvé EXACTAMENTE este JSON (sin markdown, sin texto extra):

{
  "visual": {
    "framing": "ej: plano cerrado producto centrado, ligeramente desde abajo",
    "composition": "ej: simetría centrada, producto domina 50% del frame, badges en esquinas inferiores",
    "productPlacement": {
      "position": "centro | izquierda | derecha | inferior | superior",
      "scale": "dominante | equilibrado | pequeño",
      "rotation": "frontal | 3/4 izq | 3/4 der | levemente tilted"
    },
    "background": "ej: pared sólida de hojas verdes naturales con DOF difuminado",
    "lighting": "ej: luz suave frontal con leve key desde arriba-izquierda, sin sombras duras",
    "palette": ["#hex1", "#hex2", "#hex3", "#hex4"],
    "props": ["lista de objetos al lado del producto"],
    "textBlocks": [
      { "position": "top | center | bottom | left | right", "size": "L | M | S", "style": "ej: bold sans-serif blanco sobre fondo oscuro" }
    ],
    "mood": "ej: autoridad científica + confianza + naturalidad",
    "style": "packshot premium | UGC casero | editorial lifestyle | infomercial | minimal | maximalist DTC",
    "aspectRatio": "1:1 | 4:5 | 9:16 | 16:9"
  },
  "strategy": {
    "angle": "problem_solution | demo | social_proof | authority | before_after | scarcity | UGC | founder | transformation | curiosity | benefit_stack",
    "awareness_stage": "cold | warm | retargeting",
    "hook_type": "curiosity | authority | urgency | fear | desire | proof | novelty",
    "target_avatar": "ej: mujer 35-50, preocupada por envejecimiento de piel, busca solución natural premium",
    "value_prop_implicit": "ej: ingrediente activo único respaldado por estudios + entrega rápida"
  },
  "badges_adapted": [
    {
      "position": "ej: esquina inferior izquierda",
      "role": "authority | trust | guarantee | scarcity | social_proof | regulatory",
      "original_content": "lo que dice en el ad ref (ej: 'FDA Approved')",
      "adapted_content": "contenido VÁLIDO para nuestro producto (ej: 'ANMAT' si Argentina, 'Dermatológicamente testeado' si aplica, o vacío si no tenemos equivalente)",
      "visual_treatment": "ej: pill verde redondo con check blanco"
    }
  ],
  "ctaElements_adapted": [
    {
      "position": "ej: centro inferior",
      "original_content": "lo que dice el CTA en el ad ref",
      "adapted_content": "CTA equivalente para nuestro producto (sin inventar promesas que no podemos cumplir)",
      "visual_treatment": "ej: pill blanco grande con texto bold negro"
    }
  ],
  "variations": [
    // EXACTAMENTE ${n} items — todas ejecuciones DISTINTAS de la MISMA fórmula
    {
      "id": 1,
      "label": "ej: Modelo joven 28-35",
      "execution_diff": "Detalle MUY específico de qué cambiar en esta variación SIN cambiar el concepto: modelo demográfica X, ángulo cámara Y, prop secundario Z, momento del día W, paleta levemente shift, etc.",
      "scene_notes": "Notas adicionales para esta variación específica"
    }
    // ... ${n - 1} más
  ]
}

REGLAS:
- "adapted_content" debe ser conservador: si no tenemos el equivalente regulatorio, dejalo vacío o sustituí por algo genérico defendible (ej: "Calidad premium" en vez de inventar "FDA Approved").
- "variations" tiene que tener EXACTAMENTE ${n} items, todas ejecutando la MISMA estrategia con diffs mínimos pero distintos entre sí.
- Si la imagen no tiene badges o CTA elements, devolvé arrays vacíos — NO inventes.
- "research" del producto debe informar qué modelo demográfica usar en cada variación.`;

  try {
    const resp = await client.messages.create({
      model: MODEL_STRATEGIST,
      max_tokens: 4000,
      thinking: { type: 'enabled', budget_tokens: 2000 },
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: refMime, data: b64 } },
          { type: 'text', text: userPrompt },
        ],
      }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) return { plan: null, cost: 0 };

    try {
      const plan = parseJSONFromClaude(textBlock.text);
      // Validación mínima: variations tiene que ser array de n items.
      if (!plan?.variations || !Array.isArray(plan.variations) || plan.variations.length === 0) {
        console.warn('Plan sin variations array — usando fallback');
        return { plan: null, cost: anthropicCost(resp.usage, MODEL_STRATEGIST) };
      }
      // Si Sonnet devolvió menos variations que las pedidas, las duplicamos.
      while (plan.variations.length < n) {
        const last = plan.variations[plan.variations.length - 1];
        plan.variations.push({
          ...last,
          id: plan.variations.length + 1,
          label: (last.label || 'Variación') + ' (extra)',
        });
      }
      // Si devolvió más, las cortamos.
      plan.variations = plan.variations.slice(0, n);
      return { plan, cost: anthropicCost(resp.usage, MODEL_STRATEGIST) };
    } catch (err) {
      console.warn('Plan JSON inválido:', err.message, 'Raw:', textBlock.text.slice(0, 300));
      return { plan: null, cost: anthropicCost(resp.usage, MODEL_STRATEGIST) };
    }
  } catch (err) {
    console.warn('planStrategyAndVariations falló:', err.message);
    return { plan: null, cost: 0 };
  }
}

// Alias retro-compat: el handler v2 sigue llamando extractSkeleton hasta que
// integremos el Strategist completo. Cuando esté, este alias se borra.
const extractSkeleton = (...args) => extractSkeletonHaiku(...args);

// Fallback: si el Strategist falla, usamos Haiku solo para sacar visual skeleton
// y caemos al pipeline v2 (UNA call gpt-image-2 con n=N, todas variaciones random).
async function extractSkeletonHaiku({ apiKey, refImgBuf, refMime }) {
  const client = new Anthropic({ apiKey });
  const b64 = refImgBuf.toString('base64');
  const system = `Sos analista visual de creativos DTC. Devolvé el visual skeleton del ad en JSON.`;
  const userPrompt = `Analizá esta imagen y devolvé EXACTAMENTE:

{
  "framing": "",
  "composition": "",
  "productPlacement": { "position": "", "scale": "", "rotation": "" },
  "background": "",
  "lighting": "",
  "palette": [],
  "props": [],
  "textBlocks": [],
  "badges": [],
  "ctaElements": [],
  "mood": "",
  "style": "",
  "aspectRatio": ""
}

Sin markdown, sin texto extra. Vacío si no aplica, no inventes.`;

  try {
    const resp = await client.messages.create({
      model: MODEL_VISION_FALLBACK,
      max_tokens: 1500,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: refMime, data: b64 } },
          { type: 'text', text: userPrompt },
        ],
      }],
    });
    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) return { skeleton: null, cost: 0 };
    try {
      return { skeleton: parseJSONFromClaude(textBlock.text), cost: anthropicCost(resp.usage, MODEL_VISION_FALLBACK) };
    } catch {
      return { skeleton: { _raw: textBlock.text.slice(0, 2000) }, cost: anthropicCost(resp.usage, MODEL_VISION_FALLBACK) };
    }
  } catch (err) {
    console.warn('extractSkeletonHaiku falló:', err.message);
    return { skeleton: null, cost: 0 };
  }
}

function sizeForFormato(formato, requested) {
  // Para gpt-image-2 hoy: 1024x1024 / 1024x1536 / 1536x1024 / 2048x2048 (1:1).
  // El usuario pidió 2048x2048 explícito → lo pasamos.
  if (requested) return requested;
  return formato === 'video' ? '1024x1536' : DEFAULT_SIZE;
}

function aspectRatioFromSize(size) {
  if (!size) return '1:1';
  const [w, h] = size.split('x').map(Number);
  if (!w || !h) return '1:1';
  if (w === h) return '1:1';
  if (h > w) return 'portrait (2:3)';
  return 'landscape (3:2)';
}

// Prompt builder v2 — usa el skeleton estructurado + producto + research.
function buildPrompt({ producto, inspiracion, skeleton, accentColor, aspectRatio }) {
  const nombre = (producto?.nombre || '').trim();
  const descripcion = (producto?.descripcion || '').trim();
  const research = (producto?.research || producto?.docs?.research || '').trim();

  const parts = [];
  parts.push('Premium DTC creative for Meta Ads — editorial production, scroll-stop composition. PHOTOREALISTIC, NO AI plastic look, NO uncanny faces, NO garbled text.');
  parts.push('');
  parts.push('YOU RECEIVE TWO IMAGES:');
  parts.push('  • IMAGE 1 = a winning competitor ad. COPY its composition, framing, lighting, background style, palette, and overall mood — but DO NOT copy the brand, the actual product, or the literal text.');
  parts.push('  • IMAGE 2 = the product you must feature. KEEP its shape, color, label artwork, packaging and proportions IDENTICAL. Do NOT redraw the label. Do NOT invent any new text on the packaging.');
  parts.push('');

  if (skeleton && typeof skeleton === 'object') {
    parts.push('COMPOSITION TO REPLICATE (extracted from IMAGE 1 by vision analysis — use as ground truth):');
    if (skeleton.framing) parts.push(`  - Framing: ${skeleton.framing}`);
    if (skeleton.composition) parts.push(`  - Composition: ${skeleton.composition}`);
    if (skeleton.productPlacement) {
      const pp = skeleton.productPlacement;
      parts.push(`  - Product placement: position=${pp.position || 'n/a'}, scale=${pp.scale || 'n/a'}, rotation=${pp.rotation || 'n/a'}`);
    }
    if (skeleton.background) parts.push(`  - Background: ${skeleton.background}`);
    if (skeleton.lighting) parts.push(`  - Lighting: ${skeleton.lighting}`);
    if (Array.isArray(skeleton.palette) && skeleton.palette.length) parts.push(`  - Palette: ${skeleton.palette.join(', ')}`);
    if (Array.isArray(skeleton.props) && skeleton.props.length) parts.push(`  - Props (use similar ones, not identical): ${skeleton.props.join('; ')}`);
    if (Array.isArray(skeleton.badges) && skeleton.badges.length) parts.push(`  - Graphic badges/seals to include in similar positions (but with generic text or no text — the model is bad at text): ${skeleton.badges.join('; ')}`);
    if (Array.isArray(skeleton.ctaElements) && skeleton.ctaElements.length) parts.push(`  - CTA-like graphic elements (pills, buttons) in their original positions: ${skeleton.ctaElements.join('; ')}`);
    if (Array.isArray(skeleton.textBlocks) && skeleton.textBlocks.length) {
      const tb = skeleton.textBlocks.map(b => `${b.position || '?'}@${b.size || '?'}`).join(', ');
      parts.push(`  - Text block layout slots (LEAVE EMPTY or with placeholder rectangles — we will overlay real text later): ${tb}`);
    }
    if (skeleton.mood) parts.push(`  - Mood: ${skeleton.mood}`);
    if (skeleton.style) parts.push(`  - Style: ${skeleton.style}`);
    if (skeleton._raw) parts.push(`  - Raw analysis (fallback): ${skeleton._raw}`);
  } else if (inspiracion?.analysis?.visual || inspiracion?.visual) {
    // Fallback al análisis viejo si vision falló.
    parts.push(`Reference visual (fallback text-only): ${inspiracion.analysis?.visual || inspiracion.visual}`);
  }

  parts.push('');
  parts.push('THE PRODUCT (IMAGE 2):');
  if (nombre) parts.push(`  - Product name: ${nombre}`);
  if (descripcion) parts.push(`  - Description: ${descripcion.slice(0, 400)}`);
  if (research) parts.push(`  - Audience and pain points (use to choose props/scene): ${research.slice(0, 1500)}`);

  if (accentColor) {
    parts.push('');
    parts.push(`Accent color for highlights/arrows/pills: ${accentColor}`);
  }

  parts.push('');
  parts.push('SCENE SETTING (geo + aesthetic):');
  parts.push('  • LATAM / Argentina home aesthetic: warm natural light, terracotta / wood / linen textures, plants. If hands or skin are visible, use Mediterranean / Latin skin tones (not pale gringo). Decoration should feel porteño/contemporáneo, NOT generic American influencer kitchen.');

  parts.push('');
  parts.push('CRITICAL RULES:');
  parts.push('  • Replace the original product in IMAGE 1 with the product from IMAGE 2 — same scene, same lighting, same composition, but the new product takes its exact spot at the same scale and rotation.');
  parts.push('  • Keep the packaging artwork of IMAGE 2 PIXEL-FAITHFUL. Do not redraw labels.');
  parts.push('  • Generated image should be photorealistic, premium DTC, ready for Meta Ads.');
  parts.push('  • NO new text on the image (no headlines, no captions). Badges/pills/seals from IMAGE 1 can be replicated as graphic shapes, but with generic content or empty — the model is bad at typography.');
  parts.push(`  • Output aspect ratio: ${aspectRatio || '1:1'}. High resolution.`);

  return parts.join('\n');
}

async function callGptImage2Edit({ apiKey, prompt, refImgBuf, refMime, prodImgBuf, prodMime, size, quality, n }) {
  const form = new FormData();
  form.append('model', MODEL_IMAGE);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  form.append('n', String(Math.min(10, Math.max(1, n || 2))));
  // input_fidelity=high → gpt-image-2 prioriza respetar las imágenes input
  // (clave para que el envase del producto NO se redibuje y el background de
  // la ref se mantenga lo más fiel posible).
  form.append('input_fidelity', 'high');
  // IMAGE 1 — la ref del competidor (composición a clonar)
  form.append('image[]', new Blob([refImgBuf], { type: refMime }), 'reference.' + extForMime(refMime));
  // IMAGE 2 — el producto del usuario (objeto a respetar)
  form.append('image[]', new Blob([prodImgBuf], { type: prodMime }), 'producto.' + extForMime(prodMime));

  const resp = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });
  const raw = await resp.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`OpenAI no devolvió JSON (HTTP ${resp.status}): ${raw.slice(0, 200)}`);
  }
  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const code = data?.error?.code || data?.error?.type || '';
    // Throw con el error code para que el caller pueda hacer fallback a tamaño chico.
    const err = new Error(`OpenAI rechazó: ${msg}`);
    err.code = code;
    err.status = resp.status;
    throw err;
  }
  const imagenes = (data?.data || []).map(d => d.b64_json).filter(Boolean);
  if (imagenes.length === 0) throw new Error('OpenAI no devolvió imágenes (b64_json ausente)');
  return imagenes;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respondJSON(res, 500, { error: 'OPENAI_API_KEY no configurada en el servidor.' });
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const body = await readBody(req);
  const {
    producto, inspiracion, productoImagen, inspiracionImageUrl, accentColor,
    skeletonCached,  // Si el frontend ya tiene el skeleton del ad cacheado,
                     // lo pasa y nos saltamos Vision (ahorra ~$0.005 + 5-10s).
  } = body || {};

  if (!producto?.nombre) {
    return respondJSON(res, 400, { error: 'Falta producto.nombre' });
  }
  if (!productoImagen || typeof productoImagen !== 'string') {
    return respondJSON(res, 400, { error: 'Falta productoImagen (data URL). Cargá la foto del producto en Setup.' });
  }
  if (!inspiracionImageUrl) {
    return respondJSON(res, 400, { error: 'Falta inspiracionImageUrl (URL de la imagen del ad de referencia)' });
  }
  if (!inspiracion) {
    return respondJSON(res, 400, { error: 'Falta el ad de inspiración' });
  }

  const quality = ['low', 'medium', 'high'].includes(body?.quality) ? body.quality : DEFAULT_QUALITY;
  let size = sizeForFormato(inspiracion?.formato, body?.size);
  const n = Math.min(10, Math.max(1, Number(body?.n) || 2));
  const aspectRatio = aspectRatioFromSize(size);

  try {
    // Paso 1 — bajar la ref (Meta CDN).
    const { buf: refImgBuf, mime: refMime } = await fetchImage(inspiracionImageUrl);

    // Paso 2 — decodificar foto del producto.
    const prodBase64 = productoImagen.includes(',') ? productoImagen.split(',')[1] : productoImagen;
    const prodBuf = Buffer.from(prodBase64, 'base64');
    const prodMime = detectImageType(prodBuf) || 'image/jpeg';

    // Paso 3 — extraer skeleton con Claude Vision (Haiku, ~$0.005).
    // Si el frontend ya tiene un skeleton cacheado del mismo ad, lo reusamos
    // y nos saltamos Vision por completo.
    let skeleton = null;
    let visionCost = 0;
    let skeletonFromCache = false;
    if (skeletonCached && typeof skeletonCached === 'object') {
      skeleton = skeletonCached;
      skeletonFromCache = true;
    } else if (anthropicKey) {
      const result = await extractSkeleton({ apiKey: anthropicKey, refImgBuf, refMime });
      skeleton = result.skeleton;
      visionCost = result.cost;
    }

    // Paso 4 — construir prompt con aspect ratio target.
    const prompt = buildPrompt({ producto, inspiracion, skeleton, accentColor, aspectRatio });

    // Paso 5 — llamar a gpt-image-2 /v1/images/edits con AMBAS imágenes.
    // Si falla por tamaño no soportado, hacemos un único retry con FALLBACK_SIZE.
    let imagenes;
    let sizeUsed = size;
    let sizeFallback = false;
    try {
      imagenes = await callGptImage2Edit({
        apiKey, prompt,
        refImgBuf, refMime,
        prodImgBuf: prodBuf, prodMime,
        size: sizeUsed, quality, n,
      });
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      const isSizeErr = msg.includes('size') || msg.includes('dimension') || /unsupported/.test(msg);
      if (isSizeErr && sizeUsed !== FALLBACK_SIZE) {
        console.warn(`gpt-image-2 rechazó size=${sizeUsed} — fallback a ${FALLBACK_SIZE}`);
        sizeUsed = FALLBACK_SIZE;
        sizeFallback = true;
        imagenes = await callGptImage2Edit({
          apiKey, prompt,
          refImgBuf, refMime,
          prodImgBuf: prodBuf, prodMime,
          size: sizeUsed, quality, n,
        });
      } else {
        throw err;
      }
    }

    return respondJSON(res, 200, {
      imagenes,
      mimeType: 'image/png',
      size: sizeUsed,
      sizeRequested: size,
      sizeFallback,
      quality,
      n: imagenes.length,
      aspectRatio,
      model: MODEL_IMAGE,
      visionModel: skeleton && !skeletonFromCache ? MODEL_VISION_FALLBACK : null,
      skeleton,
      skeletonFromCache,
      prompt,
      generatedAt: new Date().toISOString(),
      cost: {
        openai: (COST_ESTIMATE[quality] ?? 0.18) * imagenes.length,
        anthropic: visionCost,
      },
    });
  } catch (err) {
    console.error('crear-creativo-referencial error:', err);
    return respondJSON(res, 502, { error: err?.message || 'Error generando el referencial' });
  }
}
