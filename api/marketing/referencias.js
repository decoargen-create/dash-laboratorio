// Referencias de Instagram — el admin pega un link de reel/post y queda
// "agendado" como referencia creativa: mp4 + miniatura persistidos en el
// bucket `creativos` (las URLs del CDN de IG expiran en horas), metadata en
// la tabla marketing_referencias, y análisis de IA opcional (Whisper +
// Claude: ángulo / hooks / estructura).
//
// Endpoints:
//   GET    /api/marketing/referencias?productoId=X   → lista (con signed URLs)
//   GET    /api/marketing/referencias?action=video&id=X → firma el mp4 para
//          quien tenga una tarjeta con esa referencia (el editor incluido)
//   POST   /api/marketing/referencias                → agregar {url, productoId?}
//   POST   /api/marketing/referencias?action=analyze → {id} transcribe + analiza y guarda
//   PATCH  /api/marketing/referencias?id=X           → guardar {guion} | {producto_id}
//   DELETE /api/marketing/referencias?id=X           → borrar fila + archivos
//
// Scraping: Apify actor de Instagram (APIFY_IG_ACTOR_ID, default
// apify/instagram-scraper) con el mismo APIFY_TOKEN que la Ad Library.
// Auth: requireAuth (Bearer de Supabase) — endpoint pago, anti cost-abuse.

import Anthropic from '@anthropic-ai/sdk';
import { runActorSync } from './_apify.js';
import { anthropicCost, whisperCost } from './_costs.js';
import { getUserIdFromAuth, getServiceClient } from './_supabase-server.js';
import { requireAuth, safeFetch } from './_security.js';

export const maxDuration = 300;

const BUCKET = 'creativos';
const TABLE = 'marketing_referencias';
const DEFAULT_IG_ACTOR = 'apify/instagram-scraper';

// Piso de resultados cobrables que hay que pedirle a Apify para que el run
// pase su mínimo de $0.0027 por run. Con el precio actual del actor
// (~$0.0023/resultado) alcanzaría con 2; 3 deja margen por si sube o si se
// cambia el actor por env var, y no cuesta nada: el gasto lo define cuántos
// resultados DEVUELVE, no cuántos se autorizan.
const MIN_ITEMS_COBRABLES = 3;
const MODEL = 'claude-sonnet-4-6';
const VIDEO_MAX_MB = 60;    // cap de descarga del mp4 (reels suelen pesar 2-20MB)
const WHISPER_MAX_MB = 25;  // límite de la API de Whisper

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

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

// instagram.com/reel/<code>, /reels/<code>, /p/<code>, /tv/<code> — con o sin
// username en el medio (instagram.com/<user>/reel/<code>).
export function parseIgShortcode(url) {
  const m = String(url || '').match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/i);
  return m ? m[1] : null;
}

