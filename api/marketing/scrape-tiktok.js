// Scrape de ads de TikTok via Apify. Análogo a apify-ingest.js pero para
// TikTok Creative Center / TikTok Ads Library.
//
// POST /api/marketing/scrape-tiktok
// Body: {
//   keywords?: string | string[],    // términos a buscar
//   hashtag?: string | string[],     // alternativa: hashtags
//   author?: string,                 // alternativa: perfil de marca
//   country?: string,                // default 'AR'
//   limit?: number,                  // default 100
//   productoId?: string,             // opcional — para upsertear al index
//   competidorId?: string,           // opcional — para upsertear al index
// }
// Response: { total, ads: [...] }
//
// Requiere env vars:
//   APIFY_TOKEN              — obligatoria
//   APIFY_TIKTOK_ACTOR_ID    — opcional (default: clockworks/tiktok-scraper)
//                              Otros válidos: gentle-cloud/tiktok-ads-library,
//                              apify/tiktok-scraper

import { runActorAsync, scoreAd } from './_apify.js';
import { normalizeTiktokAd, buildTiktokInput } from './_tiktok.js';
import { upsertAdsToIndex } from './_ads-index.js';
import { getUserIdFromAuth } from './_supabase-server.js';

const DEFAULT_ACTOR = 'clockworks/tiktok-scraper';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export const maxDuration = 300;

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return respondJSON(res, 500, {
      error: 'APIFY_TOKEN no configurada',
      hint: 'Agregala en Vercel → Settings → Environment Variables.',
    });
  }

  const body = await readBody(req);
  const {
    keywords, hashtag, author,
    country = 'AR',
    limit: rawLimit = 100,
    productoId, competidorId,
  } = body || {};

  if (!keywords && !hashtag && !author) {
    return respondJSON(res, 400, {
      error: 'Enviá keywords, hashtag o author para buscar en TikTok.',
    });
  }

  // Cap defensivo — TikTok actors cobran por result.
  const limit = Math.max(1, Math.min(500, Number(rawLimit) || 100));

  const actorId = process.env.APIFY_TIKTOK_ACTOR_ID || DEFAULT_ACTOR;
  const input = buildTiktokInput({ keywords, hashtag, author, country, maxItems: limit });

  let result;
  try {
    result = await runActorAsync(actorId, input, token, { maxWaitSec: 240, pollIntervalSec: 8 });
  } catch (err) {
    return respondJSON(res, 502, { error: `Apify TikTok actor falló: ${err.message}` });
  }

  const items = Array.isArray(result?.items) ? result.items : [];
  if (items.length === 0) {
    return respondJSON(res, 200, { total: 0, ads: [] });
  }

  const normalized = items.map(normalizeTiktokAd).filter(a => a.id);
  // Reusamos scoreAd genérico del FB normalizer — la mayoría de las señales
  // (daysRunning, variantes — acá siempre 1 — pageLikeCount) aplican igual.
  const byPage = new Map();
  for (const ad of normalized) {
    if (!byPage.has(ad.pageId)) byPage.set(ad.pageId, []);
    byPage.get(ad.pageId).push(ad);
  }
  const scored = normalized.map(ad => {
    const sameGroup = byPage.get(ad.pageId) || [];
    const { _raw, ...clean } = ad;
    const scoring = scoreAd(ad, sameGroup);
    return { ...clean, ...scoring, platform: 'tiktok' };
  });

  // Upsert al index server-side si caller mandó productoId+competidorId
  // (best-effort: no rompemos si falla).
  const userId = await getUserIdFromAuth(req);
  if (userId && productoId && competidorId) {
    try {
      await upsertAdsToIndex({
        userId,
        productoId: String(productoId),
        competidorId: String(competidorId),
        ads: scored,
        platform: 'tiktok',
      });
    } catch (err) {
      console.warn('[scrape-tiktok] upsertAdsToIndex falló:', err.message);
    }
  }

  return respondJSON(res, 200, {
    total: scored.length,
    winners: scored.filter(a => a.isWinner).length,
    ads: scored,
  });
}
