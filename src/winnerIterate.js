// Iterar desde un winner — crea una idea tipo "iteracion" en la Bandeja
// pinneando lo que funcionó del creativo ganador, lista para que el user la
// regenere con IdeaImageGenerator.
//
// La idea queda en estado pendiente con:
//   - tipo: 'iteracion'
//   - origen.tipo: 'winner'
//   - origen.referencialId: el id del creativo padre
//   - origen.imageUrl: la imagen del winner como referencia visual
//   - tag de qué funcionó (winnerMetrics.que_funciono) para que la generación
//     futura sepa qué variable pinear
//
// El user después la edita o le da "Generar" en la Bandeja — la imagen sale
// con el contexto del winner como guía.

import { addIdea } from './bandejaStore.js';

export async function iterateFromWinner(creativo, producto) {
  if (!creativo?.id) throw new Error('iterateFromWinner: falta creativo');
  if (!producto?.id) throw new Error('iterateFromWinner: falta producto');

  const metrics = creativo.winnerMetrics || {};
  const queFunciono = Array.isArray(metrics.que_funciono) ? metrics.que_funciono : [];

  // Título corto basado en lo que funcionó.
  const titulo = queFunciono.length > 0
    ? `Iterar winner — pinear ${queFunciono.join(' + ')}`
    : `Iterar winner — ${creativo.sourceHeadline || creativo.sourceBrand || 'sin nombre'}`;

  // Variable a testear: la PRIMERA cosa NO incluida en que_funciono. La
  // lógica del A/B-testing fuerte es: pinear lo que funciona, variar UNA
  // cosa. Defaults: si pinearon hook → testear visual. Si pinearon visual
  // → testear hook. Etc.
  const variableSugerida = sugerirVariableTesteo(queFunciono);

  const nueva = addIdea({
    productoId: String(producto.id),
    productoNombre: producto.nombre,
    titulo,
    tipo: 'iteracion',
    formato: 'static',  // los winners de galería son siempre static por ahora
    estado: 'pendiente',
    angulo: '',  // user puede completar después
    hook: '',
    descripcionImagen: `Iteración de un ganador: pinear ${queFunciono.length > 0 ? queFunciono.join(', ') : 'lo que funciona'} y variar ${variableSugerida}.`,
    variableDeTesteo: variableSugerida,
    testHipotesis: queFunciono.length > 0
      ? `El ganador ${queFunciono.join(' + ')} rinde. Hipótesis: variando ${variableSugerida} podemos extender el cluster sin perder el ángulo ganador.`
      : `El creativo padre rinde. Hipótesis: variando ${variableSugerida} extendemos la cluster.`,
    notas: [
      metrics.ad_id ? `Ad ID original: ${metrics.ad_id}` : null,
      metrics.ctr ? `CTR: ${metrics.ctr}%` : null,
      metrics.roas ? `ROAS: ${metrics.roas}` : null,
      metrics.cpa ? `CPA: $${metrics.cpa}` : null,
      metrics.notas ? `Notas: ${metrics.notas}` : null,
    ].filter(Boolean).join(' · '),
    origen: {
      tipo: 'winner',
      referencialId: creativo.id,
      imageUrl: creativo.imageUrl || null,
      sourceBrand: creativo.sourceBrand || null,
      sourceHeadline: creativo.sourceHeadline || null,
      adId: metrics.ad_id || null,
      adNombre: creativo.sourceHeadline || null,
      razonIteracion: queFunciono.length > 0
        ? `Pinear ${queFunciono.join(' + ')} del winner, variar ${variableSugerida}`
        : `Iterar sobre lo que rindió`,
    },
  });

  return nueva;
}

// Decide qué variable testear pinneando lo que funcionó. Lógica:
//   - Si pinearon hook + visual → testear CTA o oferta
//   - Si pinearon hook → testear visual
//   - Si pinearon visual → testear hook
//   - Si pinearon ángulo → testear hook
//   - Si no especificaron → testear hook (default más útil)
function sugerirVariableTesteo(queFunciono) {
  const f = new Set(queFunciono || []);
  if (f.has('hook') && f.has('visual')) return 'cta';
  if (f.has('hook') && f.has('angulo')) return 'visual';
  if (f.has('hook')) return 'visual';
  if (f.has('visual')) return 'hook';
  if (f.has('angulo')) return 'hook';
  if (f.has('copy')) return 'visual';
  if (f.has('oferta')) return 'hook';
  if (f.has('cta')) return 'visual';
  return 'hook'; // default
}
