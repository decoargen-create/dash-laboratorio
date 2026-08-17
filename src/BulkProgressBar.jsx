// Barra flotante de progreso de un bulk-gen. Diseño COMPACTO (elegido por el
// user): ocupa poco — todo en una línea (spinner · % · imágenes · gasto) con una
// barra fina abajo. Sin puntitos por ad, sin ETA.
//
// Muestra:
//   • porcentaje
//   • imágenes procesadas del total (ads × variantes por ad)
//   • gasto acumulado estimado (USD → ARS con el dólar cripto)
//
// Durante un bulk las cards por-ad del ExecutionsTray se suprimen
// (silentExecution), así el user ve SOLO esta barra.
//
// Extraída de InspiracionSection a su propio archivo para que el lazy-load de
// InspiracionSection no traiga este componente al main chunk (lo usa
// BulkProgressBarGlobal que sí está en el chunk principal).

import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { fetchDolarCripto, subscribeDolar, usdToArsString, getDolarCriptoCached } from './dolarStore.js';

export default function BulkProgressBar({ state, onClose }) {
  const [dolar, setDolar] = useState(() => getDolarCriptoCached());
  useEffect(() => {
    fetchDolarCripto().catch(() => {});
    return subscribeDolar(setDolar);
  }, []);

  if (!state) return null;
  const { total, completed, errors, imagesPerAd = 1, estimatedCost = 0 } = state;
  const nErr = errors?.length || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone = completed >= total;

  // Imágenes: ads × variantes por ad. Más natural que "X de N ads".
  const totalImgs = total * imagesPerAd;
  const doneImgs = Math.min(totalImgs, completed * imagesPerAd);
  // Gasto acumulado estimado, proporcional a lo procesado.
  const spentUsd = total > 0 ? estimatedCost * (completed / total) : 0;
  const gastoArs = dolar?.venta ? usdToArsString(spentUsd, dolar) : null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 border-2 border-brand-400 dark:border-brand-700 rounded-2xl shadow-2xl w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden">
      <div className="px-4 py-3">
        {/* Una sola línea: estado · % · imágenes · gasto · cerrar */}
        <div className="flex items-center gap-2.5">
          {isDone
            ? <Check size={16} className="text-emerald-500 shrink-0" />
            : <Loader2 size={15} className="text-brand-500 animate-spin shrink-0" />}
          <span className={`text-xl font-black leading-none tabular-nums shrink-0 ${isDone ? 'text-emerald-500' : 'text-brand-600 dark:text-brand-300'}`}>
            {pct}%
          </span>
          <span className="flex-1 min-w-0 text-[11px] text-gray-600 dark:text-gray-300 tabular-nums truncate">
            {isDone ? `${doneImgs} imágenes listas` : `${doneImgs}/${totalImgs} imágenes`}
            {(spentUsd > 0) && (
              <>
                <span className="text-gray-400 dark:text-gray-500 mx-1.5">·</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{gastoArs || `US$${spentUsd.toFixed(2)}`}</span>
              </>
            )}
          </span>
          <button onClick={onClose} className="p-1 -mr-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition shrink-0" title="Cerrar">
            <X size={14} />
          </button>
        </div>

        {/* Barra fina */}
        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-2.5">
          <div
            className={`h-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-500 to-brand-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Pie mínimo: aviso mientras corre / resultado al terminar */}
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
          {isDone
            ? <>Terminó{nErr > 0 ? ` · ${nErr} fallaron` : ''} — revisá la galería 🎬</>
            : <>Podés cerrar la pestaña, sigue solo{nErr > 0 ? ` · ${nErr} con error` : ''}</>}
        </p>
      </div>
    </div>
  );
}
