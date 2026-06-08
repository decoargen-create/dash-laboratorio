// Helpers para interactuar con la API de Apify y normalizar outputs de
// distintos actors de Facebook Ad Library (oficial + comunitarios).
//
// Todos los actors devuelven shapes similares pero con pequeñas diferencias
// en los nombres de campos. normalizeAd() abstrae eso.

const APIFY_API_BASE = 'https://api.apify.com/v2';

// Dispara un run del actor y espera hasta que termine. Devuelve los items
// del dataset directamente (output del actor). Tarda 30-180s según cuántos
// ads scrapee. Vercel maxDuration del endpoint tiene que cubrir eso.
//
// Endpoint de Apify: /acts/{actorId}/run-sync-get-dataset-items
// Docs: https://docs.apify.com/api/v2#/reference/actors/run-actor-synchronously-and-get-dataset-items
//
// IMPORTANTE — Pay Per Result actors (como apify/facebook-ads-scraper):
// requieren `maxItems` como QUERY PARAM, no en el body del input. Es el cap
// de gasto que Apify enforces antes de invocar al actor. Sin esto, devuelve
// "Maximum charged results must be greater than zero" (HTTP 400). Lo sacamos
// del input.maxItems / input.resultsLimit y lo mandamos al URL.
export async function runActorSync(actorId, input, token, opts = {}) {
  const { timeout = 240 } = opts;
  const actorPath = actorId.replace('/', '~');

  // Prioridad: input.maxItems → input.maxResults → input.resultsLimit.
  // Si ninguno está, default 50 — Apify rechaza 0/null en PPR actors.
  const maxItems = Number(input?.maxItems || input?.maxResults || input?.resultsLimit || 50);
  const params = new URLSearchParams({
    token,
    timeout: String(timeout),
    maxItems: String(Math.max(1, maxItems)),
  });
  const url = `${APIFY_API_BASE}/acts/${actorPath}/run-sync-get-dataset-items?${params.toString()}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Apify run failed (${resp.status}): ${text.slice(0, 300)}`);
  }
  return await resp.json();
}

