// Estáticos → Inspiración: biblioteca general de anuncios de referencia.
//
// Muestra las marcas y competidores de TODOS los productos juntos (sin mover
// datos: cada marca sigue guardada donde se cargó) y genera para el producto
// elegido en "Generar para" — con su foto, formato, medidas, research y
// oferta. Reemplaza a la pestaña Inspiración de cada producto.

import React, { useEffect, useState } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import InspiracionSection from './InspiracionSection.jsx';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const DESTINO_KEY = 'adslab-marketing-inspiracion-active-product';

function leerProductos() {
  try { return JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]'); } catch { return []; }
}

export default function InspiracionGeneral({ addToast }) {
  const [productos, setProductos] = useState(() => leerProductos());
  const [destino, setDestino] = useState(() => {
    try { return localStorage.getItem(DESTINO_KEY) || ''; } catch { return ''; }
  });
  useEffect(() => {
    const recargar = () => setProductos(leerProductos());
    window.addEventListener('viora:marketing-pulled', recargar);
    window.addEventListener('viora:marketing-storage-changed', recargar);
    return () => {
      window.removeEventListener('viora:marketing-pulled', recargar);
      window.removeEventListener('viora:marketing-storage-changed', recargar);
    };
  }, []);
  // Si el producto guardado ya no existe (o no había), arranca en el primero.
  const actual = productos.find(p => String(p.id) === String(destino)) || productos[0] || null;
  useEffect(() => {
    if (actual) try { localStorage.setItem(DESTINO_KEY, String(actual.id)); } catch { /* sin storage */ }
  }, [actual?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[10px] grid place-items-center text-white bg-gradient-to-br from-brand-500 to-brand-700"><Sparkles size={20} /></span>
          <div>
            <h2 className="text-[22px] font-extrabold tracking-tight text-gray-100">Inspiración</h2>
            <p className="text-[13px] text-gray-400">Anuncios de referencia de todas tus marcas. Elegí para qué producto generar y usá cualquiera.</p>
          </div>
        </div>
        {productos.length > 0 && (
          <label className="flex items-center gap-2.5">
            <span className="text-[12.5px] font-semibold text-gray-400">Generar para</span>
            <span className="relative">
              <select value={actual ? String(actual.id) : ''} onChange={e => setDestino(e.target.value)}
                className="appearance-none pl-3.5 pr-9 py-2.5 rounded-[10px] bg-[#10101b] border border-[rgba(130,180,255,0.22)] text-[14px] font-semibold text-gray-100 focus:outline-none focus:border-brand-500/70 min-w-[220px]">
                {productos.map(p => <option key={p.id} value={String(p.id)}>{p.nombre || 'Sin nombre'}</option>)}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </span>
          </label>
        )}
      </div>

      {!actual ? (
        <div className="rounded-2xl border border-dashed border-gray-700 p-10 text-center text-gray-400">
          <p className="font-semibold text-gray-200">Todavía no cargaste ningún producto.</p>
          <p className="text-sm mt-1">Cargalo en <b>Estáticos → Nueva carga</b> y después generá desde acá.</p>
        </div>
      ) : (
        <InspiracionSection key={actual.id} addToast={addToast} forcedProductoId={String(actual.id)} embedded biblioteca />
      )}
    </div>
  );
}
