// Bulk generation desde Bandeja → crear-imagen-desde-idea con N variantes.
//
// Por qué un archivo aparte y no extender creativoGeneratorStore:
// - El store viejo usa /api/marketing/generate-creative (1 imagen por idea,
//   sin N variantes ni cloud save server-side).
// - Este flow usa /api/marketing/crear-imagen-desde-idea (mismo que la UI
//   single-idea de IdeaImageGenerator) que tiene plan de N divergence levels
//   y cloud save server-side automático.
// - El bulk corre secuencial (concurrency=1) para no congestionar OpenAI ni
//   acumular base64 en memoria del browser.

import { supabase } from './supabase.js';
import { getProductoImagen, getAccentColor } from './productoImagen.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';
import { saveReferencial } from './galeriaReferenciales.js';
import { logCostsFromResponse } from './costsStore.js';
import { playDoneChime, playBulkDoneChime, playErrorTone } from './sounds.js';

// Genera N variantes para CADA idea en `ideas[]`, secuencial. Devuelve
// { ok, failed, totalImages, costoUSD } al terminar.
//
// addToast es opcional (la mayoría de los errores se reportan vía toast).
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
  const prodImg = getProductoImagen(producto.id);
  if (!prodImg) {
    addToast?.({ type: 'error', message: 'Falta la foto del producto en Setup (Arranque).' });
    return { ok: 0, failed: ideas.length, totalImages: 0, costoUSD: 0 };
  }

  // Una sola execution con sublabel dinámico — el user ve "3/10 ideas" en
  // el ActivityBell sin spamearlo con 10 entradas.
  const execId = startExecution({
    label: `Generando creativos en bulk · ${ideas.length} ideas × ${n} var`,
    sublabel: `gpt-image-2 · ${quality}`,
    kind: 'bulk-creative-from-idea',
    estimatedMs: ideas.length * 60000 * n / 2, // ~60s por par de variantes
    estimatedCost: ideas.length * n * (quality === 'low' ? 0.013 : quality === 'medium' ? 0.046 : 0.180),
  });

  let ok = 0;
  let failed = 0;
  let totalImages = 0;
  let costoUSD = 0;
  let authToken = '';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    authToken = session?.access_token || '';
  } catch {}
  const accentColor = getAccentColor(producto.id) || '';

  for (let i = 0; i < ideas.length; i++) {
    const idea = ideas[i];
    updateExecution(execId, { stage: `${i + 1}/${ideas.length}: ${(idea.hook || idea.titulo || '').slice(0, 50)}` });
    try {
      const resp = await fetch('/api/marketing/crear-imagen-desde-idea', {
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
            ofertasReales: producto.ofertasReales || '',
            offerBrief: producto.ofertasReales || producto.docs?.offerBrief || '',
          },
          productoImagen: prodImg,
          accentColor,
          n,
          size,
          quality,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

      const costo = logCostsFromResponse(data, `bulk-bandeja · ${(idea.hook || idea.titulo || '').slice(0, 40)}`);
      costoUSD += costo?.total || 0;

      // Si el server-side cloud save funcionó, listo. Si no, fallback a IDB.
      const cloudOk = Array.isArray(data.cloudCreativos) && data.cloudCreativos.length > 0;
      if (cloudOk) {
        try {
          window.dispatchEvent(new CustomEvent('viora:referencial-saved', {
            detail: { productoId: String(producto.id), cloud: true },
          }));
        } catch {}
        totalImages += data.cloudCreativos.length;
      } else {
        if (data.cloudSaveError) {
          console.warn(`[bulk] idea ${idea.id} cloudSaveError:`, data.cloudSaveError);
        }
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
        totalImages += imagenes.length;
        // Liberar refs del base64 para que el GC pueda recuperar la RAM
        // antes de la siguiente idea. Con 10 ideas × 2 imágenes high quality
        // (5-15MB cada una) el browser puede quedarse sin RAM.
        if (data.imagenes) data.imagenes.length = 0;
      }
      ok++;
    } catch (err) {
      failed++;
      console.warn(`[bulk] idea ${idea.id} falló:`, err.message);
      addToast?.({ type: 'error', message: `Idea "${(idea.hook || idea.titulo || '').slice(0, 40)}": ${err.message}` });
    }
    // Pequeña pausa entre ideas para no congestionar OpenAI rate limit.
    if (i < ideas.length - 1) await new Promise(r => setTimeout(r, 500));
  }

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
