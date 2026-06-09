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
let _cloudReadyCache = null;
if (typeof window !== 'undefined' && supabase) {
  // Si la sesión cambia (login, logout, refresh), reseteamos el cache.
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      _cloudReadyCache = !!session?.user;
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
    createdAt: row.created_at,
  };
}

// Lista creativos del producto. Soporta `includeArchived`.
export async function getReferencialesByProductoCloud(productoId, opts = {}) {
  if (!supabase) return [];
  const { includeArchived = false } = opts;
  const user = await getCurrentUser();
  if (!user) return [];

  let query = supabase
    .from('marketing_creativos')
    .select('*')
    .eq('producto_id', String(productoId))
    .order('created_at', { ascending: false });
  if (!includeArchived) query = query.eq('archivado', false);

  const { data, error } = await query;
  if (error) {
    console.warn('[galería cloud] query error:', error.message);
    return [];
  }
  return (data || []).map(rowToRef);
}

export async function countReferencialesByProductoCloud(productoId) {
  if (!supabase) return { total: 0, active: 0, archived: 0, downloaded: 0 };
  const user = await getCurrentUser();
  if (!user) return { total: 0, active: 0, archived: 0, downloaded: 0 };

  // 4 queries paralelas para los conteos. Simple y rápido.
  const [total, archived, downloaded] = await Promise.all([
    supabase.from('marketing_creativos').select('id', { count: 'exact', head: true }).eq('producto_id', String(productoId)),
    supabase.from('marketing_creativos').select('id', { count: 'exact', head: true }).eq('producto_id', String(productoId)).eq('archivado', true),
    supabase.from('marketing_creativos').select('id', { count: 'exact', head: true }).eq('producto_id', String(productoId)).eq('descargada', true),
  ]);
  const t = total.count || 0;
  const a = archived.count || 0;
  return { total: t, active: t - a, archived: a, downloaded: downloaded.count || 0 };
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

  if (Object.keys(dbPatch).length === 0) return 0;

  const { data, error } = await supabase
    .from('marketing_creativos')
    .update(dbPatch)
    .in('id', ids.map(String))
    .select('id');
  if (error) {
    console.warn('[galería cloud] patch error:', error.message);
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
