// Generación MASIVA de estáticos desde las ideas del producto, dentro de la
// pestaña Creativos. Replica el patrón de Inspiración (multi-select + barra de
// crear 1/2/4/6) pero la fuente son las ideas del propio producto (las que
// caen en la Bandeja, incluidas las temáticas del GeneradorTematico).
//
// Por cada idea seleccionada llama a /api/marketing/crear-imagen-desde-idea
// (el mismo endpoint que la Bandeja) con n = cantidad. Los estáticos caen en
// la Galería del producto. Preview inline + salto a la Galería.

import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, Loader2, Check, ArrowRight, Inbox, ImageOff } from 'lucide-react';
import { loadIdeas, TIPO_META } from './bandejaStore.js';
import { getUsedAdIdsForProducto } from './galeriaReferenciales.js';
import { getProductoImagen, getAccentColor } from './productoImagen.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';
import { logCostsFromResponse } from './costsStore.js';
import { supabase } from './supabase.js';

const COUNT_OPTIONS = [1, 2, 4, 6];
const POOL = 2; // ideas en paralelo (cada una genera `count` imágenes server-side)
const FORMATO_EMOJI = { static: '🖼️', video: '🎬', carrusel: '🎠' };

export default function CreativosBulkGenerator({ producto, addToast }) {
  const [ideas, setIdeas] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [count, setCount] = useState(2);
  const [quality, setQuality] = useState('high');
  const [generating, setGenerating] = useState(false);
  const [progreso, setProgreso] = useState({ done: 0, total: 0 });
  const [recientes, setRecientes] = useState(null);
  // Ideas ya usadas (con creativo generado). source_ad_id del creativo = idea.id.
  const [usedIds, setUsedIds] = useState(() => new Set());

  // Cargar las ideas del producto + refrescar cuando cambian (pull / nuevas
  // ideas temáticas / Bandeja).
  useEffect(() => {
    if (!producto?.id) { setIdeas([]); return; }
    const reload = () => {
      setIdeas(loadIdeas().filter(i => String(i.productoId || '') === String(producto.id)));
    };
    reload();
    window.addEventListener('viora:marketing-pulled', reload);
    window.addEventListener('viora:marketing-storage-changed', reload);
    return () => {
      window.removeEventListener('viora:marketing-pulled', reload);
      window.removeEventListener('viora:marketing-storage-changed', reload);
    };
  }, [producto?.id]);

  // Cargar qué ideas YA tienen creativo generado → para marcarlas en gris.
  // Refresca tras generar (viora:referencial-saved) y tras un pull.
  useEffect(() => {
    if (!producto?.id) { setUsedIds(new Set()); return; }
    let active = true;
    const refresh = () => { getUsedAdIdsForProducto(producto.id).then(s => { if (active) setUsedIds(s); }).catch(() => {}); };
    refresh();
    window.addEventListener('viora:referencial-saved', refresh);
    window.addEventListener('viora:marketing-pulled', refresh);
    return () => {
      active = false;
      window.removeEventListener('viora:referencial-saved', refresh);
      window.removeEventListener('viora:marketing-pulled', refresh);
    };
  }, [producto?.id]);

  const selectedOrder = useMemo(() => {
    const m = new Map(); let i = 0;
    for (const id of selected) m.set(id, ++i);
    return m;
  }, [selected]);

  // Más reciente → más viejo (como la Bandeja).
  const ordered = useMemo(
    () => [...ideas].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [ideas]
  );

  const toggle = (id) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const selectAll = () => setSelected(new Set(ideas.map(i => i.id)));
  const clear = () => setSelected(new Set());

  const irAGaleria = () => {
    try {
      localStorage.setItem(`adslab-marketing-prod-tab-${producto.id}`, 'galeria');
      window.dispatchEvent(new CustomEvent('viora:product-tab', { detail: { tab: 'galeria' } }));
    } catch {}
  };

  const handleGenerar = async () => {
    if (selected.size === 0) { addToast?.({ type: 'warning', message: 'Seleccioná al menos una idea.' }); return; }
    const prodImg = await getProductoImagen(producto.id, producto);
    if (!prodImg) { addToast?.({ type: 'error', message: 'Cargá la foto del producto en Setup antes de generar.' }); return; }

    let authToken = '';
    try { const { data: { session } } = await supabase.auth.getSession(); authToken = session?.access_token || ''; } catch {}

    const sel = ideas.filter(i => selected.has(i.id));
    setGenerating(true);
    setProgreso({ done: 0, total: sel.length });
    const execId = startExecution({
      label: `Generando ${count} × ${sel.length} idea${sel.length !== 1 ? 's' : ''} de ${producto.nombre}`,
      sublabel: 'Estáticos en masa desde la Bandeja',
      kind: 'creative-from-idea',
      estimatedMs: 90000 * Math.ceil(sel.length / POOL),
    });

    // Una llamada por idea con n=count (igual que la Bandeja). Abort a 330s.
    const doOne = async (idea) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 330000);
      try {
        const resp = await fetch('/api/marketing/crear-imagen-desde-idea', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
          body: JSON.stringify({
            idea: {
              id: idea.id, hook: idea.hook, titulo: idea.titulo, angulo: idea.angulo,
              painPoint: idea.painPoint, escenarioNarrativo: idea.escenarioNarrativo,
              descripcionImagen: idea.descripcionImagen, estiloVisual: idea.estiloVisual,
              publicoSugerido: idea.publicoSugerido, creenciaApalancada: idea.creenciaApalancada,
              textoEnImagen: idea.textoEnImagen, formato: idea.formato,
            },
            producto: {
              id: producto.id, nombre: producto.nombre, descripcion: producto.descripcion,
              research: producto.docs?.research, formato: producto.formato || '',
              ofertasReales: producto.ofertasReales || '',
              offerBrief: producto.ofertasReales || producto.docs?.offerBrief || '',
            },
            productoImagen: prodImg,
            accentColor: getAccentColor(producto.id, producto) || '',
            n: count, size: '1024x1024', quality,
          }),
          signal: ac.signal,
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && (data.error?.message || data.error)) || `HTTP ${resp.status}`);
        logCostsFromResponse(data, `creativos bulk · ${idea.hook?.slice(0, 40) || 'idea'}`);
        return Array.isArray(data.cloudCreativos) ? data.cloudCreativos.map(c => c?.imageUrl).filter(Boolean) : [];
      } finally { clearTimeout(timer); }
    };

    // Pool de concurrencia sobre las ideas seleccionadas.
    const queue = [...sel];
    const urls = [];
    let ok = 0, fail = 0;
    const worker = async () => {
      while (queue.length) {
        const idea = queue.shift();
        updateExecution(execId, { stage: `Generando "${(idea.hook || idea.titulo || 'idea').slice(0, 40)}"…` });
        try { urls.push(...await doOne(idea)); ok++; }
        catch (e) { fail++; console.warn('[creativos bulk] fail:', e?.message); }
        setProgreso(p => ({ ...p, done: p.done + 1 }));
        try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail: { productoId: String(producto.id), cloud: true } })); } catch {}
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, queue.length) }, worker));

    setGenerating(false);
    setSelected(new Set());
    if (ok > 0) setRecientes({ urls });
    finishExecution(execId, { ok: ok > 0, message: `${ok} idea(s) generadas${fail ? ` · ${fail} fallaron` : ''} para ${producto.nombre}.` });
    addToast?.({
      type: ok > 0 ? 'success' : 'error',
      message: `${ok * count} estáticos generados${fail ? ` · ${fail} ideas fallaron` : ''}. Están en la Galería.`,
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Generar estáticos en masa</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Seleccioná ideas de la Bandeja y generá varias a la vez — caen en la Galería del producto.
          </p>
        </div>
      </div>

      {ideas.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center">
          <Inbox size={20} className="mx-auto text-gray-400 mb-1.5" />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            No hay ideas todavía. Generá ideas temáticas arriba (o en la Bandeja) y aparecen acá para convertirlas en estáticos.
          </p>
        </div>
      ) : (
        <>
          {/* Barra de acciones */}
          <div className="flex flex-wrap items-center gap-3 mb-3 pb-3 border-b border-gray-100 dark:border-gray-700/60">
            <button onClick={selected.size === ideas.length ? clear : selectAll}
              className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
              {selected.size === ideas.length ? 'Deseleccionar todas' : `Seleccionar todas (${ideas.length})`}
            </button>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500 dark:text-gray-400">Cantidad c/u:</span>
              {COUNT_OPTIONS.map(c => (
                <button key={c} onClick={() => setCount(c)}
                  className={`w-7 h-7 text-xs font-bold rounded-lg transition ${count === c ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                  {c}
                </button>
              ))}
            </div>
            <select value={quality} onChange={e => setQuality(e.target.value)}
              className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button
              onClick={handleGenerar}
              disabled={generating || selected.size === 0}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg hover:from-emerald-600 hover:to-teal-600 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating
                ? <><Loader2 size={13} className="animate-spin" /> {progreso.done}/{progreso.total}…</>
                : <><Sparkles size={13} /> Generar {count} × {selected.size}</>}
            </button>
          </div>

          {/* Preview de recién creados */}
          {recientes && (
            <div className="mb-3 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
                  <Check size={12} /> Recién creados
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={irAGaleria}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition">
                    Ver en Galería <ArrowRight size={11} />
                  </button>
                  <button onClick={() => setRecientes(null)} className="text-[10px] text-gray-400 hover:text-gray-600">Cerrar</button>
                </div>
              </div>
              {recientes.urls.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {recientes.urls.map((u, i) => (
                    <img key={i} src={u} alt="" loading="lazy" className="w-16 h-16 object-cover rounded-md border border-emerald-200 dark:border-emerald-800 shrink-0" />
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-gray-500 dark:text-gray-400">Guardados en la nube. Abrí la Galería para verlos.</p>
              )}
            </div>
          )}

          {/* Grilla de ideas seleccionables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 max-h-[30rem] overflow-y-auto pr-1">
            {ordered.map(idea => {
              const isSel = selected.has(idea.id);
              const order = selectedOrder.get(idea.id);
              const isUsed = usedIds.has(String(idea.id));
              const meta = TIPO_META[idea.tipo];
              const angulo = idea.anguloCategoria || idea.angulo;
              return (
                <button key={idea.id} onClick={() => toggle(idea.id)}
                  className={`text-left p-3 rounded-xl border-2 transition flex gap-3 ${isSel ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300'} ${isUsed && !isSel ? 'opacity-50 grayscale-[40%] hover:opacity-100 hover:grayscale-0' : ''}`}>
                  {/* Check de selección */}
                  <div className={`mt-0.5 w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold ${isSel ? 'bg-emerald-500 text-white' : 'border-2 border-gray-300 dark:border-gray-600'}`}>
                    {isSel ? (order || <Check size={11} />) : ''}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* Fila de etiquetas: tipo (color) + formato + usado + fecha */}
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      {meta && (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded border ${meta.color}`}>
                          {meta.emoji} {meta.label}
                        </span>
                      )}
                      <span className="text-[11px]" title={idea.formato}>{FORMATO_EMOJI[idea.formato] || '🖼️'}</span>
                      {isUsed && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300" title="Ya generaste creativos de esta idea">
                          usado
                        </span>
                      )}
                      {idea.createdAt && (
                        <span className="ml-auto shrink-0 text-[9px] text-gray-400 dark:text-gray-500">
                          {new Date(idea.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                        </span>
                      )}
                    </div>
                    {/* Hook */}
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-snug line-clamp-2">
                      {idea.hook || idea.titulo || 'Idea sin título'}
                    </p>
                    {/* Ángulo */}
                    {angulo && (
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 truncate">{angulo}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
