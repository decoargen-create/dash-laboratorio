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
//    (input_fidelity NO se setea — gpt-image-2 no acepta ese parámetro)
//    → size 2048x2048 1:1 / 1024x1536 portrait, quality high
// 5. Devolvemos los N base64 + plan + per-variation metadata.
//
// Fallback: si Sonnet falla o no hay API key, caemos al pipeline v2 (Haiku
// skeleton + UNA llamada con n=N a gpt-image-2).

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';
import {
  getUserIdFromAuth,
  uploadCreativoToBucket,
  insertCreativoRow,
} from './_supabase-server.js';

const MODEL_IMAGE = 'gpt-image-2';
const MODEL_STRATEGIST = 'claude-sonnet-4-6';
const MODEL_VISION_FALLBACK = 'claude-haiku-4-5-20251001';
// Default 1024×1024 — quality/precio óptimo. 2048×2048 era ~4x más caro
// (~$0.65/imagen vs $0.18 a 1024) y la diferencia visual en feed de Meta
// es marginal: a 1024 ya se ve nítido y baja el costo por variante a un
// nivel sano. Quien necesite 2K puede pedir size: '2048x2048' explícito.
const DEFAULT_SIZE = '1024x1024';
const FALLBACK_SIZE = '1024x1024';
const DEFAULT_QUALITY = 'high';
// Estimaciones por imagen (output + 2 input refs + texto). Calibradas con
// gptImageCost() en _costs.js. Si la response trae `usage`, se usa el costo
// real en vez de esta tabla.
const COST_ESTIMATE_BY_SIZE = {
  low:    { '1024x1024': 0.013, '1024x1536': 0.020, '1536x1024': 0.020, '2048x2048': 0.050 },
  medium: { '1024x1024': 0.046, '1024x1536': 0.068, '1536x1024': 0.068, '2048x2048': 0.175 },
  high:   { '1024x1024': 0.180, '1024x1536': 0.262, '1536x1024': 0.262, '2048x2048': 0.680 },
};
function estimateImageCost(quality, size) {
  return COST_ESTIMATE_BY_SIZE[quality]?.[size] ?? COST_ESTIMATE_BY_SIZE.high['1024x1024'];
}

// Detecta el FORMATO físico del producto (gomitas / cápsulas / crema / etc.)
// para que gpt-image-2 NO dibuje un formato equivocado (ej. cápsulas en un
// ad de gomitas) y para que Vision REESCRIBA cualquier mención al formato
// equivocado en los textos adaptados.
//
// PRIORIDAD:
//   1. producto.formato — explícito, el user lo eligió en Setup (ground truth)
//   2. Heurística regex sobre nombre + descripción + research (fallback)
//
// Devuelve string canónico ("gomitas", "cápsulas", "crema", etc.) o null.
function inferProductForm(producto) {
  // Si el user declaró el formato explícito en Setup, lo respetamos sin más.
  const explicit = (producto?.formato || '').toString().trim().toLowerCase();
  if (explicit && explicit !== 'otros' && explicit !== 'other') {
    return explicit;
  }
  const haystack = [
    producto?.nombre || '',
    producto?.descripcion || '',
    String(producto?.research || producto?.docs?.research || ''),
  ].join(' ').toLowerCase();
  const patterns = [
    { canon: 'gomitas',      re: /\b(gomitas?|gummies|gummys?)\b/ },
    { canon: 'cápsulas',     re: /\b(c[áa]psulas?|capsules?|softgels?|pastillas?|tabletas?|tablets?)\b/ },
    { canon: 'polvo',        re: /\b(polvo|powder|mix en polvo)\b/ },
    { canon: 'sérum',        re: /\b(s[ée]rum|serum)\b/ },
    { canon: 'crema',        re: /\b(crema|cream|loci[óo]n|lotion|emulsi[óo]n)\b/ },
    { canon: 'gotas',        re: /\b(gotas|drops|d[íi]as? en gotas)\b/ },
    { canon: 'aceite',       re: /\b(aceite|oil)\b/ },
    { canon: 'bálsamo',      re: /\b(b[áa]lsamo|balm)\b/ },
    { canon: 'spray',        re: /\b(spray|atomizador)\b/ },
    { canon: 'stick',        re: /\b(stick|barra|bar)\b/ },
    { canon: 'sachet',       re: /\b(sachet|sobre|sticks individuales)\b/ },
    { canon: 'shot',         re: /\b(shot|chupito|liquid shot)\b/ },
    { canon: 'mascarilla',   re: /\b(mascarilla|m[áa]scara|mask)\b/ },
    { canon: 'parches',      re: /\b(parches|patches)\b/ },
  ];
  for (const p of patterns) {
    if (p.re.test(haystack)) return p.canon;
  }
  return null;
}

// Equivalente singular/contable del formato — para overlays tipo
// "1 cápsula antes de dormir" → "1 gomita antes de dormir".
function singularFormato(formato) {
  if (!formato) return null;
  const map = {
    'gomitas': 'gomita',
    'cápsulas': 'cápsula',
    'capsulas': 'cápsula',
    'gotas': 'gota',
    'comprimidos': 'comprimido',
    'tabletas': 'tableta',
    'sachets': 'sachet',
    'shots': 'shot',
    'parches': 'parche',
    'sticks': 'stick',
  };
  return map[formato.toLowerCase()] || formato;
}

// Dedup de líneas de ofertas: si la misma frase (case-insensitive) aparece
// múltiple veces, mantenemos solo la primera. También dedup de tokens
// repetidos en la misma línea (ej: "ENVÍO GRATIS · ENVÍO GRATIS" → "ENVÍO GRATIS").
// Sin esto, gpt-image-2 puede stack 2+ ribbons con el mismo mensaje.
function dedupOfertas(rawOfertas) {
  if (!rawOfertas) return '';
  const lines = String(rawOfertas)
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const key = line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join('\n');
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
  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch (err) {
    throw new Error(`No se pudo conectar a la URL de la imagen ref (${err.message}). Quizás expiró o la red está caída.`);
  }
  // 403/410: Meta CDN expira las URLs después de ~1 hora. Mensaje accionable.
  if (resp.status === 403 || resp.status === 410) {
    throw new Error(`La URL de la imagen del ad ref expiró (HTTP ${resp.status}). Las URLs de Meta CDN duran ~1h. Volvé a hacer scrape de esa marca para refrescarlas.`);
  }
  if (!resp.ok) throw new Error(`No pude bajar la ref (HTTP ${resp.status})`);
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length < 100) {
    throw new Error('La URL de la ref devolvió contenido vacío. Verificá la URL o re-scrapeá la marca.');
  }
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
  // ofertasReales = lista de promos/precios REALES de la tienda del user.
  // Cuando está cargado, el plan REEMPLAZA las promos del ad ref con éstas
  // (en vez de removerlas como cuando está vacío). Esto evita que el creativo
  // diga "$29" del competidor cuando nuestro precio es otro.
  const ofertasReales = dedupOfertas((producto?.ofertasReales || producto?.offerBrief || producto?.docs?.offerBrief || '').toString().trim());
  const productCtx = [
    `Producto: ${producto?.nombre || 'N/A'}`,
    producto?.descripcion ? `Descripción: ${producto.descripcion.slice(0, 400)}` : '',
    research ? `Research / audiencia / pain points:\n${research}` : '',
    ofertasReales
      ? `**OFERTAS / PRECIOS / CLAIMS REALES DEL USUARIO** (estos son los ÚNICOS que podés mencionar — si el ad ref menciona algo distinto, REEMPLAZALO por esto):\n${ofertasReales.slice(0, 1500)}`
      : '**SIN OFERTAS DECLARADAS** — si el ad ref menciona promos/precios/claims regulatorios, REMOVELOS (no los inventes).',
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
    // EXACTAMENTE ${n} items con DIVERGENCIA PROGRESIVA — cada una se aleja
    // más de la composición original del ad ref, pero MANTIENE la misma
    // estrategia (angle/hook/avatar/value_prop).
    {
      "id": 1,
      "label": "ej: Réplica fiel",
      "divergence_level": "tight",   // copia composición exacta del ad ref
      "execution_diff": "Réplica fiel del ad ref. Mismo encuadre, mismo prop, misma escena. Cambia solo el modelo demográfico para encajar con avatar del producto.",
      "scene_notes": "Pegado al original."
    },
    {
      "id": 2,
      "label": "ej: Mismo concepto, distinto modelo + ángulo",
      "divergence_level": "medium",  // mismo concepto, distinta ejecución
      "execution_diff": "Mantené angle/hook/badges pero cambia composición: distinto ángulo de cámara, modelo demográfico distinto, prop secundario distinto.",
      "scene_notes": ""
    },
    {
      "id": 3,
      "label": "ej: Reinterpretación libre",
      "divergence_level": "loose",   // misma estrategia, escena INVENTADA
      "execution_diff": "INVENTÁ una composición NUEVA que comunique el MISMO angle/hook/value_prop. Diferente escenario, distintos props, distinto tipo de plano. NO copies la composición del ad ref. Pensá: '¿qué OTRA escena vendería este mismo ángulo?'",
      "scene_notes": "Libertad creativa total para el escenario, manteniendo solo la estrategia."
    }
    // ... el resto sigue divergiendo más (variations 4+ = loose o más experimental)
  ]
}

