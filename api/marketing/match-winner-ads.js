// Marca WINNERS en la galería matcheando contra Meta — el user pega la lista
// de ads ganadores (nombre de archivo + ad ID) y este endpoint hace el resto:
//
//   1. Baja la imagen REAL de cada ad desde Graph API (token de la cookie de
//      Meta del navegador — mismo mecanismo que /api/meta/ad-performance).
//   2. Busca candidatos en marketing_creativos parseando el NOMBRE del archivo
//      descargado: "Cepillo 10-8 Estatico Getaeki Rebrand v6 (4)" → fecha (AR)
//      + marca + estilo + variante (formato de buildFileName de la galería).
//      El nombre NO identifica un único creativo (el mismo día se generan
//      tandas de varios ads de la misma marca), por eso el paso 3.
//   3. Claude Haiku (visión) compara la imagen del ad contra los candidatos y
//      elige EL creativo exacto. Con 1 solo candidato se matchea directo.
//   4. Marca winner=true + winner_metrics={adId, autoMatched} en el elegido.
//
// POST { productoId, items: [{ adId, name }] }  (máx 25; dedupe por adId)
// → { results: [{ adId, name, status, creativoId? }], marked, cost }
//
// status: 'matched' | 'ya-era-winner' | 'sin-imagen' (ad de video) |
//         'nombre-no-parseable' | 'sin-candidatos' | 'sin-match' | 'error'

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';
import {
  getUserIdFromAuth,
  getServiceClient,
  createSignedUrlsForCreativos,
} from './_supabase-server.js';
import { requireAuth } from './_security.js';
import { readMetaCookie, graphGet } from '../meta/_lib.js';

const MODEL_VISION = 'claude-haiku-4-5-20251001';
const MAX_ITEMS = 25;
const MAX_CANDIDATES = 16;

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) return 'image/webp';
  return null;
}

