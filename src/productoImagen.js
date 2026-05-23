// Foto real del producto — la sube el user y se usa como referencia en la
// generación de creativos estáticos (gpt-image-1 /images/edits), para que
// el envase del creativo sea el producto real y no uno inventado.
//
// Se guarda comprimida (JPEG, máx 1024px) en localStorage, con una key por
// producto. Comprimir es clave: una foto cruda de celular pesa varios MB y
// reventaría el límite de localStorage.

const KEY = (id) => `viora-producto-img-${id}`;

export function getProductoImagen(id) {
  if (!id) return null;
  try { return localStorage.getItem(KEY(id)) || null; } catch { return null; }
}

export function setProductoImagen(id, dataUrl) {
  if (!id) throw new Error('Producto sin id');
  try {
    localStorage.setItem(KEY(id), dataUrl);
  } catch {
    throw new Error('No se pudo guardar la imagen — el almacenamiento está lleno. Probá con una foto más liviana.');
  }
}

export function removeProductoImagen(id) {
  if (!id) return;
  try { localStorage.removeItem(KEY(id)); } catch { /* noop */ }
}

// --- Datos de marketing del producto --------------------------------
// Badge, rating y reseñas que se componen encima de TODOS los creativos
// del producto (set una vez, se aplica a todos).

const MKT_KEY = (id) => `viora-producto-mkt-${id}`;

export function getDatosMarketing(id) {
  if (!id) return null;
  try {
    const v = JSON.parse(localStorage.getItem(MKT_KEY(id)) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

export function setDatosMarketing(id, data) {
  if (!id) return;
  try { localStorage.setItem(MKT_KEY(id), JSON.stringify(data || {})); } catch { /* noop */ }
}

// --- Paleta de marca -------------------------------------------------
// Colores de marca (de la landing y del producto) que se inyectan en el
// prompt de generación de creativos para que sean coherentes con la marca.

const PALETA_KEY = (id) => `viora-producto-paleta-${id}`;

export function getPaletaMarca(id) {
  if (!id) return [];
  try {
    const v = JSON.parse(localStorage.getItem(PALETA_KEY(id)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function setPaletaMarca(id, colores) {
  if (!id) return;
  try { localStorage.setItem(PALETA_KEY(id), JSON.stringify(colores || [])); } catch { /* noop */ }
}

// Extrae hasta 4 colores dominantes de un data URL, descartando blancos,
// negros y grises (poca saturación) — así toma los colores "de marca"
// reales del producto y no el fondo blanco.
export function extraerColores(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve([]);
    img.onload = () => {
      const N = 48;
      const canvas = document.createElement('canvas');
      canvas.width = N;
      canvas.height = N;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, N, N);
      let data;
      try { data = ctx.getImageData(0, 0, N, N).data; } catch { resolve([]); return; }
      const buckets = {};
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 200) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max > 235 && min > 235) continue; // casi blanco
        if (max < 30) continue;               // casi negro
        if (max - min < 24) continue;          // gris (poca saturación)
        const key = `${r >> 5},${g >> 5},${b >> 5}`;
        if (!buckets[key]) buckets[key] = { count: 0, r: 0, g: 0, b: 0 };
        buckets[key].count++;
        buckets[key].r += r; buckets[key].g += g; buckets[key].b += b;
      }
      const top = Object.values(buckets)
        .sort((a, b) => b.count - a.count)
        .slice(0, 4)
        .map(bk => {
          const r = Math.round(bk.r / bk.count);
          const g = Math.round(bk.g / bk.count);
          const b = Math.round(bk.b / bk.count);
          return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        });
      resolve(top);
    };
    img.src = dataUrl;
  });
}

// Comprime un File de imagen a un data URL JPEG. Reescala al lado mayor
// `maxLado` y aplana sobre fondo blanco (por si el PNG trae transparencia).
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