// Parsea el start_date del ad (distintos formatos según actor) a ISO string.
function parseStartDate(raw) {
  const candidates = [
    raw.startDate, raw.start_date, raw.startDateFormatted,
    raw.snapshot?.startDate, raw.ad_delivery_start_time,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'number') {
      // Podría ser epoch segundos o milisegundos
      const ms = c < 1e12 ? c * 1000 : c;
      return new Date(ms).toISOString();
    }
    if (typeof c === 'string') {
      const d = new Date(c);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

// Clasifica el formato real del ad. Prioriza `display_format` (el formato
// declarado por Meta) sobre la inferencia por URLs — antes la heurística
// "tiene cualquier video → video" marcaba como video los carruseles de
// imágenes (las cards traen videoHdUrl aunque sean estáticas).
function clasificarFormato(displayFormat, imageUrls, videoUrls) {
  const df = String(displayFormat || '').toUpperCase();
  if (df === 'VIDEO') return 'video';
  if (df === 'IMAGE') return 'static';
  if (df === 'CAROUSEL' || df === 'DPA') return 'carrusel';
  if (df === 'DCO') return 'mixto';
  // Fallback heurístico para ads sin display_format. Ya no asume video
  // cuando hay imagen Y video — eso marca mixto.
  const v = videoUrls.length;
  const i = imageUrls.length;
  if (v > 0 && i > 0) return 'mixto';
  if (v > 0) return 'video';
  if (i > 1) return 'carrusel';
  if (i === 1) return 'static';
  return 'mixto';
}

// Normaliza un ad crudo de cualquier actor a nuestro shape interno.
// Soporta output del actor oficial (apify/facebook-ads-scraper) y varios
// comunitarios que siguen estructura parecida.
export function normalizeAd(raw) {
  const snap = raw.snapshot || {};
  const id = String(
    raw.id || raw.adArchiveID || raw.ad_archive_id || snap.id || snap.adArchiveID || ''
  );

  // Body text — puede estar en varios lados
  const body = (
    snap.body?.text ||
    snap.bodyText ||
    raw.bodyText ||
    raw.body ||
    (Array.isArray(raw.ad_creative_bodies) ? raw.ad_creative_bodies[0] : '') ||
    ''
  );

  const startDate = parseStartDate(raw);
  const daysRunning = startDate
    ? Math.max(0, Math.round((Date.now() - new Date(startDate).getTime()) / 86400000))
    : 0;

  // Platforms normalizadas a uppercase.
  const platformsRaw = raw.publisherPlatform || raw.publisher_platforms ||
                       snap.publisherPlatform || snap.publisher_platforms || [];
  const platforms = platformsRaw.map(p => String(p).toUpperCase());

  // Image + video URLs — pueden estar en múltiples lugares.
  const imageUrls = [
    ...(snap.images || []).map(i => i.originalImageUrl || i.resizedImageUrl || i.url).filter(Boolean),
    ...(snap.cards || []).map(c => c.originalImageUrl || c.resizedImageUrl).filter(Boolean),
  ];
  const videoUrls = [
    ...(snap.videos || []).map(v => v.videoHdUrl || v.videoSdUrl).filter(Boolean),
    ...(snap.cards || []).map(c => c.videoHdUrl || c.videoSdUrl).filter(Boolean),
  ];

  // Formato declarado por Meta — la fuente confiable. `formato` ya clasificado
  // así todos los consumidores (réplicas, mix de competencia, generador)
  // usan el mismo valor sin re-inferir.
  const displayFormat = String(
    snap.display_format || snap.displayFormat || raw.display_format || ''
  ).toUpperCase();
  const imageUrlsU = [...new Set(imageUrls)];
  const videoUrlsU = [...new Set(videoUrls)];
  const formato = clasificarFormato(displayFormat, imageUrlsU, videoUrlsU);

  const headline = snap.title || snap.linkTitle ||
                   (snap.cards?.[0]?.title) ||
                   (Array.isArray(raw.ad_creative_link_titles) ? raw.ad_creative_link_titles[0] : '') ||
                   '';
  const cta = snap.ctaText || snap.ctaType || (snap.cards?.[0]?.ctaText) || '';
  const ctaLink = snap.linkUrl || (snap.cards?.[0]?.linkUrl) || '';

  return {
    id,
    pageName: String(raw.pageName || snap.pageName || ''),
    pageId: String(raw.pageId || raw.pageID || snap.pageId || ''),
    body,
    headline,
    cta,
    ctaLink,
    startDate,
    daysRunning,
    platforms,
    isMultiplatform: platforms.length > 1,
    imageUrls: imageUrlsU,
    videoUrls: videoUrlsU,
    displayFormat,
    formato,
    snapshotUrl: id ? `https://www.facebook.com/ads/library/?id=${id}` : null,
    pageLikeCount: Number(raw.pageLikeCount || snap.pageLikeCount || 0),
    // raw queda guardado por si después queremos extraer otros campos sin rescrapear.
    // No lo serializamos al front (lo strip en el endpoint) para no inflar response.
    _raw: raw,
  };
}

// Heurística simple para detectar si dos ads son variantes del mismo ángulo.
// Se basa en overlap de palabras del body (ignorando stopwords).
function similarBodies(a, b) {
  if (!a || !b) return false;
  const tokens = (s) => String(s).toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);
  const setA = new Set(tokens(a).slice(0, 40));
  const listB = tokens(b).slice(0, 40);
  if (listB.length === 0) return false;
  const overlap = listB.filter(w => setA.has(w)).length;
  return overlap / listB.length >= 0.5;
}

// Score compuesto del ad. Mayor = más "ganador confirmado".
// Señales:
//  - daysRunning (base) — cuántos días corriendo
//  - multiplatform (+20) — Meta lo distribuye en FB+IG+Audience Network
//  - variantes escalado:
//      4+ variantes (+60) — señal FORTÍSIMA, están escalando activamente
//      2-3 variantes (+30) — están iterando, ganador probable
//      1 variante (+10) — chispa inicial
//  - pageLikeCount (log, *2) — marca establecida
//  - penalty si pausado temprano (<5d) — posible loser
//  - bonus de recencia: ads nuevos (<7d) con 2+ variantes ya tienen bonus
//    porque la marca está apostando fuerte aunque aún no tengan 17d
//
// Threshold de "isWinner":
//   daysRunning >= 17  OR  variantes >= 2
// (El criterio del user, se mantiene — el score afina la relevancia.)
const WINNER_DAYS_THRESHOLD = 17;
const WINNER_VARIANTS_THRESHOLD = 2;

export function scoreAd(ad, allAdsOfSamePage = []) {
  // Cap a daysRunning: sin tope, un evergreen de branding con 200 días
  // arrasaba el ranking y se llevaba todos los slots de deep-analyze,
  // dejando afuera ganadores recientes con varias variantes (señal de
  // performance más fuerte). Pasados ~60 días, más tiempo no agrega
  // señal — el ad ya probó que funciona.
  let score = Math.min(ad.daysRunning || 0, 60);
  if (ad.isMultiplatform) score += 20;

  const variantes = allAdsOfSamePage.filter(a =>
    a.id !== ad.id && similarBodies(a.body, ad.body)
  ).length;
  // Escalado de variantes — refleja que 4+ es señal mucho más fuerte
  // que 2-3. En realidad pocos competidores llegan a 4+ variantes si no
  // están seguros del ganador.
  if (variantes >= 4) score += 60;
  else if (variantes >= 2) score += 30;
  else if (variantes >= 1) score += 10;

  score += Math.log10((ad.pageLikeCount || 0) + 1) * 2;

  // Penalty si parece loser: pausado muy rápido.
  if (ad.daysRunning > 0 && ad.daysRunning < 5) score *= 0.5;

  const isWinner = (ad.daysRunning || 0) >= WINNER_DAYS_THRESHOLD ||
                   variantes >= WINNER_VARIANTS_THRESHOLD;

  // Tier del ganador — para que el front pueda priorizar visualmente.
  // "strong" = cumple ambos criterios o tiene 4+ variantes.
  // "confirmed" = cumple al menos uno.
  // null = no es ganador.
  let winnerTier = null;
  if (isWinner) {
    const bothCriteria = (ad.daysRunning || 0) >= WINNER_DAYS_THRESHOLD && variantes >= WINNER_VARIANTS_THRESHOLD;
    const heavyIteration = variantes >= 4;
    winnerTier = (bothCriteria || heavyIteration) ? 'strong' : 'confirmed';
  }

  return {
    score: Math.round(score * 10) / 10,
    variantes,
    isWinner,
    winnerTier,
  };
}

export const WINNER_CRITERIA = {
  days: WINNER_DAYS_THRESHOLD,
  variants: WINNER_VARIANTS_THRESHOLD,
};

// Genera el startUrl de Meta Ad Library para un search por keyword.
// Replica el formato del bookmarklet del user.
// Default country ALL — cubre anuncios targeteados a cualquier mercado.
// Limitar a AR dejaba afuera la mayoría de marcas DTC internacionales que
// pautan a otros países. is_targeted_country=false para no restringir
// a anuncios targeteados al país del que mira.
export function buildAdLibraryUrl({ keyword, country = 'ALL' }) {
  const q = encodeURIComponent(keyword);
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&is_targeted_country=false&q=${q}&search_type=keyword_unordered&media_type=all`;
}
