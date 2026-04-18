// Devuelve el estado de la conexión Meta del usuario actual.
// Si hay cookie válida: { connected: true, user: { id, name } }
// Si no: { connected: false }
//
// NO devuelve el access_token al frontend (queda server-side en la cookie).

import { readMetaCookie, respondJSON } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return respondJSON(res, 405, { error: 'Method not allowed' });

  const session = readMetaCookie(req);
  if (!session || !session.accessToken) {
    return respondJSON(res, 200, { connected: false });
  }
  // Chequeo suave de expiración (el long-lived dura ~60d, pero podemos haber
  // bajado la cookie MaxAge en prod).
  if (session.exp && session.exp < Math.floor(Date.now() / 1000)) {
    return respondJSON(res, 200, { connected: false, reason: 'expired' });
  }

  return respondJSON(res, 200, {
    connected: true,
    user: {
      id: session.metaUserId || null,
      name: session.metaUserName || null,
    },
    // Sólo enviamos cuándo expira, no el token.
    expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
  });
}
