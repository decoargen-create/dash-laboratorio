// Genera N imágenes desde una IDEA de la Bandeja — distinto a
// crear-creativo-referencial.js (que replica un ad de competencia). Acá NO
// hay ref de competidor: la idea ya tiene el brief visual armado por Claude.
//
// Flujo:
// 1. Tomamos los campos de la idea: hook, descripcionImagen, estiloVisual,
//    escenarioNarrativo, painPoint, ángulo, textoEnImagen.
// 2. Foto del producto se pasa como única imagen input a gpt-image-2.
// 3. Para cada variación de las N, construimos un prompt con un
//    execution_diff diferente (variar modelo / ángulo cámara / props / etc.)
//    manteniendo el concepto.
// 4. Llamadas PARALELAS a gpt-image-2 /v1/images/edits con n=1 cada una.
// 5. Devolvemos N imágenes en b64.

const MODEL = 'gpt-image-2';
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

function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp';
  return null;
}

function extForMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

function inferProductForm(producto) {
  const hay = [producto?.nombre, producto?.descripcion, String(producto?.research || '')].join(' ').toLowerCase();
  const patterns = [
    { canon: 'gomitas',   re: /\b(gomitas?|gummies)\b/ },
    { canon: 'cápsulas',  re: /\b(c[áa]psulas?|capsules?|softgels?|pastillas?)\b/ },
    { canon: 'polvo',     re: /\b(polvo|powder)\b/ },
    { canon: 'sérum',     re: /\b(s[ée]rum|serum)\b/ },
    { canon: 'crema',     re: /\b(crema|cream|loci[óo]n)\b/ },
    { canon: 'gotas',     re: /\b(gotas|drops)\b/ },
    { canon: 'aceite',    re: /\b(aceite|oil)\b/ },
    { canon: 'bálsamo',   re: /\b(b[áa]lsamo|balm)\b/ },
    { canon: 'spray',     re: /\b(spray)\b/ },
    { canon: 'stick',     re: /\b(stick|barra)\b/ },
    { canon: 'shot',      re: /\b(shot|chupito)\b/ },
  ];
  for (const p of patterns) if (p.re.test(hay)) return p.canon;
  return null;
}

// Sanitiza palabras clínicas trigger del safety filter (igual que el otro endpoint).
function sanitizePromptForSafety(text) {
  if (!text) return text;
  const swaps = [
    [/\bvaginales?\b/gi, 'íntimo'],
    [/\bvagina\b/gi, 'zona íntima'],
    [/\bvulvas?\b/gi, 'zona íntima'],
    [/\bgenitales?\b/gi, 'íntimo'],
    [/\bsexuales?\b/gi, 'íntimo'],
    [/\bmenstruales?\b/gi, 'mensual'],
    [/\bmenstruaci[óo]n\b/gi, 'ciclo'],
    [/\bsangrado\b/gi, 'flujo'],
    [/\binfeccion(es)?\b/gi, 'molestia$1'],
    [/\bhongos?\b/gi, 'desequilibrio'],
    [/\bcandidiasis\b/gi, 'desequilibrio'],
    [/\bvagina(l)?\b/gi, 'intimate$1'],
    [/\bnaked\b/gi, ''],
    [/\bnude\b/gi, ''],
  ];
  let out = text;
  for (const [re, rep] of swaps) out = out.replace(re, rep);
  return out;
}

