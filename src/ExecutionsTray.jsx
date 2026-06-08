// Tray flotante abajo a la derecha con todas las ejecuciones en curso.
// Se mounta una vez en App.jsx y se suscribe al store global.
//
// UX:
// - Card por cada ejecución running/done/error.
// - Header colapsable con conteo.
// - Cards done auto-dismiss en 3s; error en 12s (o click manual).
// - Si está vacío, no renderiza nada (no ocupa espacio).

import React, { useEffect, useState } from 'react';
import { Loader2, Check, AlertCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { subscribeExecutions, estimateProgress, dismissExecution } from './executionsStore.js';

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function iconForKind(kind, status) {
  if (status === 'done') return <Check size={14} className="text-emerald-500" />;
  if (status === 'error') return <AlertCircle size={14} className="text-red-500" />;
  return <Loader2 size={14} className="text-brand-500 animate-spin" />;
}

export default function ExecutionsTray() {
  const [execs, setExecs] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => subscribeExecutions(setExecs), []);

  // Re-render cada 250ms mientras haya algo running, para que la barra
  // de progreso y el elapsed se actualicen suaves.
  useEffect(() => {
    const hasRunning = execs.some(e => e.status === 'running');
    if (!hasRunning) return;
    const t = setInterval(() => setTick(x => x + 1), 250);
    return () => clearInterval(t);
  }, [execs]);

  if (execs.length === 0) return null;

  const running = execs.filter(e => e.status === 'running').length;
  const errored = execs.filter(e => e.status === 'error').length;

  return (
    <div className="fixed bottom-4 right-4 z-[55] w-[340px] max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 border-2 border-brand-300 dark:border-brand-800 rounded-xl shadow-2xl overflow-hidden">
      {/* Header — siempre visible. Click colapsa/expande. */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
      >
        <div className="flex items-center gap-1.5">
          {running > 0
            ? <Loader2 size={12} className="text-brand-500 animate-spin" />
            : errored > 0
              ? <AlertCircle size={12} className="text-red-500" />
              : <Check size={12} className="text-emerald-500" />
          }
          <p className="text-[11px] font-bold text-gray-900 dark:text-gray-100">
            {running > 0
              ? `${running} ${running === 1 ? 'tarea en curso' : 'tareas en curso'}`
              : errored > 0
                ? `${errored} con error`
                : 'Listo'
            }
          </p>
        </div>
        {execs.length > running && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            · {execs.length - running} {execs.length - running === 1 ? 'reciente' : 'recientes'}
          </span>
        )}
        <span className="ml-auto">
          {collapsed ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
        </span>
      </button>

      {!collapsed && (
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
          {execs.map(e => (
            <ExecutionCard key={e.id} exec={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutionCard({ exec }) {
  const elapsed = Date.now() - exec.startedAt;
  const pct = estimateProgress(exec);
  const isDone = exec.status === 'done';
  const isError = exec.status === 'error';
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">{iconForKind(exec.kind, exec.status)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-gray-900 dark:text-gray-100 truncate">
            {exec.label}
          </p>
          {(exec.sublabel || exec.stage) && (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
              {exec.stage || exec.sublabel}
            </p>
          )}
          {isError && exec.message && (
            <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 line-clamp-2">{exec.message}</p>
          )}
          {isDone && exec.message && (
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 line-clamp-2">{exec.message}</p>
          )}
        </div>
        <button
          onClick={() => dismissExecution(exec.id)}
          className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition shrink-0"
          title="Cerrar"
        >
          <X size={11} />
        </button>
      </div>

      {/* Barra de progreso — siempre visible para running; full o vacía para done/error. */}
      <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-1.5">
        <div
          className={`h-full transition-all duration-500 ${
            isDone ? 'bg-emerald-500'
            : isError ? 'bg-red-500'
            : 'bg-gradient-to-r from-brand-500 to-brand-400'
          }`}
          style={{ width: `${isError ? (exec.progress ?? 100) : pct}%` }}
        />
      </div>
      <p className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">
        {fmtElapsed(elapsed)}{exec.status === 'running' && exec.estimatedMs ? ` / ~${fmtElapsed(exec.estimatedMs)}` : ''}
      </p>
    </div>
  );
}
