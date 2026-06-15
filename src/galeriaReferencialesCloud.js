// Capa cloud para la galería de creativos — Supabase Storage (bytes) +
// marketing_creativos (metadata + flags).
//
// La galería se sincroniza así:
// - Al guardar: imagen sube al bucket 'creativos/<user_id>/<id>.png', y
//   los metadatos (incluyendo public URL) se persisten en la tabla.
// - Al leer: query a la tabla. La imagen se renderiza directo desde
//   `image_url` (URL pública del bucket).
//
// La capa IDB local (galeriaReferenciales.js) sigue funcionando como
// caché para velocidad y offline. La fuente de verdad es el cloud cuando
// el user está logueado.

import { supabase, getCurrentUser } from './supabase.js';

const BUCKET = 'creativos';

// ¿Está habilitado el modo cloud? (supabase configurado + user logueado)
// Cacheamos el resultado para no hacer un round-trip a auth.getUser() en
// cada save/read/count. Cada cambio de auth invalida el cache via
// onAuthStateChange. Antes, en bulk de N variantes IDB-fallback se llamaba
// N veces y cada llamada era ~50-200ms de latencia.
//
// EDGE CASE: en SIGNED_OUT explícito reseteamos a null (no false) para que
// el próximo isCloudReady() vuelva a leer la sesión real. Antes, después
// de un sign-out el cache quedaba true para todas las in-flight saves
// hasta que onAuthStateChange disparara — y por timing eso podía hacer
// que un write intentara cloud cuando ya no había auth.
let _cloudReadyCache = null;
if (typeof window !== 'undefined' && supabase) {
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        _cloudReadyCache = false;
      } else {
        _cloudReadyCache = !!session?.user;
      }
    });
  } catch {}
}
export async function isCloudReady() {
  if (!supabase) return false;
  if (_cloudReadyCache !== null) return _cloudReadyCache;
  const user = await getCurrentUser();
  _cloudReadyCache = !!user;
  return _cloudReadyCache;
}

// Re-firma signed URLs justo antes de descargar. Las URLs generadas al
// cargar la galería tienen TTL de 1h — si el user demora más en hacer
// click en "Descargar ZIP", las URLs expiran y devuelven 403 con un body
// JSON de ~90 bytes que se guardaba como .png corrupto en el ZIP.
//
// Recibe items con `storagePath` y devuelve los mismos items con
// `imageUrl` reemplazada por una signed URL fresca de 5min de validez.
// Si no hay storagePath (items legacy IDB), deja imageUrl como está.
export async function refreshSignedUrls(items) {
  if (!supabase || !Array.isArray(items) || items.length === 0) return items;
  const conPath = items.filter(it => it?.storagePath);
  if (conPath.length === 0) return items;
  try {
    const { data: signedList, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(conPath.map(it => it.storagePath), 300);
    if (error || !Array.isArray(signedList)) return items;
    const byPath = new Map(signedList.map(s => [s.path, s.signedUrl]));
    return items.map(it => {
      const fresh = it?.storagePath ? byPath.get(it.storagePath) : null;
      return fresh ? { ...it, imageUrl: fresh } : it;
    });
  } catch {
    return items;
  }
}

// Convierte base64 puro a Blob para subir al Storage.
function base64ToBlob(b64, mimeType = 'image/png') {
  const byteChars = atob(b64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

// Sube imagen al bucket y devuelve { storagePath, imageUrl }.
async function uploadImageToBucket(userId, refId, imageBase64, mimeType) {
  if (!supabase) throw new Error('Supabase no configurado');
  const blob = base64ToBlob(imageBase64, mimeType || 'image/png');
  const path = `${userId}/${refId}.png`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: mimeType || 'image/png',
      upsert: true, // si re-subimos con el mismo id, sobreescribir
    });
  if (error) throw new Error(`Upload a Storage falló: ${error.message}`);
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) {
    throw new Error(`getPublicUrl devolvió vacío para ${path} — bucket no está marcado público?`);
  }
  return { storagePath: path, imageUrl: publicUrl };
}

