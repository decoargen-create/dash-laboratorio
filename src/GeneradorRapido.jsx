// Generador rápido de ideas — on-demand, sin correr el pipeline completo.
//
// Toma el contexto YA guardado del producto (research/avatar/offer brief +
// competidores scrapeados + sus análisis profundos) y le pide ideas al
// generador. No scrapea ni hace deep-analyze: por eso termina en minutos
// en vez de la media hora del pipeline completo.

import React, { useState, useEffect } from 'react';
import { Sparkles, Image as ImageIcon, Video, Layers, Check, X, AlertCircle } from 'lucide-react';
import { TIPO_META } from './bandejaStore.js';
import { runGeneradorRapido, cancelGenerador, subscribeGenerador } from './generadorRapidoStore.js';

// Traduce errores técnicos a algo accionable para el user.
function errorAmigable(msg) {
  const m = (msg || '').toLowerCase();
  if (/credit|balance|billing|quota|insufficient/.test(m)) {
    return `Parece que falta crédito en Anthropic. Cargá saldo en console.anthropic.com y reintentá.\n\nDetalle: ${msg}`;
  }
  if (/401|authentication|api[_ ]?key|invalid x-api/.test(m)) {
    return `La API key de Anthropic no es válida o no está configurada en el servidor.\n\nDetalle: ${msg}`;
  }
  if (/429|rate limit|rate_limit/.test(m)) {
    return 'Demasiadas solicitudes juntas (rate limit de Anthropic). Esperá un minuto y reintentá.';
  }
  if (/overloaded|529/.test(m)) {
    return 'Los servidores de Anthropic están sobrecargados. Reintentá en un minuto.';
  }
  if (/timeout|truncad|aborted/.test(m)) {
    return `La generación se cortó por tiempo. Probá con menos cantidad (8).\n\nDetalle: ${msg}`;
  }
  return msg;
}

// El endpoint espera formatoMix como FRACCIÓN (0-1), igual que el pipeline.
const FORMATO_OPCIONES = [
  { id: 'static', label: 'Estáticos', icon: ImageIcon, mix: { static: 1, video: 0 } },
  { id: 'mix',    label: 'Mix',       icon: Layers,    mix: { static: 0.6, video: 0.4 } },
  { id: 'video',  label: 'Video',     icon: Video,     mix: { static: 0, video: 1 } },
];
const CANTIDADES = [8, 16, 24];

const FORMATO_EMOJI = { static: '🖼️', video: '🎬', carrusel: '🎠' };

