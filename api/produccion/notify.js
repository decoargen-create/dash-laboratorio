// Producción — avisa a un canal de Discord cuando una tarjeta cambia de columna.
//
// "Un canal del equipo": el webhook se configura UNA vez como variable de
// entorno DISCORD_WEBHOOK_URL en Vercel. Cuando alguien (admin o editor) mueve
// una tarjeta de estado, el front pega a este endpoint y nosotros posteamos un
// embed lindo (color según el estado) al webhook. Los bytes van server→Discord
// (sin CORS), y la URL nunca se expone al browser.
//
// POST { productoNombre, persona, from, to, actor }  → avisa el cambio.
// POST { probe:true }  → manda un mensaje de PRUEBA (para verificar la conexión).
//   Respuestas: { sent:true } | { sent:false, reason } | { sent:false, error }
//
// Si no hay webhook configurado, { sent:false, reason:'no-webhook' } (no es un
// error: la app funciona igual, solo no avisa).

import { getUserIdFromAuth, getServiceClient } from '../marketing/_supabase-server.js';

// Estados que se notifican + su presentación (color Discord decimal + emoji).
// "porhacer" no se notifica (volver atrás no amerita aviso).
const ESTADO_META = {
  revision:  { label: 'En revisión', color: 0xF59E0B, emoji: '👀' },
  aprobado:  { label: 'Aprobado',    color: 0x10B981, emoji: '✅' },
  publicado: { label: 'Publicado',   color: 0x8B5CF6, emoji: '🚀' },
};

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// Convierte el string de menciones ("123, &456") en tokens de Discord
// ("<@123> <@&456>"). Un id con prefijo "&" es un ROL. Ignora lo no numérico.
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

// Config de notificaciones del dueño de la tarjeta (service-role, bypassa RLS).
// Devuelve el objeto config o null si no hay (→ default: todo prendido, sin @).
async function getNotifConfig(cardId) {
  try {
    const svc = getServiceClient();
    if (!svc || !cardId) return null;
    const { data: asig } = await svc.from('produccion_asignaciones').select('owner_id').eq('id', cardId).maybeSingle();
    const ownerId = asig?.owner_id;
    if (!ownerId) return null;
    const { data } = await svc.from('produccion_notif_config').select('config').eq('owner_id', ownerId).maybeSingle();
    return data?.config || null;
  } catch { return null; }
}

// Postea al webhook. `content` (opcional) lleva las @menciones (solo pingean
// desde content, no desde el embed). Devuelve { sent } o { sent:false, error }.
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

  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return respondJSON(res, 200, { sent: false, reason: 'no-webhook' });

  // Prueba de conexión (botón "Probar Discord").
  if (body.probe) {
    const out = await postDiscord(url, {
      title: '🔔 Prueba de conexión',
      description: 'Si ves esto, los avisos de Producción están conectados. 🎬',
      color: 0xEC4899,
      timestamp: new Date().toISOString(),
    });
    return respondJSON(res, out.sent ? 200 : 502, out);
  }

  const meta = ESTADO_META[body.to];
  if (!meta) return respondJSON(res, 200, { sent: false, reason: 'estado-no-notificable' });

  // Config del dueño: si este estado está apagado, no avisamos. Sin config →
  // default (todo prendido, sin menciones).
  const cfg = await getNotifConfig(body.cardId);
  const estCfg = cfg?.estados?.[body.to];
  if (estCfg && estCfg.on === false) return respondJSON(res, 200, { sent: false, reason: 'estado-apagado' });
  const menciones = parseMentions(estCfg?.mentions);

  const prod = String(body.productoNombre || 'Producto').slice(0, 240);
  const per = String(body.persona || '').trim().slice(0, 80);
  const who = String(body.actor || '').trim().slice(0, 80);

  const fields = [];
  if (per) fields.push({ name: 'Persona', value: per, inline: true });
  if (who) fields.push({ name: 'Movió', value: who, inline: true });

  const out = await postDiscord(url, {
    title: `${meta.emoji} ${prod}`,
    description: `Pasó a **${meta.label}**`,
    color: meta.color,
    fields,
    timestamp: new Date().toISOString(),
  }, menciones);
  return respondJSON(res, out.sent ? 200 : 502, out);
}
