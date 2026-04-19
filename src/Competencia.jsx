// Sección centralizada de Competencia en la plataforma Marketing.
// Acá se agregan competidores con su landing URL. El sistema:
// - Scrapea og:image + título + descripción de la landing
// - Guarda todo en localStorage
// - Si Meta OAuth está conectado, consulta Ad Library por sus ads activos
// - Auto-refresh cada 6h en background

import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Trash2, ExternalLink, RefreshCw, Loader2, X, Check,
  Target, Package, Search, Copy, ChevronDown, AlertTriangle,
} from 'lucide-react';

const STORAGE_KEY = 'viora-marketing-competidores-v1';

function loadCompetidores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveCompetidores(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

function timeAgo(iso) {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min}min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  return `hace ${Math.round(hr / 24)}d`;
}

export default function CompetenciaSection({ addToast }) {
  const [competidores, setCompetidores] = useState(() => loadCompetidores());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nombre: '', landingUrl: '', fbPageUrl: '', notas: '' });
  const [scraping, setScraping] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [checkingId, setCheckingId] = useState(null);

  useEffect(() => { saveCompetidores(competidores); }, [competidores]);

  const handleAdd = async () => {
    const nombre = form.nombre.trim();
    const landingUrl = form.landingUrl.trim();
    if (!nombre) { addToast?.({ type: 'error', message: 'Ponele un nombre al competidor' }); return; }

    setScraping(true);
    let imagen = null;
    let descripcion = '';
    let titulo = '';

    // Scrapear landing si hay URL
    if (landingUrl) {
      try {
        const resp = await fetch('/api/scrape-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: landingUrl, clienteNombre: nombre }),
        });
        const data = await resp.json();
        if (resp.ok && data.productos?.[0]) {
          const p = data.productos[0];
          imagen = p.imagen || p.imagenUrl || null;
          descripcion = p.descripcion || p.nombre || '';
          titulo = p.nombre || '';
        }
      } catch {}
    }

    const nuevo = {
      id: Date.now(),
      nombre,
      landingUrl,
      fbPageUrl: form.fbPageUrl.trim(),
      fbPageId: null,
      notas: form.notas.trim(),
      imagen,
      descripcion,
      titulo,
      ads: [],
      lastAdsCheck: null,
      createdAt: new Date().toISOString(),
    };

    setCompetidores(prev => [nuevo, ...prev]);
    setForm({ nombre: '', landingUrl: '', fbPageUrl: '', notas: '' });
    setShowForm(false);
    setScraping(false);
    addToast?.({ type: 'success', message: `Competidor "${nombre}" agregado` });
  };

  const handleDelete = (id) => {
    const c = competidores.find(x => x.id === id);
    if (!window.confirm(`¿Borrar a "${c?.nombre}"? Se pierden sus ads y notas.`)) return;
    setCompetidores(prev => prev.filter(x => x.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handleCheckAds = async (comp) => {
    if (!comp.fbPageUrl && !comp.fbPageId) {
      addToast?.({ type: 'error', message: 'Necesita Facebook Page URL o Page ID para consultar Ad Library' });
      return;
    }
    setCheckingId(comp.id);
    try {
      const pageId = comp.fbPageId || comp.fbPageUrl;
      const resp = await fetch('/api/meta/ad-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, searchTerms: !comp.fbPageId ? comp.nombre : undefined }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      setCompetidores(prev => prev.map(c =>
        c.id === comp.id ? { ...c, ads: data.ads || [], lastAdsCheck: new Date().toISOString() } : c
      ));
      addToast?.({ type: 'success', message: `${data.ads?.length || 0} ads encontrados para ${comp.nombre}` });
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setCheckingId(null);
    }
  };

  const handleUpdateNotas = (id, notas) => {
    setCompetidores(prev => prev.map(c => c.id === id ? { ...c, notas } : c));
  };

  const topAds = (ads) => {
    if (!Array.isArray(ads)) return [];
    return ads.filter(a => (a.daysRunning || 0) >= 7).sort((a, b) => (b.daysRunning || 0) - (a.daysRunning || 0)).slice(0, 10);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white shadow-sm">
            <Target size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Competencia</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Agregá competidores y monitoreá sus landings + ads activos.</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-red-500 to-orange-500 rounded-lg hover:from-red-600 hover:to-orange-600 shadow-sm transition"
        >
          <Plus size={16} /> Agregar competidor
        </button>
      </div>

      {/* Form agregar */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 border-2 border-orange-300 dark:border-orange-700 rounded-xl p-5 space-y-3 animate-fade-in">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Nuevo competidor</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Nombre <span className="text-red-500">*</span></label>
              <input type="text" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Skinfinity, MenLab, Casa en Orden"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Landing URL</label>
              <input type="url" value={form.landingUrl} onChange={e => setForm({ ...form, landingUrl: e.target.value })}
                placeholder="https://competidor.com/producto"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Facebook Page URL <span className="text-gray-400 font-normal">(para Ad Library)</span></label>
              <input type="text" value={form.fbPageUrl} onChange={e => setForm({ ...form, fbPageUrl: e.target.value })}
                placeholder="https://facebook.com/skinfinityoficial o Page ID"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Notas</label>
              <input type="text" value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })}
                placeholder="Observaciones sobre este competidor"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={() => { setShowForm(false); setForm({ nombre: '', landingUrl: '', fbPageUrl: '', notas: '' }); }}
              className="px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button onClick={handleAdd} disabled={scraping || !form.nombre.trim()}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-bold text-white bg-gradient-to-br from-red-500 to-orange-500 rounded-lg hover:from-red-600 hover:to-orange-600 transition disabled:opacity-40">
              {scraping ? <><Loader2 size={14} className="animate-spin" /> Scrapeando…</> : <><Plus size={14} /> Agregar</>}
            </button>
          </div>
        </div>
      )}

      {/* Lista de competidores */}
      {competidores.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
          <Target size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin competidores</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Agregá tu primer competidor con su landing URL para empezar a monitorearlo.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {competidores.map(c => {
            const isExpanded = expandedId === c.id;
            const isChecking = checkingId === c.id;
            const top = topAds(c.ads);
            return (
              <div key={c.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
                {/* Header del competidor */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition"
                >
                  {c.imagen ? (
                    <img src={c.imagen} alt={c.nombre} className="w-12 h-12 rounded-lg object-cover bg-gray-100 dark:bg-gray-700 shrink-0 border" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shrink-0">
                      <Target size={20} className="text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{c.nombre}</p>
                    <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {c.landingUrl && <span className="truncate max-w-[200px]">{(() => { try { return new URL(c.landingUrl).hostname; } catch { return c.landingUrl; } })()}</span>}
                      <span className="inline-flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${c.ads?.length > 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        {c.ads?.length || 0} ads
                      </span>
                      {c.lastAdsCheck && <span>· Ads {timeAgo(c.lastAdsCheck)}</span>}
                    </div>
                    {c.descripcion && <p className="text-[11px] text-gray-600 dark:text-gray-300 truncate mt-0.5">{c.descripcion}</p>}
                  </div>
                  <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Detalle expandido */}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                    {/* Acciones */}
                    <div className="px-4 py-3 flex items-center gap-2 flex-wrap border-b border-gray-200 dark:border-gray-700">
                      {c.landingUrl && (
                        <a href={c.landingUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                          <ExternalLink size={12} /> Ver landing
                        </a>
                      )}
                      {c.fbPageUrl && (
                        <a href={c.fbPageUrl.startsWith('http') ? c.fbPageUrl : `https://facebook.com/${c.fbPageUrl}`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                          <ExternalLink size={12} /> Facebook
                        </a>
                      )}
                      <button onClick={() => handleCheckAds(c)} disabled={isChecking}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition disabled:opacity-40">
                        {isChecking ? <><Loader2 size={12} className="animate-spin" /> Buscando…</> : <><Search size={12} /> Actualizar ads</>}
                      </button>
                      <button onClick={() => handleDelete(c.id)}
                        className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-500 hover:text-red-600 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-red-50 hover:border-red-200 transition">
                        <Trash2 size={12} /> Eliminar
                      </button>
                    </div>

                    {/* Notas editables */}
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                      <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Notas</label>
                      <textarea
                        value={c.notas || ''}
                        onChange={e => handleUpdateNotas(c.id, e.target.value)}
                        rows={2}
                        placeholder="Anotá observaciones sobre este competidor, ángulos que usan, diferencias, etc."
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>

                    {/* Ads top (ganadores) */}
                    <div className="px-4 py-3">
                      {top.length > 0 ? (
                        <>
                          <h4 className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                            🔥 Top ads (por días corriendo) · {top.length} de {c.ads?.length || 0}
                          </h4>
                          <div className="space-y-2">
                            {top.map((ad, idx) => (
                              <div key={ad.id || idx} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                <div className="flex items-start gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed">
                                      {(ad.bodies?.[0] || '(sin copy)').slice(0, 300)}
                                      {(ad.bodies?.[0] || '').length > 300 && '…'}
                                    </p>
                                    {ad.titles?.[0] && (
                                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 font-semibold">{ad.titles[0]}</p>
                                    )}
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <p className={`text-sm font-bold tabular-nums ${(ad.daysRunning || 0) >= 30 ? 'text-emerald-600' : (ad.daysRunning || 0) >= 14 ? 'text-amber-600' : 'text-gray-600'}`}>
                                      {ad.daysRunning || 0}d
                                    </p>
                                    <p className="text-[9px] text-gray-400 uppercase">corriendo</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-500 dark:text-gray-400">
                                  {ad.platforms?.length > 0 && (
                                    <span className="inline-flex items-center gap-0.5">
                                      {ad.platforms.join(' · ')}
                                      {ad.isMultiplatform && <span className="text-emerald-600 font-bold ml-1">multi ✓</span>}
                                    </span>
                                  )}
                                  {ad.snapshotUrl && (
                                    <a href={ad.snapshotUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline ml-auto">
                                      Ver en Ad Library →
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : c.ads?.length > 0 ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                          {c.ads.length} ads encontrados, pero ninguno con 7+ días corriendo todavía.
                        </p>
                      ) : c.lastAdsCheck ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                          No se encontraron ads activos para esta página. Verificá el Facebook Page URL o probá con el Page ID.
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                          Clickeá "Actualizar ads" para buscar en Ad Library (necesita Meta OAuth conectado).
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
