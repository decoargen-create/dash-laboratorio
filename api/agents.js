// Endpoint unificado para 4 agentes especializados.
//
// Cada agente recibe un snapshot del negocio y devuelve un JSON estructurado.
// El front llama a POST /api/agents con { action, snapshot, extras? } y recibe
// un JSON que renderiza en tarjetas.
//
// Agentes:
//   - arranque : briefing matinal (urgencias, oportunidades, tips del día)
//   - precios  : audita el catálogo y sugiere ajustes de precio
//   - cotizador: propone precio / costo informado / timeline para un pedido
//   - salud    : detecta inconsistencias de datos y red/yellow/green flags
//
// Uso común: prompt caching en el system para bajar costo, Haiku 4.5 por
// velocidad, output JSON estricto parseado del texto.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_ARRANQUE = `Sos el "agente de arranque del día" del Laboratorio Viora. Tu rol es generar un briefing de 30 segundos para la admin cuando abre el panel a la mañana.

Devolvés JSON ESTRICTO con esta forma:
{
  "resumen": "una frase corta (máx 120 caracteres) con el pulso del día",
  "urgencias": [ { "titulo": "...", "detalle": "...", "accion": "..." } ],
  "oportunidades": [ { "titulo": "...", "detalle": "..." } ],
  "tipDelDia": "un consejo accionable basado en los datos, 1-2 oraciones"
}

REGLAS:
- Entre 0 y 4 urgencias. Cada una accionable (qué hacer concreto).
- Entre 0 y 3 oportunidades: ventas posibles, clientes recurrentes a retomar, partners destacados.
- "tipDelDia" siempre presente, incluso si el día está tranquilo.
- Tono castellano rioplatense, directo, sin marketing.
- "titulo" ≤ 60 chars, "detalle" ≤ 180 chars, "accion" ≤ 60 chars.
- NO markdown, NO texto extra: SOLO el JSON puro.`;

const SYSTEM_PRECIOS = `Sos el "agente de precios" del Laboratorio Viora. Auditás el catálogo y detectás productos con precios desalineados o márgenes bajos.

IMPORTANTE: el negocio cobra comisiones a partners sobre la ganancia INFORMADA (precio venta − costo informado) × %. El profit REAL del lab es: precio venta − costo real − comisión.

Devolvés JSON ESTRICTO:
{
  "resumen": "frase corta con el estado general del catálogo (máx 120 chars)",
  "alertas": [
    {
      "productoId": 123,
      "productoNombre": "...",
      "tipo": "margen-bajo" | "precio-subido" | "costo-desactualizado" | "oportunidad",
      "severidad": "alta" | "media" | "baja",
      "diagnostico": "qué detectaste (1-2 oraciones)",
      "sugerencia": "acción concreta con números (ej: 'Subir precio a $5200 para margen ≥35%')"
    }
  ],
  "resumenNumerico": {
    "margenPromedio": 35,
    "productosConMargenBajo": 2
  }
}

REGLAS:
- Margen real objetivo del lab: ≥30% (después de restar costo y comisión típica de 50%).
- Máximo 6 alertas, priorizadas por severidad.
- Si no tenés datos suficientes para un producto (ej. sin costo cargado), marcalo como "costo-desactualizado".
- Castellano rioplatense, conciso. NO markdown, SOLO JSON.`;

const SYSTEM_COTIZADOR = `Sos el "agente cotizador" del Laboratorio Viora. Recibís un pedido (cliente + producto + cantidad) y proponés una cotización profesional.

Tomás en cuenta:
- El precio base del producto (unitario).
- El costo real vs el costo informado al partner (si hay partner).
- El histórico del cliente (órdenes previas, si las hay).
- El porcentaje de comisión del partner.

Devolvés JSON ESTRICTO:
{
  "precioVentaTotal": 45000,
  "precioVentaUnit": 4500,
  "costoInformadoTotal": 35000,
  "comisionPartnerEstimada": 5000,
  "profitRealLab": 7000,
  "margenPctLab": 15.5,
  "timeline": "15 a 20 días hábiles desde el abono",
  "condicionesPago": "50% seña, 50% al estar listo para despachar",
  "propuestaTexto": "El texto redactado de la cotización, listo para copiar y pegar en WhatsApp (tono profesional pero cercano, castellano rioplatense, máx 400 caracteres)"
}

