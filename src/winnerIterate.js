// Genera variaciones nuevas DIRECTO desde un winner — mismo flow que
// InspiracionSection.crearReferencialDeAd pero usando la imagen del winner
// como referencia visual (en lugar de un ad de competencia).
//
// Pipeline:
//   1. Toma el winner como inspiración (imageUrl + headline + sourceBrand).
//   2. Llama a /api/marketing/crear-creativo-referencial con la imagen del
//      winner como ref + el producto activo como target.
//   3. Si el backend guardó al cloud (auth presente), refresca el evento;
//      sino, persiste a IDB local con saveReferencial.
//   4. Repite N veces para generar N variaciones (concurrency=1 para no
//      ahogar memoria con base64 grandes).
//
// Se mantiene `iterateFromWinner` (legacy → idea en Bandeja) para no romper
// callers viejos. El nuevo flujo es `generateFromWinner` que devuelve la
// imagen directo.

import { supabase } from './supabase.js';
import { getProductoImagen } from './productoImagen.js';
import { saveReferencial } from './galeriaReferenciales.js';

// Parse defensivo de la response — el endpoint a veces devuelve HTML cuando
// Vercel mata la función. Sin esto el JSON.parse rompe con "Unexpected token".
async function parseJsonOrThrow(resp, contexto = 'crear-creativo-referencial') {
  const raw = await resp.text();
  try {
    return JSON.parse(raw);
  } catch {
    const isVercelKill = /Internal Server Error|An error occurred with your deployment|FUNCTION_INVOCATION_FAILED/i.test(raw)
                        || /^\s*<(!doctype|html)/i.test(raw);
    if (resp.status === 504 || /timeout/i.test(raw)) {
      throw new Error(`${contexto} timeout — el servidor tardó más que el límite. Reintentá.`);
    }
    if (isVercelKill) {
      throw new Error(`${contexto} crasheó en el servidor (timeout o memoria). Reintentá con quality medium.`);
    }
    throw new Error(`${contexto} respuesta inválida (HTTP ${resp.status})`);
  }
}

export async function generateFromWinner(creativo, producto, opts = {}) {
  if (!creativo?.id) throw new Error('generateFromWinner: falta creativo');
  if (!producto?.id) throw new Error('generateFromWinner: falta producto');
  if (!creativo.imageUrl && !creativo.imageBase64) {
    throw new Error('El winner no tiene imagen para usar como referencia');
  }

  const { quality = 'high', size = '1024x1024', n = 1, onProgress } = opts;

  // 1. Foto del producto — sin esto el endpoint rechaza con 400.
  const prodImg = await getProductoImagen(producto.id, producto);
  if (!prodImg) {
    throw new Error('Cargá la foto del producto en Setup primero.');
  }

  // 2. Auth token — el backend lo necesita para guardar al cloud directo.
  let authToken = '';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    authToken = session?.access_token || '';
  } catch {}

  // 3. La URL del winner como inspiración. Si solo hay base64 (item legacy
  //    IDB), tendríamos que subir y obtener URL — por ahora throw clarito.
  const inspiracionImageUrl = creativo.imageUrl;
  if (!inspiracionImageUrl) {
    throw new Error('Este winner solo está en local (sin imageUrl). Re-generalo primero para que vaya al cloud.');
  }

  const brandNombre = creativo.sourceBrand || 'winner';
  const winnerHeadline = creativo.sourceHeadline || '';

  const baseBody = {
    producto: {
      id: producto.id,
      nombre: producto.nombre,
      descripcion: producto.descripcion,
      research: producto.docs?.research,
      formato: producto.formato || '',
      ofertasReales: producto.ofertasReales || '',
      offerBrief: producto.ofertasReales || producto.docs?.offerBrief || '',
    },
    inspiracion: {
      brandNombre,
      // Headline del winner. Lo pasamos sin body porque el winner ya pasó por
      // gpt-image-2 una vez — su "body" no es ad copy, es prompt residual.
      body: winnerHeadline,
      headline: winnerHeadline,
      formato: 'static',
      analysis: null,
      visual: null,
    },
    inspiracionImageUrl,
    productoImagen: prodImg,
    quality,
    size,
  };

  const created = [];
  let cachedPlan = null;
  const total = Math.max(1, Math.min(10, n));

  for (let i = 0; i < total; i++) {
    onProgress?.({ current: i + 1, total });
    const resp = await fetch('/api/marketing/crear-creativo-referencial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        ...baseBody,
        n: 1,
        nPlan: total,
        variationStartIndex: i,
        skeletonCached: cachedPlan,
      }),
    });
    const data = await parseJsonOrThrow(resp);
    if (!resp.ok) {
      const errMsg = (data && typeof data.error === 'string') ? data.error : `HTTP ${resp.status}`;
      throw new Error(errMsg);
    }

    // Cachear plan después del primer call para evitar re-correr Strategist.
    if (i === 0 && (data.plan || data.skeleton)) {
      cachedPlan = data.plan || cachedPlan;
    }

    // Si el backend ya guardó al cloud, no re-subimos.
    if (Array.isArray(data.cloudCreativos) && data.cloudCreativos.length > 0) {
      created.push(...data.cloudCreativos);
      try {
        window.dispatchEvent(new CustomEvent('viora:referencial-saved', {
          detail: { productoId: String(producto.id), cloud: true },
        }));
      } catch {}
      continue;
    }

    // Fallback IDB: guardar la imagen base64 local.
    const variantStyle = data.variantStyles?.[0] || 'iteracion-winner';
    const promptStr = data.prompts?.[0]?.prompt || data.promptReference || '';
    const newId = `ref_${Date.now()}_winner_${creativo.id}_${i}`;
    await saveReferencial({
      id: newId,
      productoId: String(producto.id),
      sourceAdId: creativo.id,
      sourceBrand: brandNombre,
      sourceImageUrl: inspiracionImageUrl,
      sourceHeadline: winnerHeadline,
      sourceType: 'winner-iterate',
      variantIndex: i,
      variantStyle,
      imageBase64: data.imagenes?.[0] || '',
      mimeType: data.mimeType || 'image/png',
      prompt: promptStr,
      skeleton: cachedPlan?.visual || data.skeleton || null,
      model: data.model,
      visionModel: data.visionModel || null,
      size: data.size,
      sizeFallback: !!data.sizeFallback,
      quality: data.quality || quality,
      createdAt: new Date().toISOString(),
    });
    created.push({ id: newId });

    // Liberar el base64 del response para no acumular memoria.
    if (data.imagenes) data.imagenes.length = 0;
  }

  return { created, count: created.length };
}

// ---------- Legacy: iterar via Bandeja (deprecated, conservar por compat) ---
import { addIdea } from './bandejaStore.js';

export async function iterateFromWinner(creativo, producto) {
  if (!creativo?.id) throw new Error('iterateFromWinner: falta creativo');
  if (!producto?.id) throw new Error('iterateFromWinner: falta producto');

  const metrics = creativo.winnerMetrics || {};
  const queFunciono = Array.isArray(metrics.que_funciono) ? metrics.que_funciono : [];
  const titulo = queFunciono.length > 0
    ? `Iterar winner — pinear ${queFunciono.join(' + ')}`
    : `Iterar winner — ${creativo.sourceHeadline || creativo.sourceBrand || 'sin nombre'}`;
  const variableSugerida = sugerirVariableTesteo(queFunciono);

  return addIdea({
    productoId: String(producto.id),
    productoNombre: producto.nombre,
    titulo,
    tipo: 'iteracion',
    formato: 'static',
    estado: 'pendiente',
    angulo: '',
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
}

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
  return 'hook';
}
