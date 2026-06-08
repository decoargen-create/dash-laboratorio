// Modal galería — muestra todos los creativos referenciales generados
// para el producto activo. Click en uno → lightbox con descarga + delete.

import React, { useState, useEffect } from 'react';
import { X, Download, Trash2, Images, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { getReferencialesByProducto, deleteReferencial } from './galeriaReferenciales.js';

export default function GaleriaReferencialesModal({ productoId, productoNombre, onClose }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

  const refresh = () => {
    setCargando(true);
    getReferencialesByProducto(productoId)
      .then(setItems)
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    refresh();
    const onSaved = (e) => {
      if (String(e?.detail?.productoId || '') === String(productoId)) refresh();
    };
    window.addEventListener('viora:referencial-saved', onSaved);
    return () => window.removeEventListener('viora:referencial-saved', onSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (selected) setSelected(null); else onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, onClose]);

  const handleDelete = async (id) => {
    if (!window.confirm('¿Borrar este creativo referencial?')) return;
    await deleteReferencial(id);
    setSelected(null);
    refresh();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Images size={18} className="text-brand-500" />
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Galería de referenciales</h3>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                {productoNombre} · {items.length} creativo{items.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 max-h-[80vh] overflow-y-auto">
          {cargando ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-12">Cargando…</p>
          ) : items.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              <Images size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Sin referenciales todavía</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Elegí ads en Inspiración y dale "Crear creativo" — los generados aparecen acá.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map(it => (
                <button key={it.id} onClick={() => setSelected(it)}
                  className="aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white hover:border-brand-400 hover:scale-105 transition group relative">
                  <img
                    src={`data:${it.mimeType || 'image/png'};base64,${it.imageBase64}`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {it.sourceBrand && (
                    <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-[9px] font-semibold text-white bg-black/60 truncate">
                      Ref: {it.sourceBrand}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {selected && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-start justify-center p-6 overflow-y-auto"
          onClick={() => { setSelected(null); setShowDebug(false); }}
        >
          <div className="relative w-full max-w-5xl bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-2xl my-auto"
            onClick={e => e.stopPropagation()}>
            {/* Vista comparativa: ref a la izq + variación a la der. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-gray-200 dark:bg-gray-700">
              {/* Ref del competidor */}
              <div className="bg-white dark:bg-gray-900 p-3 flex flex-col">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  Inspiración original {selected.sourceBrand ? `· ${selected.sourceBrand}` : ''}
                </p>
                {selected.sourceImageUrl ? (
                  <img
                    src={selected.sourceImageUrl}
                    alt="referencia"
                    className="w-full object-contain bg-gray-50 dark:bg-gray-800 rounded"
                    style={{ maxHeight: '60vh' }}
                    onError={(e) => { e.target.style.opacity = '0.3'; }}
                  />
                ) : (
                  <div className="flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded text-[10px] text-gray-400 italic" style={{ minHeight: '40vh' }}>
                    Sin imagen de referencia guardada
                  </div>
                )}
                {selected.sourceHeadline && (
                  <p className="text-[10px] text-gray-600 dark:text-gray-300 mt-2 line-clamp-2 italic">"{selected.sourceHeadline}"</p>
                )}
              </div>

              {/* Variación generada */}
              <div className="bg-white dark:bg-gray-900 p-3 flex flex-col">
                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400 mb-2">
                  Variación generada {selected.variantIndex != null ? `#${selected.variantIndex + 1}` : ''}
                </p>
                <img
                  src={`data:${selected.mimeType || 'image/png'};base64,${selected.imageBase64}`}
                  alt=""
                  className="w-full object-contain bg-white rounded"
                  style={{ maxHeight: '60vh' }}
                />
                <div className="flex items-center gap-2 mt-2 text-[9px] text-gray-500 dark:text-gray-400">
                  {selected.size && <span>{selected.size}</span>}
                  {selected.quality && <span>· quality {selected.quality}</span>}
                  {selected.sizeFallback && <span className="text-amber-600 dark:text-amber-400">· fallback de tamaño</span>}
                </div>
              </div>
            </div>

            {/* Panel "Cómo se generó" — colapsable. */}
            {(selected.skeleton || selected.prompt) && (
              <div className="border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setShowDebug(s => !s)}
                  className="w-full px-4 py-2 flex items-center justify-between text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  <span>Cómo se generó (skeleton + prompt)</span>
                  {showDebug ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {showDebug && (
                  <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-[10px]">
                    <div>
                      <p className="font-bold text-gray-700 dark:text-gray-200 mb-1">Skeleton extraído por Vision</p>
                      <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-auto max-h-60 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {selected.skeleton ? JSON.stringify(selected.skeleton, null, 2) : '(sin skeleton)'}
                      </pre>
                    </div>
                    <div>
                      <p className="font-bold text-gray-700 dark:text-gray-200 mb-1">Prompt enviado a gpt-image-2</p>
                      <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-auto max-h-60 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {selected.prompt || '(sin prompt guardado)'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                {selected.createdAt && <span>{new Date(selected.createdAt).toLocaleString('es-AR')}</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  href={`data:${selected.mimeType || 'image/png'};base64,${selected.imageBase64}`}
                  download={`referencial-${String(selected.id).slice(0, 12)}.png`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition"
                >
                  <Download size={13} /> Descargar
                </a>
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-lg transition"
                >
                  <Trash2 size={13} /> Borrar
                </button>
                <button
                  onClick={() => { setSelected(null); setShowDebug(false); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition"
                >
                  <X size={13} /> Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
