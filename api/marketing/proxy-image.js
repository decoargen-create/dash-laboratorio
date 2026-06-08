// Proxy de imágenes — baja una URL externa y la devuelve con CORS abierto.
// Usado para cachear las imágenes de ads scrapeados (Meta CDN expira en ~24h)
// en IndexedDB del cliente. Sin esto el fetch desde el browser falla por CORS
// para muchas URLs.
//
// Uso: GET /api/marketing/proxy-image?url=<encoded>
//
// Seguridad básica: validamos que sea http/https y limitamos hosts a CDNs
// conocidos para evitar SSRF.

const ALLOWED_HOSTS = [
  'fbcdn.net',           // Facebook CDN
  'cdninstagram.com',    // Instagram CDN
  'facebook.com',
  'instagram.com',
  'whatsapp.net',
  'amazonaws.com',       // S3 — por si Apify devuelve URLs proxy
  'apify.com',
];

function isAllowedHost(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith('.' + allowed));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const url = req.query?.url || (req.url && new URL(req.url, 'http://x').searchParams.get('url'));
  if (!url) {
    res.statusCode = 400;
    return res.end('Missing url param');
  }
  if (!isAllowedHost(url)) {
    res.statusCode = 403;
    return res.end('Host not allowed');
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!upstream.ok) {
      res.statusCode = upstream.status;
      return res.end(`Upstream ${upstream.status}`);
    }
    const ab = await upstream.arrayBuffer();
    const buf = Buffer.from(ab);

    const mime = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 200;
    res.end(buf);
  } catch (err) {
    console.error('proxy-image error:', err);
    res.statusCode = 502;
    res.end('Upstream error');
  }
}