REGLAS:
- Si hay histórico del cliente (órdenes previas abonadas), podés bajar la seña a 30% en condicionesPago.
- Si el partner tiene comisión definida, calculala exacto con (precioVentaTotal − costoInformadoTotal) × %.
- profitRealLab = precioVentaTotal − (costoReal × cantidad) − comisionPartnerEstimada.
- Si el margen real resulta <20%, subí el precio hasta llegar al 25%.
- "propuestaTexto" empieza con "¡Hola {nombre}!" y termina con una call-to-action tipo "Si te parece bien avisame y arrancamos".
- NO markdown, SOLO JSON puro.`;

const SYSTEM_SALUD = `Sos el "agente de salud del sistema" del Laboratorio Viora. Tu trabajo es detectar inconsistencias de datos, problemas de higiene y riesgos en el estado del negocio.

Devolvés JSON ESTRICTO:
{
  "estado": "saludable" | "atencion" | "critico",
  "resumen": "frase con el estado general (máx 140 chars)",
  "banderas": [
    {
      "nivel": "rojo" | "amarillo" | "verde",
      "categoria": "datos" | "cobranza" | "operaciones" | "config",
      "titulo": "...",
      "detalle": "...",
      "accion": "qué hacer concreto"
    }
  ],
  "metricas": {
    "ordenesActivas": 12,
    "pctCobrado": 78,
    "comisionesPendientes": 15000,
    "incidenciasAbiertas": 1
  }
}

BUSCAR ESPECÍFICAMENTE:
- Órdenes en "en-produccion" sin pagos asignados a proveedor.
- Órdenes con partner pero sin costoInformado cargado.
- Clientes sin teléfono.
- Productos con precio <= costo (margen negativo).
- Comisiones pendientes >30 días.
- Cobros pendientes >45 días.
- Incidencias sin resolver.
- Pipeline estancado (muchas órdenes en un mismo estado).

REGLAS:
- Máximo 8 banderas.
- "estado" = "critico" si hay ≥1 bandera roja; "atencion" si hay amarillas sin rojas; "saludable" si todo verde o nada.
- Castellano rioplatense, NO markdown, SOLO JSON.`;

const AGENTS = {
  arranque: { system: SYSTEM_ARRANQUE, maxTokens: 1024 },
  precios: { system: SYSTEM_PRECIOS, maxTokens: 1536 },
  cotizador: { system: SYSTEM_COTIZADOR, maxTokens: 1024 },
  salud: { system: SYSTEM_SALUD, maxTokens: 1536 },
};

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const body = await readBody(req);
  const { action, snapshot, extras } = body || {};

  if (!action || !AGENTS[action]) {
    return respondJSON(res, 400, { error: `action debe ser uno de: ${Object.keys(AGENTS).join(', ')}` });
  }
  if (!snapshot) {
    return respondJSON(res, 400, { error: 'Falta el snapshot del negocio' });
  }

  const agent = AGENTS[action];
  const client = new Anthropic({ apiKey });

  // Para cotizador mandamos los "extras" (pedido específico a cotizar) además
  // del snapshot general del negocio. Para los demás, sólo el snapshot basta.
  const userContent = action === 'cotizador' && extras
    ? `Contexto general:\n${JSON.stringify(snapshot, null, 2)}\n\nPedido a cotizar:\n${JSON.stringify(extras, null, 2)}\n\nDevolvé el JSON.`
    : `Estado del negocio:\n${JSON.stringify(snapshot, null, 2)}\n\nDevolvé el JSON.`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: agent.maxTokens,
      system: [
        { type: 'text', text: agent.system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userContent }],
    });

    const text = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
    let parsed;
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error(`agents.${action}: parse error`, e, 'raw:', text);
      return respondJSON(res, 502, { error: 'No pude parsear la respuesta del agente. Reintentá.', raw: text });
    }

    return respondJSON(res, 200, {
      action,
      data: parsed,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`agents.${action} error:`, err);
    return respondJSON(res, 500, { error: err?.message || 'Error desconocido' });
  }
}
