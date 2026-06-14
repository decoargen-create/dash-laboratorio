// Helper para scraping de TikTok Creative Center (la "ad library" pública
// de TikTok). Apify tiene varios actors — usamos clockworks/tiktok-scraper
// por defecto (configurable via APIFY_TIKTOK_ACTOR_ID env var).
//
// El shape del output varía entre actors, normalizeTiktokAd() abstrae eso
// con el mismo contrato que normalizeAd() de _apify.js para que el resto
// del codebase (galería, lupa, boards) pueda trabajar con ambos.

// Convierte un raw item del actor de TikTok a la shape común de marketing_ads.
// Garantiza los mismos campos que normalizeAd() de _apify.js para que el
// scoreAd() compartido funcione sin cambios.
export function normalizeTiktokAd(raw) {
  // Distintos actors usan distintos nombres. Intentamos varios.
  const id = String(
    raw.id || raw.itemId || raw.ad_id || raw.adId || raw.aweme_id || raw.creative_id || ''
  );

  const body = String(
    raw.desc || raw.text || raw.caption || raw.title || raw.ad_text || ''
  );

  const startDate = raw.createTime || raw.create_time || raw.startDate || raw.start_date || null;
  const startMs = startDate ? (typeof startDate === 'number' ? startDate * 1000 : Date.parse(startDate)) : 0;
  const daysRunning = startMs
    ? Math.max(0, Math.round((Date.now() - startMs) / 86400000))
    : 0;

  // TikTok solo tiene 1 plataforma → seteamos hardcoded para el score.
  const platforms = ['TIKTOK'];

  // Video URLs — TikTok ads son siempre video.
  const videoUrls = [
    raw.video?.playAddr,
    raw.video?.downloadAddr,
    raw.videoUrl,
    raw.video_url,
  ].filter(Boolean).map(String);

  // Thumbnail / cover img.
  const imageUrls = [
    raw.video?.cover,
    raw.video?.originCover,
    raw.cover,
    raw.coverUrl,
    raw.thumbnail,
  ].filter(Boolean).map(String);

  const headline = String(raw.title || raw.product_name || '');
  const cta = String(raw.cta || raw.cta_text || '');
  const ctaLink = String(raw.landingUrl || raw.landing_url || raw.url || '');

  const pageName = String(
    raw.author?.uniqueId || raw.author?.nickname ||
    raw.advertiser_name || raw.advertiserName || raw.brand || ''
  );
  const pageId = String(raw.author?.id || raw.advertiser_id || raw.advertiserId || '');

  return {
    id,
    pageName,
    pageId,
    body,
    headline,
    cta,
    ctaLink,
    startDate: startMs ? new Date(startMs).toISOString() : null,
    daysRunning,
    platforms,
    isMultiplatform: false, // TikTok = 1 plataforma
    imageUrls: [...new Set(imageUrls)],
    videoUrls: [...new Set(videoUrls)],
    displayFormat: 'VIDEO',
    formato: 'video',
    snapshotUrl: id ? `https://ads.tiktok.com/business/creativecenter/inspiration/popular/pc/en/detail?material_id=${id}` : null,
    // TikTok no expone like count en la ads library, dejamos en 0.
    pageLikeCount: Number(raw.author?.followerCount || raw.diggCount || 0),
    _raw: raw,
    _platform: 'tiktok',
  };
}

// Construye el input que espera el actor de TikTok. Por defecto soporta
// keyword search; opcionalmente author / hashtag. limit aplicado tanto en
// el input como en el query param (PPR-safe).
export function buildTiktokInput({ keywords, hashtag, author, country = 'AR', maxItems = 200 }) {
  const input = {
    maxItems,
    resultsLimit: maxItems,
    maxResults: maxItems,
    country,
  };
  if (keywords) input.searchQueries = Array.isArray(keywords) ? keywords : [keywords];
  if (hashtag) input.hashtags = Array.isArray(hashtag) ? hashtag : [hashtag];
  if (author) input.profiles = Array.isArray(author) ? author : [author];
  return input;
}
