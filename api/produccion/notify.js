// Producción — avisos de Discord por EVENTO, cada uno a su propio canal.
//
// El dueño configura (desde la app, tabla produccion_notif_config) para cada
// evento: si avisa, a qué canal (webhook) y a quién @mencionar. Eventos:
//   - nuevo     → se creó una tarjeta/producto
//   - revision  → una tarjeta pasó a "En revisión"
//   - aprobado  → una tarjeta pasó a "Aprobado" (lista para publicar)
//   - publicado → una tarjeta pasó a "Publicado"
//
// Si un evento no tiene webhook propio, cae al global DISCORD_WEBHOOK_URL (env).
// Los bytes van server→Discord (sin CORS) y las URLs nunca se exponen al browser
// de un editor (la config la lee solo el server por service-role, o el dueño por
// RLS).
//
// POST { event, cardId, productoNombre, persona, from, to, actor }  → avisa.
// POST { probe:true, webhooks:[...] }  → manda un test a cada webhook.

import { getUserIdFromAuth, getServiceClient } from '../marketing/_supabase-server.js';

// Presentación por evento (color Discord decimal + emoji + frase).
const EVENT_META = {
  nuevo:     { color: 0x3B82F6, emoji: '🆕', desc: 'Nuevo producto para producir' },
  revision:  { color: 0xF59E0B, emoji: '👀', desc: 'Pasó a **En revisión**' },
  aprobado:  { color: 0x10B981, emoji: '✅', desc: 'Listo para publicar (**Aprobado**)' },
  publicado: { color: 0x8B5CF6, emoji: '🚀', desc: 'Pasó a **Publicado**' },
};

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// "123, &456" → "<@123> <@&456>" (un id con "&" es un rol). Ignora lo no numérico.
function parseMentions(str) {
  const out = [];
  for (const raw of String(str || '').split(/[\s,]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    if (tok[0] === '&' && /^\d+$/.test(tok.slice(1))) out.push(`<@&${tok.slice(1)}>`);
    else if (/^\d+$/.test(tok)) out.push(`<@${tok}>`);
  }
  return out.join(' ');
}

// Config de avisos del dueño de la tarjeta (service-role, bypassa RLS). Soporta
// el shape nuevo { eventos:{...} } y el viejo { estados:{...} }. Null si no hay.
async function getEventosConfig(cardId) {
  try {
    const svc = getServiceClient();
    if (!svc || !cardId) return null;
    const { data: asig } = await svc.from('produccion_asignaciones').select('owner_id').eq('id', cardId).maybeSingle();
    const ownerId = asig?.owner_id;
    if (!ownerId) return null;
    const { data } = await svc.from('produccion_notif_config').select('config').eq('owner_id', ownerId).maybeSingle();
    return data?.config?.eventos || data?.config?.estados || null;
  } catch { return null; }
}

// Postea un embed (con menciones opcionales en content) a UN webhook.
async function postDiscord(url, embed, content) {
  try {
    const payload = { username: 'AdsLab · Producción', embeds: [embed] };
    if (content) { payload.content = content; payload.allowed_mentions = { parse: ['users', 'roles'] }; }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { sent: false, error: `Discord ${r.status}: ${t.slice(0, 140)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const envWebhook = process.env.DISCORD_WEBHOOK_URL || '';

  // ── Prueba: manda un test a cada webhook cargado (o al global si no pasan). ──
  if (body.probe) {
    const urls = [...new Set((Array.isArray(body.webhooks) ? body.webhooks : [])
      .map(u => String(u || '').trim())
      .filter(u => /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(u)))];
    if (urls.length === 0 && envWebhook) urls.push(envWebhook);
    if (urls.length === 0) return respondJSON(res, 200, { sent: false, reason: 'no-webhook' });
    const embed = { title: '🔔 Prueba de conexión', description: 'Si ves esto, este canal está conectado a Producción. 🎬', color: 0xEC4899, timestamp: new Date().toISOString() };
    const results = await Promise.all(urls.map(u => postDiscord(u, embed)));
    const okCount = results.filter(r => r.sent).length;
    const errors = results.filter(r => !r.sent).map(r => r.error);
    return respondJSON(res, okCount > 0 ? 200 : 502, { sent: okCount, total: urls.length, errors });
  }

  // ── Aviso de evento ──
  const event = body.event || body.to;   // compat: `to` cuando no viene `event`
  const meta = EVENT_META[event];
  if (!meta) return respondJSON(res, 200, { sent: false, reason: 'evento-no-notificable' });

  const eventos = await getEventosConfig(body.cardId);
  const evCfg = eventos?.[event];
  if (evCfg && evCfg.on === false) return respondJSON(res, 200, { sent: false, reason: 'evento-apagado' });

  // Canal: el propio del evento, o el global como fallback.
  const url = (evCfg?.webhook && String(evCfg.webhook).trim()) || envWebhook;
  if (!url) return respondJSON(res, 200, { sent: false, reason: 'no-webhook' });

  const menciones = parseMentions(evCfg?.mentions);
  const prod = String(body.productoNombre || 'Producto').slice(0, 240);
  const per = String(body.persona || '').trim().slice(0, 80);
  const who = String(body.actor || '').trim().slice(0, 80);

  const fields = [];
  if (per) fields.push({ name: 'Persona', value: per, inline: true });
  if (who) fields.push({ name: event === 'nuevo' ? 'Creó' : 'Movió', value: who, inline: true });

  const out = await postDiscord(url, {
    title: `${meta.emoji} ${prod}`,
    description: meta.desc,
    color: meta.color,
    fields,
    timestamp: new Date().toISOString(),
  }, menciones);
  return respondJSON(res, out.sent ? 200 : 502, out);
}
