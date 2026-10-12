// Cliente compartido de /api/marketing/referencias (reels de IG agendados).
// Lo usan la tab Referencias (biblioteca completa) y el detalle de tarjeta de
// Producción (agregar una referencia pegando el link directo en la tarjeta).

import { authHeaders } from './authFetch.js';
import { parseJsonOrThrow } from './apiHelpers.js';

export const IG_URL_RE = /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/gi;

export async function referenciasApi(path, { method = 'GET', body } = {}) {
  const resp = await fetch(`/api/marketing/referencias${path}`, {
    method,
    headers: await authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await parseJsonOrThrow(resp, 'referencias');
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Lo que viaja desnormalizado a las tarjetas de Producción. No incluye la URL
// del video: es firmada y vence, así que el editor la pide aparte con
// ?action=video&id=… (el server se la firma si tiene una tarjeta con esa
// referencia). Acá viaja solo lo que no caduca.
export function toCardRef(r) {
  return {
    id: r.id,
    url: r.url,
    shortcode: r.shortcode,
    caption: (r.caption || '').slice(0, 220),
    owner: r.owner_username || '',
    angle: r.analisis?.angle || '',
    hooks: Array.isArray(r.analisis?.hooks) ? r.analisis.hooks.slice(0, 4) : [],
    estructura: r.analisis?.estructura || '',
    guion: r.guion?.guion || '',
    notasEditor: r.guion?.notasEditor || '',
    hooksAlternativos: Array.isArray(r.guion?.hooksAlternativos) ? r.guion.hooksAlternativos : [],
    ts: Date.now(),
  };
}
