// Inicia el flow OAuth con Meta. Redirige al consent screen con un `state`
// firmado para prevenir CSRF.

import { META_API_VERSION, META_SCOPES, signState, getOrigin, respondJSON } from './_lib.js';
import crypto from 'node:crypto';

// Redirige al user al frontend con un query param de error (en vez de JSON
// crudo en el browser, que es una UX horrible si algo falla del lado server).
function redirectWithError(res, origin, returnTo, reason) {
  const path = (returnTo || '/acceso').startsWith('/') ? returnTo : '/acceso';
  const url = new URL(path, origin);
  url.searchParams.set('meta', 'error');
  url.searchParams.set('reason', reason.slice(0, 200));
  res.statusCode = 302;
  res.setHeader('Location', url.toString());
  res.end();
}

export default function handler(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const origin = getOrigin(req);

  // returnTo de dónde venía el usuario, para regresarlo al mismo lugar.
  let returnTo = req.url?.includes('?')
    ? new URL(req.url, origin).searchParams.get('returnTo') || '/acceso'
    : '/acceso';
  if (!returnTo.startsWith('/')) returnTo = '/acceso';

  const appId = process.env.META_APP_ID;
  const secret = process.env.AUTH_SECRET;
  if (!appId) return redirectWithError(res, origin, returnTo, 'META_APP_ID no está configurada en el servidor. Agregala en Vercel → Settings → Environment Variables y redeployá.');
  if (!secret) return redirectWithError(res, origin, returnTo, 'AUTH_SECRET no configurada en el servidor');

  const redirectUri = `${origin}/api/meta/callback`;

  const state = signState({
    nonce: crypto.randomBytes(16).toString('hex'),
    ts: Date.now(),
    returnTo,
  }, secret);

  const authUrl = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
  authUrl.searchParams.set('client_id', appId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', META_SCOPES);
  authUrl.searchParams.set('response_type', 'code');

  res.statusCode = 302;
  res.setHeader('Location', authUrl.toString());
  res.end();
}
