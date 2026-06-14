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
// Allowlist curada — solo CDNs y plataformas con contenido controlado por
// branding owners (no user-generated tipo imgur). Removidos:
//   - imgur.com (UGC sin moderación → riesgo SVG payload)
//   - amazonaws-com-ssl (typo del PR original, no es dominio válido)
//   - getcellu.store (hardcoded customer — debería ser env var si hace falta)
const ALLOWED_REMOTE_HOST_RE = /(?:^|\.)(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com|facebook\.com|instagram\.com|amazonaws\.com|cloudfront\.net|googleusercontent\.com|googleapis\.com|apify\.com|apifyusercontent\.com|supabase\.co|supabase\.in|tiktokcdn\.com|tiktok\.com|youtu\.be|youtube\.com|ggpht\.com|shopify\.com|shopifycdn\.com|squarespace\.com|sqspcdn\.com|wixstatic\.com|wix\.com|sirv\.com|imgix\.net|cloudinary\.com|unsplash\.com|pexels\.com|pixabay\.com|gstatic\.com|akamaized\.net|fastly\.net|jsdelivr\.net|bunnycdn\.com|b-cdn\.net|tiendanube\.com|tcdn\.com\.br|mlstatic\.com)$/i;

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
  let useStrictTimeout = false;
  if (!allowFetchAnyHttp && !isAllowedRemoteHost(urlStr)) {
    // SOFT-FALLBACK: si el host no matcha el allowlist pero NO es una IP
    // privada, lo permitimos con timeout más agresivo. Sin esto, dominios
    // DTC raros (custom CDN del cliente) quedaban rejected y Claude
    // trabajaba sin imagen. Línea dura: bloqueo de IPs internas / metadata.
    let parsed;
    try { parsed = new URL(urlStr); } catch { throw new Error('URL inválida'); }
    const host = parsed.hostname.toLowerCase();
    if (PRIVATE_IP_RE.test(host) || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`SSRF: host privado/protocolo bloqueado: ${host}`);
    }
    useStrictTimeout = true;
  }
  // Timeout estricto para hosts no-allowlisted (mitigación slow-loris).
  const effectiveTimeout = useStrictTimeout ? Math.min(5000, timeoutMs) : timeoutMs;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), effectiveTimeout);
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
