// Producción — avisa a un canal de Discord cuando una tarjeta cambia de columna.
//
// "Un canal del equipo": el webhook se configura UNA vez como variable de
// entorno DISCORD_WEBHOOK_URL en Vercel. Cuando alguien (admin o editor) mueve
// una tarjeta de estado, el front pega a este endpoint y nosotros posteamos un
// embed lindo (color según el estado) al webhook. Los bytes van server→Discord
// (sin CORS), y la URL nunca se expone al browser.
//
// POST { productoNombre, persona, from, to, actor }
//   → { sent:true } | { sent:false, reason } | { error }
//
// Si no hay webhook configurado, respondemos { sent:false, reason:'no-webhook' }
// (no es un error: la app funciona igual, solo no avisa).

import { getUserIdFromAuth } from '../marketing/_supabase-server.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return respondJSON(res, 200, { sent: false, reason: 'no-webhook' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const meta = ESTADO_META[body.to];
  if (!meta) return respondJSON(res, 200, { sent: false, reason: 'estado-no-notificable' });

  const prod = String(body.productoNombre || 'Producto').slice(0, 240);
  const per = String(body.persona || '').trim().slice(0, 80);
  const who = String(body.actor || '').trim().slice(0, 80);

  const fields = [];
  if (per) fields.push({ name: 'Persona', value: per, inline: true });
  if (who) fields.push({ name: 'Movió', value: who, inline: true });

  const payload = {
    username: 'AdsLab · Producción',
    embeds: [{
      title: `${meta.emoji} ${prod}`,
      description: `Pasó a **${meta.label}**`,
      color: meta.color,
      fields,
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return respondJSON(res, 502, { sent: false, error: `Discord ${r.status}: ${t.slice(0, 140)}` });
    }
    return respondJSON(res, 200, { sent: true });
  } catch (e) {
    return respondJSON(res, 502, { sent: false, error: e.message });
  }
}
