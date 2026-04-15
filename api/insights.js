// Endpoint que le pide a Claude que analice el estado del negocio y genere
// alertas / insights accionables (demoras, saldos a cobrar grandes, etc.).
// Se llama desde el frontend cuando el user abre el centro de notificaciones
// o pulsa "Refrescar". El frontend cachea la respuesta unos minutos para no
// quemar API.
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `Sos el sistema de alertas del Laboratorio Viora. Tu rol es identificar casos críticos en el estado del negocio y generar avisos cortos y accionables para la admin.

Mirás el snapshot de datos que te paso y devolvés un JSON ESTRICTO con esta forma:
{
  "alertas": [
    { "tipo": "demora" | "cobro" | "pago" | "incidencia" | "info", "titulo": "...", "detalle": "...", "prioridad": "alta" | "media" | "baja" }
  ]
}

REGLAS:
- Devolvé entre 0 y 6 alertas (no más).
- Cada alerta debe ser ACCIONABLE: la admin debe poder hacer algo concreto al leerla.
- No repitas la misma alerta con palabras distintas.
- Si todo está bien, devolvé { "alertas": [] }.
- "titulo" tiene que ser corto (máx 60 caracteres) y específico.
- "detalle" expande el contexto en 1-2 oraciones (máx 200 caracteres).
- Tono: castellano rioplatense, profesional, sin marketing.
- Prioridades:
  * "alta": riesgo de plata (saldo grande sin cobrar, mentor sin pagar hace mucho, incidencia sin resolver).
  * "media": cosas que conviene atender en la semana.
  * "baja": info útil pero no urgente.
- NO devuelvas markdown ni texto extra. SOLO el JSON puro.

Ejemplos de buenas alertas:
- "Pedido de Martina sin cotizar hace 5 días" → tipo: demora, alta
- "$45.000 a cobrar a 3 clientes hace +30 días" → tipo: cobro, alta
- "Sofia tiene $12.000 de comisión sin pagar" → tipo: pago, media
- "2 órdenes con incidencia sin resolver" → tipo: incidencia, alta`;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY no configurada en el servidor.' }));
    return;
  }

  const body = await readBody(req);
  const { snapshot = null } = body;

  if (!snapshot) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Falta el snapshot del negocio' }));
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: `Estado actual del negocio:\n\n${JSON.stringify(snapshot, null, 2)}\n\nDevolvé el JSON con las alertas.`,
        },
      ],
    });

    const text = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
    let parsed = { alertas: [] };
    try {
      // Limpiamos por si Claude devolviera markdown
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('insights.js: parse error', e, 'raw:', text);
      parsed = { alertas: [], error: 'No pude parsear las alertas. Probá refrescar.' };
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.end(JSON.stringify(parsed));
  } catch (err) {
    console.error('insights.js error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Error desconocido' }));
  }
}
