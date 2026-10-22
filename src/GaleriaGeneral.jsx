// Estáticos → Galería: los estáticos generados, filtrados por producto.
// Antes era una pestaña adentro de cada producto; ahora vive en el menú,
// debajo de Inspiración, con un selector de producto arriba.

import React, { useEffect, useState } from 'react';
import { Images, ChevronDown } from 'lucide-react';
import GaleriaReferencialesModal from './GaleriaReferencialesModal.jsx';
import { soloVisibles } from './productosVisibles.js';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const ELEGIDO_KEY = 'adslab-galeria-producto';

function leerProductos() {
  try { return soloVisibles(JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]')); } catch { return []; }
}

export default function GaleriaGeneral() {
  const [productos, setProductos] = useState(() => leerProductos());
  const [elegido, setElegido] = useState(() => {
    try { return localStorage.getItem(ELEGIDO_KEY) || ''; } catch { return ''; }
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
  const producto = productos.find(p => String(p.id) === String(elegido)) || productos[0] || null;
  useEffect(() => {
    if (producto) try { localStorage.setItem(ELEGIDO_KEY, String(producto.id)); } catch { /* sin storage */ }
  }, [producto?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[10px] grid place-items-center text-white bg-gradient-to-br from-brand-500 to-brand-700"><Images size={20} /></span>
          <div>
            <h2 className="text-[22px] font-extrabold tracking-tight text-gray-100">Galería</h2>
            <p className="text-[13px] text-gray-400">Los estáticos que generaste, listos para descargar o publicar.</p>
          </div>
        </div>
        {productos.length > 0 && (
          <label className="flex items-center gap-2.5">
            <span className="text-[12.5px] font-semibold text-gray-400">Producto</span>
            <span className="relative">
              <select value={producto ? String(producto.id) : ''} onChange={e => setElegido(e.target.value)}
                className="appearance-none pl-3.5 pr-9 py-2.5 rounded-[10px] bg-[#10101b] border border-[rgba(130,180,255,0.22)] text-[14px] font-semibold text-gray-100 focus:outline-none focus:border-brand-500/70 min-w-[240px]">
                {productos.map(p => <option key={p.id} value={String(p.id)}>{p.nombre || 'Sin nombre'}</option>)}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </span>
          </label>
        )}
      </div>
      {!producto ? (
        <div className="rounded-2xl border border-dashed border-gray-700 p-10 text-center text-gray-400">
          <p className="font-semibold text-gray-200">Todavía no cargaste ningún producto.</p>
          <p className="text-sm mt-1">Cargalo en <b>Estáticos → Nueva carga</b>.</p>
        </div>
      ) : (
        <GaleriaReferencialesModal key={producto.id} productoId={producto.id} productoNombre={producto.nombre} producto={producto} embedded />
      )}
    </div>
  );
}
