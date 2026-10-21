// Avisos de salud de la conexión de META: mail (Resend) + Discord.
//
// Dos tipos de aviso:
//   1. CAÍDA: un llamado a Graph falló con token inválido/vencido (code 190 /
//      102) → "Meta se desconectó, reconectá". Edge-trigger + cooldown de 6h
//      (estado en integration_health, fila 'meta'). Se resetea al reconectar
//      (callback OAuth o token pegado OK).
//   2. PREVENTIVO: el token dura ~60 días; a los ~53 días de la conexión
//      guardada avisamos "vence el DD/MM, reconectá cuando puedas". Una sola
//      vez por token (warned_at se compara contra el updated_at de la conexión).
//
// Mismo patrón que api/produccion/_drive-alert.js (el aviso de Drive caído).

import { getServiceClient } from '../marketing/_supabase-server.js';

const COOLDOWN_MS = 6 * 60 * 60 * 1000;      // caída: no repetir por 6h
const TOKEN_DIAS = 60;                        // vida útil aprox del long-lived token
const WARN_A_LOS_DIAS = 53;                   // aviso preventivo (7 días antes)

async function getHealth(svc) {
  try {
    const { data } = await svc.from('integration_health').select('*').eq('integration', 'meta').maybeSingle();
    return data || null;
  } catch { return null; }
}

async function setHealth(svc, patch) {
  try {
    await svc.from('integration_health').upsert(
      { integration: 'meta', ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'integration' },
    );
  } catch {}
}

// A dónde va el mail: override por env, o el gmail del dueño (el que conectó
// el Drive — mismo fallback que el aviso de Drive).
async function recipient(svc) {
  const env = String(process.env.META_ALERT_EMAIL || process.env.DRIVE_ALERT_EMAIL || '').trim();
  if (env) return env;
  try {
    const { data } = await svc.from('google_oauth').select('email').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    return data?.email || null;
  } catch { return null; }
}

function isDiscordWebhook(u) {
  return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(String(u || '').trim());
}

async function resolveWebhook(svc) {
  const env = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (isDiscordWebhook(env)) return env;
  try {
    const { data } = await svc.from('produccion_notif_config').select('config').limit(1).maybeSingle();
    const ev = data?.config?.eventos || data?.config?.estados || {};
    for (const k of Object.keys(ev)) {
      const w = String(ev[k]?.webhook || '').trim();
      if (isDiscordWebhook(w)) return w;
    }
  } catch {}
  return null;
}

async function sendDiscord(url, { titulo, detalle }) {
  try {
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Kombialo · Meta',
        embeds: [{
          title: titulo,
          description: detalle,
          color: 0xF59E0B,
          fields: [{ name: 'Qué hacer', value: 'Entrá a Kombialo → **Arranque → Cuenta Meta → Conectar** (30 segundos).', inline: false }],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch {}
}

async function sendEmail(to, { asunto, titulo, detalle }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM || 'Laboratorio Viora <onboarding@resend.dev>';
  if (!key || !to) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to, subject: asunto,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222">
            <h2 style="color:#b45309;margin:0 0 12px">${titulo}</h2>
            <p>${detalle}</p>
            <p>Para arreglarlo: <b>Kombialo → Arranque → Cuenta Meta → Conectar</b> (30 segundos, con tu login de Facebook).</p>
            <p style="font-size:12px;color:#888">Mientras esté desconectado no funcionan: métricas de campañas, performance de ads y "Winners desde Meta".</p>
          </div>`,
      }),
    });
  } catch {}
}

// CAÍDA del token (Graph devolvió code 190/102). Edge-trigger + cooldown.
export async function alertMetaDown(motivo = '') {
  const svc = getServiceClient();
  if (!svc) return;
  const h = await getHealth(svc);
  const now = Date.now();
  const lastMs = h?.alert_at ? new Date(h.alert_at).getTime() : 0;
  if (h?.down && lastMs && (now - lastMs) < COOLDOWN_MS) return; // ya avisado hace poco
  const [to, webhook] = await Promise.all([recipient(svc), resolveWebhook(svc)]);
  const titulo = '⚠️ La conexión de Meta se desconectó';
  const detalle = `El token de Meta de Kombialo dejó de funcionar${motivo ? ` (${String(motivo).slice(0, 140)})` : ''}. Suele pasar al vencer (~60 días) o si cambió la contraseña de Facebook.`;
  await Promise.allSettled([
    webhook ? sendDiscord(webhook, { titulo, detalle }) : Promise.resolve(),
    to ? sendEmail(to, { asunto: '⚠️ Meta se desconectó de Kombialo', titulo, detalle }) : Promise.resolve(),
  ]);
  await setHealth(svc, { down: true, alert_at: new Date().toISOString() });
}

// Reconexión OK (callback OAuth o token pegado) → resetea el flag para que un
// corte futuro vuelva a avisar.
export async function markMetaHealthy() {
  const svc = getServiceClient();
  if (!svc) return;
  const h = await getHealth(svc);
  if (h?.down) await setHealth(svc, { down: false });
}

// Aviso PREVENTIVO de vencimiento. Corre del cron diario: si la conexión
// guardada más nueva tiene ≥53 días y todavía no avisamos por ESE token,
// manda el aviso. Devuelve un resumen para el log del cron.
export async function warnMetaExpiryIfDue() {
  const svc = getServiceClient();
  if (!svc) return { skipped: 'sin-supabase' };
  let conn = null;
  try {
    const { data } = await svc.from('meta_connections').select('updated_at, meta_user_name').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    conn = data || null;
  } catch {}
  if (!conn?.updated_at) return { skipped: 'sin-conexion' };

  const updatedMs = new Date(conn.updated_at).getTime();
  const edadDias = (Date.now() - updatedMs) / 86400000;
  if (edadDias < WARN_A_LOS_DIAS) return { skipped: 'token-joven', edadDias: Math.round(edadDias) };

  const h = await getHealth(svc);
  // Ya avisamos por ESTE token (warned_at posterior a la conexión) → nada.
  if (h?.warned_at && new Date(h.warned_at).getTime() > updatedMs) return { skipped: 'ya-avisado' };

  const vence = new Date(updatedMs + TOKEN_DIAS * 86400000);
  const venceStr = vence.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
  const [to, webhook] = await Promise.all([recipient(svc), resolveWebhook(svc)]);
  const titulo = '⏳ La conexión de Meta vence pronto';
  const detalle = `El token de Meta de Kombialo (conexión de ${conn.meta_user_name || 'la cuenta'}) vence aproximadamente el ${venceStr}. Reconectá antes así no se corta nada.`;
  await Promise.allSettled([
    webhook ? sendDiscord(webhook, { titulo, detalle }) : Promise.resolve(),
    to ? sendEmail(to, { asunto: `⏳ La conexión de Meta vence el ${venceStr} — reconectá`, titulo, detalle }) : Promise.resolve(),
  ]);
  await setHealth(svc, { warned_at: new Date().toISOString() });
  return { warned: true, venceEl: venceStr };
}
