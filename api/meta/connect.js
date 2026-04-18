// Inicia el flow OAuth con Meta. Redirige al consent screen con un `state`
// firmado para prevenir CSRF.

import { META_API_VERSION, META_SCOPES, signState, getOrigin, respondJSON } from './_lib.js';
import crypto from 'node:crypto';

export default function handler(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const appId = process.env.META_APP_ID;
  const secret = process.env.AUTH_SECRET;
  if (!appId) return respondJSON(res, 500, { error: 'META_APP_ID no configurada' });
  if (!secret) return respondJSON(res, 500, { error: 'AUTH_SECRET no configurada (se reusa para firmar)' });

  const origin = getOrigin(req);
  const redirectUri = `${origin}/api/meta/callback`;

  // Optional: where to go after connecting (so el user vuelve al lugar donde
  // estaba). Se acepta sólo paths relativos para prevenir open-redirect.
  let returnTo = req.url?.includes('?')
    ? new URL(req.url, origin).searchParams.get('returnTo') || '/acceso'
    : '/acceso';
  if (!returnTo.startsWith('/')) returnTo = '/acceso';

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
