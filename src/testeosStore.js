// Persistencia de Testeos: reglas por cuenta + fotos semanales.
//
// Las reglas vivían en localStorage y eso tenía dos problemas: no te seguían
// entre dispositivos y se perdían al limpiar el navegador. Ahora la fuente de
// verdad es Supabase (tablas testeos_config y testeos_snapshots, con RLS por
// dueño) y localStorage queda como caché: pinta el tablero al instante
// mientras llega la nube, y salva el día si Supabase no responde.
//
// Migración sin fricción: la primera vez que se abre una cuenta que solo tenía
// config local, se sube sola a la nube.

import { supabase } from './supabase.js';

const LS_CFG = 'adslab-testeos-cfg-';   // + accountId

const cloud = () => !!supabase;

async function userId() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
  } catch { return null; }
}

// ── Caché local ─────────────────────────────────────────────────────────
export function leerCfgLocal(accountId) {
  try {
    const raw = localStorage.getItem(LS_CFG + accountId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function guardarCfgLocal(accountId, cfg) {
  try { localStorage.setItem(LS_CFG + accountId, JSON.stringify(cfg)); } catch {}
}

// ── Reglas ──────────────────────────────────────────────────────────────

// Devuelve { cfg, origen } — 'nube' | 'local' | 'nuevo'. El origen se muestra
// en la UI para que se sepa si lo que estás viendo ya está guardado para todos
// tus dispositivos o solo en este navegador.
export async function cargarCfg(accountId) {
  const local = leerCfgLocal(accountId);
  if (!cloud()) return { cfg: local, origen: local ? 'local' : 'nuevo' };

  const uid = await userId();
  if (!uid) return { cfg: local, origen: local ? 'local' : 'nuevo' };

  try {
    const { data, error } = await supabase
      .from('testeos_config')
      .select('cfg')
      .eq('user_id', uid)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;

    if (data?.cfg) {
      guardarCfgLocal(accountId, data.cfg);
      return { cfg: data.cfg, origen: 'nube' };
    }
    // No hay nada en la nube. Si había config local de antes, la subimos:
    // así el que ya venía usando el tablero no pierde sus umbrales.
    if (local) {
      await guardarCfg(accountId, local);
      return { cfg: local, origen: 'nube' };
    }
    return { cfg: null, origen: 'nuevo' };
  } catch (e) {
    console.warn('[testeos] cargar cfg:', e?.message || e);
    return { cfg: local, origen: local ? 'local' : 'nuevo' };
  }
}

export async function guardarCfg(accountId, cfg) {
  guardarCfgLocal(accountId, cfg);
  if (!cloud()) return { ok: false, motivo: 'sin-supabase' };
  const uid = await userId();
  if (!uid) return { ok: false, motivo: 'sin-sesion' };
  try {
    const { error } = await supabase
      .from('testeos_config')
      .upsert({ user_id: uid, account_id: accountId, cfg, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,account_id' });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn('[testeos] guardar cfg:', e?.message || e);
    return { ok: false, motivo: e?.message || 'error' };
  }
}

// ── Fotos semanales ─────────────────────────────────────────────────────

// Devuelve un mapa { [semana]: { datos, cerrada_at } } listo para
// fusionarConFotos(). El productoId vacío es la foto de la cuenta entera.
export async function cargarFotos(accountId, productoId = '') {
  if (!cloud()) return {};
  const uid = await userId();
  if (!uid) return {};
  try {
    const { data, error } = await supabase
      .from('testeos_snapshots')
      .select('semana, datos, cerrada_at')
      .eq('user_id', uid)
      .eq('account_id', accountId)
      .eq('producto_id', productoId || '');
    if (error) throw error;
    const map = {};
    for (const r of data || []) map[r.semana] = { datos: r.datos, cerrada_at: r.cerrada_at };
    return map;
  } catch (e) {
    console.warn('[testeos] cargar fotos:', e?.message || e);
    return {};
  }
}

// Congela una tanda de cohortes. `filas` son las que devolvió
// cohortesParaCongelar(): ya maduras y sin foto previa.
//
// Guarda también con qué reglas se sacó cada foto: sin eso, dentro de dos
// meses nadie podría explicar por qué esa semana dio 50%.
export async function guardarFotos(accountId, filas, cfg, productoId = '') {
  if (!cloud() || !filas?.length) return { guardadas: 0 };
  const uid = await userId();
  if (!uid) return { guardadas: 0 };
  try {
    const rows = filas.map(f => ({
      user_id: uid,
      account_id: accountId,
      semana: f.semana,
      producto_id: productoId || '',
      datos: f.foto,
      cfg,
      cerrada_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('testeos_snapshots')
      .upsert(rows, { onConflict: 'user_id,account_id,semana,producto_id', ignoreDuplicates: true });
    if (error) throw error;
    return { guardadas: rows.length };
  } catch (e) {
    console.warn('[testeos] guardar fotos:', e?.message || e);
    return { guardadas: 0, error: e?.message };
  }
}
