// Bulk generation desde Bandeja → crear-imagen-desde-idea con N variantes.
//
// Por qué un archivo aparte y no extender creativoGeneratorStore:
// - El store viejo usa /api/marketing/generate-creative (1 imagen por idea,
//   sin N variantes ni cloud save server-side).
// - Este flow usa /api/marketing/crear-imagen-desde-idea (mismo que la UI
//   single-idea de IdeaImageGenerator) que tiene plan de N divergence levels
//   y cloud save server-side automático.
//
// FIRE-ALL-AT-ONCE — para que sobreviva cerrar pestaña:
// - Disparamos las N requests al toque (sin concurrency throttle local).
// - El browser pool de conexiones limita ~6 simultáneas; el resto encola
//   en el browser network stack. Si el user cierra la pestaña, las que ya
//   se dispararon completan server-side (Vercel no mata serverless functions
//   al desconectarse el cliente). Las que están en cola del browser quedan
//   sin disparar — para esos casos el user debe esperar 5-10s antes de cerrar.
// - El server retry handler (RETRY_DELAYS en crear-imagen-desde-idea)
//   absorbe los 429 de rate limit naturales con backoff.

import { supabase } from './supabase.js';
import { getProductoImagen, getAccentColor } from './productoImagen.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';
import { saveReferencial } from './galeriaReferenciales.js';
import { logCostsFromResponse } from './costsStore.js';
import { playDoneChime, playBulkDoneChime, playErrorTone } from './sounds.js';
import { updateIdea } from './bandejaStore.js';

// Procesa la respuesta de una idea — si cloud OK no hace nada (el server
// ya guardó), si no cae a IDB local.
async function processResponse(data, idea, producto, quality) {
  const cloudOk = Array.isArray(data.cloudCreativos) && data.cloudCreativos.length > 0;
  if (cloudOk) {
    try {
      window.dispatchEvent(new CustomEvent('viora:referencial-saved', {
        detail: { productoId: String(producto.id), cloud: true },
      }));
    } catch {}
    return { saved: data.cloudCreativos.length, cloud: true };
  }
  if (data.cloudSaveError) {
    console.warn(`[bulk] idea ${idea.id} cloudSaveError:`, data.cloudSaveError);
  }
  // Fallback IDB local. Esto SÍ requiere que la pestaña esté abierta —
  // si el user cerró, este código no corre y los base64 se pierden.
  const imagenes = data.imagenes || [];
  const variantStyles = data.variantStyles || [];
  const prompts = data.prompts || [];
  const ts = Date.now();
  for (let j = 0; j < imagenes.length; j++) {
    await saveReferencial({
      id: `idea_${ts}_${idea.id}_${j}`,
      productoId: String(producto.id),
      sourceType: 'bandeja-idea',
      sourceIdeaId: idea.id,
      sourceBrand: 'Idea propia',
      sourceHeadline: idea.hook || idea.titulo || '',
      variantIndex: j,
      variantStyle: variantStyles[j] || 'tight',
      imageBase64: imagenes[j],
      mimeType: data.mimeType || 'image/png',
      prompt: prompts[j]?.prompt || '',
      model: data.model,
      size: data.size,
      sizeFallback: !!data.sizeFallback,
      quality: data.quality || quality,
      createdAt: new Date(ts + j).toISOString(),
    });
  }
  if (data.imagenes) data.imagenes.length = 0;
  return { saved: imagenes.length, cloud: false };
}

// Lanza UNA idea — devuelve la promesa del fetch + processResponse.
// La promesa SE EJECUTA al llamar (no se espera) — eso es lo que permite
// disparar N en paralelo. authToken se obtiene una vez al inicio del bulk
// (los tokens Supabase duran ~1h, suficiente para bulks típicos).
function fireIdea({ idea, producto, prodImg, accentColor, n, quality, size, authToken }) {
  return fetch('/api/marketing/crear-imagen-desde-idea', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      idea: {
        id: idea.id,
        hook: idea.hook,
        titulo: idea.titulo,
        angulo: idea.angulo,
        painPoint: idea.painPoint,
        escenarioNarrativo: idea.escenarioNarrativo,
        descripcionImagen: idea.descripcionImagen,
        estiloVisual: idea.estiloVisual,
        publicoSugerido: idea.publicoSugerido,
        creenciaApalancada: idea.creenciaApalancada,
        textoEnImagen: idea.textoEnImagen,
        formato: idea.formato,
      },
      producto: {
        id: producto.id,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        research: producto.docs?.research,
        formato: producto.formato || '',
        ofertasReales: producto.ofertasReales || '',
        offerBrief: producto.ofertasReales || producto.docs?.offerBrief || '',
      },
      productoImagen: prodImg,
      accentColor,
      n,
      size,
      quality,
    }),
  }).then(async resp => {
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  });
}

