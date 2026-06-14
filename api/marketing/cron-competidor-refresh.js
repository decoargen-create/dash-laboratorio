// Cron diario que re-scrapea los competidores activos de cada usuario.
//
// Trigger: vercel.json /api/marketing/cron-competidor-refresh con schedule
// "0 6 * * *" (6 AM UTC = 3 AM Buenos Aires, hora de bajo tráfico).
//
// Qué hace:
// 1. Itera todos los productos de todos los users (via marketing_productos).
// 2. Para cada producto, identifica los competidores con `autoRefresh: true`.
// 3. Para esos, dispara apify-ingest con limit conservador (500) por
//    competidor.
// 4. Sube los ads scrapeados al bucket en el path estándar
//    (<uid>/competitor-ads/<productoId>-<competidorId>.json).
// 5. Patch el producto con lastAdsCheck nuevo → sync llega a las PCs del
//    user via Realtime de Supabase.
//
// Costos: limit 500 × N competidores opted-in × ~$0.003 = ~$1.50 cada 100
// competidores refresheados. Hay cap diario global ($DAILY_COST_CAP) para
// evitar runaway.
//
// Seguridad: este endpoint solo se puede invocar con el CRON_SECRET o
// como Vercel cron (que viene firmado). Si lo invocás manual sin secret,
// devuelve 401.

import { createClient } from '@supabase/supabase-js';
import { runActorAsync, normalizeAd, scoreAd } from './_apify.js';
import { upsertAdsToIndex } from './_ads-index.js';

const DAILY_COST_CAP_USD = 25; // cap de gasto diario hard-coded
const PER_COMP_LIMIT = 500;     // ads por competidor en cada refresh
const COMP_CONCURRENCY = 3;     // scrapes simultáneos por producto (Apify token tier limit)

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function getServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const maxDuration = 300;