// Baja una URL remota a Buffer con cap de tamaño. Las URLs del CDN de IG
// (cdninstagram/fbcdn) están en el allowlist de safeFetch.
async function downloadBuffer(url, { maxMB, timeoutMs = 90000, label = 'archivo' }) {
  const resp = await safeFetch(url, {}, { timeoutMs });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} bajando ${label}`);
  const size = Number(resp.headers.get('content-length') || 0);
  if (size > maxMB * 1024 * 1024) {
    throw new Error(`${label} pesa ${(size / 1024 / 1024).toFixed(1)}MB > ${maxMB}MB`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength > maxMB * 1024 * 1024) {
    throw new Error(`${label} pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB > ${maxMB}MB`);
  }
  return buf;
}

async function signPaths(sb, paths, expires = 3600) {
  const valid = paths.filter(Boolean);
  if (valid.length === 0) return new Map();
  try {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(valid, expires);
    if (error || !Array.isArray(data)) return new Map();
    return new Map(data.map(s => [s.path, s.signedUrl]).filter(([p, u]) => p && u));
  } catch { return new Map(); }
}

// Fila → shape que consume el front, con las signed URLs ya resueltas.
function rowOut(row, signed) {
  return {
    ...row,
    videoUrl: row.video_storage_path ? (signed.get(row.video_storage_path) || null) : null,
    thumbUrl: row.thumb_storage_path ? (signed.get(row.thumb_storage_path) || null) : null,
  };
}

async function listReferencias(sb, userId, productoId) {
  let q = sb.from(TABLE).select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(200);
  if (productoId) q = q.eq('producto_id', String(productoId));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data || [];
  const signed = await signPaths(sb, rows.flatMap(r => [r.video_storage_path, r.thumb_storage_path]));
  return rows.map(r => rowOut(r, signed));
}

// ── Agregar: scrape con Apify + persistir video/thumb + insertar fila ───────
async function handleAdd(res, sb, userId, body) {
  const rawUrl = String(body.url || '').trim();
  const shortcode = parseIgShortcode(rawUrl);
  if (!shortcode) {
    return respondJSON(res, 400, { error: 'No parece un link de reel/post de Instagram (esperaba instagram.com/reel/… o /p/…).' });
  }

  // Dedup por shortcode: si ya está agendado, devolvemos el existente.
  const { data: dup } = await sb.from(TABLE).select('*')
    .eq('user_id', userId).eq('shortcode', shortcode).limit(1).maybeSingle();
  if (dup) {
    const signed = await signPaths(sb, [dup.video_storage_path, dup.thumb_storage_path]);
    return respondJSON(res, 200, { referencia: rowOut(dup, signed), dedup: true });
  }

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    return respondJSON(res, 500, { error: 'APIFY_TOKEN no configurada', hint: 'Agregala en Vercel → Settings → Environment Variables.' });
  }

  // /p/<code> funciona para reels y posts (IG redirige solo).
  const canonical = `https://www.instagram.com/p/${shortcode}/`;
  const actor = process.env.APIFY_IG_ACTOR_ID || DEFAULT_IG_ACTOR;
  let items;
  try {
    // Por qué maxItems 3 si queremos UN post:
    //
    // apify/instagram-scraper cobra por resultado (~$0.0023). Apify calcula el
    // techo de gasto del run como maxItems × precio, y exige que ese techo sea
    // de al menos $0.0027. Con maxItems 1 el techo da $0.0023 — apenas abajo —
    // y rechaza el run con 400 `max-total-charge-usd-below-minimum` antes de
    // arrancarlo. Nunca se llegaba a scrapear nada.
    //
    // Subir el TECHO no sube el gasto: `directUrls` trae un solo post, así que
    // se paga un resultado igual. Es permiso para gastar, no gasto.
    items = await runActorSync(actor, {
      directUrls: [canonical],
      resultsType: 'posts',
      resultsLimit: 1,
      maxItems: MIN_ITEMS_COBRABLES,
      addParentData: false,
    }, apifyToken, { timeout: 150 });
  } catch (err) {
    return respondJSON(res, 502, { error: `Apify falló scrapeando el post: ${err.message}` });
  }
  // Nos quedamos con el post que PEDIMOS, no con el primero que venga. Ahora
  // que autorizamos 3 resultados, si el actor devolviera alguno de más (otro
  // post del mismo perfil, por ejemplo) guardaríamos el equivocado bajo este
  // shortcode y el editor replicaría un reel que nadie eligió.
  const lista = Array.isArray(items) ? items : [];
  const mismoPost = (i) => String(i?.shortCode || '').trim().toLowerCase() === shortcode.toLowerCase();
  const item = lista.find(i => i && mismoPost(i) && (i.videoUrl || i.displayUrl))
    || lista.find(i => i && mismoPost(i))
    // Último recurso: el actor no mandó shortCode pero trajo un solo post.
    || (lista.length === 1 ? lista.find(i => i && (i.videoUrl || i.displayUrl)) : null);
  if (!item) {
    return respondJSON(res, 404, { error: 'Apify no devolvió el post — ¿es público? Los posts privados o borrados no se pueden scrapear.' });
  }

  const id = `ref_ig_${shortcode}_${Date.now()}`;
  const videoUrl = item.videoUrl || item.videoUrls?.[0] || null;
  const thumbUrl = item.displayUrl || item.images?.[0] || null;

  // Persistimos ASAP: las URLs del CDN de IG expiran en horas.
  let videoPath = null;
  let thumbPath = null;
  let videoWarn = null;
  if (videoUrl) {
    try {
      const buf = await downloadBuffer(videoUrl, { maxMB: VIDEO_MAX_MB, label: 'video' });
      videoPath = `${userId}/referencias/${id}.mp4`;
      const { error } = await sb.storage.from(BUCKET).upload(videoPath, buf, { contentType: 'video/mp4', upsert: true });
      if (error) { videoPath = null; videoWarn = `Storage: ${error.message}`; }
    } catch (err) {
      videoWarn = err.message;
    }
  }
  if (thumbUrl) {
    try {
      const buf = await downloadBuffer(thumbUrl, { maxMB: 15, timeoutMs: 30000, label: 'miniatura' });
      thumbPath = `${userId}/referencias/${id}_thumb.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(thumbPath, buf, { contentType: 'image/jpeg', upsert: true });
      if (error) thumbPath = null;
    } catch { thumbPath = null; }
  }

  const row = {
    id,
    user_id: userId,
    producto_id: body.productoId != null ? String(body.productoId) : null,
    url: rawUrl.slice(0, 500),
    shortcode,
    platform: 'ig',
    caption: (item.caption || '').slice(0, 4000) || null,
    owner_username: item.ownerUsername || item.ownerFullName || null,
    video_duration: Number(item.videoDuration) || null,
    video_storage_path: videoPath,
    thumb_storage_path: thumbPath,
  };
  const { data: inserted, error: insErr } = await sb.from(TABLE)
    .upsert(row, { onConflict: 'user_id,id' }).select().single();
  if (insErr) return respondJSON(res, 500, { error: `Insert: ${insErr.message}` });

  const signed = await signPaths(sb, [videoPath, thumbPath]);
  return respondJSON(res, 200, {
    referencia: rowOut(inserted, signed),
    ...(videoWarn ? { videoWarn: `No se pudo guardar el mp4 (${videoWarn}) — queda el embed de IG como reproductor.` } : {}),
  });
}

// ── Analizar: Whisper (idioma auto) + Claude (ángulo/hooks/estructura) ──────
const ANALYZE_SYSTEM = `Sos un analista senior de video-ads y reels para DTC en Argentina. Te paso un reel de Instagram que el equipo guardó como referencia creativa (miniatura + caption + transcripción si hay). Tu output son insights accionables para que un editor lo REPLIQUE para otro producto.

Devolvé EXACTAMENTE este JSON (sin markdown, sin texto extra):
{
  "hooks": ["los primeros segundos que enganchan el scroll — 2 a 4 hooks concretos, citando lo que se dice/muestra"],
  "angle": "el ángulo emocional principal, corto (ej: 'transformación antes/después', 'curiosidad', 'social proof', 'miedo al problema')",
  "triggers": ["disparadores emocionales, 3 a 5 ordenados por impacto"],
  "estructura": "la mecánica del reel en 1-2 líneas: tipo de hook + orden de beats + mecanismo de persuasión. Es el PATRÓN a preservar al replicar.",
  "visual": "estilo visual detallado y reutilizable: tipo de toma (UGC casero / estudio / lifestyle), ambiente, ritmo de cortes, textos en pantalla, mood. Concreto como para replicar el look.",
  "why_it_works": "por qué funciona este reel — 2 a 3 razones concretas"
}`;

async function transcribeFromSignedUrl(signedUrl, openaiKey) {
  let videoRes;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    videoRes = await fetch(signedUrl, { signal: ctl.signal });
  } catch (err) {
    clearTimeout(timer);
    return { skipped: true, reason: err.name === 'AbortError' ? 'timeout bajando el video' : err.message };
  }
  clearTimeout(timer);
  if (!videoRes.ok) return { skipped: true, reason: `HTTP ${videoRes.status} bajando el video` };
  const buf = await videoRes.arrayBuffer();
  if (buf.byteLength > WHISPER_MAX_MB * 1024 * 1024) {
    return { skipped: true, reason: `video ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB > ${WHISPER_MAX_MB}MB (límite Whisper)` };
  }

  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'video/mp4' }), 'reel.mp4');
  form.append('model', 'whisper-1');
  // Sin `language`: los reels de referencia pueden venir en inglés/portugués;
  // verbose_json devuelve el idioma detectado (adaptar-guion-video lo usa).
  form.append('response_format', 'verbose_json');

  const wCtl = new AbortController();
  const wTimer = setTimeout(() => wCtl.abort(), 120000);
  let whisperRes;
  try {
    whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body: form,
      signal: wCtl.signal,
    });
  } catch (err) {
    clearTimeout(wTimer);
    return { skipped: true, reason: err.name === 'AbortError' ? 'Whisper timeout' : err.message };
  }
  clearTimeout(wTimer);
  if (!whisperRes.ok) {
    const text = await whisperRes.text();
    return { skipped: true, reason: `Whisper ${whisperRes.status}: ${text.slice(0, 160)}` };
  }
  const data = await whisperRes.json();
  return { text: data.text || '', idioma: data.language || null, duration: Number(data.duration) || 0 };
}

async function handleAnalyze(res, sb, userId, body) {
  const id = String(body.id || '').trim();
  if (!id) return respondJSON(res, 400, { error: 'Falta id' });
  const { data: row, error } = await sb.from(TABLE).select('*')
    .eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) return respondJSON(res, 500, { error: error.message });
  if (!row) return respondJSON(res, 404, { error: 'Referencia no encontrada' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });

  const signed = await signPaths(sb, [row.video_storage_path, row.thumb_storage_path], 1800);

  // Paso 1 — transcripción (si hay mp4 guardado y todavía no se transcribió)
  let transcript = row.transcript || null;
  let idioma = row.idioma || null;
  let transcriptStatus = transcript ? 'cached' : 'no_video';
  let whisperDurationSec = 0;
  const signedVideo = row.video_storage_path ? signed.get(row.video_storage_path) : null;
  if (!transcript && signedVideo) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      transcriptStatus = 'no_openai_key';
    } else {
      const r = await transcribeFromSignedUrl(signedVideo, openaiKey);
      if (r.text) {
        transcript = r.text;
        idioma = r.idioma;
        transcriptStatus = 'ok';
        whisperDurationSec = r.duration;
      } else {
        transcriptStatus = `skipped: ${r.reason}`;
      }
    }
  }

  // Paso 2 — análisis estructurado con Claude (thumb como Vision si existe)
  const content = [];
  const signedThumb = row.thumb_storage_path ? signed.get(row.thumb_storage_path) : null;
  if (signedThumb) content.push({ type: 'image', source: { type: 'url', url: signedThumb } });
  content.push({
    type: 'text',
    text: [
      'REEL DE REFERENCIA',
      '==================',
      `Cuenta: @${row.owner_username || 'desconocida'}`,
      `Duración: ${row.video_duration ? `${Math.round(row.video_duration)}s` : 'N/A'}`,
      '',
      'Caption:',
      '"""',
      (row.caption || '(sin caption)').slice(0, 2500),
      '"""',
      transcript ? `\nTranscripción del video (Whisper${idioma ? `, idioma: ${idioma}` : ''}):\n"""\n${transcript.slice(0, 5000)}\n"""` : '\n(No hay transcripción disponible — analizá desde la miniatura + caption.)',
    ].join('\n'),
  });

  let analisis;
  let usage;
  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: ANALYZE_SYSTEM,
      messages: [{ role: 'user', content }],
    });
    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('Claude no devolvió texto');
    let jsonStr = textBlock.text.trim();
    const m = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) jsonStr = m[1];
    analisis = JSON.parse(jsonStr);
    usage = resp.usage;
  } catch (err) {
    return respondJSON(res, 502, { error: `Análisis falló: ${err.message}`, transcriptStatus });
  }

  const patch = { transcript, idioma, analisis, updated_at: new Date().toISOString() };
  const { data: updated, error: upErr } = await sb.from(TABLE).update(patch)
    .eq('user_id', userId).eq('id', id).select().single();
  if (upErr) return respondJSON(res, 500, { error: `Update: ${upErr.message}` });

  const cost = { anthropic: anthropicCost(usage, MODEL) };
  const whisper = whisperCost(whisperDurationSec);
  if (whisper > 0) cost.openai = whisper;
  return respondJSON(res, 200, { referencia: rowOut(updated, signed), transcriptStatus, cost });
}

async function handlePatch(res, sb, userId, id, body) {
  if (!id) return respondJSON(res, 400, { error: 'Falta ?id=' });
  const patch = { updated_at: new Date().toISOString() };
  // Solo claves permitidas — el guion lo genera adaptar-guion-video en el
  // front y acá solo lo persistimos.
  if (body.guion !== undefined) patch.guion = body.guion;
  if (body.productoId !== undefined) patch.producto_id = body.productoId != null ? String(body.productoId) : null;
  if (Object.keys(patch).length === 1) return respondJSON(res, 400, { error: 'Nada para actualizar (acepta guion / productoId)' });
  const { data: updated, error } = await sb.from(TABLE).update(patch)
    .eq('user_id', userId).eq('id', id).select().single();
  if (error) return respondJSON(res, 500, { error: error.message });
  if (!updated) return respondJSON(res, 404, { error: 'Referencia no encontrada' });
  const signed = await signPaths(sb, [updated.video_storage_path, updated.thumb_storage_path]);
  return respondJSON(res, 200, { referencia: rowOut(updated, signed) });
}

async function handleDelete(res, sb, userId, id) {
  if (!id) return respondJSON(res, 400, { error: 'Falta ?id=' });
  const { data: row } = await sb.from(TABLE).select('video_storage_path,thumb_storage_path')
    .eq('user_id', userId).eq('id', id).maybeSingle();
  if (row) {
    const paths = [row.video_storage_path, row.thumb_storage_path].filter(Boolean);
    if (paths.length) {
      try { await sb.storage.from(BUCKET).remove(paths); } catch {}
    }
  }
  const { error } = await sb.from(TABLE).delete().eq('user_id', userId).eq('id', id);
  if (error) return respondJSON(res, 500, { error: error.message });
  return respondJSON(res, 200, { ok: true });
}

// Firma el video de una referencia para el EDITOR.
//
// El editor no puede leer marketing_referencias (RLS por dueño) ni firmar el
// bucket del admin, así que hasta ahora veía un embed de Instagram. Eso hace
// que guardar el mp4 no sirva para nada justo cuando más importa: si borran el
// post o lo hacen privado, el video está a salvo en el storage y el editor
// igual ve un recuadro roto.
//
// Acá se cierra ese hueco sin abrir la tabla: se firma solo si quien pide
// TIENE una tarjeta que lleva esa referencia — como dueño o como editor
// asignado. Es el mismo permiso que ya tiene para ver la tarjeta.
async function handleVideo(res, sb, userId, refId) {
  if (!refId) return respondJSON(res, 400, { error: 'Falta id' });

  const { data: tarjeta, error: errT } = await sb
    .from('produccion_asignaciones')
    .select('id')
    .or(`owner_id.eq.${userId},creator_id.eq.${userId}`)
    .contains('referencias', [{ id: refId }])
    .limit(1)
    .maybeSingle();
  if (errT) return respondJSON(res, 500, { error: `No pude verificar el acceso: ${errT.message}` });
  if (!tarjeta) return respondJSON(res, 403, { error: 'Esa referencia no está en ninguna de tus tarjetas.' });

  const { data: ref, error: errR } = await sb
    .from(TABLE).select('video_storage_path, thumb_storage_path').eq('id', refId).limit(1).maybeSingle();
  if (errR) return respondJSON(res, 500, { error: `No pude leer la referencia: ${errR.message}` });
  // Sin mp4 guardado no es un error: el front cae al embed de Instagram.
  if (!ref?.video_storage_path) return respondJSON(res, 200, { videoUrl: null, thumbUrl: null });

  const signed = await signPaths(sb, [ref.video_storage_path, ref.thumb_storage_path]);
  return respondJSON(res, 200, {
    videoUrl: signed.get(ref.video_storage_path) || null,
    thumbUrl: signed.get(ref.thumb_storage_path) || null,
  });
}

export default async function handler(req, res) {
  const userId = await requireAuth(req, res, getUserIdFromAuth);
  if (!userId) return;
  const sb = getServiceClient();
  if (!sb) return respondJSON(res, 500, { error: 'Supabase no configurado en el server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });

  const urlObj = new URL(req.url, 'http://localhost');
  const id = urlObj.searchParams.get('id');
  const action = urlObj.searchParams.get('action');

  try {
    if (req.method === 'GET') {
      if (action === 'video') return await handleVideo(res, sb, userId, id);
      const referencias = await listReferencias(sb, userId, urlObj.searchParams.get('productoId'));
      return respondJSON(res, 200, { referencias });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (action === 'analyze') return await handleAnalyze(res, sb, userId, body);
      return await handleAdd(res, sb, userId, body);
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      return await handlePatch(res, sb, userId, id, body);
    }
    if (req.method === 'DELETE') return await handleDelete(res, sb, userId, id);
    return respondJSON(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[referencias]', err);
    return respondJSON(res, 500, { error: err.message || 'Error inesperado' });
  }
}
