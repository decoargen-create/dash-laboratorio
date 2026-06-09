// Extrae una paleta de colores dominantes de una imagen del producto.
//
// Algoritmo (todo client-side, sin API costs):
// 1. Cargar imagen en un canvas chico (120×120) para no procesar millones
//    de pixels en producto fotos 4K.
// 2. Loop por cada pixel:
//    - Skip transparencia (alpha < 200)
//    - Skip casi-blanco (max > 240) y casi-negro (max < 20) — son fondos
//    - Skip grises (chroma = max - min < 30) — son sombras / fondos
// 3. Quantizar a buckets de 32×32×32 (5 bits por canal) y contar
//    frecuencias. Esto agrupa colores visualmente similares.
// 4. Promediar el RGB DE CADA BUCKET (no usar el centro del bucket — eso
//    da colores menos fieles a la foto real).
// 5. Sort por frecuencia desc, devolver top N como hex.
//
// Devuelve array de strings "#rrggbb" — vacío si no hay colores con chroma
// suficiente (ej. foto B&N, packaging gris).

const SAMPLE_SIZE = 120;

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Carga la imagen y devuelve sus pixel data del canvas reducido.
function loadImagePixels(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin es noop para data: URIs pero requerido para http(s).
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('No pude cargar la imagen para extraer paleta'));
    img.src = dataUrl;
  });
}

export async function extractPalette(dataUrl, count = 5) {
  if (!dataUrl) return [];
  let data;
  try {
    data = await loadImagePixels(dataUrl);
  } catch (err) {
    console.warn('[palette] error:', err.message);
    return [];
  }

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 240) continue;          // casi blanco — fondo
    if (max < 20) continue;           // casi negro
    if (max - min < 30) continue;     // gris (low chroma)

    // Quantize a 5 bits por canal (>> 3 → 0-31). 32K buckets máx.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.r += r;
      existing.g += g;
      existing.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  return Array.from(buckets.values())
    .map(b => ({
      r: Math.round(b.r / b.count),
      g: Math.round(b.g / b.count),
      b: Math.round(b.b / b.count),
      count: b.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, count)
    .map(c => rgbToHex(c.r, c.g, c.b));
}
