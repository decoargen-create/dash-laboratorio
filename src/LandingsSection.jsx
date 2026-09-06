// Landings — checklist de cambios por landing para pasarle al editor.
//
// Lista de landings (una por producto). Al abrir una, se ve su checklist:
// pendientes primero (por prioridad, arrastrables a mano) y los hechos
// colapsados abajo. Cada ítem puede tener prioridad, imágenes de referencia y
// links (Figma/Loom/Drive). v1 = lado admin; el login del editor es fase 2.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList, Plus, X, Trash2, ExternalLink, ImagePlus, Loader2, GripVertical,
  ChevronDown, Check, Link2, Search, Flag, AlertTriangle,
} from 'lucide-react';
import {
  initLandings, subscribeLandings, listLandings, getLanding,
  createLanding, updateLanding, deleteLanding,
  addItem, updateItem, removeItem, toggleItem, reorderItems,
  addItemLink, removeItemLink, uploadItemImage, removeItemImage,
  progresoDe, itemsOrdenados, ESTADOS_LANDING, ESTADO_LANDING_LABEL,
} from './landingsStore.js';

function readProductos() {
  try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]'); }
  catch { return []; }
}

const ESTADO_PILL = {
  revision: 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40',
  progreso: 'text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-900/40',
  lista: 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40',
};
const PRIO_TAG = {
  alta: 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40',
  media: 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40',
};
const PRIO_LABEL = { alta: 'Alta', media: 'Media', '': 'Sin prioridad' };
const PRIO_CYCLE = { '': 'alta', alta: 'media', media: '' };

export default function LandingsSection({ addToast }) {
  const [, force] = useState(0);
  const [selId, setSelId] = useState(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    initLandings();
    const un = subscribeLandings(() => force(x => x + 1));
    let last = 0;
    const onErr = () => {
      const now = Date.now(); if (now - last < 8000) return; last = now;
      addToast?.({ type: 'error', message: 'No se pudo guardar un cambio en la nube. Se reintenta al recargar.' });
    };
    window.addEventListener('viora:landings-sync-error', onErr);
    return () => { un(); window.removeEventListener('viora:landings-sync-error', onErr); };
  }, []); // eslint-disable-line

  const landings = listLandings();

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
          <ClipboardList size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Landings</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Checklist de cambios para el editor — con imágenes de referencia.</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">
          <Plus size={15} /> Nueva landing
        </button>
      </div>

      {landings.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-10 text-center">
          <ClipboardList size={30} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Todavía no hay landings</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Creá una y armá el checklist de cambios para tu editor.</p>
          <button onClick={() => setShowNew(true)} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg">
            <Plus size={13} /> Nueva landing
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {landings.map(l => (
            <LandingCard key={l.id} l={l} open={selId === l.id}
              onToggle={() => setSelId(selId === l.id ? null : l.id)} addToast={addToast} />
          ))}
        </div>
      )}

      {showNew && <NuevaLandingModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); setSelId(id); }} addToast={addToast} />}
    </div>
  );
}

