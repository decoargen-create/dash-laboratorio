// Generación del creativo estático final a partir de un brief de la Bandeja.
//
// POST /api/marketing/generate-creative
// Body: { idea: { promptGeneradorImagen, descripcionImagen, textoEnImagen,
//                  hook, formato, estiloVisual } }
//
// Usa gpt-image-1 de OpenAI (la misma OPENAI_API_KEY que ya usa Whisper en
// deep-analyze.js → no suma setup). Devuelve la imagen en base64 + el costo.
//
// On-demand: el cliente lo llama solo para las ideas que el user quiere
// producir (no en bulk durante el pipeline — sería caro y la mayoría de las
// ideas no se usan).

// gpt-image-1 cobra por imagen según tamaño + calidad. Tabla de costo
// estimado en USD (referencia pública de OpenAI). La usamos para loguear en
// GastosStack — el endpoint igual devuelve `usage` crudo por si más adelante
// queremos costo exacto por tokens.
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

// El formato del brief define el aspect ratio del creativo:
//   static  → 1:1 cuadrado (feed)
//   carrusel→ 1:1 cuadrado (cada slide)
//   video   → 9:16 vertical (placeholder/thumbnail de stories/reels)
function sizeForFormato(formato) {
  if (formato === 'video') return '1024x1536';
  return '1024x1024';
}

// Construimos el prompt para gpt-image-1. Preferimos el prompt rico del
// generador (promptGeneradorImagen); si la idea no lo tiene —caso típico
// de una idea "réplica" del deep-analyze— armamos la escena desde el
// hook + ángulo + copy. Así el creativo se puede generar para CUALQUIER
// idea de la Bandeja, no solo las del generador.
function buildImagePrompt(idea) {
  const estilo = (idea.estiloVisual || '').trim();
  const hook = (idea.hook || '').trim();
  let textoEnImagen = (idea.textoEnImagen || '').trim();
  // Si no hay layout de texto explícito, usamos el hook como texto del ad.
  if (!textoEnImagen && hook) {
    textoEnImagen = `HOOK (texto principal, grande y bold): "${hook}"`;
  }

  let escena = (idea.promptGeneradorImagen || idea.descripcionImagen || '').trim();
  if (!escena) {
    const piezas = [];
    if (hook) piezas.push(`El creativo comunica: "${hook}"`);
    if (idea.angulo) piezas.push(`Ángulo: ${idea.angulo}`);
    if (idea.painPoint) piezas.push(`Punto de dolor del cliente: ${idea.painPoint}`);
    const copy = idea.copyPostMeta || idea.copy;
    if (copy) piezas.push(`Contexto del mensaje: ${String(copy).slice(0, 400)}`);
    escena = piezas.join('. ') || idea.titulo
      || 'Producto premium sobre fondo limpio, iluminación suave de estudio.';
  }

  const parts = [];
  parts.push('Diseño de creativo publicitario para Meta Ads (Facebook/Instagram), calidad de producción profesional.');
  if (estilo) parts.push(`Estilo visual: ${estilo}.`);
  parts.push('');
  parts.push('ESCENA / IMAGEN BASE:');
  parts.push(escena);

  if (textoEnImagen) {
    parts.push('');
    parts.push('TEXTO SOBRE LA IMAGEN — renderizá este texto integrado al diseño, con jerarquía tipográfica clara (títulos grandes y bold, microcopy chico, CTA en botón). El texto debe ser legible, bien compuesto y SIN errores de ortografía. Respetá este layout:');
    parts.push(textoEnImagen);
    parts.push('');
    parts.push('El texto va en ESPAÑOL exactamente como está escrito arriba. No traduzcas, no inventes texto extra.');
  }

  parts.push('');
  parts.push('Resultado: una sola pieza publicitaria terminada, lista para subir a Meta Ads. Composición equilibrada, colores coherentes, aspecto profesional de agencia.');

  return parts.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respondJSON(res, 500, {
      error: 'OPENAI_API_KEY no configurada en el servidor. Agregala en Vercel → Settings → Environment Variables.',
    });
  }

  const body = await readBody(req);
  const idea = body?.idea;
  // Requiere AL MENOS algo con qué armar la escena. Las ideas del generador
  // traen promptGeneradorImagen; las réplicas del deep-analyze traen hook +
  // ángulo. Cualquiera de esos sirve.
  if (!idea || !(idea.promptGeneradorImagen || idea.descripcionImagen || idea.hook || idea.titulo)) {
    return respondJSON(res, 400, { error: 'La idea no tiene contenido suficiente para generar el creativo (falta hook/título/descripción)' });
  }

  // Calidad: 'medium' es el default — buen balance calidad/costo (~$0.04-0.06).
  // El cliente puede pedir 'high' para las ideas que va a producir en serio.
  const quality = ['low', 'medium', 'high'].includes(body?.quality) ? body.quality : 'medium';
  const size = sizeForFormato(idea.formato);
  const prompt = buildImagePrompt(idea);

  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size,
        quality,
        n: 1,
      }),
    });

    // Parseo defensivo: si OpenAI devuelve un 502/503 de gateway con HTML
    // o texto plano (pasa en picos de carga), resp.json() explotaría con
    // un SyntaxError críptico. Leemos como texto y parseamos con guarda.
    const raw = await resp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return respondJSON(res, 502, {
        error: `OpenAI devolvió una respuesta no-JSON (HTTP ${resp.status}) — probablemente un error transitorio del servicio. Reintentá en un momento.`,
      });
    }
    if (!resp.ok) {
      const msg = data?.error?.message || `HTTP ${resp.status}`;
      return respondJSON(res, resp.status === 429 ? 429 : 502, { error: `OpenAI rechazó la generación: ${msg}` });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return respondJSON(res, 502, { error: 'OpenAI no devolvió imagen (b64_json ausente)' });
    }

    const costEstimado = COST_TABLE[size]?.[quality] ?? 0.05;

    return respondJSON(res, 200, {
      imageBase64: b64,
      mimeType: 'image/png',
      size,
      quality,
      formato: idea.formato || 'static',
      model: 'gpt-image-1',
      generatedAt: new Date().toISOString(),
      usage: data?.usage || null,
      cost: { openai: costEstimado },
    });
  } catch (err) {
    console.error('generate-creative error:', err);
    return respondJSON(res, 500, { error: err?.message || 'Error generando el creativo' });
  }
}
