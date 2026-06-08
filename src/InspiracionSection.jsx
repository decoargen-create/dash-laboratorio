// Sección Inspiración de estáticos.
//
// Idea: marcas (de cualquier rubro) que hacen estáticos buenos, las agregás
// como "fuente de inspiración" del producto. Después scrapeamos sus ads
// activos diariamente y dedupeamos día a día (los que ya viste, no
// vuelven). Cuando ves un static que te gusta, click → "adaptar a
// {producto}" → arma ideas con ese ad como base de inspiración visual.
//
// Diferencia con "Competencia":
//   - Competencia = marcas del MISMO rubro que vos, ángulos copiables
//     directos. Generador hace réplicas.
//   - Inspiración = marcas de CUALQUIER rubro que hacen buenos estáticos.
//     No copiamos el ángulo (no aplica), copiamos la ESTÉTICA visual.
//
// Pipeline:
//   1. Selector de productos (igual UX que Bandeja/MetaAds)
//   2. Una vez elegido el producto, lista de marcas inspiración con
//      botón "+ Agregar marca"
//   3. Por marca: thumb de su última corrida, conteo de ads frescos
//      (desde la última vista) y botón "Scrapear ahora"
//   4. (Parte 7.2): grilla de ads del scrape, con dedup día a día
//   5. (Parte 7.4): botón "Adaptar a {producto}" en cada ad

import React, { useState, useEffect } from 'react';
import {
  Sparkles, Package, ChevronRight, ChevronDown, Plus, Trash2, Link2, X,
  Loader2, Download, Image as ImageIcon, ExternalLink, Wand2, Search,
  Images, Check, AlertCircle,
} from 'lucide-react';
import { logCostsFromResponse } from './costsStore.js';
import { addGeneratedIdeas } from './bandejaStore.js';
import { getProductoImagen, getAccentColor } from './productoImagen.js';
import { saveReferencial } from './galeriaReferenciales.js';
import { cacheAdImagesBatch, getCachedAdImageUrl } from './adImagesStore.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';
import GaleriaReferencialesModal from './GaleriaReferencialesModal.jsx';

// Máximo de ads por tanda: 10. Más allá saturaríamos rate limits de
// gpt-image-2 (típicamente 5-15 RPM) y el browser quedaría unresponsive.
// Con concurrencia 5 paralela y n=2 fijo, 10 ads × 2 variantes = 20 imágenes
// en ~3 min, costo ~$3.60.
const MAX_SELECCIONADOS = 10;
const BULK_CONCURRENCY = 5;
const N_VARIANTES_FIJO = 2;

// Extrae una keyword sensata desde una landing URL — preferimos el hostname
// COMPLETO con www. si está, porque eso es lo que pegarías a mano en la
// Ads Library de Meta. La búsqueda con dominio devuelve los ads reales del
// brand, no basura genérica.
function landingToKeyword(url) {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname; // ej: "www.vitamiplus.com"
  } catch {
    return String(url).replace(/^https?:\/\//, '').split('/')[0];
  }
}

// Valida que el keyword sea utilizable. Refuse si es muy corto o solo
// dígitos — para no caer en el bug de scrapear con nombre="1" y traer
// phone cases / cuchillos / random.
function isKeywordUsable(kw) {
  if (!kw) return false;
  const s = String(kw).trim();
  if (s.length < 4) return false;
  if (/^\d+$/.test(s)) return false;
  return true;
}

const PRODUCTOS_KEY = 'viora-marketing-productos-v1';
const ACTIVE_KEY = 'viora-marketing-inspiracion-active-product';
const brandsKey = (productoId) => `viora-marketing-inspiracion-brands-${productoId}`;

