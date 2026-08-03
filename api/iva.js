// Endpoint del módulo Proyección de IVA. Recibe la liquidación calculada del
// período (datos del Libro IVA + posición + proyección) y devuelve un análisis
// contable accionable en JSON.
//
//   POST { periodo, liquidacion, proyeccion }
//   → { resumen, diagnostico[], recomendaciones[], alerta }
//
// La API key vive sólo en el server (process.env.ANTHROPIC_API_KEY). El cálculo
// numérico ya viene hecho del cliente (ivaCalc.js): acá Claude sólo interpreta y
// aconseja, no re-liquida.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `Sos un contador público argentino, experto en IVA (Ley 23.349) y en la operatoria de ARCA (ex-AFIP). Recibís la liquidación YA CALCULADA de un período de IVA de un laboratorio/negocio y devolvés un análisis contable claro y accionable para el dueño (no contador).

CONTEXTO TÉCNICO QUE MANEJÁS:
- Débito Fiscal (DF) = IVA de ventas. Crédito Fiscal (CF) = IVA de compras. Posición = DF − CF.
- Si DF > CF hay IVA a pagar; si CF > DF se genera saldo TÉCNICO a favor (art. 24): sólo compensa débitos futuros, no se puede pedir su devolución ni usar contra otros impuestos.
- Saldo de LIBRE DISPONIBILIDAD: surge de retenciones/percepciones/pagos a cuenta; se puede usar contra otros impuestos o pedir devolución.
- El "beneficio fiscal" que aplica este contribuyente es 30% de (DF − CF) SÓLO cuando DF > CF (parámetro del estudio).
- El objetivo del negocio es sostener rentabilidad mensual positiva (~20 millones ARS).

REGLAS:
- Español rioplatense, profesional y directo. Nada de relleno.
- NO inventes números: usá exactamente los que vienen en el payload. Podés hacer aritmética simple sobre ellos.
- Si la posición es a favor (CF>DF), aclarale que no paga IVA pero que ese saldo técnico "queda inmovilizado" hasta tener débitos futuros que lo absorban, y cuantificá cuánta venta adicional haría falta.
- Sé concreto con la facturación: "para neutralizar el saldo necesitás facturar $X (neto) / $Y total con IVA".

DEVOLVÉS ÚNICAMENTE un objeto JSON válido, sin markdown, sin backticks, sin texto antes ni después, con esta forma exacta:
{
  "resumen": "2 a 4 frases: cómo cerró la posición de IVA del período y qué significa en plata",
  "diagnostico": ["observación concreta 1", "observación concreta 2"],
  "recomendaciones": ["acción concreta de facturación / compras / uso de saldos"],
  "alerta": "una sola advertencia clave si la hay, o cadena vacía"
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

const fmt = (n) => {
  const x = Number(n) || 0;
  return '$' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(x);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const body = await readBody(req);
  const { periodo, liquidacion, proyeccion } = body || {};

  if (!liquidacion || typeof liquidacion !== 'object') {
    return respondJSON(res, 400, { error: 'Falta la liquidación del período.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada en el servidor.' });
  }

  const L = liquidacion;
  const P = proyeccion || {};
  const pj = P.proyectado || {};
  const ventasAd = P.ventas || {};

  const userMsg = `PERÍODO: ${periodo?.periodo || 'sin especificar'}
Alícuota IVA: ${Math.round((Number(periodo?.alicuota) || 0.21) * 100)}%  ·  Beneficio fiscal: ${Math.round((Number(periodo?.beneficioRate) || 0) * 100)}%
Objetivo de rentabilidad mensual: ${fmt(periodo?.targetRentabilidad)}

LIQUIDACIÓN DEL PERÍODO (ya calculada):
- Débito Fiscal (IVA ventas): ${fmt(L.df)}
- Crédito Fiscal (IVA compras): ${fmt(L.cf)}
- Posición IVA (DF − CF): ${fmt(L.posicion)}  → ${L.esAPagar ? 'A PAGAR (DF>CF)' : 'SALDO TÉCNICO A FAVOR (CF>DF)'}
- Saldo técnico a favor anterior: ${fmt(L.saldoTecnicoAnterior)}
- Saldo de libre disponibilidad anterior: ${fmt(L.saldoLibreDispAnterior)}
- Beneficio fiscal del período: ${fmt(L.beneficio)}
- IVA a pagar (neto, tras saldos y beneficio): ${fmt(L.aPagarNeto)}
- Saldo técnico a favor acumulado (arrastra al mes siguiente): ${fmt(L.saldoTecnicoGenerado)}
- Neto gravado de ventas: ${fmt(L.netoVentas)}  ·  Neto gravado de compras: ${fmt(L.netoCompras)}

ESCENARIO DE PROYECCIÓN (ventas adicionales que se piensan facturar):
- Ventas adicionales: neto ${fmt(ventasAd.neto)} · IVA ${fmt(ventasAd.iva)} · total ${fmt(ventasAd.total)}
- Posición proyectada tras esas ventas: ${fmt(pj.posicion)}
- Beneficio fiscal proyectado: ${fmt(pj.beneficio)}
- Falta para neutralizar el saldo a favor: ${fmt(P.faltaParaNeutralizar)}

Analizá la situación y devolvé el JSON pedido.`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    });

    const raw = (message.content || [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let analisis;
    try {
      analisis = JSON.parse(cleaned);
    } catch {
      // Si el modelo devolvió texto suelto, lo mandamos como resumen.
      analisis = { resumen: cleaned || 'No se pudo generar el análisis.', diagnostico: [], recomendaciones: [], alerta: '' };
    }

    return respondJSON(res, 200, {
      resumen: analisis.resumen || '',
      diagnostico: Array.isArray(analisis.diagnostico) ? analisis.diagnostico : [],
      recomendaciones: Array.isArray(analisis.recomendaciones) ? analisis.recomendaciones : [],
      alerta: analisis.alerta || '',
    });
  } catch (err) {
    console.error('iva: error generando análisis:', err?.message || err);
    return respondJSON(res, 500, { error: `No pude generar el análisis: ${err?.message || 'error de la API de Claude'}` });
  }
}
