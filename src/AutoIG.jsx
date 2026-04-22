// Sección "Automatización IG" — entrada propia en el sidebar de Marketing.
//
// Wrappeaa el CreativeRefreshPanel con un selector de producto propio para
// que se pueda acceder sin tener que entrar primero a Meta Ads.
//
// Patrón idéntico al de MetaAdsSection: filtra productos con metaAccount
// conectada (sin cuenta Meta no se puede renovar creativos).

import React, { useState, useEffect } from 'react';
import { Instagram, Package, ChevronRight, Inbox } from 'lucide-react';
import CreativeRefreshPanel from './CreativeRefreshPanel.jsx';

const PRODUCTOS_KEY = 'viora-marketing-productos-v1';
const ACTIVE_KEY = 'viora-marketing-auto-ig-active-product';

function loadProductos() {
  try {
    const raw = localStorage.getItem(PRODUCTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function AutoIGSection({ addToast }) {
  const [productos, setProductos] = useState(() => loadProductos());
  const [activeProductoId, setActiveProductoId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
  });

  useEffect(() => {
    const t = setInterval(() => {
      const fresh = loadProductos();
      setProductos(prev => (prev.length !== fresh.length ? fresh : prev));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      if (activeProductoId) localStorage.setItem(ACTIVE_KEY, activeProductoId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {}
  }, [activeProductoId]);

  const producto = productos.find(p => String(p.id) === String(activeProductoId)) || null;

  // Selector de productos — igual estética que MetaAds pero gradiente IG.
  if (!activeProductoId || !producto) {
    const conMeta = productos.filter(p => p.metaAccount);
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white shadow-sm">
            <Instagram size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Automatización IG</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Renovación diaria de creativos con el último post de Instagram — por producto.
            </p>
          </div>
        </div>

        {productos.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
            <Package size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin productos cargados</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Andá a Arranque, creá un producto y conectá su cuenta Meta.
            </p>
          </div>
        ) : conMeta.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
            <Inbox size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ningún producto tiene cuenta Meta conectada</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Andá a Arranque → paso 2 y conectá la cuenta publicitaria.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {conMeta.map(p => {
              const inicial = p.nombre?.charAt(0)?.toUpperCase() || 'P';
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveProductoId(String(p.id))}
                  className="text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:border-pink-300 dark:hover:border-pink-700 hover:shadow-md transition group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition">
                      {inicial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{p.metaAccount.name}</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400 group-hover:text-pink-500 transition shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Vista del panel para el producto elegido.
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveProductoId(null)}
          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition shrink-0"
          title="Volver al selector"
        >
          <ChevronRight size={16} className="rotate-180" />
        </button>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white shadow-sm shrink-0">
          <Instagram size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            <button onClick={() => setActiveProductoId(null)} className="hover:text-pink-500 transition">Automatización IG</button> / {producto.nombre}
          </p>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{producto.nombre}</h2>
        </div>
      </div>

      {!producto.metaAccount ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin cuenta Meta conectada</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Conectá la cuenta publicitaria desde Arranque (paso 2).
          </p>
        </div>
      ) : (
        <CreativeRefreshPanel producto={producto} addToast={addToast} />
      )}
    </div>
  );
}