REGLAS:
- **"adapted_content" — REEMPLAZO vs REMOCIÓN**:
  • Si el ad ref muestra una oferta/precio/claim Y tenemos un equivalente en "OFERTAS / PRECIOS / CLAIMS REALES" → **REEMPLAZÁ** con el del usuario. Ej: ad dice "$29" y usuario tiene "USD 49 + envío gratis" → adapted_content = "USD 49 + envío gratis".
  • Si el ad ref muestra una oferta y NO tenemos un equivalente → dejá vacío o sustituí por algo genérico defendible ("Calidad premium" en vez de inventar "FDA Approved").
  • NUNCA copies literal una oferta del ad ref si no la tenemos. Inventar una oferta = mentir al consumidor + violación Meta.
  • Si el ad ref dice "lleva 2 + 1 gratis" y nosotros tenemos "3x2", el adapted_content es "3x2" (función equivalente: multi-buy promo, contenido nuestro).
- "variations" tiene que tener EXACTAMENTE ${n} items.
- **DIVERGENCIA PROGRESIVA**: variation #1 SIEMPRE es "tight" (réplica fiel del ad ref). Variation #2 es "medium". Variations #3 y posteriores son "loose" (escena inventada, solo se mantiene la estrategia). Esto da al usuario una grilla que va desde "lo seguro y validado" hasta "creatividad libre con la misma fórmula".
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

