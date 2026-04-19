// Endpoint para consultar la Meta Ad Library por página de competidor.
//
// POST /api/meta/ad-library
// Body: { pageId, country?: 'AR', searchTerms?: string }
//
// Requiere la cookie de sesión Meta (access_token via OAuth).
// Devuelve lista de ads activos ordenados por días corriendo (desc).

import { readMetaCookie, graphGet, respondJSON, META_API_VERSION } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const session = readMetaCookie(req);
  if (!session?.accessToken) {
    return respondJSON(res, 401, { error: 'No hay sesión de Meta activa. Conectá tu cuenta primero.' });
  }

  let body;
  try {
    if (req.body && typeof req.body === 'object') body = req.body;
    else if (typeof req.body === 'string') body = JSON.parse(req.body);
    else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    }
  } catch { body = {}; }

  const { pageId, country = 'AR', searchTerms } = body;

  if (!pageId && !searchTerms) {
    return respondJSON(res, 400, { error: 'Enviá pageId (ID de la página de FB) o searchTerms (palabras clave)' });
  }

  const fields = [
    'id',
    'ad_creative_bodies',
    'ad_creative_link_titles',
    'ad_creative_link_captions',
    'ad_snapshot_url',
    'page_name',
    'page_id',
    'ad_delivery_start_time',
    'ad_delivery_stop_time',
    'publisher_platforms',
  ].join(',');

  const params = {
    ad_type: 'ALL',
    ad_active_status: 'ACTIVE',
    ad_reached_countries: JSON.stringify([country.toUpperCase()]),
    fields,
    limit: '50',
  };

  if (pageId) params.search_page_ids = JSON.stringify([String(pageId)]);
  if (searchTerms) params.search_terms = searchTerms;

  try {
    const data = await graphGet('ads_archive', session.accessToken, params);
    const now = Date.now();
    const ads = (data.data || []).map(ad => {
      const startDate = ad.ad_delivery_start_time || null;
      const startMs = startDate ? new Date(startDate).getTime() : null;
      const daysRunning = startMs ? Math.round((now - startMs) / (1000 * 60 * 60 * 24)) : null;
      return {
        id: ad.id,
        pageName: ad.page_name || null,
        pageId: ad.page_id || null,
        bodies: ad.ad_creative_bodies || [],
        titles: ad.ad_creative_link_titles || [],
        captions: ad.ad_creative_link_captions || [],
        snapshotUrl: ad.ad_snapshot_url || null,
        startDate,
        daysRunning,
        platforms: ad.publisher_platforms || [],
        isMultiplatform: (ad.publisher_platforms || []).length > 1,
      };
    });

    ads.sort((a, b) => (b.daysRunning || 0) - (a.daysRunning || 0));

    return respondJSON(res, 200, {
      total: ads.length,
      country,
      ads,
      paging: data.paging || null,
    });
  } catch (err) {
    console.error('ad-library error:', err);
    const status = err.status || 500;
    return respondJSON(res, status, {
      error: err.message || 'Error consultando Ad Library',
      hint: status === 190 || status === 401
        ? 'El token de Meta expiró. Reconectá tu cuenta desde Conexión Meta.'
        : undefined,
    });
  }
}