function loadProductos() {
  try {
    const raw = localStorage.getItem(PRODUCTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function loadBrands(productoId) {
  if (!productoId) return [];
  try {
    const raw = localStorage.getItem(brandsKey(productoId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveBrands(productoId, brands) {
  if (!productoId) return;
  try { localStorage.setItem(brandsKey(productoId), JSON.stringify(brands)); } catch {}
}

// Props:
//   forcedProductoId: pisar el selector con un producto específico (cuando
//     vivimos embebidos en otra pantalla con tabs).
//   embedded: ocultar header con breadcrumb cuando el padre ya lo tiene.
export default function InspiracionSection({ addToast, forcedProductoId, embedded = false }) {
  const [productos, setProductos] = useState(() => loadProductos());
  const [activeProductoIdRaw, setActiveProductoIdRaw] = useState(() => {
    try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
  });
  const activeProductoId = forcedProductoId != null ? forcedProductoId : activeProductoIdRaw;
  const setActiveProductoId = forcedProductoId != null
    ? () => {}
    : setActiveProductoIdRaw;
  const [brands, setBrands] = useState(() => loadBrands(activeProductoId));
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({ nombre: '', landingUrl: '', fbPageUrl: '', notas: '' });
  const [scrapingBrandId, setScrapingBrandId] = useState(null);
  // brand.id → array de ads scrapeados de la última corrida (mostrados inline).
  const [adsByBrand, setAdsByBrand] = useState({});
  // ad.id → bool, true mientras se adapta al producto (loading).
  const [adaptingAdIds, setAdaptingAdIds] = useState(new Set());
  // Multi-select para generar creativos referenciales en bulk (max 5).
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [creandoAdIds, setCreandoAdIds] = useState(new Set());
  const [showGaleria, setShowGaleria] = useState(false);
  // Opciones de generación (las elige el usuario en la barra de bulk o en
  // el control de la sección). Persistimos en localStorage para que no se
  // pierdan entre sesiones.
  const [genOpts, setGenOpts] = useState(() => {
    try {
      const raw = localStorage.getItem('viora-marketing-gen-opts');
      return raw ? JSON.parse(raw) : { n: 2, size: '2048x2048', quality: 'high' };
    } catch { return { n: 2, size: '2048x2048', quality: 'high' }; }
  });
  useEffect(() => {
    try { localStorage.setItem('viora-marketing-gen-opts', JSON.stringify(genOpts)); } catch {}
  }, [genOpts]);
  // Cache de skeletons extraídos por Vision — { [adId]: skeleton }. Si
  // re-generamos sobre el mismo ad, reusamos el skeleton y nos saltamos
  // Vision por completo. Se persiste en localStorage para sobrevivir refresh.
  const [skeletonCache, setSkeletonCache] = useState(() => {
    try {
      const raw = localStorage.getItem('viora-marketing-skeleton-cache');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const upsertSkeleton = (adId, skel) => {
    if (!adId || !skel) return;
    setSkeletonCache(prev => {
      const next = { ...prev, [adId]: skel };
      try { localStorage.setItem('viora-marketing-skeleton-cache', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Progreso per-ad: { [adId]: { startedAt, stage, error? } }
  // stages: 'preparando' | 'generando' | 'guardando' | 'done' | 'error'
  const [progressById, setProgressById] = useState({});
  // Progreso del bulk: null cuando no hay bulk en curso.
  // { total, completed, currentIdx, current: {adId, brandNombre, adHeadline}, startedAt,
  //   adsList: [{adId, brandNombre, status: 'pending'|'doing'|'done'|'error'}], errors: [] }
  const [bulkProgress, setBulkProgress] = useState(null);
  // Tick para re-renderizar progress bars (elapsed/ETA).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (creandoAdIds.size === 0 && !bulkProgress) return;
    const t = setInterval(() => setTick(x => x + 1), 250);
    return () => clearInterval(t);
  }, [creandoAdIds.size, bulkProgress]);

  // Filtros + ordenamiento (vistas)
  const [query, setQuery] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('all'); // 'all' | 'competidor' | 'custom'
  const [estadoFiltro, setEstadoFiltro] = useState('all'); // 'all' | 'con-ads' | 'sin-scrapear'
  const [orderBy, setOrderBy] = useState('reciente'); // 'reciente' | 'nombre' | 'ads-count'

  // Polling liviano de productos cada 3s.
  useEffect(() => {
    const t = setInterval(() => {
      const fresh = loadProductos();
      setProductos(prev => (prev.length !== fresh.length ? fresh : prev));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  // Persistir activo + recargar brands al cambiar producto.
  useEffect(() => {
    try {
      if (activeProductoId) localStorage.setItem(ACTIVE_KEY, activeProductoId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {}
    setBrands(loadBrands(activeProductoId));
  }, [activeProductoId]);

  // Persistir brands al cambiar.
  useEffect(() => {
    saveBrands(activeProductoId, brands);
  }, [brands, activeProductoId]);

  const producto = productos.find(p => String(p.id) === String(activeProductoId)) || null;

  const handleAddBrand = () => {
    const nombre = draft.nombre.trim();
    if (!nombre) {
      addToast?.({ type: 'error', message: 'Ponele nombre a la marca' });
      return;
    }
    const nueva = {
      id: `brand-${Date.now()}`,
      nombre,
      landingUrl: draft.landingUrl.trim(),
      fbPageUrl: draft.fbPageUrl.trim(),
      notas: draft.notas.trim(),
      createdAt: new Date().toISOString(),
      lastScraped: null,
      seenAdIds: [],
    };
    setBrands(prev => [nueva, ...prev]);
    setDraft({ nombre: '', landingUrl: '', fbPageUrl: '', notas: '' });
    setShowAddForm(false);
    addToast?.({ type: 'success', message: `Marca "${nombre}" sumada` });
  };

  const handleRemoveBrand = (id) => {
    const b = brands.find(x => x.id === id);
    if (!b) return;
    if (!window.confirm(`¿Eliminar "${b.nombre}" de inspiración?`)) return;
    setBrands(prev => prev.filter(x => x.id !== id));
    setAdsByBrand(prev => {
      const next = { ...prev }; delete next[id]; return next;
    });
  };

  // Adapta un ad de inspiración al producto activo: llama al endpoint
  // adapt-inspiracion (Claude Vision con la imagen + contexto del producto)
  // y mete las ideas generadas directamente en la Bandeja del producto.
  const handleAdapt = async (brandNombre, ad) => {
    if (!producto) return;
    setAdaptingAdIds(prev => new Set(prev).add(ad.id));
    const execId = startExecution({
      label: `Adaptando ideas desde ${brandNombre}`,
      sublabel: ad.headline?.slice(0, 60) || ad.body?.slice(0, 60) || '',
      kind: 'adapt',
      estimatedMs: 40000,
    });
    try {
      const resp = await fetch('/api/marketing/adapt-inspiracion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto: {
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            landingUrl: producto.landingUrl,
            research: producto.docs?.research,
            avatar: producto.docs?.avatar,
            activoVisual: producto.activoVisual,
          },
          inspiracion: { brandNombre, ad },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const adaptCost = logCostsFromResponse(data, `adapt-inspiracion · ${brandNombre}`);

      const ideas = (data.ideas || []).map(i => ({
        ...i,
        tipo: 'replica',
        productoId: String(producto.id),
        productoNombre: producto.nombre,
        origen: {
          competidorNombre: `Inspiración: ${brandNombre}`,
          adId: ad.id,
          adSnapshotUrl: ad.snapshotUrl,
          imageUrl: ad.imageUrls?.[0],
          razonamiento: i.razonamiento,
        },
      }));
      addGeneratedIdeas(ideas);

      const msg = `${ideas.length} ideas adaptadas en la Bandeja de ${producto.nombre}`;
      addToast?.({ type: 'success', message: msg });
      finishExecution(execId, { ok: true, message: msg, cost: adaptCost?.total });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude adaptar: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
    } finally {
      setAdaptingAdIds(prev => {
        const next = new Set(prev); next.delete(ad.id); return next;
      });
    }
  };

  // Toggle un ad en la selección — cap MAX_SELECCIONADOS.
  const toggleSeleccion = (adId) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(adId)) {
        next.delete(adId);
      } else {
        if (next.size >= MAX_SELECCIONADOS) {
          addToast?.({ type: 'info', message: `Máximo ${MAX_SELECCIONADOS} ads por tanda. Deseleccioná alguno.` });
          return prev;
        }
        next.add(adId);
      }
      return next;
    });
  };

  const limpiarSeleccion = () => setSeleccionados(new Set());

  // Genera 2 variaciones de creativo referencial para UN ad de inspiración.
  // Lo usan el botón individual y el bulk. Guarda en la galería al toque.
  // Actualiza progressById con stage por etapa para feedback al usuario.
  const crearReferencialDeAd = async (brandNombre, ad) => {
    if (!producto) return false;
    const prodImg = getProductoImagen(producto.id);
    if (!prodImg) {
      addToast?.({ type: 'error', message: 'Cargá la foto del producto en Setup primero.' });
      return false;
    }
    setCreandoAdIds(prev => new Set(prev).add(ad.id));
    setProgressById(prev => ({
      ...prev,
      [ad.id]: { startedAt: Date.now(), stage: 'preparando' },
    }));
    // Estimación de costo según opciones (lo mostramos en el tray antes de que la API confirme).
    const costoPorImg = genOpts.quality === 'low' ? 0.03 : genOpts.quality === 'medium' ? 0.07 : 0.18;
    const visionCost = skeletonCache[ad.id] ? 0 : 0.005;
    const estimatedCost = N_VARIANTES_FIJO * costoPorImg + visionCost;
    const execId = startExecution({
      label: `Creando ${N_VARIANTES_FIJO} creativos de ${brandNombre}`,
      sublabel: ad.headline?.slice(0, 60) || ad.body?.slice(0, 60) || '',
      kind: 'creative',
      estimatedMs: 80000,
      estimatedCost,
    });
    try {
      // Pequeña pausa visual para que se vea el stage "preparando".
      await new Promise(r => setTimeout(r, 150));
      setProgressById(prev => ({
        ...prev,
        [ad.id]: { ...prev[ad.id], stage: 'generando' },
      }));
      updateExecution(execId, { stage: 'Generando con gpt-image-2…' });

      const refImageUrl = ad.imageUrls?.[0];
      if (!refImageUrl) {
        throw new Error('Este ad no tiene imagen para usar como referencia');
      }
      const resp = await fetch('/api/marketing/crear-creativo-referencial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto: {
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            research: producto.docs?.research,
          },
          inspiracion: {
            brandNombre,
            body: ad.body, headline: ad.headline,
            formato: ad.formato,
            analysis: ad.analysis || null,
            visual: ad.visual || null,
          },
          inspiracionImageUrl: refImageUrl,
          productoImagen: prodImg,
          accentColor: getAccentColor(producto.id) || '',
          // n=2 fijo (la lógica "por las dudas" se cubre con 2 variantes).
          // size y quality configurables.
          quality: genOpts.quality,
          size: genOpts.size,
          n: N_VARIANTES_FIJO,
          // Si ya tenemos un skeleton cacheado del mismo ad, lo mandamos
          // para que el backend saltee la llamada a Vision (~$0.005 + 10s).
          skeletonCached: skeletonCache[ad.id] || null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const costo = logCostsFromResponse(data, `crear-creativo-referencial · ${brandNombre}`);

      setProgressById(prev => ({
        ...prev,
        [ad.id]: { ...prev[ad.id], stage: 'guardando' },
      }));
      updateExecution(execId, { stage: 'Guardando en galería…' });

      // Cachear skeleton del ad para futuras re-generaciones (saltea Vision).
      if (data.skeleton && !data.skeletonFromCache) {
        upsertSkeleton(ad.id, data.skeleton);
      }

      // Guardar las N variaciones en la galería. Persistimos skeleton +
      // sourceImageUrl + prompt para que después se pueda inspeccionar qué
      // entró exactamente al modelo (útil para debug y para entender por qué
      // una variación quedó mejor que otra).
      const ahora = Date.now();
      const imagenes = data.imagenes || [];
      for (let i = 0; i < imagenes.length; i++) {
        await saveReferencial({
          id: `ref_${ahora}_${ad.id}_${i}`,
          productoId: String(producto.id),
          sourceAdId: ad.id,
          sourceBrand: brandNombre,
          sourceImageUrl: refImageUrl,
          sourceHeadline: ad.headline || ad.body?.slice(0, 200) || '',
          variantIndex: i,
          imageBase64: imagenes[i],
          mimeType: data.mimeType || 'image/png',
          prompt: data.prompt,
          skeleton: data.skeleton || null,
          model: data.model,
          visionModel: data.visionModel || null,
          size: data.size,
          sizeFallback: !!data.sizeFallback,
          quality: data.quality || 'high',
          createdAt: new Date(ahora + i).toISOString(),
        });
      }
      setProgressById(prev => ({
        ...prev,
        [ad.id]: { ...prev[ad.id], stage: 'done' },
      }));
      const cacheNote = data.skeletonFromCache ? ' (skeleton cacheado, ahorraste ~$0.005)' : '';
      const msg = `${imagenes.length} variaciones generadas y guardadas en galería${cacheNote}`;
      addToast?.({ type: 'success', message: msg });
      finishExecution(execId, { ok: true, message: msg, cost: costo?.total || estimatedCost });
      // Auto-limpiar el estado del progreso después de 2.5s para que se vea el "✓".
      setTimeout(() => {
        setProgressById(prev => {
          const next = { ...prev }; delete next[ad.id]; return next;
        });
      }, 2500);
      return true;
    } catch (err) {
      setProgressById(prev => ({
        ...prev,
        [ad.id]: { ...prev[ad.id], stage: 'error', error: err?.message || 'Error' },
      }));
      addToast?.({ type: 'error', message: `No pude generar: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
      // Limpiar el error después de 5s.
      setTimeout(() => {
        setProgressById(prev => {
          const next = { ...prev }; delete next[ad.id]; return next;
        });
      }, 5000);
      return false;
    } finally {
      setCreandoAdIds(prev => {
        const next = new Set(prev); next.delete(ad.id); return next;
      });
    }
  };

  // Bulk: itera los seleccionados en SECUENCIAL (gpt-image-2 toma 30-60s
  // por llamada y queremos evitar rate limits). Mantiene bulkProgress
  // actualizado para que la barra flotante muestre ETA real.
  const handleBulkCrear = async () => {
    if (seleccionados.size === 0) return;
    if (!producto) return;
    const prodImg = getProductoImagen(producto.id);
    if (!prodImg) {
      addToast?.({ type: 'error', message: 'Cargá la foto del producto en Setup primero.' });
      return;
    }
    // Costo: $0.18/imagen (high) × 2 variantes + ~$0.005 vision (Haiku) por ad
    // que NO esté ya en cache. n=2 fijo.
    const costoPorImagen = genOpts.quality === 'low' ? 0.03 : genOpts.quality === 'medium' ? 0.07 : 0.18;
    const visionAds = Array.from(seleccionados).filter(adId => !skeletonCache[adId]).length;
    const costoEstimado = seleccionados.size * N_VARIANTES_FIJO * costoPorImagen + visionAds * 0.005;
    const total = seleccionados.size * N_VARIANTES_FIJO;
    const sizeLabel = genOpts.size === '1024x1536' ? '1024×1536 portrait' : genOpts.size === '1024x1024' ? '1024×1024 1:1' : '2048×2048 1:1';
    const cacheNote = visionAds < seleccionados.size ? ` (${seleccionados.size - visionAds} con skeleton cacheado)` : '';
    if (!window.confirm(`Generar ${N_VARIANTES_FIJO} variantes ${sizeLabel} por cada uno de los ${seleccionados.size} ads${cacheNote} → ${total} imágenes total, ~$${costoEstimado.toFixed(2)}. Corriendo en paralelo, debería tardar ~${Math.ceil(seleccionados.size / BULK_CONCURRENCY) * 90}s. ¿Seguir?`)) return;

    // Buscar los ad objects desde adsByBrand + de los competidores (que viven
    // en producto.competidores, no en brands custom).
    const adsAGenerar = [];
    const adsCompetidores = (producto.competidores || []).flatMap(c =>
      (c.ads || [])
        .filter(a => seleccionados.has(a.id) && (a.imageUrls?.length || 0) > 0)
        .map(a => ({ brandNombre: c.nombre, ad: a }))
    );
    const adsCustom = Object.entries(adsByBrand).flatMap(([brandId, lista]) => {
      const b = brands.find(x => x.id === brandId);
      const brandNombre = b?.nombre || 'Inspiración';
      return (lista || [])
        .filter(a => seleccionados.has(a.id))
        .map(a => ({ brandNombre, ad: a }));
    });
    adsAGenerar.push(...adsCompetidores, ...adsCustom);

    // Inicializar barra de progreso del bulk.
    setBulkProgress({
      total: adsAGenerar.length,
      completed: 0,
      currentIdx: 0,
      startedAt: Date.now(),
      adDurations: [],
      current: { adId: adsAGenerar[0].ad.id, brandNombre: adsAGenerar[0].brandNombre, adHeadline: adsAGenerar[0].ad.headline || adsAGenerar[0].ad.body?.slice(0, 60) || '' },
      adsList: adsAGenerar.map((x, i) => ({
        adId: x.ad.id,
        brandNombre: x.brandNombre,
        status: 'pending',
      })),
      errors: [],
    });

    // Ejecución en PARALELO con concurrencia BULK_CONCURRENCY.
    // Cada worker toma del queue y procesa hasta vaciarlo. Mucho más rápido
    // que el for-await secuencial anterior.
    let nextIndex = 0;
    const indexOf = new Map(adsAGenerar.map((x, i) => [x.ad.id, i]));
    const worker = async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= adsAGenerar.length) return;
        const { brandNombre, ad } = adsAGenerar[i];
        setBulkProgress(prev => prev ? ({
          ...prev,
          adsList: prev.adsList.map((x, idx) =>
            idx === i ? { ...x, status: 'doing' } : x
          ),
        }) : prev);
        const adStartedAt = Date.now();
        const ok = await crearReferencialDeAd(brandNombre, ad);
        const adDuration = Date.now() - adStartedAt;
        setBulkProgress(prev => prev ? ({
          ...prev,
          completed: prev.completed + 1,
          currentIdx: Math.min(prev.currentIdx + 1, prev.total - 1),
          adDurations: [...prev.adDurations, adDuration],
          adsList: prev.adsList.map((x, idx) =>
            idx === i ? { ...x, status: ok ? 'done' : 'error' } : x
          ),
          errors: ok ? prev.errors : [...prev.errors, brandNombre],
        }) : prev);
      }
    };
    const workers = Array.from(
      { length: Math.min(BULK_CONCURRENCY, adsAGenerar.length) },
      () => worker()
    );
    await Promise.all(workers);

    limpiarSeleccion();
    setTimeout(() => setBulkProgress(null), 4000);
    addToast?.({ type: 'success', message: 'Generación bulk completa — revisá la galería' });
  };

  // Permite cerrar la barra de bulk manualmente.
  const cerrarBulkProgress = () => setBulkProgress(null);

  // Scrapea ads activos de una marca via Apify. Si tiene fbPageUrl, prefiere
  // eso (más estable). Sino, deriva keyword del landingUrl.
  const handleScrapeBrand = async (brand) => {
    setScrapingBrandId(brand.id);
    const execId = startExecution({
      label: `Scrapeando ads de ${brand.nombre}`,
      sublabel: 'Meta Ads Library vía Apify',
      kind: 'scrape',
      estimatedMs: 60000,
    });
    try {
      const payload = { country: 'ALL', limit: 100 };
      if (brand.fbPageUrl) {
        payload.fbPageUrl = brand.fbPageUrl.startsWith('http') ? brand.fbPageUrl : `https://www.facebook.com/${brand.fbPageUrl}`;
      } else if (brand.landingUrl) {
        updateExecution(execId, { stage: 'Buscando la FB page del competidor…' });
        try {
          const r = await fetch('/api/marketing/resolve-fb-page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ landingUrl: brand.landingUrl }),
          });
          const d = await r.json();
          if (d.pageUrl) {
            payload.fbPageUrl = d.pageUrl;
            setBrands(prev => prev.map(x => x.id === brand.id ? { ...x, fbPageUrl: d.pageUrl } : x));
          } else {
            payload.searchKeyword = landingToKeyword(brand.landingUrl);
          }
        } catch {
          payload.searchKeyword = landingToKeyword(brand.landingUrl);
        }
      } else if (isKeywordUsable(brand.nombre)) {
        payload.searchKeyword = brand.nombre;
      } else {
        throw new Error('Sin landing URL ni nombre utilizable. Cargá la landing o el FB page URL del competidor en Setup.');
      }
      if (!payload.fbPageUrl && !isKeywordUsable(payload.searchKeyword)) {
        throw new Error(`Keyword "${payload.searchKeyword}" no es utilizable (muy genérica). Cargá el FB page URL del competidor en Setup.`);
      }

      updateExecution(execId, { stage: `Scrapeando ${payload.fbPageUrl ? 'desde FB page' : `keyword "${payload.searchKeyword}"`}…` });
      const resp = await fetch('/api/marketing/apify-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const scrapeCost = logCostsFromResponse(data, `inspiracion · ${brand.nombre}`);

      const allAds = data.ads || [];
      // Solo statics (sin video) — para Inspiración nos interesan los estáticos.
      const staticAds = allAds.filter(a => (a.imageUrls?.length || 0) > 0 && (a.videoUrls?.length || 0) === 0);

      // Dedup día a día: marcamos como "fresh" los ads cuyo id NO estaba
      // en seenAdIds. El resto son repetidos de corridas anteriores —
      // los mostramos pero secundarios (collapsed por default en el UI).
      const seenSet = new Set(brand.seenAdIds || []);
      const enriched = staticAds.map(a => ({ ...a, isFresh: !seenSet.has(a.id) }));

      // Actualizamos seenAdIds con los ids de esta corrida (todos quedan
      // como vistos para la próxima).
      const newSeenIds = Array.from(new Set([...(brand.seenAdIds || []), ...staticAds.map(a => a.id)]));
      // Capamos a 1000 ids para no inflar localStorage.
      const cappedSeenIds = newSeenIds.slice(-1000);

      setAdsByBrand(prev => ({ ...prev, [brand.id]: enriched }));
      setBrands(prev => prev.map(x => x.id === brand.id ? {
        ...x,
        lastScraped: new Date().toISOString(),
        seenAdIds: cappedSeenIds,
      } : x));

      const freshCount = enriched.filter(a => a.isFresh).length;
      const repeatedCount = enriched.length - freshCount;
      const msg = freshCount > 0
        ? `${freshCount} estáticos NUEVOS de ${brand.nombre}${repeatedCount > 0 ? ` (+${repeatedCount} repetidos)` : ''}`
        : `${repeatedCount} estáticos de ${brand.nombre} (todos ya vistos antes)`;
      addToast?.({ type: 'success', message: msg });

      // Cacheo de imágenes en background — para que sobrevivan a las 24h del CDN.
      cacheNewAdsInBackground(enriched, { productoId: producto?.id, brandId: brand.id, brandNombre: brand.nombre });

      finishExecution(execId, { ok: true, message: msg, cost: scrapeCost?.total });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude scrapear ${brand.nombre}: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
    } finally {
      setScrapingBrandId(null);
    }
  };

  // Scrape específico para una marca COMPETIDOR (vive en producto.competidores).
  // Reusa apify-ingest pero el resultado lo escribimos en el producto, no en
  // `brands`. Después triggereamos refresh de productos.
  const handleScrapeCompetidor = async (brand) => {
    setScrapingBrandId(brand.id);
    const comp = brand.__sourceComp;
    if (!comp || !producto) {
      setScrapingBrandId(null);
      return;
    }
    const execId = startExecution({
      label: `Scrapeando ads de ${comp.nombre}`,
      sublabel: 'Meta Ads Library vía Apify',
      kind: 'scrape',
      estimatedMs: 60000,
    });
    try {
      const payload = { country: 'ALL', limit: 100 };
      if (comp.fbPageUrl) {
        payload.fbPageUrl = comp.fbPageUrl.startsWith('http') ? comp.fbPageUrl : `https://www.facebook.com/${comp.fbPageUrl}`;
      } else if (comp.landingUrl) {
        updateExecution(execId, { stage: 'Buscando la FB page del competidor…' });
        try {
          const r = await fetch('/api/marketing/resolve-fb-page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ landingUrl: comp.landingUrl }),
          });
          const d = await r.json();
          if (d.pageUrl) payload.fbPageUrl = d.pageUrl;
          else payload.searchKeyword = landingToKeyword(comp.landingUrl);
        } catch {
          payload.searchKeyword = landingToKeyword(comp.landingUrl);
        }
      } else if (isKeywordUsable(comp.nombre)) {
        payload.searchKeyword = comp.nombre;
      } else {
        throw new Error('Sin landing URL ni nombre utilizable. Cargá la landing o el FB page URL en Setup.');
      }
      if (!payload.fbPageUrl && !isKeywordUsable(payload.searchKeyword)) {
        throw new Error(`Keyword "${payload.searchKeyword}" no es utilizable (muy genérica). Cargá el FB page URL en Setup.`);
      }

      updateExecution(execId, { stage: `Scrapeando ${payload.fbPageUrl ? 'desde FB page' : `keyword "${payload.searchKeyword}"`}…` });
      const resp = await fetch('/api/marketing/apify-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const scrapeCost = logCostsFromResponse(data, `inspiracion · ${comp.nombre}`);

      const ads = data.ads || [];
      const prevIds = new Set((comp.ads || []).map(a => a.id));
      const newAds = ads.filter(a => !prevIds.has(a.id));

      // Actualizamos el producto en localStorage (donde viven los competidores).
      const fresh = loadProductos();
      const updated = fresh.map(p => {
        if (String(p.id) !== String(producto.id)) return p;
        const comps = (p.competidores || []).map(c => {
          if (c.id !== comp.id) return c;
          return {
            ...c, ads,
            adsTotal: data.total || 0, winnersCount: data.winners || 0,
            lastAdsCheck: new Date().toISOString(),
          };
        });
        return { ...p, competidores: comps, updated_at: new Date().toISOString() };
      });
      try { localStorage.setItem(PRODUCTOS_KEY, JSON.stringify(updated)); } catch {}
      setProductos(updated);

      const msg = newAds.length > 0
        ? `${newAds.length} estáticos NUEVOS de ${comp.nombre} (${ads.length} total)`
        : `${ads.length} estáticos de ${comp.nombre} (sin nuevos)`;
      addToast?.({ type: 'success', message: msg });

      // Cache en background. Para Inspiración solo nos interesan los estáticos.
      const staticAds = ads.filter(a => (a.imageUrls?.length || 0) > 0 && (a.videoUrls?.length || 0) === 0);
      cacheNewAdsInBackground(staticAds, { productoId: producto.id, brandId: brand.id, brandNombre: comp.nombre });

      finishExecution(execId, { ok: true, message: msg, cost: scrapeCost?.total });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude scrapear ${brand.nombre}: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
    } finally {
      setScrapingBrandId(null);
    }
  };

  // Cacheo asíncrono de imágenes — corre en background sin bloquear UI.
  // Avisa por toast al terminar (solo si cacheó algo significativo).
  const cacheNewAdsInBackground = (ads, { productoId, brandId, brandNombre }) => {
    if (!ads || ads.length === 0) return;
    // No await — fire and forget.
    cacheAdImagesBatch(ads, {
      productoId, brandId,
      concurrency: 4,
    }).then(({ cached, total }) => {
      if (cached > 0) {
        addToast?.({
          type: 'info',
          message: `${cached}/${total} imágenes de ${brandNombre} cacheadas localmente`,
        });
      }
    }).catch(() => {});
  };

  // ====================================================================
  // VISTA 1: SELECTOR DE PRODUCTOS
  // ====================================================================
  if (!activeProductoId || !producto) {
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-brand-500 flex items-center justify-center text-white shadow-sm">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Inspiración de estáticos</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Marcas de cualquier rubro que hacen buenos estáticos — para inspirar el diseño visual del producto.
            </p>
          </div>
        </div>

        {productos.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
            <Package size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin productos cargados</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Andá a Arranque y creá un producto primero.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {productos.map(p => {
              const brandsCount = loadBrands(String(p.id)).length;
              const inicial = p.nombre?.charAt(0)?.toUpperCase() || 'P';
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveProductoId(String(p.id))}
                  className="text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-md transition group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-500 to-brand-500 flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition">
                      {inicial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {brandsCount > 0
                          ? `${brandsCount} marca${brandsCount !== 1 ? 's' : ''} de inspiración`
                          : 'Sin marcas de inspiración todavía'}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400 group-hover:text-amber-500 transition shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ====================================================================
  // VISTA 2: BRANDS DE INSPIRACIÓN DEL PRODUCTO
  // ====================================================================
  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Barra flotante cuando hay ads seleccionados — bulk action + opciones. */}
      {seleccionados.size > 0 && !bulkProgress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded-xl shadow-2xl px-4 py-3 flex flex-wrap items-center gap-3 max-w-[calc(100vw-3rem)]">
          <div className="text-xs">
            <span className="font-bold text-gray-900 dark:text-gray-100">{seleccionados.size}</span>
            <span className="text-gray-500 dark:text-gray-400"> / {MAX_SELECCIONADOS} ads</span>
          </div>

          {/* n=2 fijo — la lógica de "por las dudas que una salga mejor" se
              cubre con 2 variantes. No agregamos selector para no encarecer. */}
          <span className="text-[10px] text-gray-500 dark:text-gray-400 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
            2 variantes
          </span>

          {/* Selector de aspect ratio */}
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-500 dark:text-gray-400">Ratio:</span>
            {[
              { v: '2048x2048', label: '1:1' },
              { v: '1024x1536', label: 'Portrait' },
            ].map(opt => (
              <button key={opt.v}
                onClick={() => setGenOpts(o => ({ ...o, size: opt.v }))}
                className={`px-2 py-0.5 rounded font-bold transition ${
                  genOpts.size === opt.v
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >{opt.label}</button>
            ))}
          </div>

          <button onClick={limpiarSeleccion}
            className="text-[11px] text-gray-500 hover:text-red-500 transition">
            Limpiar
          </button>
          <button onClick={handleBulkCrear}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-600 to-brand-500 rounded-lg hover:from-brand-700 hover:to-brand-600 transition">
            <Sparkles size={13} /> Generar {seleccionados.size * N_VARIANTES_FIJO} creativos
          </button>
        </div>
      )}

      {/* Barra de progreso del bulk — reemplaza a la barra de seleccionados
          mientras está corriendo. Muestra current ad, % total, ETA y pills
          por cada ad para ver qué está pendiente/listo/fallado. */}
      {bulkProgress && (
        <BulkProgressBar
          state={bulkProgress}
          onClose={cerrarBulkProgress}
        />
      )}

      {/* Modal de galería */}
      {showGaleria && producto && (
        <GaleriaReferencialesModal
          productoId={producto.id}
          productoNombre={producto.nombre}
          onClose={() => setShowGaleria(false)}
        />
      )}

      {/* Header thin (Linear-style 36px) — solo cuando NO está embebido.
          Single line breadcrumb back. Las acciones primarias (Galería, +Marca)
          viven en la toolbar de abajo para evitar duplicar UI. */}
      {!embedded && (
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setActiveProductoId(null)}
            className="inline-flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition"
            title="Volver al selector"
          >
            <ChevronRight size={12} className="rotate-180" />
            <span className="font-semibold">Inspiración</span>
          </button>
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span className="font-bold text-gray-900 dark:text-gray-100 truncate">{producto.nombre}</span>
        </div>
      )}

      {/* Form de agregar marca */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Nueva marca de inspiración</p>
            <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600 transition">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Nombre *</label>
              <input
                type="text" value={draft.nombre}
                onChange={e => setDraft(d => ({ ...d, nombre: e.target.value }))}
                placeholder="Ej: Liquid Death, Glossier, Olipop…"
                className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Landing URL</label>
              <input
                type="text" value={draft.landingUrl}
                onChange={e => setDraft(d => ({ ...d, landingUrl: e.target.value }))}
                placeholder="https://liquiddeath.com"
                className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">FB Page URL (opcional, mejor scraping)</label>
              <input
                type="text" value={draft.fbPageUrl}
                onChange={e => setDraft(d => ({ ...d, fbPageUrl: e.target.value }))}
                placeholder="https://facebook.com/liquiddeath"
                className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Por qué te inspira (opcional)</label>
              <input
                type="text" value={draft.notas}
                onChange={e => setDraft(d => ({ ...d, notas: e.target.value }))}
                placeholder="Ej: Branding rebelde, paleta inversa, copy con doble sentido…"
                className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded transition hover:bg-gray-50">
              Cancelar
            </button>
            <button onClick={handleAddBrand}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded hover:from-amber-600 hover:to-brand-600 transition">
              Agregar
            </button>
          </div>
        </div>
      )}

      {/* Unificamos competidores (auto) + brands manuales en una sola lista
          aplicando los filtros de la barra de vistas. */}
      {(() => {
        // Construimos array unificado.
        const competidoresUnif = (producto.competidores || []).map(c => {
          const staticAds = (c.ads || []).filter(a => (a.imageUrls?.length || 0) > 0 && (a.videoUrls?.length || 0) === 0);
          return {
            id: `comp-${c.id}`,
            nombre: c.nombre,
            landingUrl: c.landingUrl,
            fbPageUrl: c.fbPageUrl,
            lastScraped: c.lastAdsCheck,
            seenAdIds: c._inspirationSeenIds || [],
            isCompetidor: true,
            __ads: staticAds,
            __sourceComp: c,
          };
        });
        // Antes filtrábamos competidores SIN ads — eso los ocultaba en Inspiración
        // y obligaba a ir a Setup primero. Ahora aparecen siempre con un card
        // vacío y botón "Scrapear ads ahora" — más directo.
        const customUnif = brands.map(b => ({
          ...b,
          isCompetidor: false,
          __ads: adsByBrand[b.id] || [],
        }));
        let unif = [...competidoresUnif, ...customUnif];

        // Filtros
        if (tipoFiltro === 'competidor') unif = unif.filter(b => b.isCompetidor);
        else if (tipoFiltro === 'custom') unif = unif.filter(b => !b.isCompetidor);
        if (estadoFiltro === 'con-ads') unif = unif.filter(b => b.__ads.length > 0);
        else if (estadoFiltro === 'sin-scrapear') unif = unif.filter(b => !b.lastScraped && b.__ads.length === 0);
        if (query.trim()) {
          const q = query.toLowerCase();
          unif = unif.filter(b => `${b.nombre} ${b.landingUrl || ''} ${b.notas || ''}`.toLowerCase().includes(q));
        }

        // Ordenamiento
        unif = [...unif].sort((a, b) => {
          if (orderBy === 'nombre') return (a.nombre || '').localeCompare(b.nombre || '');
          if (orderBy === 'ads-count') return (b.__ads?.length || 0) - (a.__ads?.length || 0);
          // default 'reciente': lastScraped desc, sin scrape al final
          const aT = a.lastScraped ? new Date(a.lastScraped).getTime() : 0;
          const bT = b.lastScraped ? new Date(b.lastScraped).getTime() : 0;
          return bT - aT;
        });

        // ====================================================================
        // TOP 10 ESCALADOS — agregamos ads de TODAS las brands (competidores
        // y custom), filtramos estáticos, ordenamos por score desc.
        // El score ya considera daysRunning + variantes + multiplatform +
        // pageLikeCount + penalty pause early (ver _apify.js scoreAd).
        // ====================================================================
        const allAdsForRanking = [];
        unif.forEach(b => {
          (b.__ads || []).forEach(ad => {
            // Solo ads con imagen + score conocido (ya pasaron por scoreAd).
            if ((ad.imageUrls?.length || 0) === 0) return;
            if (typeof ad.score !== 'number') return;
            allAdsForRanking.push({ ad, brandNombre: b.nombre, isCompetidor: b.isCompetidor });
          });
        });
        const topEscalados = allAdsForRanking
          .sort((a, b) => (b.ad.score || 0) - (a.ad.score || 0))
          .slice(0, 10);

        return (
          <div className="space-y-4">
            {/* Top 10 escalados — solo aparece si hay 3+ ads para rankear. */}
            {topEscalados.length >= 3 && (
              <TopEscaladosBar
                items={topEscalados}
                adaptingAdIds={adaptingAdIds}
                creandoAdIds={creandoAdIds}
                seleccionados={seleccionados}
                progressById={progressById}
                onAdapt={(brandNombre, ad) => handleAdapt(brandNombre, ad)}
                onCrearReferencial={(brandNombre, ad) => crearReferencialDeAd(brandNombre, ad)}
                onToggleSelect={(adId) => toggleSeleccion(adId)}
              />
            )}

            {/* Toolbar consolidada (Stripe/Linear) — search + filtros + counter + acciones
                en una sola línea. Reemplaza la antigua barra de filtros + los botones
                Galería/Agregar marca del header. Densidad alta. */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text" value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar marca, URL, notas…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}
                className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">
                <option value="all">Todos</option>
                <option value="competidor">Competidores</option>
                <option value="custom">Custom</option>
              </select>
              <select value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}
                className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">
                <option value="all">Todos</option>
                <option value="con-ads">Con ads</option>
                <option value="sin-scrapear">Sin scrapear</option>
              </select>
              <select value={orderBy} onChange={e => setOrderBy(e.target.value)}
                className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">
                <option value="reciente">Reciente</option>
                <option value="ads-count">Más ads</option>
                <option value="nombre">Nombre</option>
              </select>
              <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400 px-1">
                {unif.length}
              </span>
              {/* Separador visual + acciones primarias */}
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" aria-hidden />
              <button
                onClick={() => setShowGaleria(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800 rounded hover:bg-brand-100 dark:hover:bg-brand-900/50 transition"
                title="Ver creativos generados"
              >
                <Images size={11} /> Galería
              </button>
              <button
                onClick={() => setShowAddForm(s => !s)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded hover:from-amber-600 hover:to-brand-600 shadow-sm transition"
              >
                <Plus size={11} /> Marca
              </button>
            </div>

            {/* Grilla unificada */}
            {unif.length === 0 ? (
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
                <Sparkles size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ninguna marca coincide con el filtro</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Probá ajustar los filtros o agregá marcas custom con el botón de arriba.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {unif.map(b => (
                  <BrandCard
                    key={b.id}
                    brand={b}
                    ads={b.__ads}
                    isScraping={scrapingBrandId === b.id}
                    adaptingAdIds={adaptingAdIds}
                    creandoAdIds={creandoAdIds}
                    seleccionados={seleccionados}
                    progressById={progressById}
                    onScrape={() => b.isCompetidor ? handleScrapeCompetidor(b) : handleScrapeBrand(b)}
                    onAdapt={(ad) => handleAdapt(b.nombre, ad)}
                    onCrearReferencial={(ad) => crearReferencialDeAd(b.nombre, ad)}
                    onToggleSelect={(adId) => toggleSeleccion(adId)}
                    onRemove={b.isCompetidor ? null : () => handleRemoveBrand(b.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function BrandCard({ brand, ads, isScraping, adaptingAdIds, creandoAdIds, seleccionados, progressById, onScrape, onAdapt, onCrearReferencial, onToggleSelect, onRemove }) {
  const isCompetidor = !!brand.isCompetidor;
  return (
    <div className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-amber-300 dark:hover:border-amber-700 transition">
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center text-white font-bold text-sm shrink-0 ${
          isCompetidor
            ? 'bg-gradient-to-br from-brand-600 to-brand-500'
            : 'bg-gradient-to-br from-amber-400 to-brand-400'
        }`}>
          {brand.nombre?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{brand.nombre}</p>
            {isCompetidor && (
              <span className="px-1 py-px text-[8px] font-bold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded uppercase tracking-wider shrink-0">
                comp
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 truncate">
            {brand.landingUrl && (
              <a href={brand.landingUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-brand-600 hover:underline truncate">
                <Link2 size={9} /> {brand.landingUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]}
              </a>
            )}
            {brand.lastScraped && (
              <span className="shrink-0">· {new Date(brand.lastScraped).toLocaleDateString('es-AR')}</span>
            )}
            {!brand.lastScraped && <span className="italic shrink-0">· sin scrapear</span>}
          </div>
        </div>
        {/* Botón scrape inline en el header — más compacto que antes (estaba en una fila aparte) */}
        {onScrape && (
          <button
            onClick={onScrape}
            disabled={isScraping}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded hover:from-amber-600 hover:to-brand-600 transition disabled:opacity-50 shrink-0"
            title={brand.lastScraped ? 'Volver a scrapear' : 'Scrapear ads'}
          >
            {isScraping
              ? <><Loader2 size={10} className="animate-spin" /> Scrapeando…</>
              : <><Download size={10} /> {brand.lastScraped ? 'Re-scrape' : 'Scrape'}</>
            }
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove}
            className="p-1 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition shrink-0"
            title="Eliminar marca">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {/* Notas — solo si hay, en línea aparte chiquita */}
      {brand.notas && (
        <p className="text-[10px] text-gray-600 dark:text-gray-400 italic mt-1.5 line-clamp-1">"{brand.notas}"</p>
      )}
      {/* Contador de ads cargados — solo si hay ads */}
      {ads.length > 0 && (
        <div className="mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
          {ads.length} estáticos cargados
        </div>
      )}

      {/* Grilla de estáticos scrapeados */}
      {ads.length > 0 && (
        <BrandAdsGrid
          ads={ads}
          brandNombre={brand.nombre}
          adaptingAdIds={adaptingAdIds}
          creandoAdIds={creandoAdIds}
          seleccionados={seleccionados}
          progressById={progressById}
          onAdapt={onAdapt}
          onCrearReferencial={onCrearReferencial}
          onToggleSelect={onToggleSelect}
        />
      )}
    </div>
  );
}

function BrandAdsGrid({ ads, brandNombre, adaptingAdIds, creandoAdIds, seleccionados, progressById, onAdapt, onCrearReferencial, onToggleSelect }) {
  const [showRepeated, setShowRepeated] = useState(false);
  const fresh = ads.filter(a => a.isFresh !== false);
  const repeated = ads.filter(a => a.isFresh === false);

  return (
    <div className="mt-3 space-y-3">
      {/* Frescos del día */}
      {fresh.length > 0 ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1.5 flex items-center gap-1">
            ✨ Nuevos del día <span className="text-gray-400 font-normal">({fresh.length})</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {fresh.slice(0, 30).map(ad => (
              <AdThumb
                key={ad.id}
                ad={ad}
                brandNombre={brandNombre}
                fresh
                adapting={adaptingAdIds?.has(ad.id)}
                creando={creandoAdIds?.has(ad.id)}
                selected={seleccionados?.has(ad.id)}
                progress={progressById?.[ad.id]}
                onAdapt={onAdapt ? () => onAdapt(ad) : null}
                onCrearReferencial={onCrearReferencial ? () => onCrearReferencial(ad) : null}
                onToggleSelect={onToggleSelect ? () => onToggleSelect(ad.id) : null}
              />
            ))}
            {fresh.length > 30 && (
              <div className="aspect-square rounded-md flex items-center justify-center bg-gray-50 dark:bg-gray-900 border-2 border-dashed border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 italic">
                +{fresh.length - 30} más
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[10px] italic text-gray-500 dark:text-gray-400 text-center py-2 bg-gray-50 dark:bg-gray-900/30 rounded">
          Sin estáticos nuevos hoy — todos ya los habías visto.
        </p>
      )}

      {/* Repetidos colapsables */}
      {repeated.length > 0 && (
        <div>
          <button
            onClick={() => setShowRepeated(s => !s)}
            className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition flex items-center gap-1"
          >
            <ChevronRight size={10} className={`transition-transform ${showRepeated ? 'rotate-90' : ''}`} />
            Ya vistos ({repeated.length})
          </button>
          {showRepeated && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 opacity-60">
              {repeated.slice(0, 30).map(ad => (
                <AdThumb
                  key={ad.id}
                  ad={ad}
                  brandNombre={brandNombre}
                  adapting={adaptingAdIds?.has(ad.id)}
                  creando={creandoAdIds?.has(ad.id)}
                  selected={seleccionados?.has(ad.id)}
                  onAdapt={onAdapt ? () => onAdapt(ad) : null}
                  onCrearReferencial={onCrearReferencial ? () => onCrearReferencial(ad) : null}
                  onToggleSelect={onToggleSelect ? () => onToggleSelect(ad.id) : null}
                />
              ))}
              {repeated.length > 30 && (
                <div className="aspect-square rounded-md flex items-center justify-center bg-gray-50 dark:bg-gray-900 border-2 border-dashed border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 italic">
                  +{repeated.length - 30}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Estima un % de progreso "honesto" para una llamada de gpt-image-2.
// preparando: 0-8% / generando: 8-92% asintótico ~45s / guardando: 92-99% / done: 100%.
function estimateProgress(progress) {
  if (!progress) return 0;
  const elapsed = (Date.now() - progress.startedAt) / 1000;
  if (progress.stage === 'preparando') return Math.min(8, elapsed * 4);
  if (progress.stage === 'generando') {
    // Asintótica hacia 92% con τ=30s.
    return 8 + (92 - 8) * (1 - Math.exp(-Math.max(0, elapsed - 0.5) / 30));
  }
  if (progress.stage === 'guardando') return 95;
  if (progress.stage === 'done') return 100;
  return 0;
}

function stageLabel(stage) {
  if (stage === 'preparando') return 'Preparando prompt…';
  if (stage === 'generando') return 'Generando con gpt-image-2…';
  if (stage === 'guardando') return 'Guardando en galería…';
  if (stage === 'done') return '¡Listo!';
  if (stage === 'error') return 'Falló';
  return '';
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Barra flotante de progreso del bulk. Muestra ad current, % total, ETA
// y un pill por cada ad para ver qué está done/doing/pending/error.
function BulkProgressBar({ state, onClose }) {
  const { total, completed, currentIdx, current, startedAt, adsList, errors, adDurations } = state;
  const elapsedMs = Date.now() - startedAt;
  // ETA basado en duración promedio de los ads ya completos. Fallback: 45s/ad.
  const avgMs = adDurations.length > 0
    ? adDurations.reduce((a, b) => a + b, 0) / adDurations.length
    : 45000;
  const remainingMs = Math.max(0, (total - completed) * avgMs);
  const pct = Math.round((completed / total) * 100);
  const isDone = completed === total;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 border-2 border-brand-400 dark:border-brand-700 rounded-xl shadow-2xl w-[420px] max-w-[calc(100vw-3rem)] overflow-hidden">
      <div className="p-3.5">
        <div className="flex items-center gap-2 mb-2">
          {isDone
            ? <Check size={16} className="text-emerald-500" />
            : <Loader2 size={14} className="text-brand-500 animate-spin" />
          }
          <p className="text-xs font-bold text-gray-900 dark:text-gray-100 flex-1 truncate">
            {isDone
              ? `Completo · ${completed - errors.length}/${total} OK${errors.length > 0 ? ` · ${errors.length} fallaron` : ''}`
              : `Generando ${currentIdx + 1} de ${total}`
            }
          </p>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Cerrar">
            <X size={14} />
          </button>
        </div>

        {!isDone && current && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate mb-2">
            <span className="font-semibold text-brand-600 dark:text-brand-400">{current.brandNombre}</span>
            {current.adHeadline && <span> · {current.adHeadline}</span>}
          </p>
        )}

        {/* Barra de progreso total (basado en ads completos) */}
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-1">
          <div
            className={`h-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-500 to-brand-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
          <span>{pct}% · transcurrido {formatMs(elapsedMs)}</span>
          {!isDone && <span>ETA {formatMs(remainingMs)}</span>}
        </div>

        {/* Pills por ad — visual mini-status. */}
        <div className="flex flex-wrap gap-1 mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-700">
          {adsList.map((x, i) => (
            <div
              key={x.adId + i}
              title={`${x.brandNombre} · ${x.status}`}
              className={`w-2.5 h-2.5 rounded-full ${
                x.status === 'done' ? 'bg-emerald-500'
                : x.status === 'error' ? 'bg-red-500'
                : x.status === 'doing' ? 'bg-brand-500 animate-pulse'
                : 'bg-gray-300 dark:bg-gray-600'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Top 10 escalados — agrega ads de todas las brands del producto, los rankea
// por score (que el backend ya calcula con daysRunning + variantes +
// multiplatform + pageLikeCount + penalty pause early), y los muestra en una
// strip horizontal. Cada item es un AdThumb con sus acciones normales
// (Crear creativo, + ideas en Bandeja, multi-select).
function TopEscaladosBar({ items, adaptingAdIds, creandoAdIds, seleccionados, progressById, onAdapt, onCrearReferencial, onToggleSelect }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="bg-gradient-to-br from-amber-50 to-brand-50 dark:from-amber-950/30 dark:to-brand-950/30 border border-amber-200 dark:border-amber-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-2.5 flex items-center gap-2.5 text-left hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition"
      >
        <span className="text-base">🏆</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
            Top {items.length} escalados de tu competencia
          </p>
          <p className="text-[10px] text-amber-700 dark:text-amber-300/80">
            Rankeados por: días corriendo + variantes activas + multiplataforma + popularidad de marca
          </p>
        </div>
        <ChevronDown size={14} className={`text-amber-700 dark:text-amber-300 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-10 gap-2">
            {items.map(({ ad, brandNombre, isCompetidor }, idx) => (
              <div key={ad.id} className="relative">
                {/* Badge de ranking — esquina superior izquierda */}
                <div className={`absolute -top-1 -left-1 z-20 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md ${
                  idx === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600'
                  : idx < 3 ? 'bg-gradient-to-br from-amber-500 to-brand-500'
                  : 'bg-gradient-to-br from-gray-600 to-gray-700'
                }`}>
                  {idx + 1}
                </div>
                <AdThumb
                  ad={ad}
                  brandNombre={brandNombre}
                  fresh={ad.isFresh !== false}
                  adapting={adaptingAdIds?.has(ad.id)}
                  creando={creandoAdIds?.has(ad.id)}
                  selected={seleccionados?.has(ad.id)}
                  progress={progressById?.[ad.id]}
                  onAdapt={onAdapt ? () => onAdapt(brandNombre, ad) : null}
                  onCrearReferencial={onCrearReferencial ? () => onCrearReferencial(brandNombre, ad) : null}
                  onToggleSelect={onToggleSelect ? () => onToggleSelect(ad.id) : null}
                />
                {/* Footer chico con brand + métricas para que no sea solo thumb */}
                <div className="mt-1 px-0.5">
                  <p className="text-[9px] font-semibold text-gray-700 dark:text-gray-200 truncate">
                    {isCompetidor && <span className="text-brand-600 dark:text-brand-400">●</span>} {brandNombre}
                  </p>
                  <div className="flex items-center gap-1.5 text-[9px] text-gray-500 dark:text-gray-400">
                    {ad.daysRunning != null && <span title="Días corriendo">{ad.daysRunning}d</span>}
                    {ad.variantes > 0 && <span title="Variantes activas">·{ad.variantes}v</span>}
                    {typeof ad.score === 'number' && <span className="ml-auto font-bold text-amber-600 dark:text-amber-400" title="Score compuesto">{Math.round(ad.score)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdThumb({ ad, brandNombre, fresh = false, adapting = false, creando = false, selected = false, onAdapt, onCrearReferencial, onToggleSelect, progress = null }) {
  const cdnThumb = ad.imageUrls?.[0];
  const fbUrl = ad.snapshotUrl;
  // Si tenemos el ad cacheado en IndexedDB (sobreviven el TTL de 24h del CDN),
  // preferimos el blob URL. Sino, caemos al CDN. Si el CDN falla (URL expirada),
  // el onError oculta el <img> y queda el placeholder.
  const [cachedUrl, setCachedUrl] = useState(null);
  useEffect(() => {
    let active = true;
    if (ad?.id) {
      getCachedAdImageUrl(ad.id).then(url => { if (active) setCachedUrl(url); });
    }
    const onSaved = (e) => {
      if (String(e?.detail?.adId || '') === String(ad?.id)) {
        getCachedAdImageUrl(ad.id).then(url => { if (active) setCachedUrl(url); });
      }
    };
    window.addEventListener('viora:ad-image-cached', onSaved);
    return () => { active = false; window.removeEventListener('viora:ad-image-cached', onSaved); };
  }, [ad?.id]);
  const thumb = cachedUrl || cdnThumb;
  return (
    <div
      className={`group relative aspect-square rounded-md overflow-hidden bg-gray-100 dark:bg-gray-900 border-2 transition ${
        selected
          ? 'border-brand-500 ring-2 ring-brand-300 dark:ring-brand-700'
          : fresh
            ? 'border-emerald-300 dark:border-emerald-700 hover:border-emerald-500'
            : 'border-gray-200 dark:border-gray-700 hover:border-amber-400'
      }`}
      title={ad.body?.slice(0, 200) || ad.headline || ''}
    >
      {thumb ? (
        <img src={thumb} alt="" className="w-full h-full object-cover"
          onError={(e) => { e.target.style.display = 'none'; }} />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon size={20} className="text-gray-300" />
        </div>
      )}
      {/* Indicador de imagen cacheada localmente — solo on-hover para no
          contaminar. Le da feedback al usuario de que las imágenes están
          seguras de la expiración del CDN. */}
      {cachedUrl && (
        <div className="absolute top-1 right-7 w-1.5 h-1.5 rounded-full bg-emerald-400/80 opacity-0 group-hover:opacity-100 transition" title="Imagen cacheada localmente" />
      )}

      {/* Checkbox de selección — siempre visible si está seleccionado, sino on-hover. */}
      {onToggleSelect && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(); }}
          className={`absolute top-1 left-1 w-5 h-5 rounded flex items-center justify-center transition ${
            selected
              ? 'bg-brand-500 text-white opacity-100'
              : 'bg-white/90 dark:bg-gray-800/90 border border-gray-300 dark:border-gray-600 text-transparent opacity-0 group-hover:opacity-100 hover:border-brand-500'
          }`}
          title={selected ? 'Deseleccionar' : 'Seleccionar para bulk'}
        >
          {selected && <Check size={12} />}
        </button>
      )}

      {/* Progress overlay — visible mientras el ad se está generando o
          acaba de terminar/fallar. Tapa todo el thumb para que se vea claro. */}
      {progress && (
        <div className="absolute inset-0 bg-gray-900/85 z-10 flex flex-col items-center justify-center gap-2 p-3 text-white">
          {progress.stage === 'done' ? (
            <Check size={28} className="text-emerald-400" />
          ) : progress.stage === 'error' ? (
            <AlertCircle size={28} className="text-red-400" />
          ) : (
            <Loader2 size={20} className="text-brand-300 animate-spin" />
          )}
          <p className="text-[10px] font-bold text-center leading-tight">
            {stageLabel(progress.stage)}
          </p>
          {progress.stage !== 'done' && progress.stage !== 'error' && (
            <>
              <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-400 to-brand-200 transition-all duration-500"
                  style={{ width: `${estimateProgress(progress)}%` }}
                />
              </div>
              <p className="text-[9px] text-white/70">
                {formatMs(Date.now() - progress.startedAt)}
              </p>
            </>
          )}
          {progress.stage === 'error' && progress.error && (
            <p className="text-[9px] text-red-200 text-center line-clamp-2">{progress.error}</p>
          )}
        </div>
      )}

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition flex flex-col items-stretch justify-end gap-1 p-1.5">
        {onCrearReferencial && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCrearReferencial(); }}
            disabled={creando}
            className="opacity-0 group-hover:opacity-100 transition inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded disabled:opacity-70"
            title="Genera 2 variaciones con tu producto real"
          >
            {creando
              ? <><Loader2 size={10} className="animate-spin" /> Generando…</>
              : <><Sparkles size={10} /> Crear creativo</>
            }
          </button>
        )}
        {onAdapt && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdapt(); }}
            disabled={adapting}
            className="opacity-0 group-hover:opacity-100 transition inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-semibold text-white bg-amber-500/90 hover:bg-amber-600 rounded disabled:opacity-70"
            title="Genera ideas (texto) en la Bandeja"
          >
            {adapting
              ? <><Loader2 size={10} className="animate-spin" /> Adaptando…</>
              : <><Wand2 size={10} /> + ideas en Bandeja</>
            }
          </button>
        )}
        <a
          href={fbUrl} target="_blank" rel="noreferrer"
          className="opacity-0 group-hover:opacity-100 transition inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-semibold text-white bg-black/70 hover:bg-black/90 rounded"
        >
          <ExternalLink size={10} /> Ver en FB
        </a>
      </div>
      {ad.daysRunning > 0 && (
        <div className="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-black/60 text-white pointer-events-none">
          {ad.daysRunning}d
        </div>
      )}
      {fresh && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[8px] font-bold rounded bg-emerald-500 text-white pointer-events-none">
          NUEVO
        </div>
      )}
    </div>
  );
}
