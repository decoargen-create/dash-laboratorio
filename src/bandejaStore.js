// Store de la Bandeja de ideas.
//
// Las ideas se generan automáticamente cuando se hace un deep-analyze de un
// ad ganador (cada análisis → 1 idea con tipo "replica"). Se persisten en
// localStorage junto con el resto del state de Marketing.
//
// Shape de una idea:
//   {
//     id, titulo, tipo, estado,
//     origen: { tipo, competidorNombre, competidorId, adId, adSnapshotUrl, imageUrl, daysRunning },
//     angulo, painPoint, hook, copy, guion,
//     formato: 'video' | 'static' | 'carrusel' | 'mixto',
//     notas, createdAt, usedAt,
//   }
//
// tipo: 'replica' (copiar ganador) | 'iteracion' (variar propio) |
//       'diferenciacion' (azul, nadie lo hace) | 'desde_cero' (generado)
// estado: 'pendiente' | 'en_uso' | 'usada' | 'archivada'

// Store de la Bandeja de ideas.
//
// CLOUD SYNC: Las ideas viven dentro de cada producto en
// `producto.data.bandejaIdeas[]`. Esto las hace sincronizables gratis vía
// el push de productos existente (no requiere tabla nueva ni migración).
//
// loadIdeas() lee de todos los productos y concatena.
// saveIdeas([all_ideas]) re-particiona por productoId y escribe en cada
// producto su subset. Las ideas SIN productoId (raras, casos legacy) se
// guardan en una key global de fallback.
//
// COMPAT: si encuentra una array legacy en la key vieja, la migra a
// productos al primer load.

const STORAGE_KEY = 'adslab-marketing-bandeja-v1';
const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const ORPHAN_KEY = 'adslab-marketing-bandeja-orphan-v1'; // ideas sin productoId

function readProductos() {
  try {
    const raw = localStorage.getItem(PRODUCTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeProductos(arr) {
  try {
    localStorage.setItem(PRODUCTOS_KEY, JSON.stringify(arr));
    // Notificar al sync para que pushee al cloud.
    window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', {
      detail: { key: PRODUCTOS_KEY },
    }));
  } catch {}
}

let _legacyMigrated = false;
function migrateLegacy() {
  if (_legacyMigrated) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      _legacyMigrated = true; // nada que migrar, no volver a intentar
      return;
    }
    const legacy = JSON.parse(raw);
    if (!Array.isArray(legacy) || legacy.length === 0) {
      _legacyMigrated = true;
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      return;
    }
    // Distribuir las legacy ideas a sus productos.
    const productos = readProductos();
    if (productos.length === 0) {
      // No hay productos cargados todavía — el pull aún no completó. No
      // migrar ahora, sino la migración escribiría productos:[] y se borraría
      // la legacy. Reintentamos en el próximo loadIdeas (no marcamos como
      // migrado).
      console.warn(`[bandeja] migrate legacy: ${legacy.length} ideas pero NO HAY productos en localStorage — esperando pull`);
      return;
    }
    const byProducto = new Map();
    const orphans = [];
    for (const idea of legacy) {
      if (idea.productoId) {
        const list = byProducto.get(String(idea.productoId)) || [];
        list.push(idea);
        byProducto.set(String(idea.productoId), list);
      } else {
        orphans.push(idea);
      }
    }
    const updated = productos.map(p => {
      const list = byProducto.get(String(p.id));
      if (!list) return p;
      const existing = Array.isArray(p.bandejaIdeas) ? p.bandejaIdeas : [];
      const ids = new Set(existing.map(i => i.id));
      const merged = [...existing, ...list.filter(i => !ids.has(i.id))];
      return { ...p, bandejaIdeas: merged };
    });
    writeProductos(updated);
    if (orphans.length > 0) {
      try { localStorage.setItem(ORPHAN_KEY, JSON.stringify(orphans)); } catch {}
    }
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    _legacyMigrated = true;
    console.info(`[bandeja] ✅ migrate legacy: ${legacy.length} ideas → ${byProducto.size} productos${orphans.length ? ` (+${orphans.length} orphans)` : ''}. Push al cloud en 2s.`);
  } catch (err) {
    console.warn('[bandeja] migrate legacy falló:', err.message);
  }
}

