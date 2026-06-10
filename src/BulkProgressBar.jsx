// Barra flotante de progreso de un bulk-gen — muestra ad actual, % total,
// ETA estimado y un pill por cada ad para ver qué está done/doing/pending/
// error de un vistazo.
//
// Extraída de InspiracionSection a su propio archivo para que el lazy-load
// de InspiracionSection no traiga este componente al main chunk (lo usa
// BulkProgressBarGlobal que sí está en el chunk principal).

import React from 'react';
import { Check, Loader2, X } from 'lucide-react';

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function BulkProgressBar({ state, onClose }) {
  if (!state) return null;
  const { total, completed, currentIdx, current, startedAt, adsList, errors, adDurations } = state;
  const elapsedMs = Date.now() - startedAt;
  const avgMs = adDurations.length > 0
    ? adDurations.reduce((a, b) => a + b, 0) / adDurations.length
    : 45000;
  const remainingMs = Math.max(0, (total - completed) * avgMs);
  const pct = Math.round((completed / total) * 100);
  const isDone = completed === total;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 border-2 border-brand-400 dark:border-brand-700 rounded-xl shadow-2xl w-[420px] max-w-[calc(100vw-3rem)] overflow-hidden">
      <div className="p-3.5">
        <div className="flex items-center gap-2 mb-2">
          {isDone
            ? <Check size={16} className="text-emerald-500" />
            : <Loader2 size={14} className="text-brand-500 animate-spin" />
          }
          <p className="text-xs font-bold text-gray-900 dark:text-gray-100 flex-1 truncate">
            {isDone
              ? `Completo · ${completed - errors.length}/${total} OK${errors.length > 0 ? ` · ${errors.length} fallaron` : ''}`
              : `Generando ${currentIdx + 1} de ${total}`
            }
          </p>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Cerrar">
            <X size={14} />
          </button>
        </div>

        {!isDone && current && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate mb-2">
            <span className="font-semibold text-brand-600 dark:text-brand-400">{current.brandNombre}</span>
            {current.adHeadline && <span> · {current.adHeadline}</span>}
          </p>
        )}

        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-1">
          <div
            className={`h-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-500 to-brand-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
          <span>{pct}% · transcurrido {formatMs(elapsedMs)}</span>
          {!isDone && <span>ETA {formatMs(remainingMs)}</span>}
        </div>

        <div className="flex flex-wrap gap-1 mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-700">
          {adsList.map((x, i) => (
            <div
              key={x.adId + i}
              title={`${x.brandNombre} · ${x.status}`}
              className={`w-2.5 h-2.5 rounded-full ${
                x.status === 'done' ? 'bg-emerald-500'
                : x.status === 'error' ? 'bg-red-500'
                : x.status === 'doing' ? 'bg-brand-500 animate-pulse'
                : 'bg-gray-300 dark:bg-gray-600'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
