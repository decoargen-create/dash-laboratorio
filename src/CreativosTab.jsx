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
    try {
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
      addToast?.({ type: 'success', message: `${data.hooks?.length || 0} hooks generados` });
    } catch (err) {
      addToast?.({ type: 'error', message: `Generador falló: ${err.message}` });
    } finally {
      setHooksRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Config + botón generar */}
      <div className="bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-purple-600 dark:text-purple-400" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Fase 1 — Hooks + diagnóstico</h3>
          <span className="ml-auto text-[10px] text-gray-500 dark:text-gray-400">Generador de creativos Meta Ads</span>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">
          Genera 15-25 hooks categorizados por ángulo (sarcasmo, insight, POV, autoridad, testimonio), basándose en el research + avatar + offer brief del producto + competidores + aprendizajes.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Tono</label>
            <input
              type="text"
              value={hooksTono}
              onChange={e => setHooksTono(e.target.value)}
              placeholder="argentino coloquial, directo"
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Objetivo</label>
            <select
              value={hooksObjetivo}
              onChange={e => setHooksObjetivo(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="TOFU">TOFU (prospecting)</option>
              <option value="MOFU">MOFU (consideración)</option>
              <option value="BOFU">BOFU (conversión)</option>
              <option value="Retargeting">Retargeting</option>
              <option value="Mix">Mix</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Restricciones</label>
            <input
              type="text"
              value={hooksRestricciones}
              onChange={e => setHooksRestricciones(e.target.value)}
              placeholder="sin palabras gatillo, sin vulgaridad"
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>
        <button
          onClick={generarHooks}
          disabled={hooksRunning}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-purple-600 to-violet-500 rounded-lg hover:from-purple-700 hover:to-violet-600 shadow-sm transition disabled:opacity-40"
        >
          {hooksRunning
            ? <><Loader2 size={14} className="animate-spin" /> Generando…</>
            : <><Sparkles size={14} /> {yaTieneHooks ? 'Regenerar hooks' : 'Generar hooks'}</>
          }
        </button>
        {creativos?.fase1?.generatedAt && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">
            Última generación: {new Date(creativos.fase1.generatedAt).toLocaleString('es-AR')}
          </p>
        )}
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
                  <span className="px-2 py-0.5 text-[11px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded">
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
                    <li key={h.id} className="group flex items-start gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-900/40 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 transition">
                      <span className="text-[10px] text-gray-400 font-mono shrink-0 mt-0.5">#{h.id}</span>
                      <p className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-snug">{h.texto}</p>
                      {h.riesgoMeta && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-400" title={h.motivoRiesgoMeta || 'Palabra gatillo Meta'}>
                          <AlertTriangle size={10} /> Meta
                        </span>
                      )}
                      <button
                        onClick={() => copy(h.texto, h.id)}
                        className="opacity-0 group-hover:opacity-100 transition shrink-0 p-1 text-gray-400 hover:text-purple-600"
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
