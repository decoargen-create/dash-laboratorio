// Galería GLOBAL de winners — junta los creativos marcados como winner de
// TODOS los productos del usuario en una sola vista (sin entrar a ningún
// producto). El user los selecciona (como en Inspiración) y los "replica":
// genera N estáticos NUEVOS adaptados a un producto destino que elige.
//
// Reusa el mismo endpoint que Inspiración (/api/marketing/crear-creativo-
// referencial): le pasa el producto DESTINO en `producto`, la imagen del
// winner como `inspiracionImageUrl` y el `skeleton` ya extraído del winner
// como `skeletonCached` (saltea Vision). Los estáticos generados caen en la
// Galería del producto destino.

import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Sparkles, Loader2, Check, ImageOff, Package, ArrowRight } from 'lucide-react';
import { listAllWinners } from './galeriaReferenciales.js';
import { getProductoImagen, getAccentColor } from './productoImagen.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';
import { logCostsFromResponse } from './costsStore.js';
import { supabase } from './supabase.js';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const COUNT_OPTIONS = [1, 2, 4, 6];

function loadProductos() {
  try { return JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]'); } catch { return []; }
}

export default function WinnersGlobalSection({ addToast, onGoToSection }) {
  const [winners, setWinners] = useState([]);
  const [productos, setProductos] = useState(() => loadProductos());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [targetId, setTargetId] = useState('');
  const [count, setCount] = useState(2);
  const [quality, setQuality] = useState('high');
  const [generating, setGenerating] = useState(false);
  // Recién creados: { productoId, productoNombre, urls: [] } — preview inline
  // para no tener que entrar al producto a buscarlos.
  const [recientes, setRecientes] = useState(null);

  // Abre el producto destino en su tab Galería. Seteamos localStorage (por si
  // Arranque no está montado todavía) + disparamos los eventos que escucha
  // Arranque (por si ya está montado). Después navegamos a la sección.
  const irAGaleria = (productoId) => {
    try { localStorage.setItem('adslab-marketing-active-product', String(productoId)); } catch {}
    try { localStorage.setItem(`adslab-marketing-prod-tab-${productoId}`, 'galeria'); } catch {}
    try {
      window.dispatchEvent(new CustomEvent('viora:product-select', { detail: { productoId: String(productoId) } }));
      window.dispatchEvent(new CustomEvent('viora:product-tab', { detail: { tab: 'galeria' } }));
    } catch {}
    onGoToSection?.('mk-arranque');
  };

  // Cargar winners del cloud + mantener productos sincronizados con localStorage.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const w = await listAllWinners();
        if (active) setWinners(w);
      } catch { if (active) setWinners([]); }
      finally { if (active) setLoading(false); }
    })();
    const reload = () => setProductos(loadProductos());
    reload();
    window.addEventListener('viora:marketing-pulled', reload);
    window.addEventListener('viora:marketing-storage-changed', reload);
    return () => {
      active = false;
      window.removeEventListener('viora:marketing-pulled', reload);
      window.removeEventListener('viora:marketing-storage-changed', reload);
    };
  }, []);

  const productoNombre = useMemo(() => {
    const m = new Map();
    for (const p of productos) m.set(String(p.id), p.nombre);
    return m;
  }, [productos]);

  const selectedOrder = useMemo(() => {
    const m = new Map(); let i = 0;
    for (const id of selected) m.set(id, ++i);
    return m;
  }, [selected]);

  const toggle = (id) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const target = productos.find(p => String(p.id) === String(targetId)) || null;

  const handleCrear = async () => {
    if (selected.size === 0) { addToast?.({ type: 'warning', message: 'Seleccioná al menos un winner.' }); return; }
    if (!target) { addToast?.({ type: 'warning', message: 'Elegí el producto destino.' }); return; }
    // El endpoint exige la foto del producto destino (data URL).
    const prodImg = await getProductoImagen(target.id, target);
    if (!prodImg) {
      addToast?.({ type: 'error', message: `${target.nombre} no tiene foto cargada. Cargala en Setup del producto destino.` });
      return;
    }

    let authToken = '';
    try { const { data: { session } } = await supabase.auth.getSession(); authToken = session?.access_token || ''; } catch {}

    const sel = winners.filter(w => selected.has(w.id) && w.imageUrl);
    if (sel.length === 0) { addToast?.({ type: 'error', message: 'Los winners seleccionados no tienen imagen utilizable.' }); return; }

    setGenerating(true);
    const execId = startExecution({
      label: `Adaptando ${count} × ${sel.length} winner(s) → ${target.nombre}`,
      sublabel: 'Generando estáticos para el producto destino',
      kind: 'generate',
      estimatedMs: 45000 * sel.length,
    });

    let costoUSD = 0; // costo real acumulado de esta ejecución (se reporta al tray)

    // Una imagen por llamada (n:1) — igual que Inspiración, para no exceder el
    // maxDuration del server cuando count es alto. nPlan=count para que el plan
    // tenga las variaciones; skeletonCached salteamos Vision (lo trae el winner).
    const doOne = async (w, variationStartIndex) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 330000);
      try {
        const resp = await fetch('/api/marketing/crear-creativo-referencial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
          body: JSON.stringify({
            producto: {
              id: target.id, nombre: target.nombre, descripcion: target.descripcion,
              research: target.docs?.research, formato: target.formato || '',
              ofertasReales: target.ofertasReales || '',
              offerBrief: target.ofertasReales || target.docs?.offerBrief || '',
            },
            inspiracion: {
              brandNombre: `Winner: ${productoNombre.get(String(w.productoId)) || 'propio'}`,
              formato: 'static', analysis: null, visual: null,
            },
            inspiracionImageUrl: w.imageUrl,
            productoImagen: prodImg,
            accentColor: getAccentColor(target.id, target) || '',
            quality, size: '1024x1024',
            n: 1, nPlan: count, variationStartIndex,
            skeletonCached: w.skeleton || null,
          }),
          signal: ac.signal,
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && (data.error?.message || data.error)) || `HTTP ${resp.status}`);
        costoUSD += logCostsFromResponse(data, `winners → ${target.nombre}`)?.total || 0;
        // URLs de los creativos recién subidos al cloud (para el preview).
        const urls = Array.isArray(data.cloudCreativos)
          ? data.cloudCreativos.map(c => c?.imageUrl).filter(Boolean)
          : [];
        return urls;
      } finally { clearTimeout(timer); }
    };

    let ok = 0, fail = 0;
    const nuevasUrls = [];
    for (const w of sel) {
      updateExecution(execId, { stage: `Adaptando winner de ${productoNombre.get(String(w.productoId)) || 'producto'}…` });
      const calls = Array.from({ length: count }, (_, i) =>
        doOne(w, i).then(urls => { ok++; nuevasUrls.push(...urls); }).catch(e => { fail++; console.warn('[winners] gen fail:', e?.message); })
      );
      await Promise.allSettled(calls);
      try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail: { productoId: String(target.id), cloud: true } })); } catch {}
    }

    setGenerating(false);
    setSelected(new Set());
    if (ok > 0) setRecientes({ productoId: String(target.id), productoNombre: target.nombre, urls: nuevasUrls });
    finishExecution(execId, { ok: ok > 0, message: `${ok} estáticos creados para ${target.nombre}${fail ? ` · ${fail} fallaron` : ''}.`, cost: costoUSD });
    addToast?.({
      type: ok > 0 ? 'success' : 'error',
      message: `${ok} estáticos adaptados a ${target.nombre}. Están en la Galería de ${target.nombre}.`,
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 flex items-center justify-center text-white shadow-sm">
          <Trophy size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Winners — galería global</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tus creativos ganadores de todos los productos. Seleccioná y replicalos adaptados a otro producto.
          </p>
        </div>
      </div>

      {/* Barra de crear — aparece cuando hay selección */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-white/95 dark:bg-gray-800/95 backdrop-blur border border-amber-300 dark:border-amber-700/50 shadow-lg">
          <span className="text-xs font-bold text-amber-700 dark:text-amber-300">{selected.size} seleccionado{selected.size > 1 ? 's' : ''}</span>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Producto destino:</span>
            <select
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Elegí…</option>
              {productos.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Cantidad:</span>
            {COUNT_OPTIONS.map(c => (
              <button key={c} onClick={() => setCount(c)}
                className={`w-7 h-7 text-xs font-bold rounded-lg transition ${count === c ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {c}
              </button>
            ))}
          </div>

          <select
            value={quality}
            onChange={e => setQuality(e.target.value)}
            className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            title="Calidad de generación"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <button
            onClick={handleCrear}
            disabled={generating || !targetId}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-yellow-500 rounded-lg hover:from-amber-600 hover:to-yellow-600 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating
              ? <><Loader2 size={13} className="animate-spin" /> Generando…</>
              : <><Sparkles size={13} /> Crear {count} × {selected.size}</>}
          </button>
          <button onClick={() => setSelected(new Set())} disabled={generating}
            className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50">
            Limpiar
          </button>
        </div>
      )}

      {/* Recién creados — preview inline + salto a la Galería del producto */}
      {recientes && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
              <Check size={13} /> Recién creados para {recientes.productoNombre}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => irAGaleria(recientes.productoId)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition">
                Ver en Galería de {recientes.productoNombre} <ArrowRight size={12} />
              </button>
              <button onClick={() => setRecientes(null)}
                className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">Cerrar</button>
            </div>
          </div>
          {recientes.urls.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recientes.urls.map((u, i) => (
                <img key={i} src={u} alt="" loading="lazy"
                  className="w-20 h-20 object-cover rounded-lg border border-emerald-200 dark:border-emerald-800 shrink-0" />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Generados y guardados en la nube. Abrí la Galería del producto para verlos.
            </p>
          )}
        </div>
      )}

      {/* Grilla de winners */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Cargando winners…
        </div>
      ) : winners.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Trophy size={26} className="text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Todavía no hay winners</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
              Marcá un creativo como <span className="font-semibold">winner</span> desde la Galería de cualquier
              producto (los que publicaste y rindieron). Acá se juntan todos para replicarlos.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {winners.map(w => {
            const isSel = selected.has(w.id);
            const order = selectedOrder.get(w.id);
            return (
              <button key={w.id} onClick={() => toggle(w.id)}
                className={`group relative aspect-square rounded-xl overflow-hidden border-2 transition ${isSel ? 'border-amber-500 ring-2 ring-amber-300 dark:ring-amber-700' : 'border-gray-200 dark:border-gray-700 hover:border-amber-300'}`}>
                {w.imageUrl
                  ? <img src={w.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-400"><ImageOff size={20} /></div>}

                {/* Badge winner */}
                <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-white text-[8px] font-bold inline-flex items-center gap-0.5">
                  <Trophy size={8} /> WINNER
                </div>

                {/* Check de selección */}
                {isSel && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[10px] font-bold shadow">
                    {order || <Check size={12} />}
                  </div>
                )}

                {/* Producto de origen */}
                <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent">
                  <div className="flex items-center gap-1 text-[9px] text-white/90 truncate">
                    <Package size={9} className="shrink-0" />
                    <span className="truncate">{productoNombre.get(String(w.productoId)) || 'producto'}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
