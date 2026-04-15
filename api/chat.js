// Vercel Serverless Function que atiende el chatbot del Laboratorio Viora.
// Usa el SDK oficial de Anthropic, hace streaming vía SSE al cliente y
// aprovecha prompt caching sobre la parte estática del system prompt
// y el contexto del negocio para bajar costos en conversaciones largas.
//
// Soporta TOOL-USE en modo panel: Claude puede pedir ejecutar acciones
// (crear cliente, crear orden, cambiar estado, registrar cobro, etc.).
// Como la fuente de verdad vive en el front (useReducer + localStorage),
// la ejecución real la hace el front: el backend sólo emite los tool_use
// por SSE, el front los ejecuta con dispatch y reenvía la conversación
// con los tool_result adjuntos. Este handler itera hasta que Claude
// devuelva una respuesta final sin tool_use pendiente.
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
  +54 9 2236 87-7663. En landing NO tenés herramientas para ejecutar acciones.
- En el PANEL: responder preguntas sobre los datos concretos del laboratorio
  (órdenes, clientes, productos, comisiones, profit, pagos), y explicar cómo
  usar la plataforma. Si te preguntan algo que no podés calcular con el
  contexto, decilo con honestidad.
- En el PANEL, cuando el usuario (rol admin) te pida hacer algo concreto
  (crear cliente, crear producto, crear orden, cambiar estado de una orden,
  registrar un cobro, marcar una incidencia) usá las tools disponibles.
  IMPORTANTE: confirmá los datos clave antes de ejecutar acciones que crean
  o modifican información, sobre todo si detectás ambigüedad. Si falta info
  (ej. qué cliente, qué producto), preguntá antes de llamar la tool.
  Después de ejecutar una tool, contale al usuario en una frase qué pasó.

