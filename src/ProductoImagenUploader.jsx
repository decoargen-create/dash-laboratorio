// Setup visual del producto — foto del envase + color de acento.
// La foto se usa como referencia en gpt-image-2 al generar creativos
// referenciales desde Inspiración (mantiene tu envase real).

import React, { useState, useRef, useEffect } from 'react';
import { ImagePlus, Loader2, Trash2, Check, AlertCircle, Wand2 } from 'lucide-react';
import {
  getProductoImagen, setProductoImagen, removeProductoImagen, comprimirImagen,
  getAccentColor, setAccentColor,
} from './productoImagen.js';
import { extractPalette } from './extractPalette.js';

export default function ProductoImagenUploader({ productoId, producto = null, addToast }) {
  const [imagen, setImagen] = useState(null);
  const [accent, setAccent] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');
  // Paleta auto-extraída de la foto cargada — se muestra como swatches
  // sugeridos sobre el color picker manual.
  const [palette, setPalette] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Cross-PC: pasamos producto como fallback para que el cloud
        // fotoUrl se baje incluso si localStorage está stale.
        const img = await getProductoImagen(productoId, producto);
        if (cancelled) return;
        setImagen(img);
        setAccent(getAccentColor(productoId) || '');
        setError('');
        setPalette([]);
        if (img) extractPalette(img, 5).then(setPalette).catch(() => {});
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [productoId]);

  const onArchivo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProcesando(true);
    setError('');
    try {
      const dataUrl = await comprimirImagen(file);
      await setProductoImagen(productoId, dataUrl);
      setImagen(dataUrl);
      addToast?.({ type: 'success', message: 'Foto del producto cargada' });
      // Extraer paleta en background — si tarda no bloquea la UI.
      extractPalette(dataUrl, 5).then(p => {
        setPalette(p);
        // Si el user todavía no eligió accent, sugerimos el primer color
        // dominante. No pisamos si ya hay uno seteado (respeta su decisión).
        if (p.length > 0 && !getAccentColor(productoId)) {
          setAccent(p[0]);
          setAccentColor(productoId, p[0]);
        }
      }).catch(() => {});
    } catch (err) {
      setError(err.message || 'No se pudo cargar la imagen');
    } finally {
      setProcesando(false);
    }
  };

  const quitar = async () => {
    await removeProductoImagen(productoId);
    setImagen(null);
    setError('');
    setPalette([]);
  };

  const reExtraerPaleta = async () => {
    if (!imagen) return;
    try {
      const p = await extractPalette(imagen, 5);
      setPalette(p);
      if (p.length === 0) {
        addToast?.({ type: 'info', message: 'No detecté colores claros en la foto (¿es muy gris/blanca?).' });
      }
    } catch {
      addToast?.({ type: 'error', message: 'No pude extraer la paleta.' });
    }
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
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300">🎨 Color de acento <span className="font-normal text-gray-400">(opcional)</span></p>
          {imagen && (
            <button onClick={reExtraerPaleta}
              className="inline-flex items-center gap-1 text-[10px] text-brand-600 dark:text-brand-400 hover:underline">
              <Wand2 size={10} /> Re-extraer
            </button>
          )}
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
          Color para flechas/highlights/CTA en los creativos. Si no lo definís, gpt-image usa los tonos del producto.
        </p>

        {/* Swatches sugeridos por la IA — extraídos client-side de la foto */}
        {palette.length > 0 && (
          <div className="mb-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
              <Wand2 size={9} className="inline mr-0.5" /> Sugeridos desde tu producto
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {palette.map((color, i) => {
                const isActive = accent?.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
                    onClick={() => cambiarAccent(color)}
                    title={`${color}${i === 0 ? ' · más dominante' : ''}`}
                    className={`w-7 h-7 rounded-md border-2 transition hover:scale-110 ${
                      isActive
                        ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-900'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">o elegí a mano:</p>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#dc2626'}
            onChange={e => cambiarAccent(e.target.value)}
            className="w-10 h-10 rounded-md border border-gray-300 dark:border-gray-600 cursor-pointer bg-transparent p-0"
          />
          {accent && (
            <>
              <span className="text-[10px] font-mono text-gray-600 dark:text-gray-400">{accent}</span>
              <button onClick={() => cambiarAccent('')}
                className="text-[10px] text-gray-500 hover:text-red-500 transition">
                quitar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
