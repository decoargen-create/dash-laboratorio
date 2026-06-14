// Helper para upsert ads scrapeados a la tabla marketing_ads (search index).
//
// Lo usan:
//   - apify-ingest.js (post-scrape user-triggered)
//   - cron-competidor-refresh.js (post-scrape automático nocturno)
//
// Side effects: nada — la falla se loguea pero no propaga (el caller ya
// guardó los ads en su bucket JSON; el index es para search rápido y se
// puede rebuildear). Best-effort.

import { createClient } from '@supabase/supabase-js';

function getServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Convierte un ad normalizado a row de marketing_ads.
function adToRow(ad, userId, productoId, competidorId) {
  return {
    user_id: userId,
    producto_id: String(productoId),
    competidor_id: String(competidorId),
    ad_id: String(ad.id),
    page_name: ad.pageName || null,
    page_id: ad.pageId || null,
    headline: ad.headline || null,
    body: ad.body ? String(ad.body).slice(0, 4000) : null, // cap por defensiva
    ocr_text: ad.ocrText || null,
    transcript: ad.transcript || null,
    formato: ad.formato || null,
    days_running: ad.daysRunning != null ? Number(ad.daysRunning) : null,
    is_winner: !!ad.isWinner,
    winner_tier: ad.winnerTier || null,
    score: ad.score != null ? Number(ad.score) : null,
    variantes: ad.variantes != null ? Number(ad.variantes) : null,
    platforms: Array.isArray(ad.platforms) ? ad.platforms : [],
    is_multiplatform: !!ad.isMultiplatform,
    image_url: ad.imageUrls?.[0] || null,
    video_url: ad.videoUrls?.[0] || null,
    snapshot_url: ad.snapshotUrl || null,
    start_date: ad.startDate || null,
    scraped_at: new Date().toISOString(),
  };
}

// Upsert un batch de ads. Best-effort. Si falla, loguea y sigue.
export async function upsertAdsToIndex({ userId, productoId, competidorId, ads }) {
  if (!userId || !productoId || !competidorId) return { ok: false, reason: 'missing keys' };
  if (!Array.isArray(ads) || ads.length === 0) return { ok: true, upserted: 0 };
  const supabase = getServerClient();
  if (!supabase) return { ok: false, reason: 'no supabase client' };

  // Batchear en chunks de 500 para no exceder el body limit del upsert.
  const CHUNK = 500;
  let upserted = 0;
  let errors = 0;
  for (let i = 0; i < ads.length; i += CHUNK) {
    const slice = ads.slice(i, i + CHUNK);
    const rows = slice.map(ad => adToRow(ad, userId, productoId, competidorId));
    const { error } = await supabase
      .from('marketing_ads')
      .upsert(rows, { onConflict: 'user_id,producto_id,competidor_id,ad_id' });
    if (error) {
      errors++;
      console.warn(`[ads-index] upsert chunk falló:`, error.message);
      continue;
    }
    upserted += rows.length;
  }
  return { ok: errors === 0, upserted, errors };
}

// Borra todos los ads de un (producto, competidor) — usado cuando el user
// borra un competidor o el cron lo limpia.
export async function removeAdsFromIndex({ userId, productoId, competidorId }) {
  if (!userId || !productoId || !competidorId) return { ok: false };
  const supabase = getServerClient();
  if (!supabase) return { ok: false };
  const { error } = await supabase
    .from('marketing_ads')
    .delete()
    .eq('user_id', userId)
    .eq('producto_id', String(productoId))
    .eq('competidor_id', String(competidorId));
  if (error) {
    console.warn('[ads-index] delete falló:', error.message);
    return { ok: false };
  }
  return { ok: true };
}
