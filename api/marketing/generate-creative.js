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
// Guía de escena según el estilo elegido por el user al generar.
// Sub-variantes por estilo — el cliente manda variationSeed (índice de la
// idea en el bulk o random en single) y elegimos UNA variante específica
// para forzar variedad real dentro del mismo estilo (sino la IA cae siempre
// en la composición canónica: "dos mujeres lado a lado" para comparación,
// "mujer feliz en el baño" para lifestyle, etc).
const VARIANTS = {
  producto: [
    'composición minimalista monocromática con producto en pedestal de piedra',
    'producto en mini-mundo de ingredientes con peso material a la vista',
    'producto en composición geométrica asimétrica con sombras largas',
    'detalle macro del producto con gotas/polvo en suspensión',
    'silueta dramática del producto a contraluz con fondo color block',
    'producto en composición flatlay con elementos del beneficio dispuestos en abanico',
  ],
  lifestyle: [
    'rutina mañanera en el baño con luz natural lateral',
    'rutina nocturna con luz cálida ámbar y textiles suaves',
    'mesa de café o desayuno casero con luz de ventana',
    'al aire libre en un balcón/parque con luz dorada',
    'momento de oficina/escritorio con elementos de trabajo',
    'persona leyendo en sillón con manta y luz tenue',
    'preparándose para salir frente al espejo con vestuario casual',
    'detalle de manos sosteniendo el producto sobre encimera de mármol',
  ],
  ugc: [
    'selfie casero en espejo del baño con flash leve',
    'foto rápida sobre la mesa de la cocina al mediodía',
    'mano espontánea sosteniendo el producto en el sofá',
    'expresión de "ay sí, esto funcionó" con gesto natural',
    'recorte raro tipo celular vertical con leve grano',
    'foto tomada desde arriba sobre la cama mientras se está apoyado',
  ],
  comparacion: [
    'ANTES/DESPUÉS del MISMO cuerpo/objeto en dos momentos distintos (NO dos personas distintas)',
    'producto del anunciante vs envase genérico sin marca, SOLO los dos productos (sin personas)',
    'escenario caótico/desordenado a un lado vs limpio/ordenado con el producto al otro',
    'sólo manos: una sosteniendo algo viejo/cansado vs otra sosteniendo el producto con vitalidad',
    'producto del anunciante protagónico + un pequeño elemento del "antes" descartado al costado',
    'split por textura: lado mate gris vs lado con color vibrante del producto',
  ],
  explosion: [
    'explosión radial de polvo de colores que envuelve el producto',
    'gotas y líquidos en suspensión congelada alrededor del producto',
    'ingredientes (raíces, frutas, semillas) flotando como cohetes hacia el producto',
    'rayos/destellos dorados emanando del producto sobre fondo oscuro',
    'partículas brillantes y humo etéreo alrededor del producto',
  ],
  mesa_aerea: [
    'flatlay de desayuno saludable con ingredientes en cuencos pequeños',
    'flatlay de mesa familiar con platos servidos y el producto integrado',
    'flatlay de ingredientes crudos del producto (raíces, plantas, polvos) dispuestos en abanico',
    'flatlay de oficina con notas, café, agenda y el producto entre los elementos',
    'flatlay de kit completo con accesorios coherentes con la rutina',
  ],
  editorial: [
    'color block bicromático horizontal con el producto en la línea de contraste',
    'pedestal con sombras duras y luz lateral única tipo galería',
    'fondo monocromático con UN acento de color vibrante de la marca',
    'contraste de texturas: mate y aterciopelado vs brillo metálico',
    'composición geométrica asimétrica con espacio negativo intencional',
    'producto pequeño en un encuadre amplio con tipografía implícita por composición',
  ],
  testimonio: [
    'rostro de la persona en 3/4 con expresión de alivio, sosteniendo el producto a la altura del pecho',
    'detalle de manos cruzadas sosteniendo el producto sobre el regazo, sin mostrar cara',
    'persona mayor real (60+) sonriendo con calma, producto cerca pero no protagónico',
    'momento natural en casa, persona sentada en cocina o living, producto sobre la mesa',
    'expresión de "por fin" — ojos cerrados, levemente sonriendo, producto al pecho',
    'detalle de espalda de la persona apoyando el producto sobre una mesa, luz cálida',
  ],
  mascot: [
    'mascota envase saludando con brazo arriba, fondo color block alegre',
    'mascota señalando un elemento (precio, beneficio, otro objeto) con expresión picarona',
    'mascota celebrando con confeti y guirnaldas pequeñas alrededor',
    'mascota con cara de sorprendida positiva (boca abierta, ojos grandes)',
    'mascota tachando algo con un marcador rojo, gesto enérgico',
  ],
};

