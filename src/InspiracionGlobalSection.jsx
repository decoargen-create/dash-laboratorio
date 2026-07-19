// Inspiración global — cross-producto. Marcas referente que el user usa
// para aprender ángulos / hooks / formato independientemente del vertical
// del producto. Liquid Death, Glossier, Apple, lo que sea.
//
// Diferencia con Inspiración por-producto:
//   - Esta vive a nivel user (sin producto_id en la DB)
//   - Visible y usable desde cualquier producto
//   - Sirve para "tomar el ángulo de X y aplicárselo a mi producto Y"
//
// Para esta primera versión: CRUD de brands + scrape de ads. La integración
// "generar creativo para mi producto desde este ad" se agrega en seguida via
// botón en el ad → modal que selecciona producto → llama al endpoint actual.

import React, { useState } from 'react';
import {
  Sparkles, Plus, Trash2, ExternalLink, Loader2, Search,
  Wand2, X, Check, Tag, Package,
} from 'lucide-react';
import { useCloudInspiracionGlobal } from './useCloudInspiracionGlobal.js';
import { useCloudProductos } from './useCloudProductos.js';
import { parseJsonOrThrow } from './apiHelpers.js';
import { startExecution, finishExecution, updateExecution } from './executionsStore.js';
import { getProductoImagen, getAccentColor } from './productoImagen.js';
import { saveReferencial } from './galeriaReferenciales.js';
import { supabase } from './supabase.js';
import { logCostsFromResponse } from './costsStore.js';

