// Proxy de lectura del Google Sheet público "Dashboard Senydrop".
//
// Por qué existe: el front necesita leer el CSV del sheet en vivo, pero los
// endpoints de Google (gviz / export) no mandan headers CORS, así que un
// fetch desde el navegador se bloquea. Este endpoint hace el fetch del lado
// del server y reenvía el contenido con CORS abierto. NO usa credenciales ni
// env vars: el sheet es público ("cualquiera con el link, lector").
//
// Dos modos:
//   GET /api/seny-sheet?gid=<n>   → devuelve el CSV de esa pestaña.
//   GET /api/seny-sheet?list=1    → devuelve JSON { tabs: [{gid, name}] }
//                                   descubriendo todas las pestañas del sheet.

const SHEET_ID = '1cq2RnzvIZg2vA8pvcYUUftdsWIjliTmwHOQpMdYjaiU';
const DEFAULT_GID = '718012315';

// Descubre las pestañas (gid + nombre) parseando la vista HTML pública.
// La barra inferior de pestañas viene como <li id="sheet-button-<gid>">Nombre</li>.
async function listTabs() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`;
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'senydrop-dashboard/1.0' } });
  if (!res.ok) throw new Error(`htmlview respondió ${res.status}`);
  const html = await res.text();
  const tabs = [];
  const seen = new Set();
  const re = /sheet-button-(\d+)"[^>]*>(?:\s*<a[^>]*>)?\s*([^<]+?)\s*</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const gid = m[1];
    const name = m[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
    if (gid && name && !seen.has(gid)) { seen.add(gid); tabs.push({ gid, name }); }
  }
  return tabs;
}

export default async function handler(req, res) {
  // Modo "listar pestañas".
  if (String(req.query?.list || '') === '1') {
    try {
      const tabs = await listTabs();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      res.end(JSON.stringify({ tabs }));
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ tabs: [], error: `No pude listar pestañas: ${err?.message || err}` }));
    }
    return;
  }

  // Modo "leer CSV de una pestaña". Sólo gid numérico (no abrir un proxy libre).
  const rawGid = (req.query?.gid ?? '').toString().trim();
  const gid = /^\d+$/.test(rawGid) ? rawGid : DEFAULT_GID;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

  try {
    const upstream = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'senydrop-dashboard/1.0' },
    });

    if (!upstream.ok) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({
        error: `Google respondió ${upstream.status}. ¿El sheet sigue público con link?`,
      }));
      return;
    }

    const csv = await upstream.text();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Cache de borde corto: datos casi en vivo sin martillar a Google en cada
    // refresh. stale-while-revalidate sirve la copia vieja mientras refresca.
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.end(csv);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: `No pude leer el sheet: ${err?.message || err}` }));
  }
}
