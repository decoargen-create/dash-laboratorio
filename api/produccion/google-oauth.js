// Conexión de Google Drive por OAuth (para subir a un Drive personal @gmail).
//
// Flujo:
//   GET  ?action=start&token=<jwt>   → redirige a la pantalla de consentimiento
//        de Google. El JWT del admin va firmado dentro del `state` (CSRF + bind).
//   GET  ?action=callback&code&state → Google vuelve acá; canjeamos el code por
//        el refresh_token, lo guardamos cifrado y cerramos el popup.
//   POST { action:'status' }         → { connected, email }.
//   POST { action:'disconnect' }     → borra la conexión.
//
// Solo un admin puede conectar/desconectar. El token es lab-wide: todas las
// subidas (admin o creator) van al Drive de la cuenta conectada.

import crypto from 'node:crypto';
import { getUserIdFromAuth, getUserRole, saveGoogleOAuth, getGoogleOAuth, deleteGoogleOAuth } from '../marketing/_supabase-server.js';
import { oauthConfigured, oauthConsentUrl, oauthExchangeCode } from '../actas/_google.js';

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}
function respondHTML(res, status, html) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}
function closePopup(res, ok, msg) {
  respondHTML(res, 200, `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#0e1424;color:#e9edf7;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center">
  <div style="font-size:40px">${ok ? '✅' : '⚠️'}</div>
  <p>${msg}</p>
  <p style="color:#93a0bd;font-size:13px">Podés cerrar esta ventana.</p>
</div>
<script>try{window.opener&&window.opener.postMessage({source:'adslab-drive-oauth',ok:${ok ? 'true' : 'false'}},'*')}catch(e){}; setTimeout(function(){try{window.close()}catch(e){}}, ${ok ? 1200 : 4000});</script>
</body>`);
}

// Firma/verifica el `state` con AUTH_SECRET (contiene el uid del admin + nonce).
function signState(payload) {
  const secret = process.env.AUTH_SECRET || 'dev';
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(state) {
  try {
    const [body, sig] = String(state).split('.');
    const secret = process.env.AUTH_SECRET || 'dev';
    const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function redirectUriFrom(req) {
  const origin = (req.headers.origin || '').replace(/\/$/, '')
    || `https://${req.headers.host}`;
  return `${origin}/api/produccion/google-oauth?action=callback`;
}

async function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

export default async function handler(req, res) {
  const action = req.query?.action || (await readBody(req)).action;

  if (!oauthConfigured()) {
    if (req.method === 'GET') return closePopup(res, false, 'Falta configurar GOOGLE_OAUTH_CLIENT_ID / SECRET en Vercel.');
    return respondJSON(res, 200, { connected: false, configured: false });
  }

  // ---- START: redirige a Google ----
  if (req.method === 'GET' && action === 'start') {
    // El JWT del admin viene por query (no hay headers en una navegación).
    const token = req.query?.token || '';
    const uid = await getUserIdFromAuth({ headers: { authorization: `Bearer ${token}` } });
    if (!uid) return closePopup(res, false, 'Sesión inválida — volvé a entrar a la app.');
    const role = await getUserRole(uid);
    if (role !== 'admin') return closePopup(res, false, 'Solo un admin puede conectar Drive.');
    const state = signState({ uid, nonce: crypto.randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60 * 1000 });
    res.statusCode = 302;
    res.setHeader('Location', oauthConsentUrl(redirectUriFrom(req), state));
    res.end();
    return;
  }

  // ---- CALLBACK: Google vuelve con el code ----
  if (req.method === 'GET' && action === 'callback') {
    if (req.query?.error) return closePopup(res, false, `Google canceló: ${req.query.error}`);
    const st = verifyState(req.query?.state);
    if (!st?.uid) return closePopup(res, false, 'Estado inválido o expirado. Probá de nuevo.');
    const code = req.query?.code;
    if (!code) return closePopup(res, false, 'Google no devolvió el código.');
    try {
      const { refreshToken, email } = await oauthExchangeCode(code, redirectUriFrom(req));
      if (!refreshToken) return closePopup(res, false, 'Google no devolvió refresh_token. Quitá el acceso previo en myaccount.google.com y reintentá.');
      const ok = await saveGoogleOAuth(st.uid, refreshToken, email);
      if (!ok) return closePopup(res, false, 'No se pudo guardar la conexión (¿migración 0022 aplicada?).');
      return closePopup(res, true, `¡Drive conectado como ${email || 'tu cuenta'}!`);
    } catch (e) {
      return closePopup(res, false, `Error conectando: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  // ---- STATUS / DISCONNECT (POST, con auth por header) ----
  const uid = await getUserIdFromAuth(req);
  if (!uid) return respondJSON(res, 401, { error: 'No autorizado' });

  if (action === 'status') {
    const conn = await getGoogleOAuth();
    return respondJSON(res, 200, { connected: !!conn, email: conn?.email || null, configured: true });
  }

  if (action === 'disconnect') {
    const role = await getUserRole(uid);
    if (role !== 'admin') return respondJSON(res, 403, { error: 'Solo un admin puede desconectar.' });
    await deleteGoogleOAuth(null); // borra la conexión lab-wide
    return respondJSON(res, 200, { ok: true, connected: false });
  }

  return respondJSON(res, 400, { error: `Acción desconocida: ${action}` });
}
