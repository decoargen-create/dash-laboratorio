// Overlay flotante que muestra el progreso del pipeline desde cualquier
// sección. Se monta en App una vez y observa el PipelineRunContext.
//
// Estados visuales:
//   - oculto: no hay corrida (running=false y nunca arrancó / hace > 30s
//     que terminó la última)
//   - pill: corrida activa o terminada hace poco. Muestra label corto +
//     progreso (X/Y pasos · NN%). Click → expande al panel detalle.
//   - panel: expandido con stepper completo + costo + botón cancelar
//     (si running) y "Cerrar"

import React, { useEffect, useState } from 'react';
import {
  Loader2, Check, AlertTriangle, X, Play, ChevronUp, ChevronDown,
} from 'lucide-react';
import { usePipelineRun } from './PipelineRunContext.jsx';

export default function PipelineRunOverlay() {
  const {
    running, steps, runCost, productoNombre, startedAt, endedAt,
    requestCancel, suppressOverlay,
  } = usePipelineRun();
  const [expanded, setExpanded] = useState(false);
  const [autoHidden, setAutoHidden] = useState(false);

  // Suppress: cuando Arranque está parado en tab Setup, ya muestra el
  // stepper inline detallado — el pill flotante sería redundante.
  if (suppressOverlay) return null;

  // Auto-ocultar el pill 30s después de que termine la corrida.
  useEffect(() => {
    if (running) {
      setAutoHidden(false);
      return undefined;
    }
    if (!endedAt) return undefined;
    const t = setTimeout(() => setAutoHidden(true), 30000);
    return () => clearTimeout(t);
  }, [running, endedAt]);

  // Si no hubo corrida nunca o ya pasaron > 30s del fin, no mostramos nada.
  if (steps.length === 0 || (!running && autoHidden)) return null;

  const stepsDone = steps.filter(s => s.status === 'done').length;
  const stepsError = steps.filter(s => s.status === 'error').length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((stepsDone / total) * 100) : 0;
  const elapsed = startedAt ? Math.floor(((endedAt || Date.now()) - startedAt) / 1000) : 0;
  const elapsedLabel = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;

  const currentStep = steps.find(s => s.status === 'running') || steps[steps.length - 1];

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-[400px]">
      {/* Pill colapsado */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className={`flex items-center gap-3 px-4 py-3 rounded-full shadow-lg border transition group ${
            running
              ? 'bg-gradient-to-r from-purple-600 to-violet-600 border-purple-500 text-white hover:scale-105'
              : stepsError > 0
                ? 'bg-amber-50 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100'
                : 'bg-emerald-50 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100'
          }`}
        >
          {running ? <Loader2 size={16} className="animate-spin shrink-0" /> :
            stepsError > 0 ? <AlertTriangle size={16} className="shrink-0" /> :
            <Check size={16} className="shrink-0" />}
          <div className="flex flex-col items-start min-w-0">
            <span className="text-xs font-bold leading-tight truncate max-w-[280px]">
              {running ? `Corriendo: ${productoNombre}` : (stepsError > 0 ? 'Pipeline con errores' : '✓ Pipeline listo')}
            </span>
            <span className={`text-[10px] leading-tight ${running ? 'opacity-90' : 'opacity-70'}`}>
              {stepsDone}/{total} pasos · {pct}% · {elapsedLabel}
              {runCost.total > 0 && ` · 💰 $${runCost.total.toFixed(4)}`}
            </span>
          </div>
          <ChevronUp size={14} className="shrink-0 opacity-60 group-hover:opacity-100" />
        </button>
      )}

      {/* Panel expandido */}
      {expanded && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl w-[380px] max-h-[70vh] flex flex-col">
          <div className={`px-4 py-3 flex items-center gap-2 rounded-t-xl ${
            running
              ? 'bg-gradient-to-r from-purple-600 to-violet-600 text-white'
              : stepsError > 0
                ? 'bg-amber-50 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100'
                : 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-100'
          }`}>
            {running ? <Loader2 size={16} className="animate-spin" /> :
              stepsError > 0 ? <AlertTriangle size={16} /> : <Check size={16} />}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate">
                {running ? `Corriendo · ${productoNombre}` : (stepsError > 0 ? 'Pipeline con errores' : '✓ Pipeline finalizado')}
              </p>
              <p className="text-[10px] opacity-80">
                {stepsDone}/{total} · {pct}% · {elapsedLabel}
              </p>
            </div>
            <button onClick={() => setExpanded(false)}
              className="p-1 rounded hover:bg-black/10 transition"
              title="Minimizar">
              <ChevronDown size={14} />
            </button>
            {!running && (
              <button onClick={() => setAutoHidden(true)}
                className="p-1 rounded hover:bg-black/10 transition"
                title="Cerrar">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Barra de progreso */}
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700">
            <div className="h-full bg-gradient-to-r from-purple-500 to-violet-500 transition-all duration-500"
              style={{ width: `${pct}%` }} />
          </div>

          {/* Costo en vivo */}
          {runCost.total > 0 && (
            <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 text-[10px] font-mono flex flex-wrap gap-1.5">
              <span className="text-purple-600 dark:text-purple-400 font-bold">💰 ${runCost.total.toFixed(4)}</span>
              {runCost.anthropic > 0 && <span className="text-violet-600 dark:text-violet-400">🧠 ${runCost.anthropic.toFixed(4)}</span>}
              {runCost.openai > 0 && <span className="text-emerald-600 dark:text-emerald-400">🎤 ${runCost.openai.toFixed(4)}</span>}
              {runCost.apify > 0 && <span className="text-amber-600 dark:text-amber-400">🔍 ${runCost.apify.toFixed(4)}</span>}
            </div>
          )}

          {/* Lista de steps scrolleable */}
          <ul className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {steps.map(step => {
              const icon = step.status === 'done' ? '✓' :
                step.status === 'error' ? '✗' :
                step.status === 'running' ? '⏳' : '○';
              const colorCls = step.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' :
                step.status === 'error' ? 'text-red-600 dark:text-red-400' :
                step.status === 'running' ? 'text-purple-600 dark:text-purple-400 font-semibold' :
                'text-gray-400 dark:text-gray-500';
              return (
                <li key={step.id} className="flex items-start gap-2 text-[11px]">
                  <span className={`shrink-0 w-4 text-center ${colorCls}`}>{icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={colorCls + ' truncate'} title={step.label}>{step.label}</p>
                    {step.detail && (
                      <p className="text-[9px] text-gray-500 dark:text-gray-400 truncate" title={step.detail}>
                        {step.detail}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Footer con cancelar */}
          {running && (
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={requestCancel}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition">
                <X size={12} /> Cancelar pipeline
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
