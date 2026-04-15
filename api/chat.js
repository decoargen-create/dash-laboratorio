// Vercel Serverless Function que atiende el chatbot del Laboratorio Viora.
// Usa el SDK oficial de Anthropic, hace streaming vía SSE al cliente y
// aprovecha prompt caching sobre la parte estática del system prompt
// y el contexto del negocio para bajar costos en conversaciones largas.
import Anthropic from '@anthropic-ai/sdk';

// Instrucciones base del asistente. Esta parte cambia rara vez así que vive
// en un bloque cacheable de prompt caching (Anthropic cachea por 5 minutos
// todo lo que venga marcado con cache_control: { type: 'ephemeral' }).
const BASE_SYSTEM = `Sos el asistente del Laboratorio Viora, un laboratorio argentino de cosmética artesanal que fabrica cremas, sérums, aceites y goteros bajo marca propia (mínimo 100 unidades por producto, despachos en 5 a 9 días hábiles, cotización en menos de 24 hs).

Respondés SIEMPRE en castellano rioplatense, de forma concisa, amable y profesional.
Evitás el relleno y las frases marketineras. Una respuesta buena es una respuesta breve, honesta y útil.

Dependiendo del contexto que te lleguen en el mensaje (modo panel o modo landing)
podés:
- En la LANDING: contestar preguntas comerciales (tiempos, mínimos, contacto,
  proceso). Si no tenés la respuesta exacta, invitá a escribir por WhatsApp al
  +54 9 2236 87-7663.
- En el PANEL: responder preguntas sobre los datos concretos del laboratorio
  (órdenes, clientes, productos, comisiones, profit, pagos), y explicar cómo
  usar la plataforma. Si te preguntan algo que no podés calcular con el
  contexto, decilo con honestidad.

Formato: usá listas cortas con viñetas sólo cuando realmente suman. Prefierí
respuestas de 1 a 3 oraciones. No inventes números.`;

// Construye el bloque de contexto de la conversación a partir de los datos
// que manda el front. La idea es ser compacto y útil, no dumpear todo.
function buildContextBlock(mode, context) {
  if (mode === 'landing') {
    return [
      'CONTEXTO: estás atendiendo a un visitante de la landing del Laboratorio Viora.',
      'Lo más probable es que esté averiguando qué fabricamos, plazos, mínimos o proceso.',
      '',
      'PRODUCTOS QUE FABRICAMOS:',
      '- Cremas (faciales y corporales: hidratantes, nutritivas, anti-edad, exfoliantes).',
      '- Sérums (con activos concentrados: vitamina C, ácido hialurónico, niacinamida, retinol).',
      '- Aceites (capilares, faciales y corporales con bases vegetales).',
      '- Goteros (tinturas, esencias y formulaciones líquidas en envase con cuentagotas).',
      '',
      'DATOS OPERATIVOS:',
      '- Mínimo: 100 unidades por producto y por lote.',
      '- Cotización: en menos de 24 horas hábiles desde el contacto.',
      '- Despacho: 5 a 9 días hábiles desde la aprobación de la cotización y pago.',
      '- Trabajamos con la fórmula del cliente o adaptamos una de nuestras bases.',
      '- Entregamos el lote terminado: producto envasado y etiquetado, listo para vender.',
      '- Contacto: WhatsApp +54 9 2236 87-7663.',
      '',
      'FLUJO: Contacto → Cotización (<24 hs) → Confirmación + Pago → Producción → Despacho (5-9 días hábiles).',
      '',
      'Si te preguntan cosas que no podés contestar con esta info, derivá amablemente al WhatsApp.',
    ].join('\n');
  }
  if (mode === 'panel' && context) {
    const lines = ['CONTEXTO: estás asistiendo a un usuario del panel de gestión.'];
    if (context.usuario) lines.push(`- Usuario: ${context.usuario.name} (${context.usuario.role}).`);
    if (context.metricas) {
      lines.push(
        `- Métricas actuales:`,
        `  * Órdenes totales: ${context.metricas.ordenesTotal}`,
        `  * Ventas período: $${Math.round(context.metricas.ventasPeriodo || 0).toLocaleString('es-AR')}`,
        `  * Profit período: $${Math.round(context.metricas.profitPeriodo || 0).toLocaleString('es-AR')}`,
        `  * Comisiones pendientes: $${Math.round(context.metricas.comisionesPendientes || 0).toLocaleString('es-AR')}`,
        `  * A pagar a proveedores: $${Math.round(context.metricas.pagosProveedoresPendientes || 0).toLocaleString('es-AR')}`,
        `  * Incidencias activas: ${context.metricas.incidencias}`,
      );
    }
    if (context.ordenesPorEstado) {
      lines.push('- Órdenes por estado:');
      Object.entries(context.ordenesPorEstado).forEach(([k, v]) => lines.push(`  * ${k}: ${v}`));
    }
    if (Array.isArray(context.ultimasOrdenes) && context.ultimasOrdenes.length) {
      lines.push('- Últimas 5 órdenes:');
      context.ultimasOrdenes.slice(0, 5).forEach(o => {
        lines.push(`  * ${o.fecha} — ${o.cliente} — ${o.producto} — ${o.cantidad}u — $${Math.round(o.monto).toLocaleString('es-AR')} — ${o.estado}${o.incidencia ? ' (⚠ incidencia)' : ''}`);
      });
    }
    if (Array.isArray(context.clientes)) {
      lines.push(`- Clientes registrados (${context.clientes.length}): ${context.clientes.slice(0, 10).map(c => c.nombre).join(', ')}${context.clientes.length > 10 ? '…' : ''}`);
    }
    if (Array.isArray(context.productos)) {
      lines.push(`- Productos (${context.productos.length}): ${context.productos.map(p => `${p.nombre} ($${p.precio})`).join(', ')}`);
    }
    if (Array.isArray(context.mentores)) {
      lines.push(`- Mentores: ${context.mentores.map(m => `${m.nombre} (${m.porcentaje}%)`).join(', ')}`);
    }
    return lines.join('\n');
  }
  return 'CONTEXTO: modo genérico.';
}

// Parsea el body en Vercel (ya viene parseado) y en Vite dev middleware (string).
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
    res.end(JSON.stringify({
      error: 'ANTHROPIC_API_KEY no está configurada. En local, agregala a un archivo .env. En Vercel, pegala en Settings → Environment Variables.',
    }));
    return;
  }

  const body = await readBody(req);
  const { messages = [], mode = 'panel', context = null } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Falta el array de messages' }));
    return;
  }

  const client = new Anthropic({ apiKey });
  const contextBlock = buildContextBlock(mode, context);

  // Prompt caching: dividimos el system en 2 bloques.
  // - base: instrucciones estables → se cachea y se reusa.
  // - context: snapshot del negocio → también se cachea (cambia con cada nav).
  // Si sólo cambia el último mensaje del usuario, la mayoría del prompt sale del cache.
  const system = [
    { type: 'text', text: BASE_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextBlock, cache_control: { type: 'ephemeral' } },
  ];

  try {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // desactiva buffering en proxies

    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: event.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('chat.js error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err?.message || 'Error desconocido' }));
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err?.message || 'Error' })}\n\n`);
      res.end();
    }
  }
}