const ESCENA_GUIDE = {
  producto: 'ENFOQUE DE ESCENA: producto como protagonista en un mini-mundo editorial — NO packshot vacío de catálogo. Ingredientes clave o elementos del beneficio fotografiados con peso material alrededor del producto (gotas, polvo, plantas, ondas, partículas), sombras y reflejos creíbles, profundidad. Iluminación con dirección, no plana. El producto en foco nítido; los elementos secundarios con leve desenfoque artístico. Composición editorial, no centrada-aburrida.',
  lifestyle: 'ENFOQUE DE ESCENA: lifestyle real y aspiracional — una persona del target USANDO el producto en un momento cotidiano creíble (rutina del baño con luz natural, escritorio iluminado, mesa de café, exterior con luz dorada). Persona con expresión auténtica, NUNCA cara perfecta tipo IA con simetría imposible. Mostrá detalle (manos, perfil, tres cuartos) más que cara frontal. El envase del producto se ve INTEGRADO al momento pero en ángulo / parcialmente fuera de foco / parcialmente cubierto por la mano — NO un primer plano frontal de la etiqueta. Así el producto se reconoce por su color y forma sin que la IA tenga que redibujar el texto de la etiqueta.',
  ugc: 'ENFOQUE DE ESCENA: foto estilo cliente real con celular — encuadre casual e imperfecto a propósito, luz ambiente real (no de estudio), expresión espontánea, micro-imperfecciones (mano corta, recorte raro, leve grano), fondo cotidiano sin curar. NO se nota IA. Importante: el producto se sostiene mostrando MÁS el color y la silueta que la etiqueta frontal — envase en ángulo o parcialmente cubierto por la mano para evitar que la etiqueta se renderice mal.',
  comparacion: 'ENFOQUE DE ESCENA: comparación lado a lado o antes/después con alto contraste cromático y de mood. Tu producto del lado favorable: protagónico, iluminado, atractivo, paleta cálida o de marca. El otro lado: opaco, frío, abarrotado o desordenado, paleta apagada. Composición clara de dos zonas separadas por una línea visual sutil. NUNCA pongas texto comparativo encima — el contraste lo cuenta solo.',
  explosion: 'ENFOQUE DE ESCENA: producto al centro con una EXPLOSIÓN dramática de ingredientes / polvo / partículas / salpicaduras alrededor — congelado a alta velocidad, gotas en suspensión, polvo coloreado dispersándose, ráfaga radial. Fondo oscuro o color block que haga contrastar la explosión. El producto en el ojo de la tormenta, nítido y dominante. Impacto visual máximo — pattern-interrupt puro.',
  mesa_aerea: 'ENFOQUE DE ESCENA: toma cenital (top-down) de una mesa puesta con MUCHOS props coherentes con el beneficio del producto — ingredientes reales en cuencos, telas, cubiertos, comida cuidadosamente arreglada, hojas, cuadernos. El producto integrado entre los props (sostenido por una mano o apoyado naturalmente). Composición flatlay editorial con dirección clara, no caótica. Inspirado en revistas de cocina/lifestyle premium.',
  editorial: 'ENFOQUE DE ESCENA: toma de moda editorial — producto como objeto de deseo. Fondo de color block dramático (dos colores contrastantes dividiendo el espacio), pedestal o superficie geométrica, iluminación dura lateral con sombras marcadas, una sola luz secundaria. Composición asimétrica, espacio negativo intencional. Aspecto de campaña high-end (Aesop, Glossier, Le Labo). El producto se destaca contra el fondo por color y forma.',
  testimonio: 'ENFOQUE DE ESCENA: foto real de una persona del target con el producto en la mano o cerca, expresión auténtica y emocional (no sonrisa de stock). Encuadre cerrado (de pecho para arriba, o detalle de manos sosteniendo). Fondo cotidiano real, leve desenfoque. Mood: confianza y testimonio sincero. La persona tiene texturas de piel reales, edad coherente con el target, NO look IA. El envase visible pero NO en primer plano de la etiqueta.',
  mascot: 'ENFOQUE DE ESCENA: el envase del producto antropomorfizado como personaje cartoon de Pixar / 3D estilizado — con cara expresiva (ojos grandes, sonrisa), brazos y posiblemente piernas estilizadas que salen del envase. El personaje hace una acción coherente con el mensaje (señala algo, hace pose de victoria, sostiene un elemento). Fondo simple y luminoso. Mood divertido y memorable. Cuidá que el envase reconozca la marca aún antropomorfizado.',
};