async function fetchImageB64(url, maxBytes = 6 * 1024 * 1024) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} bajando imagen`);
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length < 100) throw new Error('imagen vacía');
  if (buf.length > maxBytes) throw new Error('imagen demasiado grande');
  return { b64: buf.toString('base64'), mime: detectImageType(buf) || 'image/jpeg' };
}

// Parsea el nombre de archivo descargado de la galería (ver buildFileName):
//   "{Prod} {D-M} {Estatico|Story|Landscape} {Marca}[ Rebrand] v{N} [(copia)]"
// La fecha es el createdAt del creativo en hora ARGENTINA. Devuelve
// { desdeIso, hastaIso, brand, rebrand, variantIndex } o null.
function parseDownloadName(name) {
  // Tolera palabras extra entre la marca y el vN (la nomenclatura nueva mete
  // ángulo/evento ahí: "Getaeki Rebrand Testimonio DiaMadre v2").
  const m = String(name || '').match(/(\d{1,2})-(\d{1,2})\s+(?:Estatico|Story|Landscape)\s+(\S+?)(\s+Rebrand)?(?:\s+(?!v\d+\b)[^\s#]+)*\s+v(\d{1,2})\b/i);
  if (!m) return null;
  const d = Number(m[1]), mes = Number(m[2]);
  if (!d || !mes || d > 31 || mes > 12) return null;
  const now = new Date();
  let year = now.getUTCFullYear();
  // Sin año en el nombre: probamos el año actual; si cae en el futuro, es del año pasado.
  if (Date.UTC(year, mes - 1, d) > now.getTime() + 24 * 3600 * 1000) year -= 1;
  // Día ARGENTINA (UTC-3) → rango UTC [03:00 de ese día, 03:00 del siguiente).
  const desde = new Date(Date.UTC(year, mes - 1, d, 3, 0, 0));
  const hasta = new Date(desde.getTime() + 24 * 3600 * 1000);
  return {
    desdeIso: desde.toISOString(),
    hastaIso: hasta.toISOString(),
    brand: m[3],
    rebrand: !!m[4],
    variantIndex: Number(m[5]) - 1,
  };
}

// Haiku visión: ¿cuál candidato es LA MISMA imagen que el ad? → índice 1..N o null.
async function pickMatch({ anthropicKey, adImg, candidatos }) {
  const client = new Anthropic({ apiKey: anthropicKey });
  const content = [
    {
      type: 'text',
      text: `Imagen A = un ad que corrió en Meta. Después vienen ${candidatos.length} candidatos numerados. Uno de ellos puede ser EXACTAMENTE la misma imagen que A (misma composición, mismos textos, mismo producto — puede variar solo compresión/resolución/recorte leve). Variaciones del mismo concepto con OTRO texto, otra modelo u otra composición NO cuentan como match. Respondé SOLO JSON: {"match": <número del candidato o null>}`,
    },
    { type: 'text', text: 'IMAGEN A (el ad de Meta):' },
    { type: 'image', source: { type: 'base64', media_type: adImg.mime, data: adImg.b64 } },
  ];
  candidatos.forEach((c, i) => {
    content.push({ type: 'text', text: `CANDIDATO ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: c.mime, data: c.b64 } });
  });
  const resp = await client.messages.create({
    model: MODEL_VISION,
    max_tokens: 200,
    messages: [{ role: 'user', content }],
  });
  const text = resp.content?.find(b => b.type === 'text')?.text || '';
  let match = null;
  try {
    const j = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    if (Number.isInteger(j.match) && j.match >= 1 && j.match <= candidatos.length) match = j.match - 1;
  } catch {}
  return { match, cost: anthropicCost(resp.usage, MODEL_VISION) };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await requireAuth(req, res, getUserIdFromAuth);
  if (!userId) return;

  // Meta es necesario SOLO para nombres viejos sin #código (matcheo por
  // imagen). Con código, la resolución es directa contra la base.
  const metaSession = readMetaCookie(req);

  const svc = getServiceClient();
  if (!svc) return respondJSON(res, 500, { error: 'Supabase no configurado en el server.' });
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada.' });

  const body = await readBody(req);
  const productoId = String(body?.productoId || '').trim();
  if (!productoId) return respondJSON(res, 400, { error: 'Falta productoId' });

  // Dedupe por adId, cap de items.
  const vistos = new Set();
  const items = (Array.isArray(body?.items) ? body.items : [])
    .map(it => ({ adId: String(it?.adId || '').replace(/\D/g, ''), name: String(it?.name || '').trim() }))
    .filter(it => it.adId.length >= 10 && !vistos.has(it.adId) && vistos.add(it.adId))
    .slice(0, MAX_ITEMS);
  if (items.length === 0) return respondJSON(res, 400, { error: 'No llegó ningún ad válido (cada item necesita un ad ID numérico).' });

  const results = [];
  const aMarcar = []; // { creativoId, adId, adName }
  let totalCost = 0;

  for (const it of items) {
    try {
      // 0. CÓDIGO CORTO en el nombre ("#abc123"): los archivos descargados
      //    desde la galería llevan la cola única del id del creativo →
      //    resolución EXACTA e instantánea, sin Meta ni visión.
      const codeM = String(it.name || '').match(/#([a-z0-9]{4,10})\b/i);
      if (codeM) {
        const code = codeM[1].toLowerCase();
        const { data: porCodigo } = await svc.from('marketing_creativos')
          .select('id, winner')
          .eq('producto_id', productoId)
          .like('id', `%${code}`)
          .limit(5);
        const exactos = (porCodigo || []).filter(c => String(c.id).toLowerCase().endsWith(`_${code}`));
        if (exactos.length === 1) {
          const c = exactos[0];
          if (c.winner) {
            results.push({ ...it, status: 'ya-era-winner', creativoId: c.id });
          } else {
            aMarcar.push({ creativoId: c.id, adId: it.adId, adName: it.name });
            results.push({ ...it, status: 'matched', creativoId: c.id, por: 'codigo' });
          }
          continue;
        }
        // Código sin match único → seguimos por el camino de imagen.
      }

      if (!metaSession?.accessToken) {
        results.push({ ...it, status: 'sin-meta', detalle: 'Nombre sin #código — conectá Meta para matchear por imagen.' });
        continue;
      }

      // 1. Imagen real del ad desde Graph (thumbnail 512 alcanza para comparar).
      let adImg = null;
      try {
        const ad = await graphGet(it.adId, metaSession.accessToken, {
          fields: 'name,creative.thumbnail_width(512).thumbnail_height(512){image_url,thumbnail_url}',
        });
        const url = ad?.creative?.image_url || ad?.creative?.thumbnail_url || null;
        if (url) adImg = await fetchImageB64(url);
        it.metaName = ad?.name || '';
      } catch (e) {
        results.push({ ...it, status: 'error', detalle: `Graph: ${e.message}` });
        continue;
      }
      if (!adImg) { results.push({ ...it, status: 'sin-imagen', detalle: 'El ad no tiene imagen (¿es video?)' }); continue; }

      // 2. Candidatos por el patrón del nombre de archivo.
      const p = parseDownloadName(it.name || it.metaName);
      if (!p) { results.push({ ...it, status: 'nombre-no-parseable' }); continue; }
      let q = svc.from('marketing_creativos')
        .select('id, thumb_path, storage_path, winner')
        .eq('producto_id', productoId)
        .ilike('source_brand', `${p.brand}%`)
        .eq('variant_index', p.variantIndex)
        .gte('created_at', p.desdeIso)
        .lt('created_at', p.hastaIso);
      q = p.rebrand ? q.eq('variant_style', 'rebrand') : q.neq('variant_style', 'rebrand');
      const { data: cands, error: qErr } = await q.limit(MAX_CANDIDATES + 10);
      if (qErr) { results.push({ ...it, status: 'error', detalle: qErr.message }); continue; }
      if (!cands || cands.length === 0) { results.push({ ...it, status: 'sin-candidatos' }); continue; }

      // Ya marcado antes (ej: corrida repetida) → no re-trabajar.
      const yaWinner = cands.find(c => c.winner);
      if (yaWinner && cands.length === 1) { results.push({ ...it, status: 'ya-era-winner', creativoId: yaWinner.id }); continue; }

      // 3. Un solo candidato → match directo. Varios → visión.
      let elegido = null;
      if (cands.length === 1) {
        elegido = cands[0];
      } else {
        const lote = cands.slice(0, MAX_CANDIDATES);
        const paths = lote.map(c => c.thumb_path || c.storage_path).filter(Boolean);
        const signed = await createSignedUrlsForCreativos(paths, 600);
        const imgs = [];
        const conImg = [];
        for (const c of lote) {
          const u = signed.get(c.thumb_path) || signed.get(c.storage_path);
          if (!u) continue;
          try { imgs.push(await fetchImageB64(u)); conImg.push(c); } catch {}
        }
        if (imgs.length === 0) { results.push({ ...it, status: 'error', detalle: 'no pude bajar las imágenes candidatas' }); continue; }
        const { match, cost } = await pickMatch({ anthropicKey, adImg, candidatos: imgs });
        totalCost += cost || 0;
        if (match == null) { results.push({ ...it, status: 'sin-match', candidatos: imgs.length }); continue; }
        elegido = conImg[match];
      }

      if (elegido.winner) {
        results.push({ ...it, status: 'ya-era-winner', creativoId: elegido.id });
      } else {
        aMarcar.push({ creativoId: elegido.id, adId: it.adId, adName: it.name || it.metaName || '' });
        results.push({ ...it, status: 'matched', creativoId: elegido.id });
      }
    } catch (e) {
      results.push({ ...it, status: 'error', detalle: e.message });
    }
  }

  // 4. Marcar winners (uno por uno: el metrics lleva el adId de cada uno).
  let marked = 0;
  for (const w of aMarcar) {
    const { error } = await svc.from('marketing_creativos')
      .update({
        winner: true,
        winner_at: new Date().toISOString(),
        winner_metrics: { adId: w.adId, adName: w.adName.slice(0, 200), autoMatched: true },
        updated_at: new Date().toISOString(),
      })
      .eq('id', w.creativoId);
    if (!error) marked++;
  }

  return respondJSON(res, 200, {
    marked,
    total: items.length,
    results,
    cost: { anthropic: totalCost },
  });
}
