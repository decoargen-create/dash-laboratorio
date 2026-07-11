// CLOUD-FIRST DATA LAYER (Fase 4)
//
// Capa de acceso directo al cloud — sin pasar por localStorage como "fuente
// de verdad". El localStorage SIGUE existiendo como cache rápido pero ahora
// es opcional, no autoritativo.
//
// Patrón:
//   1. Componentes piden data via hooks (useCloudProductos, etc.)
//   2. Hook hace fetch del cloud al mount + suscribe a Realtime para updates.
//   3. Cambios (mutations) van directo al cloud — el cloud devuelve el
//      result y el hook actualiza su state local. Realtime también notifica
//      a otros tabs / devices.
//   4. localStorage queda como cache OPCIONAL para boot rápido (mostrar
//      data vieja mientras carga cloud) — pero NO autoritativo.
//
// Beneficios sobre el approach anterior:
//   - Componentes no leen localStorage directamente (más fácil de migrar
//     fuera de localStorage en el futuro).
//   - State del componente y cloud están siempre sincronizados via Realtime.
//   - Mutaciones esperan confirmación del cloud antes de actualizar UI →
//     no hay "optimistic update" que después se rollbackee.
//
// Migración gradual: cada componente se puede migrar individualmente.
// Componentes viejos que siguen usando localStorage funcionan en paralelo
// — el sync layer existente los mantiene en línea.

import { supabase, getCurrentUser } from './supabase.js';

// ============================================================
// PRODUCTOS
// ============================================================

// Fetch inicial de todos los productos del user.
// Devuelve array de productos (data + id + updated_at).
export async function fetchProductos() {
  if (!supabase) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('marketing_productos')
    .select('id, data, updated_at')
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn('[cloudData] fetchProductos error:', error.message);
    return [];
  }
  // Stripear campos pesados legacy (mismo que pullMarketingFromCloud)
  // + filtrar tombstones (productos borrados — ver deleteProductoCloud).
  return (data || []).filter(row => !row.data?._deleted).map(row => {
    const p = row.data || {};
    const { creativos, ...slim } = p;
    if (!slim.resumenEjecutivo && slim.docs?.resumenEjecutivo) {
      slim.resumenEjecutivo = slim.docs.resumenEjecutivo;
    }
    return slim;
  });
}

// Upsert de un producto al cloud. Devuelve el producto guardado.
export async function saveProducto(producto) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  if (!producto?.id) throw new Error('producto.id requerido');
  const { error } = await supabase
    .from('marketing_productos')
    .upsert({
      id: String(producto.id),
      user_id: user.id,
      data: { ...producto, updated_at: new Date().toISOString() },
    }, { onConflict: 'user_id,id' });
  if (error) throw new Error(`saveProducto: ${error.message}`);
  return producto;
}

// Borra un producto (cascade: brands + creativos + ideas).
export async function deleteProductoCloud(productoId) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) return;
  const idStr = String(productoId);
  // Brands
  await supabase.from('marketing_brands')
    .delete().eq('user_id', user.id).eq('producto_id', idStr);
  // Creativos
  await supabase.from('marketing_creativos')
    .delete().eq('user_id', user.id).eq('producto_id', idStr);
  // Ideas de la bandeja
  await supabase.from('marketing_ideas')
    .delete().eq('user_id', user.id).eq('producto_id', idStr);
  // Producto — TOMBSTONE en vez de delete duro (mismo esquema que
  // marketingSync.deleteProducto): si borráramos la fila, otra sesión con
  // copia local re-pushearía el producto y reaparecería en todos lados.
  const nowIso = new Date().toISOString();
  await supabase.from('marketing_productos')
    .upsert({
      id: idStr,
      user_id: user.id,
      data: { id: idStr, _deleted: true, deleted_at: nowIso, updated_at: nowIso },
      updated_at: nowIso,
    }, { onConflict: 'user_id,id' });
}

// ============================================================
// IDEAS (bandeja)
// ============================================================

// Devuelve todas las ideas del user — la data + id + producto_id, ordenadas
// por updated_at desc para mantener orden "más recientes arriba".
export async function fetchIdeas() {
  if (!supabase) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('marketing_ideas')
    .select('id, producto_id, data, updated_at')
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn('[cloudData] fetchIdeas error:', error.message);
    return [];
  }
  // El data ya contiene id y productoId — mergeamos con la columna por si
  // hay drift (la columna es source of truth, pero el data legacy puede
  // tenerlos también).
  return (data || []).map(row => ({
    ...(row.data || {}),
    id: row.id,
    productoId: row.producto_id || (row.data?.productoId ?? null),
  }));
}

// Upsert de UNA idea. data debe traer al menos { id, productoId, ... }.
export async function saveIdea(idea) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  if (!idea?.id) throw new Error('idea.id requerido');
  const { error } = await supabase
    .from('marketing_ideas')
    .upsert({
      id: String(idea.id),
      user_id: user.id,
      producto_id: idea.productoId ? String(idea.productoId) : null,
      data: idea,
    }, { onConflict: 'user_id,id' });
  if (error) throw new Error(`saveIdea: ${error.message}`);
  return idea;
}

