// Foto real del producto — sincronizada entre devices vía Supabase Storage.
//
// FLUJO:
// - setProductoImagen(id, dataUrl):
//     1) Guarda en IndexedDB local (cache rápido).
//     2) Sube los bytes al bucket "creativos" path "<uid>/producto-fotos/<id>.jpg".
//        (el uid va PRIMERO: la policy RLS exige foldername[1] = auth.uid()).
//     3) Guarda la URL pública en producto.data.fotoUrl (sync via producto sync).
// - getProductoImagen(id):
//     1) Cache en memoria (mem map).
//     2) IDB local.
//     3) Fallback legacy localStorage + migración lazy.
//     4) producto.data.fotoUrl del cloud → fetch + cachea en IDB.
//     5) null.
//
// accentColor: ahora vive en producto.data.accentColor para que sincronice
// cross-device. localStorage se mantiene como fallback de migración.

import { supabase, getCurrentUser } from './supabase.js';
import { logEvent } from './debugLog.js';

const DB_NAME = 'adslab-producto-imagenes';
const DB_VERSION = 1;
const STORE = 'imagenes';

const LEGACY_KEY = (id) => `adslab-producto-img-${id}`;
const ACCENT_KEY = (id) => `adslab-producto-accent-${id}`;
const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const BUCKET = 'creativos';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Cache en memoria — muchos consumers (InspiracionSection, Bandeja, etc.)
// piden la imagen varias veces por sesión. Sin esto, cada llamada hace un
// round-trip a IDB. Con cache es instant tras la primera lectura.
const memCache = new Map();

// Helpers: leer/escribir producto.data via localStorage.
function readProducto(id) {
  try {
    const arr = JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]');
    return arr.find(p => String(p.id) === String(id)) || null;
  } catch { return null; }
}

function patchProducto(id, patch) {
  try {
    const arr = JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]');
    const target = arr.find(p => String(p.id) === String(id));
    if (!target) {
      // Producto NO está en localStorage — caso típico: PC nueva donde el
      // pull aún no completó, o IDB tiene foto de producto borrado en cloud.
      // Antes esto silenciosamente perdía el patch (no se persistía fotoUrl).
      // Ahora fallback async: fetch del cloud, patch, upsert. Sin bloquear
      // el caller sync.
      console.warn(`[productoImagen] patchProducto: producto ${id} no está en localStorage — fallback async a cloud`);
      patchProductoCloudFallback(id, patch).catch(err => {
        console.warn(`[productoImagen] patchProductoCloud fallback falló para ${id}:`, err.message);
      });
      return false;
    }
    const updated = arr.map(p => String(p.id) === String(id) ? { ...p, ...patch, updated_at: new Date().toISOString() } : p);
    localStorage.setItem(PRODUCTOS_KEY, JSON.stringify(updated));
    // Notificar al sync para que pushee al cloud.
    window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', {
      detail: { key: PRODUCTOS_KEY },
    }));
    return true;
  } catch (err) {
    console.warn('[productoImagen] patchProducto falló:', err.message);
    return false;
  }
}

// Fallback: producto no está en localStorage pero sí en cloud (cross-device
// race). Patcheamos directo via upsert. Próximo pull trae la versión patcheada.
async function patchProductoCloudFallback(id, patch) {
  if (!supabase) return;
  const user = await getCurrentUser();
  if (!user) return;
  const { data: row, error: fetchErr } = await supabase
    .from('marketing_productos')
    .select('data')
    .eq('user_id', user.id)
    .eq('id', String(id))
    .maybeSingle();
  if (fetchErr || !row?.data) {
    console.warn(`[productoImagen] cloud fallback: producto ${id} tampoco está en cloud`);
    return;
  }
  const merged = { ...row.data, ...patch, updated_at: new Date().toISOString() };
  const { error: upErr } = await supabase
    .from('marketing_productos')
    .upsert({ id: String(id), user_id: user.id, data: merged }, { onConflict: 'user_id,id' });
  if (upErr) throw new Error(upErr.message);
  console.info(`[productoImagen] patcheado directo en cloud (sin localStorage): producto ${id}`);
}

