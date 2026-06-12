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
// 6. Background save al cloud (mirror del flow de crear-creativo-referencial):
//    sube bytes al bucket + inserta fila en marketing_creativos. Permite que
//    el user cierre la pestaña sin perder el creativo.

import {
  getUserIdFromAuth,
  uploadCreativoToBucket,
  insertCreativoRow,
} from './_supabase-server.js';

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
  // 1. Prioridad: producto.formato explícito del Setup
  const explicit = (producto?.formato || '').toString().trim().toLowerCase();
  if (explicit && explicit !== 'otros' && explicit !== 'other') return explicit;
  // 2. Fallback: heurística regex
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

// Singular del formato — para overlays "1 cápsula" → "1 gomita".
function singularFormato(formato) {
  const map = {
    'gomitas': 'gomita', 'gummies': 'gummy',
    'cápsulas': 'cápsula', 'capsulas': 'cápsula', 'capsules': 'capsule', 'softgels': 'softgel', 'pastillas': 'pastilla',
    'gotas': 'gota', 'drops': 'drop',
    'comprimidos': 'comprimido', 'tabletas': 'tableta', 'tablets': 'tablet',
    'sachets': 'sachet', 'sachet': 'sachet',
    'shots': 'shot', 'shot': 'shot',
    'parches': 'parche', 'patches': 'patch',
    'sticks': 'stick', 'stick': 'stick', 'sticks individuales': 'stick',
    'polvo': 'porción', 'powder': 'scoop',
    'sérum': 'gota', 'serum': 'gota',
    'crema': 'aplicación', 'cream': 'application',
    'aceite': 'gota', 'oil': 'drop',
    'bálsamo': 'aplicación', 'balm': 'application',
    'spray': 'puff',
    'mascarilla': 'mascarilla', 'mask': 'mask',
  };
  return map[(formato || '').toLowerCase()] || formato;
}

