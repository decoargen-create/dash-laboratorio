// Desconecta la cuenta Meta borrando la cookie firmada.
// Nota: esto NO revoca el access_token en Meta (para eso el user tiene que
// ir a Meta → Configuración → Apps y eliminarla). Pero desde la plataforma
// ya no podemos hacer ningún request en su nombre.

import { clearMetaCookie, respondJSON } from './_lib.js';

export default function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return respondJSON(res, 405, { error: 'Method not allowed' });
  }
  clearMetaCookie(res);
  return respondJSON(res, 200, { ok: true });
}
