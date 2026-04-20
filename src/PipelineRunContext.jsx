// Context global del pipeline runner — sobrevive al cambio de sección.
//
// Cuando el user dispara una corrida desde Arranque, el state vive acá.
// Así puede navegar a Bandeja / Meta Ads / Inspiración mientras corre,
// y un overlay flotante muestra el progreso desde cualquier lado.
//
// Shape del state:
//   running: bool
//   productoId / productoNombre: a quién pertenece la corrida actual
//   steps: [{ id, label, detail, status: 'pending'|'running'|'done'|'error' }]
//   liveIdeas: ideas cayendo en vivo durante el step generate
//   runCost: { anthropic, openai, apify, meta, total }
//   cancelRequested: bool (signaling para que el ejecutor cancele)
//   startedAt / endedAt: timestamps
//
// El runner real vive donde estaba (Arranque), pero llama a las funciones
// expuestas por este context para actualizar el state global.

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const PipelineRunContext = createContext(null);

const EMPTY_COST = { anthropic: 0, openai: 0, apify: 0, meta: 0, total: 0 };

export function PipelineRunProvider({ children }) {
  const [running, setRunning] = useState(false);
  const [productoId, setProductoId] = useState(null);
  const [productoNombre, setProductoNombre] = useState('');
  const [steps, setSteps] = useState([]);
  const [liveIdeas, setLiveIdeas] = useState([]);
  const [runCost, setRunCost] = useState(EMPTY_COST);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [endedAt, setEndedAt] = useState(null);

  // Iniciar una corrida — limpia el state previo y marca running=true.
  const startRun = useCallback(({ productoId, productoNombre }) => {
    setRunning(true);
    setCancelRequested(false);
    setProductoId(productoId);
    setProductoNombre(productoNombre);
    setSteps([]);
    setLiveIdeas([]);
    setRunCost(EMPTY_COST);
    setStartedAt(Date.now());
    setEndedAt(null);
  }, []);

  // Terminar la corrida — running=false, marca endedAt.
  const finishRun = useCallback(() => {
    setRunning(false);
    setEndedAt(Date.now());
  }, []);

  // Solicitar cancelación — el runner real consulta cancelRequested y para.
  const requestCancel = useCallback(() => {
    setCancelRequested(true);
  }, []);

  // Actualizar un step específico (por id).
  const updateStep = useCallback((id, patch) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }, []);

  const value = useMemo(() => ({
    running, productoId, productoNombre, steps, liveIdeas, runCost,
    cancelRequested, startedAt, endedAt,
    startRun, finishRun, requestCancel,
    setSteps, setLiveIdeas, setRunCost, updateStep,
  }), [
    running, productoId, productoNombre, steps, liveIdeas, runCost,
    cancelRequested, startedAt, endedAt,
    startRun, finishRun, requestCancel, updateStep,
  ]);

  return (
    <PipelineRunContext.Provider value={value}>
      {children}
    </PipelineRunContext.Provider>
  );
}

// Hook para consumir el context. Tira si se usa fuera del provider.
export function usePipelineRun() {
  const ctx = useContext(PipelineRunContext);
  if (!ctx) {
    // Permitimos usar fuera del provider devolviendo un no-op para que
    // los componentes existentes no rompan si todavía no migraron.
    return {
      running: false,
      productoId: null,
      productoNombre: '',
      steps: [],
      liveIdeas: [],
      runCost: EMPTY_COST,
      cancelRequested: false,
      startedAt: null,
      endedAt: null,
      startRun: () => {},
      finishRun: () => {},
      requestCancel: () => {},
      setSteps: () => {},
      setLiveIdeas: () => {},
      setRunCost: () => {},
      updateStep: () => {},
    };
  }
  return ctx;
}
