// Generador rápido de ideas — on-demand, sin correr el pipeline completo.
//
// Toma el contexto YA guardado del producto (research/avatar/offer brief +
// competidores scrapeados + sus análisis profundos) y le pide ideas al
// generador. No scrapea ni hace deep-analyze: por eso termina en minutos
// en vez de la media hora del pipeline completo.

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Image as ImageIcon, Video, Layers, Check, X, AlertCircle } from 'lucide-react';
import { addGeneratedIdeas, loadIdeas, formatoDeAd, TIPO_META } from './bandejaStore.js';
import { logCostsFromResponse } from './costsStore.js';

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
const CHUNK = 8;

const FORMATO_EMOJI = { static: '🖼️', video: '🎬', carrusel: '🎠' };

function fmtTiempo(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function GeneradorRapido({ producto, addToast, onDone }) {
  const [formato, setFormato] = useState('static');
  const [cantidad, setCantidad] = useState(16);
  const [running, setRunning] = useState(false);
  const [insertadas, setInsertadas] = useState(0);
  const [liveIdeas, setLiveIdeas] = useState([]);
  const [tanda, setTanda] = useState({ actual: 0, total: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const competidores = producto?.competidores || [];
  const tieneResearch = !!(producto?.docs?.research || producto?.research);
  const numAnalisis = competidores.reduce((s, c) => s + Object.keys(c.adsAnalysis || {}).length, 0);
  const numAds = competidores.reduce((s, c) => s + (c.ads?.length || 0), 0);

  // Cronómetro mientras corre.
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    setElapsed(0);
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [running]);

  const cancelar = () => {
    abortRef.current?.abort();
  };

  const generar = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setRunning(true);
    setInsertadas(0);
    setLiveIdeas([]);
    setTanda({ actual: 0, total: Math.ceil(cantidad / CHUNK) });
    let totalInsertadas = 0;
    let totalGeneradas = 0;
    try {
      // Contexto desde lo ya guardado — sin scrape ni deep-analyze.
      const compAnalisis = [];
      const allCompAds = [];
      for (const c of competidores) {
        const analyses = c.adsAnalysis || {};
        for (const adId of Object.keys(analyses)) {
          const ad = (c.ads || []).find(x => x.id === adId);
          compAnalisis.push({
            competidorNombre: c.nombre, adId,
            adHeadline: ad?.headline || '', adBody: ad?.body || '',
            analysis: analyses[adId].analysis,
          });
        }
        for (const ad of (c.ads || [])) {
          allCompAds.push({
            competidor: c.nombre,
            body: (ad.body || '').slice(0, 300),
            headline: ad.headline || '',
            formato: formatoDeAd(ad),
            daysRunning: ad.daysRunning || 0,
            score: ad.score || 0,
            isWinner: !!ad.isWinner,
            winnerTier: ad.winnerTier || null,
            variantes: ad.variantes || 0,
          });
        }
      }
      const formatoMix = FORMATO_OPCIONES.find(f => f.id === formato)?.mix || { static: 1, video: 0 };
      const totalTandas = Math.ceil(cantidad / CHUNK);

      for (let t = 0; t < totalTandas; t++) {
        const chunkTarget = Math.min(CHUNK, cantidad - t * CHUNK);
        setTanda({ actual: t + 1, total: totalTandas });
        const ideasExist = loadIdeas()
          .filter(i => String(i.productoId || '') === String(producto.id))
          .map(i => ({ titulo: i.titulo, angulo: i.angulo, tipo: i.tipo, hook: i.hook || '', estado: i.estado || 'pendiente' }));

        const resp = await fetch('/api/marketing/generate-ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            producto,
            competidoresAnalisis: compAnalisis,
            allCompAds,
            ideasExistentes: ideasExist,
            propiosAds: [],
            targetCount: chunkTarget,
            formatoMix,
          }),
        });
        if (!resp.ok || !resp.body) {
          const txt = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}${txt ? ': ' + txt.slice(0, 120) : ''}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let streamErr = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload) continue;
            try {
              const ev = JSON.parse(payload);
              if (ev.type === 'idea' && ev.idea) {
                totalGeneradas++;
                setLiveIdeas(prev => [
                  { titulo: ev.idea.titulo, tipo: ev.idea.tipo, formato: ev.idea.formato },
                  ...prev,
                ]);
                const nuevas = addGeneratedIdeas([ev.idea], { producto });
                if (nuevas.length > 0) {
                  totalInsertadas++;
                  setInsertadas(totalInsertadas);
                }
              } else if (ev.type === 'complete') {
                logCostsFromResponse(ev, `generador rápido · ${producto?.nombre || ''}`);
              } else if (ev.type === 'error') {
                streamErr = new Error(ev.error || 'Error del generador');
              }
            } catch { /* línea SSE parcial — se completa en el próximo chunk */ }
          }
        }
        if (streamErr) throw streamErr;
      }

      if (totalInsertadas > 0) {
        addToast?.({ type: 'success', message: `${totalInsertadas} ideas nuevas en la Bandeja` });
      } else {
        addToast?.({ type: 'info', message: 'El generador no encontró ideas nuevas — probá con otro formato o más cantidad.' });
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        addToast?.({ type: 'info', message: `Generación cancelada${totalInsertadas > 0 ? ` — ${totalInsertadas} ideas quedaron en la Bandeja` : ''}` });
      } else {
        setError(err.message || 'Error desconocido');
        addToast?.({ type: 'error', message: `Generador rápido: ${err.message}` });
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      setTanda({ actual: 0, total: 0 });
      // Refrescamos la Bandeja si se insertó algo — incluso si una tanda
      // falló o se canceló, las ideas ya generadas quedaron guardadas.
      if (totalInsertadas > 0) onDone?.();
    }
  };

  const pct = cantidad > 0 ? Math.min(100, Math.round((liveIdeas.length / cantidad) * 100)) : 0;

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
                  ? `${liveIdeas.length} de ${cantidad} ideas`
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

          <button onClick={cancelar}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition">
            <X size={12} /> Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
