// Componente de diagnóstico — muestra qué hay realmente en el cloud para
// el user. Útil cuando alguien dice "cargué X en otra PC pero acá no
// aparece" — distingue:
//   1. Data NUNCA llegó al cloud (push falló o nunca corrió)
//   2. Data llegó al cloud pero el pull local falló
//   3. Data está pero la UI no la lee bien

import React, { useState } from 'react';
import { Activity, Loader2, Database, AlertCircle, Check, Cloud, HardDrive } from 'lucide-react';
import { supabase, getCurrentUser } from './supabase.js';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function DiagnosticoSyncModal({ onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reporte, setReporte] = useState(null);

  const runDiagnostico = async () => {
    setLoading(true);
    setError(null);
    setReporte(null);
    try {
      if (!supabase) throw new Error('Supabase no configurado');
      const user = await getCurrentUser();
      if (!user) throw new Error('No hay user logueado');

      // 1) Cloud: marketing_productos
      const { data: cloudProductos, error: e1 } = await supabase
        .from('marketing_productos')
        .select('id, data, updated_at')
        .order('updated_at', { ascending: false });
      if (e1) throw new Error(`Cloud productos: ${e1.message}`);

      // 2) Cloud: marketing_creativos count + sample
      const { count: creativosCount, error: e2 } = await supabase
        .from('marketing_creativos')
        .select('id', { count: 'exact', head: true });
      if (e2) console.warn('Cloud creativos count error:', e2.message);

      // 3) Cloud: marketing_brands
      const { data: cloudBrands, error: e3 } = await supabase
        .from('marketing_brands')
        .select('producto_id, brand_id');
      if (e3) console.warn('Cloud brands error:', e3.message);

      // 4) Local: localStorage productos
      let localProductos = [];
      try {
        localProductos = JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]');
      } catch {}

      // Análisis: por cada producto en cloud, qué campos tiene
      const productosAnalisis = (cloudProductos || []).map(row => {
        const p = row.data || {};
        const local = localProductos.find(lp => String(lp.id) === String(row.id)) || null;
        const dataSize = JSON.stringify(p).length;
        return {
          id: row.id,
          nombre: p.nombre || '(sin nombre)',
          updatedAt: row.updated_at,
          dataSize,
          campos: {
            descripcion: !!p.descripcion,
            landingUrl: !!p.landingUrl,
            stage: !!p.stage,
            'docs.research': !!p.docs?.research,
            'docs.avatar': !!p.docs?.avatar,
            'docs.offerBrief': !!p.docs?.offerBrief,
            'docs.beliefs': !!p.docs?.beliefs,
            'docs.resumenEjecutivo': !!p.docs?.resumenEjecutivo,
            ofertasReales: !!p.ofertasReales,
            accentColor: !!p.accentColor,
            fotoUrl: !!p.fotoUrl,
            activoVisual: !!p.activoVisual?.descripcion,
            competidores: (p.competidores || []).length,
            bandejaIdeas: (p.bandejaIdeas || []).length,
          },
          local: local ? {
            campos: {
              'docs.research': !!local.docs?.research,
              accentColor: !!local.accentColor,
              fotoUrl: !!local.fotoUrl,
              bandejaIdeas: (local.bandejaIdeas || []).length,
            },
          } : null,
        };
      });

      const brandsByProducto = {};
      for (const b of cloudBrands || []) {
        brandsByProducto[b.producto_id] = (brandsByProducto[b.producto_id] || 0) + 1;
      }

      setReporte({
        userId: user.id,
        userEmail: user.email,
        cloud: {
          productosCount: (cloudProductos || []).length,
          productos: productosAnalisis,
          creativosCount: creativosCount || 0,
          brandsByProducto,
        },
        local: {
          productosCount: localProductos.length,
          productos: localProductos.map(p => ({
            id: p.id,
            nombre: p.nombre,
            dataSize: JSON.stringify(p).length,
          })),
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-brand-600" />
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Diagnóstico de sincronización</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm">
            Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!reporte && !loading && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                Muestra exactamente qué datos tiene tu cuenta en el cloud Supabase vs. lo que está en esta PC.
                Útil para saber si te falta data porque nunca se sincronizó.
              </p>
              <button
                onClick={runDiagnostico}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg hover:from-brand-600 hover:to-brand-800 transition"
              >
                <Activity size={14} /> Correr diagnóstico
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-500">
              <Loader2 size={20} className="animate-spin" /> Consultando Supabase…
            </div>
          )}

          {error && (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Error:</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {reporte && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Cloud size={14} className="text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Cloud Supabase</p>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{reporte.cloud.productosCount}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">productos · {reporte.cloud.creativosCount} creativos</p>
                </div>
                <div className="p-3 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10">
                  <div className="flex items-center gap-2 mb-1">
                    <HardDrive size={14} className="text-emerald-600 dark:text-emerald-400" />
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Esta PC (localStorage)</p>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{reporte.local.productosCount}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">productos cacheados</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Productos en el cloud — detalle por campo
                </p>
                {reporte.cloud.productos.length === 0 && (
                  <p className="text-sm italic text-gray-500 dark:text-gray-400 py-3">
                    No hay productos en tu cuenta del cloud. Si esperabas ver algo, el push nunca llegó.
                  </p>
                )}
                {reporte.cloud.productos.map(p => (
                  <details key={p.id} className="border border-gray-200 dark:border-gray-700 rounded-md group" open>
                    <summary className="px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{fmtBytes(p.dataSize)}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0 ml-2">{reporte.cloud.brandsByProducto[p.id] || 0} brands</span>
                    </summary>
                    <div className="px-3 pb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      {Object.entries(p.campos).map(([campo, valor]) => (
                        <div key={campo} className="flex items-center gap-1.5">
                          {typeof valor === 'boolean' ? (
                            valor
                              ? <Check size={11} className="text-emerald-500 shrink-0" />
                              : <span className="text-red-400 shrink-0 font-bold">✕</span>
                          ) : (
                            <span className={`shrink-0 font-mono ${valor > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                              {valor}
                            </span>
                          )}
                          <span className={typeof valor === 'boolean' && !valor ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-gray-300'}>
                            {campo}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>

              <div className="text-[11px] text-gray-500 dark:text-gray-400 italic pt-2 border-t border-gray-100 dark:border-gray-800">
                <strong>Interpretación:</strong> ✓ verde = está en el cloud (sincronizado).
                ✕ rojo = falta. Si te falta <strong>docs.research</strong>, el pipeline nunca pusheó al cloud.
                Si te falta <strong>fotoUrl</strong>, la foto está solo local.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
