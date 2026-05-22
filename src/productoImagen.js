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