// Genera N variantes para CADA idea en `ideas[]`, EN PARALELO.
// El UI registra progreso a medida que cada idea termina. Si el user cierra
// la pestaña: las requests que ya se dispararon completan server-side (cloud
// save) y los creativos aparecen en Galería en el próximo login.
export async function bulkGenerateFromIdeas({
  ideas,
  producto,
  n = 2,
  quality = 'high',
  size,
  addToast,
}) {
  if (!producto?.nombre) {
    addToast?.({ type: 'error', message: 'Falta producto (cargá uno en Setup).' });
    return { ok: 0, failed: ideas.length, totalImages: 0, costoUSD: 0 };
  }
  // Pasamos el producto como fallback — cross-device, localStorage puede
  // no haber sincronizado todavía pero el cloud sí tiene producto.fotoUrl.
  const prodImg = await getProductoImagen(producto.id, producto);
  if (!prodImg) {
    addToast?.({ type: 'error', message: 'Falta la foto del producto en Setup (Arranque).' });
    return { ok: 0, failed: ideas.length, totalImages: 0, costoUSD: 0 };
  }

  const execId = startExecution({
    label: `Bulk · ${ideas.length} ideas × ${n} variantes`,
    sublabel: `gpt-image-2 · ${quality} · podés cerrar la pestaña`,
    kind: 'bulk-creative-from-idea',
    estimatedMs: ideas.length * 60000,
    estimatedCost: ideas.length * n * (quality === 'low' ? 0.013 : quality === 'medium' ? 0.046 : 0.180),
  });

  let authToken = '';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    authToken = session?.access_token || '';
  } catch {}
  const accentColor = getAccentColor(producto.id, producto) || '';

  // Disparar TODAS las requests sincrónicamente al inicio. Esto asegura
  // que estén en flight (browser network stack) antes de que el user pueda
  // cerrar la pestaña. El browser limita ~6 simultáneas; el resto encola
  // localmente y se manda apenas se libera una conexión.
  const promises = ideas.map(idea =>
    fireIdea({ idea, producto, prodImg, accentColor, n, quality, size, authToken })
      .then(async data => {
        const costo = logCostsFromResponse(data, `bulk-bandeja · ${(idea.hook || idea.titulo || '').slice(0, 40)}`);
        const result = await processResponse(data, idea, producto, quality);
        // Marcar la idea como "usada" — sin esto se queda en la columna
        // "Pendientes" del kanban aunque ya generaste imágenes desde ella.
        // El user tenía que moverlas a mano: con 20 ideas era insostenible.
        try {
          await updateIdea(idea.id, {
            estado: 'usada',
            usadaAt: new Date().toISOString(),
            creativosGenerados: (idea.creativosGenerados || 0) + (result.saved || 0),
          });
        } catch (err) {
          console.warn(`[bulk] no pude marcar idea ${idea.id} como usada:`, err.message);
        }
        return { ok: true, idea, cost: costo?.total || 0, ...result };
      })
      .catch(err => {
        console.warn(`[bulk] idea ${idea.id} falló:`, err.message);
        return { ok: false, idea, error: err.message, saved: 0 };
      })
  );

  // Reporter de progreso en vivo — cuenta cuántas terminaron.
  let completed = 0;
  promises.forEach(p => p.then(() => {
    completed++;
    updateExecution(execId, { stage: `${completed}/${ideas.length} ideas listas` });
  }));

  // Notificar al user que YA se dispararon todas — puede cerrar.
  addToast?.({
    type: 'info',
    message: `${ideas.length} ideas disparadas en paralelo. Podés cerrar la pestaña — el cloud save sigue.`,
  });

  // Esperar a que todas terminen (para reportar resumen y reproducir chime).
  // Si el user cierra antes, este await muere pero las fetches en flight
  // continúan server-side.
  const results = await Promise.all(promises);
  const ok = results.filter(r => r.ok).length;
  const failed = results.length - ok;
  const totalImages = results.reduce((acc, r) => acc + (r.saved || 0), 0);
  const costoUSD = results.reduce((acc, r) => acc + (r.cost || 0), 0);

  const message = failed === 0
    ? `${ok} ideas listas — ${totalImages} imágenes en Galería`
    : `${ok}/${ideas.length} OK (${failed} fallaron) — ${totalImages} imágenes en Galería`;
  finishExecution(execId, { ok: failed === 0, message, cost: costoUSD });

  if (ok > 0) {
    if (ok >= 2) playBulkDoneChime(); else playDoneChime();
    addToast?.({ type: failed === 0 ? 'success' : 'warning', message });
  } else {
    playErrorTone();
  }
  return { ok, failed, totalImages, costoUSD };
}