function dataUrlToBlob(dataUrl) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error('dataUrl inválido');
  const [, mime, base64] = match;
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

// Devuelve el path en el bucket — esto sigue siendo válido siempre porque
// es solo un string. La función pública resolverá vía SDK download (no fetch
// directo) ya que el bucket es PRIVADO y getPublicUrl() devuelve URLs que
// solo funcionan si el bucket es público. SDK download respeta las RLS
// policies y funciona para el dueño del path.
function pathFor(uid, productoId) {
  return `${uid}/producto-fotos/${String(productoId)}.jpg`;
}

// Baja la foto via Supabase SDK (no fetch directo). Como el bucket 'creativos'
// es privado, esta es la única forma confiable de obtener los bytes. El SDK
// usa las cookies de auth → RLS policy permite porque foldername[1]=auth.uid().
async function downloadFotoFromCloud(productoId) {
  if (!supabase) return null;
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const path = pathFor(user.id, productoId);
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(data);
    });
  } catch (err) {
    console.warn('[productoImagen] cloud download falló:', err.message);
    logEvent({ kind: 'fetch-error', label: `[producto-imagen] download exception: ${err.message}`, meta: { productoId } });
    return null;
  }
}

// Sube la foto al bucket Supabase. Devuelve la URL pública o null si falla.
async function uploadFotoToCloud(productoId, dataUrl) {
  if (!supabase) {
    logEvent({ kind: 'fetch-error', label: `[producto-imagen] sin supabase configurado`, meta: { productoId } });
    return null;
  }
  const user = await getCurrentUser();
  if (!user) {
    logEvent({ kind: 'fetch-error', label: `[producto-imagen] sin sesión auth — no se sube foto`, meta: { productoId } });
    return null;
  }
  try {
    const blob = dataUrlToBlob(dataUrl);
    // El uid VA PRIMERO en el path: la policy RLS del bucket exige
    // foldername(name)[1] = auth.uid(). Si anteponemos 'producto-fotos/'
    // el primer segmento pasa a ser 'producto-fotos' y RLS rechaza el upload
    // (fallaba en silencio → la foto nunca llegaba al cloud).
    const path = `${user.id}/producto-fotos/${String(productoId)}.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
    if (error) {
      console.warn('[productoImagen] cloud upload falló:', error.message);
      logEvent({
        kind: 'fetch-error',
        label: `[producto-imagen] upload falló: ${error.message}`,
        meta: { productoId, path, errorMsg: error.message, sizeBytes: blob.size },
      });
      return null;
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    logEvent({
      kind: 'fetch',
      label: `[producto-imagen] subido OK ${productoId}`,
      meta: { productoId, path, publicUrl: pub?.publicUrl?.slice(0, 200) },
    });
    return pub?.publicUrl || null;
  } catch (err) {
    console.warn('[productoImagen] cloud upload error:', err.message);
    logEvent({
      kind: 'fetch-error',
      label: `[producto-imagen] upload exception: ${err.message}`,
      meta: { productoId, error: err.message, stack: err.stack },
    });
    return null;
  }
}

// Convierte una URL pública a data URL — usado cuando IDB local no tiene
// la imagen pero producto.data.fotoUrl sí (caso "entré desde otra PC").
// IMPORTANTE: el bucket 'creativos' es PRIVADO. getPublicUrl() devuelve URLs
// que dan 400/403 al hacer fetch(). Si el fetch falla, caemos al SDK download
// que respeta auth + RLS. Esto arregla el bug "fotos no se ven en PC2".
async function dataUrlFromUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('[productoImagen] no pude bajar fotoUrl:', err.message);
    return null;
  }
}

// Migración lazy de fotos solo-locales al cloud: si la foto está en IDB pero
// producto.data.fotoUrl no existe (caso "foto subida en otra sesión antes
// del fix de sync"), la subimos al bucket y guardamos la URL. Una sola vez.
async function migrateLocalPhotoToCloud(id, dataUrl) {
  try {
    const producto = readProducto(id);
    if (producto?.fotoUrl) return; // ya migrada
    const url = await uploadFotoToCloud(id, dataUrl);
    if (url) {
      patchProducto(id, { fotoUrl: url, fotoUpdatedAt: new Date().toISOString() });
      console.info(`[productoImagen] migrado a cloud: producto ${id}`);
    }
  } catch (err) {
    console.warn('[productoImagen] migrate local→cloud falló:', err.message);
  }
}

// fallbackProducto: cuando el caller ya tiene el producto (ej: de
// useCloudProductos), puede pasarlo acá para evitar leer localStorage.
// Crítico para flujos cross-device donde localStorage aún no terminó
// de sincronizar pero el cloud ya devolvió producto.fotoUrl.
export async function getProductoImagen(id, fallbackProducto = null) {
  if (!id) return null;
  const key = String(id);
  // CACHE-BUST por fotoUpdatedAt: si la foto del cloud es más nueva que la
  // que tenemos local, invalidamos el cache para forzar re-download.
  // Sin esto PC2 mostraba la foto vieja para siempre si PC1 re-subía.
  try {
    const producto = fallbackProducto || readProducto(id);
    const cloudTs = producto?.fotoUpdatedAt ? Date.parse(producto.fotoUpdatedAt) : 0;
    if (cloudTs > 0) {
      const db = await openDB();
      const localRec = await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      const localTs = localRec?.updatedAt ? Date.parse(localRec.updatedAt) : 0;
      // Tolerancia 5s en vez de 1s: el upload background tras setProductoImagen
      // setea fotoUpdatedAt que típicamente queda 2-4s después del write local
      // → 1s de tolerancia disparaba re-download innecesario de la imagen
      // recién subida. 5s da margen para race natural del upload sin perder
      // la detección de actualizaciones reales cross-PC.
      if (cloudTs > localTs + 5000) {
        // Cloud más nuevo — invalidar cache local antes de devolver.
        memCache.delete(key);
        try {
          await new Promise((resolve) => {
            const txw = db.transaction(STORE, 'readwrite');
            txw.objectStore(STORE).delete(key);
            txw.oncomplete = () => resolve();
            txw.onerror = () => resolve();
          });
        } catch {}
      }
    }
  } catch {}
  if (memCache.has(key)) return memCache.get(key);
  // 1) Intentar IDB
  try {
    const db = await openDB();
    const dataUrl = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result?.dataUrl || null);
      req.onerror = () => reject(req.error);
    });
    if (dataUrl) {
      memCache.set(key, dataUrl);
      // Lazy migrate al cloud — en background, no bloquea.
      migrateLocalPhotoToCloud(id, dataUrl).catch(() => {});
      return dataUrl;
    }
  } catch (err) {
    console.warn('[productoImagen] IDB read falló:', err.message);
  }
  // 2) Fallback legacy localStorage + migración lazy a IDB
  try {
    const legacy = localStorage.getItem(LEGACY_KEY(id));
    if (legacy) {
      // Migrar a IDB en background — no bloqueamos al consumer.
      setProductoImagen(id, legacy).then(() => {
        try { localStorage.removeItem(LEGACY_KEY(id)); } catch {}
      }).catch(() => {});
      memCache.set(key, legacy);
      return legacy;
    }
  } catch {}
  // 3) Cloud — primero SDK download (funciona aunque el bucket sea privado),
  //    después fallback al fetch de fotoUrl (legacy). El SDK respeta RLS;
  //    fetch directo de getPublicUrl() FALLA con 400/403 si el bucket no
  //    es público — que es el caso actual. Por eso prioridad SDK.
  // Path típico "entré desde otra PC": el cloud tiene la foto pero el
  // IDB local está vacío.
  let dataUrl = await downloadFotoFromCloud(id);
  // Si SDK download falló (no auth, no archivo), probamos el fotoUrl legacy.
  if (!dataUrl) {
    const producto = fallbackProducto || readProducto(id);
    if (producto?.fotoUrl) {
      dataUrl = await dataUrlFromUrl(producto.fotoUrl);
    }
  }
  if (dataUrl) {
    try {
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id: key, dataUrl, updatedAt: new Date().toISOString() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
    memCache.set(key, dataUrl);
    return dataUrl;
  }
  return null;
}

export async function setProductoImagen(id, dataUrl) {
  if (!id) throw new Error('Producto sin id');
  if (!dataUrl) throw new Error('Sin dataUrl');
  const key = String(id);
  // 1) Guardar en IDB local (cache rápido)
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: key, dataUrl, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    memCache.set(key, dataUrl);
    try { localStorage.removeItem(LEGACY_KEY(id)); } catch {}
  } catch (err) {
    throw new Error('No se pudo guardar la imagen: ' + err.message);
  }
  // 2) Sincronizar al cloud (en background, no bloquea al UI)
  uploadFotoToCloud(id, dataUrl).then(url => {
    if (url) {
      // Persistir la URL en producto.data → sync gratis vía push de productos.
      patchProducto(id, { fotoUrl: url, fotoUpdatedAt: new Date().toISOString() });
    }
  }).catch(err => console.warn('[productoImagen] cloud sync background falló:', err.message));
}

export async function removeProductoImagen(id) {
  if (!id) return;
  const key = String(id);
  memCache.delete(key);
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
  try { localStorage.removeItem(LEGACY_KEY(id)); } catch {}
  // Borrar la URL del producto.data → sync.
  patchProducto(id, { fotoUrl: null, fotoUpdatedAt: null });
  // Borrar del bucket — best effort.
  if (supabase) {
    try {
      const user = await getCurrentUser();
      if (user) {
        await supabase.storage.from(BUCKET).remove([`${user.id}/producto-fotos/${String(id)}.jpg`]);
      }
    } catch {}
  }
}

// Accent color ahora vive en producto.data.accentColor para sync cross-device.
// localStorage queda como migración: si encontramos un accent viejo lo
// promocionamos a producto.data al primer read.
//
// fallbackProducto: cuando el caller tiene el producto (ej: de
// useCloudProductos), lo pasa acá para evitar leer localStorage —
// crítico para flujos cross-device donde localStorage aún no sincronizó.
export function getAccentColor(id, fallbackProducto = null) {
  if (!id) return '';
  const producto = fallbackProducto || readProducto(id);
  if (producto?.accentColor) return producto.accentColor;
  // Fallback legacy localStorage
  try {
    const legacy = localStorage.getItem(ACCENT_KEY(id));
    if (legacy) {
      // CRITICAL: solo migrar+borrar legacy si el producto existe en la lista
      // (es decir, el pull completó). Si readProducto devuelve null por
      // pull-aún-pendiente, NO borramos el legacy — lo dejamos para el
      // próximo read.
      if (producto) {
        patchProducto(id, { accentColor: legacy });
        try { localStorage.removeItem(ACCENT_KEY(id)); } catch {}
      } else {
        console.warn(`[productoImagen] accentColor legacy presente pero producto ${id} no está en localStorage aún — esperando pull`);
      }
      return legacy;
    }
  } catch {}
  return '';
}

export function setAccentColor(id, color) {
  if (!id) return;
  // Escribir en producto.data → sync gratis vía push.
  patchProducto(id, { accentColor: color || null });
  // Limpiar legacy localStorage si quedó. Solo después de patch exitoso.
  try { localStorage.removeItem(ACCENT_KEY(id)); } catch {}
}

// Comprime un File a data URL JPEG (max 1024px lado mayor) aplanado
// sobre fondo blanco. Ideal para fotos con fondo blanco del producto.
export function comprimirImagen(file, maxLado = 1024, calidad = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('El archivo no es una imagen'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxLado || height > maxLado) {
          const r = Math.min(maxLado / width, maxLado / height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
