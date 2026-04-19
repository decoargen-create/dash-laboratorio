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
export async function runActorSync(actorId, input, token, opts = {}) {
  const { timeout = 240 } = opts;
  // Apify acepta actor IDs en 2 formatos: "username/actorName" o "actorId".
  // Si viene con "/", lo encodeamos para el URL path.
  const actorPath = actorId.replace('/', '~');
  const url = `${APIFY_API_BASE}/acts/${actorPath}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeout}`;

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
    imageUrls: [...new Set(imageUrls)],
    videoUrls: [...new Set(videoUrls)],
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
//  - daysRunning (base)
//  - multiplatform (Meta confía en distribuirlo)
//  - variantes (están iterando = están escalando)
//  - pageLikeCount (marca con tracción)
//  - penalty si pausado temprano
export function scoreAd(ad, allAdsOfSamePage = []) {
  let score = ad.daysRunning || 0;
  if (ad.isMultiplatform) score += 20;

  const variantes = allAdsOfSamePage.filter(a =>
    a.id !== ad.id && similarBodies(a.body, ad.body)
  ).length;
  if (variantes >= 2) score += 30;
  else if (variantes >= 1) score += 10;

  score += Math.log10((ad.pageLikeCount || 0) + 1) * 2;

  // Penalty si parece loser: pausado muy rápido.
  if (ad.daysRunning > 0 && ad.daysRunning < 5) score *= 0.5;

  return Math.round(score * 10) / 10;
}

// Genera el startUrl de Meta Ad Library para un search por keyword.
// Replica el formato del bookmarklet del user.
export function buildAdLibraryUrl({ keyword, country = 'AR' }) {
  const q = encodeURIComponent(keyword);
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${q}&search_type=keyword_unordered&media_type=all`;
}
