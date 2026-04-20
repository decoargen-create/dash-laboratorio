// Sección Meta Ads — vista tipo Ads Manager por producto.
//
// Muestra los ads activos de la cuenta publicitaria conectada a cada
// producto, con sus insights (CTR, ROAS, gasto, impresiones, compras).
// Sirve para entender qué está corriendo en la cuenta y qué identifica
// el matcher IA como del producto vs no.
//
// Pipeline:
//   1. Selector de productos (idéntico al de Bandeja).
//   2. Una vez elegido el producto, mostrar la lista de ads de su
//      metaAccount.ads (que ya viene cargada desde Arranque).
//   3. Próximamente (6.2 +): cards con insights, filtros, etc.

import React, { useState, useEffect } from 'react';
import {
  BarChart3, Package, ChevronRight, Inbox,
} from 'lucide-react';

const PRODUCTOS_KEY = 'viora-marketing-productos-v1';
const ACTIVE_KEY = 'viora-marketing-meta-ads-active-product';

function loadProductos() {
  try {
    const raw = localStorage.getItem(PRODUCTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function MetaAdsSection({ addToast }) {
  const [productos, setProductos] = useState(() => loadProductos());
  const [activeProductoId, setActiveProductoId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
  });

  // Refrescamos productos cada 3s — si el user agrega/edita en Arranque,
  // se refleja acá sin recargar.
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

  // ====================================================================
  // VISTA 1: SELECTOR DE PRODUCTOS
  // ====================================================================
  if (!activeProductoId || !producto) {
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white shadow-sm">
            <BarChart3 size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Meta Ads</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Anuncios y performance por producto — para entender qué está corriendo en cada cuenta.
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {productos.map(p => {
              const adsCount = p.metaAccount?.ads?.length || 0;
              const matchedCount = (p.metaAccount?.ads || []).filter(a => a.productMatch).length;
              const inicial = p.nombre?.charAt(0)?.toUpperCase() || 'P';
              const tieneCuenta = !!p.metaAccount;
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveProductoId(String(p.id))}
                  className="text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition group"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition">
                      {inicial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {tieneCuenta
                          ? `${p.metaAccount.name} · ${adsCount} ads activos`
                          : 'Sin cuenta Meta conectada'}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400 group-hover:text-blue-500 transition shrink-0" />
                  </div>
                  {tieneCuenta && (
                    <div className="flex items-center gap-2 text-[10px] mt-2">
                      <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded font-bold">
                        {adsCount} total
                      </span>
                      {matchedCount > 0 && (
                        <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded font-bold">
                          ✓ {matchedCount} del producto
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ====================================================================
  // VISTA 2: ADS DEL PRODUCTO (placeholder — se llena en 6.2)
  // ====================================================================
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
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white shadow-sm shrink-0">
          <BarChart3 size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            <button onClick={() => setActiveProductoId(null)} className="hover:text-blue-500 transition">Meta Ads</button> / {producto.nombre}
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
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300 font-semibold">
            {producto.metaAccount.ads?.length || 0} ads activos en {producto.metaAccount.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">
            Lista detallada con insights se agrega en próximas partes (6.2 / 6.3).
          </p>
        </div>
      )}
    </div>
  );
}
