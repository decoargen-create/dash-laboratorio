// Sección centralizada de Competencia en la plataforma Marketing.
// Acá se agregan competidores con su landing URL. El sistema:
// - Scrapea og:image + título + descripción de la landing
// - Guarda todo en localStorage
// - Si Meta OAuth está conectado, consulta Ad Library por sus ads activos
// - Auto-refresh cada 6h en background

import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Trash2, ExternalLink, RefreshCw, Loader2, X, Check,
  Target, Package, Search, Copy, ChevronDown, AlertTriangle, Zap,
} from 'lucide-react';

const STORAGE_KEY = 'viora-marketing-competidores-v1';

// Replica el bookmarklet del user: dada una URL, devuelve el search term
// que conviene usar en Meta Ad Library.
//   - app.dropi.* → último segmento del path con guiones como espacios
//   - cualquier otro → hostname sin www
function landingToSearchTerm(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('app.dropi')) {
      const parts = u.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || '';
      return last.replace(/-/g, ' ');
    }
    return u.hostname.replace(/^www\./, '');
  } catch {
    // Fallback: si no parsea como URL, tratamos el string como hostname.
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

// Construye la URL de Ad Library para abrir en nueva tab.
function adLibraryUrl(searchTerm, country = 'ALL') {
  const q = encodeURIComponent(searchTerm);
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${q}&search_type=keyword_unordered&media_type=all`;
}

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
  const [metaConn, setMetaConn] = useState({ loading: true, connected: false, user: null });

  useEffect(() => { saveCompetidores(competidores); }, [competidores]);

  // Estado de conexión Meta para mostrar widget + habilitar "Traer ads".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/meta/me');
        const d = await r.json();
        if (!cancelled) setMetaConn({ loading: false, connected: !!d.connected, user: d.user || null });
      } catch {
        if (!cancelled) setMetaConn({ loading: false, connected: false, user: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleConnectMeta = () => {
    window.location.href = `/api/meta/connect?returnTo=${encodeURIComponent('/acceso?section=mk-competencia')}`;
  };

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

  // Cache de ingesta: si un competidor tiene ads cacheados <6h, reutilizamos.
  // El user puede forzar refresh con el botón secundario "Forzar".
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

  const handleCheckAds = async (comp, { force = false } = {}) => {
    if (!comp.fbPageUrl && !comp.landingUrl && !comp.nombre) {
      addToast?.({ type: 'error', message: 'Este competidor no tiene suficiente info para buscar ads' });
      return;
    }

    // Cache hit: devolvemos data existente si no está vencida.
    if (!force && comp.lastAdsCheck) {
      const age = Date.now() - new Date(comp.lastAdsCheck).getTime();
      if (age < CACHE_TTL_MS && comp.ads && comp.ads.length > 0) {
        const hoursLeft = Math.round((CACHE_TTL_MS - age) / 3600000 * 10) / 10;
        addToast?.({ type: 'info', message: `Usando cache (${comp.ads.length} ads, fresco por ${hoursLeft}h más). Click "Forzar" para re-scrapear.` });
        return;
      }
    }

    setCheckingId(comp.id);
    try {
      // Determinamos el input del actor: preferimos fbPageUrl, sino landing, sino keyword.
      const payload = {};
      if (comp.fbPageUrl) {
        payload.fbPageUrl = comp.fbPageUrl.startsWith('http')
          ? comp.fbPageUrl
          : `https://www.facebook.com/${comp.fbPageUrl.replace(/^\/+/, '')}`;
      } else if (comp.landingUrl) {
        // Extraemos hostname como keyword (mismo trick que el bookmarklet)
        try {
          const u = new URL(comp.landingUrl);
          payload.searchKeyword = u.hostname.replace(/^www\./, '');
        } catch {
          payload.searchKeyword = comp.nombre;
        }
      } else {
        payload.searchKeyword = comp.nombre;
      }
      payload.country = 'AR';
      payload.limit = 50;

      const resp = await fetch('/api/marketing/apify-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

      setCompetidores(prev => prev.map(c =>
        c.id === comp.id ? {
          ...c,
          ads: data.ads || [],
          adsTotal: data.total || 0,
          winnersCount: data.winners || 0,
          criteria: data.criteria || { days: 17, variants: 2 },
          lastAdsCheck: new Date().toISOString(),
        } : c
      ));
      const winners = data.winners || 0;
      const total = data.total || 0;
      addToast?.({ type: 'success', message: `${winners} ganadores de ${total} ads · ${comp.nombre}` });
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setCheckingId(null);
    }
  };

  const handleUpdateNotas = (id, notas) => {
    setCompetidores(prev => prev.map(c => c.id === id ? { ...c, notas } : c));
  };

  // Ganadores según el backend: isWinner = daysRunning >= 17 OR variantes >= 2.
  // Fallback (ads viejos con shape previo sin isWinner): usar el criterio
  // histórico (daysRunning >= 7) así no quedan invisibles.
  const winnerAds = (ads) => {
    if (!Array.isArray(ads)) return [];
    const hasNewFlag = ads.some(a => typeof a.isWinner === 'boolean');
    const filtered = hasNewFlag
      ? ads.filter(a => a.isWinner)
      : ads.filter(a => (a.daysRunning || 0) >= 17 || (a.variantes || 0) >= 2);
    return filtered.sort((a, b) => (b.score || b.daysRunning || 0) - (a.score || a.daysRunning || 0)).slice(0, 15);
  };

  // Los video URLs de Meta CDN expiran en ~24h. Si los tenemos >12h sin
  // procesar, advertimos al user para que los transcriba antes que se caigan.
  const hasExpiringVideos = (comp) => {
    if (!comp.lastAdsCheck) return false;
    const hoursOld = (Date.now() - new Date(comp.lastAdsCheck).getTime()) / 3600000;
    return hoursOld >= 12 && (comp.ads || []).some(a => (a.videoUrls || []).length > 0);
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

      {/* Widget de conexión Meta */}
      {!metaConn.loading && (
        metaConn.connected ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-xs text-emerald-800 dark:text-emerald-200">
              <span className="font-semibold">Meta conectado</span>
              {metaConn.user?.name && <> como <span className="font-semibold">{metaConn.user.name}</span></>}.
              Podés traer los ads directamente desde cada competidor.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-br from-blue-50 to-white dark:from-blue-900/20 dark:to-gray-800 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-[#0668E1] to-[#1877F2] flex items-center justify-center text-white">
              <Zap size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Conectá Meta para auto-traer ads</p>
              <p className="text-[11px] text-gray-600 dark:text-gray-300">Sin Meta igual podés abrir Ad Library manualmente. Conectado, los ads se sincronizan solos cada 6h.</p>
            </div>
            <button
              onClick={handleConnectMeta}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-md hover:from-[#0556BE] hover:to-[#1668D8] transition"
            >
              <Zap size={12} /> Conectar
            </button>
          </div>
        )
      )}

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
            const top = winnerAds(c.ads);
            const videoWarning = hasExpiringVideos(c);
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
                      {/* SIEMPRE visible: abre Meta Ad Library manualmente con el search term auto-derivado */}
                      {(c.landingUrl || c.nombre) && (() => {
                        const searchTerm = landingToSearchTerm(c.landingUrl) || c.nombre;
                        return (
                          <a href={adLibraryUrl(searchTerm)} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-md hover:from-[#0556BE] hover:to-[#1668D8] transition"
                            title={`Buscar "${searchTerm}" en Meta Ad Library`}>
                            <ExternalLink size={12} /> Ver en Ad Library
                          </a>
                        );
                      })()}
                      {/* Traer ads vía Apify (no requiere Meta OAuth). Usa cache 6h automáticamente. */}
                      <button onClick={() => handleCheckAds(c)} disabled={isChecking}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-purple-600 rounded-md hover:bg-purple-700 transition disabled:opacity-40"
                        title="Trae los ads automáticamente vía Apify. Si fue scrapeado hace <6h usa cache.">
                        {isChecking ? <><Loader2 size={12} className="animate-spin" /> Buscando…</> : <><Search size={12} /> Traer ads</>}
                      </button>
                      {/* Forzar refresh: ignora el cache de 6h */}
                      {c.ads?.length > 0 && (
                        <button onClick={() => handleCheckAds(c, { force: true })} disabled={isChecking}
                          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition disabled:opacity-40"
                          title="Ignora el cache y re-scrapea ahora (consume 1 run de Apify)">
                          <RefreshCw size={12} /> Forzar
                        </button>
                      )}
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

                    {/* Warning de videos expirando (Meta CDN 24h) */}
                    {videoWarning && (
                      <div className="mx-4 mt-3 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded-md flex items-start gap-2">
                        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-900 dark:text-amber-200 leading-snug">
                          <strong>Videos a punto de expirar</strong> — los URLs de Meta CDN expiran a las 24h del scrape. Si querés transcribir con Whisper, hacelo ahora o <button onClick={() => handleCheckAds(c, { force: true })} className="underline font-semibold">forzar refresh</button>.
                        </p>
                      </div>
                    )}

                    {/* Ads top (ganadores) */}
                    <div className="px-4 py-3">
                      {top.length > 0 ? (
                        <>
                          <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                            <h4 className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                              🔥 Ganadores · {top.length} de {c.ads?.length || 0}
                            </h4>
                            <span className="text-[10px] text-gray-400 italic">
                              criterio: ≥17d o ≥2 variantes
                            </span>
                          </div>
                          <div className="space-y-2">
                            {top.map((ad, idx) => (
                              <div key={ad.id || idx} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                <div className="flex items-start gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed">
                                      {(ad.body || ad.bodies?.[0] || '(sin copy)').slice(0, 300)}
                                      {(ad.body || ad.bodies?.[0] || '').length > 300 && '…'}
                                    </p>
                                    {(ad.headline || ad.titles?.[0]) && (
                                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 font-semibold">{ad.headline || ad.titles[0]}</p>
                                    )}
                                    {/* Badges */}
                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                      {ad.isWinner && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">
                                          🏆 Winner
                                        </span>
                                      )}
                                      {typeof ad.score === 'number' && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">
                                          score {ad.score}
                                        </span>
                                      )}
                                      {(ad.variantes || 0) > 0 && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded">
                                          {ad.variantes} variante{ad.variantes > 1 ? 's' : ''}
                                        </span>
                                      )}
                                      {(ad.videoUrls?.length > 0) && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded">
                                          🎬 video
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <p className={`text-sm font-bold tabular-nums ${(ad.daysRunning || 0) >= 30 ? 'text-emerald-600' : (ad.daysRunning || 0) >= 17 ? 'text-amber-600' : 'text-gray-600'}`}>
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
                          {c.ads.length} ads encontrados, pero ninguno cumple el criterio de ganador (≥17d o ≥2 variantes).
                        </p>
                      ) : c.lastAdsCheck ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                          No se encontraron ads activos. Verificá el URL de la landing o probá con el Facebook Page URL directo.
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                          Click en "Traer ads" para buscar vía Apify (scrapea Meta Ad Library automáticamente).
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
