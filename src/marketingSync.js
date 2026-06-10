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

  // 0) Migración lazy: bandejaIdeas inline en producto → tabla marketing_ideas.
  // Idempotente — solo hace algo la primera vez tras el rollout.
  try {
    const { migrateBandejaIdeasFromProductos } = await import('./cloudData.js');
    await migrateBandejaIdeasFromProductos();
  } catch (err) {
    console.warn('[sync] migración bandeja ideas falló (continuo igual):', err.message);
  }

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
  // SMART MERGE: el pull NO sobreescribe ciegamente local con cloud.
  // Si local tiene un campo que cloud no tiene (caso "subí foto/corrí
  // pipeline antes de que existiera el sync server-side"), preservamos
  // el local. Esto fuerza una sincronización automática hacia el cloud
  // en el próximo push (sin necesidad de botón "Forzar sync" manual).
  let localArr = [];
  try { localArr = JSON.parse(localStorage.getItem(KEYS.productos) || '[]'); } catch {}
  const localById = new Map(localArr.map(p => [String(p.id), p]));

  const productosArr = (productos || []).map(row => {
    const cloudP = row.data || {};
    const { creativos, ...slim } = cloudP;
    if (!slim.resumenEjecutivo && slim.docs?.resumenEjecutivo) {
      slim.resumenEjecutivo = slim.docs.resumenEjecutivo;
    }
    const localP = localById.get(String(slim.id));
    if (!localP) return slim;
    // Merge: cloud es base, pero cualquier campo SOLO-LOCAL se preserva.
    // Cuando algun campo aparece en local pero NO en cloud, lo
    // promocionamos. El próximo push lo sube y queda sincronizado para
    // todas las devices del user.
    //
    // GENERIC PRESERVE: en lugar de listar campo por campo (frágil, se
    // olvidan descripcion / landingUrl / metaAccount), preservamos cualquier
    // key que esté en local con valor no-null y no esté en cloud (== null).
    // Excepciones: campos legacy o que viven en tablas separadas.
    const EXCLUDED_FROM_PRESERVE = new Set([
      'creativos',     // legacy embebido, removido de cloud
      'bandejaIdeas',  // ahora vive en tabla marketing_ideas
    ]);
    const merged = { ...slim };
    for (const k of Object.keys(localP)) {
      if (EXCLUDED_FROM_PRESERVE.has(k)) continue;
      if (merged[k] == null && localP[k] != null) {
        merged[k] = localP[k];
      }
    }
    // Arrays: si cloud está vacío/null pero local tiene cosas, preservar.
    // (cubre el caso donde cloud tiene competidores: [] vs local con datos)
    if ((!merged.competidores || merged.competidores.length === 0) && localP.competidores?.length) {
      merged.competidores = localP.competidores;
    }
    if ((!merged.bandejaIdeas || merged.bandejaIdeas.length === 0) && localP.bandejaIdeas?.length) {
      merged.bandejaIdeas = localP.bandejaIdeas;
    }
    // Para docs: merge field-by-field (cloud puede tener research, local
    // puede tener avatar nuevo, etc).
    if (localP.docs && typeof localP.docs === 'object') {
      merged.docs = { ...localP.docs, ...(merged.docs || {}) };
      // Excepción: si local tiene un doc no-vacío y cloud tiene vacío/null,
      // preservar el local.
      for (const k of Object.keys(localP.docs)) {
        if (!merged.docs[k] && localP.docs[k]) merged.docs[k] = localP.docs[k];
      }
    }
    return merged;
  });

  // Detectar si hicimos merge — disparar push automático para subir lo
  // preservado al cloud sin que el user tenga que hacer nada.
  const cloudStr = JSON.stringify((productos || []).map(r => r.data));
  const mergedStr = JSON.stringify(productosArr);
  const mergeOccurred = cloudStr !== mergedStr;
  if (mergeOccurred) {
    console.info('[sync] smart-merge: campos local-only preservados, disparando push automático');
  }

  // Pulleamos las ideas de la tabla marketing_ideas (post fase 5) y las
  // re-attacheamos a cada producto.bandejaIdeas. Esto mantiene compatibilidad
  // con el código viejo (Bandeja.jsx lee producto.bandejaIdeas) mientras la
  // source of truth pasa a ser una tabla per-row sin race conditions.
  try {
    const { data: ideasRows } = await supabase
      .from('marketing_ideas')
      .select('id, producto_id, data, updated_at')
      .order('updated_at', { ascending: false });
    if (Array.isArray(ideasRows) && ideasRows.length > 0) {
      const byProducto = new Map();
      for (const row of ideasRows) {
        const pid = row.producto_id ? String(row.producto_id) : null;
        if (!pid) continue;
        const idea = { ...(row.data || {}), id: row.id, productoId: pid };
        const list = byProducto.get(pid) || [];
        list.push(idea);
        byProducto.set(pid, list);
      }
      // Pisamos producto.bandejaIdeas con la versión de la tabla. Si la
      // tabla no tiene ideas para un producto y el producto SÍ tenía
      // bandejaIdeas legacy (caso pre-migración), las preservamos —
      // serán migradas por migrateBandejaIdeasFromProductos.
      productosArr.forEach((p, idx) => {
        const fromTable = byProducto.get(String(p.id));
        if (fromTable) {
          productosArr[idx] = { ...p, bandejaIdeas: fromTable };
        }
      });
      // Sweep de orphans: cualquier idea que ya esté en marketing_ideas se
      // remueve del ORPHAN_KEY (sino loadIdeas la mostraría duplicada y el
      // orphan key crecería indefinidamente).
      try {
        const ORPHAN_KEY = 'adslab-marketing-bandeja-orphan-v1';
        const raw = localStorage.getItem(ORPHAN_KEY);
        if (raw) {
          const orphans = JSON.parse(raw);
          if (Array.isArray(orphans) && orphans.length > 0) {
            const idsInTable = new Set(ideasRows.map(r => String(r.id)));
            const remaining = orphans.filter(o => !idsInTable.has(String(o?.id)));
            if (remaining.length < orphans.length) {
              localStorage.setItem(ORPHAN_KEY, JSON.stringify(remaining));
              console.info(`[sync] sweep orphans: ${orphans.length - remaining.length} reconciliados a marketing_ideas`);
            }
          }
        }
      } catch (err) {
        console.warn('[sync] sweep orphans falló:', err.message);
      }
      console.info(`[sync] re-attached ${ideasRows.length} ideas de marketing_ideas a productos`);
    }
  } catch (err) {
    console.warn('[sync] pull ideas falló (continuo igual):', err.message);
  }

  // ⚠️ SAFETY CRÍTICO: NUNCA degradar localStorage a una versión sparse.
  // El bug original guardaba {id, nombre, ...subset} cuando quota fallaba —
  // después, cualquier mutación (setAccentColor, addCompetidor) leía sparse
  // + modificaba + dispatchaba push → push subía sparse al cloud → CLOUD
  // WIPED. Ese fue el data-loss event histórico de este account.
  //
  // Nueva estrategia ante quota:
  //   1. Liberar caches no-críticos (skeleton-cache, creative-refresh-cache, etc.)
  //   2. Retry con la data FULL
  //   3. Si AÚN no entra, NO escribir nada — dejamos localStorage como
  //      estaba (puede estar stale pero NO sparse). Loggeamos error crítico.
  //      NO disparamos push.
  try {
    localStorage.setItem(KEYS.productos, JSON.stringify(productosArr));
    if (mergeOccurred) {
      window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', {
        detail: { key: KEYS.productos },
      }));
    }
    console.info(`[sync] localStorage productos actualizado: ${productosArr.length} productos, ${JSON.stringify(productosArr).length} bytes`);
  } catch (e) {
    console.warn('[sync] localStorage write falló (quota?):', e.message, '— liberando cache y retry');
    // 1) Liberar caches.
    try { localStorage.removeItem('adslab-marketing-skeleton-cache'); } catch {}
    try { localStorage.removeItem('adslab-marketing-creative-refresh-cache'); } catch {}
    try { localStorage.removeItem('adslab-marketing-execution-log'); } catch {}
    try { localStorage.removeItem('adslab-marketing-cost-log'); } catch {}
    // 2) Retry full data.
    try {
      localStorage.setItem(KEYS.productos, JSON.stringify(productosArr));
      console.info(`[sync] localStorage escrito tras liberar caches: ${productosArr.length} productos`);
      if (mergeOccurred) {
        window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', {
          detail: { key: KEYS.productos },
        }));
      }
    } catch (e2) {
      // 3) NO degradar. Dejar localStorage intacto (versión previa) → push
      //    no se gatilla → cloud queda con la versión actual (segura).
      console.error('[sync] 🔴 CRÍTICO: localStorage lleno tras liberar caches. NO degradando a sparse para no wipear cloud. Dejando versión anterior:', e2.message);
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
// Strip bandejaIdeas del producto antes de pushear — desde fase 5 la source
// of truth es la tabla marketing_ideas. Si dejamos el inline array, el push
// constante de producto pisa el cloud con la versión local (race) y la tabla
// y el array divergen.
function stripIdeas(producto) {
  if (!producto || typeof producto !== 'object') return producto;
  const { bandejaIdeas, ...rest } = producto;
  return rest;
}

export async function pushProducto(producto) {
  if (!supabase) throw new Error('Supabase no configurado');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay user logueado');
  // ANTI-WIPE: chequear regresión de tamaño contra cloud actual.
  const stripped = stripIdeas(producto);
  const localSize = JSON.stringify(stripped).length;
  try {
    const { data: cloudCurrent } = await supabase
      .from('marketing_productos')
      .select('data')
      .eq('user_id', user.id)
      .eq('id', String(producto.id))
      .maybeSingle();
    const cloudSize = cloudCurrent?.data ? JSON.stringify(cloudCurrent.data).length : 0;
    if (cloudSize > 500 && localSize < cloudSize * 0.5) {
      console.error(`[sync] 🔴 ANTI-WIPE: skip push de producto ${producto.id} (${producto.nombre}) por regresión: local ${localSize}B vs cloud ${cloudSize}B`);
      return;
    }
  } catch (err) {
    console.warn('[sync] pushProducto pre-check falló — pusheando sin guard:', err.message);
  }
  const { error } = await supabase
    .from('marketing_productos')
    .upsert({
      id: String(producto.id),
      user_id: user.id,
      data: stripped,
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
  // ⚠️ GUARD ANTI-WIPE: para cada producto, traemos el tamaño actual del
  // cloud. Si lo que estamos por pushear es <50% del cloud Y el cloud tiene
  // data significativa (>500 bytes), es señal de que localStorage perdió
  // data (quota fallback histórico, race condition) y este push wipearía
  // el cloud. En ese caso lo SKIPEAMOS por producto.
  //
  // El usuario verá un warning en consola y sabrá que su localStorage está
  // sparse. La data del cloud queda intacta hasta que el smart-merge en el
  // próximo pull la traiga de vuelta a local.
  let cloudSizes = new Map();
  try {
    const { data: cloudCurrent } = await supabase
      .from('marketing_productos')
      .select('id, data')
      .eq('user_id', user.id)
      .in('id', productos.map(p => String(p.id)));
    for (const row of cloudCurrent || []) {
      const size = JSON.stringify(row.data || {}).length;
      cloudSizes.set(String(row.id), size);
    }
  } catch (err) {
    console.warn('[sync] pre-push cloud check falló — pusheo sin guard de regresión:', err.message);
  }

  const safe = [];
  const skipped = [];
  for (const p of productos) {
    const stripped = stripIdeas(p);
    const localSize = JSON.stringify(stripped).length;
    const cloudSize = cloudSizes.get(String(p.id)) || 0;
    // Heurística: cloud tiene data sustancial (>500B) Y local es menos de
    // la mitad → regresión sospechosa, skipear.
    if (cloudSize > 500 && localSize < cloudSize * 0.5) {
      skipped.push({ id: p.id, nombre: p.nombre, localSize, cloudSize });
    } else {
      safe.push(stripped);
    }
  }

  if (skipped.length > 0) {
    console.error(
      `[sync] 🔴 ANTI-WIPE: skipeando push de ${skipped.length} productos por regresión de tamaño (local << cloud). Probablemente localStorage está sparse y este push wipearía cloud:`,
      skipped
    );
  }

  if (safe.length === 0) {
    console.warn('[sync] push: todos los productos fueron skipeados por anti-wipe, no se pushea nada');
    return;
  }

  const rows = safe.map(p => ({
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
