// Genera el creativo de UNA idea, de punta a punta. Lo usa la generación
// masiva (un creativo por idea, en loop) — misma lógica que el panel
// individual pero sin la auto-mejora, para acotar el costo en bulk.

import { componerCreativo, extraerCTA, extraerHeadlineYSubcopy } from './componerCreativo.js';
import { getProductoImagen, getPaletaMarca, getDatosMarketing } from './productoImagen.js';
import { saveCreativo } from './creativosStorage.js';
import { logCostsFromResponse } from './costsStore.js';

// Estilos de escena disponibles internamente — el "auto" del bulk rota
// por todos. El selector de la UI muestra solo los 4 principales para no
// abrumar; los 5 nuevos (explosion, mesa_aerea, editorial, testimonio,
// mascot) salen vía auto.
// Pools por etapa de campaña. Comparación se usa con moderación (1 cada
// ~5 estilos) — sino el bulk repite el patrón "dos personas split" todo
// el tiempo.
const POOLS = {
  social_proof:    ['testimonio', 'ugc', 'editorial', 'testimonio', 'lifestyle'],
  BOFU:            ['producto', 'explosion', 'mascot', 'editorial', 'comparacion'],
  retargeting:     ['mascot', 'explosion', 'editorial', 'producto', 'comparacion'],
  branding:        ['editorial', 'producto', 'mesa_aerea', 'lifestyle', 'explosion'],
  TOFU:            ['lifestyle', 'mesa_aerea', 'editorial', 'ugc', 'testimonio'],
  MOFU:            ['lifestyle', 'testimonio', 'producto', 'mesa_aerea', 'comparacion'],
};
const POOL_DEFAULT = ['lifestyle', 'producto', 'ugc', 'testimonio', 'mesa_aerea', 'editorial', 'explosion', 'mascot'];

// Elige el estilo de escena para esta idea cuando el user pidió "auto" en
// el bulk — pool acorde a la etapa de campaña + round-robin dentro del pool,
// para que la tanda tenga variedad real (no 46 packshots iguales).
export function pickEstilo(idea, i) {
  const pool = POOLS[idea?.tipoCampaña] || POOL_DEFAULT;
  // Sesgo extra por tipo de idea:
  if (idea?.tipo === 'replica' && !POOLS[idea?.tipoCampaña]) return 'comparacion';
  if (idea?.tipo === 'diferenciacion' && !POOLS[idea?.tipoCampaña]) return ['editorial', 'lifestyle', 'mascot'][i % 3];
  return pool[i % pool.length];
}

export async function generarCreativoParaIdea(idea, { quality = 'medium', estiloEscena = 'producto', variationSeed = 0, signal } = {}) {
  const productoImagen = getProductoImagen(idea.productoId);
  const paletaMarca = getPaletaMarca(idea.productoId);
  const mkt = getDatosMarketing(idea.productoId) || {};

  const resp = await fetch('/api/marketing/generate-creative', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      quality,
      estiloEscena,
      variationSeed,
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
    {
      ...overlay,
      colorCta: paletaMarca[0] || '#b8895a',
      badgeText: mkt.badgeText || '',
      rating: Number(mkt.rating || 0),
      reviews: Number(mkt.reviews || 0),
    }
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
