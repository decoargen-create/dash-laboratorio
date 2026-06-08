// Genera 2 variaciones de creativo "referencial" — adaptado del estilo
// de un ad ganador de competencia al producto del anunciante.
//
// Flujo:
// 1. Bajamos la imagen de referencia (Meta CDN, URL corta vida).
// 2. (Opcional) Pasamos por Claude vision para extraer skeleton estructurado.
//    Para v1 usamos directamente la data ya analizada del ad (si existe)
//    + el texto del ad + el research del producto.
// 3. Construimos un prompt fuerte que diga: "mantené el ESTILO/COMPOSICIÓN
//    de la ref, pero adaptado al producto X (foto adjunta), con su escena,
//    paleta y mensaje".
// 4. Llamamos a gpt-image-2 /v1/images/edits con la foto del producto
//    como referencia → 2 variaciones (n=2).
// 5. Devolvemos los 2 base64.

const MODEL = 'gpt-image-2';
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

function sizeForFormato(formato) {
  return formato === 'video' ? '1024x1536' : '1024x1024';
}

// Prompt builder. Combina estilo de la ref + adaptación al producto.
function buildPrompt({ producto, inspiracion, accentColor }) {
  const nombre = (producto?.nombre || '').trim();
  const descripcion = (producto?.descripcion || '').trim();
  const research = (producto?.research || producto?.docs?.research || '').trim();
  const adBody = (inspiracion?.body || '').trim();
  const adHeadline = (inspiracion?.headline || '').trim();
  // Si tenemos análisis profundo del ad (de deep-analyze), úsalo.
  const visual = inspiracion?.analysis?.visual || inspiracion?.visual || '';
  const angle = inspiracion?.analysis?.angle || '';
  const why = inspiracion?.analysis?.why_it_works || '';

  const parts = [];
  parts.push('Premium DTC creative for Meta Ads in the Argentine / LatAm market — premium production, editorial composition, cinematic lighting, scroll-stop design. Realistic photography, NO AI plastic look, NO uncanny faces.');

  parts.push('');
  parts.push('REFERENCE STYLE (a winning competitor ad — replicate the COMPOSITION, COMPOSITION TYPE, MOOD, LIGHTING and FORMAT, NOT the brand or the product):');
  if (visual) parts.push(`Visual: ${visual}`);
  if (angle) parts.push(`Emotional angle: ${angle}`);
  if (adHeadline) parts.push(`Headline tone (for reference, do NOT include text in the image): "${adHeadline.slice(0, 200)}"`);
  if (adBody) parts.push(`Body tone: "${adBody.slice(0, 300)}"`);
  if (why) parts.push(`Why it works: ${why}`);

  parts.push('');
  parts.push('THE PRODUCT (use the attached photo as the EXACT product — keep its shape, color, label and packaging IDENTICAL, do NOT redraw the label, do NOT invent text on the packaging):');
  if (nombre) parts.push(`Product name: ${nombre}`);
  if (descripcion) parts.push(`Product description: ${descripcion.slice(0, 400)}`);
  if (research) parts.push(`Target audience and pain points (use to choose the scene): ${research.slice(0, 1500)}`);

  if (accentColor) {
    parts.push('');
    parts.push(`Accent color: ${accentColor} — use it sparingly for highlights, arrows, or focal points.`);
  }

  parts.push('');
  parts.push('IMPORTANT: NO text in the image, NO headlines, NO captions, NO labels other than the real product label. Just the visual: scene + product + props. Modern editorial photography style.');
  return parts.join('\n');
}

async function callGptImage2Edit({ apiKey, prompt, productImgBuf, mimeType, size, quality }) {
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  form.append('n', '2'); // 2 variaciones por llamada
  form.append('image', new Blob([productImgBuf], { type: mimeType }), 'producto' + (mimeType === 'image/png' ? '.png' : '.jpg'));

  const resp = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });
  const raw = await resp.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`OpenAI no devolvió JSON (HTTP ${resp.status})`);
  }
  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`OpenAI rechazó: ${msg}`);
  }
  const imagenes = (data?.data || []).map(d => d.b64_json).filter(Boolean);
  if (imagenes.length === 0) throw new Error('OpenAI no devolvió imágenes (b64_json ausente)');
  return imagenes;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respondJSON(res, 500, {
      error: 'OPENAI_API_KEY no configurada en el servidor.',
    });
  }

  const body = await readBody(req);
  const { producto, inspiracion, productoImagen, accentColor } = body || {};

  if (!producto?.nombre) {
    return respondJSON(res, 400, { error: 'Falta producto.nombre' });
  }
  if (!productoImagen || typeof productoImagen !== 'string') {
    return respondJSON(res, 400, { error: 'Falta productoImagen (data URL). Cargá la foto del producto en Setup.' });
  }
  if (!inspiracion) {
    return respondJSON(res, 400, { error: 'Falta el ad de inspiración' });
  }

  const quality = ['low', 'medium', 'high'].includes(body?.quality) ? body.quality : 'medium';
  const size = sizeForFormato(inspiracion?.formato);

  // Decodificar la foto del producto.
  const prodBase64 = productoImagen.includes(',') ? productoImagen.split(',')[1] : productoImagen;
  const prodBuf = Buffer.from(prodBase64, 'base64');
  const prodMime = detectImageType(prodBuf) || 'image/jpeg';

  const prompt = buildPrompt({ producto, inspiracion, accentColor });

  try {
    const imagenes = await callGptImage2Edit({
      apiKey, prompt, productImgBuf: prodBuf, mimeType: prodMime, size, quality,
    });
    return respondJSON(res, 200, {
      imagenes,                       // array de 2 base64
      mimeType: 'image/png',
      size,
      quality,
      model: MODEL,
      prompt,
      generatedAt: new Date().toISOString(),
      cost: { openai: (COST_ESTIMATE[quality] ?? 0.07) * imagenes.length },
    });
  } catch (err) {
    console.error('crear-creativo-referencial error:', err);
    return respondJSON(res, 502, { error: err?.message || 'Error generando el referencial' });
  }
}
