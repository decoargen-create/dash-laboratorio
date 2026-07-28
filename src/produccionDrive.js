// Cliente de la conexión de Google Drive (OAuth) para Producción.
// Solo un admin conecta/desconecta; el token vive en el server.

import { supabase } from './supabase.js';

async function authHeaders() {
  const base = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const t = session?.access_token;
    return t ? { ...base, Authorization: `Bearer ${t}` } : base;
  } catch { return base; }
}

// { connected, email, configured } — configured=false si faltan las env vars.
export async function driveStatus() {
  try {
    const r = await fetch('/api/produccion/google-oauth', {
      method: 'POST', headers: await authHeaders(), body: JSON.stringify({ action: 'status' }),
    });
    return await r.json().catch(() => ({ connected: false }));
  } catch { return { connected: false }; }
}

export async function disconnectDrive() {
  const r = await fetch('/api/produccion/google-oauth', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ action: 'disconnect' }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// Abre el consentimiento de Google en un popup. Resuelve true si conectó,
// 'closed' si cerraron sin terminar. El token de sesión va en la URL porque
// una navegación no lleva headers.
export async function connectDrive() {
  let token = '';
  try { const { data: { session } } = await supabase.auth.getSession(); token = session?.access_token || ''; } catch {}
  const url = `/api/produccion/google-oauth?action=start&token=${encodeURIComponent(token)}`;
  const w = 520, h = 640;
  const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
  const popup = window.open(url, 'drive-oauth', `width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) { window.location.href = url; return 'redirect'; }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; cleanup(); resolve(v); };
    const onMsg = (e) => { if (e.data?.source === 'adslab-drive-oauth') finish(!!e.data.ok); };
    const iv = setInterval(() => { if (popup.closed) finish('closed'); }, 700);
    function cleanup() { window.removeEventListener('message', onMsg); clearInterval(iv); }
    window.addEventListener('message', onMsg);
  });
}
