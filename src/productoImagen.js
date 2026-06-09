// Foto real del producto — se usa como referencia visual en la generación
// de creativos (gpt-image-2 /images/edits).
//
// STORAGE: IndexedDB (cuota de cientos de MB) en vez de localStorage
// (cuota ~5-10MB). Antes con 2-3 productos llenábamos localStorage y el
// uploader fallaba con "almacenamiento lleno". Ahora cabe casi sin límite.
//
// Compat back: si hay imágenes en localStorage de versiones previas, las
// migramos lazy al primer read (y removemos de localStorage para liberar).
//
// API:
//   getProductoImagen(id) → Promise<string|null>  (data URL)
//   setProductoImagen(id, dataUrl) → Promise<void>
//   removeProductoImagen(id) → Promise<void>
//
// accentColor sigue en localStorage — es solo ~7 caracteres, no pesa.

const DB_NAME = 'adslab-producto-imagenes';
const DB_VERSION = 1;
const STORE = 'imagenes';

const LEGACY_KEY = (id) => `adslab-producto-img-${id}`;
const ACCENT_KEY = (id) => `adslab-producto-accent-${id}`;

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

export async function getProductoImagen(id) {
  if (!id) return null;
  const key = String(id);
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
  return null;
}

export async function setProductoImagen(id, dataUrl) {
  if (!id) throw new Error('Producto sin id');
  if (!dataUrl) throw new Error('Sin dataUrl');
  const key = String(id);
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: key, dataUrl, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    memCache.set(key, dataUrl);
    // Limpiar legacy localStorage si quedó algo de versiones viejas.
    try { localStorage.removeItem(LEGACY_KEY(id)); } catch {}
  } catch (err) {
    throw new Error('No se pudo guardar la imagen: ' + err.message);
  }
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
}

// Accent color sigue en localStorage — son ~7 bytes, no pesa nada.
export function getAccentColor(id) {
  if (!id) return '';
  try { return localStorage.getItem(ACCENT_KEY(id)) || ''; } catch { return ''; }
}

export function setAccentColor(id, color) {
  if (!id) return;
  try {
    if (color) localStorage.setItem(ACCENT_KEY(id), color);
    else localStorage.removeItem(ACCENT_KEY(id));
  } catch { /* noop */ }
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
