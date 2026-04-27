// Meta ADS Publisher de CELLU Argentina (modo legacy single-tenant).
//
// GET /api/marketing/meta-ads-publisher
//   → Disparado por Vercel Cron (header x-vercel-cron: 1) 4 veces al día,
//     o manualmente con Authorization: Bearer ${IG_REFRESH_CRON_SECRET}.
//
// Flow:
//   1. Auth.
//   2. Cargar config desde env (loadConfigFromEnv) — modo Cellu legacy.
//      En Fase 4 el cron orchestrator va a iterar varias automations en
//      lugar de procesar una sola config.
//   3. Cargar state KV (key legacy 'meta_ads_publisher:state').
//   4. Resolver folder Drive del mes corriente ("Abril 2026" auto).
//   5. Listar subfolders de producto (Probiotico, Cepillo, Crema, ...).
//   6. Por cada producto, listar tandas. Filtrar las ya publicadas
//      (folder_id en state.published_folders OR nombre incluye "PUBLICADO").
//   7. Por cada candidata válida:
//        - Buscar reference ad ACTIVE en log con mismo product+source.
//        - GET creative.object_story_spec del ref → baseSpec.
//        - Crear campaign CBO + adset.
//        - Subir media (videos con polling, imágenes con multipart).
//        - Crear adcreative + ad por cada media.
//        - Verificar todo ACTIVE (con retries).
//        - Marcar carpeta Drive como PUBLICADO (rename).
//        - Append log entry y push folder_id a published_folders.
//   8. Reportar a Discord (siempre).
//   9. Persistir state en KV.
//   10. Responder 200 con summary.
//
// IMPORTANTE: la idempotencia descansa en (a) state.published_folders, y (b)
// el sufijo "PUBLICADO" en el nombre de la carpeta. Si KV se borra pero las
// carpetas ya están renombradas, no hay doble publicación.

import { checkAuth } from '../../lib/meta-publisher/auth.js';
import {
  loadConfigFromEnv,
  loadConfigFromAutomation,
} from '../../lib/meta-publisher/config.js';
import { loadState, saveState, findReferenceAdId } from '../../lib/meta-publisher/state.js';
import { listEnabledAutomations } from '../../lib/automations/store.js';
import { loadMetaToken } from '../../lib/tokens/meta.js';
import { loadGoogleToken } from '../../lib/tokens/google.js';
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
 *
 * Ahora toma `cfg` (PublisherConfig) en lugar de leer env directamente.
 */
async function processFolder({ drive, state, product, folder, files, kind, cfg, runIso }) {
  const { adAccountId, pixelId, metaAccessToken, dailyBudgetCents } = cfg;

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
    baseSpec = await getReferenceObjectStorySpec(refAdId, metaAccessToken);
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
    dailyBudgetCents,
  }, metaAccessToken);

  // 2. Adset
  const adsetId = await createAdset(adAccountId, {
    name: adsetName,
    campaignId,
    pixelId,
    startTimeIso,
  }, metaAccessToken);

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
      const videoId = await uploadVideo(adAccountId, f.name, buf, metaAccessToken);
      mediaId = videoId;
      try {
        await pollVideoReady(videoId, { timeoutMs: 90000, intervalMs: 5000 }, metaAccessToken);
      } catch (err) {
        warnings.push(`video ${f.name} no llegó a 'ready' a tiempo: ${err.message}`);
        // Continuamos igual: a veces Meta ya lo aceptó pero el status tarda.
      }
      const thumbUri = await getPreferredThumbnailUri(videoId, metaAccessToken);
      adName = f.name.replace(/\.[^.]+$/, '');
      creativeId = await createAdCreative(adAccountId, {
        name: adName,
        baseSpec,
        kind: 'Videos',
        videoId,
        thumbnailUri: thumbUri,
      }, metaAccessToken);
    } else {
      // 3b-E. Subir imagen
      const { hash } = await uploadImage(adAccountId, f.name, buf, metaAccessToken);
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
      }, metaAccessToken);
    }

    // 3c. Crear ad
    adId = await createAd(adAccountId, { name: adName, adsetId, creativeId }, metaAccessToken);

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
  const campCheck = await verifyCampaign(campaignId, { expectedBudgetCents: dailyBudgetCents }, metaAccessToken);
  if (!campCheck.ok) {
    warnings.push(`campaign verify off: status=${campCheck.data?.status} budget=${campCheck.data?.daily_budget}`);
  }
  const failedAds = [];
  for (const d of adDetails) {
    const v = await verifyAdActive(d.ad_id, { retries: 3, delayMs: 5000 }, metaAccessToken);
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
      daily_budget_cents: dailyBudgetCents,
      status,
      warnings,
    },
  };
}

