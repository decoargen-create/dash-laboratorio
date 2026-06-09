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
// Helper: wrappea cada query con retry + backoff exponencial para que un
// error de red transitorio al inicio no deje la app vacía hasta el próximo
// reload. Hace 3 reintentos máx con delays 1s/2s/4s.
async function queryWithRetry(label, queryFn, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await queryFn();
      if (result.error) throw new Error(result.error.message);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = Math.min(8000, 1000 * Math.pow(2, attempt));
        console.warn(`[sync] ${label} falló (intento ${attempt + 1}/${retries + 1}): ${err.message}. Retry en ${delay}ms.`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export async function pullMarketingFromCloud() {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  console.info(`[sync] pull arrancando para user ${user.id}`);

  // 1) productos del user
  const { data: productos } = await queryWithRetry('pull productos', () =>
    supabase
      .from('marketing_productos')
      .select('id, data, updated_at')
      .order('updated_at', { ascending: false })
  );
  console.info(`[sync] pull recibió ${productos?.length || 0} productos del cloud`);

  // Stripear campos pesados legacy antes de guardar a localStorage:
  // - producto.creativos: legacy embebido — ahora vive en marketing_creativos
  // - producto.docs[*].raw: texto crudo de docs (puede ser muchos KB)
  // Sin esto: producto "Probiotico" con creativos legacy pesa 1.46 MB y
  // hace exceeder la quota de localStorage (5-10MB) cuando hay 2+ productos
  // pesados. Resultado: el setItem falla y el user ve "Sin productos".
  const productosArr = (productos || []).map(row => {
    const p = row.data || {};
    // Clonamos shallow y removemos campos legacy pesados.
    const { creativos, ...slim } = p;
    // Normalización resumenEjecutivo: el server (patchProductoDocs) lo
    // guarda en docs.resumenEjecutivo. El cliente lo lee en p.resumenEjecutivo
    // (ver Marketing.jsx:274, 381, etc.). Si el cloud tiene solo docs.X y
    // no root.X (caso típico tras pipeline server-persisted), promovemos a
    // root para que la UI lo vea. Sin esto: "Sin resumen ejecutivo generado".
    if (!slim.resumenEjecutivo && slim.docs?.resumenEjecutivo) {
      slim.resumenEjecutivo = slim.docs.resumenEjecutivo;
    }
    return slim;
  });

  try {
    localStorage.setItem(KEYS.productos, JSON.stringify(productosArr));
    console.info(`[sync] localStorage productos actualizado: ${productosArr.length} productos, ${JSON.stringify(productosArr).length} bytes`);
  } catch (e) {
    console.warn('[sync] no pude escribir localStorage (quota?):', e.message);
    // Fallback: intentar con solo la metadata mínima — sin docs/research grandes
    try {
      const tinyArr = productosArr.map(p => ({
        id: p.id,
        nombre: p.nombre,
        descripcion: (p.descripcion || '').slice(0, 500),
        landingUrl: p.landingUrl,
        stage: p.stage,
        competidores: p.competidores,
        metaAccount: p.metaAccount,
      }));
      localStorage.setItem(KEYS.productos, JSON.stringify(tinyArr));
      console.warn(`[sync] guardé versión liviana: ${tinyArr.length} productos`);
    } catch (e2) {
      console.warn('[sync] ni siquiera la versión mínima entra. Limpiando otras keys.', e2.message);
      // Liberamos espacio borrando caches que no son críticos.
      try { localStorage.removeItem('adslab-marketing-skeleton-cache'); } catch {}
      try { localStorage.removeItem('adslab-marketing-creative-refresh-cache'); } catch {}
      // Retry
      try { localStorage.setItem(KEYS.productos, JSON.stringify(productosArr.map(p => ({ id: p.id, nombre: p.nombre })))); } catch {}
    }
  }

  // 2) prefs (active_producto_id + gen_opts)
  const { data: prefs } = await queryWithRetry('pull prefs', () =>
    supabase
      .from('marketing_prefs')
      .select('active_producto_id, gen_opts')
      .maybeSingle()
  );
  if (prefs?.active_producto_id) {
    try { localStorage.setItem(KEYS.active, prefs.active_producto_id); } catch {}
  }
  if (prefs?.gen_opts) {
    try { localStorage.setItem(KEYS.genOpts, JSON.stringify(prefs.gen_opts)); } catch {}
  }

  // 3) brands per producto
  const { data: brands } = await queryWithRetry('pull brands', () =>
    supabase
      .from('marketing_brands')
      .select('producto_id, brand_id, data')
  );

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
  // NOTA: no hacemos diff-delete acá (eliminado tras auditoría).
  // El problema: si el user tenía 5 productos en el cloud (ej. desde otro
  // device) y el local tiene 1 (porque acaba de pullear o quota
  // localStorage truncó), un push bulk borraba los otros 4. El borrado
  // explícito de productos se hace solo via deleteProducto() llamado desde
  // los handlers de UI — esa es la fuente de verdad para "el user quiso
  // borrar esto".
}

// Defense-in-depth: filtramos por user_id además de RLS para que un id
// incorrecto/colisionado de otro user no se borre por error.
// CASCADE: también borramos brands + creativos del mismo producto. Sin
// esto quedaban huérfanos en el cloud + el localStorage de brands del
// producto borrado nunca se limpiaba, reapareciendo al próximo pull.
export async function deleteProducto(productoId) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) return;
  const idStr = String(productoId);
  // Brands del producto
  await supabase
    .from('marketing_brands')
    .delete()
    .eq('user_id', user.id)
    .eq('producto_id', idStr);
  // Creativos del producto (rows en marketing_creativos).
  // Para borrar también los bytes del Storage haría falta listar
  // storage_path antes de delete; lo dejamos por ahora porque (a) los
  // bytes ocupan poco si están en bucket Supabase con free tier generoso
  // y (b) la URL queda huérfana pero no afecta nada.
  await supabase
    .from('marketing_creativos')
    .delete()
    .eq('user_id', user.id)
    .eq('producto_id', idStr);
  // Producto al final.
  await supabase
    .from('marketing_productos')
    .delete()
    .eq('id', idStr)
    .eq('user_id', user.id);
  // Limpiar la key local de brands para que el próximo pull no la
  // re-popule. Y notificar al sync para que el otro state se entere.
  try {
    localStorage.removeItem(`adslab-marketing-inspiracion-brands-${idStr}`);
    window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', {
      detail: { key: `adslab-marketing-inspiracion-brands-${idStr}` },
    }));
  } catch {}
}

// ============================================================
// PUSH — brands per producto
// ============================================================
export async function pushBrandsForProducto(productoId, brands) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  // NOTA: antes había un early return en brands.length === 0 como race
  // protection. Eso impedía borrar la última brand de un producto (siempre
  // reaparecía en el próximo pull). La race protection real ahora vive
  // upstream en useMarketingSync (pullCompletedRef bloquea pushes antes
  // del primer pull) y acá podemos confiar en el delta calculado.
  if (brands.length > 0) {
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
  }
  // Diff-delete — siempre, aunque brands esté vacío.
  // brands=[] → borrar TODAS las brands del producto en cloud.
  const idsActuales = brands.map(b => String(b.id));
  const { data: enServer } = await supabase
    .from('marketing_brands')
    .select('brand_id')
    .eq('producto_id', String(productoId))
    .eq('user_id', user.id);
  const aBorrar = (enServer || [])
    .map(r => r.brand_id)
    .filter(id => !idsActuales.includes(id));
  if (aBorrar.length > 0) {
    await supabase
      .from('marketing_brands')
      .delete()
      .eq('user_id', user.id)
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