function buildImagePrompt(idea, { usarProductoReal = false, paleta = [], feedbackQA = null, estiloEscena = '', variationSeed = 0 } = {}) {
  const estilo = (idea.estiloVisual || '').trim();
  const hook = (idea.hook || '').trim();

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

  // Feedback del control de calidad de una versión anterior — el cliente
  // reintenta automáticamente cuando el QA encuentra problemas.
  if (feedbackQA && ((Array.isArray(feedbackQA.problemas) && feedbackQA.problemas.length) || feedbackQA.sugerencia)) {
    parts.push('');
    parts.push('⚠️ SEGUNDA VERSIÓN — CORRECCIONES OBLIGATORIAS. Una primera versión de este creativo tuvo estos problemas detectados por un control de calidad. Corregilos TODOS en esta versión:');
    for (const p of (feedbackQA.problemas || [])) parts.push(`- ${p}`);
    if (feedbackQA.sugerencia) parts.push(`Sugerencia concreta del revisor: ${feedbackQA.sugerencia}`);
    if (Array.isArray(feedbackQA.fortalezas) && feedbackQA.fortalezas.length) {
      parts.push(`Conservá lo que SÍ funcionó de la versión anterior: ${feedbackQA.fortalezas.join('; ')}.`);
    }
  }

  if (usarProductoReal) {
    parts.push('');
    parts.push('PRODUCTO REAL — NO LO MODIFIQUES: la imagen de referencia adjunta es el producto real del anunciante. Reproducí el envase EXACTAMENTE como está en la foto: misma forma, misma etiqueta, mismos colores, misma tapa y el MISMO texto de la etiqueta, letra por letra. PROHIBIDO: redibujar o reescribir la etiqueta, inventar o cambiar el texto del envase, agregar texto/sellos/logos sobre el producto, o alterar el packaging de cualquier forma. El producto es intocable — copialo tal cual.');
    parts.push('Si el creativo necesita un segundo envase genérico de comparación, ese sí puede ser inventado y sin marca; pero el producto del anunciante es siempre, exactamente, el de la foto de referencia.');
  }
  if (estilo) parts.push(`Estilo visual: ${estilo}.`);
  if (Array.isArray(paleta) && paleta.length > 0) {
    parts.push('');
    parts.push(`PALETA DE MARCA: usá estos colores como paleta dominante del creativo — fondos, bloques de color, formas y acentos: ${paleta.join(', ')}. El resultado tiene que sentirse coherente con la identidad visual de la marca (su landing y su packaging). Mantené buen contraste para que el texto sea legible.`);
  }
  parts.push('');
  parts.push('DIRECCIÓN CREATIVA — ESTÁNDARES DTC PREMIUM PARA ARGENTINA / LATAM. Esto NO es una foto de catálogo: es un creativo de scroll-stop para Meta Ads que tiene que parar el dedo del cliente en 0.5 segundos. Inspirado en lo que mejor convierte en DTC top (estética tipo Magic Spoon, Athletic Greens, Olipop, Glossier, Aesop) adaptado al mercado local.');
  parts.push('- Composición editorial moderna: foco único claro, jerarquía visual marcada, espacio negativo intencional. Evitá el centrado-aburrido.');
  parts.push('- Iluminación con DIRECCIÓN y profundidad (lateral dura, contraluz suave, o desde arriba + relleno). Nunca luz plana de catálogo.');
  parts.push('- USÁ PROPS REALES Y TANGIBLES con materialidad: papel arrugado, cartón rasgado, telas con pliegues, ingredientes con peso (frutas, raíces, polvos, gotas), cordones, sellos. Cada prop coherente con el mensaje, NO decorativo random.');
  parts.push('- Materialidad y textura visibles en HD: gotas, refracción, microdetalle, sombras y reflejos creíbles. Las cosas tienen peso y gravedad real.');
  parts.push('- UNA sola idea visual potente. Si hay props secundarios, son INTENCIONALES y refuerzan el beneficio (ingredientes, símbolos del problema, antes/después, evidencia tangible).');
  parts.push('- Estética cinematográfica, NO stock: piel y rostros REALISTAS sin look IA (poros, textura, asimetría natural, edad real coherente con el target). Props con materialidad y sombras reales.');
  parts.push('- Contraste cromático intencional: paleta de marca dominante + un acento de tensión que rompa la armonía y atraiga el ojo a un punto. Color block dramático cuando aplica.');
  parts.push('- Buscá UN pattern-interrupt visual: explosión de polvo, ingrediente en suspensión, mano interviniendo, cubierta parcial inesperada, escala dramática del producto. El ojo tiene que ir al producto sí o sí.');
  parts.push('- PROHIBIDO: fondo blanco vacío sin razón, look "render plástico", caras de IA con simetría imposible, props flotantes sin sombra y sin propósito, gradientes saturados sin sentido, sellos/badges mal integrados, etiqueta del producto re-escrita con texto inventado, composición simétrica-aburrida-centrada, dos productos lado a lado sin razón estratégica.');

  parts.push('');
  parts.push('ESCENA / IMAGEN BASE:');
  parts.push(escena);
  if (estiloEscena && ESCENA_GUIDE[estiloEscena]) {
    parts.push('');
    parts.push(ESCENA_GUIDE[estiloEscena]);
    // Variante específica forzada por seed — para que dentro del mismo estilo
    // no se repita siempre la composición canónica entre creativos.
    const variants = VARIANTS[estiloEscena];
    if (Array.isArray(variants) && variants.length > 0) {
      const seed = Math.max(0, Number(variationSeed) || 0);
      const variant = variants[seed % variants.length];
      parts.push(`VARIANTE OBLIGATORIA de este estilo (NO uses la composición canónica/típica — usá ESTA): ${variant}.`);
    }
  }

  parts.push('');
  parts.push('SIN TEXTO — CRÍTICO: NO renderices ningún texto, palabra, letra, número, sello ni logo en la imagen. Generá ÚNICAMENTE el fondo, la escena y el producto. El titular y el botón del aviso se agregan después por código (por eso la imagen tiene que salir 100% limpia de texto — así el texto nunca sale con errores).');
  parts.push('COMPOSICIÓN PARA EL TEXTO: dejá el ~32% SUPERIOR de la imagen como una zona visualmente simple y despejada (fondo liso claro o de color de marca, sin elementos importantes ni el producto) — ahí se compone el titular y, en la esquina superior derecha, un sello/badge chico. Dejá también una franja limpia en el ~15% INFERIOR para un botón. El producto y la escena van en la banda central, sin invadir esas zonas.');

  parts.push('');
  parts.push('Resultado: el fondo + escena + producto de una pieza publicitaria para Meta Ads, SIN nada de texto, con las zonas superior e inferior despejadas para componerle el titular y el botón encima.');

  return parts.join('\n');
}