function genBrandId() {
  return `inspg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function landingToKeyword(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return url;
  }
}

export default function InspiracionGlobalSection({ addToast }) {
  const { brands, loading, save, remove } = useCloudInspiracionGlobal();
  const { productos } = useCloudProductos();
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ nombre: '', fbPageUrl: '', landingUrl: '', notes: '', tags: '' });
  const [scrapingIds, setScrapingIds] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  // Modal de "aplicar a producto": cuando el user clickea "Crear creativo"
  // en un ad, abre selector de producto. { ad, brand }.
  const [applyTarget, setApplyTarget] = useState(null);
  const [applyingProductoId, setApplyingProductoId] = useState(null);

  const handleAdd = async () => {
    const nombre = draft.nombre.trim();
    if (!nombre) {
      addToast?.({ type: 'error', message: 'Ponele un nombre a la marca' });
      return;
    }
    const tags = draft.tags
      .split(',').map(t => t.trim()).filter(Boolean);
    const brand = {
      id: genBrandId(),
      nombre,
      fbPageUrl: draft.fbPageUrl.trim() || null,
      landingUrl: draft.landingUrl.trim() || null,
      notes: draft.notes.trim() || null,
      tags,
      ads: [],
      adsTotal: 0,
      createdAt: new Date().toISOString(),
    };
    const ok = await save(brand);
    if (ok) {
      addToast?.({ type: 'success', message: `Marca "${nombre}" agregada` });
      setDraft({ nombre: '', fbPageUrl: '', landingUrl: '', notes: '', tags: '' });
      setShowForm(false);
    } else {
      addToast?.({ type: 'error', message: 'No pude guardar la marca' });
    }
  };

  const handleScrape = async (brand) => {
    setScrapingIds(prev => new Set(prev).add(brand.id));
    const execId = startExecution({
      label: `Scrapeando ads de ${brand.nombre}`,
      sublabel: 'Meta Ads Library vía Apify',
      kind: 'scrape',
      estimatedMs: 60000,
    });
    try {
      const payload = { country: 'ALL', limit: 100 };
      if (brand.fbPageUrl) {
        payload.fbPageUrl = brand.fbPageUrl.startsWith('http')
          ? brand.fbPageUrl
          : `https://www.facebook.com/${brand.fbPageUrl}`;
      } else if (brand.landingUrl) {
        try {
          const r = await fetch('/api/marketing/resolve-fb-page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ landingUrl: brand.landingUrl }),
          });
          const d = await r.json();
          if (d.pageUrl) {
            payload.fbPageUrl = d.pageUrl;
          } else {
            payload.searchKeyword = landingToKeyword(brand.landingUrl);
          }
        } catch {
          payload.searchKeyword = landingToKeyword(brand.landingUrl);
        }
      } else {
        payload.searchKeyword = brand.nombre;
      }
      updateExecution(execId, { stage: 'Scrapeando…' });
      // Timeout de 90s para que el user no quede colgado si Apify se cuelga.
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 90000);
      let resp;
      try {
        resp = await fetch('/api/marketing/apify-ingest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Timeout (90s) — Apify no respondió a tiempo. Probá de nuevo.');
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
      const data = await parseJsonOrThrow(resp, 'apify-ingest');
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const ads = data.ads || [];
      const updated = {
        ...brand,
        ads,
        adsTotal: data.total || 0,
        winnersCount: data.winners || 0,
        lastAdsCheck: new Date().toISOString(),
      };
      await save(updated);
      finishExecution(execId, { ok: true, message: `${ads.length} ads de ${brand.nombre}` });
      addToast?.({ type: 'success', message: `${ads.length} ads scrapeados` });
      setExpandedId(brand.id);
    } catch (err) {
      console.warn('scrape inspiracion global falló:', err.message);
      finishExecution(execId, { ok: false, message: err.message });
      addToast?.({ type: 'error', message: `Scrape falló: ${err.message}` });
    } finally {
      setScrapingIds(prev => {
        const n = new Set(prev); n.delete(brand.id); return n;
      });
    }
  };

  const handleRemove = async (brand) => {
    if (!window.confirm(`¿Eliminar "${brand.nombre}" de inspiración global? Se pierden los ads scrapeados.`)) return;
    await remove(brand.id);
    addToast?.({ type: 'success', message: `"${brand.nombre}" eliminada` });
  };

  // Aplicar este ad como inspiración para generar un creativo del producto
  // seleccionado. Usa el mismo endpoint que Inspiración por-producto.
  const handleApplyToProducto = async (producto) => {
    if (!applyTarget || !producto) return;
    const { ad, brand } = applyTarget;
    setApplyingProductoId(producto.id);
    const execId = startExecution({
      label: `Creativo de ${producto.nombre} con inspiración de ${brand.nombre}`,
      sublabel: ad.headline || ad.body?.slice(0, 60) || '',
      kind: 'creative',
      estimatedMs: 75000,
      estimatedCost: 0.22,
    });
    try {
      const prodImg = await getProductoImagen(producto.id, producto);
      if (!prodImg) {
        addToast?.({ type: 'error', message: 'Falta la foto del producto en Setup' });
        finishExecution(execId, { ok: false, message: 'sin foto' });
        return;
      }
      const refImageUrl = ad.imageUrls?.[0];
      if (!refImageUrl) {
        addToast?.({ type: 'error', message: 'Este ad no tiene imagen para usar como referencia' });
        finishExecution(execId, { ok: false, message: 'sin imagen ref' });
        return;
      }
      let authToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        authToken = session?.access_token || '';
      } catch {}
      const body = {
        producto: {
          id: producto.id,
          nombre: producto.nombre,
          descripcion: producto.descripcion,
          research: producto.docs?.research,
          formato: producto.formato || '',
          ofertasReales: producto.ofertasReales || '',
          offerBrief: producto.ofertasReales || producto.docs?.offerBrief || '',
        },
        inspiracion: {
          brandNombre: brand.nombre,
          body: ad.body,
          headline: ad.headline,
          formato: ad.formato,
          analysis: ad.analysis || null,
          visual: ad.visual || null,
        },
        inspiracionImageUrl: refImageUrl,
        productoImagen: prodImg,
        accentColor: getAccentColor(producto.id, producto) || '',
        n: 1,
        nPlan: 2,
        variationStartIndex: 0,
        quality: 'high',
        size: '1024x1024',
      };
      updateExecution(execId, { stage: 'Generando…' });
      const resp = await fetch('/api/marketing/crear-creativo-referencial', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await parseJsonOrThrow(resp, 'crear-creativo-referencial');
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const costo = logCostsFromResponse(data, `inspiracion-global → ${producto.nombre}`, { productoId: producto?.id });

      // Si server-saved al cloud, listo. Sino fallback IDB.
      const cloudOk = Array.isArray(data.cloudCreativos) && data.cloudCreativos.length > 0;
      if (cloudOk) {
        try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail: { productoId: String(producto.id), cloud: true } })); } catch {}
      } else if (data.imagenes?.[0]) {
        await saveReferencial({
          id: `ref_${Date.now()}_${ad.id}_0`,
          productoId: String(producto.id),
          sourceAdId: ad.id,
          sourceBrand: `(inspiración global) ${brand.nombre}`,
          sourceImageUrl: refImageUrl,
          sourceHeadline: ad.headline || ad.body?.slice(0, 200) || '',
          variantIndex: 0,
          variantStyle: data.variantStyles?.[0] || 'strategist',
          imageBase64: data.imagenes[0],
          mimeType: data.mimeType || 'image/png',
          prompt: data.prompts?.[0]?.prompt || '',
          skeleton: data.plan?.visual || data.skeleton || null,
          model: data.model,
          quality: data.quality || 'high',
          size: data.size,
          createdAt: new Date().toISOString(),
        });
      }
      finishExecution(execId, { ok: true, message: `Creativo de ${producto.nombre} listo`, cost: costo?.total });
      addToast?.({ type: 'success', message: `Creativo de ${producto.nombre} listo en Galería` });
      setApplyTarget(null);
    } catch (err) {
      finishExecution(execId, { ok: false, message: err.message });
      addToast?.({ type: 'error', message: `Error: ${err.message}` });
    } finally {
      setApplyingProductoId(null);
    }
  };

  return (
    <section className="p-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-brand-500 flex items-center justify-center text-white shadow-sm">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Inspiración global</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Marcas que admirás y querés tomar como referente, independiente del producto. Liquid Death, Glossier, Apple — lo que te gusta cómo arma estáticos.
            </p>
          </div>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-600 rounded-lg hover:from-amber-600 hover:to-brand-700 shadow-sm transition">
            <Plus size={14} /> Agregar marca
          </button>
        )}
      </header>

      {/* Form de nueva marca */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 border-2 border-amber-300 dark:border-amber-700 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Nueva marca de inspiración</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input type="text" value={draft.nombre} onChange={e => setDraft(d => ({ ...d, nombre: e.target.value }))}
              placeholder="Nombre (ej: Liquid Death)"
              className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
            <input type="url" value={draft.fbPageUrl} onChange={e => setDraft(d => ({ ...d, fbPageUrl: e.target.value }))}
              placeholder="Facebook page URL (opcional, preferido)"
              className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <input type="url" value={draft.landingUrl} onChange={e => setDraft(d => ({ ...d, landingUrl: e.target.value }))}
            placeholder="Landing URL (opcional, fallback si no hay FB page)"
            className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
          <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
            placeholder="Notas — por qué te interesa esta marca (ángulo, estilo, hooks, etc.)"
            rows={2}
            className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y" />
          <input type="text" value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
            placeholder="Tags (separados por coma — ej: hook-fuerte, minimalismo, ugc)"
            className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setDraft({ nombre: '', fbPageUrl: '', landingUrl: '', notes: '', tags: '' }); }}
              className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button onClick={handleAdd}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-600 rounded-md hover:from-amber-600 hover:to-brand-700 transition">
              <Check size={12} /> Agregar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <p className="text-xs text-gray-500 italic">Cargando…</p>
      ) : brands.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
          <Sparkles size={36} className="mx-auto text-amber-300 dark:text-amber-600 mb-3" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin marcas de inspiración aún</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            Estas marcas son las que vas a usar como referente cross-producto. Después podés "tomar el ángulo de Liquid Death" y aplicarlo a cualquier producto tuyo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {brands.map(b => {
            const scraping = scrapingIds.has(b.id);
            const expanded = expandedId === b.id;
            return (
              <div key={b.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="p-3 flex items-center gap-3 flex-wrap">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-brand-400 text-white font-bold flex items-center justify-center shrink-0">
                    {b.nombre.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{b.nombre}</p>
                      {Array.isArray(b.tags) && b.tags.map(t => (
                        <span key={t} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded">
                          <Tag size={8} /> {t}
                        </span>
                      ))}
                    </div>
                    {b.notes && (
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 italic line-clamp-2">{b.notes}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500 dark:text-gray-400 flex-wrap">
                      {b.fbPageUrl && <a href={b.fbPageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-brand-600"><ExternalLink size={9} /> FB</a>}
                      {b.landingUrl && <a href={b.landingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-brand-600"><ExternalLink size={9} /> Landing</a>}
                      <span>{b.adsTotal || 0} ads scrapeados</span>
                      {b.lastAdsCheck && <span>último: {new Date(b.lastAdsCheck).toLocaleDateString('es-AR')}</span>}
                    </div>
                  </div>
                  <button onClick={() => handleScrape(b)} disabled={scraping}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-600 rounded-md hover:from-amber-600 hover:to-brand-700 transition disabled:opacity-60">
                    {scraping ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    {scraping ? 'Scrapeando…' : 'Scrape'}
                  </button>
                  {Array.isArray(b.ads) && b.ads.length > 0 && (
                    <button onClick={() => setExpandedId(expanded ? null : b.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800 rounded-md hover:bg-brand-100 transition">
                      {expanded ? 'Ocultar ads' : `Ver ${b.ads.length} ads`}
                    </button>
                  )}
                  <button onClick={() => handleRemove(b)}
                    className="p-1.5 text-gray-400 hover:text-red-600 transition" title="Eliminar marca">
                    <Trash2 size={13} />
                  </button>
                </div>

                {expanded && Array.isArray(b.ads) && b.ads.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {b.ads.map(ad => (
                      <div key={ad.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex flex-col">
                        {ad.imageUrls?.[0] && (
                          <img src={ad.imageUrls[0]} alt="" className="w-full aspect-square object-cover" loading="lazy"
                            onError={e => { e.target.style.display = 'none'; }} />
                        )}
                        <div className="p-2 space-y-1 flex-1 flex flex-col">
                          {ad.headline && <p className="text-[10px] font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">{ad.headline}</p>}
                          {ad.body && <p className="text-[9px] text-gray-500 dark:text-gray-400 line-clamp-3">{ad.body}</p>}
                          <div className="flex items-center gap-1.5 mt-auto pt-1.5">
                            <button
                              onClick={() => setApplyTarget({ ad, brand: b })}
                              disabled={!(ad.imageUrls?.length)}
                              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-gradient-to-br from-amber-500 to-brand-600 rounded hover:from-amber-600 hover:to-brand-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Generar un creativo para uno de tus productos usando este ad como inspiración"
                            >
                              <Wand2 size={10} /> Aplicar
                            </button>
                            {ad.snapshotUrl && (
                              <a href={ad.snapshotUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[9px] text-brand-600 hover:underline"
                                title="Ver en Meta Ad Library">
                                <ExternalLink size={9} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: seleccionar producto al que aplicar este ad como inspiración. */}
      {applyTarget && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 py-8 bg-black/60 backdrop-blur-sm overflow-y-auto"
          onClick={() => !applyingProductoId && setApplyTarget(null)}>
          <div className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wand2 size={16} className="text-amber-500" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  Aplicar inspiración a producto
                </h3>
              </div>
              {!applyingProductoId && (
                <button onClick={() => setApplyTarget(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                {applyTarget.ad.imageUrls?.[0] && (
                  <img src={applyTarget.ad.imageUrls[0]} alt="" className="w-16 h-16 object-cover rounded shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                    Ad de {applyTarget.brand.nombre}
                  </p>
                  {applyTarget.ad.headline && (
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 mt-0.5 line-clamp-2">
                      {applyTarget.ad.headline}
                    </p>
                  )}
                  {applyTarget.ad.body && (
                    <p className="text-[10px] text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">{applyTarget.ad.body}</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Elegí a qué producto querés aplicarle el ángulo/visual de este ad. Se va a generar UN creativo (1 variante, calidad high) en la Galería del producto.
              </p>
              {productos.length === 0 ? (
                <p className="text-xs text-gray-500 italic text-center py-4">Sin productos cargados — andá a Marketing → Setup primero.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto">
                  {productos.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleApplyToProducto(p)}
                      disabled={!!applyingProductoId}
                      className={`text-left p-3 border rounded-lg transition flex items-center gap-2.5 ${
                        applyingProductoId === p.id
                          ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700'
                          : applyingProductoId
                            ? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                      }`}>
                      <div className="w-9 h-9 rounded-md bg-gradient-to-br from-brand-400 to-brand-600 text-white font-bold flex items-center justify-center shrink-0">
                        {p.nombre.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                          {p.formato ? `${p.formato}` : 'Sin formato'} · {p.descripcion?.slice(0, 40) || 'sin descripción'}
                        </p>
                      </div>
                      {applyingProductoId === p.id && <Loader2 size={14} className="text-amber-500 animate-spin shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                El creativo va a usar el ad como skeleton visual y tu producto como sujeto, con tu fotoUrl, formato, ofertas, etc.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
