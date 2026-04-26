// Webhook de Discord para reportar el run del Meta Ads Publisher.
//
// Diseño: SIEMPRE manda mensaje, publique algo o no. Texto markdown (sin
// imagen PNG por ahora — el dashboard gráfico se puede sumar después si vale
// el esfuerzo).
//
// Limit de Discord: 2000 chars en `content`. Si nos pasamos, partimos en
// chunks (raro) o cortamos.

const HORAS_AR = ['04', '10', '16', '22'];

/**
 * Devuelve la "hora ART" más cercana al run actual en formato HH:00.
 * Útil para los mensajes "sin novedades en este run de las {hora}".
 */
export function currentRunHourAR() {
  const now = new Date();
  const arMs = now.getTime() - 3 * 60 * 60 * 1000;
  const ar = new Date(arMs);
  const hh = String(ar.getUTCHours()).padStart(2, '0');
  return `${hh}:00`;
}

/**
 * @param {string} content - mensaje markdown
 */
async function postWebhook(content) {
  const url = process.env.META_PUBLISHER_DISCORD_WEBHOOK;
  if (!url) {
    console.warn('[meta-publisher] META_PUBLISHER_DISCORD_WEBHOOK no seteada — skipeando reporte');
    return { ok: false, skipped: true };
  }
  const safe = String(content).slice(0, 1900);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: safe,
      allowed_mentions: { parse: [] },
    }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.error('[meta-publisher] Discord webhook falló', r.status, txt.slice(0, 300));
    return { ok: false, status: r.status };
  }
  return { ok: true };
}

/**
 * Reporte cuando NO se publicó nada en este run.
 */
export async function reportEmptyRun({ reason, hour }) {
  const h = hour || currentRunHourAR();
  const motivo = reason ? ` _(${reason})_` : '';
  return postWebhook(`✅ **Meta Ads Publisher — ${h} ART**: sin campañas nuevas para publicar en este run${motivo}.`);
}

/**
 * Reporte cuando hubo un fallo crítico antes de iterar carpetas (ej: folder
 * del mes no existe, drive auth, etc.).
 */
export async function reportFatalError({ message, hour, hint }) {
  const h = hour || currentRunHourAR();
  const tail = hint ? `\n💡 ${hint}` : '';
  return postWebhook(`🚨 **Meta Ads Publisher — ${h} ART**: error crítico\n\`\`\`\n${String(message).slice(0, 1500)}\n\`\`\`${tail}`);
}

/**
 * Reporte detallado del run con publicaciones.
 *
 * @param {{
 *   hour: string,
 *   adAccountId: string,
 *   published: Array<{
 *     product: string,
 *     source: 'Videos'|'Estaticos',
 *     folder_name: string,
 *     campaign_id: string,
 *     adset_id: string,
 *     ad_count: number,
 *     daily_budget_cents: number,
 *     status: 'ACTIVE'|'PARTIAL'|'FAILED',
 *     warnings?: string[]
 *   }>,
 *   skipped: Array<{ folder_name: string, reason: string }>,
 * }} payload
 */
export async function reportRun({ hour, adAccountId, published, skipped }) {
  const h = hour || currentRunHourAR();
  const lines = [];
  const totalAds = published.reduce((s, p) => s + (p.ad_count || 0), 0);
  const totalBudget = published.reduce((s, p) => s + (p.daily_budget_cents || 0), 0);
  const allActive = published.every(p => p.status === 'ACTIVE');

  lines.push(`${allActive ? '✅' : '⚠️'} **Meta Ads Publisher — ${h} ART**`);
  lines.push(`📦 ${published.length} campaña(s) publicada(s) · ${totalAds} ad(s) · daily budget total: $${(totalBudget / 100).toFixed(2)} USD`);
  lines.push('');

  for (const p of published) {
    const icon = p.status === 'ACTIVE' ? '🟢' : p.status === 'PARTIAL' ? '🟡' : '🔴';
    lines.push(`${icon} **${p.product} ${p.source}** · ${p.ad_count} ads · $${(p.daily_budget_cents / 100).toFixed(2)}/día`);
    lines.push(`   📁 \`${p.folder_name}\``);
    lines.push(`   campaign_id: \`${p.campaign_id}\``);
    if (p.warnings?.length) {
      for (const w of p.warnings) lines.push(`   ⚠️ ${w}`);
    }
  }

  if (skipped?.length) {
    lines.push('');
    lines.push(`⏭️ **Skipped** (${skipped.length}):`);
    for (const s of skipped) lines.push(`   • \`${s.folder_name}\` — ${s.reason}`);
  }

  if (adAccountId) {
    const accId = adAccountId.replace(/^act_/, '');
    lines.push('');
    lines.push(`🔗 Ads Manager: https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accId}`);
  }

  return postWebhook(lines.join('\n'));
}

export { postWebhook };