// Construye el prompt para Ideogram — diferente al de gpt-image-1 porque
// Ideogram SÍ renderiza texto bien, entonces le pedimos que escriba el
// titular, subcopy y CTA dentro de la imagen (no por canvas como con
// gpt-image-1). Prompt en inglés porque Ideogram performa mejor así.
function buildIdeogramPrompt(idea, {
  paleta = [], estiloEscena = '', variationSeed = 0,
  headline = '', cta = '', subcopy = '', badgeText = '',
} = {}) {
  const scene = (idea.promptGeneradorImagen || idea.descripcionImagen || idea.hook || idea.titulo || '').trim();
  const estiloDesc = ESCENA_GUIDE[estiloEscena] || '';
  const variants = VARIANTS[estiloEscena];
  const variant = variants ? variants[variationSeed % variants.length] : '';
  const colorHint = paleta.length > 0 ? `Brand color palette: ${paleta.join(', ')}.` : '';
  const parts = [];
  parts.push('Professional DTC Meta Ads creative, premium scroll-stop design for the Argentine / LatAm market. Editorial composition, cinematic lighting with direction, real props with tangible materiality. Realistic premium product photography — NO AI plastic look, NO uncanny faces.');
  if (estiloDesc) parts.push(estiloDesc);
  if (variant) parts.push(`Composition variant (use THIS, not the typical/canonical one): ${variant}.`);
  if (scene) parts.push(`Scene: ${scene.slice(0, 600)}`);
  if (colorHint) parts.push(colorHint);

  if (headline || cta || subcopy || badgeText) {
    parts.push('');
    parts.push('TEXT TO RENDER IN THE IMAGE (write EXACTLY this text, modern bold sans-serif, perfectly legible, no typos, no extra text):');
    if (headline) parts.push(`- Headline at top, big bold sans-serif: "${headline.slice(0, 100)}"`);
    if (subcopy) parts.push(`- Subcopy just below the headline, smaller and lighter: "${subcopy.slice(0, 80)}"`);
    if (badgeText) parts.push(`- Small circular badge / sticker in top-right corner (red circle with gold border, slightly rotated): "${badgeText.slice(0, 20)}"`);
    if (cta) parts.push(`- CTA button at the bottom — pill shape, brand color background, white bold text: "${cta.slice(0, 40)} →"`);
  }
  parts.push('');
  parts.push('NO watermarks, NO extra text outside the specified, NO garbled letters, NO randomly placed words.');
  return parts.join('\n');
}

