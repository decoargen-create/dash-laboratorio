// Export/import de un producto completo — para backup, migración entre
// cuentas, o duplicar un setup.
//
// Qué incluye el JSON:
// - El producto completo: nombre, descripción, landingUrl, docs, ofertasReales,
//   activoVisual, stage, competidores (con ads), metaAccount (sin tokens).
// - Brands manuales del producto (de localStorage por-producto).
// - Ideas del Bandeja filtradas por productoId.
// - Refs de creativos generados (metadata solamente — id, image_url, source,
//   variant, etc.). NO incluye los bytes de las imágenes (los bytes viven en
//   el bucket Supabase Storage; para mover entre cuentas habría que
//   re-descargar y re-subir, fuera del scope acá).
//
// Qué NO incluye:
// - imageBase64 de creativos IDB legacy (demasiado pesado, se descargan ya
//   migrados al cloud).
// - Tokens de Meta Ads (security).
// - Apify access tokens (security).
//
// Versión del schema: el JSON lleva `schema: 'adslab-producto-export-v1'`
// para que importadores futuros sepan si pueden leerlo o necesitan migrar.

import { getReferencialesByProducto } from './galeriaReferenciales.js';
import { loadIdeas, saveIdeas } from './bandejaStore.js';
import { notifyMarketingChange } from './useMarketingSync.js';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const brandsKey = (productoId) => `adslab-marketing-inspiracion-brands-${productoId}`;

const SCHEMA_VERSION = 'adslab-producto-export-v1';

function loadProductos() {
  try {
    const raw = localStorage.getItem(PRODUCTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveProductos(arr) {
  try {
    localStorage.setItem(PRODUCTOS_KEY, JSON.stringify(arr));
    notifyMarketingChange(PRODUCTOS_KEY);
  } catch (err) {
    console.warn('[export] saveProductos falló:', err.message);
    throw err;
  }
}

// Strip campos sensibles antes de exportar.
function stripSensitive(producto) {
  const { ...safe } = producto;
  // metaAccount puede tener access_token/long-lived token — los removemos.
  if (safe.metaAccount) {
    const { access_token, accessToken, longLivedToken, ...metaSafe } = safe.metaAccount;
    safe.metaAccount = metaSafe;
  }
  return safe;
}

// ============================================================
// EXPORT
// ============================================================
export async function exportProducto(productoId) {
  const productos = loadProductos();
  const producto = productos.find(p => String(p.id) === String(productoId));
  if (!producto) throw new Error(`Producto ${productoId} no encontrado`);

  // Brands manuales del producto.
  let brands = [];
  try {
    const raw = localStorage.getItem(brandsKey(productoId));
    brands = raw ? JSON.parse(raw) : [];
  } catch {}

  // Ideas del Bandeja filtradas.
  const ideas = loadIdeas().filter(i => String(i.productoId) === String(productoId));

  // Refs de creativos cloud (solo metadata).
  let creativos = [];
  try {
    const all = await getReferencialesByProducto(productoId, { includeArchived: true });
    creativos = all.map(c => {
      // Stripear imageBase64 si por alguna razón vino — no lo queremos en JSON.
      const { imageBase64, ...meta } = c;
      return meta;
    });
  } catch (err) {
    console.warn('[export] no pude leer creativos:', err.message);
  }

  return {
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    producto: stripSensitive(producto),
    brands,
    ideas,
    creativos,
    stats: {
      brandsCount: brands.length,
      ideasCount: ideas.length,
      creativosCount: creativos.length,
    },
  };
}

// Trigger download del JSON desde el browser.
export async function downloadProductoExport(productoId) {
  const data = await exportProducto(productoId);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (data.producto.nombre || 'producto').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `adslab-export-${slug}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return data;
}

// ============================================================
// IMPORT
// ============================================================
// Genera un nuevo ID para el producto importado — evita pisar uno existente.
// El user puede borrar el original si quería overwrite.
function generateProductoId() {
  return `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function importProductoFromJson(jsonText) {
  let parsed;
  try {
    parsed = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch (err) {
    throw new Error('JSON inválido: ' + err.message);
  }

  // Validación mínima del schema.
  if (!parsed?.schema) throw new Error('Falta campo "schema" — no es un export válido');
  if (!parsed.schema.startsWith('adslab-producto-export-')) {
    throw new Error(`Schema desconocido: ${parsed.schema}`);
  }
  if (!parsed?.producto?.nombre) throw new Error('Falta producto.nombre');

  // Generamos un id nuevo y remapeamos referencias (ideas.productoId, brands).
  const newId = generateProductoId();
  const oldId = parsed.producto.id;
  const stamp = new Date().toISOString();

  const importedProducto = {
    ...parsed.producto,
    id: newId,
    nombre: `${parsed.producto.nombre} (importado)`,
    importedAt: stamp,
    importedFromId: oldId || null,
    updated_at: stamp,
  };

  // 1) Mergear en productos array.
  const productos = loadProductos();
  saveProductos([importedProducto, ...productos]);

  // 2) Brands → re-mapear productoId en la key del localStorage.
  if (Array.isArray(parsed.brands) && parsed.brands.length > 0) {
    try {
      localStorage.setItem(brandsKey(newId), JSON.stringify(parsed.brands));
      notifyMarketingChange(brandsKey(newId));
    } catch (err) {
      console.warn('[import] brands falló:', err.message);
    }
  }

  // 3) Ideas → reasignamos productoId al nuevo + re-generamos id para no
  //    colisionar con ideas existentes.
  if (Array.isArray(parsed.ideas) && parsed.ideas.length > 0) {
    const existing = loadIdeas();
    const remappedIdeas = parsed.ideas.map(i => ({
      ...i,
      id: `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productoId: newId,
      importedFromIdeaId: i.id,
    }));
    saveIdeas([...remappedIdeas, ...existing]);
  }

  // 4) Creativos — solo metadata; los bytes viven en el bucket del user
  //    original. Si se importa al mismo user account, las URLs siguen
  //    funcionando. Si es a otro user, las URLs probablemente fallen.
  //    No re-insertamos rows en marketing_creativos para no contaminar la
  //    DB con refs rotas; el user puede regenerar si quiere.
  const creativosWarn = (parsed.creativos?.length || 0) > 0
    ? `${parsed.creativos.length} creativos no se importaron (los bytes viven en Supabase Storage del export original). Re-generá desde Inspiración si los necesitás.`
    : null;

  return {
    producto: importedProducto,
    stats: {
      brandsCount: parsed.brands?.length || 0,
      ideasCount: parsed.ideas?.length || 0,
      creativosSkipped: parsed.creativos?.length || 0,
    },
    warning: creativosWarn,
  };
}

// Lee un File del user y delega a importProductoFromJson.
export async function importProductoFromFile(file) {
  if (!file) throw new Error('Sin archivo');
  const text = await file.text();
  return importProductoFromJson(text);
}
