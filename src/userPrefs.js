// Preferencias de usuario GLOBALES sincronizadas con la nube (tabla
// public.user_prefs). Primer paso del movimiento "todo a la nube": la
// apariencia (color de acento, fuente, tamaño) vivía solo en localStorage y
// por eso difería entre dispositivos. Ahora se pullea al login y se pushea
// con debounce ante cada cambio.
//
// Diseño deliberadamente SIMPLE e independiente del sync de Marketing
// (useMarketingSync) porque el payload es chico y de bajo riesgo:
//   - last-write-wins (sin guards anti-wipe — no hay nada que perder).
//   - Si la tabla todavía no existe (migración 0009 sin aplicar), las
//     funciones degradan a no-op silencioso → la app sigue andando local-only.

import { supabase, getCurrentUser } from './supabase.js';

// Trae las prefs del cloud para el user logueado. Devuelve el objeto `prefs`
// (jsonb) o null si no hay fila / no hay user / la tabla no existe.
export async function pullUserPrefs() {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('user_prefs')
      .select('prefs')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      // 42P01 = tabla inexistente (migración sin aplicar) → degradar silencioso.
      if (error.code === '42P01') {
        console.warn('[userPrefs] tabla user_prefs no existe todavía — corré la migración 0009. Sigo local-only.');
        return null;
      }
      throw error;
    }
    return data?.prefs || null;
  } catch (err) {
    console.warn('[userPrefs] pull falló (sigo local-only):', err.message);
    return null;
  }
}

// Upsert de las prefs del user. `prefs` es el objeto completo a guardar
// (mergeá del lado del caller si querés preservar otras keys).
export async function pushUserPrefs(prefs) {
  try {
    const user = await getCurrentUser();
    if (!user) return false;
    const { error } = await supabase
      .from('user_prefs')
      .upsert({
        user_id: user.id,
        prefs: prefs || {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) {
      if (error.code === '42P01') {
        console.warn('[userPrefs] tabla user_prefs no existe todavía — corré la migración 0009.');
        return false;
      }
      throw error;
    }
    return true;
  } catch (err) {
    console.warn('[userPrefs] push falló:', err.message);
    return false;
  }
}
