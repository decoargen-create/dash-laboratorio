// Meta ADS Publisher de CELLU Argentina.
//
// GET /api/marketing/meta-ads-publisher
//   → Disparado por Vercel Cron (header x-vercel-cron: 1) 4 veces al día,
//     o manualmente con Authorization: Bearer ${IG_REFRESH_CRON_SECRET}.
//
// Flow:
//   1. Auth.
//   2. Cargar state KV.
//   3. Resolver folder Drive del mes corriente ("Abril 2026" auto).
//   4. Listar subfolders de producto (Probiotico, Cepillo, Crema, ...).
//   5. Por cada producto, listar tandas. Filtrar las ya publicadas
//      (folder_id en state.published_folders OR nombre incluye "PUBLICADO").
//   6. Por cada candidata válida:
//        - Buscar reference ad ACTIVE en log con mismo product+source.
//        - GET creative.object_story_spec del ref → baseSpec.
//        - Crear campaign CBO + adset.
//        - Subir media (videos con polling, imágenes con multipart).
//        - Crear adcreative + ad por cada media.
//        - Verificar todo ACTIVE (con retries).
//        - Marcar carpeta Drive como PUBLICADO (rename).
//        - Append log entry y push folder_id a published_folders.
//   7. Reportar a Discord (siempre).
//   8. Persistir state en KV.
//   9. Responder 200 con summary.
//
// IMPORTANTE: la idempotencia descansa en (a) state.published_folders, y (b)
// el sufijo "PUBLICADO" en el nombre de la carpeta. Si KV se borra pero las
// carpetas ya están renombradas, no hay doble publicación.

import { checkAuth } from '../../lib/meta-publisher/auth.js';
import { loadState, saveState, findReferenceAdId } from '../../lib/meta-publisher/state.js';
import {
  getDriveClient,
  listChildren,
  onlyFolders,
  findCurrentMonthFolder,
  classifyFolderFiles,
  downloadFile,
  markFolderPublished,
  extractStaticNumber,
} from '../../lib/meta-publisher/drive.js';
import {
  getReferenceObjectStorySpec,
  createCampaign,
  createAdset,
  uploadVideo,
  pollVideoReady,
  getPreferredThumbnailUri,
  uploadImage,
  createAdCreative,
  createAd,
  verifyCampaign,
  verifyAdActive,
} from '../../lib/meta-publisher/meta.js';
import {
  reportRun,
  reportEmptyRun,
  reportFatalError,
  currentRunHourAR,
} from '../../lib/meta-publisher/discord.js';

export const config = {
  // 5 min: subir 9 videos + polling puede tardar varios minutos.
  maxDuration: 300,
};

const DAILY_BUDGET_CENTS = 4000; // $40 USD

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Formato d/M sin ceros a la izquierda (ej: "26/4").
 */
function formatDayMonthAR(date) {
  const arMs = date.getTime() - 3 * 60 * 60 * 1000;
  const ar = new Date(arMs);
  return `${ar.getUTCDate()}/${ar.getUTCMonth() + 1}`;
}

/**
 * Devuelve "YYYY-MM-DD" del día siguiente en zona AR.
 */
