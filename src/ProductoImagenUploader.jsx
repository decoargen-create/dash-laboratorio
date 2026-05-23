// Setup visual del producto: foto real + paleta de marca.
//
// - Foto real: OBLIGATORIA para generar estáticos (gpt-image-1 la usa como
//   referencia para que el envase sea el real).
// - Paleta de marca: colores de la landing/producto que se inyectan en el
//   prompt de generación para que los creativos sean coherentes con la
//   marca. Se auto-detecta de la foto y se puede editar.

import React, { useState, useRef, useEffect } from 'react';
import { ImagePlus, Loader2, Trash2, Check, AlertCircle, Plus, Pipette } from 'lucide-react';
import {
  getProductoImagen, setProductoImagen, removeProductoImagen, comprimirImagen,
  getPaletaMarca, setPaletaMarca, extraerColores,
  getDatosMarketing, setDatosMarketing,
} from './productoImagen.js';

export default function ProductoImagenUploader({ productoId, addToast }) {
  const [imagen, setImagen] = useState(null);
  const [paleta, setPaleta] = useState([]);
  const [marketing, setMarketing] = useState({ badgeText: '', rating: 0, reviews: 0 });
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    setImagen(getProductoImagen(productoId));
    setPaleta(getPaletaMarca(productoId));
    const mkt = getDatosMarketing(productoId);
    setMarketing({
      badgeText: mkt?.badgeText || '',
      rating: Number(mkt?.rating || 0),
      reviews: Number(mkt?.reviews || 0),
    });
    setError('');
  }, [productoId]);

  const guardarMarketing = (next) => {
    setMarketing(next);
    setDatosMarketing(productoId, next);
  };

  const guardarPaleta = (next) => {
    setPaleta(next);
    setPaletaMarca(productoId, next);
  };

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
      // Auto-detecta la paleta de la foto si todavía no hay una definida.
      if (getPaletaMarca(productoId).length === 0) {
        const colores = await extraerColores(dataUrl);
        if (colores.length > 0) guardarPaleta(colores);
      }
      addToast?.({ type: 'success', message: 'Foto del producto cargada' });
    } catch (err) {
      setError(err.message || 'No se pudo cargar la imagen');
    } finally {
      setProcesando(false);
    }
  };

  const quitarFoto = () => {
    removeProductoImagen(productoId);
    setImagen(null);
    setError('');
  };

  const tomarColoresDeFoto = async () => {
    if (!imagen) return;
    const colores = await extraerColores(imagen);
    if (colores.length > 0) {
      guardarPaleta(colores);
      addToast?.({ type: 'success', message: 'Colores tomados de la foto' });
    } else {
      addToast?.({ type: 'info', message: 'No se detectaron colores claros en la foto' });
    }
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
          : <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">requerida para estáticos</span>}
      </div>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
        Subí una foto real del producto, idealmente con fondo blanco. Se usa como referencia para que el envase de los creativos sea el real, no uno inventado.
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
            <button onClick={quitarFoto}
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

      {/* Paleta de marca */}
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-xs font-bold text-gray-900 dark:text-gray-100">🎨 Paleta de marca</p>
          {imagen && (
            <button onClick={tomarColoresDeFoto}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline">
              <Pipette size={10} /> Tomar de la foto
            </button>
          )}
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
          Colores de tu marca (landing + producto). Los creativos se generan respetando esta paleta.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {paleta.map((color, i) => (
            <div key={i} className="relative group">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#cccccc'}
                onChange={e => guardarPaleta(paleta.map((c, j) => j === i ? e.target.value : c))}
                className="w-9 h-9 rounded-md border border-gray-300 dark:border-gray-600 cursor-pointer bg-transparent p-0"
                title={color}
              />
              <button
                onClick={() => guardarPaleta(paleta.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-700 dark:bg-gray-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                title="Quitar color"
              >
                <Trash2 size={9} />
              </button>
            </div>
          ))}
          {paleta.length < 6 && (
            <button
              onClick={() => guardarPaleta([...paleta, '#cccccc'])}
              className="w-9 h-9 rounded-md border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-brand-400 hover:text-brand-500 transition flex items-center justify-center"
              title="Agregar color"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
        {paleta.length === 0 && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5 italic">
            Subí la foto del producto y la paleta se detecta sola — o agregá colores a mano.
          </p>
        )}
      </div>

      {/* Datos de marketing — badge + rating + reseñas, opcionales,
          se componen encima de TODOS los creativos del producto. */}
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1.5">📊 Datos de marketing <span className="font-normal text-gray-400">(opcionales)</span></p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
          Se agregan como overlay encima de los creativos. Dejá vacío lo que no quieras mostrar.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Badge (sello)</label>
            <input
              type="text"
              value={marketing.badgeText}
              onChange={e => guardarMarketing({ ...marketing, badgeText: e.target.value.slice(0, 20) })}
              placeholder="Ej: HOT SALE, -50%"
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Rating ★</label>
            <input
              type="number"
              min={0} max={5} step={0.1}
              value={marketing.rating || ''}
              onChange={e => guardarMarketing({ ...marketing, rating: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })}
              placeholder="0 a 5"
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Reseñas (cant.)</label>
            <input
              type="number"
              min={0}
              value={marketing.reviews || ''}
              onChange={e => guardarMarketing({ ...marketing, reviews: Math.max(0, Number(e.target.value) || 0) })}
              placeholder="Ej: 1200"
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