// Llama a la API de Ideogram V3 y baja el binario de la imagen (la URL
// que devuelven es de corta duración, hay que bajarla server-side).
async function generateWithIdeogram(prompt, aspectRatio, renderingSpeed, apiKey) {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', aspectRatio);
  form.append('rendering_speed', renderingSpeed);
  form.append('num_images', '1');
  form.append('style_type', 'AUTO');
  form.append('magic_prompt', 'AUTO');

  const resp = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
    method: 'POST',
    headers: { 'Api-Key': apiKey },
    body: form,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Ideogram HTTP ${resp.status}${t ? ': ' + t.slice(0, 300) : ''}`);
  }
  const data = await resp.json();
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  if (!item?.url) throw new Error('Ideogram no devolvió URL de imagen');
  const imgResp = await fetch(item.url);
  if (!imgResp.ok) throw new Error(`No se pudo descargar la imagen de Ideogram (HTTP ${imgResp.status})`);
  const buf = Buffer.from(await imgResp.arrayBuffer());
  const cost = { TURBO: 0.025, DEFAULT: 0.04, QUALITY: 0.08 }[renderingSpeed] || 0.04;
  return {
    b64: buf.toString('base64'),
    sizeResolved: item.resolution || (aspectRatio === '1x1' ? '1024x1024' : '1024x1536'),
    cost,
    model: item.model || 'ideogram-v3',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const body = await readBody(req);
  const idea = body?.idea;
  if (!idea || !(idea.promptGeneradorImagen || idea.descripcionImagen || idea.hook || idea.titulo)) {
    return respondJSON(res, 400, { error: 'La idea no tiene contenido suficiente para generar el creativo (falta hook/título/descripción)' });
  }

  const provider = body?.provider === 'ideogram' ? 'ideogram' : 'openai';
  const quality = ['low', 'medium', 'high'].includes(body?.quality) ? body.quality : 'medium';

  // Paleta de marca — colores hex válidos para inyectar en el prompt.
  const paletaMarca = Array.isArray(body?.paletaMarca)
    ? body.paletaMarca.filter(c => typeof c === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(c)).slice(0, 6)
    : [];
  const estiloEscena = Object.keys(ESCENA_GUIDE).includes(body?.estiloEscena)
    ? body.estiloEscena : '';
  const variationSeed = Math.max(0, Math.floor(Number(body?.variationSeed) || 0));

  // --- RAMA IDEOGRAM ---
  if (provider === 'ideogram') {
    const ideogramKey = process.env.IDEOGRAM_API_KEY;
    if (!ideogramKey) {
      return respondJSON(res, 500, {
        error: 'IDEOGRAM_API_KEY no configurada en el servidor. Agregala en Vercel → Settings → Environment Variables.',
      });
    }
    const overlayText = body?.overlayText || {};
    const ideogramPrompt = buildIdeogramPrompt(idea, {
      paleta: paletaMarca, estiloEscena, variationSeed,
      headline: String(overlayText.headline || '').slice(0, 120),
      cta: String(overlayText.cta || '').slice(0, 60),
      subcopy: String(overlayText.subcopy || '').slice(0, 100),
      badgeText: String(overlayText.badgeText || '').slice(0, 20),
    });
    const aspectRatio = idea?.formato === 'video' ? '9x16' : '1x1';
    const renderingSpeed = { low: 'TURBO', medium: 'DEFAULT', high: 'QUALITY' }[quality] || 'DEFAULT';
    try {
      const r = await generateWithIdeogram(ideogramPrompt, aspectRatio, renderingSpeed, ideogramKey);
      return respondJSON(res, 200, {
        imageBase64: r.b64,
        mimeType: 'image/png',
        size: r.sizeResolved,
        quality,
        formato: idea.formato || 'static',
        model: r.model,
        generatedAt: new Date().toISOString(),
        overlayDone: true, // Ideogram ya rendea el texto — el cliente no compone con canvas.
        cost: { openai: r.cost }, // bucketamos bajo openai por ahora.
      });
    } catch (err) {
      console.error('Ideogram error:', err);
      return respondJSON(res, 502, { error: `Ideogram falló: ${err.message}` });
    }
  }

  // --- RAMA OPENAI (gpt-image-1) ---
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respondJSON(res, 500, {
      error: 'OPENAI_API_KEY no configurada en el servidor. Agregala en Vercel → Settings → Environment Variables.',
    });
  }

  const size = sizeForFormato(idea.formato);

  // Foto real del producto (data URL). Si viene, generamos con el endpoint
  // de EDICIÓN de gpt-image-1 pasándola como referencia → el envase del
  // creativo es el producto real, no uno inventado.
  const productoImagen = typeof body?.productoImagen === 'string' ? body.productoImagen : '';
  const usarProductoReal = productoImagen.length > 0;
  const fb = body?.feedbackQA;
  const feedbackQA = fb && typeof fb === 'object' ? {
    problemas: Array.isArray(fb.problemas) ? fb.problemas.map(p => String(p).slice(0, 300)).slice(0, 8) : [],
    sugerencia: String(fb.sugerencia || '').slice(0, 400),
    fortalezas: Array.isArray(fb.fortalezas) ? fb.fortalezas.map(p => String(p).slice(0, 200)).slice(0, 6) : [],
  } : null;
  const prompt = buildImagePrompt(idea, { usarProductoReal, paleta: paletaMarca, feedbackQA, estiloEscena, variationSeed });

  try {
    let resp;
    if (usarProductoReal) {
      // /v1/images/edits es multipart — armamos el form con la foto.
      const base64 = productoImagen.includes(',') ? productoImagen.split(',')[1] : productoImagen;
      const imgBuffer = Buffer.from(base64, 'base64');
      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('quality', quality);
      form.append('n', '1');
      form.append('image', new Blob([imgBuffer], { type: 'image/jpeg' }), 'producto.jpg');
      resp = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      resp = await fetch('https://api.openai.com/v1/images/generations', {
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
    }

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