// Construye prompt para UNA variación de la idea.
function buildPromptForIdeaVariation({ idea, producto, accentColor, aspectRatio, variation }) {
  const productoForm = inferProductForm(producto);
  const parts = [];

  parts.push('Premium DTC creative for Meta Ads — editorial production, scroll-stop composition. PHOTOREALISTIC, NO AI plastic look, NO uncanny faces, NO garbled text.');

  parts.push('');
  parts.push('YOU RECEIVE ONE IMAGE: the product (keep its shape, color, label, packaging PIXEL-FAITHFUL — do NOT redraw the label).');

  // El brief de la idea (lo que ya armó Claude cuando se generó la idea)
  parts.push('');
  parts.push('CREATIVE BRIEF (from the idea — this is what we want to communicate):');
  if (idea?.hook) parts.push(`  • Hook: "${idea.hook}"`);
  if (idea?.angulo) parts.push(`  • Angle: ${idea.angulo}`);
  if (idea?.painPoint) parts.push(`  • Pain point: ${idea.painPoint}`);
  if (idea?.escenarioNarrativo) parts.push(`  • Scene/narrative: ${idea.escenarioNarrativo}`);
  if (idea?.descripcionImagen) parts.push(`  • Visual brief (the "what to show"): ${idea.descripcionImagen}`);
  if (idea?.estiloVisual) parts.push(`  • Visual style: ${idea.estiloVisual}`);
  if (idea?.publicoSugerido) parts.push(`  • Target audience: ${idea.publicoSugerido}`);
  if (idea?.creenciaApalancada) parts.push(`  • Leverages belief: ${idea.creenciaApalancada}`);

  // Variación específica (execution diff)
  parts.push('');
  parts.push(`THIS VARIATION (#${variation.id} — "${variation.label}"):`);
  parts.push(`  • ${variation.execution_diff}`);

  // Producto
  parts.push('');
  parts.push('PRODUCT:');
  if (producto?.nombre) parts.push(`  • Name: ${producto.nombre}`);
  if (productoForm) {
    parts.push(`  • **PHYSICAL FORM**: ${productoForm} (NOT capsules/pills/another format). If you show product contents, show ${productoForm}.`);
  }
  if (producto?.descripcion) parts.push(`  • Description: ${producto.descripcion.slice(0, 400)}`);
  if (producto?.research) parts.push(`  • Audience and pain: ${String(producto.research).slice(0, 1500)}`);

  // Texto dentro de la imagen
  if (idea?.textoEnImagen) {
    parts.push('');
    parts.push(`TEXT OVERLAYS to render IN THE IMAGE (exact Spanish, do NOT translate, render legibly):`);
    parts.push(idea.textoEnImagen);
  }

  // Ofertas reales — ofertasReales tiene prioridad (campo focalizado del user
  // en Setup). offerBrief es fallback. Si hay overlays con precios/promos en
  // textoEnImagen que no coinciden, hay que reemplazarlos por estos.
  const offer = (producto?.ofertasReales || producto?.offerBrief || '').toString().trim();
  if (offer) {
    parts.push('');
    parts.push(`**REAL OFFERS / PRICES / CLAIMS (only these are valid — REPLACE any other price/promo in text overlays with these)**:`);
    parts.push(offer.slice(0, 800).split('\n').map(line => `  • ${line}`).join('\n'));
    parts.push(`  • If a text overlay mentions a price or promo NOT in this list, use the closest matching one from above instead.`);
  } else {
    parts.push('');
    parts.push('NO OFFERS DECLARED — do NOT invent prices, % off, FDA, ANMAT, claims. Keep text neutral (CTA like "Probalo ya", "Conocé más").');
  }

  if (accentColor) {
    parts.push('');
    parts.push(`Brand accent color: ${accentColor} — use for highlights, badges, accents.`);
  }

  parts.push('');
  parts.push('SCENE SETTING: LATAM / Argentina aesthetic. Warm natural light. If hands/skin visible, Mediterranean/Latin skin tones. Porteño/contemporáneo decoration. NOT generic American influencer kitchen.');

  parts.push('');
  parts.push('CRITICAL RULES:');
  parts.push('  • Photorealistic, premium DTC, ready for Meta Ads.');
  parts.push('  • Keep the product packaging PIXEL-FAITHFUL.');
  parts.push('  • Render Spanish text overlays EXACTLY as written.');
  parts.push(`  • Output aspect ratio: ${aspectRatio || '1:1'}. High resolution.`);

  return parts.join('\n');
}

// Genera N variations con divergencia progresiva (tight → loose).
function buildVariations(n, idea) {
  const variations = [];
  // v1: literal interpretation del brief
  variations.push({
    id: 1,
    label: 'Brief literal',
    divergence_level: 'tight',
    execution_diff: `Interpretá el brief visual literalmente. Si dice "manos sosteniendo el producto en cocina porteña", eso es exactamente lo que mostrás. Foto editorial premium, plano cerrado.`,
  });
  if (n >= 2) {
    variations.push({
      id: 2,
      label: 'Mismo concepto, distinto plano',
      divergence_level: 'medium',
      execution_diff: `Mismo escenario que v1 pero plano DISTINTO: si v1 es plano cerrado, ésta es plano medio o lifestyle. Cambia el ángulo de cámara. Mantenê el hook y el ángulo.`,
    });
  }
  if (n >= 3) {
    variations.push({
      id: 3,
      label: 'Reinterpretación libre',
      divergence_level: 'loose',
      execution_diff: `INVENTÁ una escena nueva que comunique el MISMO hook y painPoint. Si el brief es "kitchen", probá "café porteño" o "habitación lifestyle". Producto sigue siendo protagonista pero el escenario es original. Foto distinta.`,
    });
  }
  while (variations.length < n) {
    const i = variations.length + 1;
    variations.push({
      id: i,
      label: `Variación creativa ${i}`,
      divergence_level: 'loose',
      execution_diff: `Otra reinterpretación libre — escena, props, modelo demográfico distintos. Comunica el mismo hook + ángulo pero con composición original. Variation ${i} de ${n}.`,
    });
  }
  return variations.slice(0, n);
}

