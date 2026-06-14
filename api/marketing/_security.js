// Helpers de seguridad compartidos por los endpoints.
//
// - isAllowedRemoteHost(url): bloquea SSRF a IPs internas (RFC1918, loopback,
//   link-local) — necesario para cualquier endpoint que haga fetch() de una
//   URL pasada por el client (adapt-inspiracion, resolve-fb-page, etc).
// - safeFetch(url, opts): wrapper que valida host + agrega AbortController
//   con timeout default. Lanza si el host no está permitido.

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.0\.0\.0|::1$|fc00:|fe80:)/i;

// Hosts permitidos para fetch outbound. Si el host no matchea NINGUNO de
// estos prefijos/sufijos, lo bloqueamos para evitar SSRF.
// Ampliá esta lista a medida que aparezcan dominios legítimos.
const ALLOWED_REMOTE_HOST_RE = /(?:^|\.)(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com|facebook\.com|instagram\.com|amazonaws\.com|cloudfront\.net|googleusercontent\.com|googleapis\.com|apify\.com|apifyusercontent\.com|supabase\.co|supabase\.in|tiktokcdn\.com|tiktok\.com|youtu\.be|youtube\.com|ggpht\.com)$/i;

export function isAllowedRemoteHost(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  let parsed;
  try { parsed = new URL(urlStr); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  // Bloqueo de IPs internas + loopback. Aunque DNS rebinding puede burlar
  // esto, es la primera línea contra SSRF a metadata endpoints (169.254...).
  if (PRIVATE_IP_RE.test(host)) return false;
  // Sin allowlist sería demasiado abierto. La lista es estricta — agregar
  // hosts solo si se justifica.
  return ALLOWED_REMOTE_HOST_RE.test(host);
}

// fetch wrappeado con timeout + validación de host. Tira si el host no es
// permitido o el fetch tarda más que `timeoutMs`.
export async function safeFetch(urlStr, init = {}, opts = {}) {
  const { timeoutMs = 10000, allowFetchAnyHttp = false } = opts;
  if (!allowFetchAnyHttp && !isAllowedRemoteHost(urlStr)) {
    throw new Error(`SSRF: host no permitido: ${urlStr.slice(0, 200)}`);
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(urlStr, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Helper para requerir auth. Devuelve userId o termina la response con 401.
// El caller debe importar getUserIdFromAuth de _supabase-server.
//
//   const userId = await requireAuth(req, res, getUserIdFromAuth);
//   if (!userId) return;
export async function requireAuth(req, res, getUserIdFromAuth) {
  const userId = await getUserIdFromAuth(req);
  if (!userId) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'No autorizado — se requiere sesión válida' }));
    return null;
  }
  return userId;
}
