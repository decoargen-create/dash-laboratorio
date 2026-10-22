// Estáticos → Inspiración: biblioteca general de anuncios de referencia.
//
// Muestra las marcas y competidores de TODOS los productos juntos (sin mover
// datos: cada marca sigue guardada donde se cargó) y genera para el producto
// elegido en "Seleccionar producto" — con su foto, formato, medidas, research
// y oferta. Arranca SIN producto elegido a propósito: se puede mirar y elegir
// anuncios, pero para generar hay que decir explícitamente para cuál.

import React, { useEffect, useState } from 'react';
import { Sparkles, ChevronDown, X } from 'lucide-react';
import { soloVisibles } from './productosVisibles.js';
import InspiracionSection from './InspiracionSection.jsx';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const AYUDA_KEY = 'adslab-inspiracion-ayuda-cerrada';

function leerProductos() {
  try { return soloVisibles(JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]')); } catch { return []; }
}

const PASOS = [
  ['1', 'Elegí el producto', 'Arriba a la derecha: para cuál vas a crear.'],
  ['2', 'Elegí anuncios', 'Tocá el + de los que te gusten. Los de "+30 días activo" son los que más venden.'],
  ['3', 'Creá', '"Crear estáticos" abajo, o "Crear creativo" en uno solo. Salen en la Galería del producto.'],
];

export default function InspiracionGeneral({ addToast }) {
  const [productos, setProductos] = useState(() => leerProductos());
  const [destino, setDestino] = useState('');
  const [ayuda, setAyuda] = useState(() => {
    try { return localStorage.getItem(AYUDA_KEY) !== '1'; } catch { return true; }
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
  const elegido = productos.find(p => String(p.id) === String(destino)) || null;
  // Sin producto elegido se muestra la biblioteca igual (sobre el primero),
  // pero con la generación frenada hasta elegir.
  const base = elegido || productos[0] || null;
  const cerrarAyuda = () => { setAyuda(false); try { localStorage.setItem(AYUDA_KEY, '1'); } catch { /* sin storage */ } };

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[10px] grid place-items-center text-white bg-gradient-to-br from-brand-500 to-brand-700"><Sparkles size={20} /></span>
          <div>
            <h2 className="text-[22px] font-extrabold tracking-tight text-gray-100">Inspiración</h2>
            <p className="text-[13px] text-gray-400">Anuncios de referencia de todas tus marcas, para cualquier producto.</p>
          </div>
        </div>
        {productos.length > 0 && (
          <label className="flex items-center gap-2.5">
            <span className="text-[12.5px] font-semibold text-gray-400">Crear para</span>
            <span className="relative">
              <select value={elegido ? String(elegido.id) : ''} onChange={e => setDestino(e.target.value)}
                className={`appearance-none pl-3.5 pr-9 py-2.5 rounded-[10px] bg-[#10101b] border text-[14px] font-semibold focus:outline-none focus:border-brand-500/70 min-w-[240px] ${elegido
                  ? 'border-[rgba(130,180,255,0.22)] text-gray-100'
                  : 'border-amber-400/60 text-amber-200'}`}>
                <option value="">Seleccionar producto</option>
                {productos.map(p => <option key={p.id} value={String(p.id)}>{p.nombre || 'Sin nombre'}</option>)}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </span>
          </label>
        )}
      </div>

      {ayuda && productos.length > 0 && (
        <div className="relative grid sm:grid-cols-3 gap-3 rounded-2xl border border-[rgba(0,159,253,0.25)] bg-[rgba(0,159,253,0.06)] p-4 pr-10">
          {PASOS.map(([n, t, d]) => (
            <div key={n} className="flex gap-3">
              <span className="w-7 h-7 shrink-0 rounded-full grid place-items-center text-[13px] font-extrabold text-white bg-gradient-to-br from-brand-500 to-brand-700">{n}</span>
              <div><p className="text-[13.5px] font-bold text-gray-100">{t}</p><p className="text-[12.5px] text-gray-400 leading-snug">{d}</p></div>
            </div>
          ))}
          <button onClick={cerrarAyuda} className="absolute top-3 right-3 p-1 text-gray-500 hover:text-gray-200" title="No mostrar más" aria-label="Cerrar ayuda"><X size={16} /></button>
        </div>
      )}

      {!base ? (
        <div className="rounded-2xl border border-dashed border-gray-700 p-10 text-center text-gray-400">
          <p className="font-semibold text-gray-200">Todavía no cargaste ningún producto.</p>
          <p className="text-sm mt-1">Cargalo en <b>Estáticos → Nueva carga</b> y después creá desde acá.</p>
        </div>
      ) : (
        <InspiracionSection key={base.id} addToast={addToast} forcedProductoId={String(base.id)} embedded biblioteca sinDestino={!elegido} />
      )}
    </div>
  );
}
