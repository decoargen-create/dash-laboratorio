// Capa de sync entre Marketing localStorage/IDB y Supabase.
//
// Estrategia:
// - localStorage sigue siendo el "fast cache" (lectura sync, sin latencia).
// - Cada cambio dispatcha un push debounced (2s) al backend.
// - Al login pulleamos del backend y overwriteamos el cache local.
// - Si Supabase falla al push, NO hay fallback offline: mostramos error y
//   el usuario sabe que sus cambios no se guardaron. (Pedido explícito).
//
// Marketing-specific. Otras plataformas (Viora, Senydrop, MetaAds, Consultoría)
// siguen 100% en localStorage.

import { supabase, getCurrentUser } from './supabase.js';

const KEYS = {
  productos: 'adslab-marketing-productos-v1',
  active: 'adslab-marketing-active-product',
  genOpts: 'adslab-marketing-gen-opts',
  brandsPrefix: 'adslab-marketing-inspiracion-brands-',
};

// ============================================================
// PULL — al login, traemos todo del backend
// ============================================================
export async function pullMarketingFromCloud() {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  console.info(`[sync] pull arrancando para user ${user.id}`);

  // 1) productos del user
  const { data: productos, error: errProd } = await supabase
    .from('marketing_productos')
    .select('id, data, updated_at')
    .order('updated_at', { ascending: false });
  if (errProd) {
    console.warn('[sync] pull productos error:', errProd.message);
    throw new Error(`Pull productos: ${errProd.message}`);
  }
  console.info(`[sync] pull recibió ${productos?.length || 0} productos del cloud`);

  const productosArr = (productos || []).map(row => row.data);
  try {
    localStorage.setItem(KEYS.productos, JSON.stringify(productosArr));
    console.info(`[sync] localStorage productos actualizado, ahora tiene ${productosArr.length}`);
  } catch (e) {
    console.warn('[sync] no pude escribir localStorage:', e.message);
  }

  // 2) prefs (active_producto_id + gen_opts)
  const { data: prefs } = await supabase
    .from('marketing_prefs')
    .select('active_producto_id, gen_opts')
    .maybeSingle();
  if (prefs?.active_producto_id) {
    try { localStorage.setItem(KEYS.active, prefs.active_producto_id); } catch {}
  }
  if (prefs?.gen_opts) {
    try { localStorage.setItem(KEYS.genOpts, JSON.stringify(prefs.gen_opts)); } catch {}
  }

  // 3) brands per producto
  const { data: brands, error: errBrands } = await supabase
    .from('marketing_brands')
    .select('producto_id, brand_id, data');
  if (errBrands) throw new Error(`Pull brands: ${errBrands.message}`);

  // Agrupar brands por producto y escribir al localStorage con la key específica.
  const byProducto = new Map();
  for (const row of brands || []) {
    if (!byProducto.has(row.producto_id)) byProducto.set(row.producto_id, []);
    byProducto.get(row.producto_id).push(row.data);
  }
  for (const [productoId, arr] of byProducto) {
    try { localStorage.setItem(`${KEYS.brandsPrefix}${productoId}`, JSON.stringify(arr)); } catch {}
  }

  // Aviso a la app para que re-cargue desde localStorage.
  try { window.dispatchEvent(new CustomEvent('viora:marketing-pulled')); } catch {}

  return { productos: productosArr.length, brands: (brands || []).length };
}

// ============================================================
// PUSH — upsert de un producto al backend
// ============================================================
export async function pushProducto(producto) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  const { error } = await supabase
    .from('marketing_productos')
    .upsert({
      id: String(producto.id),
      user_id: user.id,
      data: producto,
    }, { onConflict: 'user_id,id' });
  if (error) throw new Error(`Push producto: ${error.message}`);
}