// Guarda un referencial en cloud: bytes → Storage, metadata → DB.
// Devuelve el ref enriquecido con storage_path + image_url.
export async function saveReferencialCloud(ref) {
  if (!ref?.id) throw new Error('saveReferencialCloud: falta id');
  if (!ref?.imageBase64) throw new Error('saveReferencialCloud: falta imageBase64');
  const user = await getCurrentUser();
  if (!user) throw new Error('No hay sesión Supabase');

  const { storagePath, imageUrl } = await uploadImageToBucket(
    user.id, ref.id, ref.imageBase64, ref.mimeType
  );

  const row = {
    id: String(ref.id),
    user_id: user.id,
    producto_id: ref.productoId != null ? String(ref.productoId) : null,
    source_ad_id: ref.sourceAdId || null,
    source_brand: ref.sourceBrand || null,
    source_image_url: ref.sourceImageUrl || null,
    source_headline: ref.sourceHeadline || null,
    source_type: ref.sourceType || 'inspiracion',
    variant_index: ref.variantIndex != null ? Number(ref.variantIndex) : null,
    variant_style: ref.variantStyle || null,
    prompt: ref.prompt || null,
    skeleton: ref.skeleton || null,
    model: ref.model || null,
    vision_model: ref.visionModel || null,
    size: ref.size || null,
    size_fallback: !!ref.sizeFallback,
    quality: ref.quality || null,
    storage_path: storagePath,
    image_url: imageUrl,
    mime_type: ref.mimeType || 'image/png',
    descargada: !!ref.descargada,
    descargada_at: ref.descargadaAt || null,
    archivado: !!ref.archivado,
    archivado_at: ref.archivadoAt || null,
    created_at: ref.createdAt || new Date().toISOString(),
  };

  const { error } = await supabase
    .from('marketing_creativos')
    .upsert(row, { onConflict: 'user_id,id' });
  if (error) throw new Error(`Insert en marketing_creativos falló: ${error.message}`);

  return { ...ref, storagePath, imageUrl };
}

// Map row de la tabla → shape compatible con la API existente de la galería.
function rowToRef(row) {
  if (!row) return null;
  return {
    id: row.id,
    productoId: row.producto_id,
    sourceAdId: row.source_ad_id,
    sourceBrand: row.source_brand,
    sourceImageUrl: row.source_image_url,
    sourceHeadline: row.source_headline,
    sourceType: row.source_type,
    variantIndex: row.variant_index,
    variantStyle: row.variant_style,
    prompt: row.prompt,
    skeleton: row.skeleton,
    model: row.model,
    visionModel: row.vision_model,
    size: row.size,
    sizeFallback: row.size_fallback,
    quality: row.quality,
    storagePath: row.storage_path,
    imageUrl: row.image_url,        // ← consumers usan esto en vez de imageBase64
    mimeType: row.mime_type,
    descargada: row.descargada,
    descargadaAt: row.descargada_at,
    archivado: row.archivado,
    archivadoAt: row.archivado_at,
    winner: !!row.winner,
    winnerAt: row.winner_at,
    winnerMetrics: row.winner_metrics || null,
    createdAt: row.created_at,
    // updated_at lo usa el merge cloud+IDB para decidir qué lado es más
    // fresco para los flags (winner/descargada/archivado). El trigger
    // touch_updated_at() en la DB lo bumpea automático en cada UPDATE.
    updatedAt: row.updated_at,
  };
}

