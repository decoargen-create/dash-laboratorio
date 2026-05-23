// Genera el creativo de UNA idea, de punta a punta. Lo usa la generación
// masiva (un creativo por idea, en loop) — misma lógica que el panel
// individual pero sin la auto-mejora, para acotar el costo en bulk.

import { componerCreativo, extraerCTA, extraerHeadlineYSubcopy } from './componerCreativo.js';

// Estilos de escena disponibles para el bulk.
const ESTILOS = ['producto', 'lifestyle', 'ugc', 'comparacion'];

// Elige el estilo de escena para esta idea cuando el user pidió "auto" en
// el bulk — mezcla mapeo por características de la idea (tipo / etapa de
// campaña) con un round-robin de fallback, para que la tanda tenga variedad.
export function pickEstilo(idea, i) {
  const camp = idea?.tipoCampaña;
  const tipo = idea?.tipo;
  if (camp === 'social_proof') return 'ugc';
  if (camp === 'BOFU' || camp === 'retargeting') return 'comparacion';
  if (tipo === 'replica') return 'comparacion';
  if (tipo === 'diferenciacion') return 'lifestyle';
  // Cycle entre los 3 restantes para variedad.
  return ['producto', 'lifestyle', 'ugc'][i % 3];
}

import { getProductoImagen, getPaletaMarca } from './productoImagen.js';
import { saveCreativo } from './creativosStorage.js';
import { logCostsFromResponse } from './costsStore.js';

export async function generarCreativoParaIdea(idea, { quality = 'medium', estiloEscena = 'producto', signal } = {}) {
  const productoImagen = getProductoImagen(idea.productoId);
  const paletaMarca = getPaletaMarca(idea.productoId);

  const resp = await fetch('/api/marketing/generate-creative', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      quality,
      estiloEscena,
      productoImagen,
      paletaMarca,
      idea: {
        promptGeneradorImagen: idea.promptGeneradorImagen,
        descripcionImagen: idea.descripcionImagen,
        textoEnImagen: idea.textoEnImagen,
        hook: idea.hook,
        titulo: idea.titulo,
        formato: idea.formato,
        estiloVisual: idea.estiloVisual,
        angulo: idea.angulo,
        painPoint: idea.painPoint,
        copyPostMeta: idea.copyPostMeta || idea.copy,
      },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  logCostsFromResponse(data, `generate-creative masivo · ${(idea.titulo || idea.hook || '').slice(0, 50)}`);

  // La IA devuelve la imagen sin texto — componemos titular + subcopy + CTA.
  const baseB64 = data.imageBase64;
  const { headline, subcopy } = extraerHeadlineYSubcopy(idea);
  const overlay = { headline, subcopy, cta: extraerCTA(idea) };
  const finalUrl = await componerCreativo(
    `data:${data.mimeType || 'image/png'};base64,${baseB64}`,
    { ...overlay, colorCta: paletaMarca[0] || '#b8895a' }
  );
  const nuevo = {
    imageBase64: finalUrl.includes(',') ? finalUrl.split(',')[1] : finalUrl,
    baseBase64: baseB64,
    overlay,
    mimeType: 'image/png',
    formato: data.formato || idea.formato || 'static',
    size: data.size,
    quality: data.quality,
    model: data.model,
    generatedAt: data.generatedAt,
  };

  // QA — best-effort, no es fatal si falla.
  try {
    const qr = await fetch('/api/marketing/qa-creative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ imageBase64: nuevo.imageBase64, mimeType: 'image/png', hook: idea.hook, textoEnImagen: idea.textoEnImagen }),
    });
    const qd = await qr.json();
    if (qr.ok && qd.qa) {
      logCostsFromResponse(qd, 'qa-creative masivo');
      nuevo.qa = qd.qa;
    }
  } catch { /* QA opcional */ }

  await saveCreativo(idea.id, nuevo);
  return nuevo;
}