function fmtTiempo(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function GeneradorRapido({ producto, addToast, onDone }) {
  const [formato, setFormato] = useState('static');
  const [cantidad, setCantidad] = useState(16);
  // Estado de la corrida — vive en el store global (sobrevive cambios de
  // sección). Acá solo nos suscribimos y reflejamos lo que sea de ESTE producto.
  const [job, setJob] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  // Nos suscribimos al store global. Solo nos importa la corrida si es de
  // este producto — si corre otra cosa, mostramos los controles idle igual.
  useEffect(() => subscribeGenerador(s => {
    setJob(s && String(s.productoId) === String(producto?.id) ? s : null);
  }), [producto?.id]);

  const running = job?.status === 'running';
  const liveIdeas = job?.liveIdeas || [];
  const insertadas = job?.insertadas || 0;
  const tanda = job?.tanda || { actual: 0, total: 0 };
  const error = job?.status === 'error' ? job.error : null;

  const competidores = producto?.competidores || [];
  const tieneResearch = !!(producto?.docs?.research || producto?.research);
  const numAnalisis = competidores.reduce((s, c) => s + Object.keys(c.adsAnalysis || {}).length, 0);
  // Fallback a adsTotal (metadata) post-refactor IDB — c.ads puede estar
  // vacío si compAdsByCompId aún no hidrató desde IDB.
  const numAds = competidores.reduce((s, c) => s + (c.adsTotal || c.ads?.length || 0), 0);

  // Cronómetro derivado del startedAt del store (no de un mount local), así
  // muestra el tiempo real aunque hayas navegado y vuelto.
  useEffect(() => {
    if (!running || !job?.startedAt) return;
    setElapsed(Math.floor((Date.now() - job.startedAt) / 1000));
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - job.startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [running, job?.startedAt]);

  const cancelar = () => cancelGenerador();

  const generar = () => {
    const formatoMix = FORMATO_OPCIONES.find(f => f.id === formato)?.mix || { static: 1, video: 0 };
    runGeneradorRapido({ producto, formato, cantidad, formatoMix, addToast, onDone });
  };

  // Mientras corre, la cantidad de referencia es la del job (el selector local
  // puede haber cambiado). Idle: la del selector.
  const cantidadActiva = running ? (job?.cantidad || cantidad) : cantidad;
  const pct = cantidadActiva > 0 ? Math.min(100, Math.round((liveIdeas.length / cantidadActiva) * 100)) : 0;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Generador rápido de ideas</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Genera ideas con el research y la competencia ya cargados — sin re-scrapear.
          </p>
        </div>
      </div>

      {!running && error && (
        <div className="mb-3 px-3 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-xs font-bold text-red-700 dark:text-red-300 flex items-center gap-1.5">
            <AlertCircle size={13} /> No se pudieron generar ideas
          </p>
          <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 whitespace-pre-wrap break-words">
            {errorAmigable(error)}
          </p>
        </div>
      )}

      {!running && (
        <>
          {/* Qué contexto va a usar */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-[10px] text-gray-500 dark:text-gray-400">
            <span className={tieneResearch ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}>
              {tieneResearch ? '✓ Research cargado' : '○ Sin research (ideas más genéricas)'}
            </span>
            <span>· {competidores.length} competidores · {numAds} ads · {numAnalisis} análisis profundos</span>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Formato</p>
              <div className="flex gap-1">
                {FORMATO_OPCIONES.map(f => (
                  <button key={f.id} onClick={() => setFormato(f.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition ${
                      formato === f.id
                        ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
                        : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-700'
                    }`}>
                    <f.icon size={12} /> {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Cantidad</p>
              <div className="flex gap-1">
                {CANTIDADES.map(n => (
                  <button key={n} onClick={() => setCantidad(n)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition ${
                      cantidad === n
                        ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
                        : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-700'
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={generar}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-700 hover:to-brand-600 shadow-sm transition">
              <Sparkles size={14} /> Generar ideas
            </button>
          </div>
        </>
      )}

      {running && (
        <div className="space-y-3">
          {/* Barra de progreso */}
          <div>
            <div className="flex items-center justify-between mb-1.5 text-xs">
              <span className="font-bold text-gray-900 dark:text-gray-100">
                {liveIdeas.length > 0
                  ? `${liveIdeas.length} de ${cantidadActiva} ideas`
                  : 'Armando los briefs…'}
                {tanda.total > 1 && <span className="text-gray-400 font-normal"> · tanda {tanda.actual}/{tanda.total}</span>}
              </span>
              <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400 tabular-nums">
                <span>⏱ {fmtTiempo(elapsed)}</span>
                {insertadas > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-bold">
                    <Check size={11} /> {insertadas} en Bandeja
                  </span>
                )}
              </span>
            </div>
            <div className="h-2.5 bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r from-brand-500 to-brand-600 rounded-full transition-all duration-500 ${liveIdeas.length === 0 ? 'animate-pulse' : ''}`}
                style={{ width: `${liveIdeas.length === 0 ? 8 : pct}%` }}
              />
            </div>
            {liveIdeas.length === 0 && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                Claude está escribiendo el primer brief — la primera idea tarda ~20-40s.
              </p>
            )}
          </div>

          {/* Ideas generadas en vivo */}
          {liveIdeas.length > 0 && (
            <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {liveIdeas.slice(0, 8).map((idea, i) => (
                <div key={liveIdeas.length - i} className="flex items-center gap-2 text-[11px] py-1 px-2 bg-gray-50 dark:bg-gray-900/60 rounded-md animate-fade-in">
                  <span className="shrink-0">{FORMATO_EMOJI[idea.formato] || '🖼️'}</span>
                  <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-200 font-medium">{idea.titulo || 'Idea sin título'}</span>
                  <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                    {TIPO_META[idea.tipo]?.label || idea.tipo}
                  </span>
                </div>
              ))}
              {liveIdeas.length > 8 && (
                <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center pt-0.5">
                  + {liveIdeas.length - 8} más arriba
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2.5">
            <button onClick={cancelar}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition">
              <X size={12} /> Cancelar
            </button>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              Podés cambiar de sección — sigue corriendo en segundo plano.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
