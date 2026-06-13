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

import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, AlertTriangle, Copy, Check, Image as ImageIcon, X, Inbox } from 'lucide-react';
import { logCostsFromResponse } from './costsStore.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';
import { runGeneradorRapido, cancelGenerador, subscribeGenerador } from './generadorRapidoStore.js';
import { TIPO_META } from './bandejaStore.js';
import CreativosBulkGenerator from './CreativosBulkGenerator.jsx';

// ---- inner components moved before export (TDZ fix Vite/Rollup) ----

const TEMATICO_CANTIDADES = [8, 16, 24];
const TEMATICO_EJEMPLOS = ['adaptado al Mundial', 'edición navideña', 'Día de la Madre', 'Hot Sale', 'vuelta al cole'];
const FORMATO_EMOJI = { static: '🖼️', video: '🎬', carrusel: '🎠' };

// Generador de ideas TEMÁTICAS para estáticos — el user da un contexto libre
// (ej. "adaptado al Mundial") y Claude genera ideas ambientadas en esa
// temática. Corren en segundo plano (mismo store que el Generador rápido:
// el progreso completo se ve en el ExecutionsTray global). Las ideas caen en
// la Bandeja; desde ahí se convierten en estáticos con el flujo existente.
function GeneradorTematico({ producto, addToast }) {
  const [contexto, setContexto] = useState('');
  const [cantidad, setCantidad] = useState(8);
  const [job, setJob] = useState(null);
  // Latcheamos el último error en estado local: el store limpia su estado a los
  // 6s, pero el error tiene que quedar VISIBLE hasta que el user reintente o lo
  // cierre (antes solo salía un toast efímero y "desaparecía rápido").
  const [lastError, setLastError] = useState(null);

  // Solo reflejamos la corrida si es de ESTE producto Y es temática (tiene
  // contextoTematico) — para no pisarnos con el Generador rápido de la Bandeja.
  useEffect(() => subscribeGenerador(s => {
    const mine = s && String(s.productoId) === String(producto?.id) && !!s.contextoTematico;
    setJob(mine ? s : null);
    if (mine && s.status === 'error' && s.error) setLastError(s.error);
  }), [producto?.id]);

  const running = job?.status === 'running';
  const liveIdeas = job?.liveIdeas || [];
  const insertadas = job?.insertadas || 0;
  const cantidadActiva = running ? (job?.cantidad || cantidad) : cantidad;
  const pct = cantidadActiva > 0 ? Math.min(100, Math.round((liveIdeas.length / cantidadActiva) * 100)) : 0;

  const generar = () => {
    setLastError(null);
    const tema = contexto.trim();
    if (!tema) {
      addToast?.({ type: 'info', message: 'Escribí un contexto temático (ej: "adaptado al Mundial").' });
      return;
    }
    if (!producto?.nombre) {
      addToast?.({ type: 'error', message: 'No hay producto activo.' });
      return;
    }
    runGeneradorRapido({
      producto,
      formato: 'static',
      cantidad,
      formatoMix: { static: 1, video: 0 },
      contextoTematico: tema,
      addToast,
    });
  };

  return (
    <div className="bg-gradient-to-br from-brand-50 to-amber-50 dark:from-brand-950/30 dark:to-amber-950/20 border border-brand-200 dark:border-brand-800 rounded-xl p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-amber-500 flex items-center justify-center text-white shrink-0">
          <ImageIcon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Estáticos temáticos por contexto</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Dale un contexto libre y genera ideas de estáticos ambientadas en esa temática — caen en la Bandeja, listas para convertir en imágenes.
          </p>
        </div>
      </div>

      {!running && (
        <>
          <div className="mb-2">
            <input
              type="text"
              value={contexto}
              onChange={e => setContexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') generar(); }}
              placeholder='Contexto temático — ej: "adaptado al Mundial"'
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {TEMATICO_EJEMPLOS.map(ej => (
                <button key={ej} onClick={() => setContexto(ej)}
                  className="px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300 bg-brand-100/60 dark:bg-brand-900/40 rounded-full hover:bg-brand-200 dark:hover:bg-brand-900/70 transition">
                  {ej}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Cantidad</p>
              <div className="flex gap-1">
                {TEMATICO_CANTIDADES.map(n => (
                  <button key={n} onClick={() => setCantidad(n)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition ${
                      cantidad === n
                        ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-700'
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={generar}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-amber-500 rounded-lg hover:from-brand-600 hover:to-amber-600 shadow-sm transition">
              <Sparkles size={14} /> Generar ideas temáticas
            </button>
          </div>
        </>
      )}

      {running && (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5 text-xs">
              <span className="font-bold text-gray-900 dark:text-gray-100">
                {liveIdeas.length > 0 ? `${liveIdeas.length} de ${cantidadActiva} ideas` : 'Armando los briefs…'}
                {job?.contextoTematico && <span className="text-gray-400 font-normal"> · "{job.contextoTematico.slice(0, 30)}"</span>}
              </span>
              {insertadas > 0 && (
                <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-bold tabular-nums">
                  <Check size={11} /> {insertadas} en Bandeja
                </span>
              )}
            </div>
            <div className="h-2.5 bg-white/70 dark:bg-gray-900 rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r from-brand-500 to-amber-500 rounded-full transition-all duration-500 ${liveIdeas.length === 0 ? 'animate-pulse' : ''}`}
                style={{ width: `${liveIdeas.length === 0 ? 8 : pct}%` }}
              />
            </div>
          </div>

          {liveIdeas.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {liveIdeas.slice(0, 8).map((idea, i) => (
                <div key={liveIdeas.length - i} className="flex items-center gap-2 text-[11px] py-1 px-2 bg-white/70 dark:bg-gray-900/60 rounded-md">
                  <span className="shrink-0">{FORMATO_EMOJI[idea.formato] || '🖼️'}</span>
                  <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-200 font-medium">{idea.titulo || 'Idea sin título'}</span>
                  <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                    {TIPO_META[idea.tipo]?.label || idea.tipo}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2.5">
            <button onClick={() => cancelGenerador()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition">
              <X size={12} /> Cancelar
            </button>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
              <Inbox size={11} /> Las ideas van a la Bandeja — podés cambiar de sección, sigue en segundo plano.
            </span>
          </div>
        </div>
      )}

      {/* Error persistente — NO se va solo (antes era un toast efímero que
          "desaparecía rápido" y no se podía leer). Queda hasta reintentar. */}
      {lastError && !running && (
        <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700 dark:text-red-300">No se pudieron generar las ideas</p>
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 break-words font-mono">{String(lastError)}</p>
            </div>
            <button onClick={() => setLastError(null)} className="text-red-400 hover:text-red-600 shrink-0" title="Cerrar">
              <X size={13} />
            </button>
          </div>
          <button onClick={generar}
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-md transition">
            <Sparkles size={11} /> Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

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
      {/* Generador de estáticos temáticos por contexto libre (ej. "adaptado al
          Mundial"). Genera ideas en la Bandeja, en segundo plano. */}
      <GeneradorTematico producto={producto} addToast={addToast} />

      {/* Generación masiva de estáticos desde las ideas del producto
          (multi-select + barra 1/2/4/6, estilo Inspiración). */}
      <CreativosBulkGenerator producto={producto} addToast={addToast} />

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
