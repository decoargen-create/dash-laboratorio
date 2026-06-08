// Setup visual del producto — foto del envase + color de acento.
// La foto se usa como referencia en gpt-image-2 al generar creativos
// referenciales desde Inspiración (mantiene tu envase real).

import React, { useState, useRef, useEffect } from 'react';
import { ImagePlus, Loader2, Trash2, Check, AlertCircle } from 'lucide-react';
import {
  getProductoImagen, setProductoImagen, removeProductoImagen, comprimirImagen,
  getAccentColor, setAccentColor,
} from './productoImagen.js';

export default function ProductoImagenUploader({ productoId, addToast }) {
  const [imagen, setImagen] = useState(null);
  const [accent, setAccent] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    setImagen(getProductoImagen(productoId));
    setAccent(getAccentColor(productoId) || '');
    setError('');
  }, [productoId]);

  const onArchivo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProcesando(true);
    setError('');
    try {
      const dataUrl = await comprimirImagen(file);
      setProductoImagen(productoId, dataUrl);
      setImagen(dataUrl);
      addToast?.({ type: 'success', message: 'Foto del producto cargada' });
    } catch (err) {
      setError(err.message || 'No se pudo cargar la imagen');
    } finally {
      setProcesando(false);
    }
  };

  const quitar = () => {
    removeProductoImagen(productoId);
    setImagen(null);
    setError('');
  };

  const cambiarAccent = (color) => {
    setAccent(color);
    setAccentColor(productoId, color);
  };

  return (
    <div className={`mt-3 rounded-lg border p-3 ${
      imagen
        ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10'
        : 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-bold text-gray-900 dark:text-gray-100">📦 Foto del producto</p>
        {imagen
          ? <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5"><Check size={11} /> cargada</span>
          : <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">requerida para crear referenciales</span>}
      </div>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
        Subí una foto del producto (idealmente con fondo blanco). Se usa como referencia para que el envase de los creativos sea el real, no uno inventado.
      </p>

      <div className="flex items-center gap-3">
        {imagen && (
          <div className="w-20 h-20 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white shrink-0">
            <img src={imagen} alt="Producto" className="w-full h-full object-contain" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={procesando}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-md hover:from-brand-600 hover:to-brand-700 transition disabled:opacity-50"
          >
            {procesando
              ? <><Loader2 size={12} className="animate-spin" /> Procesando…</>
              : <><ImagePlus size={12} /> {imagen ? 'Cambiar foto' : 'Subir foto'}</>}
          </button>
          {imagen && (
            <button onClick={quitar}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-red-500 transition">
              <Trash2 size={11} /> Quitar
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" onChange={onArchivo} className="hidden" />
      </div>

      {error && (
        <p className="text-[11px] text-red-600 dark:text-red-400 mt-2 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}

      {/* Color de acento — opcional, se inyecta en el prompt */}
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 mb-1.5">🎨 Color de acento <span className="font-normal text-gray-400">(opcional)</span></p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
          Color para flechas/highlights/CTA en los creativos. Si no lo definís, gpt-image usa los tonos del producto.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#dc2626'}
            onChange={e => cambiarAccent(e.target.value)}
            className="w-10 h-10 rounded-md border border-gray-300 dark:border-gray-600 cursor-pointer bg-transparent p-0"
          />
          {accent && (
            <button onClick={() => cambiarAccent('')}
              className="text-[10px] text-gray-500 hover:text-red-500 transition">
              quitar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
