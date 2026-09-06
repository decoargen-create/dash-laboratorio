// Lista los VIDEOS de la carpeta histórica de Drive (la que el equipo usaba
// antes de la plataforma), recursivo por subcarpetas. Alimenta el buscador de
// videos de Producción como segunda fuente ("archivo"), para poder marcar como
// winners creativos viejos que nunca pasaron por una tarjeta.
//
// POST { folderId } → { ok, files: [{ id, name, link, folder, fecha, sizeMB }],
//                       carpetas, truncated } | { configured:false }
//
// Límites defensivos: la carpeta puede ser enorme. BFS con tope de carpetas,
// archivos y profundidad — si se corta, truncated:true y el front lo dice.

import { getUserIdFromAuth, getUserRole } from '../marketing/_supabase-server.js';
import { getDriveContext } from './_drive-ctx.js';
import { driveList } from '../actas/_google.js';

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// Topes generosos (la carpeta histórica del user tiene años de material) con
// un presupuesto de TIEMPO como corte real: mejor devolver 45s de listado
// parcial que morir en el timeout de Vercel sin devolver nada.
const MAX_CARPETAS = 500;
const MAX_ARCHIVOS = 5000;
const MAX_PROFUNDIDAD = 6;
const BUDGET_MS = 45000;
const PARALELO = 6; // carpetas listadas a la vez

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });
  // Winners los marca quien gestiona (no un editor) — mismo gate que team.js.
  const role = await getUserRole(userId);
  if (role === 'creator') return respondJSON(res, 403, { error: 'Solo el admin puede explorar el archivo histórico.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const folderId = String(body?.folderId || '').trim();
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(folderId)) return respondJSON(res, 400, { error: 'folderId inválido.' });

  const ctx = await getDriveContext();
  if (!ctx || ctx.failed) return respondJSON(res, 200, { configured: false });
  const token = ctx.token;

  try {
    const t0 = Date.now();
    const files = [];
    let carpetas = 0;
    let truncated = false;

    // Lista UNA carpeta completa (con paginación). Devuelve las subcarpetas
    // encontradas para el siguiente nivel del BFS.
    const listarCarpeta = async ({ id, path, depth }) => {
      const sub = [];
      let pageToken = null;
      do {
        const params = {
          q: `'${id}' in parents and trashed=false`,
          fields: 'nextPageToken,files(id,name,mimeType,size,webViewLink,modifiedTime)',
          pageSize: '1000',
          ...(pageToken ? { pageToken } : {}),
        };
        const data = await driveList(token, params);
        if (data?.error) throw new Error(data.error.message || 'Drive rechazó el listado');
        for (const f of (data.files || [])) {
          if (f.mimeType === 'application/vnd.google-apps.folder') {
            if (depth < MAX_PROFUNDIDAD) sub.push({ id: f.id, path: path ? `${path} / ${f.name}` : f.name, depth: depth + 1 });
            else truncated = true;
            continue;
          }
          if (!/^video\//.test(f.mimeType || '')) continue;
          if (files.length >= MAX_ARCHIVOS) { truncated = true; break; }
          files.push({
            id: f.id,
            name: f.name,
            link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
            folder: path || '(raíz)',
            fecha: f.modifiedTime || null,
            sizeMB: f.size ? +(Number(f.size) / 1024 / 1024).toFixed(1) : null,
          });
        }
        pageToken = data.nextPageToken || null;
      } while (pageToken && files.length < MAX_ARCHIVOS && Date.now() - t0 < BUDGET_MS);
      return sub;
    };

    // BFS por niveles, PARALELO adentro de cada nivel (antes era secuencial y
    // una carpeta con muchas subcarpetas moría en el timeout sin devolver nada).
    let nivel = [{ id: folderId, path: '', depth: 0 }];
    while (nivel.length > 0) {
      if (Date.now() - t0 > BUDGET_MS || carpetas >= MAX_CARPETAS || files.length >= MAX_ARCHIVOS) { truncated = true; break; }
      const tanda = nivel.splice(0, Math.min(PARALELO, MAX_CARPETAS - carpetas));
      carpetas += tanda.length;
      const subs = await Promise.all(tanda.map(listarCarpeta));
      nivel.push(...subs.flat());
    }

    return respondJSON(res, 200, { ok: true, configured: true, files, carpetas, truncated, ms: Date.now() - t0 });
  } catch (err) {
    return respondJSON(res, 502, { error: err?.message || 'No pude listar la carpeta de Drive.' });
  }
}
