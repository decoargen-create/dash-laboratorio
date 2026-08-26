// Reparación de carpetas de Drive — cliente.
//
// Contexto: hasta el fix de nomenclatura, la carpeta de una tarjeta se llamaba
// "<Producto> [<Persona>][<d-m>]", sin nada de la tarjeta. Dos tarjetas del
// mismo producto + persona + semana resolvían al mismo nombre y Drive las
// fusionaba (9 + 9 = 18 videos juntos). El fix arregla lo nuevo; esto desarma
// lo que ya quedó mezclado.
//
// Cómo: cada tarjeta guarda el driveId de cada video que subió, así que se
// mueve exactamente lo que esa tarjeta registró como suyo. Nada de adivinar
// por nombre.
//
// Dos pasos, siempre en este orden:
//   1. analizar()  → dryRun, no toca nada. Devuelve cuántos videos se moverían.
//   2. reparar()   → mueve de verdad, de a tandas, y deja anotado en cada
//                    tarjeta el folderId nuevo (si no, la próxima subida
//                    volvería a la carpeta compartida vieja).

import { supabase } from './supabase.js';
import { allWeekKeys, listAssignments, setArchivosFolder } from './produccionStore.js';

// Tandas chicas: mover un archivo son 2 llamadas a Drive y la función
// serverless tiene tiempo limitado. Con esto además el progreso se ve avanzar.
const LOTE = 6;

async function authHeaders() {
  const base = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const t = session?.access_token;
    return t ? { ...base, Authorization: `Bearer ${t}` } : base;
  } catch { return base; }
}

// Todas las tarjetas (de todas las semanas) que tienen videos en Drive.
export function tarjetasConVideosEnDrive() {
  const out = [];
  for (const wk of allWeekKeys()) {
    for (const a of listAssignments(wk)) {
      const driveIds = (a.archivos || []).filter(f => f.destino === 'drive' && f.driveId).map(f => f.driveId);
      if (driveIds.length === 0) continue;
      out.push({
        id: a.id,
        productoNombre: a.productoNombre,
        persona: a.persona || 'Equipo',
        weekKey: a.weekKey,
        published: a.estado === 'publicado',
        driveIds,
      });
    }
  }
  return out;
}

async function llamar(cards, dryRun) {
  const r = await fetch('/api/produccion/drive-repair', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ cards, dryRun }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// Recorre las tarjetas de a tandas acumulando el resultado. `onProgress` recibe
// { hechas, total } para la barra.
async function recorrer(tarjetas, dryRun, onProgress) {
  const resultado = { configured: true, cards: [], totales: { tarjetas: 0, mover: 0, yaOk: 0, movidos: 0, errores: 0 } };
  for (let i = 0; i < tarjetas.length; i += LOTE) {
    const lote = tarjetas.slice(i, i + LOTE);
    const d = await llamar(lote, dryRun);
    if (d.configured === false) return { configured: false, reason: d.reason, transient: !!d.transient };
    resultado.cards.push(...(d.cards || []));
    for (const k of Object.keys(resultado.totales)) resultado.totales[k] += d.totales?.[k] || 0;
    onProgress?.({ hechas: Math.min(i + LOTE, tarjetas.length), total: tarjetas.length });
  }
  return resultado;
}

// Paso 1 — qué pasaría. No toca Drive.
export function analizar(onProgress) {
  const tarjetas = tarjetasConVideosEnDrive();
  if (tarjetas.length === 0) {
    return Promise.resolve({ configured: true, cards: [], totales: { tarjetas: 0, mover: 0, yaOk: 0, movidos: 0, errores: 0 } });
  }
  return recorrer(tarjetas, true, onProgress);
}

// Paso 2 — mover de verdad y dejar anotado el folderId nuevo en cada tarjeta.
export async function reparar(onProgress) {
  const tarjetas = tarjetasConVideosEnDrive();
  const r = await recorrer(tarjetas, false, onProgress);
  if (r.configured === false) return r;
  for (const c of r.cards) {
    if (c.folderId && c.movidos > 0) {
      setArchivosFolder(c.id, { folderId: c.folderId, folderLink: c.folderLink });
    }
  }
  return r;
}