export function loadIdeas() {
  migrateLegacy();
  const productos = readProductos();
  const all = [];
  for (const p of productos) {
    if (Array.isArray(p.bandejaIdeas)) all.push(...p.bandejaIdeas);
  }
  // Sumar orphans (ideas sin productoId)
  try {
    const raw = localStorage.getItem(ORPHAN_KEY);
    if (raw) {
      const orphans = JSON.parse(raw);
      if (Array.isArray(orphans)) all.push(...orphans);
    }
  } catch {}
  // Ordenar por createdAt desc para mantener el orden que usaba el array global.
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return all;
}

export function saveIdeas(ideas) {
  // Re-particionar por productoId y escribir cada subset en su producto.
  const byProducto = new Map();
  const orphans = [];
  for (const idea of ideas) {
    if (idea.productoId) {
      const list = byProducto.get(String(idea.productoId)) || [];
      list.push(idea);
      byProducto.set(String(idea.productoId), list);
    } else {
      orphans.push(idea);
    }
  }
  const productos = readProductos();
  const updated = productos.map(p => {
    const list = byProducto.get(String(p.id)) || [];
    return { ...p, bandejaIdeas: list };
  });
  writeProductos(updated);
  try { localStorage.setItem(ORPHAN_KEY, JSON.stringify(orphans)); } catch {}
}