// Borra UNA idea por id.
export async function deleteIdeaCloud(ideaId) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) return;
  const { error } = await supabase
    .from('marketing_ideas')
    .delete()
    .eq('user_id', user.id)
    .eq('id', String(ideaId));
  if (error) throw new Error(`deleteIdeaCloud: ${error.message}`);
}

// Migración lazy: lee producto.bandejaIdeas[] del cloud, upsertea cada
// idea como fila individual en marketing_ideas, y limpia el array del
// producto. Se llama una vez por producto la primera vez que el user
// abre la app después del rollout.
//
// Idempotente: si el producto ya no tiene bandejaIdeas, no hace nada.
// Si la idea ya está en marketing_ideas, el upsert la pisa con la versión
// del producto (que es la última vista de esa idea de todas formas).
export async function migrateBandejaIdeasFromProductos() {
  if (!supabase) return { migrated: 0 };
  const user = await getCurrentUser();
  if (!user) return { migrated: 0 };
  // Pulleamos los productos full (con bandejaIdeas).
  const { data: rows, error: fetchErr } = await supabase
    .from('marketing_productos')
    .select('id, data');
  if (fetchErr) {
    console.warn('[cloudData] migrate ideas: pull productos falló:', fetchErr.message);
    return { migrated: 0 };
  }
  let totalMigrated = 0;
  for (const row of rows || []) {
    const p = row.data || {};
    const ideas = Array.isArray(p.bandejaIdeas) ? p.bandejaIdeas : [];
    if (ideas.length === 0) continue;
    // Upsert en batch — todas las ideas de este producto.
    const payload = ideas
      .filter(i => i?.id)
      .map(i => ({
        id: String(i.id),
        user_id: user.id,
        producto_id: i.productoId ? String(i.productoId) : String(row.id),
        data: i,
      }));
    if (payload.length === 0) continue;
    const { error: upErr } = await supabase
      .from('marketing_ideas')
      .upsert(payload, { onConflict: 'user_id,id' });
    if (upErr) {
      console.warn(`[cloudData] migrate ideas producto ${row.id} falló:`, upErr.message);
      continue;
    }
    // Limpiamos el array del producto — desde ahora la fuente de verdad
    // de ideas es la tabla marketing_ideas.
    const newData = { ...p, bandejaIdeas: [] };
    const { error: cleanErr } = await supabase
      .from('marketing_productos')
      .update({ data: newData })
      .eq('user_id', user.id)
      .eq('id', String(row.id));
    if (cleanErr) {
      console.warn(`[cloudData] migrate ideas: cleanup producto ${row.id} falló:`, cleanErr.message);
    }
    totalMigrated += payload.length;
  }
  if (totalMigrated > 0) {
    console.info(`[cloudData] migración bandeja → marketing_ideas: ${totalMigrated} ideas`);
  }
  return { migrated: totalMigrated };
}

// ============================================================
// INSPIRACIÓN GLOBAL (cross-producto)
// ============================================================
// Brands referente que el user usa para aprender ángulos/formato/hooks
// independientemente del producto. Visible y usable desde todos los
// productos a la vez.

export async function fetchInspiracionGlobal() {
  if (!supabase) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('marketing_inspiracion_global')
    .select('id, data, updated_at')
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn('[cloudData] fetchInspiracionGlobal error:', error.message);
    return [];
  }
  return (data || []).map(row => ({
    ...(row.data || {}),
    id: row.id,
    updated_at: row.updated_at,
  }));
}

export async function saveInspiracionGlobal(brand) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  if (!brand?.id) throw new Error('brand.id requerido');
  const { error } = await supabase
    .from('marketing_inspiracion_global')
    .upsert({
      id: String(brand.id),
      user_id: user.id,
      data: { ...brand, updated_at: new Date().toISOString() },
    }, { onConflict: 'user_id,id' });
  if (error) throw new Error(`saveInspiracionGlobal: ${error.message}`);
  return brand;
}

export async function deleteInspiracionGlobal(brandId) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) return;
  const { error } = await supabase
    .from('marketing_inspiracion_global')
    .delete()
    .eq('user_id', user.id)
    .eq('id', String(brandId));
  if (error) throw new Error(`deleteInspiracionGlobal: ${error.message}`);
}

// ============================================================
// SUBSCRIPCIONES REALTIME — genérico
// ============================================================

// Suscribe a cambios de una tabla filtrados por user_id.
// Devuelve función de cleanup (unsubscribe).
//
// onChange recibe (eventType, newRow, oldRow):
//   eventType: 'INSERT' | 'UPDATE' | 'DELETE'
//   newRow: la fila nueva (en INSERT/UPDATE) o null (en DELETE)
//   oldRow: la fila anterior (en UPDATE/DELETE) o null (en INSERT)
export function subscribeTable(tableName, onChange) {
  if (!supabase) return () => {};
  let unsubscribed = false;
  let channel = null;
  (async () => {
    const user = await getCurrentUser();
    if (!user || unsubscribed) return;
    channel = supabase
      .channel(`cloud-${tableName}-${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: tableName, filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (unsubscribed) return;
          onChange(payload.eventType, payload.new, payload.old);
        }
      )
      .subscribe();
  })();
  return () => {
    unsubscribed = true;
    if (channel) {
      try { supabase.removeChannel(channel); } catch {}
    }
  };
}
