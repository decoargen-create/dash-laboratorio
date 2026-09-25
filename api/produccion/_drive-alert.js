// Avisos cuando el Drive se cae / desconecta: mail (Resend) + Discord.
//
// Por qué: el permiso de Google vence o lo revocan (típico con la app en modo
// "Testing" → 7 días) y las subidas fallan EN SILENCIO hasta que alguien lo
// nota. Acá avisamos apenas se detecta, por los dos canales.
//
// Dedup: guardamos la salud en columnas de google_oauth (drive_down,
// drive_alert_at). Edge-trigger + cooldown: solo avisamos al pasar de OK→caído,
// y no repetimos por COOLDOWN_MS aunque siga caído. markDriveHealthy() resetea
// el flag cuando vuelve a andar, para que un corte futuro re-avise.

import { getServiceClient } from '../marketing/_supabase-server.js';

const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h — no repetir el aviso si sigue caído

const REASON_TEXT = {
  'permiso-vencido': 'El permiso de Google venció o fue revocado. Las subidas de video a Drive NO están funcionando.',
  'manual': 'Se desconectó Drive manualmente desde AdsLab.',
};

function isDiscordWebhook(u) {
  return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(String(u || '').trim());
}

// Fila de conexión más reciente (mismo orden que getGoogleOAuth).
async function getConnRow(svc) {
  try {
    const { data } = await svc.from('google_oauth')
      .select('id,email,drive_down,drive_alert_at,updated_at')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    return data || null;
  } catch { return null; }
}

async function setHealth(svc, id, patch) {
  if (!id) return;
  try { await svc.from('google_oauth').update(patch).eq('id', id); } catch {}
}

// A dónde mandar el mail: override por env, o el gmail de la conexión (que es el
// del propio dueño — el que conectó su Drive).
function recipient(connEmail) {
  const env = String(process.env.DRIVE_ALERT_EMAIL || '').trim();
  return env || connEmail || null;
}

// Webhook de Discord: el global por env, o el primero que haya en la config de
// notif del dueño (reusamos el canal que ya usa Producción).
async function resolveWebhook(svc, ownerId) {
  const env = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (isDiscordWebhook(env)) return env;
  if (!ownerId) return null;
  try {
    const { data } = await svc.from('produccion_notif_config').select('config').eq('owner_id', ownerId).maybeSingle();
    const ev = data?.config?.eventos || data?.config?.estados || {};
    for (const k of Object.keys(ev)) {
      const w = String(ev[k]?.webhook || '').trim();
      if (isDiscordWebhook(w)) return w;
    }
  } catch {}
  return null;
}

async function sendDiscord(url, reason) {
  const embed = {
    title: '⚠️ Drive desconectado',
    description: REASON_TEXT[reason] || 'El Drive de AdsLab dejó de funcionar.',
    color: 0xEF4444,
    fields: [{
      name: 'Qué hacer',
      value: 'Entrá a **Producción → Ajustes → Reconectar Drive** para que las subidas de video vuelvan a funcionar.',
      inline: false,
    }],
    timestamp: new Date().toISOString(),
  };
  try {
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'AdsLab · Drive', embeds: [embed] }),
    });
  } catch {}
}

async function sendEmail(to, reason) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM || 'Laboratorio Viora <onboarding@resend.dev>';
  if (!key || !to) return;
  const detalle = REASON_TEXT[reason] || 'El Drive de AdsLab dejó de funcionar.';
  const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
  const link = appUrl ? `${appUrl}` : '';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to,
        subject: '⚠️ El Drive de AdsLab se desconectó',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222">
            <h2 style="color:#b91c1c;margin:0 0 12px">⚠️ Drive desconectado</h2>
            <p>${detalle}</p>
            <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;color:#7f1d1d;font-size:14px">
              Mientras esté caído, los editores <b>no pueden subir videos</b> a Drive.
            </p>
            <p>Para arreglarlo entrá a <b>Producción → Ajustes → Reconectar Drive</b>.</p>
            ${link ? `<p style="text-align:center;margin:24px 0">
              <a href="${link}" style="display:inline-block;background:#e11d48;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Abrir AdsLab</a>
            </p>` : ''}
            <p style="font-size:12px;color:#888">Este aviso se manda una vez; si el Drive sigue caído no te lo repetimos por unas horas.</p>
          </div>`,
      }),
    });
  } catch {}
}

// Drive caído (involuntario: permiso vencido/revocado). Edge-trigger + cooldown.
export async function alertDriveDown(reason = 'permiso-vencido') {
  const svc = getServiceClient();
  if (!svc) return;
  const row = await getConnRow(svc);
  if (!row) return; // sin conexión guardada → no hay nada que se "haya caído"
  const now = Date.now();
  const lastMs = row.drive_alert_at ? new Date(row.drive_alert_at).getTime() : 0;
  if (row.drive_down && lastMs && (now - lastMs) < COOLDOWN_MS) return; // ya avisamos hace poco
  const to = recipient(row.email);
  const webhook = await resolveWebhook(svc, row.id);
  await Promise.allSettled([
    webhook ? sendDiscord(webhook, reason) : Promise.resolve(),
    to ? sendEmail(to, reason) : Promise.resolve(),
  ]);
  await setHealth(svc, row.id, { drive_down: true, drive_alert_at: new Date().toISOString() });
}

// Drive volvió a funcionar → reseteamos el flag (solo si estaba marcado caído)
// para que un corte futuro vuelva a avisar.
export async function markDriveHealthy() {
  const svc = getServiceClient();
  if (!svc) return;
  const row = await getConnRow(svc);
  if (row && row.drive_down) await setHealth(svc, row.id, { drive_down: false });
}

// Desconexión MANUAL desde la app (acción discreta) → avisamos una vez. La fila
// se borra al desconectar, así que recibimos email + ownerId de antes.
export async function alertDriveManualDisconnect(connEmail, ownerId) {
  const svc = getServiceClient();
  if (!svc) return;
  const to = recipient(connEmail);
  const webhook = await resolveWebhook(svc, ownerId);
  await Promise.allSettled([
    webhook ? sendDiscord(webhook, 'manual') : Promise.resolve(),
    to ? sendEmail(to, 'manual') : Promise.resolve(),
  ]);
}
