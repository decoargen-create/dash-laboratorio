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
  return (data || []).map(row => {
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

// Borra un producto (cascade: brands + creativos).
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
  // Producto
  await supabase.from('marketing_productos')
    .delete().eq('user_id', user.id).eq('id', idStr);
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