Formato: usá listas cortas con viñetas sólo cuando realmente suman. Prefierí
respuestas de 1 a 3 oraciones. No inventes números.`;

// Definición de tools disponibles en modo panel para rol admin.
// Los enums de estado se mantienen sincronizados con src/App.jsx (ORDER_STATES).
const ORDER_STATES = [
  'pendiente-cotizacion',
  'cotizado',
  'abonado',
  'en-produccion',
  'listo-enviar',
  'despachado',
];

const PANEL_TOOLS = [
  {
    name: 'crear_cliente',
    description: 'Crea un cliente nuevo en el laboratorio. Devuelve el cliente creado con su id. Requiere al menos el nombre. Si el usuario no indica mentor, dejalo sin asignar (no inventes un mentorId).',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre completo del cliente' },
        telefono: { type: 'string', description: 'Teléfono (ej. "11 2345-6789")' },
        domicilio: { type: 'string', description: 'Dirección del cliente' },
        mentorId: { type: 'integer', description: 'ID del mentor/socio asignado (opcional)' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'crear_producto',
    description: 'Crea un producto nuevo (crema, sérum, aceite, gotero, etc.). Todos los costos son UNITARIOS en pesos. Requiere nombre y precio de venta.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        descripcion: { type: 'string' },
        costoContenido: { type: 'number', description: 'Costo unitario del contenido/fórmula' },
        costoEnvase: { type: 'number', description: 'Costo unitario del envase' },
        costoEtiqueta: { type: 'number', description: 'Costo unitario de la etiqueta' },
        precioVenta: { type: 'number', description: 'Precio de venta unitario' },
      },
      required: ['nombre', 'precioVenta'],
    },
  },
  {
    name: 'crear_orden',
    description: 'Crea una orden nueva. Los IDs de cliente y producto tenés que conocerlos del contexto; si no los sabés, preguntá antes de llamar la tool. montoTotal es la cotización completa (precio × cantidad). Si el usuario no especifica fecha, omitila y se usa la de hoy.',
    input_schema: {
      type: 'object',
      properties: {
        clienteId: { type: 'integer' },
        productoId: { type: 'integer' },
        cantidad: { type: 'integer', description: 'Cantidad de unidades (mínimo 100)' },
        montoTotal: { type: 'number', description: 'Monto total de la cotización en pesos' },
        mentorId: { type: 'integer', description: 'ID del mentor responsable (opcional, default: el del cliente)' },
        fecha: { type: 'string', description: 'YYYY-MM-DD (opcional, default hoy)' },
        estado: { type: 'string', enum: ORDER_STATES, description: 'Estado inicial (default: pendiente-cotizacion)' },
      },
      required: ['clienteId', 'productoId', 'cantidad', 'montoTotal'],
    },
  },
  {
    name: 'cambiar_estado_orden',
    description: 'Cambia el estado de una orden existente en el pipeline de producción.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer' },
        estado: { type: 'string', enum: ORDER_STATES },
      },
      required: ['orderId', 'estado'],
    },
  },
  {
    name: 'marcar_incidencia',
    description: 'Marca o desmarca una incidencia en una orden (ej. demora de proveedor, problema con envase). Útil para que el admin pueda hacer seguimiento desde el centro de notificaciones.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer' },
        tieneIncidencia: { type: 'boolean' },
        incidenciaDetalle: { type: 'string', description: 'Descripción breve de la incidencia (si tieneIncidencia=true)' },
      },
      required: ['orderId', 'tieneIncidencia'],
    },
  },
  {
    name: 'registrar_cobro',
    description: 'Registra un pago/cobro en un rubro de una orden. Rubros: "cliente" (lo que paga el cliente al laboratorio), "mentor" (comisión al socio/mentor), "contenido"/"envase"/"etiqueta" (pagos a proveedores). Usá estado "pagado" cuando ya se concretó, "pendiente" para revertir.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer' },
        rubro: { type: 'string', enum: ['cliente', 'mentor', 'contenido', 'envase', 'etiqueta'] },
        estado: { type: 'string', enum: ['pagado', 'pendiente'] },
        monto: { type: 'number', description: 'Monto del cobro (opcional, si ya existe se preserva)' },
        fecha: { type: 'string', description: 'YYYY-MM-DD (opcional)' },
      },
      required: ['orderId', 'rubro', 'estado'],
    },
  },
];

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
      lines.push('- Últimas órdenes (ID — fecha — cliente — producto — cantidad — monto — estado):');
      context.ultimasOrdenes.slice(0, 8).forEach(o => {
        lines.push(`  * #${o.id} — ${o.fecha} — ${o.cliente} — ${o.producto} — ${o.cantidad}u — $${Math.round(o.monto).toLocaleString('es-AR')} — ${o.estado}${o.incidencia ? ' (⚠ incidencia)' : ''}`);
      });
    }
    if (Array.isArray(context.clientes)) {
      const detalle = context.clientes.slice(0, 20).map(c => `#${c.id} ${c.nombre}`).join(', ');
      lines.push(`- Clientes (${context.clientes.length}): ${detalle}${context.clientes.length > 20 ? '…' : ''}`);
    }
    if (Array.isArray(context.productos)) {
      lines.push(`- Productos: ${context.productos.map(p => `#${p.id} ${p.nombre} ($${p.precio})`).join(', ')}`);
    }
    if (Array.isArray(context.mentores)) {
      lines.push(`- Mentores/socios: ${context.mentores.map(m => `#${m.id} ${m.nombre} (${m.porcentaje}%)`).join(', ')}`);
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

// Dado un array de messages mixto (strings o blocks), lo normaliza al formato
// que espera la API de Anthropic. Si content es string → lo envuelve en [{type:'text'}].
// Si ya es array → lo pasa tal cual (asume blocks válidos: text, tool_use, tool_result).
function normalizeMessages(messages) {
  return messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : m.content,
  }));
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

  // Habilitamos tools sólo en modo panel y si el usuario es admin. El rol
  // 'equipo' es read-only, y en landing no tiene sentido ejecutar acciones.
  const isAdmin = mode === 'panel' && context?.usuario?.role === 'admin';
  const tools = isAdmin ? PANEL_TOOLS : undefined;

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
      tools,
      messages: normalizeMessages(messages),
    });

    // Stream de texto token-a-token al front.
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: event.delta.text })}\n\n`);
      }
    }

    // Al terminar el stream, revisamos el mensaje final. Si hay tool_use,
    // avisamos al front para que ejecute las tools y reenvíe la conversación
    // con los tool_result adjuntos. Si no, mandamos [DONE].
    const finalMessage = await stream.finalMessage();
    const toolUses = (finalMessage.content || []).filter(b => b.type === 'tool_use');

    if (toolUses.length > 0) {
      res.write(`data: ${JSON.stringify({
        type: 'tool_use_request',
        assistantContent: finalMessage.content, // blocks: text + tool_use
        toolUses: toolUses.map(t => ({ id: t.id, name: t.name, input: t.input })),
      })}\n\n`);
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