function sizeForFormato(formato, requested) {
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

async function callGptImage2Edit({ apiKey, prompt, prodImgBuf, prodMime, size, quality, n }) {
  const RETRY_DELAYS = [15000, 30000];
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', sanitizePromptForSafety(prompt));
    form.append('size', size);
    form.append('quality', quality);
    form.append('n', String(Math.min(10, Math.max(1, n || 1))));
    form.append('moderation', 'low');
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
    if (resp.ok) {
      const imagenes = (data?.data || []).map(d => d.b64_json).filter(Boolean);
      if (imagenes.length === 0) throw new Error('OpenAI no devolvió imágenes');
      return imagenes;
    }
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const code = data?.error?.code || data?.error?.type || '';
    const isRateLimit = resp.status === 429 || /rate limit/i.test(msg) || /too many requests/i.test(msg);
    if (isRateLimit && attempt < RETRY_DELAYS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      continue;
    }
    lastErr = new Error(`OpenAI rechazó: ${msg}`);
    lastErr.code = code;
    lastErr.status = resp.status;
    throw lastErr;
  }
  throw lastErr || new Error('OpenAI rate limit — retries agotados');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'OPENAI_API_KEY no configurada' });

  const body = await readBody(req);
  const { idea, producto, productoImagen, accentColor } = body || {};
  if (!idea) return respondJSON(res, 400, { error: 'Falta idea' });
  if (!producto?.nombre) return respondJSON(res, 400, { error: 'Falta producto.nombre' });
  if (!productoImagen || typeof productoImagen !== 'string') {
    return respondJSON(res, 400, { error: 'Falta productoImagen (data URL). Cargá la foto del producto en Setup.' });
  }

  const quality = ['low', 'medium', 'high'].includes(body?.quality) ? body.quality : DEFAULT_QUALITY;
  const n = Math.min(10, Math.max(1, Number(body?.n) || 2));
  let size = sizeForFormato(idea?.formato, body?.size);
  const aspectRatio = aspectRatioFromSize(size);

  try {
    // Decode producto image
    const prodBase64 = productoImagen.includes(',') ? productoImagen.split(',')[1] : productoImagen;
    const prodBuf = Buffer.from(prodBase64, 'base64');
    const prodMime = detectImageType(prodBuf) || 'image/jpeg';

    // Build N variations + prompts
    const variations = buildVariations(n, idea);
    const prompts = variations.map(variation => ({
      variation,
      prompt: buildPromptForIdeaVariation({ idea, producto, accentColor, aspectRatio, variation }),
    }));

    // Run N parallel calls with size fallback.
    let imagenes;
    let sizeUsed = size;
    let sizeFallback = false;

    const runAll = async (useSize) => {
      const results = await Promise.all(prompts.map(p =>
        callGptImage2Edit({
          apiKey, prompt: p.prompt,
          prodImgBuf: prodBuf, prodMime,
          size: useSize, quality, n: 1,
        })
      ));
      return results.flat();
    };

    try {
      imagenes = await runAll(sizeUsed);
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      const isSizeErr = msg.includes('size') || msg.includes('dimension') || /unsupported/.test(msg);
      if (isSizeErr && sizeUsed !== FALLBACK_SIZE) {
        sizeUsed = FALLBACK_SIZE;
        sizeFallback = true;
        imagenes = await runAll(sizeUsed);
      } else {
        throw err;
      }
    }

    return respondJSON(res, 200, {
      imagenes,
      variantStyles: variations.map(v => v.divergence_level), // 'tight'|'medium'|'loose'
      mimeType: 'image/png',
      size: sizeUsed,
      sizeRequested: size,
      sizeFallback,
      quality,
      n: imagenes.length,
      aspectRatio,
      model: MODEL,
      sourceType: 'bandeja-idea',
      sourceIdeaId: idea.id,
      prompts: prompts.map(p => ({ variantStyle: p.variation.divergence_level, variation: p.variation, prompt: p.prompt })),
      generatedAt: new Date().toISOString(),
      cost: { openai: (COST_ESTIMATE[quality] ?? 0.18) * imagenes.length },
    });
  } catch (err) {
    console.error('crear-imagen-desde-idea error:', err);
    return respondJSON(res, 502, { error: err?.message || 'Error generando imagen' });
  }
}
