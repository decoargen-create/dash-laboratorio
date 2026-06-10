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
  Wand2, X, Check, Tag,
} from 'lucide-react';
import { useCloudInspiracionGlobal } from './useCloudInspiracionGlobal.js';
import { parseJsonOrThrow } from './apiHelpers.js';
import { startExecution, finishExecution, updateExecution } from './executionsStore.js';

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
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ nombre: '', fbPageUrl: '', landingUrl: '', notes: '', tags: '' });
  const [scrapingIds, setScrapingIds] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);

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
                      <div key={ad.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                        {ad.imageUrls?.[0] && (
                          <img src={ad.imageUrls[0]} alt="" className="w-full aspect-square object-cover" loading="lazy"
                            onError={e => { e.target.style.display = 'none'; }} />
                        )}
                        <div className="p-2 space-y-1">
                          {ad.headline && <p className="text-[10px] font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">{ad.headline}</p>}
                          {ad.body && <p className="text-[9px] text-gray-500 dark:text-gray-400 line-clamp-3">{ad.body}</p>}
                          {ad.snapshotUrl && (
                            <a href={ad.snapshotUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[9px] text-brand-600 hover:underline">
                              <ExternalLink size={9} /> Meta Ads
                            </a>
                          )}
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

      {/* Próximamente — wiring para "usar como inspiración para producto X" */}
      <div className="text-[10px] text-gray-400 dark:text-gray-500 italic pt-4 border-t border-gray-100 dark:border-gray-800">
        Próximo paso: desde cada ad scrapeado vas a poder darle "Crear creativo para mi producto X" y el endpoint actual de inspiración va a usar este ad como skeleton + tu producto como sujeto. Por ahora podés ver/scrapear las marcas; el wiring de generación viene en la próxima iteración.
      </div>
    </section>
  );
}
