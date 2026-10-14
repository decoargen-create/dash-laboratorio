// ⭐ Winners automáticos — marca como winner, en las tarjetas de Producción,
// los videos que Meta ya mostró que venden. SOLO para productos con data:
// un producto cuyos ads no aparecen en las cuentas escaneadas no se toca
// (sigue manual — p.ej. el Cepillo hasta que Meta habilite su cuenta).
//
// Criterio (validado contra las decisiones reales de agosto, 6/6):
//   regla A: compras >= min_compras  Y  ROAS >= min_roas      (default 6 y 2.5)
//   regla B: #1 en compras de su tarjeta (tanda) con >= top_min (default 3)
//   ⚠️ revisar: se marca igual pero con warn=true si ROAS < 1.60 (break-even)
//
// Matching ad ↔ video: por NOMBRE. Los editores suben "Aceite 3-10 C1 ..." y
// el ad en Meta se llama igual (o empieza igual). Normalizamos (minúsculas,
// sin extensión ni acentos, solo letras/números) y probamos exacto → prefijo.
// La "tanda" de la regla B es la tarjeta: sus videos compiten entre sí.
//
// Corre de dos maneras:
//   - POST (botón en Métricas, con la cuenta elegida; la cuenta se aprende y
//     queda en auto_winners_owner_config.account_ids del DUEÑO para las
//     corridas siguientes).
//   - Cron diario de las 09:00 AR (handleCronCreativeRefresh la importa): corre
//     una pasada POR DUEÑO con config, con SU token de Meta, SUS tarjetas y SU
//     webhook — auditoría #6: antes usaba el token de "cualquier usuario" y
//     leía/escribía tarjetas sin filtrar dueño (roto con más de un inquilino).
//
// Los winners quedan en produccion_asignaciones.winners (replicados en todas
// las tarjetas del producto, mismo patrón que el marcado manual) con shape
// compatible: { name, link, driveId, fecha, ts } + { auto, compras, roas, warn }.
// La escritura va por la RPC produccion_winners_apply (auditoría #3): el server
// re-lee los winners actuales CON LOCK y mergea — el cron ya no pisa marcados
// manuales hechos mientras consultaba a Meta.

import { getServiceClient, getUserIdFromAuth, getMetaTokenForUser, getLatestMetaToken } from '../marketing/_supabase-server.js';
import { graphGet } from '../meta/_lib.js';
import { pickAction, ACTION_ALIASES } from '../meta/_funnel.js';

export const config = { maxDuration: 120 };

const TABLE = 'produccion_asignaciones';
const DEF = { ventanaDias: 7, minCompras: 6, minRoas: 2.5, topMin: 3, bep: 1.6 };

function respondJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// "Aceite 3-10 C1 Mecanismo.mp4" → "aceite 3 10 c1 mecanismo"
function norm(s) {
  return String(s || '')
    .replace(/\.(mp4|mov|m4v|webm|avi|png|jpe?g|gif)$/i, '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const winnerKey = (w) => String(w?.driveId || w?.link || w?.name || '').trim().toLowerCase();
const productoKey = (r) => String(r.producto_id ?? '').trim() || `n:${String(r.producto_nombre || '').trim().toLowerCase()}`;

// Config del dueño (tabla por inquilino, migración 0041). Fallback a la fila
// global legacy si la base todavía no tiene la tabla nueva.
async function getCfgDueno(svc, ownerId) {
  try {
    const { data, error } = await svc.from('auto_winners_owner_config').select('*').eq('owner_id', ownerId).maybeSingle();
    if (!error) return data || null;
  } catch {}
  try {
    const { data } = await svc.from('auto_winners_config').select('*').eq('id', 1).maybeSingle();
    return data || null;
  } catch { return null; }
}

// Dueños con corrida habilitada (para el cron). Si la tabla nueva no existe o
// está vacía, caemos al modo legacy: un solo dueño, el de la conexión de Meta
// más nueva (el comportamiento de siempre con un solo inquilino).
async function listarDuenos(svc) {
  try {
    const { data, error } = await svc.from('auto_winners_owner_config').select('owner_id').eq('enabled', true);
    if (!error && Array.isArray(data) && data.length) return data.map(d => d.owner_id);
  } catch {}
  const conn = await getLatestMetaToken();
  return conn?.userId ? [conn.userId] : [];
}

// Insights a nivel AD de una cuenta en la ventana. Suma compras/ingresos con
// los mismos alias de acción que usa el embudo (nunca se suman entre sí).
async function adsDeCuenta(accountId, token, ventanaDias) {
  const act = String(accountId).startsWith('act_') ? String(accountId) : `act_${accountId}`;
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - ventanaDias * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const out = [];
  let after = null, guard = 0;
  do {
    const params = {
      level: 'ad',
      fields: 'ad_id,ad_name,campaign_name,spend,actions,action_values',
      time_range: JSON.stringify({ since: iso(desde), until: iso(hoy) }),
      limit: 250,
    };
    if (after) params.after = after;
    const d = await graphGet(`${act}/insights`, token, params);
    for (const r of d.data || []) {
      const spend = Number(r.spend || 0);
      if (spend <= 0) continue;
      out.push({
        adId: r.ad_id,
        adName: r.ad_name || '',
        spend,
        compras: pickAction(r.actions, ACTION_ALIASES.purchases),
        revenue: pickAction(r.action_values, ACTION_ALIASES.purchases),
      });
    }
    after = d.paging?.cursors?.after && d.paging?.next ? d.paging.cursors.after : null;
    guard++;
  } while (after && guard < 8);
  return out;
}

// Discord (mismo patrón que los avisos de Meta/Drive: env global o el primer
// webhook configurado en Producción → Notificaciones).
function isDiscordWebhook(u) {
  return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(String(u || '').trim());
}
async function resolveWebhook(svc, ownerId) {
  // Primero el webhook configurado por ESTE dueño (multi-tenant); el env var
  // global queda de fallback (el canal del equipo de la plataforma).
  try {
    const { data } = await svc.from('produccion_notif_config').select('config').eq('owner_id', ownerId).maybeSingle();
    const ev = data?.config?.eventos || data?.config?.estados || {};
    for (const k of Object.keys(ev)) {
      const w = String(ev[k]?.webhook || '').trim();
      if (isDiscordWebhook(w)) return w;
    }
  } catch {}
  const env = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (isDiscordWebhook(env)) return env;
  return null;
}
async function avisarDiscord(svc, ownerId, marcados, cfg) {
  const url = await resolveWebhook(svc, ownerId);
  if (!url) return;
  const total = marcados.reduce((s, m) => s + m.nuevos.length, 0);
  try {
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'AdsLab · Winners',
        embeds: [{
          title: `⭐ ${total} winner${total === 1 ? '' : 's'} nuevo${total === 1 ? '' : 's'} marcado${total === 1 ? '' : 's'} en Producción`,
          color: 0xF5A623,
          fields: marcados.map(m => ({
            name: m.producto || 'Producto',
            value: m.nuevos.map(n => `• ${n.name}${n.warn ? ' ⚠️ (ROAS bajo el break-even — revisar)' : ''} — ${n.compras} compras · ROAS ${n.roas}`).join('\n').slice(0, 1000),
            inline: false,
          })).slice(0, 10),
          footer: { text: `criterio: ≥${cfg.minCompras} compras y ROAS ≥${cfg.minRoas}, o top de su tanda con ≥${cfg.topMin} · ventana ${cfg.ventanaDias} días` },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch {}
}

// ── La corrida ───────────────────────────────────────────────────────────
// Sin ownerId (cron) corre una pasada POR CADA dueño habilitado y devuelve el
// resumen de todas. Con ownerId (botón de Métricas) corre solo para ese dueño
// y devuelve su resultado directo (la UI espera ese shape).
export async function correrAutoWinners({ extraAccountId = null, ownerId = null } = {}) {
  const svc = getServiceClient();
  if (!svc) return { skipped: 'sin-supabase' };

  if (ownerId) return correrParaDueno(svc, ownerId, { extraAccountId });

  const duenos = await listarDuenos(svc);
  if (!duenos.length) return { skipped: 'sin-duenos' };
  const corridas = [];
  for (const d of duenos) {
    try { corridas.push({ owner: d, ...(await correrParaDueno(svc, d, {})) }); }
    catch (e) { corridas.push({ owner: d, error: e.message }); }
  }
  return { ok: true, corridas };
}

async function correrParaDueno(svc, ownerId, { extraAccountId = null } = {}) {
  const row = await getCfgDueno(svc, ownerId);
  if (row && row.enabled === false) return { skipped: 'deshabilitado' };
  const cfg = {
    ventanaDias: Number(row?.ventana_dias ?? DEF.ventanaDias),
    minCompras: Number(row?.min_compras ?? DEF.minCompras),
    minRoas: Number(row?.min_roas ?? DEF.minRoas),
    topMin: Number(row?.top_min ?? DEF.topMin),
  };

  let accounts = (Array.isArray(row?.account_ids) ? row.account_ids : [])
    .map(a => String(a).replace(/^act_/, '').trim()).filter(Boolean);
  const extra = extraAccountId ? String(extraAccountId).replace(/^act_/, '').trim() : null;
  if (extra && !accounts.includes(extra)) {
    accounts.push(extra);
    // La cuenta se aprende: las corridas del cron la van a incluir (en la
    // config de ESTE dueño).
    try {
      await svc.from('auto_winners_owner_config').upsert(
        { owner_id: ownerId, account_ids: accounts, updated_at: new Date().toISOString() },
        { onConflict: 'owner_id' },
      );
    } catch {}
  }
  if (!accounts.length) return { skipped: 'sin-cuentas', hint: 'Corré una vez desde Métricas con una cuenta elegida: queda guardada para el cron.' };

  // El token de Meta DEL DUEÑO (no "el más nuevo de cualquiera").
  const conn = await getMetaTokenForUser(ownerId);
  if (!conn?.token) return { skipped: 'sin-conexion-meta' };

  // Tarjetas con archivos DEL DUEÑO (las últimas 400 alcanzan y sobran).
  const { data: rows, error: errRows } = await svc.from(TABLE)
    .select('id, producto_id, producto_nombre, archivos, winners, created_at')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(400);
  if (errRows) return { error: `No pude leer Producción: ${errRows.message}` };

  const cards = (rows || []).map(r => ({
    ...r,
    archivosNorm: (Array.isArray(r.archivos) ? r.archivos : [])
      .map(f => ({
        name: f?.name || '',
        n: norm(f?.name),
        driveId: f?.driveId || null,
        // El link del archivo, o lo armamos desde el driveId: el editor tiene
        // que poder ABRIR el winner, no solo leer el nombre.
        link: f?.link || (f?.driveId ? `https://drive.google.com/file/d/${f.driveId}/view` : null),
      }))
      .filter(f => f.n.length >= 6),
  })).filter(c => c.archivosNorm.length > 0);

  // Reparación de winners viejos sin link (los auto-marcados de antes se
  // guardaban solo con el nombre): si el archivo de la tarjeta tiene Drive,
  // completamos link/driveId. Corre siempre, haya o no winners nuevos.
  let enriquecidos = 0;
  {
    const porProd = new Map();
    for (const c of cards) {
      const k = productoKey(c);
      if (!porProd.has(k)) porProd.set(k, []);
      porProd.get(k).push(c);
    }
    for (const lista of porProd.values()) {
      const porNombre = new Map();
      for (const c of lista) for (const f of c.archivosNorm) if (f.n && !porNombre.has(f.n)) porNombre.set(f.n, f);
      for (const c of lista) {
        const ws = Array.isArray(c.winners) ? c.winners : [];
        let cambio = false;
        const reparados = ws.map(w => {
          if (!w || w.link || w.driveId) return w;
          const f = porNombre.get(norm(w.name));
          if (!f || (!f.driveId && !f.link)) return w;
          cambio = true; enriquecidos++;
          return { ...w, driveId: f.driveId || null, link: f.link || null };
        });
        if (cambio) {
          c.winners = reparados;
          try {
            await svc.from(TABLE).update({ winners: reparados, updated_at: new Date().toISOString() }).eq('id', c.id);
          } catch {}
        }
      }
    }
  }

  // Ads con gasto en la ventana, de todas las cuentas configuradas.
  const ads = [];
  const cuentasOk = [], cuentasError = [];
  for (const acc of accounts) {
    try { ads.push(...await adsDeCuenta(acc, conn.token, cfg.ventanaDias)); cuentasOk.push(acc); }
    catch (e) { cuentasError.push({ cuenta: acc, error: e.message }); }
  }

  // Matching: cada ad busca SU archivo. Exacto gana a prefijo; a igual score,
  // la tarjeta más nueva (las cards vienen ordenadas desc).
  const porCard = new Map(); // cardId -> Map(archivoNorm -> acumulado)
  for (const ad of ads) {
    const an = norm(ad.adName);
    if (an.length < 6) continue;
    let best = null;
    for (const card of cards) {
      for (const f of card.archivosNorm) {
        if (an === f.n) { best = { card, f, score: 2 }; break; }
        if (!best && f.n.length >= 8 && (an.startsWith(f.n) || f.n.startsWith(an))) best = { card, f, score: 1 };
      }
      if (best?.score === 2) break;
    }
    if (!best) continue;
    if (!porCard.has(best.card.id)) porCard.set(best.card.id, new Map());
    const m = porCard.get(best.card.id);
    const slot = m.get(best.f.n) || {
      archivoName: best.f.name, driveId: best.f.driveId || null, link: best.f.link || null,
      spend: 0, compras: 0, revenue: 0, adIds: [],
    };
    slot.spend += ad.spend; slot.compras += ad.compras; slot.revenue += ad.revenue;
    slot.adIds.push(ad.adId);
    m.set(best.f.n, slot);
  }

  // Evaluación por tarjeta (la tanda) y agrupado por producto.
  const hoy = new Date();
  const fechaStr = `${hoy.getDate()}/${hoy.getMonth() + 1}`;
  const porProducto = new Map(); // productoKey -> { producto_id, producto_nombre, recs: [] }
  for (const card of cards) {
    const m = porCard.get(card.id);
    if (!m) continue;
    const items = [...m.values()];
    const top = items.slice().sort((a, b) => b.compras - a.compras)[0];
    for (const it of items) {
      const roas = it.spend > 0 ? it.revenue / it.spend : 0;
      const regA = it.compras >= cfg.minCompras && roas >= cfg.minRoas;
      const regB = it === top && it.compras >= cfg.topMin;
      if (!regA && !regB) continue;
      const k = productoKey(card);
      if (!porProducto.has(k)) porProducto.set(k, { producto_id: card.producto_id, producto_nombre: card.producto_nombre, recs: [] });
      const g = porProducto.get(k);
      if (g.recs.some(r => winnerKey(r) === it.archivoName.trim().toLowerCase())) continue;
      g.recs.push({
        name: it.archivoName, link: it.link || null, driveId: it.driveId || null,
        fecha: fechaStr, ts: Date.now(),
        auto: true,
        compras: it.compras,
        roas: Math.round(roas * 100) / 100,
        ...(roas < DEF.bep ? { warn: true } : {}),
      });
    }
  }

  // Escritura: por la RPC produccion_winners_apply — el server RE-LEE los
  // winners actuales con lock y mergea (auditoría #3: entre nuestra lectura de
  // tarjetas y este punto pasaron minutos de consultas a Meta; escribir el
  // array computado con esa lectura vieja pisaba marcados manuales del medio).
  // El dedup local de acá abajo es solo para el REPORTE (qué es realmente
  // nuevo); la escritura deduplica de nuevo en el server.
  const marcados = [];
  for (const g of porProducto.values()) {
    const delProducto = cards.filter(c => productoKey(c) === productoKey(g));
    const existentes = new Map(); // key -> rec (el más nuevo primero)
    for (const c of delProducto) {
      for (const w of (Array.isArray(c.winners) ? c.winners : [])) {
        const k = winnerKey(w);
        if (k && !existentes.has(k)) existentes.set(k, w);
      }
    }
    const nuevos = g.recs.filter(r => !existentes.has(winnerKey(r)));
    if (!nuevos.length) continue;
    let escrito = false;
    try {
      const { error } = await svc.rpc('produccion_winners_apply', {
        p_producto_id: g.producto_id != null ? String(g.producto_id) : null,
        p_producto_nombre: g.producto_nombre || '',
        p_add: nuevos,
        p_remove: [],
        p_owner: ownerId,
      });
      escrito = !error;
      if (error) console.warn('[auto-winners] rpc winners_apply:', error.message);
    } catch (e) { console.warn('[auto-winners] rpc winners_apply:', e.message); }
    if (!escrito) {
      // Fallback (base sin la migración 0041): el camino viejo, fila por fila.
      const final = [...nuevos, ...existentes.values()];
      for (const c of delProducto) {
        try {
          await svc.from(TABLE)
            .update({ winners: final, updated_at: new Date().toISOString() })
            .eq('id', c.id);
        } catch {}
      }
    }
    marcados.push({
      producto: g.producto_nombre || g.producto_id,
      nuevos: nuevos.map(n => ({ name: n.name, compras: n.compras, roas: n.roas, warn: !!n.warn })),
    });
  }

  // Productos con tarjetas recientes (45 días) SIN un solo ad matcheado:
  // quedan manuales, y lo decimos para que no parezca que se los salteó.
  const corte = Date.now() - 45 * 86400000;
  const conData = new Set([...porCard.keys()]);
  const sinData = [...new Map(
    cards
      .filter(c => new Date(c.created_at).getTime() > corte && !conData.has(c.id))
      .filter(c => ![...porCard.keys()].some(id => {
        const other = cards.find(x => x.id === id);
        return other && productoKey(other) === productoKey(c);
      }))
      .map(c => [productoKey(c), c.producto_nombre || c.producto_id]),
  ).values()];

  if (marcados.length) await avisarDiscord(svc, ownerId, marcados, cfg);

  return {
    ok: true,
    marcados,
    enriquecidos,
    sinData,
    adsAnalizados: ads.length,
    tarjetasConData: porCard.size,
    cuentas: { ok: cuentasOk, errores: cuentasError },
    criterio: cfg,
  };
}

// ── Handler HTTP (botón de Métricas) ─────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado' });

  let body = req.body;
  if (!body || typeof body !== 'object') {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch { body = {}; }
  }

  try {
    // La corrida manual es DEL usuario logueado: su config, su token, sus tarjetas.
    const out = await correrAutoWinners({ extraAccountId: body?.accountId || null, ownerId: userId });
    return respondJSON(res, 200, out);
  } catch (e) {
    return respondJSON(res, 500, { error: e.message });
  }
}
