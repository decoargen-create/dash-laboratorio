// Endpoint del módulo Consultoría. Recibe la transcripción cruda de una
// reunión de consultoría y devuelve un acta accionable en JSON, lista para
// reenviar al cliente.
//
//   POST { transcript, client, date }
//   → { resumen, temas[], diagnostico[], tareas[], plan_accion[], notas_internas[] }
//
// La API key vive sólo en el server (process.env.ANTHROPIC_API_KEY): el
// frontend pega a /api/acta, nunca a Anthropic directo.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `Sos el asistente de un consultor argentino de e-commerce (perfil operador, no gurú). Recibís la transcripción cruda de una reunión de consultoría con un cliente y devolvés un acta accionable que el consultor le va a reenviar al cliente.

REGLAS DE TONO:
- Español rioplatense, profesional pero cercano y directo. Nada de chamuyo motivacional ni lenguaje de gurú.
- Concreto y operativo. Cada tarea tiene que ser algo que alguien pueda agarrar y hacer.
- Inferí el responsable de cada tarea desde la transcripción (Cliente / Consultor / Equipo / Proveedor, o el nombre si aparece). Si no queda claro, poné "Cliente".
- Si no hay un plazo mencionado, poné "A definir".
- No inventes datos que no estén en la transcripción. Si algo es ambiguo, dejalo en notas_internas.

DEVOLVÉS ÚNICAMENTE un objeto JSON válido, sin markdown, sin backticks, sin texto antes ni después, con esta forma exacta:
{
  "resumen": "2 a 4 frases que resuman de qué se habló y a qué se llegó",
  "temas": ["tema tratado 1", "tema tratado 2"],
  "diagnostico": [{"titulo": "qué observamos", "detalle": "explicación corta y concreta"}],
  "tareas": [{"tarea": "acción concreta", "responsable": "Cliente|Consultor|Equipo|<nombre>", "prioridad": "Alta|Media|Baja", "plazo": "fecha o 'A definir'"}],
  "plan_accion": [{"paso": "título del paso ordenado", "detalle": "qué implica"}],
  "notas_internas": ["nota privada para el consultor que NO va al cliente"]
}`;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const body = await readBody(req);
  const { transcript, client, date } = body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 40) {
    return respondJSON(res, 400, { error: 'Falta la transcripción (mínimo ~40 caracteres de texto real).' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada en el servidor.' });

  const userMsg = `Cliente: ${client || 'Sin especificar'}
Fecha: ${date || 'Sin especificar'}

TRANSCRIPCIÓN DE LA REUNIÓN:
"""
${transcript}
"""`;

  const anthropic = new Anthropic({ apiKey });

  let message;
  try {
    message = await anthropic.messages.create({
      // Último Sonnet disponible. Para abaratar se puede bajar a
      // 'claude-haiku-4-5-20251001'.
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      // Prompt caching en el system (es estable entre actas): la primera
      // llamada paga full, las siguientes pagan ~1/10 por esos tokens.
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    });
  } catch (err) {
    console.error('acta: error llamando a Anthropic:', err?.message || err);
    return respondJSON(res, 500, { error: `No pude generar el acta: ${err?.message || 'error de la API de Claude'}` });
  }

  // Concatenamos todos los bloques de texto, sacamos los backticks ```json
  // si los hubiera y parseamos.
  const raw = (message.content || [])
    .filter(b => b?.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let acta;
  try {
    acta = JSON.parse(cleaned);
  } catch {
    // A veces el modelo mete texto alrededor del JSON: intentamos rescatar el
    // primer objeto { ... } de la respuesta antes de rendirnos.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { acta = JSON.parse(match[0]); } catch { /* cae al error de abajo */ }
    }
  }

  if (!acta || typeof acta !== 'object') {
    console.error('acta: no pude parsear el JSON. Respuesta cruda:', raw.slice(0, 500));
    return respondJSON(res, 500, { error: 'El modelo no devolvió un JSON válido. Probá de nuevo.' });
  }

  // Normalizamos para que el front nunca rompa por un campo ausente.
  const safe = {
    resumen: typeof acta.resumen === 'string' ? acta.resumen : '',
    temas: Array.isArray(acta.temas) ? acta.temas : [],
    diagnostico: Array.isArray(acta.diagnostico) ? acta.diagnostico : [],
    tareas: Array.isArray(acta.tareas) ? acta.tareas : [],
    plan_accion: Array.isArray(acta.plan_accion) ? acta.plan_accion : [],
    notas_internas: Array.isArray(acta.notas_internas) ? acta.notas_internas : [],
  };

  return respondJSON(res, 200, safe);
}