// PUSH: lista completa de productos. Útil al cambiar algo grande (reorder,
// bulk import). Upsertea el resto.
//
// SAFETY GUARD (post-incidente del 2026-06-08 donde se borraron 2 productos
// por race condition entre push y pull):
// - Si productos.length === 0 → SKIP. Nunca borramos masivo desde un array
//   vacío porque puede ser una race condition (Arranque montó con local
//   vacío antes de que pull traiga del cloud) y borraría todo.
// - Para borrar un producto explícitamente, usar deleteProducto(productoId).
export async function pushAllProductos(productos) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  // ⚠️ GUARD CRÍTICO: array vacío = posible race, NO destruir cloud.
  if (productos.length === 0) {
    console.warn('[sync] push de productos vacíos — skipping para no borrar cloud (race protection)');
    return;
  }
  // Upsert masivo.
  const rows = productos.map(p => ({
    id: String(p.id),
    user_id: user.id,
    data: p,
  }));
  const { error } = await supabase
    .from('marketing_productos')
    .upsert(rows, { onConflict: 'user_id,id' });
  if (error) throw new Error(`Push productos bulk: ${error.message}`);
  // Borrar los que ya no existen (solo aplica cuando productos.length > 0).
  const idsActuales = productos.map(p => String(p.id));
  const { data: enServer } = await supabase
    .from('marketing_productos')
    .select('id');
  const aBorrar = (enServer || [])
    .map(r => r.id)
    .filter(id => !idsActuales.includes(id));
  if (aBorrar.length > 0) {
    await supabase.from('marketing_productos').delete().in('id', aBorrar);
  }
}

export async function deleteProducto(productoId) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) return;
  await supabase
    .from('marketing_productos')
    .delete()
    .eq('id', String(productoId));
}

// ============================================================
// PUSH — brands per producto
// ============================================================
export async function pushBrandsForProducto(productoId, brands) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  // ⚠️ Race protection idéntica a pushAllProductos.
  if (brands.length === 0) {
    console.warn(`[sync] push brands vacíos para producto ${productoId} — skipping`);
    return;
  }
  const rows = brands.map(b => ({
    producto_id: String(productoId),
    brand_id: String(b.id),
    user_id: user.id,
    data: b,
  }));
  const { error } = await supabase
    .from('marketing_brands')
    .upsert(rows, { onConflict: 'user_id,producto_id,brand_id' });
  if (error) throw new Error(`Push brands: ${error.message}`);
  // Borrar los que ya no están.
  const idsActuales = brands.map(b => String(b.id));
  const { data: enServer } = await supabase
    .from('marketing_brands')
    .select('brand_id')
    .eq('producto_id', String(productoId));
  const aBorrar = (enServer || [])
    .map(r => r.brand_id)
    .filter(id => !idsActuales.includes(id));
  if (aBorrar.length > 0) {
    await supabase
      .from('marketing_brands')
      .delete()
      .eq('producto_id', String(productoId))
      .in('brand_id', aBorrar);
  }
}

// ============================================================
// PUSH — prefs (active producto + gen opts)
// ============================================================
export async function pushPrefs(prefs) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  const { error } = await supabase
    .from('marketing_prefs')
    .upsert({
      user_id: user.id,
      active_producto_id: prefs.activeProductoId || null,
      gen_opts: prefs.genOpts || null,
    }, { onConflict: 'user_id' });
  if (error) throw new Error(`Push prefs: ${error.message}`);
}

// ============================================================
// MIGRACIÓN SOFT — primer login con DB, subimos lo que haya en localStorage
// ============================================================
export async function migrateLocalToCloud() {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');

  // ¿Ya migró antes? Marker en la DB.
  const { data: existing } = await supabase
    .from('marketing_productos')
    .select('id')
    .limit(1);
  if (existing && existing.length > 0) {
    // Ya hay productos en la nube — preferimos eso. No tocar el local.
    return { skipped: true, reason: 'cloud-not-empty' };
  }

  // No hay nada en la nube — subir lo local si existe.
  let localProductos = [];
  try {
    const raw = localStorage.getItem(KEYS.productos);
    localProductos = raw ? JSON.parse(raw) : [];
  } catch {}

  if (localProductos.length === 0) {
    return { skipped: true, reason: 'local-empty' };
  }

  await pushAllProductos(localProductos);

  // Brands por producto
  let totalBrands = 0;
  for (const p of localProductos) {
    try {
      const raw = localStorage.getItem(`${KEYS.brandsPrefix}${p.id}`);
      const brands = raw ? JSON.parse(raw) : [];
      if (brands.length > 0) {
        await pushBrandsForProducto(p.id, brands);
        totalBrands += brands.length;
      }
    } catch {}
  }

  // Prefs
  let activeId = null;
  let genOpts = null;
  try { activeId = localStorage.getItem(KEYS.active); } catch {}
  try {
    const raw = localStorage.getItem(KEYS.genOpts);
    if (raw) genOpts = JSON.parse(raw);
  } catch {}
  if (activeId || genOpts) {
    await pushPrefs({ activeProductoId: activeId, genOpts });
  }

  return { migrated: true, productos: localProductos.length, brands: totalBrands };
}