export default async function handler(req, res) {
  // Verificar que sea legit (Vercel cron header o CRON_SECRET).
  const isVercelCron = req.headers['x-vercel-cron'] === '1' ||
                       req.headers['user-agent']?.includes('vercel-cron');
  const passedSecret = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !passedSecret) {
    return respondJSON(res, 401, { error: 'No autorizado — cron-only endpoint' });
  }

  const supabase = getServerClient();
  if (!supabase) {
    return respondJSON(res, 500, { error: 'Supabase no configurado en server' });
  }

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    return respondJSON(res, 500, { error: 'APIFY_TOKEN no configurada' });
  }
  const actorId = process.env.APIFY_ACTOR_ID || 'apify/facebook-ads-scraper';

  // 1. Traer TODOS los productos con scope de service role.
  const { data: productos, error: productosErr } = await supabase
    .from('marketing_productos')
    .select('id, user_id, data, updated_at');
  if (productosErr) {
    return respondJSON(res, 500, { error: `pull productos: ${productosErr.message}` });
  }

  let totalRefreshed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let estimatedCostUSD = 0;
  const errors = [];

  for (const row of productos || []) {
    if (estimatedCostUSD >= DAILY_COST_CAP_USD) {
      // Hit del cap — salimos del loop sin tirar error.
      break;
    }
    const data = row.data || {};
    // MASTER SWITCH per-producto: si autoRefreshEnabled !== true, SKIP el
    // producto entero. El user puede tener competidores con autoRefresh:true
    // marcados pero NO querer scrape automático para ESTE producto en
    // particular. El cron respeta el master switch del producto antes que
    // los toggles individuales.
    if (data.autoRefreshEnabled !== true) {
      continue;
    }
    const competidores = data.competidores || [];
    // Solo refreshamos los competidores que el user opted-in.
    const optedIn = competidores.filter(c => c.autoRefresh === true);
    if (optedIn.length === 0) continue;

    // Scrape de un competidor — extraído a closure para Promise.all.
    // Devuelve { compId, patch?, costAdded, status }. NO toca la DB del producto:
    // los patches se mergean al final del producto en un único write,
    // evitando race condition entre scrapes paralelos del mismo producto.
    const scrapeOne = async (comp) => {
      // Skip si último scrape fue < 20h atrás — no quemamos gasto.
      const lastCheck = comp.lastAdsCheck ? Date.parse(comp.lastAdsCheck) : 0;
      if (lastCheck && (Date.now() - lastCheck) < 20 * 60 * 60 * 1000) {
        return { compId: comp.id, status: 'skipped', reason: 'fresh', costAdded: 0 };
      }

      // Armar el startUrl: priorizar adLibraryUrl > fbPageUrl.
      const directUrl = comp.adLibraryUrl || comp.fbPageUrl;
      let startUrl;
      if (directUrl) {
        startUrl = directUrl.startsWith('http') ? directUrl : `https://www.facebook.com/${directUrl}`;
      } else if (comp.landingUrl) {
        const host = (comp.landingUrl || '').replace(/^https?:\/\//, '').split('/')[0];
        startUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&is_targeted_country=false&q=${encodeURIComponent(host)}&search_type=keyword_unordered&media_type=all&sort_data[mode]=total_impressions&sort_data[direction]=desc`;
      } else {
        return { compId: comp.id, status: 'skipped', reason: 'no-url', costAdded: 0 };
      }

      const input = {
        startUrls: [{ url: startUrl }],
        maxItems: PER_COMP_LIMIT,
        resultsLimit: PER_COMP_LIMIT,
        maxResults: PER_COMP_LIMIT,
        activeStatus: 'active',
        isDetailsPerAd: true,
        includeAboutPage: false,
      };

      const result = await runActorAsync(actorId, input, apifyToken, { maxWaitSec: 240, pollIntervalSec: 8 });
      const items = result.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        return { compId: comp.id, status: 'skipped', reason: 'no-items', costAdded: 0 };
      }
      const normalized = items.map(normalizeAd);
      const byPage = new Map();
      for (const ad of normalized) {
        if (!byPage.has(ad.pageId)) byPage.set(ad.pageId, []);
        byPage.get(ad.pageId).push(ad);
      }
      const scored = normalized.map(ad => {
        const sameGroup = byPage.get(ad.pageId) || [];
        const { _raw, ...clean } = ad;
        const scoring = scoreAd(ad, sameGroup);
        return { ...clean, ...scoring };
      });
      const winners = scored.filter(a => a.isWinner).length;
      const costAdded = items.length * 0.0058;

      // Subir el JSON al bucket.
      const path = `${row.user_id}/competitor-ads/${String(row.id)}-${String(comp.id)}.json`;
      const payload = {
        ads: scored,
        total: scored.length,
        winners,
        lastAdsCheck: new Date().toISOString(),
        ts: Date.now(),
        source: 'cron-refresh',
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      await supabase.storage.from('creativos').upload(path, blob, {
        contentType: 'application/json', upsert: true,
      });

      // Upsert al index server-side (best-effort).
      try {
        await upsertAdsToIndex({
          userId: row.user_id, productoId: row.id, competidorId: comp.id, ads: scored,
        });
      } catch (idxErr) {
        console.warn('[cron] upsertAdsToIndex falló:', idxErr.message);
      }

      return {
        compId: comp.id,
        status: 'ok',
        costAdded,
        patch: {
          adsTotal: scored.length,
          winnersCount: winners,
          lastAdsCheck: new Date().toISOString(),
          lastAutoRefreshAt: new Date().toISOString(),
        },
      };
    };

    // Paralelizar con concurrencia. Antes era sequential: 4 comps × 120s = 480s
    // que superaba maxDuration:300. Con concurrency 3, mismo total ~120-240s.
    // Si el cap diario se hit en un batch previo, salimos antes del siguiente.
    const patchesByCompId = new Map();
    for (let i = 0; i < optedIn.length; i += COMP_CONCURRENCY) {
      if (estimatedCostUSD >= DAILY_COST_CAP_USD) break;
      const batch = optedIn.slice(i, i + COMP_CONCURRENCY);
      const results = await Promise.allSettled(batch.map(scrapeOne));
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const comp = batch[j];
        if (r.status === 'rejected') {
          totalErrors++;
          errors.push({ productoId: row.id, competidorId: comp.id, error: r.reason?.message?.slice(0, 200) || 'unknown' });
          continue;
        }
        const v = r.value;
        estimatedCostUSD += v.costAdded || 0;
        if (v.status === 'ok') {
          totalRefreshed++;
          if (v.patch) patchesByCompId.set(v.compId, v.patch);
        } else {
          totalSkipped++;
        }
      }
    }

    // Único write por producto: aplicar todos los patches a la vez.
    if (patchesByCompId.size > 0) {
      const updatedCompetidores = competidores.map(c =>
        patchesByCompId.has(c.id) ? { ...c, ...patchesByCompId.get(c.id) } : c
      );
      await supabase
        .from('marketing_productos')
        .update({
          data: { ...data, competidores: updatedCompetidores },
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('user_id', row.user_id);
    }
  }

  return respondJSON(res, 200, {
    ok: true,
    refreshed: totalRefreshed,
    skipped: totalSkipped,
    errors: totalErrors,
    estimatedCostUSD: Math.round(estimatedCostUSD * 100) / 100,
    dailyCapHit: estimatedCostUSD >= DAILY_COST_CAP_USD,
    errorDetails: errors.slice(0, 20),
    runAt: new Date().toISOString(),
  });
}