// Lista creativos del producto. Soporta `includeArchived`, `onlyWinners`.
export async function getReferencialesByProductoCloud(productoId, opts = {}) {
  if (!supabase) return [];
  const { includeArchived = false, onlyWinners = false } = opts;
  const user = await getCurrentUser();
  if (!user) return [];

  let query = supabase
    .from('marketing_creativos')
    .select('*')
    .eq('producto_id', String(productoId))
    .order('created_at', { ascending: false });
  if (!includeArchived) query = query.eq('archivado', false);
  if (onlyWinners) query = query.eq('winner', true);

  const { data, error } = await query;
  if (error) {
    console.warn('[galería cloud] query error:', error.message);
    return [];
  }
  // PRIVATE BUCKET FIX: el bucket 'creativos' es privado → la public URL
  // guardada en row.image_url da 400/403 al cargar como <img src>. Generamos
  // signed URLs (1 hora de validez) para los items con storage_path. Si el
  // signing falla, dejamos la public URL como fallback (puede funcionar si
  // alguien hizo público el bucket después).
  const items = (data || []).map(rowToRef);
  const itemsConStoragePath = items.filter(it => it.storagePath);
  if (itemsConStoragePath.length > 0) {
    try {
      const { data: signedList, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(itemsConStoragePath.map(it => it.storagePath), 3600);
      if (!signErr && Array.isArray(signedList)) {
        const byPath = new Map(signedList.map(s => [s.path, s.signedUrl]));
        for (const it of items) {
          const signed = byPath.get(it.storagePath);
          if (signed) it.imageUrl = signed;
        }
      }
    } catch (err) {
      console.warn('[galería cloud] signed URL falló:', err.message);
    }
  }
  return items;
}

// Lista TODOS los winners del usuario, de TODOS sus productos (galería global
// de winners). Cada winner trae su imageUrl + skeleton + prompt, así se puede
// replicar para otro producto sin re-extraer el esqueleto con Vision.
export async function listAllWinnersCloud() {
  if (!supabase) return [];
  const user = await getCurrentUser();
  if (!user) return [];

  // NO filtramos por archivado: un winner archivado sigue siendo winner que
  // el user quiere ver/replicar (de hecho suele marcarse winner DESDE la
  // pestaña Archivados — "ganador histórico"). Mostramos todos.
  // Sin .eq('user_id') explícito: RLS ya restringe a auth.uid()=user_id, y así
  // matchea exactamente el patrón de la query del producto (que SÍ trae los
  // winners). Filtrar de más por user_id era un sospechoso de excluir filas.
  const { data, error } = await supabase
    .from('marketing_creativos')
    .select('*')
    .eq('winner', true)
    .order('winner_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[winners cloud] query error:', error.message);
    return [];
  }
  // Mismo fix de signed URLs que getReferencialesByProductoCloud — el bucket
  // privado rompe los <img src> sin esto.
  const items = (data || []).map(rowToRef);
  const itemsConStoragePath = items.filter(it => it.storagePath);
  if (itemsConStoragePath.length > 0) {
    try {
      const { data: signedList, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(itemsConStoragePath.map(it => it.storagePath), 3600);
      if (!signErr && Array.isArray(signedList)) {
        const byPath = new Map(signedList.map(s => [s.path, s.signedUrl]));
        for (const it of items) {
          const signed = byPath.get(it.storagePath);
          if (signed) it.imageUrl = signed;
        }
      }
    } catch (err) {
      console.warn('[winners cloud] signed URL falló:', err.message);
    }
  }
  return items;
}

export async function countReferencialesByProductoCloud(productoId) {
  if (!supabase) return { total: 0, active: 0, archived: 0, downloaded: 0, winners: 0 };
  const user = await getCurrentUser();
  if (!user) return { total: 0, active: 0, archived: 0, downloaded: 0, winners: 0 };

  // 4 queries paralelas para los conteos. Filtramos por user_id además
  // de RLS — defense-in-depth contra una eventual misconfig de policy.
  // allSettled: si una columna no existe en prod (ej. migration 0007
  // pendiente), las otras 3 igual devuelven valor — antes Promise.all
  // rejectaba todo y el modal mostraba "Todos 0" engañoso.
  const pid = String(productoId);
  const results = await Promise.allSettled([
    supabase.from('marketing_creativos').select('id', { count: 'exact', head: true }).eq('producto_id', pid).eq('user_id', user.id),
    supabase.from('marketing_creativos').select('id', { count: 'exact', head: true }).eq('producto_id', pid).eq('user_id', user.id).eq('archivado', true),
    supabase.from('marketing_creativos').select('id', { count: 'exact', head: true }).eq('producto_id', pid).eq('user_id', user.id).eq('descargada', true),
    supabase.from('marketing_creativos').select('id', { count: 'exact', head: true }).eq('producto_id', pid).eq('user_id', user.id).eq('winner', true),
  ]);
  const pick = (r) => r.status === 'fulfilled' ? (r.value?.count || 0) : 0;
  const t = pick(results[0]);
  const a = pick(results[1]);
  const d = pick(results[2]);
  const w = pick(results[3]);
  if (results[3].status === 'rejected') {
    console.warn('[galería cloud] count winners falló (¿migration 0007 aplicada?):', results[3].reason?.message || results[3].reason);
  }
  return { total: t, active: t - a, archived: a, downloaded: d, winners: w };
}

// Set de sourceAdId que ya fueron usados para generar (para marcar en Inspiración).
export async function getUsedAdIdsForProductoCloud(productoId) {
  if (!supabase) return new Set();
  const user = await getCurrentUser();
  if (!user) return new Set();
  const { data, error } = await supabase
    .from('marketing_creativos')
    .select('source_ad_id')
    .eq('producto_id', String(productoId))
    .not('source_ad_id', 'is', null);
  if (error) return new Set();
  const set = new Set();
  for (const row of data || []) {
    if (row.source_ad_id) set.add(String(row.source_ad_id));
  }
  return set;
}

export async function patchReferencialesCloud(ids, patch) {
  if (!Array.isArray(ids) || ids.length === 0 || !patch) return 0;
  if (!supabase) return 0;
  const user = await getCurrentUser();
  if (!user) return 0;

  // Map del shape de patch al de la tabla (camelCase → snake_case parcial).
  const dbPatch = {};
  if ('descargada' in patch) dbPatch.descargada = patch.descargada;
  if ('descargadaAt' in patch) dbPatch.descargada_at = patch.descargadaAt;
  if ('archivado' in patch) dbPatch.archivado = patch.archivado;
  if ('archivadoAt' in patch) dbPatch.archivado_at = patch.archivadoAt;
  if ('winner' in patch) dbPatch.winner = patch.winner;
  if ('winnerAt' in patch) dbPatch.winner_at = patch.winnerAt;
  if ('winnerMetrics' in patch) dbPatch.winner_metrics = patch.winnerMetrics;

  if (Object.keys(dbPatch).length === 0) return 0;

  const { data, error } = await supabase
    .from('marketing_creativos')
    .update(dbPatch)
    .in('id', ids.map(String))
    .select('id');
  if (error) {
    console.warn('[galería cloud] patch error:', error.message);
    // Errores de schema (columna inexistente) son los que rompen winner y
    // tarda en notarse. Re-throw para que el caller pueda mostrar toast.
    // Antes era silencioso → user clickeaba la copa, no pasaba nada, y no
    // había forma de enterarse hasta abrir DevTools.
    if (/column .* does not exist/i.test(error.message)) {
      const err = new Error(`Falta aplicar una migration en Supabase: ${error.message}`);
      err.code = 'schema_missing';
      throw err;
    }
    return 0;
  }
  return (data || []).length;
}

export async function archiveReferencialCloud(id, archived = true) {
  return patchReferencialesCloud([id], archived
    ? { archivado: true, archivadoAt: new Date().toISOString() }
    : { archivado: false, archivadoAt: null }
  ).then(n => n > 0);
}

// Borrar: limpia tanto el row de la tabla como el archivo del Storage.
// Defensive: filtramos por user_id en cada query además de RLS, para que un
// id de otro usuario nunca pueda borrar nada accidentalmente.
export async function deleteReferencialCloud(id) {
  if (!supabase || !id) return false;
  const user = await getCurrentUser();
  if (!user) return false;

  // Primero buscar el storage_path antes de borrar el row. Filtramos por
  // user_id explícitamente — sin esto un .eq('id', X) podría matchear un row
  // de otro user si RLS estuviera mal configurada (defense-in-depth).
  const { data: row } = await supabase
    .from('marketing_creativos')
    .select('storage_path, user_id')
    .eq('id', String(id))
    .eq('user_id', user.id)
    .maybeSingle();

  if (!row) {
    // No existe o no es del user actual — no borrar nada.
    return false;
  }

  if (row.storage_path) {
    try {
      await supabase.storage.from(BUCKET).remove([row.storage_path]);
    } catch (err) {
      console.warn('[galería cloud] no pude borrar del Storage:', err.message);
      // Seguimos al delete del row de todos modos.
    }
  }
  const { error } = await supabase
    .from('marketing_creativos')
    .delete()
    .eq('id', String(id))
    .eq('user_id', user.id);
  return !error;
}
