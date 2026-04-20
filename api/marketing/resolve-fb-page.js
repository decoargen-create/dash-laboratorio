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
// por parecer bot.
async function fetchLandingHTML(url, { timeoutMs = 8000 } = {}) {
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

// Extrae todos los handles de FB del HTML y devuelve el más frecuente
// (suele ser el real de la marca, porque aparece en nav + footer + social bar).
function extractFbHandle(html) {
  if (!html) return null;
  // Match facebook.com/<handle> (con o sin "pg/", con o sin subdomain www/m/web).
  // Captura cualquier handle válido de Facebook: letras, números, puntos, guiones.
  const re = /(?:https?:)?\/\/(?:www\.|m\.|web\.|es-la\.|business\.)?facebook\.com\/(?:pg\/|pages\/[^/]+\/)?([a-zA-Z0-9.\-_]+)(?=[\/"'?#\s&]|$)/gi;
  const counts = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    const handle = raw.toLowerCase();
    // Descartar blacklist + paths con extensión (.php, .html, etc.)
    if (HANDLE_BLACKLIST.has(handle)) continue;
    if (/\.(php|html|htm|aspx?)$/i.test(handle)) continue;
    // Handles muy cortos son sospechosos (probablemente truncados)
    if (handle.length < 2) continue;
    // Handles muy largos también (probablemente IDs de tracking pixels)
    if (handle.length > 64) continue;
    counts.set(handle, (counts.get(handle) || 0) + 1);
  }
  if (counts.size === 0) return null;
  // El más repetido gana. En empate, el primero alfabético.
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return sorted[0][0];
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
    const handle = extractFbHandle(html);
    if (!handle) {
      return respondJSON(res, 200, {
        pageUrl: null,
        handle: null,
        source: null,
        message: 'No encontré link a Facebook en la landing. Cargalo manual si querés.',
      });
    }
    return respondJSON(res, 200, {
      pageUrl: `https://www.facebook.com/${handle}`,
      handle,
      source: 'html',
    });
  } catch (err) {
    return respondJSON(res, 200, {
      pageUrl: null,
      handle: null,
      source: null,
      error: err.message || 'No pude leer la landing',
    });
  }
}
