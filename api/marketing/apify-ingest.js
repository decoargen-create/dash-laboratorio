// Endpoint para traer ads de competidores vía Apify Actor de Meta Ad Library.
//
// POST /api/marketing/apify-ingest
// Body: {
//   fbPageUrl?: string,       // URL de Facebook page del competidor (preferido)
//   searchKeyword?: string,   // alternativa: búsqueda por keyword
//   country?: string,         // default 'AR'
//   limit?: number,           // default 50
// }
// Response: { total, winners, ads: [...] } ordenados por score desc.
//
// Requiere env vars:
//   APIFY_TOKEN           — obligatoria
//   APIFY_ACTOR_ID        — opcional (default: apify/facebook-ads-scraper)

import { runActorSync, normalizeAd, scoreAd, buildAdLibraryUrl } from './_apify.js';

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
  if (!token) {
    return respondJSON(res, 500, {
      error: 'APIFY_TOKEN no configurada en el servidor',
      hint: 'Agregala en Vercel → Settings → Environment Variables y redeployá.',
    });
  }

  const body = await readBody(req);
  const { fbPageUrl, searchKeyword, country = 'AR', limit = 50 } = body || {};

  if (!fbPageUrl && !searchKeyword) {
    return respondJSON(res, 400, {
      error: 'Enviá fbPageUrl (URL de Facebook page) o searchKeyword (texto a buscar)',
    });
  }

  // Armar el startUrl según el input
  let startUrl;
  if (fbPageUrl) {
    startUrl = fbPageUrl.startsWith('http')
      ? fbPageUrl
      : `https://www.facebook.com/${fbPageUrl.replace(/^\/+/, '')}`;
  } else {
    startUrl = buildAdLibraryUrl({ keyword: searchKeyword, country });
  }

  const actorId = process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR;
  const input = {
    startUrls: [{ url: startUrl }],
    resultsLimit: Math.min(Math.max(limit, 5), 200),
    activeStatus: 'active',
    isDetailsPerAd: true,
    includeAboutPage: false,
    onlyTotal: false,
  };

  try {
    const items = await runActorSync(actorId, input, token, { timeout: 240 });
    if (!Array.isArray(items)) {
      return respondJSON(res, 502, {
        error: 'Apify devolvió un formato inesperado',
        raw: items,
      });
    }

    // Normalizar + agrupar por pageId para calcular variantes por competidor
    const normalized = items.map(normalizeAd);
    const byPage = new Map();
    for (const ad of normalized) {
      if (!byPage.has(ad.pageId)) byPage.set(ad.pageId, []);
      byPage.get(ad.pageId).push(ad);
    }

    // Calcular score — stripeamos _raw antes de mandar al front (es pesado)
    const scored = normalized.map(ad => {
      const sameGroup = byPage.get(ad.pageId) || [];
      const { _raw, ...clean } = ad;
      return { ...clean, score: scoreAd(ad, sameGroup) };
    });
    scored.sort((a, b) => b.score - a.score);

    // Ganador confirmado: score ≥ 35 (≈ 30 días corriendo o 7+ días multiplatform con variantes)
    const winnersCount = scored.filter(a => a.score >= 35).length;

    return respondJSON(res, 200, {
      total: scored.length,
      winners: winnersCount,
      generatedAt: new Date().toISOString(),
      source: { actor: actorId, input: { fbPageUrl, searchKeyword, country, limit } },
      ads: scored,
    });
  } catch (err) {
    console.error('apify-ingest error:', err);
    return respondJSON(res, 502, {
      error: err.message || 'Error corriendo el actor de Apify',
    });
  }
}
