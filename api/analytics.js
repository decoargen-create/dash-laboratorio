// Endpoint que genera reportes analíticos del negocio con Claude.
// Recibe un snapshot del histórico (órdenes con sus fechas de cambio de
// estado, productos, clientes) y devuelve un análisis estructurado:
// tiempos de entrega promedio por nicho, fortalezas, debilidades y
// recomendaciones accionables.
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `Sos el analista del Laboratorio Viora, un laboratorio cosmético argentino. Tu rol es analizar el histórico de órdenes y producir un reporte interno conciso, honesto y accionable.

Recibís un snapshot del negocio y devolvés un JSON ESTRICTO con esta forma:
{
  "resumenEjecutivo": "1 párrafo de máximo 3 oraciones con la foto general.",
  "tiempos": {
    "promedioGeneralDias": <number | null>,
    "porNicho": [
      { "nicho": "Cremas" | "Sérums" | "Aceites" | "Goteros" | "Otros", "ordenes": <int>, "diasPromedio": <number | null>, "comentario": "..." }
    ]
  },
  "fortalezas": [ "frase corta y específica", ... ],   // 2-4 items
  "debilidades": [ "frase corta y específica", ... ],  // 2-4 items
  "recomendaciones": [
    { "titulo": "...", "detalle": "...", "impacto": "alto" | "medio" | "bajo" }
  ]                                                    // 2-5 items
}

REGLAS:
- Si no hay suficiente data para calcular algo, devolvelo como null y aclaralo en un comentario, no inventes números.
- Categorizá los productos por nicho mirando su nombre: 'crema', 'sérum/serum', 'aceite', 'gotero', otro caso → "Otros".
- Tono: castellano rioplatense, profesional, sin marketing.
- Sé específico: "Sofía cierra ventas más rápido que Mariano" es mejor que "el equipo trabaja bien".
- Recomendaciones accionables: la admin debe poder hacer algo concreto al leerlas.
- NO devuelvas markdown ni texto extra. SOLO el JSON puro.`;

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
      max_tokens: 2048,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: `Snapshot del negocio para analizar:\n\n${JSON.stringify(snapshot, null, 2)}\n\nDevolvé el JSON con el reporte.`,
        },
      ],
    });

    const text = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
    let parsed;
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('analytics.js: parse error', e, 'raw:', text);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'No pude parsear el reporte. Probá refrescar.' }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.end(JSON.stringify(parsed));
  } catch (err) {
    console.error('analytics.js error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Error desconocido' }));
  }
}