function genId() {
  return `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Agrega una idea. Dedupe:
//   - Si tiene origen.adId → dedupe por (tipo, adId). Caso "replica" de ad.
//   - Si no tiene origen.adId → dedupe por (tipo, titulo normalizado). Caso
//     ideas generadas por IA, para que re-generar no duplique exacto.
export function addIdea(idea) {
  const list = loadIdeas();
  const normTitulo = (idea.titulo || '').trim().toLowerCase();
  const existing = list.find(i => {
    if (i.tipo !== idea.tipo) return false;
    // Dedup por adId: SOLO si es el mismo producto. Antes ignoraba el
    // productoId — dos productos que analizan el mismo ad de un competidor
    // compartido se pisaban y el 2do quedaba sin la réplica.
    if (i.origen?.adId && idea.origen?.adId) {
      return i.origen.adId === idea.origen.adId
        && String(i.productoId || '') === String(idea.productoId || '');
    }
    if (!i.origen?.adId && !idea.origen?.adId) {
      return (i.titulo || '').trim().toLowerCase() === normTitulo && normTitulo.length > 0;
    }
    return false;
  });
  if (existing) return existing;

  const nueva = {
    id: genId(),
    estado: 'pendiente',
    createdAt: new Date().toISOString(),
    usedAt: null,
    notas: '',
    productoId: null,
    productoNombre: null,
    ...idea,
  };
  saveIdeas([nueva, ...list]);
  return nueva;
}

// Normaliza un hook para comparar semánticamente: baja caja, saca tildes,
// saca puntuación, toma las primeras 6 palabras significativas.
// 6 y no 3: con 3, hooks porteños distintos colapsaban en la misma firma
// ("che mirá esto…" vs "che mirá que…") y se marcaban duplicados sin serlo.
function hookSignature(hook) {
  if (!hook) return '';
  const normalized = hook
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);
  return normalized.slice(0, 6).join(' ');
}

// Bulk add: agrega varias ideas de una y devuelve el subset realmente
// insertado. Dedupea por (tipo, titulo) y también detecta hooks casi
// idénticos (primeras 3 palabras significativas iguales) — si el generator
// repite un patrón, se loggea warning pero no se bloquea.
export function addGeneratedIdeas(rawIdeas, { producto } = {}) {
  const prodId = producto?.id ? String(producto.id) : null;
  const prodNombre = producto?.nombre || null;
  if (!Array.isArray(rawIdeas)) return [];
  const nuevas = [];
  const existentes = loadIdeas();
  const existingCount = existentes.length;
  const existingHookSigs = new Set(existentes.map(i => hookSignature(i.hook)).filter(Boolean));
  const newHookSigs = new Set();
  for (const r of rawIdeas) {
    // Para iteraciones, el origen apunta al ad propio base + guarda la razón
    // concreta (métrica que cayó, por qué estamos iterando).
    const origen = r.tipo === 'iteracion' && r.iteracionBase
      ? {
          tipo: 'propio',
          adId: r.iteracionBase.adId || null,
          adNombre: r.iteracionBase.adNombre || '',
          competidorNombre: null,
          competidorId: null,
          adSnapshotUrl: null,
          imageUrl: null,
          daysRunning: null,
          productoNombre: producto?.nombre || null,
          razonamiento: r.razonamiento || '',
          razonIteracion: r.iteracionBase.razon || '',
        }
      : {
          tipo: 'generado',
          competidorNombre: null,
          competidorId: null,
          adId: null,
          adSnapshotUrl: null,
          imageUrl: null,
          daysRunning: null,
          productoNombre: producto?.nombre || null,
          razonamiento: r.razonamiento || '',
        };

    // Check de diversidad de hooks — si este hook ya tiene signature igual
    // a otro recién generado o en la bandeja, lo marcamos con un flag
    // interno para que la UI pueda advertirlo al user (no lo bloqueamos,
    // el user decide si lo descarta).
    const sig = hookSignature(r.hook);
    const hookDuplicado = sig && (existingHookSigs.has(sig) || newHookSigs.has(sig));
    if (sig) newHookSigs.add(sig);

    const idea = addIdea({
      productoId: prodId,
      productoNombre: prodNombre,
      titulo: r.titulo,
      tipo: r.tipo,
      origen,
      formato: r.formato || 'static',
      estiloVisual: r.estiloVisual || '',
      angulo: r.angulo || '',
      painPoint: r.painPoint || '',
      hook: r.hook || '',
      escenarioNarrativo: r.escenarioNarrativo || '',
      descripcionImagen: r.descripcionImagen || '',
      promptGeneradorImagen: r.promptGeneradorImagen || '',
      textoEnImagen: r.textoEnImagen || '',
      copyPostMeta: r.copyPostMeta || r.copy || '', // fallback a copy por compat
      publicoSugerido: r.publicoSugerido || '',
      guion: r.guion || '',
      anguloCategoria: r.anguloCategoria || null,
      tipoCampaña: r.tipoCampaña || null,
      metaRiesgo: r.metaRiesgo || { tieneRiesgo: false, palabras: [], sugerencia: '' },
      variableDeTesteo: r.variableDeTesteo || 'mix',
      testHipotesis: r.testHipotesis || '',
      // Cuál de las 6 creencias del Offer Brief tumba esta idea — el
      // generador la declara explícitamente. Si no vino, queda undefined.
      creenciaApalancada: r.creenciaApalancada || null,
      hookDuplicado,
    });
    if (loadIdeas().length > existingCount + nuevas.length) nuevas.push(idea);
  }
  return nuevas;
}

export function updateIdea(id, patch) {
  const list = loadIdeas();
  const updated = list.map(i => i.id === id ? { ...i, ...patch } : i);
  saveIdeas(updated);
  return updated;
}

export function removeIdea(id) {
  const list = loadIdeas().filter(i => i.id !== id);
  saveIdeas(list);
  return list;
}

// Cuántas ideas se generaron "hoy" según horario Argentina (UTC-3 sin DST).
// Usamos locale en-CA que devuelve YYYY-MM-DD para comparar fechas sin
// lidiar con timezones manualmente.
function argDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  } catch { return ''; }
}

export function countIdeasGeneratedToday(ideas = null, productoId = null) {
  const list = ideas || loadIdeas();
  const today = argDate(new Date());
  return list.filter(i => {
    if (productoId && String(i.productoId || '') !== String(productoId)) return false;
    return argDate(i.createdAt) === today;
  }).length;
}

// Una idea es "del generador" si NO es una réplica creada por el
// deep-analyze. Esas réplicas tienen origen.tipo === 'competidor'.
// Todo lo demás (iteración, diferenciación, desde-cero, réplicas que
// arma el generador) viene del generador.
export function esIdeaDelGenerador(idea) {
  return idea?.origen?.tipo !== 'competidor';
}

// Cuenta SOLO las ideas del generador creadas hoy para un producto. El
// límite diario del generador se mide contra esto — NO contra las
// réplicas del deep-analyze, que antes le comían el cupo y hacían que
// el generador se salteara (todas las ideas terminaban siendo réplicas).
export function countIdeasGeneradorHoy(productoId = null) {
  const today = argDate(new Date());
  return loadIdeas().filter(i => {
    if (productoId && String(i.productoId || '') !== String(productoId)) return false;
    if (!esIdeaDelGenerador(i)) return false;
    return argDate(i.createdAt) === today;
  }).length;
}

// Transforma un resultado de deep-analyze en una idea tipo "replica".
// Pensada para llamarse desde Competencia.jsx y Arranque.jsx justo después
// de que vuelva el análisis, así se puebla la bandeja de forma pasiva.
// Devuelve el formato de un ad scrapeado. Prioriza el campo `formato` ya
// clasificado por normalizeAd (basado en el display_format real de Meta).
// Para ads viejos sin ese campo, cae a una heurística que NO asume video
// cuando el ad tiene imagen Y video (eso marcaba como video los carruseles
// de imágenes de la competencia).
export function formatoDeAd(ad) {
  if (ad?.formato) return ad.formato;
  const v = ad?.videoUrls?.length || 0;
  const i = ad?.imageUrls?.length || 0;
  if (v > 0 && i > 0) return 'mixto';
  if (v > 0) return 'video';
  if (i > 1) return 'carrusel';
  if (i === 1) return 'static';
  return 'mixto';
}

export function ideaFromDeepAnalysis({ analysis, transcript, ad, competidor, producto }) {
  if (!analysis || !ad) return null;

  const formato = formatoDeAd(ad);

  const titulo = (ad.headline || analysis.angle || 'Réplica de ganador').slice(0, 100);
  const hookPrincipal = Array.isArray(analysis.hooks) && analysis.hooks.length > 0
    ? analysis.hooks[0]
    : '';
  const copySugerido = Array.isArray(analysis.copy_patterns) && analysis.copy_patterns.length > 0
    ? analysis.copy_patterns.join(' · ')
    : '';

  return addIdea({
    productoId: producto?.id ? String(producto.id) : null,
    productoNombre: producto?.nombre || null,
    titulo,
    tipo: 'replica',
    origen: {
      tipo: 'competidor',
      competidorNombre: competidor?.nombre || ad.pageName || 'Competidor',
      competidorId: competidor?.id || null,
      adId: ad.id,
      adSnapshotUrl: ad.snapshotUrl || null,
      imageUrl: ad.imageUrls?.[0] || null,
      daysRunning: ad.daysRunning || 0,
    },
    angulo: analysis.angle || '',
    painPoint: Array.isArray(analysis.triggers) ? analysis.triggers[0] : (analysis.audience || ''),
    hook: hookPrincipal,
    copy: copySugerido,
    guion: transcript || '',
    formato,
  });
}

// Catálogo de tipos con etiqueta + colores Tailwind (para badges de la UI).
export const TIPO_META = {
  replica: {
    label: 'Réplica',
    emoji: '🔵',
    color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    descripcion: 'Copia de un ganador de la competencia',
  },
  iteracion: {
    label: 'Iteración',
    emoji: '🟡',
    color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    descripcion: 'Variación de un creativo tuyo que ya funciona',
  },
  diferenciacion: {
    label: 'Diferenciación',
    emoji: '🟢',
    color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    descripcion: 'Ángulo que nadie más está usando (azul)',
  },
  desde_cero: {
    label: 'Desde cero',
    emoji: '✨',
    color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    descripcion: 'Idea original generada por IA',
  },
};

export const ESTADO_META = {
  pendiente: { label: 'Pendiente', color: 'text-gray-500 dark:text-gray-400', icon: '○' },
  en_uso:    { label: 'En uso',    color: 'text-amber-600 dark:text-amber-400', icon: '◐' },
  usada:     { label: 'Usada',     color: 'text-emerald-600 dark:text-emerald-400', icon: '✓' },
  archivada: { label: 'Archivada', color: 'text-gray-400 dark:text-gray-500', icon: '✕' },
};

// Catálogo de variables de testeo. La idea es que cada idea declare qué
// UNA cosa se está variando vs el baseline, así se pueden armar A/B
// coherentes y aprender qué palanca mueve las métricas.
// Catálogo de los 10 ángulos estratégicos (método propio).
// Cada idea puede pertenecer a uno — para agrupar/filtrar en la Bandeja.
export const ANGULO_META = {
  A: { label: 'Sarcasmo / vulgar', emoji: '🔥', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
  B: { label: 'Insight incómodo',  emoji: '💢', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
  C: { label: 'POV relatable',     emoji: '🎭', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  D: { label: 'Doble sentido',     emoji: '🎯', color: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300' },
  E: { label: 'Autoridad/solución',emoji: '🏆', color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
  F: { label: 'Testimonio c/edad', emoji: '👵', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' },
  G: { label: 'Científico',        emoji: '🔬', color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300' },
  H: { label: 'Antes/después',     emoji: '🔄', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  I: { label: 'Humor anti-cultura',emoji: '😈', color: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' },
  J: { label: 'Edad emocional',    emoji: '⏳', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
};

export const CAMPAÑA_META = {
  TOFU:         { label: 'TOFU · prospecting', emoji: '🧊', color: 'text-sky-600 dark:text-sky-400' },
  MOFU:         { label: 'MOFU · consideración', emoji: '🤔', color: 'text-indigo-600 dark:text-indigo-400' },
  BOFU:         { label: 'BOFU · conversión', emoji: '💰', color: 'text-emerald-600 dark:text-emerald-400' },
  retargeting:  { label: 'Retargeting caliente', emoji: '🔥', color: 'text-red-600 dark:text-red-400' },
  social_proof: { label: 'Prueba social', emoji: '⭐', color: 'text-amber-600 dark:text-amber-400' },
  branding:     { label: 'Branding', emoji: '🎨', color: 'text-violet-600 dark:text-violet-400' },
};

export const VARIABLE_META = {
  hook:          { label: 'Hook',           emoji: '🎣', descripcion: 'Cambia los primeros 3 segundos' },
  visual:        { label: 'Visual',         emoji: '🎨', descripcion: 'Cambia la estética / composición / paleta' },
  cta:           { label: 'CTA',            emoji: '🖱️', descripcion: 'Cambia el call-to-action' },
  formato:       { label: 'Formato',        emoji: '🔀', descripcion: 'Pasa de static a video, o vice versa' },
  angulo:        { label: 'Ángulo',         emoji: '📐', descripcion: 'Cambia el ángulo emocional/estratégico' },
  audience:      { label: 'Audience',       emoji: '👥', descripcion: 'Mismo creativo, distinta audiencia' },
  prueba_social: { label: 'Prueba social',  emoji: '👤', descripcion: 'Agrega/varía testimonios, UGC, autoridad' },
  oferta:        { label: 'Oferta',         emoji: '💰', descripcion: 'Cambia descuento, bundle, garantía' },
  mix:           { label: 'Mix',            emoji: '🎛️', descripcion: 'Varios cambios a la vez (no es A/B puro)' },
};
