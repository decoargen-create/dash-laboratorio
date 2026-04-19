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

const STORAGE_KEY = 'viora-marketing-bandeja-v1';

export function loadIdeas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveIdeas(ideas) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas)); } catch {}
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
    if (i.origen?.adId && idea.origen?.adId) return i.origen.adId === idea.origen.adId;
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
    ...idea,
  };
  saveIdeas([nueva, ...list]);
  return nueva;
}

// Bulk add: agrega varias ideas de una y devuelve el subset realmente
// insertado (las duplicadas se saltean). Útil tras generate-ideas.
export function addGeneratedIdeas(rawIdeas, { producto } = {}) {
  if (!Array.isArray(rawIdeas)) return [];
  const nuevas = [];
  const existentes = loadIdeas();
  const existingCount = existentes.length;
  for (const r of rawIdeas) {
    const idea = addIdea({
      titulo: r.titulo,
      tipo: r.tipo,
      origen: {
        tipo: 'generado',
        competidorNombre: null,
        competidorId: null,
        adId: null,
        adSnapshotUrl: null,
        imageUrl: null,
        daysRunning: null,
        productoNombre: producto?.nombre || null,
        razonamiento: r.razonamiento || '',
      },
      angulo: r.angulo || '',
      painPoint: r.painPoint || '',
      hook: r.hook || '',
      copy: r.copy || '',
      guion: r.guion || '',
      formato: r.formato || 'static',
    });
    // Si es nueva (no match previo) queda al tope — detectamos comparando
    // la longitud del storage antes/después.
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

// Transforma un resultado de deep-analyze en una idea tipo "replica".
// Pensada para llamarse desde Competencia.jsx y Arranque.jsx justo después
// de que vuelva el análisis, así se puebla la bandeja de forma pasiva.
export function ideaFromDeepAnalysis({ analysis, transcript, ad, competidor }) {
  if (!analysis || !ad) return null;

  const formato = (ad.videoUrls?.length > 0) ? 'video' :
                  (ad.imageUrls?.length > 0) ? 'static' : 'mixto';

  const titulo = (ad.headline || analysis.angle || 'Réplica de ganador').slice(0, 100);
  const hookPrincipal = Array.isArray(analysis.hooks) && analysis.hooks.length > 0
    ? analysis.hooks[0]
    : '';
  const copySugerido = Array.isArray(analysis.copy_patterns) && analysis.copy_patterns.length > 0
    ? analysis.copy_patterns.join(' · ')
    : '';

  return addIdea({
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
