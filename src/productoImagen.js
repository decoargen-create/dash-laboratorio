// Foto real del producto — se usa como referencia visual en la generación
// de creativos (gpt-image-2 /images/edits). Se guarda comprimida en
// localStorage por producto.

const KEY = (id) => `viora-producto-img-${id}`;
const ACCENT_KEY = (id) => `viora-producto-accent-${id}`;

export function getProductoImagen(id) {
  if (!id) return null;
  try { return localStorage.getItem(KEY(id)) || null; } catch { return null; }
}

export function setProductoImagen(id, dataUrl) {
  if (!id) throw new Error('Producto sin id');
  try {
    localStorage.setItem(KEY(id), dataUrl);
  } catch {
    throw new Error('No se pudo guardar la imagen — almacenamiento lleno. Probá con una foto más liviana.');
  }
}

export function removeProductoImagen(id) {
  if (!id) return;
  try { localStorage.removeItem(KEY(id)); } catch { /* noop */ }
}

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