// Dedup de líneas duplicadas en ofertasReales (case-insensitive).
function dedupOfertas(raw) {
  if (!raw) return '';
  const lines = String(raw).split(/\n+/).map(l => l.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    const k = l.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.join('\n');
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
    const sing = singularFormato(productoForm);
    parts.push(`  • **PHYSICAL FORM**: ${productoForm} (NOT capsules/pills/another format). If you show product contents, show ${productoForm}.`);
    parts.push(`  • **TEXT WORDING**: any overlay must use "${sing}" instead of "cápsula"/"pill"/"pastilla" — e.g. "1 ${sing} antes de dormir". Same plural: use "${productoForm}" instead of "cápsulas"/"pills". NEVER let canvas text contradict the physical form.`);
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
  const offer = dedupOfertas((producto?.ofertasReales || producto?.offerBrief || '').toString().trim());
  if (offer) {
    parts.push('');
    parts.push(`**REAL OFFERS / PRICES / CLAIMS (only these are valid — REPLACE any other price/promo in text overlays with these)**:`);
    parts.push(offer.slice(0, 800).split('\n').map(line => `  • ${line}`).join('\n'));
    parts.push(`  • If a text overlay mentions a price or promo NOT in this list, use the closest matching one from above instead.`);
    parts.push(`  • **NO DUPLICATE RIBBONS**: each offer/badge appears ONLY ONCE in the canvas. If you have multiple offers, combine them in a SINGLE ribbon separated by " · " or " + ". NEVER stack 2+ ribbons with overlapping messages (e.g. "ENVÍO GRATIS" repeated).`);
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

// Mismos timeouts que crear-creativo-referencial.js: si OpenAI se cuelga a
// los ~275s, cancelamos el fetch y dejamos margen para handler cleanup
// antes del kill de Vercel a 300s.
const PER_CALL_TIMEOUT_MS = 275000;
// Budget del handler — Vercel mata la function a los 300s. Si abortamos los
// fetches y cortamos retries antes de este techo, siempre alcanzamos a devolver
// un error limpio en vez de morir mid-fetch (lo que deja al cliente colgado).
const HANDLER_TIMEOUT_MS = 290000;

async function callGptImage2Edit({ apiKey, prompt, prodImgBuf, prodMime, size, quality, n, budgetStartedAt = Date.now() }) {
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
    // AbortController por call individual, BUDGET-AWARE: abortamos al mínimo
    // entre el techo (275s) y el budget restante del handler. Sin esto, un
    // retry o un preámbulo lento puede empujar el fetch más allá de los 300s
    // → Vercel mata la function mid-fetch sin responder → el cliente queda
    // colgado para siempre (barra de progreso en 0%).
    const remainingBudget = HANDLER_TIMEOUT_MS - (Date.now() - budgetStartedAt);
    const callTimeoutMs = Math.max(10000, Math.min(PER_CALL_TIMEOUT_MS, remainingBudget - 8000));
    const controller = new AbortController();
    const callTimeout = setTimeout(() => controller.abort(), callTimeoutMs);
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
        throw new Error(`OpenAI tardó más de ${Math.round(callTimeoutMs / 1000)}s en responder. Cancelado para no agotar el budget del handler.`);
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
      if (imagenes.length === 0) throw new Error('OpenAI no devolvió imágenes');
      return imagenes;
    }
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const code = data?.error?.code || data?.error?.type || '';
    const isRateLimit = resp.status === 429 || /rate limit/i.test(msg) || /too many requests/i.test(msg);
    if (isRateLimit && attempt < RETRY_DELAYS.length) {
      // Solo reintentamos si queda budget para el backoff + el próximo call
      // (~130s típico). Sin esto, esperar 30s y arrancar un call de 200s+ nos
      // pasa de los 300s → hard kill sin respuesta.
      const delay = RETRY_DELAYS[attempt];
      const elapsedNow = Date.now() - budgetStartedAt;
      if (elapsedNow + delay + 130000 > HANDLER_TIMEOUT_MS) {
        lastErr = new Error('OpenAI rate limit y sin budget para reintentar. Reintentá en 30s con menos imágenes a la vez.');
        lastErr.status = 429;
        throw lastErr;
      }
      await new Promise(r => setTimeout(r, delay));
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
  const budgetStartedAt = Date.now(); // budget del handler para los aborts

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
          budgetStartedAt,
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

    // Background save al cloud — mismo patrón que crear-creativo-referencial.
    // Sube cada imagen al bucket + inserta fila en marketing_creativos. Si el
    // user cierra la pestaña antes de que vuelva la response, el creativo ya
    // quedó persistido. Si falla, devolvemos imagenes en base64 igual.
    let cloudCreativos = null;
    let cloudSaveError = null;
    try {
      const userId = await getUserIdFromAuth(req);
      const productoId = producto?.id != null ? String(producto.id) : null;
      const hasAuthHeader = !!(req.headers?.authorization || req.headers?.Authorization);
      const hasSupabaseEnv = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
      console.info('[cloud save bandeja] pre-check', {
        hasAuthHeader, hasSupabaseEnv,
        userId: userId ? `${String(userId).slice(0, 8)}...` : null,
        productoId, imagenesCount: imagenes.length,
      });
      if (!hasSupabaseEnv) cloudSaveError = 'SUPABASE_URL/SUPABASE_SERVICE_KEY no seteadas';
      else if (!hasAuthHeader) cloudSaveError = 'Sin Authorization header del frontend';
      else if (!userId) cloudSaveError = 'JWT inválido o expirado';
      else if (!productoId) cloudSaveError = 'producto.id ausente en el payload';
      if (userId && productoId) {
        const ts = Date.now();
        const sourceIdeaId = idea?.id || `idea-${ts}`;
        cloudCreativos = await Promise.all(imagenes.map(async (b64, i) => {
          // Suffix random para evitar colisión entre flow single + bulk
          // disparados en la misma ms (raro pero posible con double-click).
          const refId = `idea_${ts}_${sourceIdeaId}_${i}_${Math.random().toString(36).slice(2, 8)}`;
          const variantStyle = variations[i]?.divergence_level || 'tight';
          try {
            const { storagePath, imageUrl } = await uploadCreativoToBucket(userId, refId, b64);
            const row = await insertCreativoRow({
              id: refId,
              user_id: userId,
              producto_id: productoId,
              source_ad_id: sourceIdeaId,
              source_brand: null,
              source_image_url: null,
              source_headline: (idea?.hook || '').slice(0, 200),
              source_type: 'bandeja-idea',
              variant_index: i,
              variant_style: variantStyle,
              prompt: prompts[i]?.prompt || null,
              skeleton: null,
              model: MODEL,
              vision_model: null,
              size: sizeUsed,
              size_fallback: !!sizeFallback,
              quality,
              storage_path: storagePath,
              image_url: imageUrl,
              created_at: new Date(ts + i).toISOString(),
            });
            return { id: row.id, imageUrl, variantIndex: i, variantStyle };
          } catch (err) {
            console.warn(`[cloud save bandeja] imagen ${i} falló:`, err.message);
            return null;
          }
        }));
        const total = cloudCreativos.length;
        cloudCreativos = cloudCreativos.filter(Boolean);
        console.info(`[cloud save bandeja] ${cloudCreativos.length}/${total} OK`);
        if (cloudCreativos.length === 0) {
          cloudCreativos = null;
          cloudSaveError = cloudSaveError || 'Todas las subidas fallaron';
        }
      }
    } catch (err) {
      console.warn('[cloud save bandeja] error general:', err.message);
      cloudSaveError = err.message;
    }

    return respondJSON(res, 200, {
      imagenes: cloudCreativos ? [] : imagenes, // ahorra payload si ya subió
      cloudCreativos,
      cloudSaveError,
      variantStyles: variations.map(v => v.divergence_level),
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
