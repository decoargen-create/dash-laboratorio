// Modal galería — muestra todos los creativos referenciales generados
// para el producto activo. Click en uno → lightbox con descarga + delete.

import React, { useState, useEffect } from 'react';
import { X, Download, Trash2, Images } from 'lucide-react';
import { getReferencialesByProducto, deleteReferencial } from './galeriaReferenciales.js';

export default function GaleriaReferencialesModal({ productoId, productoNombre, onClose }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cargando, setCargando] = useState(true);

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
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-6"
          onClick={() => setSelected(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <img
              src={`data:${selected.mimeType || 'image/png'};base64,${selected.imageBase64}`}
              alt=""
              className="max-w-full max-h-[75vh] object-contain bg-white"
            />
            <div className="flex items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                {selected.sourceBrand && <span>Inspirado en {selected.sourceBrand}</span>}
                {selected.createdAt && <span> · {new Date(selected.createdAt).toLocaleString('es-AR')}</span>}
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
                  onClick={() => setSelected(null)}
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