function nextDayDateAR(date) {
  const arMs = date.getTime() - 3 * 60 * 60 * 1000;
  const ar = new Date(arMs + 24 * 60 * 60 * 1000);
  const yyyy = ar.getUTCFullYear();
  const mm = String(ar.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ar.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Procesa una carpeta candidata: crea campaign+adset+ads, verifica, renombra.
 * Devuelve { ok, logEntry, summary, error? } — NO tira (los errores los
 * encapsula para que el run global pueda seguir con el resto de carpetas).
 */
async function processFolder({ drive, state, product, folder, files, kind, env, runIso }) {
  const adAccountId = env.adAccountId;
  const pixelId = env.pixelId;

  const refAdId = findReferenceAdId(state, product, kind);
  if (!refAdId) {
    return {
      ok: false,
      skipped: true,
      reason: `no hay reference ad ACTIVE en el log para ${product} ${kind}`,
    };
  }

  const warnings = [];
  let baseSpec;
  try {
    baseSpec = await getReferenceObjectStorySpec(refAdId);
  } catch (err) {
    return {
      ok: false,
      skipped: true,
      reason: `reference ad ${refAdId} ilegible: ${err.message}`,
    };
  }

  const dM = formatDayMonthAR(new Date(runIso));
  const startTimeIso = `${nextDayDateAR(new Date(runIso))}T05:00:00-0300`;
  const campaignName = `${product} ${dM} [CBO Testeo ${kind}]`;
  const adsetName = folder.name;

  // 1. Campaign
  const campaignId = await createCampaign(adAccountId, {
    name: campaignName,
    dailyBudgetCents: DAILY_BUDGET_CENTS,
  });

  // 2. Adset
  const adsetId = await createAdset(adAccountId, {
    name: adsetName,
    campaignId,
    pixelId,
    startTimeIso,
  });

  // 3. Por cada archivo: subir media + crear creative + crear ad.
  const adDetails = [];
  let staticIdx = 0;
  for (const f of files) {
    let mediaId = null;
    let mediaKind = kind;
    let creativeId = null;
    let adId = null;
    let adName = '';

    // 3a. Descargar binario de Drive
    const buf = await downloadFile(drive, f.id);

    if (kind === 'Videos') {
      // 3b-V. Subir video + esperar ready + thumb
      const videoId = await uploadVideo(adAccountId, f.name, buf);
      mediaId = videoId;
      try {
        await pollVideoReady(videoId, { timeoutMs: 90000, intervalMs: 5000 });
      } catch (err) {
        warnings.push(`video ${f.name} no llegó a 'ready' a tiempo: ${err.message}`);
        // Continuamos igual: a veces Meta ya lo aceptó pero el status tarda.
      }
      const thumbUri = await getPreferredThumbnailUri(videoId);
      adName = f.name.replace(/\.[^.]+$/, '');
      creativeId = await createAdCreative(adAccountId, {
        name: adName,
        baseSpec,
        kind: 'Videos',
        videoId,
        thumbnailUri: thumbUri,
      });
    } else {
      // 3b-E. Subir imagen
      const { hash } = await uploadImage(adAccountId, f.name, buf);
      mediaId = hash;
      mediaKind = 'Estaticos';
      staticIdx += 1;
      const n = extractStaticNumber(f.name) || String(staticIdx);
      adName = `Estatico ${dM} ${n}`;
      creativeId = await createAdCreative(adAccountId, {
        name: adName,
        baseSpec,
        kind: 'Estaticos',
        imageHash: hash,
      });
    }

    // 3c. Crear ad
    adId = await createAd(adAccountId, { name: adName, adsetId, creativeId });

    adDetails.push({
      ad_id: adId,
      ad_name: adName,
      creative_id: creativeId,
      media_id: mediaId,
      media_kind: mediaKind,
      file_name: f.name,
    });
  }

  // 4. Verificación
  const campCheck = await verifyCampaign(campaignId, { expectedBudgetCents: DAILY_BUDGET_CENTS });
  if (!campCheck.ok) {
    warnings.push(`campaign verify off: status=${campCheck.data?.status} budget=${campCheck.data?.daily_budget}`);
  }
  const failedAds = [];
  for (const d of adDetails) {
    const v = await verifyAdActive(d.ad_id, { retries: 3, delayMs: 5000 });
    if (!v.ok) failedAds.push({ ad_id: d.ad_id, status: v.data?.status, eff: v.data?.effective_status });
  }
  if (failedAds.length) {
    warnings.push(`${failedAds.length}/${adDetails.length} ads no quedaron ACTIVE (${failedAds.map(f => f.ad_id).join(', ')})`);
  }

  // 5. Renombrar carpeta a PUBLICADO
  let renamedTo = null;
  try {
    renamedTo = await markFolderPublished(drive, folder.id, folder.name);
  } catch (err) {
    warnings.push(`no pude renombrar carpeta Drive: ${err.message}`);
  }

  const status = failedAds.length === 0 && campCheck.ok
    ? 'ACTIVE'
    : (failedAds.length === adDetails.length ? 'FAILED' : 'PARTIAL');

  const logEntry = {
    run_at: runIso,
    folder_id: folder.id,
    folder_name: renamedTo || folder.name,
    product,
    source: kind,
    campaign_id: campaignId,
    adset_id: adsetId,
    ad_ids: adDetails.map(d => d.ad_id),
    ad_details: adDetails,
    status,
    reference_ad_id: refAdId,
    warnings: warnings.length ? warnings : undefined,
  };

  return {
    ok: true,
    logEntry,
    summary: {
      product,
      source: kind,
      folder_name: logEntry.folder_name,
      campaign_id: campaignId,
      adset_id: adsetId,
      ad_count: adDetails.length,
      daily_budget_cents: DAILY_BUDGET_CENTS,
      status,
      warnings,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return respondJSON(res, 405, { error: 'Method not allowed' });
  }

  // 1. Auth
  const auth = checkAuth(req);
  if (!auth.ok) {
    return respondJSON(res, 401, { error: 'Unauthorized', reason: auth.reason });
  }

  const runIso = new Date().toISOString();
  const hour = currentRunHourAR();
  const env = {
    adAccountId: process.env.META_AD_ACCOUNT_ID,
    pixelId: process.env.META_PIXEL_ID,
    pageId: process.env.META_PAGE_ID,
    igUserId: process.env.META_INSTAGRAM_USER_ID,
    productLink: process.env.META_PRODUCT_LINK,
    driveRoot: process.env.DRIVE_ROOT_FOLDER_ID,
  };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    const msg = `Faltan env vars: ${missing.join(', ')}`;
    await reportFatalError({ message: msg, hour });
    return respondJSON(res, 500, { error: msg });
  }

  let state;
  try {
    state = await loadState();
  } catch (err) {
    await reportFatalError({ message: `KV loadState falló: ${err.message}`, hour, hint: 'Revisar KV_REST_API_URL/TOKEN' });
    return respondJSON(res, 500, { error: 'KV loadState failed', detail: err.message });
  }

  let drive;
  try {
    drive = await getDriveClient();
  } catch (err) {
    await reportFatalError({ message: `Drive auth falló: ${err.message}`, hour, hint: 'Revisar GOOGLE_SA_JSON' });
    return respondJSON(res, 500, { error: 'Drive auth failed', detail: err.message });
  }

  // 3. Resolver folder del mes corriente
  let monthFolder;
  try {
    monthFolder = await findCurrentMonthFolder(drive, env.driveRoot);
  } catch (err) {
    await reportFatalError({ message: `Drive listChildren root falló: ${err.message}`, hour });
    return respondJSON(res, 500, { error: 'Drive list failed', detail: err.message });
  }
  if (!monthFolder.id) {
    await reportFatalError({
      message: `No encontré la carpeta del mes "${monthFolder.expectedTag}" dentro del root ${env.driveRoot}`,
      hour,
      hint: 'Crear/compartir la carpeta con el Service Account',
    });
    return respondJSON(res, 200, { ok: false, reason: 'month-folder-not-found', expected: monthFolder.expectedTag });
  }

  // 4. Listar subfolders de producto
  const productFolders = onlyFolders(await listChildren(drive, monthFolder.id));

  // 5. Recolectar candidatas
  const candidates = []; // { product, folder, files, kind, ignored? }
  const skipped = []; // { folder_name, reason }

  for (const productFolder of productFolders) {
    const product = productFolder.name.trim();
    let tandas;
    try {
      tandas = onlyFolders(await listChildren(drive, productFolder.id));
    } catch (err) {
      skipped.push({ folder_name: productFolder.name, reason: `listChildren falló: ${err.message}` });
      continue;
    }
    for (const tanda of tandas) {
      if (state.published_folders.includes(tanda.id)) continue;
      if (/PUBLICADO/i.test(tanda.name)) continue;

      let files;
      try {
        files = await listChildren(drive, tanda.id);
      } catch (err) {
        skipped.push({ folder_name: tanda.name, reason: `listChildren tanda falló: ${err.message}` });
        continue;
      }
      const cls = classifyFolderFiles(files);
      if (cls.kind === 'Empty') {
        skipped.push({ folder_name: tanda.name, reason: 'carpeta vacía' });
        continue;
      }
      if (cls.kind === 'Mixed') {
        // Spec: preferir Videos e ignorar el resto, pero loguear warning.
        candidates.push({
          product,
          folder: tanda,
          files: cls.items,
          kind: 'Videos',
          mixedWarning: `${cls.ignored?.length || 0} archivos de imagen ignorados`,
        });
        continue;
      }
      candidates.push({ product, folder: tanda, files: cls.items, kind: cls.kind });
    }
  }

  if (candidates.length === 0) {
    await reportEmptyRun({ hour, reason: skipped.length ? `${skipped.length} carpetas skipeadas` : null });
    state.last_run = runIso;
    state.last_run_status = 'OK - sin novedades';
    try { await saveState(state); } catch (err) { console.error('saveState falló', err); }
    return respondJSON(res, 200, { ok: true, published: 0, skipped, candidates: 0 });
  }

  // 6. Procesar candidatas (secuencial: subida de videos + Meta rate limits)
  const published = []; // summaries para Discord
  const allSkipped = [...skipped];
  for (const c of candidates) {
    let result;
    try {
      result = await processFolder({
        drive, state, product: c.product, folder: c.folder,
        files: c.files, kind: c.kind, env, runIso,
      });
    } catch (err) {
      console.error(`[meta-publisher] processFolder ${c.folder.name} falló`, err);
      allSkipped.push({
        folder_name: c.folder.name,
        reason: `error fatal: ${err.message?.slice(0, 200) || 'desconocido'}`,
      });
      continue;
    }
    if (result.skipped) {
      allSkipped.push({ folder_name: c.folder.name, reason: result.reason });
      continue;
    }
    if (result.ok) {
      // Inyectar el warning de mixto si aplicaba
      if (c.mixedWarning) {
        result.logEntry.warnings = [...(result.logEntry.warnings || []), c.mixedWarning];
        result.summary.warnings = [...(result.summary.warnings || []), c.mixedWarning];
      }
      state.published_folders.push(c.folder.id);
      state.log.push(result.logEntry);
      published.push(result.summary);
    }
  }

  // 7. Persistir state
  state.last_run = runIso;
  state.last_run_status = `OK - ${published.length} campañas publicadas, ${allSkipped.length} skipeadas`;
  try {
    await saveState(state);
  } catch (err) {
    console.error('[meta-publisher] saveState final falló', err);
    // No abortamos: ya publicamos en Meta y renombramos en Drive. Mejor
    // reportar a Discord que perdimos el state que dar 500.
    await reportFatalError({
      message: `Publiqué ${published.length} campañas pero saveState KV falló: ${err.message}. Las carpetas Drive ya quedaron como PUBLICADO así que no se duplicarán. Revisá KV.`,
      hour,
    });
  }

  // 8. Reporte Discord
  if (published.length === 0) {
    await reportEmptyRun({ hour, reason: `${allSkipped.length} carpetas skipeadas` });
  } else {
    await reportRun({
      hour,
      adAccountId: env.adAccountId,
      published,
      skipped: allSkipped,
    });
  }

  return respondJSON(res, 200, {
    ok: true,
    run_at: runIso,
    auth_source: auth.source,
    month_folder: monthFolder.name,
    candidates: candidates.length,
    published: published.length,
    skipped: allSkipped.length,
    summary: published,
    skippedDetail: allSkipped,
  });
}
