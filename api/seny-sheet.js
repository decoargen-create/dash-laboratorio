// Proxy de lectura del Google Sheet público "Dashboard Senydrop".
//
// Por qué existe: el front necesita leer el CSV del sheet en vivo, pero los
// endpoints de Google (gviz / export) no mandan headers CORS, así que un
// fetch desde el navegador se bloquea. Este endpoint hace el fetch del lado
// del server y reenvía el CSV con CORS abierto. NO usa credenciales ni env
// vars: el sheet es público ("cualquiera con el link, lector"), así que esto
// es sólo un puente, no un acceso privilegiado.
//
// Uso: GET /api/seny-sheet?gid=<numero-de-pestaña>
// Devuelve text/csv crudo tal cual lo exporta Google.

// ID del spreadsheet (parte de la URL entre /d/ y /edit). Público con link.
const SHEET_ID = '1cq2RnzvIZg2vA8pvcYUUftdsWIjliTmwHOQpMdYjaiU';

// gid de la pestaña por defecto ("Dashboard Marzo" — transacciones por orden).
const DEFAULT_GID = '718012315';

export default async function handler(req, res) {
  // Sólo aceptamos gid numérico para no convertir esto en un proxy abierto.
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