function LandingCard({ l, open, onToggle, addToast }) {
  const prog = progresoDe(l);
  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-xl overflow-hidden transition ${open ? 'border-brand-400 dark:border-brand-600' : 'border-gray-200 dark:border-gray-700'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
        <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{l.productoNombre || 'Sin producto'}</span>
            {l.url && <span className="text-[11px] font-mono text-gray-400 truncate">{prettyUrl(l.url)}</span>}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="w-28 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${prog.pct}%` }} />
            </div>
            <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{prog.done}/{prog.total} hechos</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${ESTADO_PILL[l.estado] || ESTADO_PILL.revision}`}>{ESTADO_LANDING_LABEL[l.estado] || 'En revisión'}</span>
          {l.editor && <span className="text-[11px] text-gray-500 dark:text-gray-400">✎ {l.editor}</span>}
        </div>
      </button>
      {open && <LandingDetail l={l} addToast={addToast} />}
    </div>
  );
}

function LandingDetail({ l, addToast }) {
  const [hideDone, setHideDone] = useState(true);
  const [nuevo, setNuevo] = useState('');
  const [nuevoPrio, setNuevoPrio] = useState('');
  const [dragId, setDragId] = useState(null);
  const { pend, done } = itemsOrdenados(l);

  const agregar = () => {
    const t = nuevo.trim(); if (!t) return;
    addItem(l.id, { texto: t, prioridad: nuevoPrio });
    setNuevo(''); setNuevoPrio('');
  };

  const onDrop = (overId) => {
    if (!dragId || dragId === overId) { setDragId(null); return; }
    const ids = pend.map(i => i.id);
    const from = ids.indexOf(dragId), to = ids.indexOf(overId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorderItems(l.id, ids);
    setDragId(null);
  };

  return (
    <div className="border-t border-gray-100 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-900/20">
      {/* Barra de estado + editor + link */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
        <div className="flex gap-1">
          {ESTADOS_LANDING.map(e => (
            <button key={e} onClick={() => updateLanding(l.id, { estado: e })}
              className={`text-[11px] font-bold px-2 py-1 rounded-md transition ${l.estado === e ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200'}`}>
              {ESTADO_LANDING_LABEL[e]}
            </button>
          ))}
        </div>
        <input value={l.editor || ''} onChange={e => updateLanding(l.id, { editor: e.target.value })}
          placeholder="✎ editor…"
          className="w-28 px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
        {l.url && (
          <a href={l.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 dark:text-brand-300 hover:underline">
            <ExternalLink size={12} /> Abrir landing
          </a>
        )}
        <button onClick={() => { if (confirm('¿Eliminar esta landing y su checklist?')) deleteLanding(l.id); }}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-gray-400 hover:text-red-500 transition">
          <Trash2 size={12} /> Eliminar
        </button>
      </div>

      {/* Composer */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2">
          <input value={nuevo} onChange={e => setNuevo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') agregar(); }}
            placeholder="Agregar un cambio… (ej. “achicar el hero en mobile”)"
            className="flex-1 min-w-0 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <button onClick={() => setNuevoPrio(PRIO_CYCLE[nuevoPrio])} title={`Prioridad: ${PRIO_LABEL[nuevoPrio]}`}
            className={`inline-flex items-center gap-1 px-2.5 py-2 text-xs font-bold rounded-lg border transition ${nuevoPrio ? PRIO_TAG[nuevoPrio] + ' border-transparent' : 'text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
            <Flag size={13} /> {nuevoPrio ? PRIO_LABEL[nuevoPrio] : ''}
          </button>
          <button onClick={agregar} disabled={!nuevo.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus size={15} /> Agregar
          </button>
        </div>
      </div>

      {/* Checklist */}
      <div className="px-4 py-3 space-y-1.5">
        {pend.length === 0 && done.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">Sin cambios cargados. Agregá el primero arriba.</p>
        )}
        {pend.length === 0 && done.length > 0 && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 py-2 text-center font-semibold">🎉 ¡Todo hecho! No queda nada pendiente.</p>
        )}

        {/* Pendientes (arrastrables) */}
        {pend.map(it => (
          <div key={it.id}
            draggable
            onDragStart={() => setDragId(it.id)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => onDrop(it.id)}
            className={`${dragId === it.id ? 'opacity-40' : ''}`}>
            <ItemRow l={l} it={it} addToast={addToast} draggable />
          </div>
        ))}

        {/* Hechos (colapsados) */}
        {done.length > 0 && (
          <div className="pt-1">
            <button onClick={() => setHideDone(v => !v)}
              className="w-full flex items-center gap-2 py-2 border-t border-dashed border-gray-200 dark:border-gray-700/60 text-[10.5px] font-mono font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <Check size={12} /> Hechos · {done.length}
              <ChevronDown size={13} className={`ml-auto transition-transform ${hideDone ? '-rotate-90' : ''}`} />
            </button>
            {!hideDone && done.map(it => <ItemRow key={it.id} l={l} it={it} addToast={addToast} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemRow({ l, it, addToast, draggable = false }) {
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState(it.texto);
  const [addingLink, setAddingLink] = useState(false);
  const [linkVal, setLinkVal] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef(null);

  const guardarTxt = () => { const t = txt.trim(); if (t && t !== it.texto) updateItem(l.id, it.id, { texto: t }); setEditing(false); };
  const ciclarPrio = () => updateItem(l.id, it.id, { prioridad: PRIO_CYCLE[it.prioridad || ''] });

  const subirImg = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setSubiendo(true);
    try { await uploadItemImage(l.id, it.id, file); addToast?.({ type: 'success', message: 'Imagen agregada' }); }
    catch (err) { addToast?.({ type: 'error', message: err.message || 'No se pudo subir la imagen' }); }
    finally { setSubiendo(false); }
  };
  const agregarLink = () => { const v = linkVal.trim(); if (!v) { setAddingLink(false); return; } addItemLink(l.id, it.id, v); setLinkVal(''); setAddingLink(false); };

  return (
    <div className={`flex items-start gap-2.5 py-2.5 px-2 rounded-lg ${it.hecho ? 'opacity-70' : 'bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50'}`}>
      {draggable && <GripVertical size={15} className="text-gray-300 dark:text-gray-600 shrink-0 mt-1 cursor-grab" />}
      <button onClick={() => toggleItem(l.id, it.id)} title={it.hecho ? 'Marcar como pendiente' : 'Marcar como hecho'}
        className={`w-5 h-5 rounded-md border-2 shrink-0 mt-0.5 flex items-center justify-center transition ${it.hecho ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-emerald-500'}`}>
        {it.hecho && <Check size={12} strokeWidth={3.5} />}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input autoFocus value={txt} onChange={e => setTxt(e.target.value)} onBlur={guardarTxt}
            onKeyDown={e => { if (e.key === 'Enter') guardarTxt(); if (e.key === 'Escape') { setTxt(it.texto); setEditing(false); } }}
            className="w-full px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-brand-400 rounded focus:outline-none" />
        ) : (
          <div className={`text-sm ${it.hecho ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100'}`}
            onDoubleClick={() => !it.hecho && setEditing(true)}>
            {it.texto || <span className="italic text-gray-400">sin texto</span>}
          </div>
        )}

        {/* Tags + acciones */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <button onClick={ciclarPrio} title="Cambiar prioridad"
            className={`text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${it.prioridad ? PRIO_TAG[it.prioridad] : 'text-gray-400 bg-gray-100 dark:bg-gray-700/50'}`}>
            {it.prioridad ? PRIO_LABEL[it.prioridad] : 'sin prioridad'}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={subiendo}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-300 transition disabled:opacity-50">
            {subiendo ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />} Imagen
          </button>
          <button onClick={() => setAddingLink(v => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-300 transition">
            <Link2 size={12} /> Link
          </button>
          {!it.hecho && !editing && (
            <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">Editar</button>
          )}
          <button onClick={() => removeItem(l.id, it.id)} className="text-[11px] font-semibold text-gray-400 hover:text-red-500 transition">Borrar</button>
          <input ref={fileRef} type="file" accept="image/*" onChange={subirImg} className="hidden" />
        </div>

        {/* Agregar link */}
        {addingLink && (
          <div className="flex items-center gap-2 mt-2">
            <input autoFocus value={linkVal} onChange={e => setLinkVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') agregarLink(); if (e.key === 'Escape') setAddingLink(false); }}
              placeholder="https://figma.com/… o Loom/Drive"
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <button onClick={agregarLink} className="px-2.5 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-md">Agregar</button>
          </div>
        )}

        {/* Links */}
        {(it.links || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {it.links.map((lk, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-[11px] font-semibold rounded-md bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800">
                <a href={lk.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline max-w-[180px] truncate"><Link2 size={11} /> {lk.label || lk.url}</a>
                <button onClick={() => removeItemLink(l.id, it.id, idx)} className="text-brand-400 hover:text-red-500"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}

        {/* Imágenes */}
        {(it.imagenes || []).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {it.imagenes.map((img, idx) => (
              <div key={idx} className="relative group">
                <button onClick={() => setLightbox(img)} className="block w-16 h-16 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-100 dark:bg-gray-800">
                  <img src={img.url} alt={img.name} className="w-full h-full object-cover" loading="lazy" />
                </button>
                <button onClick={() => removeItemImage(l.id, it.id, idx)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/75" onClick={() => setLightbox(null)}>
          <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-full rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function NuevaLandingModal({ onClose, onCreated, addToast }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [url, setUrl] = useState('');
  const productos = useMemo(() => readProductos(), []);
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? productos.filter(p => (p.nombre || '').toLowerCase().includes(t)) : productos;
  }, [productos, q]);

  const crear = () => {
    if (!sel) { addToast?.({ type: 'warning', message: 'Elegí un producto.' }); return; }
    const l = createLanding({ productoId: sel.id, productoNombre: sel.nombre, url: url.trim() });
    addToast?.({ type: 'success', message: `Landing de ${sel.nombre} creada` });
    onCreated?.(l.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <Plus size={16} className="text-brand-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Nueva landing</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Producto</span>
            <div className="relative mb-1.5">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…"
                className="w-full pl-8 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
              {productos.length === 0 && <p className="text-xs text-gray-400 p-3">No hay productos cargados.</p>}
              {productos.length > 0 && filtrados.length === 0 && <p className="text-xs text-gray-400 p-3">Nada coincide con «{q}».</p>}
              {filtrados.map(p => (
                <button key={p.id} onClick={() => setSel(p)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition ${sel?.id === p.id ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${sel?.id === p.id ? 'border-brand-600 bg-brand-600' : 'border-gray-300 dark:border-gray-600'}`}>
                    {sel?.id === p.id && <Check size={10} className="text-white" strokeWidth={3.5} />}
                  </span>
                  <span className="flex-1 text-gray-800 dark:text-gray-100 truncate">{p.nombre}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Link de la landing <span className="normal-case font-medium text-gray-400">(opcional)</span></span>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={onClose} className="px-3 py-2 text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition">Cancelar</button>
          <button onClick={crear} disabled={!sel}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus size={15} /> Crear landing
          </button>
        </div>
      </div>
    </div>
  );
}

function prettyUrl(u) {
  try { return new URL(u).hostname.replace(/^www\./, '') + (new URL(u).pathname !== '/' ? new URL(u).pathname : ''); }
  catch { return u; }
}
