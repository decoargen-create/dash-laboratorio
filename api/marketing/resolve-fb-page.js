// Resolver de Facebook Page a partir de la landing URL del competidor.
//
// La mayoría de marcas DTC ponen un link a su página de Facebook en el
// footer o en los social icons del header. Este endpoint hace fetch del
// HTML de la landing y busca el handle de FB más frecuente.
//
// Tener el fbPageUrl evita depender del search por keyword en Apify Ad
// Library (que a veces aborta con keywords genéricos como "URO" o
// landings con muchos ads ruidosos). Scrapear por Page es mucho más
// confiable.
//
// POST /api/marketing/resolve-fb-page
// Body: { landingUrl: string }
// Response: { pageUrl: string | null, handle: string | null, source: 'html' | null }

// Handles que NO son páginas de marca — son paths genéricos de FB.
const HANDLE_BLACKLIST = new Set([
  'sharer', 'sharer.php', 'share', 'share.php', 'tr', 'tr.php',
  'plugins', 'dialog', 'login', 'login.php', 'recover', 'recover.php',
  'home', 'pages', 'events', 'groups', 'watch', 'gaming',
  'marketplace', 'notifications', 'settings', 'help',
  'pg', 'profile.php', 'people', 'policy.php', 'privacy',
  'terms', 'about', 'careers', 'business', 'developers',
  'l.php', 'flx', 'fbml',
]);

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
    }
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

// Fetch con timeout + user-agent de browser para evitar que nos bloqueen
// por parecer bot. Validamos host antes para prevenir SSRF a IPs internas
// (RFC1918, loopback, link-local — incl. metadata endpoints del cloud).
async function fetchLandingHTML(url, { timeoutMs = 8000 } = {}) {
  // Pre-check: bloquea IPs privadas/loopback/link-local. No usamos allowlist
  // acá porque las landings son de marcas random — pero rechazamos hosts
  // peligrosos antes del fetch.
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('protocolo no permitido');
    }
    const host = parsed.hostname.toLowerCase();
    const privateRe = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.0\.0\.0|::1$|fc00:|fe80:|localhost$)/i;
    if (privateRe.test(host)) {
      throw new Error('host privado bloqueado por SSRF guard');
    }
  } catch (err) {
    throw new Error(`landingUrl rechazada: ${err.message}`);
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es,en;q=0.5',
      },
    });
    if (!resp.ok) throw new Error(`Landing HTTP ${resp.status}`);
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      throw new Error(`Content-Type inesperado: ${ct}`);
    }
    // Cortamos a 500KB para no quemar memoria con landings gigantes.
    const text = await resp.text();
    return text.slice(0, 500_000);
  } finally {
    clearTimeout(t);
  }
}

// Token distintivo del dominio de la landing (ej: femflorabrand.com →
// "femflorabrand"). Lo usamos para preferir el handle de FB que pertenece a
// LA MARCA, no a un plugin/fanbox/agencia embebido que gane por frecuencia.
function domainBrandToken(landingUrl) {
  try {
    const host = new URL(/^https?:\/\//i.test(landingUrl) ? landingUrl : `https://${landingUrl}`).hostname;
    // Sacamos www + TLD, nos quedamos con el label principal.
    const parts = host.replace(/^www\./, '').split('.');
    return (parts[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch { return ''; }
}

// ¿El handle comparte señal con el token de marca del dominio? Match laxo:
// uno contiene al otro, o comparten un prefijo de ≥5 chars. Sin esto,
// femflorabrand vs footclinic no matchean (correcto → sospechoso).
function handleMatchesBrand(handle, brandToken) {
  if (!handle || !brandToken || brandToken.length < 3) return false;
  const h = handle.replace(/[^a-z0-9]/g, '');
  if (h.includes(brandToken) || brandToken.includes(h)) return true;
  // Prefijo común largo (femflora... vs femflorabrand).
  const common = Math.min(h.length, brandToken.length);
  let i = 0;
  while (i < common && h[i] === brandToken[i]) i++;
  return i >= 5;
}

// Extrae handles de FB del HTML. Devuelve { handle, confidence, matchesBrand }.
// PRIORIDAD (audit del bug Femflora→pies): el handle que matchea el dominio de
// la marca gana sobre el más frecuente. Antes solo ganaba el más frecuente, y
// un plugin/fanbox/link de agencia embebido en la landing podía resolver a la
// FB page EQUIVOCADA (otro anunciante), trayendo ads de otro producto.
function extractFbHandle(html, landingUrl = '') {
  if (!html) return null;
  const re = /(?:https?:)?\/\/(?:www\.|m\.|web\.|es-la\.|business\.)?facebook\.com\/(?:pg\/|pages\/[^/]+\/)?([a-zA-Z0-9.\-_]+)(?=[\/"'?#\s&]|$)/gi;
  const counts = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    const handle = raw.toLowerCase();
    if (HANDLE_BLACKLIST.has(handle)) continue;
    if (/\.(php|html|htm|aspx?)$/i.test(handle)) continue;
    if (handle.length < 2) continue;
    if (handle.length > 64) continue;
    counts.set(handle, (counts.get(handle) || 0) + 1);
  }
  if (counts.size === 0) return null;

  const brandToken = domainBrandToken(landingUrl);
  const entries = [...counts.entries()];
  // 1. Si hay handle(s) que matchean la marca del dominio, gana el más
  //    frecuente ENTRE ESOS. Es el caso confiable.
  const branded = entries.filter(([h]) => handleMatchesBrand(h, brandToken));
  if (branded.length > 0) {
    branded.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    return { handle: branded[0][0], confidence: 'high', matchesBrand: true };
  }
  // 2. Sin match de marca: devolvemos el más frecuente pero con confidence
  //    baja para que el caller pueda advertir al user.
  entries.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  return { handle: entries[0][0], confidence: brandToken ? 'low' : 'unknown', matchesBrand: false };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const body = await readBody(req);
  let { landingUrl } = body || {};
  landingUrl = String(landingUrl || '').trim();
  if (!landingUrl) return respondJSON(res, 400, { error: 'Falta landingUrl' });

  // Normalizar: si no trae esquema, asumimos https.
  if (!/^https?:\/\//i.test(landingUrl)) {
    landingUrl = `https://${landingUrl}`;
  }

  try {
    const html = await fetchLandingHTML(landingUrl);
    const result = extractFbHandle(html, landingUrl);
    if (!result || !result.handle) {
      return respondJSON(res, 200, {
        pageUrl: null,
        handle: null,
        source: null,
        message: 'No encontré link a Facebook en la landing. Cargalo manual si querés.',
      });
    }
    return respondJSON(res, 200, {
      pageUrl: `https://www.facebook.com/${result.handle}`,
      handle: result.handle,
      source: 'html',
      // confidence: 'high' = el handle matchea el dominio de la marca.
      // 'low' = no matchea (posible plugin/agencia embebida → puede ser otro
      // anunciante). El caller advierte al user cuando es low. Ver bug Femflora.
      confidence: result.confidence,
      matchesBrand: result.matchesBrand,
    });
  } catch (err) {
    // Antes devolvíamos 200 con error en body — frontend no podía
    // distinguir "ok pero sin handle" de "fetch error". Ahora 502 cuando
    // el fetch upstream falló para que el caller pueda decidir mejor.
    return respondJSON(res, 502, {
      pageUrl: null,
      handle: null,
      source: null,
      error: err.message || 'No pude leer la landing',
    });
  }
}