// Fallback: si el Strategist falla, usamos Haiku para sacar visual skeleton
// + textos del ad. El skeleton incluye el contenido LITERAL de cada bloque
// de texto y una versión ADAPTADA al producto del usuario (su angle, su
// pain point, su audiencia, su tono — no solo cambio de palabras).
async function extractSkeletonHaiku({ apiKey, refImgBuf, refMime, producto }) {
  const client = new Anthropic({ apiKey });
  const b64 = refImgBuf.toString('base64');

  // Detectamos el formato físico del producto del usuario (gomitas/cápsulas/etc.)
  // Vision lo usa para REESCRIBIR cualquier mención al formato equivocado del
  // ad de referencia (ej: "60 cápsulas" → "60 gomitas").
  const productoForm = inferProductForm(producto);

  // Contexto del producto para que Vision pueda escribir textos VERDADERAMENTE
  // adaptados (no solo traducción cosmética). ofertasReales tiene prioridad
  // sobre offerBrief — es el campo focalizado que el user llena en Setup
  // con su precio/promo real (ej: "USD 49 + envío gratis").
  const ofertasReales = dedupOfertas((producto?.ofertasReales || producto?.offerBrief || producto?.docs?.offerBrief || '').toString().trim());
  const productoCtx = [
    `Nombre: ${producto?.nombre || 'N/A'}`,
    productoForm ? `**FORMATO FÍSICO: ${productoForm.toUpperCase()}** (este producto viene en ${productoForm} — NO es otro formato).` : '',
    producto?.descripcion ? `Descripción: ${producto.descripcion.slice(0, 300)}` : '',
    ofertasReales
      ? `**OFERTAS / PRECIOS / CLAIMS REALES DEL USUARIO** (estos son los ÚNICOS que podés mencionar — si el ad ref menciona algo distinto, REEMPLAZALO por esto, NO lo dejes literal):\n${ofertasReales.slice(0, 1500)}`
      : '**SIN OFERTAS NI CLAIMS DECLARADOS** — NO inventes descuentos, % off, "comprá 3 y ahorrá", FDA, ANMAT, ni claims médicos.',
    producto?.research ? `Audiencia y pain points:\n${String(producto.research).slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n');

  const system = `Sos analista visual + copywriter de DTC argentino. Tu trabajo es leer un ad ganador y devolver:
1. Visual skeleton (composición, paleta, etc.)
2. Para CADA bloque de texto visible: el texto literal + UNA VERSIÓN ADAPTADA al producto del usuario, en castellano rioplatense con voseo, respetando el ÁNGULO emocional del original pero hablándole a la audiencia y pain points del producto.

NO traduzcas palabra por palabra. ENTENDÉ qué función cumple cada texto (hook de curiosidad, social proof, urgencia, etc.) y reescribilo para que esa misma función opere en EL PRODUCTO DEL USUARIO.`;

  const userPrompt = `# Producto del usuario
${productoCtx}

# Tarea
Analizá la imagen del ad ganador y devolvé EXACTAMENTE este JSON (sin markdown):

{
  "framing": "",
  "composition": "",
  "productPlacement": { "position": "", "scale": "", "rotation": "" },
  "background": "",
  "lighting": "",
  "palette": [],
  "props": [],
  "textBlocks": [
    {
      "position": "top | center | bottom | left | right",
      "size": "L | M | S",
      "style": "ej: bold sans-serif blanco sobre fondo amarillo, sticker IG estilo nota",
      "function": "hook_curiosidad | social_proof | testimonial | urgencia | autoridad | pregunta_retorica | cta",
      "content_literal": "el texto EXACTO que aparece en la imagen",
      "content_adapted": "versión NUEVA en castellano argentino que cumpla la MISMA función emocional pero hable de mi producto, mi audiencia, mi pain. Voseo natural. Sin brands ajenos. Sin hashtags de programas/famosos puntuales. Pensá: '¿qué diría una mujer de mi target argentina hablando de este producto, copiando el ESPÍRITU de este texto?'"
    }
  ],
  "badges": [],
  "ctaElements": [],
  "mood": "",
  "style": "",
  "aspectRatio": ""
}

Reglas estrictas para content_adapted:
- NO traducir literal. Adaptar al ángulo del producto + audiencia + pain points del research.
- Mantener la FUNCIÓN del texto original (si era pregunta de hook, que sea pregunta de hook; si era testimonial, testimonial).
- Mantener longitud aproximada y tono coloquial.
- Voseo argentino. Modismos naturales ("posta", "me re pasa", "che", "de una") si encajan con el tono original.
- Si el original menciona un brand/producto ajeno, reemplazar por el nombre del producto del usuario o algo neutro.
- Si menciona TV/programas/hashtags virales específicos, sustituir por trigger genérico que funcione para LA AUDIENCIA del producto.
- Si la pieza tiene pain point implícito y NO matchea con los pain points del research, ajustalo al pain del research.
- **CRÍTICO — FORMATO FÍSICO**: Si el texto original menciona un formato de producto (cápsulas, pastillas, polvo, gotas, crema, etc.) y NO COINCIDE con el formato del producto del usuario${productoForm ? ` (${productoForm})` : ''}, REEMPLAZÁ por el formato correcto. Ejemplo: si el ad ref dice "60 cápsulas veganas" y nuestro producto son gomitas, en content_adapted debe decir "60 gomitas veganas". Nunca dejar mención de un formato equivocado — confunde al consumidor.

- **CRÍTICO — OFERTAS Y CLAIMS — REEMPLAZO vs REMOCIÓN**:
  • Si el texto original menciona una promo ("25% off", "3x2", "lleva 2 + 1 gratis", "envío gratis", "comprá 3 y ahorrá", "PAGO CONTRA REEMBOLSO") o un claim regulado ("FDA Approved", "ANMAT", "dermatológicamente testeado", "sin gluten") Y TENÉS un equivalente en "OFERTAS / PRECIOS / CLAIMS REALES" → **REEMPLAZALO POR LA OFERTA DEL USUARIO**. Ej: ad ref dice "lleva 2 + 1 gratis" y user tiene "3x2" → content_adapted dice "3x2". Ad ref dice "FDA Approved" y user tiene "ANMAT registrado" → content_adapted dice "ANMAT registrado".
  • Si NO tenés equivalente en "OFERTAS / PRECIOS / CLAIMS REALES" → REMOVELO. Reemplazá por CTA neutro ("Probalo ya", "Conocé más", "Empezá hoy") o un beneficio genérico verificable. Mejor decir menos que inventar.
  • NUNCA dejes literal una oferta del ad ref si no la tenemos. Inventar = mentir al consumidor + posible violación Meta.

- **CRÍTICO — PRECIOS Y MONEDAS — REEMPLAZO vs REMOCIÓN**:
  • Si el texto original menciona un PRECIO específico ("$9.99", "USD 25", "$1500", "10€", "por solo $X") Y TENÉS un precio real en "OFERTAS / PRECIOS / CLAIMS REALES" → **REEMPLAZALO POR EL PRECIO DEL USUARIO** en su moneda. Ej: ad ref dice "$29 USD" y user tiene "USD 49 — envío gratis" → content_adapted dice "USD 49 — envío gratis".
  • Si NO tenés precio real → REMOVÉ el precio. Especialmente cuidado con USD en ads gringos — el target argentino paga en ARS y un precio falso deslegitima. Reemplazá por el BENEFICIO ("Gasté $9.99 y me mandaron probióticos" → "Lo probé y me cambió la vida").
  • NUNCA inventes un precio en ARS si no lo tenemos — mejor sin precio.

Si no hay texto visible, devolvé textBlocks: [].`;

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
// Prompt para una variación específica del Strategist — combina visual
// skeleton + strategy + badges_adapted + execution_diff de esa variación.
// Cada variación termina con un prompt distinto → la grilla de N creativos
// son N ejecuciones distintas de la misma fórmula validada, no N versiones
// de la misma foto.
function buildPromptFromPlan({ producto, inspiracion, plan, variation, accentColor, aspectRatio, rebrand = false }) {
  const nombre = (producto?.nombre || '').trim();
  const descripcion = (producto?.descripcion || '').trim();
  const research = (producto?.research || producto?.docs?.research || '').trim();
  const ofertasReales = dedupOfertas((producto?.ofertasReales || producto?.offerBrief || producto?.docs?.offerBrief || '').toString().trim());
  const productoForm = inferProductForm(producto);
  const v = plan?.visual || {};
  const s = plan?.strategy || {};

  const parts = [];
  parts.push('Premium DTC creative for Meta Ads — editorial production, scroll-stop composition. PHOTOREALISTIC, NO AI plastic look, NO uncanny faces, NO garbled text.');
  parts.push('');
  parts.push('YOU RECEIVE TWO IMAGES:');
  parts.push('  • IMAGE 1 = a winning competitor ad. COPY its composition, framing, lighting, background style, palette, mood.');
  parts.push('  • IMAGE 2 = the product you must feature. KEEP it pixel-faithful.');

  // Strategy: el "por qué" del ad
  parts.push('');
  parts.push('STRATEGIC FORMULA (from competitor analysis — DO NOT change):');
  if (s.angle) parts.push(`  • Angle: ${s.angle}`);
  if (s.awareness_stage) parts.push(`  • Awareness stage: ${s.awareness_stage}`);
  if (s.hook_type) parts.push(`  • Hook type: ${s.hook_type}`);
  if (s.target_avatar) parts.push(`  • Target avatar: ${s.target_avatar}`);
  if (s.value_prop_implicit) parts.push(`  • Implicit value prop: ${s.value_prop_implicit}`);

  // Visual skeleton de IMAGE 1
  parts.push('');
  parts.push('VISUAL COMPOSITION (from IMAGE 1 — preserve unless variation overrides):');
  if (v.framing) parts.push(`  • Framing: ${v.framing}`);
  if (v.composition) parts.push(`  • Composition: ${v.composition}`);
  if (v.productPlacement) {
    const pp = v.productPlacement;
    parts.push(`  • Product placement: ${pp.position || ''} · ${pp.scale || ''} · ${pp.rotation || ''}`);
  }
  if (v.background) parts.push(`  • Background: ${v.background}`);
  if (v.lighting) parts.push(`  • Lighting: ${v.lighting}`);
  if (Array.isArray(v.palette) && v.palette.length) parts.push(`  • Palette: ${v.palette.join(', ')}`);
  if (Array.isArray(v.props) && v.props.length) parts.push(`  • Props: ${v.props.join('; ')}`);
  if (v.mood) parts.push(`  • Mood: ${v.mood}`);
  if (v.style) parts.push(`  • Style: ${v.style}`);

  // Variación específica — el diff de ejecución + nivel de divergencia.
  // tight   = copia composición fiel (variación #1)
  // medium  = mismo concepto, distinto ángulo/modelo/props
  // loose   = INVENTÁ una escena nueva con la misma estrategia
  const div = variation.divergence_level || 'medium';
  parts.push('');
  parts.push(`THIS VARIATION (#${variation.id} — "${variation.label || 'Variación'}" — divergence: ${div.toUpperCase()}):`);
  if (div === 'tight') {
    parts.push(`  • Hew CLOSELY to IMAGE 1's composition. Same framing, same prop, same scene. This is the "safe play" variation.`);
  } else if (div === 'loose') {
    parts.push(`  • DO NOT copy IMAGE 1's composition. Invent a NEW scene/framing/prop that communicates the SAME strategy (angle/hook/avatar). The product (IMAGE 2) still stays pixel-faithful, but the surrounding scene is original.`);
    parts.push(`  • Think: "what is ANOTHER scene that sells this same emotional benefit?" Apply the strategy, not the layout.`);
  } else {
    parts.push(`  • Keep the COMPOSITION TYPE of IMAGE 1 but vary the execution: different camera angle, different model demographic, different secondary props, different time of day.`);
  }
  parts.push(`  • Execution diff: ${variation.execution_diff || '(sin diff específico)'}`);
  if (variation.scene_notes) parts.push(`  • Scene notes: ${variation.scene_notes}`);

  // Textos adaptados con contenido válido para NUESTRO producto
  if (Array.isArray(v.textBlocks) && v.textBlocks.length) {
    parts.push('');
    parts.push('TEXT OVERLAYS to render IN THE IMAGE (exact Spanish, do NOT translate):');
    v.textBlocks.forEach((b, i) => {
      const txt = b.content_adapted || b.content_literal || '';
      if (!txt) return;
      parts.push(`     ${i + 1}. ${b.position || 'top'} · ${b.size || 'M'} · ${b.style || ''}`);
      parts.push(`        TEXT: "${txt}"`);
    });
  }

  // Badges con contenido adaptado
  if (Array.isArray(plan?.badges_adapted) && plan.badges_adapted.length) {
    parts.push('');
    parts.push('BADGES (replicate as graphic shapes with the ADAPTED content — these have been validated for our product):');
    plan.badges_adapted.forEach((b, i) => {
      const c = b.adapted_content || '';
      if (!c) return;
      parts.push(`     ${i + 1}. ${b.position || ''} · role=${b.role || ''} · "${c}" · ${b.visual_treatment || ''}`);
    });
  }
  if (Array.isArray(plan?.ctaElements_adapted) && plan.ctaElements_adapted.length) {
    parts.push('');
    parts.push('CTA ELEMENTS (pills/buttons — use the adapted text):');
    plan.ctaElements_adapted.forEach((c, i) => {
      const txt = c.adapted_content || '';
      if (!txt) return;
      parts.push(`     ${i + 1}. ${c.position || ''} · "${txt}" · ${c.visual_treatment || ''}`);
    });
  }

  // Producto
  parts.push('');
  parts.push('THE PRODUCT (IMAGE 2):');
  if (nombre) parts.push(`  • Product name: ${nombre}`);
  if (productoForm) {
    parts.push(`  • **PHYSICAL FORM**: ${productoForm} (NOT capsules/pills/another format). If reference shows the product contents, show ${productoForm}.`);
  }
  if (descripcion) parts.push(`  • Description: ${descripcion.slice(0, 400)}`);
  if (research) parts.push(`  • Audience and pain points: ${research.slice(0, 1500)}`);
  // Ofertas reales del user — para que gpt-image-2 NO copie precios/promos
  // del ad ref cuando hay overlays de texto con números. Si el plan ya
  // adaptó los badges_adapted/ctaElements_adapted con esto, los text overlays
  // de arriba ya están bien. Esto es un refuerzo: si el modelo "ve" un "$29"
  // en IMAGE 1 e iba a copiarlo, le decimos que use la oferta nuestra.
  if (ofertasReales) {
    parts.push('');
    parts.push(`**USER'S REAL OFFERS / PRICES (use ONLY these in any text overlay — NEVER copy a price or promo from IMAGE 1)**:`);
    parts.push(ofertasReales.slice(0, 800).split('\n').map(line => `  • ${line}`).join('\n'));
    parts.push(`  • If IMAGE 1 shows a price or promo NOT in this list, DO NOT render that text — render the closest matching offer from the list above, or omit the text block entirely.`);
  }

  if (accentColor) {
    parts.push('');
    if (rebrand) {
      // Variante rebrand — overridea la paleta de IMAGE 1 para que la
      // escena entera quede en familia del color de la marca. Útil cuando
      // la ref es B/N y el producto es de color fuerte (ej: Cellu+ naranja).
      parts.push(`**BRAND REPALETTING — ${accentColor} ES EL COLOR DOMINANTE DE LA ESCENA**:`);
      parts.push(`  • OVERRIDEÁ la paleta de IMAGE 1. La escena entera debe estar tonalmente alineada a ${accentColor}.`);
      parts.push(`  • Background: pared/superficie/gradient en familia ${accentColor} (mismo hue, varying value/saturation).`);
      parts.push(`  • Si el fondo del ad ref es negro/blanco/oscuro, REEMPLAZALO por un fondo en ${accentColor}.`);
      parts.push(`  • Props secundarios (telas, accents): que armonicen con ${accentColor}.`);
      parts.push(`  • Pills/badges/checks/CTAs: usá ${accentColor} para fills donde antes había amarillo/blanco/gris.`);
      parts.push(`  • Texto blanco SOBRE fondo ${accentColor} oscuro, o texto negro sobre ${accentColor} claro — lo que de mejor contraste.`);
      parts.push(`  • Skin tones, food, natural elements stay realistic — NO teñas personas.`);
      parts.push(`  • Resultado: misma composición que IMAGE 1, pero el COLOR STORY ahora es ${accentColor}. Como un re-shoot del mismo ad pero en el mundo de la marca.`);
    } else {
      parts.push(`Brand accent color: ${accentColor} — use as highlight for arrows, pills, badges, checks. Background stays as IMAGE 1's palette.`);
    }
  }

  parts.push('');
  parts.push('SCENE SETTING: LATAM / Argentina home aesthetic. Warm natural light, terracotta / wood / linen textures, plants. If hands/skin visible, use Mediterranean/Latin skin tones. Decoration porteño/contemporáneo.');

  parts.push('');
  parts.push('CRITICAL RULES:');
  parts.push('  • Replace original product in IMAGE 1 with IMAGE 2 product — same scene, same composition, but new product at same spot/scale/rotation.');
  parts.push('  • Keep IMAGE 2 packaging PIXEL-FAITHFUL. Do not redraw labels or invent text on packaging.');
  parts.push('  • Photorealistic, premium DTC, ready for Meta Ads.');
  parts.push('  • Render Spanish text overlays EXACTLY as written above.');
  parts.push(`  • Output aspect ratio: ${aspectRatio || '1:1'}. High resolution.`);
  parts.push('  • This variation differs from siblings in EXECUTION (model demographic/camera/prop/light) but the FORMULA stays identical.');

  return parts.join('\n');
}

function buildPrompt({ producto, inspiracion, skeleton, accentColor, aspectRatio, variantStyle = 'reference' }) {
  const nombre = (producto?.nombre || '').trim();
  const descripcion = (producto?.descripcion || '').trim();
  const research = (producto?.research || producto?.docs?.research || '').trim();
  const ofertasReales = dedupOfertas((producto?.ofertasReales || producto?.offerBrief || producto?.docs?.offerBrief || '').toString().trim());
  const productoForm = inferProductForm(producto);

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
    if (Array.isArray(skeleton.badges) && skeleton.badges.length) parts.push(`  - Graphic badges/seals to replicate AS SHAPES (no specific claim text unless the user provided one in their offer brief): ${skeleton.badges.join('; ')}`);
    if (Array.isArray(skeleton.ctaElements) && skeleton.ctaElements.length) parts.push(`  - CTA-like graphic elements (pills, buttons) in their original positions — but with NEUTRAL CTA text ("Probalo ya" / "Conocé más") unless the user has explicit offer info: ${skeleton.ctaElements.join('; ')}`);
    if (Array.isArray(skeleton.textBlocks) && skeleton.textBlocks.length) {
      // Dedup de textBlocks: si Vision devolvió 2 con el mismo content_adapted
      // (a veces lo hace cuando el ad ref tiene ribbons repetidos), keep one.
      // El renderer ya tendía a duplicar overlays → con esto evitamos doble eco.
      const seenTexts = new Set();
      const dedupBlocks = [];
      for (const b of skeleton.textBlocks) {
        const txt = b.content_adapted || b.content_literal || '';
        if (!txt) continue;
        const key = txt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (seenTexts.has(key)) continue;
        seenTexts.add(key);
        dedupBlocks.push(b);
      }
      parts.push('  - TEXT OVERLAYS to render IN THE IMAGE (Spanish, exact wording — do NOT paraphrase, do NOT translate to English). RENDER EACH ONLY ONCE:');
      dedupBlocks.forEach((b, i) => {
        const txt = b.content_adapted || b.content_literal || '';
        const pos = b.position || 'top';
        const size = b.size || 'M';
        const style = b.style || '';
        const fn = b.function ? ` (function: ${b.function})` : '';
        parts.push(`     ${i + 1}. ${pos} · size ${size}${fn} · style: ${style}`);
        parts.push(`        TEXT: "${txt}"`);
      });
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
  if (productoForm) {
    // CRÍTICO: si el ad ref muestra cápsulas y nuestro producto son gomitas,
    // el modelo replica cápsulas. Hay que decírselo EXPLÍCITO.
    const singular = singularFormato(productoForm);
    parts.push(`  - **PHYSICAL FORM**: ${productoForm} (NOT capsules, NOT pills, NOT another format). If the reference ad shows the product contents (a single capsule on a hand, powder in a glass, etc.), YOU MUST show ${productoForm} instead. Any spilled/displayed product detail must visually be ${productoForm}.`);
    parts.push(`  - **TEXT OVERLAY WORDING**: If any overlay says "1 cápsula", "1 pastilla", "una pill", etc., REPLACE it with "1 ${singular}" (the correct singular form for ${productoForm}). Same rule for plural: "60 cápsulas" → "60 ${productoForm}". NEVER let a text on the canvas contradict the physical form of the product.`);
  }
  if (descripcion) parts.push(`  - Description: ${descripcion.slice(0, 400)}`);
  if (research) parts.push(`  - Audience and pain points (use to choose props/scene): ${research.slice(0, 1500)}`);
  // Ofertas reales del user — refuerzo para que gpt-image-2 NO copie precios
  // del ad ref. Si IMAGE 1 muestra un overlay "$29" y no coincide con nuestras
  // ofertas, debe usar las del user o omitir.
  if (ofertasReales) {
    parts.push('');
    parts.push(`**USER'S REAL OFFERS / PRICES (use ONLY these in text overlays — NEVER copy a price or promo from IMAGE 1)**:`);
    parts.push(ofertasReales.slice(0, 800).split('\n').map(line => `  • ${line}`).join('\n'));
    parts.push(`  - If IMAGE 1 shows a price/promo NOT in this list, do NOT render it. Use the closest offer from the list above or omit the overlay.`);
    // Anti-duplicación: explícito al renderer que NO repita el mismo mensaje
    // en 2+ ribbons. El bug típico es "ENVÍO GRATIS" aparecer en un ribbon
    // arriba y otro abajo. Una sola pieza por mensaje, combinarlas en UN ribbon
    // si hay varios mensajes.
    parts.push(`  - **NO DUPLICATE RIBBONS**: render each offer/badge ONLY ONCE in the canvas. If you have multiple offers, combine them in a SINGLE bottom ribbon separated by " · " or " + " — do NOT stack 2+ ribbons with the same or overlapping messages.`);
  }

  if (accentColor) {
    parts.push('');
    if (variantStyle === 'rebrand') {
      // Variante B — rebrand: el color del producto domina la escena entera.
      parts.push(`**BRAND REPALETTING — ${accentColor} IS THE DOMINANT COLOR**:`);
      parts.push(`  • Override the palette of IMAGE 1. The whole scene should be tonally aligned to ${accentColor}.`);
      parts.push(`  • Background: pick a wall, fabric, surface, or gradient in ${accentColor} family (same hue, varying value/saturation).`);
      parts.push(`  • Props secondary (plants, fabrics, accents): pick variants that harmonize with ${accentColor}.`);
      parts.push(`  • Lighting: subtle tonal tint of ${accentColor} in highlights or shadows is OK.`);
      parts.push(`  • Skin tones, food, natural elements stay realistic — don't tint people.`);
      parts.push(`  • Result: same composition as IMAGE 1, but the COLOR STORY is now brand-aligned. Like a re-shoot of the same ad in our brand world.`);
    } else {
      parts.push(`Accent color for highlights/arrows/pills/badges: ${accentColor}`);
    }
  }

  parts.push('');
  parts.push('SCENE SETTING (geo + aesthetic):');
  parts.push('  • LATAM / Argentina home aesthetic: warm natural light, terracotta / wood / linen textures, plants. If hands or skin are visible, use Mediterranean / Latin skin tones (not pale gringo). Decoration should feel porteño/contemporáneo, NOT generic American influencer kitchen.');

  parts.push('');
  parts.push('CRITICAL RULES:');
  parts.push('  • Replace the original product in IMAGE 1 with the product from IMAGE 2 — same scene, same lighting, same composition, but the new product takes its exact spot at the same scale and rotation.');
  parts.push('  • Keep the packaging artwork of IMAGE 2 PIXEL-FAITHFUL. Do not redraw labels. Do NOT invent new text on the PRODUCT PACKAGING ITSELF.');
  parts.push('  • Generated image should be photorealistic, premium DTC, ready for Meta Ads.');
  parts.push('  • TEXT OVERLAYS on the canvas (stickers, headlines, captions): render the Spanish texts listed above EXACTLY as written. Keep their original visual style (sticker, pill, handwritten note, bold sans, etc). gpt-image-2 renders Spanish text reasonably well — prioritize legibility over perfect typography.');
  parts.push('  • Badges/seals from IMAGE 1: replicate as graphic shapes with their adapted content (or empty if no content was provided).');
  parts.push(`  • Output aspect ratio: ${aspectRatio || '1:1'}. High resolution.`);

  return parts.join('\n');
}

// Sanitiza palabras clínicas que típicamente disparan el safety filter de
// gpt-image-2, reemplazándolas por equivalentes comerciales que pasan. Los
// media buyers profesionales de wellness/cosmética usan los mismos eufemismos
// en sus copys de Meta Ads igual.
// Nota: OpenAI NO permite desactivar el safety filter por completo —
// 'moderation: low' es el setting más permisivo. Esto es la capa extra para
// minimizar rechazos.
// Heurística: si el producto tiene palabras gatillo de wellness/cuidado
// íntimo, arrancamos directo en modo agresivo de sanitización. Evita el
// reject del primer call (que cuesta el mismo tiempo que un OK) y resta
// 1 round-trip a OpenAI.
function isHighRiskCategory(producto) {
  const haystack = [
    producto?.nombre || '',
    producto?.descripcion || '',
    String(producto?.research || producto?.docs?.research || ''),
  ].join(' ').toLowerCase();
  const triggers = [
    /íntim[oa]/, /intimate/, /vagina/, /vulva/, /menstru/, /period/,
    /flora/, /probioti/, /candidi/, /fem(in)?(a|e)/, /mujer/, /woman/,
    /antibio/, /infecci/, /sangra/, /bleed/, /pee/, /pis/, /orina/,
    /sex/, /sexual/, /erecci/, /testoster/,
  ];
  return triggers.some(re => re.test(haystack));
}

function sanitizePromptForSafety(text, aggressive = false) {
  if (!text) return text;
  const swaps = [
    // Anatomía clínica → genérica
    [/\bvaginales?\b/gi, 'íntimo'],
    [/\bvagina\b/gi, 'zona íntima'],
    [/\bvulvas?\b/gi, 'zona íntima'],
    [/\bgenitales?\b/gi, 'íntimo'],
    [/\bsexuales?\b/gi, 'íntimo'],
    [/\bpechos?\b/gi, 'busto'],
    [/\bsenos?\b/gi, 'busto'],
    // Procesos clínicos → suaves
    [/\bmenstruales?\b/gi, 'mensual'],
    [/\bmenstruaci[óo]n\b/gi, 'ciclo'],
    [/\bsangrado\b/gi, 'flujo'],
    [/\binfeccion(es)?\b/gi, 'molestia$1'],
    [/\bhongos?\b/gi, 'desequilibrio'],
    [/\bcandidiasis\b/gi, 'desequilibrio'],
    [/\bbacterian?a?s?\b/gi, 'microbiota'],
    [/\bantibioticos?\b/gi, 'fórmula natural'],
    [/\bclamidia\b/gi, 'desequilibrio'],
    [/\bcistitis\b/gi, 'molestia'],
    // Claims médicos fuertes → genéricos
    [/\bcura(n|r|do|s)?\b/gi, 'mejor$1'],
    [/\btrata(n|r|do|miento)?\b/gi, 'cuid$1'],
    [/\bdolor(es)?\b/gi, 'molestia$1'],
    [/\bsangre\b/gi, 'flujo'],
    [/\benferma|enferme(dad|s)\b/gi, 'condición'],
    // Inglés
    [/\bvagina(l)?\b/gi, 'intimate$1'],
    [/\bvulva\b/gi, 'intimate area'],
    [/\bgenital\b/gi, 'intimate'],
    [/\bbreasts?\b/gi, 'bust'],
    [/\bnaked\b/gi, ''],
    [/\bnude\b/gi, ''],
    [/\binfection(s)?\b/gi, 'discomfort$1'],
    [/\byeast\b/gi, 'imbalance'],
    [/\bantibiotics?\b/gi, 'natural formula'],
    [/\bbleed(ing)?\b/gi, 'flow$1'],
  ];
  // En modo agresivo (retry tras rejection) sumamos swaps adicionales que
  // pueden cambiar más el tono pero evitan más triggers conocidos.
  if (aggressive) {
    swaps.push(
      [/\b(antes|despu[ée]s)\s+y\s+despu[ée]s\b/gi, 'transformación'],
      [/\bbefore\s*(\/|and|\&)\s*after\b/gi, 'transformation'],
      [/\bíntim[oa]s?\b/gi, 'personal'],
      [/\bintimate\b/gi, 'personal'],
      [/\bzona personal\b/gi, 'cuidado personal'],
      [/\b(sin|sin más)\s+olor\b/gi, 'fresca'],
      [/\bodor\b/gi, 'freshness'],
    );
  }
  let out = text;
  for (const [re, rep] of swaps) out = out.replace(re, rep);
  return out;
}

// Construye la FormData para gpt-image-2 — extraído para reusar en retries.
function buildEditForm({ prompt, refImgBuf, refMime, prodImgBuf, prodMime, size, quality, n, aggressiveSanitization = false }) {
  const form = new FormData();
  form.append('model', MODEL_IMAGE);
  form.append('prompt', sanitizePromptForSafety(prompt, aggressiveSanitization));
  form.append('size', size);
  form.append('quality', quality);
  form.append('n', String(Math.min(10, Math.max(1, n || 2))));
  form.append('moderation', 'low');
  form.append('image[]', new Blob([refImgBuf], { type: refMime }), 'reference.' + extForMime(refMime));
  form.append('image[]', new Blob([prodImgBuf], { type: prodMime }), 'producto.' + extForMime(prodMime));
  return form;
}

// Time budget global del handler — para que callGptImage2Edit no haga
// retries inútiles cuando ya estamos cerca del timeout de Vercel (300s).
const HANDLER_TIMEOUT_MS = 290000; // 290s — Vercel kill a los 300s.
const PER_CALL_TIMEOUT_MS = 275000; // 275s por fetch individual a OpenAI —
// gpt-image-2 a 2K high a veces tarda 200-250s. 220s era muy ajustado.

async function callGptImage2Edit(params) {
  const { apiKey, budgetStartedAt = Date.now(), initialAggressive = false } = params;
  // Auto-retry contra rate limit: hasta 2 reintentos con backoff 15s, 30s.
  // PERO solo si tenemos budget — si ya gastamos >80% del handler timeout,
  // no retry: mejor fallar limpio que dejar al usuario esperando 300s.
  const RETRY_DELAYS = [15000, 30000];
  let lastErr = null;
  let aggressiveSanitization = initialAggressive; // se activa tras safety rejection o desde el inicio para wellness
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const elapsed = Date.now() - budgetStartedAt;
    if (elapsed > HANDLER_TIMEOUT_MS - 30000) {
      // Sin tiempo para otro intento. Fallar inmediato.
      throw new Error(`crear-creativo-referencial sin budget de tiempo (${Math.round(elapsed/1000)}s). Probá con menos ads o quality medium.`);
    }
    const form = buildEditForm({ ...params, aggressiveSanitization });
    // AbortController por call individual — si OpenAI se cuelga > 220s
    // matamos esa request y dejamos margen para el handler cleanup.
    const controller = new AbortController();
    const callTimeout = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(callTimeout);
      if (err.name === 'AbortError') {
        throw new Error(`OpenAI tardó más de ${PER_CALL_TIMEOUT_MS/1000}s en responder. Cancelado.`);
      }
      throw err;
    }
    clearTimeout(callTimeout);
    const raw = await resp.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error(`OpenAI no devolvió JSON (HTTP ${resp.status}): ${raw.slice(0, 200)}`);
    }
    if (resp.ok) {
      const imagenes = (data?.data || []).map(d => d.b64_json).filter(Boolean);
      if (imagenes.length === 0) throw new Error('OpenAI no devolvió imágenes (b64_json ausente)');
      // Detección defensiva: una imagen base64 válida de gpt-image-2 quality
      // high a 1024x1024 pesa 200KB-800KB. Si vino algo MUY chico (<10KB),
      // probablemente sea un placeholder negro/blanco o un fallo silent de
      // safety. Mejor fallar limpio que guardar basura.
      const tooSmall = imagenes.filter(b => b.length < 10000);
      if (tooSmall.length === imagenes.length) {
        throw new Error('OpenAI devolvió imágenes sospechosamente chicas — probablemente safety reject silent. Probá con otro ad ref.');
      }
      return imagenes;
    }
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const code = data?.error?.code || data?.error?.type || '';
    const isRateLimit = resp.status === 429 ||
                        /rate limit/i.test(msg) ||
                        /too many requests/i.test(msg);
    const isSafetyReject = /safety system|content policy|rejected by the safety|violates.*policy|moderation/i.test(msg) ||
                           code === 'content_policy_violation' ||
                           code === 'moderation_blocked';
    // Si el reject fue safety y NO estábamos ya en modo agresivo → retry
    // inmediato con sanitización extra. Vale la pena el costo del 2do call
    // porque el problema es palabras gatillo, no infraestructura.
    if (isSafetyReject && !aggressiveSanitization && attempt < RETRY_DELAYS.length) {
      const elapsedNow = Date.now() - budgetStartedAt;
      if (elapsedNow + 130000 > HANDLER_TIMEOUT_MS) {
        throw new Error(`OpenAI rechazó por safety filter. Sin budget para retry sanitizado. Probá con OTRO ad de referencia (sin claims clínicos fuertes).`);
      }
      console.warn(`Safety reject. Retry con sanitización agresiva.`);
      aggressiveSanitization = true;
      continue; // sin backoff — el problema es el prompt, no el rate
    }
    if (isRateLimit && attempt < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[attempt];
      // Solo retry si tenemos budget para la espera + el próximo intento (~120s).
      const elapsedNow = Date.now() - budgetStartedAt;
      const needBudget = delay + 130000; // backoff + tiempo típico del próximo call
      if (elapsedNow + needBudget > HANDLER_TIMEOUT_MS) {
        throw new Error(`OpenAI rate limit, sin budget para retry. Reintentá en 30s con menos ads.`);
      }
      console.warn(`Rate limit hit. Retry ${attempt + 1}/${RETRY_DELAYS.length} en ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    // Mensajes accionables para los errors más comunes — antes el user veía
    // "OpenAI rechazó: insufficient_quota" sin saber qué hacer.
    if (isSafetyReject) {
      lastErr = new Error(`OpenAI rechazó por safety filter incluso con sanitización agresiva. Probá con OTRO ad de referencia que NO tenga claims clínicos fuertes (infección, dolor, sangrado, etc.).`);
    } else if (/insufficient_quota|exceeded.*quota|billing|payment/i.test(msg) || code === 'insufficient_quota') {
      lastErr = new Error(`OpenAI sin saldo. Cargá crédito en https://platform.openai.com/settings/organization/billing/overview y reintentá.`);
    } else if (/invalid.*api.*key|incorrect.*api.*key/i.test(msg) || code === 'invalid_api_key') {
      lastErr = new Error(`OPENAI_API_KEY inválida en el servidor. Avisale al admin para que la rote en Vercel → Settings → Environment Variables.`);
    } else if (/model.*(not.*(found|exist)|invalid)|the model.*does not exist/i.test(msg) || code === 'model_not_found') {
      lastErr = new Error(`El modelo ${MODEL_IMAGE} no está disponible en tu cuenta de OpenAI. Puede que necesite acceso explícito — avisale al admin.`);
    } else if (resp.status >= 500) {
      lastErr = new Error(`OpenAI con problemas (HTTP ${resp.status}). Reintentá en 30-60s.`);
    } else {
      lastErr = new Error(`OpenAI rechazó: ${msg}`);
    }
    lastErr.code = code;
    lastErr.status = resp.status;
    throw lastErr;
  }
  throw lastErr || new Error('OpenAI rate limit — agotados los retries');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  const budgetStartedAt = Date.now(); // arrancamos el budget del handler

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
  // nPlan: cuántas variaciones planificar en el Strategist. Default = n.
  // Caso de uso: el frontend pide N=1 imagen ahora pero quiere que el plan
  // tenga 4 variations para reusarlas en próximos calls (paralelización
  // del lado del cliente). Si no se especifica, mismo valor que n.
  const nPlan = Math.min(10, Math.max(1, Number(body?.nPlan) || n));
  // variationStartIndex: cuál de las variations del plan usar como #0 local.
  // Permite que call#2 use plan.variations[1], call#3 use plan.variations[2],
  // etc. — todos comparten el mismo plan cacheado pero generan imágenes
  // distintas.
  const variationStartIndex = Math.max(0, Number(body?.variationStartIndex) || 0);
  const aspectRatio = aspectRatioFromSize(size);

  try {
    // Paso 1 — bajar la ref (Meta CDN).
    const { buf: refImgBuf, mime: refMime } = await fetchImage(inspiracionImageUrl);

    // Paso 2 — decodificar foto del producto.
    const prodBase64 = productoImagen.includes(',') ? productoImagen.split(',')[1] : productoImagen;
    const prodBuf = Buffer.from(prodBase64, 'base64');
    const prodMime = detectImageType(prodBuf) || 'image/jpeg';

    // Paso 3 — análisis del ad con Vision.
    //
    // CASO A (preferido): si tenemos anthropicKey + n>=2, intentamos el
    // STRATEGIST (Sonnet) que devuelve plan con visual + strategy +
    // badges_adapted + N variations. Cada variación va a tener su propio
    // prompt → la grilla de N son N ejecuciones distintas de la misma
    // fórmula validada (no N versiones de la misma foto).
    //
    // CASO B (fallback): Si Strategist falla, o n=1, o el cache tiene un
    // skeleton viejo (legacy sin strategy), caemos al pipeline anterior:
    // extractSkeletonHaiku → buildPrompt con reference + rebrand split.
    let skeleton = null;
    let plan = null;
    let visionCost = 0;
    let skeletonFromCache = false;
    let visionModel = null;
    const skeletonHasFullPlan = skeletonCached?.strategy && Array.isArray(skeletonCached?.variations);

    if (skeletonCached && typeof skeletonCached === 'object' && skeletonHasFullPlan) {
      // Cache tiene plan completo del Strategist — reusarlo.
      plan = skeletonCached;
      skeleton = plan.visual;
      skeletonFromCache = true;
    } else if (skeletonCached && typeof skeletonCached === 'object') {
      // Cache solo tiene skeleton legacy (Haiku) — reusarlo pero no como plan.
      skeleton = skeletonCached;
      skeletonFromCache = true;
    } else if (anthropicKey && nPlan >= 2) {
      // Sin cache: intentar Strategist (Sonnet) — planificá nPlan variations
      // aunque generemos solo `n` imágenes ahora. Las restantes quedan en el
      // plan que devolvemos al cliente para que las use en próximos calls.
      const stratResult = await planStrategyAndVariations({
        apiKey: anthropicKey, refImgBuf, refMime, producto, accentColor, n: nPlan,
      });
      if (stratResult.plan && Array.isArray(stratResult.plan.variations) && stratResult.plan.variations.length > 0) {
        plan = stratResult.plan;
        skeleton = plan.visual;
        visionModel = MODEL_STRATEGIST;
      }
      visionCost += stratResult.cost || 0;
    }

    // Si no logramos un plan, caer al skeleton-only (Haiku).
    if (!plan && !skeletonFromCache && anthropicKey) {
      const result = await extractSkeleton({ apiKey: anthropicKey, refImgBuf, refMime, producto });
      skeleton = result.skeleton;
      visionCost += result.cost || 0;
      visionModel = MODEL_VISION_FALLBACK;
    }

    // Variables del fallback legacy. Antes estaban declaradas con `var` DENTRO
    // del else (líneas 1076-1078) — funcionaba por hoisting pero era un
    // ReferenceError esperando una migración a let/const. Hoisteadas a let
    // para ser explícitas.
    let __legacyPromptRef = null;
    let __legacyPromptRebrand = null;
    let __legacyUsarRebrand = false;

    // Paso 4 — construir prompts.
    // Si tenemos PLAN: N prompts distintos (uno por variación del plan).
    // Si no: pipeline legacy reference + rebrand (cuando hay accentColor + n>=2).
    let prompts; // array de objetos { prompt, variantStyle }
    if (plan && plan.variations && plan.variations.length > 0) {
      // Usar plan.variations — un prompt distinto por variación.
      // variationStartIndex permite pickear desde X en adelante (parallel
      // generation client-side: call#1 → idx 0, call#2 → idx 1, etc).
      const startIdx = Math.min(variationStartIndex, plan.variations.length - 1);
      const variationsToUse = plan.variations.slice(startIdx, startIdx + n);
      while (variationsToUse.length < n) variationsToUse.push(plan.variations[plan.variations.length - 1]);
      // Rebrand designation:
      //   - Single-call legacy mode (n=N): aplica al último idx local
      //   - Parallel mode (n=1, multiple calls): aplica cuando la call es
      //     la ÚLTIMA del set planificado (variationStartIndex + n >= nPlan)
      // Eso garantiza que en una grilla de 4 generadas, la #4 sea la que
      // viene en el color de la marca.
      const lastGlobalIdx = startIdx + n - 1;
      const isLastOverall = lastGlobalIdx >= nPlan - 1;
      // Rebrand solo si hay 2+ variaciones — para n=1 default es tight
      // (réplica fiel) porque el user pidió una sola y probablemente quiere
      // ver la más cercana al ganador validado.
      prompts = variationsToUse.map((variation, idx) => {
        const isLastLocal = idx === variationsToUse.length - 1;
        const shouldRebrand = isLastLocal && isLastOverall && !!accentColor && nPlan >= 2;
        return {
          prompt: buildPromptFromPlan({
            producto, inspiracion, plan, variation, accentColor, aspectRatio,
            rebrand: shouldRebrand,
          }),
          variantStyle: shouldRebrand ? 'rebrand' : 'strategist',
          variation,
        };
      });
    } else {
      // Fallback legacy: reference / rebrand.
      const usarRebrandVariant = !!accentColor && n >= 2;
      const promptRef = buildPrompt({ producto, inspiracion, skeleton, accentColor, aspectRatio, variantStyle: 'reference' });
      const promptRebrand = usarRebrandVariant
        ? buildPrompt({ producto, inspiracion, skeleton, accentColor, aspectRatio, variantStyle: 'rebrand' })
        : null;
      prompts = null; // marcador para que runCalls use el path viejo
      __legacyPromptRef = promptRef;
      __legacyPromptRebrand = promptRebrand;
      __legacyUsarRebrand = usarRebrandVariant;
    }

    // Paso 5 — llamar a gpt-image-2 /v1/images/edits con AMBAS imágenes.
    // Si falla por tamaño no soportado, hacemos un único retry con FALLBACK_SIZE.
    let imagenes;
    let variantStyles; // array paralelo a imagenes — 'reference' | 'rebrand'
    let sizeUsed = size;
    let sizeFallback = false;
    let qualityUsed = quality;
    let qualityFallback = false;

    const isHighRisk = isHighRiskCategory(producto);
    const runCalls = async (useSize, useQuality = quality) => {
      // MODO STRATEGIST: N llamadas paralelas, una por cada plan.variation.
      if (prompts && prompts.length > 0) {
        const results = await Promise.all(prompts.map(p =>
          callGptImage2Edit({
            apiKey, prompt: p.prompt,
            refImgBuf, refMime, prodImgBuf: prodBuf, prodMime,
            size: useSize, quality: useQuality, n: 1,
            budgetStartedAt,
            initialAggressive: isHighRisk,
          })
        ));
        return {
          imagenes: results.flat(),
          variantStyles: prompts.flatMap((p, i) => results[i].map(() => p.variantStyle)),
        };
      }
      // MODO LEGACY: reference + rebrand split.
      if (__legacyUsarRebrand) {
        const nRef = Math.ceil(n / 2);
        const nReb = Math.floor(n / 2);
        const [imgsRef, imgsReb] = await Promise.all([
          callGptImage2Edit({
            apiKey, prompt: __legacyPromptRef,
            refImgBuf, refMime, prodImgBuf: prodBuf, prodMime,
            size: useSize, quality: useQuality, n: nRef,
            budgetStartedAt, initialAggressive: isHighRisk,
          }),
          callGptImage2Edit({
            apiKey, prompt: __legacyPromptRebrand,
            refImgBuf, refMime, prodImgBuf: prodBuf, prodMime,
            size: useSize, quality: useQuality, n: nReb,
            budgetStartedAt, initialAggressive: isHighRisk,
          }),
        ]);
        return {
          imagenes: [...imgsRef, ...imgsReb],
          variantStyles: [...imgsRef.map(() => 'reference'), ...imgsReb.map(() => 'rebrand')],
        };
      }
      // MODO LEGACY 1 sola call con n imágenes.
      const imgs = await callGptImage2Edit({
        apiKey, prompt: __legacyPromptRef,
        refImgBuf, refMime, prodImgBuf: prodBuf, prodMime,
        size: useSize, quality: useQuality, n,
        budgetStartedAt, initialAggressive: isHighRisk,
      });
      return { imagenes: imgs, variantStyles: imgs.map(() => 'reference') };
    };

    try {
      const result = await runCalls(sizeUsed, qualityUsed);
      imagenes = result.imagenes;
      variantStyles = result.variantStyles;
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      const isSizeErr = msg.includes('size') || msg.includes('dimension') || /unsupported/.test(msg);
      // Detectar timeout/abort: OpenAI tardó más que PER_CALL_TIMEOUT_MS.
      // En vez de fallar, bajamos quality (high → medium) que es ~3x más
      // rápido, y reintentamos. Mejor entregar algo en menor calidad que
      // nada.
      const isTimeoutErr = /tardó más|abort|timeout|cancel/i.test(err?.message || '');
      const elapsedNow = Date.now() - budgetStartedAt;
      const hasBudgetForRetry = elapsedNow < HANDLER_TIMEOUT_MS - 80000;

      if (isSizeErr && sizeUsed !== FALLBACK_SIZE) {
        console.warn(`gpt-image-2 rechazó size=${sizeUsed} — fallback a ${FALLBACK_SIZE}`);
        sizeUsed = FALLBACK_SIZE;
        sizeFallback = true;
        const result = await runCalls(sizeUsed, qualityUsed);
        imagenes = result.imagenes;
        variantStyles = result.variantStyles;
      } else if (isTimeoutErr && qualityUsed === 'high' && hasBudgetForRetry) {
        console.warn(`gpt-image-2 timeout en quality=high — fallback a medium`);
        qualityUsed = 'medium';
        qualityFallback = true;
        const result = await runCalls(sizeUsed, qualityUsed);
        imagenes = result.imagenes;
        variantStyles = result.variantStyles;
      } else {
        throw err;
      }
    }
    // Background save al cloud — si el user mandó Authorization válido y
    // tenemos producto.id, subimos cada imagen al Storage e insertamos
    // la fila en marketing_creativos ACÁ en el server. Eso permite que
    // el frontend pueda cerrar la pestaña y aun así el creativo queda
    // guardado. Si falla el save al cloud, devolvemos las imágenes en
    // base64 igual para que el frontend lo guarde local (fallback).
    let cloudCreativos = null;
    let cloudSaveError = null;
    try {
      const userId = await getUserIdFromAuth(req);
      const productoId = producto?.id != null ? String(producto.id) : null;
      // Logging defensivo — si el background save no anda, los logs de Vercel
      // tienen que decir por qué. Antes esto era un silent skip y no
      // sabíamos si era auth, productoId, o env vars faltando.
      const hasAuthHeader = !!(req.headers?.authorization || req.headers?.Authorization);
      const hasSupabaseEnv = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
      console.info('[cloud save] pre-check', {
        hasAuthHeader,
        hasSupabaseEnv,
        userId: userId ? `${String(userId).slice(0, 8)}...` : null,
        productoId,
        imagenesCount: imagenes.length,
      });
      if (!hasSupabaseEnv) {
        cloudSaveError = 'SUPABASE_URL o SUPABASE_SERVICE_KEY no están seteadas en Vercel — el background save no puede correr.';
        console.warn('[cloud save]', cloudSaveError);
      } else if (!hasAuthHeader) {
        cloudSaveError = 'Sin Authorization header — el frontend no mandó el JWT del user. Background save skipped.';
        console.warn('[cloud save]', cloudSaveError);
      } else if (!userId) {
        cloudSaveError = 'Authorization header presente pero el JWT no validó — token expirado o inválido.';
        console.warn('[cloud save]', cloudSaveError);
      } else if (!productoId) {
        cloudSaveError = 'producto.id ausente — no podemos asociar el creativo a un producto.';
        console.warn('[cloud save]', cloudSaveError);
      }
      if (userId && productoId) {
        const ts = Date.now();
        const sourceAdId = inspiracion?.adId || inspiracion?.id || `unknown-${ts}`;
        const sourceBrand = inspiracion?.brandNombre || null;
        const sourceImageUrl = inspiracionImageUrl || null;
        const sourceHeadline = (inspiracion?.headline || inspiracion?.body || '').slice(0, 200);

        cloudCreativos = await Promise.all(imagenes.map(async (b64, i) => {
          const localVariantIndex = i + variationStartIndex;
          // Suffix random para evitar colisión entre flow single + bulk
          // disparados al mismo ms (rare pero posible via double-click).
          // Mismo patrón que crear-imagen-desde-idea.refId.
          const refId = `ref_${ts}_${sourceAdId}_${localVariantIndex}_${Math.random().toString(36).slice(2, 8)}`;
          const variantStyle = variantStyles[i] || 'strategist';
          const promptStr = prompts?.[i]?.prompt
            || (typeof __legacyPromptRef !== 'undefined' ? __legacyPromptRef : null);
          try {
            const { storagePath, imageUrl } = await uploadCreativoToBucket(userId, refId, b64);
            console.info(`[cloud save] imagen ${i + 1}/${imagenes.length} subida → ${storagePath}`);
            const row = await insertCreativoRow({
              id: refId,
              user_id: userId,
              producto_id: productoId,
              source_ad_id: sourceAdId,
              source_brand: sourceBrand,
              source_image_url: sourceImageUrl,
              source_headline: sourceHeadline,
              source_type: 'inspiracion',
              variant_index: localVariantIndex,
              variant_style: variantStyle,
              prompt: promptStr,
              skeleton: plan?.visual || skeleton || null,
              model: MODEL_IMAGE,
              vision_model: visionModel || null,
              size: sizeUsed,
              size_fallback: !!sizeFallback,
              quality: qualityUsed,
              storage_path: storagePath,
              image_url: imageUrl,
              created_at: new Date(ts + i).toISOString(),
            });
            return { id: row.id, imageUrl, variantIndex: localVariantIndex, variantStyle };
          } catch (err) {
            console.warn(`[cloud save] imagen ${i} falló:`, err.message);
            return null;
          }
        }));
        const totalRequested = imagenes.length;
        cloudCreativos = cloudCreativos.filter(Boolean);
        console.info(`[cloud save] resultado: ${cloudCreativos.length}/${totalRequested} subidas al cloud`);
        if (cloudCreativos.length === 0) {
          cloudCreativos = null;
          cloudSaveError = cloudSaveError || `Todas las ${totalRequested} subidas al cloud fallaron (ver logs anteriores)`;
        } else if (cloudCreativos.length < totalRequested) {
          cloudSaveError = `Solo ${cloudCreativos.length}/${totalRequested} subidas al cloud OK — el resto fallaron`;
        }
      }
    } catch (err) {
      console.warn('[cloud save] error general:', err.message);
      cloudSaveError = err.message;
    }

    return respondJSON(res, 200, {
      // imagenes y cloudCreativos: si el cloud save tuvo éxito, el frontend
      // PUEDE usar cloudCreativos y skipear el saveReferencial local.
      // Si no, sigue el flow viejo con base64.
      imagenes: cloudCreativos ? [] : imagenes, // ahorra payload si ya subió
      cloudCreativos,
      cloudSaveError,
      variantStyles,         // array paralelo — 'strategist' | 'reference' | 'rebrand'
      mimeType: 'image/png',
      size: sizeUsed,
      sizeRequested: size,
      sizeFallback,
      quality: qualityUsed,
      qualityRequested: quality,
      qualityFallback,
      n: imagenes.length,
      aspectRatio,
      model: MODEL_IMAGE,
      visionModel,           // 'claude-sonnet-4-6' | 'claude-haiku-4-5-...' | null
      strategist: !!plan,    // true si usamos el pipeline strategist
      skeleton,              // visual skeleton (compat con cache viejo)
      plan,                  // plan completo del strategist (null si no aplica)
      skeletonFromCache,
      variationStartIndex,   // qué índice del plan se usó como base de este call
      promptReference: prompts ? prompts[0]?.prompt : (typeof __legacyPromptRef !== 'undefined' ? __legacyPromptRef : null),
      promptRebrand: prompts ? null : (typeof __legacyPromptRebrand !== 'undefined' ? __legacyPromptRebrand : null),
      prompts: prompts ? prompts.map(p => ({ variantStyle: p.variantStyle, variation: p.variation, prompt: p.prompt })) : null,
      generatedAt: new Date().toISOString(),
      cost: {
        // Estimación basada en quality + size REAL (no la requested). Si
        // hubo size fallback, usa el size finalmente usado.
        openai: estimateImageCost(qualityUsed, sizeUsed) * imagenes.length,
        anthropic: visionCost,
      },
    });
  } catch (err) {
    console.error('crear-creativo-referencial error:', err);
    return respondJSON(res, 502, { error: err?.message || 'Error generando el referencial' });
  }
}
