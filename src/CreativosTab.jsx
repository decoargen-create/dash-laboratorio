// Tab "Creativos" del workspace de un producto.
// Migración del módulo Creativos de Marketing.jsx — corre el endpoint
// /api/marketing/creatives action="hooks" y muestra el diagnóstico +
// hooks por ángulo + observaciones estratégicas.
//
// Vive embebido dentro del workspace de producto en Arranque.jsx.
//
// Props:
//   producto: el producto activo (con docs, competidores, etc.)
//   onUpdateProducto: callback para guardar resultados en el producto
//   addToast: para feedback al user

import React, { useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, Copy, Check } from 'lucide-react';
import { logCostsFromResponse } from './costsStore.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';

// ---- inner components moved before export (TDZ fix Vite/Rollup) ----

function HooksDisplay({ fase1, addToast }) {
  const { diagnostico, angulosElegidos = [], hooks = [], observaciones = [] } = fase1;
  const [copiedId, setCopiedId] = useState(null);

  const copy = (text, id) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    addToast?.({ type: 'success', message: 'Hook copiado' });
    setTimeout(() => setCopiedId(prev => prev === id ? null : prev), 1500);
  };

  return (
    <div className="space-y-4">
      {/* Diagnóstico */}
      {diagnostico && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">🔍 Diagnóstico</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {diagnostico.beneficios?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase mb-1">Beneficios reales</p>
                <ul className="list-disc list-inside space-y-0.5 text-gray-700 dark:text-gray-300">
                  {diagnostico.beneficios.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            )}
            {diagnostico.dolores?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-red-700 dark:text-red-400 uppercase mb-1">Dolores del avatar</p>
                <ul className="list-disc list-inside space-y-0.5 text-gray-700 dark:text-gray-300">
                  {diagnostico.dolores.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            {diagnostico.vaciosComunicacion?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase mb-1">Vacíos de comunicación</p>
                <ul className="list-disc list-inside space-y-0.5 text-gray-700 dark:text-gray-300">
                  {diagnostico.vaciosComunicacion.map((v, i) => <li key={i}>{v}</li>)}
                </ul>
              </div>
            )}
          </div>
          {diagnostico.tonoActual && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 italic mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <span className="font-semibold">Tono actual de la marca:</span> {diagnostico.tonoActual}
            </p>
          )}
        </div>
      )}

      {/* Hooks agrupados por ángulo elegido */}
      {hooks.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            🎣 Hooks ({hooks.length})
          </h4>
          {angulosElegidos.map(angulo => {
            const hooksDelAngulo = hooks.filter(h => h.angulo === angulo.id);
            if (hooksDelAngulo.length === 0) return null;
            return (
              <div key={angulo.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="px-2 py-0.5 text-[11px] font-bold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded">
                    {angulo.id}
                  </span>
                  <h5 className="text-sm font-bold text-gray-900 dark:text-gray-100">{angulo.nombre}</h5>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">· {hooksDelAngulo.length} hook{hooksDelAngulo.length > 1 ? 's' : ''}</span>
                </div>
                {angulo.porQueSirve && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 italic mb-3">{angulo.porQueSirve}</p>
                )}
                <ul className="space-y-1.5">
                  {hooksDelAngulo.map(h => (
                    <li key={h.id} className="group flex items-start gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-900/40 rounded-md hover:bg-brand-50 dark:hover:bg-brand-900/20 transition">
                      <span className="text-[10px] text-gray-400 font-mono shrink-0 mt-0.5">#{h.id}</span>
                      <p className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-snug">{h.texto}</p>
                      {h.riesgoMeta && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-400" title={h.motivoRiesgoMeta || 'Palabra gatillo Meta'}>
                          <AlertTriangle size={10} /> Meta
                        </span>
                      )}
                      <button
                        onClick={() => copy(h.texto, h.id)}
                        className="opacity-0 group-hover:opacity-100 transition shrink-0 p-1 text-gray-400 hover:text-brand-600"
                        title="Copiar hook"
                      >
                        {copiedId === h.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* Observaciones estratégicas */}
      {observaciones.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">📝 Observaciones estratégicas</h4>
          <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-300 list-disc list-inside">
            {observaciones.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}


export default function CreativosTab({ producto, onUpdateProducto, addToast }) {
  // Config del generador (defaults razonables para Argentina/cosmética)
  const [hooksTono, setHooksTono] = useState(
    producto?.creativos?.fase1?.config?.tono || 'argentino coloquial, directo'
  );
  const [hooksObjetivo, setHooksObjetivo] = useState(
    producto?.creativos?.fase1?.config?.objetivo || 'Mix'
  );
  const [hooksRestricciones, setHooksRestricciones] = useState(
    producto?.creativos?.fase1?.config?.restricciones || 'sin palabras gatillo, sin vulgaridad'
  );
  const [hooksRunning, setHooksRunning] = useState(false);

  const creativos = producto?.creativos || null;
  const yaTieneHooks = !!creativos?.fase1?.hooks?.length;

  const generarHooks = async () => {
    if (!producto?.nombre) {
      addToast?.({ type: 'error', message: 'No hay producto activo' });
      return;
    }
    setHooksRunning(true);
    // Loguea en el tray global de pipeline + en el ActivityBell.
    const execId = startExecution({
      label: `Generando hooks para ${producto.nombre}`,
      sublabel: `Tono: ${hooksTono} · Objetivo: ${hooksObjetivo}`,
      kind: 'creative',
      estimatedMs: 75000,
      estimatedCost: 0.04,
    });
    try {
      updateExecution(execId, { stage: 'Analizando research + competencia con Claude…' });
      const resp = await fetch('/api/marketing/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'hooks',
          producto: {
            // Mapeamos el shape del producto del nuevo Arranque al que
            // espera el endpoint legacy de Marketing.
            productoNombre: producto.nombre,
            productoUrl: producto.landingUrl,
            descripcion: producto.descripcion,
            resumenEjecutivo: producto.resumenEjecutivo,
            docs: producto.docs || {},
            competidores: producto.competidores || [],
            memoria: producto.memoria || { notas: [], aprendizajes: [] },
          },
          config: {
            tono: hooksTono,
            objetivo: hooksObjetivo,
            restricciones: hooksRestricciones,
          },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      logCostsFromResponse(data, `creativos/hooks · ${producto.nombre}`);

      const nuevosCreativos = {
        ...(creativos || {}),
        fase1: {
          diagnostico: data.diagnostico,
          angulosElegidos: data.angulosElegidos,
          hooks: data.hooks,
          observaciones: data.observaciones,
          generatedAt: data.generatedAt,
          config: { tono: hooksTono, objetivo: hooksObjetivo, restricciones: hooksRestricciones },
        },
      };
      onUpdateProducto?.({ creativos: nuevosCreativos });
      const msg = `${data.hooks?.length || 0} hooks generados`;
      addToast?.({ type: 'success', message: msg });
      finishExecution(execId, { ok: true, message: msg, cost: data?.cost?.anthropic || data?.cost?.openai || 0 });
    } catch (err) {
      addToast?.({ type: 'error', message: `Generador falló: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
    } finally {
      setHooksRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header thin Linear-style — una sola fila con título + última corrida + botón primario */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Sparkles size={16} className="text-brand-600 dark:text-brand-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Generador de hooks</h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
              15-25 hooks categorizados por ángulo · basado en research + avatar + competidores
              {creativos?.fase1?.generatedAt && ` · último: ${new Date(creativos.fase1.generatedAt).toLocaleDateString('es-AR')}`}
            </p>
          </div>
        </div>
        <button
          onClick={generarHooks}
          disabled={hooksRunning}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-700 hover:to-brand-600 shadow-sm transition disabled:opacity-40 shrink-0"
        >
          {hooksRunning
            ? <><Loader2 size={12} className="animate-spin" /> Generando…</>
            : <><Sparkles size={12} /> {yaTieneHooks ? 'Regenerar' : 'Generar hooks'}</>
          }
        </button>
      </div>

      {/* Toolbar de config — todo en una línea (Stripe-style) */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase shrink-0">Tono</span>
          <input
            type="text"
            value={hooksTono}
            onChange={e => setHooksTono(e.target.value)}
            placeholder="argentino coloquial, directo"
            className="flex-1 px-2 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase">Objetivo</span>
          <select
            value={hooksObjetivo}
            onChange={e => setHooksObjetivo(e.target.value)}
            className="px-2 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
          >
            <option value="TOFU">TOFU</option>
            <option value="MOFU">MOFU</option>
            <option value="BOFU">BOFU</option>
            <option value="Retargeting">Retargeting</option>
            <option value="Mix">Mix</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase shrink-0">Restricciones</span>
          <input
            type="text"
            value={hooksRestricciones}
            onChange={e => setHooksRestricciones(e.target.value)}
            placeholder="sin palabras gatillo, sin vulgaridad"
            className="flex-1 px-2 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* Placeholder del display de hooks (viene en Parte 8.5.3) */}
      {!yaTieneHooks && !hooksRunning && (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Sin hooks generados todavía</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            Click en "Generar hooks" arriba — tarda ~60-90 segundos.
          </p>
        </div>
      )}

      {yaTieneHooks && <HooksDisplay fase1={creativos.fase1} addToast={addToast} />}
    </div>
  );
}

// Display de los resultados de la Fase 1: diagnóstico (beneficios, dolores,
// vacíos), hooks agrupados por ángulo, observaciones estratégicas.
