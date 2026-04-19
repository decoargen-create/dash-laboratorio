// Sugerencia automática de competidores vía Meta Ad Library.
//
// POST /api/marketing/suggest-competitors
// Body: { searchKeyword: string, country?: 'AR', limit?: 30 }
//
// Estrategia: busca ads por keyword en Ad Library (via Apify actor),
// agrupa por pageId y devuelve las páginas con más ads activos
// (señal de que son competidores serios invirtiendo en paid).
//
// Response: {
//   suggestions: [
//     {
//       pageId, pageName, adsCount,
//       sampleBody, sampleHeadline, sampleImage, sampleSnapshotUrl,
//       totalDaysRunning  // max days running de los ads de esa page
//     }, ...
//   ]
// }

import { runActorSync, normalizeAd, buildAdLibraryUrl } from './_apify.js';

const DEFAULT_ACTOR = 'apify/facebook-ads-scraper';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const token = process.env.APIFY_TOKEN;
  if (!token) return respondJSON(res, 500, { error: 'APIFY_TOKEN no configurada' });

  const body = await readBody(req);
  const { searchKeyword, country = 'AR', limit = 30 } = body || {};
  if (!searchKeyword || !String(searchKeyword).trim()) {
    return respondJSON(res, 400, { error: 'Falta searchKeyword' });
  }

  const startUrl = buildAdLibraryUrl({ keyword: searchKeyword, country });
  const actorId = process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR;
  const input = {
    startUrls: [{ url: startUrl }],
    resultsLimit: Math.min(Math.max(limit, 10), 60),
    activeStatus: 'active',
    isDetailsPerAd: true,
    includeAboutPage: false,
    onlyTotal: false,
  };

  try {
    const items = await runActorSync(actorId, input, token, { timeout: 150 });
    if (!Array.isArray(items)) {
      return respondJSON(res, 502, { error: 'Apify devolvió formato inesperado' });
    }

    // Normalizar y agrupar por pageId.
    const normalized = items.map(normalizeAd);
    const byPage = new Map();
    for (const ad of normalized) {
      if (!ad.pageId) continue;
      if (!byPage.has(ad.pageId)) {
        byPage.set(ad.pageId, { pageId: ad.pageId, pageName: ad.pageName, ads: [] });
      }
      byPage.get(ad.pageId).ads.push(ad);
    }

    // Armar sugerencias con sample del ad más largo corriendo (proxy de ganador).
    const suggestions = Array.from(byPage.values())
      .map(p => {
        const sorted = p.ads.slice().sort((a, b) => (b.daysRunning || 0) - (a.daysRunning || 0));
        const sample = sorted[0];
        return {
          pageId: p.pageId,
          pageName: p.pageName || `Page ${p.pageId}`,
          adsCount: p.ads.length,
          maxDaysRunning: sample?.daysRunning || 0,
          sampleHeadline: sample?.headline || '',
          sampleBody: (sample?.body || '').slice(0, 200),
          sampleImage: sample?.imageUrls?.[0] || null,
          sampleSnapshotUrl: sample?.snapshotUrl || null,
        };
      })
      .filter(p => p.adsCount >= 1)
      .sort((a, b) => b.adsCount - a.adsCount || b.maxDaysRunning - a.maxDaysRunning)
      .slice(0, 12);

    // Costo Apify: ~$0.0058 × ads devueltos por el actor.
    const apifyCost = (items?.length || 0) * 0.0058;

    return respondJSON(res, 200, {
      searchKeyword,
      country,
      total: suggestions.length,
      suggestions,
      generatedAt: new Date().toISOString(),
      cost: { apify: Math.round(apifyCost * 10000) / 10000 },
    });
  } catch (err) {
    console.error('suggest-competitors error:', err);
    return respondJSON(res, 502, { error: err.message || 'Error buscando competidores' });
  }
}
