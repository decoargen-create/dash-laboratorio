// Barra flotante de progreso de un bulk-gen. Diseño simple, "tipo exportación":
// UN porcentaje grande + una barra fina + cuántos van. Sin puntitos por ad, sin
// ETA, sin costos — eso era mucho ruido. Durante un bulk, las cards por-ad del
// ExecutionsTray se suprimen (silentExecution), así el usuario ve SOLO esto.
//
// Extraída de InspiracionSection a su propio archivo para que el lazy-load de
// InspiracionSection no traiga este componente al main chunk (lo usa
// BulkProgressBarGlobal que sí está en el chunk principal).

import React from 'react';
import { Check, Loader2, X } from 'lucide-react';

export default function BulkProgressBar({ state, onClose }) {
  if (!state) return null;
  const { total, completed, errors } = state;
  const nErr = errors?.length || 0;
  const okCount = Math.max(0, completed - nErr);
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone = completed >= total;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 border-2 border-brand-400 dark:border-brand-700 rounded-2xl shadow-2xl w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden">
      <div className="p-4">
        {/* Encabezado: qué está pasando + cerrar */}
        <div className="flex items-center gap-2 mb-2">
          {isDone
            ? <Check size={15} className="text-emerald-500" />
            : <Loader2 size={14} className="text-brand-500 animate-spin" />}
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex-1">
            {isDone ? 'Listo' : 'Generando creativos'}
          </p>
          <button onClick={onClose} className="p-1 -mr-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Cerrar">
            <X size={14} />
          </button>
        </div>

        {/* Porcentaje grande y claro — lo único importante */}
        <div className="flex items-end gap-2 mb-2">
          <span className={`text-4xl font-black leading-none tabular-nums ${isDone ? 'text-emerald-500' : 'text-brand-600 dark:text-brand-300'}`}>
            {pct}<span className="text-2xl">%</span>
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {completed} de {total}
          </span>
        </div>

        {/* Barra */}
        <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-500 to-brand-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Pie chico: resultado / aviso de que puede cerrar la pestaña */}
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">
          {isDone
            ? <>Terminó · {okCount} OK{nErr > 0 ? ` · ${nErr} fallaron` : ''} — revisá la galería 🎬</>
            : <>Podés cerrar la pestaña, sigue solo{nErr > 0 ? ` · ${nErr} con error` : ''}</>}
        </p>
      </div>
    </div>
  );
}
