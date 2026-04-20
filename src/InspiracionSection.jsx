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
  Sparkles, Package, ChevronRight, Plus, Trash2, Link2, X,
  Loader2, Download, Image as ImageIcon, ExternalLink,
} from 'lucide-react';
import { logCostsFromResponse } from './costsStore.js';

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

export default function InspiracionSection({ addToast }) {
  const [productos, setProductos] = useState(() => loadProductos());
  const [activeProductoId, setActiveProductoId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
  });
  const [brands, setBrands] = useState(() => loadBrands(activeProductoId));
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({ nombre: '', landingUrl: '', fbPageUrl: '', notas: '' });
  const [scrapingBrandId, setScrapingBrandId] = useState(null);
  // brand.id → array de ads scrapeados de la última corrida (mostrados inline).
  const [adsByBrand, setAdsByBrand] = useState({});

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

  // Scrapea ads activos de una marca via Apify. Si tiene fbPageUrl, prefiere
  // eso (más estable). Sino, deriva keyword del landingUrl.
  const handleScrapeBrand = async (brand) => {
    setScrapingBrandId(brand.id);
    try {
      const payload = { country: 'ALL', limit: 100 };
      if (brand.fbPageUrl) {
        payload.fbPageUrl = brand.fbPageUrl.startsWith('http') ? brand.fbPageUrl : `https://www.facebook.com/${brand.fbPageUrl}`;
      } else if (brand.landingUrl) {
        // Reusamos el resolver de FB page primero — más confiable.
        try {
          const r = await fetch('/api/marketing/resolve-fb-page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ landingUrl: brand.landingUrl }),
          });
          const d = await r.json();
          if (d.pageUrl) {
            payload.fbPageUrl = d.pageUrl;
            // Persistimos el fbPageUrl encontrado.
            setBrands(prev => prev.map(x => x.id === brand.id ? { ...x, fbPageUrl: d.pageUrl } : x));
          } else {
            payload.searchKeyword = brand.nombre;
          }
        } catch {
          payload.searchKeyword = brand.nombre;
        }
      } else {
        payload.searchKeyword = brand.nombre;
      }

      const resp = await fetch('/api/marketing/apify-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      logCostsFromResponse(data, `inspiracion · ${brand.nombre}`);

      const allAds = data.ads || [];
      // Solo statics (sin video) — para Inspiración nos interesan los estáticos.
      const staticAds = allAds.filter(a => (a.imageUrls?.length || 0) > 0 && (a.videoUrls?.length || 0) === 0);

      // Marcamos como vistos los ya scrapeados antes (dedup en Parte 7.3).
      // Por ahora simplemente guardamos en estado + actualizamos lastScraped.
      setAdsByBrand(prev => ({ ...prev, [brand.id]: staticAds }));
      setBrands(prev => prev.map(x => x.id === brand.id ? { ...x, lastScraped: new Date().toISOString() } : x));

      addToast?.({ type: 'success', message: `${staticAds.length} estáticos de ${brand.nombre} cargados` });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude scrapear ${brand.nombre}: ${err.message}` });
    } finally {
      setScrapingBrandId(null);
    }
  };

  // ====================================================================
  // VISTA 1: SELECTOR DE PRODUCTOS
  // ====================================================================
  if (!activeProductoId || !producto) {
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-sm">
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
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition">
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
      {/* Header con breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveProductoId(null)}
          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition shrink-0"
          title="Volver al selector"
        >
          <ChevronRight size={16} className="rotate-180" />
        </button>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-sm shrink-0">
          <Sparkles size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            <button onClick={() => setActiveProductoId(null)} className="hover:text-amber-500 transition">Inspiración</button> / {producto.nombre}
          </p>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{producto.nombre}</h2>
        </div>
        <button
          onClick={() => setShowAddForm(s => !s)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg hover:from-amber-600 hover:to-orange-600 shadow-sm transition"
        >
          <Plus size={12} /> Agregar marca
        </button>
      </div>

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
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-orange-500 rounded hover:from-amber-600 hover:to-orange-600 transition">
              Agregar
            </button>
          </div>
        </div>
      )}

      {/* Lista de brands */}
      {brands.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
          <Sparkles size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin marcas de inspiración todavía</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Agregá marcas que hagan estáticos que te gusten — de cualquier rubro.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {brands.map(brand => (
            <BrandCard
              key={brand.id}
              brand={brand}
              ads={adsByBrand[brand.id] || []}
              isScraping={scrapingBrandId === brand.id}
              onScrape={() => handleScrapeBrand(brand)}
              onRemove={() => handleRemoveBrand(brand.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BrandCard({ brand, ads, isScraping, onScrape, onRemove }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-400 to-orange-400 flex items-center justify-center text-white font-bold text-lg shrink-0">
          {brand.nombre?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{brand.nombre}</p>
          {brand.landingUrl && (
            <a href={brand.landingUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline truncate max-w-full">
              <Link2 size={10} /> {brand.landingUrl.replace(/^https?:\/\//, '').replace(/^www\./, '')}
            </a>
          )}
          {brand.fbPageUrl && (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">FB: {brand.fbPageUrl.replace(/^https?:\/\//, '').replace(/^www\.facebook\.com\//, '@')}</p>
          )}
          {brand.notas && (
            <p className="text-[11px] text-gray-700 dark:text-gray-300 italic mt-1 line-clamp-2">"{brand.notas}"</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-500 dark:text-gray-400">
            {brand.lastScraped ? (
              <span>Última corrida: {new Date(brand.lastScraped).toLocaleDateString('es-AR')}</span>
            ) : (
              <span className="italic">Aún sin scrapear</span>
            )}
            {brand.seenAdIds?.length > 0 && (
              <span>· {brand.seenAdIds.length} ads vistos</span>
            )}
          </div>
        </div>
        <button onClick={onRemove}
          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition shrink-0"
          title="Eliminar marca">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Botón scrapear */}
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2">
        <button
          onClick={onScrape}
          disabled={isScraping}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-orange-500 rounded-md hover:from-amber-600 hover:to-orange-600 transition disabled:opacity-50"
        >
          {isScraping
            ? <><Loader2 size={12} className="animate-spin" /> Scrapeando…</>
            : <><Download size={12} /> {brand.lastScraped ? 'Re-scrapear ads' : 'Scrapear ads'}</>
          }
        </button>
        {ads.length > 0 && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {ads.length} estáticos cargados
          </span>
        )}
      </div>

      {/* Grilla de estáticos scrapeados */}
      {ads.length > 0 && <BrandAdsGrid ads={ads} brandNombre={brand.nombre} />}
    </div>
  );
}

function BrandAdsGrid({ ads, brandNombre }) {
  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
      {ads.slice(0, 30).map(ad => {
        const thumb = ad.imageUrls?.[0];
        const fbUrl = ad.snapshotUrl;
        return (
          <a
            key={ad.id}
            href={fbUrl} target="_blank" rel="noreferrer"
            className="group relative aspect-square rounded-md overflow-hidden bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-amber-400 transition"
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
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-end justify-end p-1.5">
              <ExternalLink size={12} className="text-white opacity-0 group-hover:opacity-100 transition" />
            </div>
            {ad.daysRunning > 0 && (
              <div className="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-black/60 text-white">
                {ad.daysRunning}d
              </div>
            )}
          </a>
        );
      })}
      {ads.length > 30 && (
        <div className="aspect-square rounded-md flex items-center justify-center bg-gray-50 dark:bg-gray-900 border-2 border-dashed border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 italic">
          +{ads.length - 30} más
        </div>
      )}
    </div>
  );
}