/**
 * Ejecuta el publisher completo para una sola PublisherConfig.
 * El cron orchestrator (Fase 4) va a llamar esto N veces, una por automation.
 *
 * @returns {Promise<{ ok, candidates, published, skipped, summary, monthFolderName? }>}
 */
async function runForTenant(cfg, { runIso, hour }) {
  const webhookUrl = cfg.discordWebhookUrl;
  let state;
  try {
    state = await loadState(cfg.tenantId);
  } catch (err) {
    await reportFatalError(webhookUrl, { message: `KV loadState falló: ${err.message}`, hour, hint: 'Revisar KV_REST_API_URL/TOKEN' });
    return { ok: false, error: 'KV loadState failed', detail: err.message };
  }

  let drive;
  try {
    drive = await getDriveClient(cfg.driveAuth);
  } catch (err) {
    await reportFatalError(webhookUrl, { message: `Drive auth falló: ${err.message}`, hour, hint: 'Revisar config Drive (SA o OAuth)' });
    return { ok: false, error: 'Drive auth failed', detail: err.message };
  }

  let monthFolder;
  try {
    monthFolder = await findCurrentMonthFolder(drive, cfg.driveRootFolderId);
  } catch (err) {
    await reportFatalError(webhookUrl, { message: `Drive listChildren root falló: ${err.message}`, hour });
    return { ok: false, error: 'Drive list failed', detail: err.message };
  }
  if (!monthFolder.id) {
    await reportFatalError(webhookUrl, {
      message: `No encontré la carpeta del mes "${monthFolder.expectedTag}" dentro del root ${cfg.driveRootFolderId}`,
      hour,
      hint: 'Crear/compartir la carpeta del mes',
    });
    return { ok: true, reason: 'month-folder-not-found', expected: monthFolder.expectedTag, candidates: 0, published: 0, skipped: [] };
  }

  // Listar subfolders de producto
  const productFolders = onlyFolders(await listChildren(drive, monthFolder.id));

  // Recolectar candidatas
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
    await reportEmptyRun(webhookUrl, { hour, reason: skipped.length ? `${skipped.length} carpetas skipeadas` : null });
    state.last_run = runIso;
    state.last_run_status = 'OK - sin novedades';
    try { await saveState(cfg.tenantId, state); } catch (err) { console.error('saveState falló', err); }
    return { ok: true, monthFolderName: monthFolder.name, candidates: 0, published: 0, skipped, summary: [] };
  }

  // Procesar candidatas (secuencial: subida de videos + Meta rate limits)
  const published = [];
  const allSkipped = [...skipped];
  for (const c of candidates) {
    let result;
    try {
      result = await processFolder({
        drive, state, product: c.product, folder: c.folder,
        files: c.files, kind: c.kind, cfg, runIso,
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
      if (c.mixedWarning) {
        result.logEntry.warnings = [...(result.logEntry.warnings || []), c.mixedWarning];
        result.summary.warnings = [...(result.summary.warnings || []), c.mixedWarning];
      }
      state.published_folders.push(c.folder.id);
      state.log.push(result.logEntry);
      published.push(result.summary);
    }
  }

  // Persistir state
  state.last_run = runIso;
  state.last_run_status = `OK - ${published.length} campañas publicadas, ${allSkipped.length} skipeadas`;
  try {
    await saveState(cfg.tenantId, state);
  } catch (err) {
    console.error('[meta-publisher] saveState final falló', err);
    await reportFatalError(webhookUrl, {
      message: `Publiqué ${published.length} campañas pero saveState KV falló: ${err.message}. Las carpetas Drive ya quedaron como PUBLICADO así que no se duplicarán. Revisá KV.`,
      hour,
    });
  }

  // Reporte Discord
  if (published.length === 0) {
    await reportEmptyRun(webhookUrl, { hour, reason: `${allSkipped.length} carpetas skipeadas` });
  } else {
    await reportRun(webhookUrl, {
      hour,
      adAccountId: cfg.adAccountId,
      published,
      skipped: allSkipped,
    });
  }

  return {
    ok: true,
    monthFolderName: monthFolder.name,
    candidates: candidates.length,
    published: published.length,
    skipped: allSkipped,
    summary: published,
  };
}

/**
 * Para una automation dada, resuelve los tokens del owner desde KV y
 * arma la PublisherConfig. Si falta el Meta token, devuelve null
 * (skipea ese tenant). Si falta el Google token, hace fallback al
 * Service Account global (GOOGLE_SA_JSON) — Fase 5 va a llenar el
 * storage de Google y este fallback va a quedar como compat para
 * laboratorios que no migraron.
 *
 * @returns {Promise<{ cfg: object } | { skipReason: string }>}
 */
async function resolveTenantConfig(automation) {
  const metaTok = await loadMetaToken(automation.userId);
  if (!metaTok?.accessToken) {
    return { skipReason: `user ${automation.userId} no tiene Meta token (no conectó o expiró)` };
  }

  const googleTok = await loadGoogleToken(automation.userId);
  let cfg;
  if (googleTok?.accessToken) {
    cfg = loadConfigFromAutomation(automation, {
      metaAccessToken: metaTok.accessToken,
      googleToken: {
        accessToken: googleTok.accessToken,
        refreshToken: googleTok.refreshToken || undefined,
      },
    });
  } else {
    // Fallback: usar la SA global del laboratorio. Solo funciona si el
    // user compartió su Drive root con el SA email. Cuando Fase 5
    // (Google OAuth) esté lista, este branch deja de ser necesario.
    const saJson = process.env.GOOGLE_SA_JSON;
    if (!saJson) {
      return { skipReason: `user ${automation.userId} no tiene Google token y no hay GOOGLE_SA_JSON fallback` };
    }
    cfg = {
      tenantId: automation.id,
      metaAccessToken: metaTok.accessToken,
      adAccountId: automation.adAccountId,
      pageId: automation.pageId,
      pixelId: automation.pixelId,
      igUserId: automation.igUserId,
      productLink: automation.productLink,
      driveAuth: { kind: 'service-account', json: saJson },
      driveRootFolderId: automation.driveRootFolderId,
      discordWebhookUrl: automation.discordWebhookUrl || null,
      dailyBudgetCents: automation.dailyBudgetCents || 4000,
      campaignNameTemplate: automation.campaignNameTemplate,
    };
  }

  return { cfg };
}

/**
 * Orchestrator: itera todas las automations enabled y procesa cada una.
 * Time budget global: maxDuration ≈ 300s. Damos 280s usables, divididos
 * por N tenants, con un mínimo de 30s y un máximo de 280s.
 *
 * Si una automation se pasa de su slot, no abortamos el resto — solo
 * loggeamos warning (Vercel va a matar la function igual cuando llegue
 * a maxDuration; la lógica de slot es para detectar problemas, no
 * para enforcement).
 *
 * @returns {Promise<{ runs: object[], skipped: object[] }>}
 */
async function runOrchestrator({ runIso, hour, automations }) {
  const adminWebhook = process.env.META_PUBLISHER_DISCORD_WEBHOOK || null;
  const runs = [];
  const skipped = [];

  const slotMs = Math.max(30_000, Math.min(280_000, Math.floor(280_000 / automations.length)));
  const startedAt = Date.now();

  for (const automation of automations) {
    const tenantStart = Date.now();
    const resolved = await resolveTenantConfig(automation);

    if (resolved.skipReason) {
      skipped.push({ automationId: automation.id, userId: automation.userId, reason: resolved.skipReason });
      // Si la automation tiene su propio webhook, avisarle al user que su
      // token de Meta venció / no está conectado. Si no, log al admin.
      const userHook = automation.discordWebhookUrl;
      try {
        await reportFatalError(userHook || adminWebhook, {
          message: `Tu automation "${automation.name}" no se ejecutó: ${resolved.skipReason}`,
          hour,
          hint: 'Reconectá Meta desde el panel.',
        });
      } catch (err) { console.warn('[orchestrator] no pude reportar skip', err.message); }
      continue;
    }

    let result;
    try {
      result = await runForTenant(resolved.cfg, { runIso, hour });
    } catch (err) {
      console.error(`[orchestrator] tenant ${automation.id} (${automation.userId}) falló`, err);
      result = { ok: false, error: err.message };
    }
    const tenantMs = Date.now() - tenantStart;
    if (tenantMs > slotMs) {
      console.warn(`[orchestrator] tenant ${automation.id} se pasó del slot: ${tenantMs}ms vs ${slotMs}ms`);
    }
    runs.push({
      automationId: automation.id,
      automationName: automation.name,
      userId: automation.userId,
      durationMs: tenantMs,
      result,
    });
  }

  // Reporte agregado al admin webhook (si existe). NO al usuario — cada
  // automation ya reportó al suyo dentro de runForTenant.
  if (adminWebhook && (runs.length > 0 || skipped.length > 0)) {
    const ok = runs.filter(r => r.result?.ok !== false).length;
    const failed = runs.length - ok;
    const totalDuration = Math.round((Date.now() - startedAt) / 1000);
    const lines = [
      `🔁 **Publisher orchestrator — ${hour} ART**`,
      `📊 ${automations.length} automations enabled · ${ok} OK · ${failed} fallidas · ${skipped.length} skipped`,
      `⏱️ Total: ${totalDuration}s`,
    ];
    if (skipped.length) {
      lines.push('');
      lines.push('⏭️ Skipped:');
      for (const s of skipped.slice(0, 10)) {
        lines.push(`  • ${s.userId} (${s.automationId}): ${s.reason.slice(0, 120)}`);
      }
      if (skipped.length > 10) lines.push(`  … y ${skipped.length - 10} más`);
    }
    try {
      await fetch(adminWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: lines.join('\n').slice(0, 1900),
          allowed_mentions: { parse: [] },
        }),
      });
    } catch (err) {
      console.warn('[orchestrator] admin webhook falló', err.message);
    }
  }

  return { runs, skipped };
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

  // 2. Si hay automations enabled en KV → modo multi-tenant.
  //    Si no → fallback a Cellu legacy (lee config de env).
  let automations = [];
  try {
    automations = await listEnabledAutomations();
  } catch (err) {
    console.warn('[publisher] listEnabledAutomations falló (KV?)', err.message);
    // Si KV está caído, igual intentamos el legacy mode más abajo.
  }

  if (automations.length > 0) {
    const { runs, skipped } = await runOrchestrator({ runIso, hour, automations });
    return respondJSON(res, 200, {
      ok: true,
      mode: 'multi-tenant',
      run_at: runIso,
      auth_source: auth.source,
      total_automations: automations.length,
      runs: runs.map(r => ({
        automationId: r.automationId,
        automationName: r.automationName,
        userId: r.userId,
        durationMs: r.durationMs,
        ok: r.result?.ok !== false,
        published: typeof r.result?.published === 'number' ? r.result.published : (r.result?.summary?.length || 0),
        skipped: Array.isArray(r.result?.skipped) ? r.result.skipped.length : 0,
        error: r.result?.error,
      })),
      skipped,
    });
  }

  // Modo legacy single-tenant (Cellu). Cuando el laboratorio cree su
  // primera automation enabled, este branch deja de ejecutarse.
  let cfg;
  try {
    cfg = loadConfigFromEnv();
  } catch (err) {
    const fallbackHook = process.env.META_PUBLISHER_DISCORD_WEBHOOK || null;
    await reportFatalError(fallbackHook, { message: err.message, hour });
    return respondJSON(res, 500, { error: err.message, missing: err.missing });
  }

  const result = await runForTenant(cfg, { runIso, hour });

  return respondJSON(res, result.ok === false ? 500 : 200, {
    ok: result.ok !== false,
    mode: 'legacy',
    run_at: runIso,
    auth_source: auth.source,
    tenant_id: cfg.tenantId,
    month_folder: result.monthFolderName,
    candidates: result.candidates ?? 0,
    published: typeof result.published === 'number' ? result.published : (result.summary?.length || 0),
    skipped: Array.isArray(result.skipped) ? result.skipped.length : 0,
    summary: result.summary,
    skippedDetail: result.skipped,
    error: result.error,
    detail: result.detail,
    reason: result.reason,
    expected: result.expected,
  });
}

// Re-export por si algún otro endpoint lo necesita (test manual, etc.).
export { runForTenant };
