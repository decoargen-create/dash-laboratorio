// Subida a Supabase Storage con REINTENTO ante errores transitorios.
//
// El error típico que veíamos ("The connection to the database timed out") es un
// timeout momentáneo del lado de Supabase (su Storage escribe metadata en su
// base y a veces, con carga/picos, no responde a tiempo). Reintentar unas pocas
// veces con espera creciente lo resuelve solo, sin que el usuario vea el fallo.
//
// Los errores PERMANENTES (permisos/RLS, payload inválido, bucket inexistente)
// NO se reintentan: cortan al toque para no colgar la UI.

import { supabase } from './supabase.js';

// Patrón de mensajes que consideramos transitorios (vale la pena reintentar).
const TRANSITORIO = /timed?\s*out|timeout|connection|network|fetch failed|econn|reset|temporar|unavailable|\b5\d\d\b|too many/i;

// Mismo shape de retorno que supabase.storage.upload: { data, error }.
export async function uploadConReintento(bucket, path, body, opts = {}, cfg = {}) {
  const intentos = cfg.intentos ?? 3;
  const baseMs = cfg.baseMs ?? 1200;
  let lastErr = null;
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await supabase.storage.from(bucket).upload(path, body, { upsert: true, ...opts });
      if (!res.error) return res;
      lastErr = res.error;
      if (!TRANSITORIO.test(res.error.message || '')) return res; // permanente → no reintentar
    } catch (e) {
      lastErr = e;
      if (!TRANSITORIO.test(e?.message || '')) return { data: null, error: e };
    }
    if (i < intentos - 1) {
      await new Promise(r => setTimeout(r, baseMs * 2 ** i)); // 1.2s, 2.4s
    }
  }
  return { data: null, error: lastErr };
}
