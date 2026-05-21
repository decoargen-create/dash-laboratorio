// Edición conversacional de un creativo ya generado.
//
// POST /api/marketing/edit-creative
// Body: { imageBase64, mimeType?, instruccion, formato?, quality? }
//
// Toma un creativo existente + una instrucción en lenguaje natural
// ("el hook más grande", "fondo más claro", "sacá el sello de abajo")
// y devuelve la versión editada usando gpt-image-1 vía /v1/images/edits.
// Evita el ciclo de "Regenerar a ciegas" — el user dirige el cambio.

// gpt-image-1 cobra por imagen según tamaño + calidad (misma tabla que
// generate-creative.js — referencia pública de OpenAI).
const COST_TABLE = {
  '1024x1024': { low: 0.011, medium: 0.042, high: 0.167 },
  '1024x1536': { low: 0.016, medium: 0.063, high: 0.25 },
  '1536x1024': { low: 0.016, medium: 0.063, high: 0.25 },
};

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

function sizeForFormato(formato) {
  if (formato === 'video') return '1024x1536';
  return '1024x1024';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respondJSON(res, 500, { error: 'OPENAI_API_KEY no configurada en el servidor' });
  }

  const body = await readBody(req);
  const imageBase64 = body?.imageBase64;
  const instruccion = (body?.instruccion || '').trim();
  if (!imageBase64) return respondJSON(res, 400, { error: 'Falta imageBase64 en el body' });
  if (!instruccion) return respondJSON(res, 400, { error: 'Falta la instrucción de edición' });

  const quality = ['low', 'medium', 'high'].includes(body?.quality) ? body.quality : 'medium';
  // Usamos el size REAL del creativo original si vino — sino lo derivamos
  // del formato. Re-derivar a ciegas hacía que /v1/images/edits reescale.
  const VALID_SIZES = ['1024x1024', '1024x1536', '1536x1024'];
  const size = VALID_SIZES.includes(body?.size) ? body.size : sizeForFormato(body?.formato);
  const mimeType = ['image/png', 'image/jpeg', 'image/webp'].includes(body?.mimeType) ? body.mimeType : 'image/png';
  // Filename coherente con el mime — gpt-image-1 en /edits es quisquilloso
  // si el nombre del archivo no matchea el tipo real.
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';

  // El prompt de edición: la instrucción del user + un marco para que
  // gpt-image-1 mantenga el resto del creativo intacto.
  const prompt = `Editá este creativo publicitario para Meta Ads aplicando SOLO el siguiente cambio pedido, manteniendo el resto de la composición, estilo y textos igual:\n\n"${instruccion}"\n\nSi el cambio afecta texto, renderizá el texto en español, legible y sin errores. Resultado: la misma pieza publicitaria con el ajuste aplicado, calidad profesional.`;

  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('image', new Blob([imageBuffer], { type: mimeType }), `creativo.${ext}`);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('n', '1');

    const resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });

    // Parseo defensivo — OpenAI puede devolver gateway errors en texto.
    const raw = await resp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return respondJSON(res, 502, {
        error: `OpenAI devolvió una respuesta no-JSON (HTTP ${resp.status}) — error transitorio. Reintentá.`,
      });
    }
    if (!resp.ok) {
      const msg = data?.error?.message || `HTTP ${resp.status}`;
      return respondJSON(res, resp.status === 429 ? 429 : 502, { error: `OpenAI rechazó la edición: ${msg}` });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return respondJSON(res, 502, { error: 'OpenAI no devolvió imagen editada' });

    const costEstimado = COST_TABLE[size]?.[quality] ?? 0.05;

    return respondJSON(res, 200, {
      imageBase64: b64,
      mimeType: 'image/png',
      size,
      quality,
      formato: body?.formato || 'static',
      model: 'gpt-image-1',
      generatedAt: new Date().toISOString(),
      cost: { openai: costEstimado },
    });
  } catch (err) {
    console.error('edit-creative error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error editando el creativo' });
  }
}
