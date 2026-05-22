// Generador rápido de ideas — on-demand, sin correr el pipeline completo.
//
// Toma el contexto YA guardado del producto (research/avatar/offer brief +
// competidores scrapeados + sus análisis profundos) y le pide ideas al
// generador. No scrapea ni hace deep-analyze: por eso termina en minutos
// en vez de la media hora del pipeline completo.
//
// Pensado como la forma principal de pedir ideas; el pipeline completo
// queda para cuando se quiere refrescar la data de la competencia.

import React, { useState } from 'react';
import { Sparkles, Loader2, Image as ImageIcon, Video, Layers, Check } from 'lucide-react';
import { addGeneratedIdeas, loadIdeas, formatoDeAd } from './bandejaStore.js';
import { logCostsFromResponse } from './costsStore.js';

const FORMATO_OPCIONES = [
  { id: 'static', label: 'Estáticos', icon: ImageIcon, mix: { static: 100, video: 0 } },
  { id: 'mix',    label: 'Mix',       icon: Layers,    mix: { static: 60, video: 40 } },
  { id: 'video',  label: 'Video',     icon: Video,     mix: { static: 0, video: 100 } },
];
const CANTIDADES = [8, 16, 24];
const CHUNK = 8;

export default function GeneradorRapido({ producto, addToast, onDone }) {
  const [formato, setFormato] = useState('static');
  const [cantidad, setCantidad] = useState(16);
  const [running, setRunning] = useState(false);
  const [progreso, setProgreso] = useState('');
  const [insertadas, setInsertadas] = useState(0);

  const competidores = producto?.competidores || [];
  const tieneResearch = !!(producto?.docs?.research || producto?.research);
  const numAnalisis = competidores.reduce((s, c) => s + Object.keys(c.adsAnalysis || {}).length, 0);
  const numAds = competidores.reduce((s, c) => s + (c.ads?.length || 0), 0);

  const generar = async () => {
    setRunning(true);
    setInsertadas(0);
    setProgreso('Preparando contexto…');
    let totalInsertadas = 0;
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
      const formatoMix = FORMATO_OPCIONES.find(f => f.id === formato)?.mix || { static: 100, video: 0 };
      const totalTandas = Math.ceil(cantidad / CHUNK);

      for (let t = 0; t < totalTandas; t++) {
        const chunkTarget = Math.min(CHUNK, cantidad - t * CHUNK);
        setProgreso(`Tanda ${t + 1}/${totalTandas} · generando…`);
        // ideasExistentes fresco — incluye lo insertado en tandas previas
        // para que el generador no repita.
        const ideasExist = loadIdeas()
          .filter(i => String(i.productoId || '') === String(producto.id))
          .map(i => ({ titulo: i.titulo, angulo: i.angulo, tipo: i.tipo, hook: i.hook || '', estado: i.estado || 'pendiente' }));

        const resp = await fetch('/api/marketing/generate-ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
                const nuevas = addGeneratedIdeas([ev.idea], { producto });
                if (nuevas.length > 0) {
                  totalInsertadas++;
                  setInsertadas(totalInsertadas);
                  setProgreso(`Tanda ${t + 1}/${totalTandas} · ${totalInsertadas} ideas…`);
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
        onDone?.();
      } else {
        addToast?.({ type: 'info', message: 'El generador no encontró ideas nuevas — probá con otro formato o más cantidad.' });
      }
    } catch (err) {
      addToast?.({ type: 'error', message: `Generador rápido: ${err.message}` });
    } finally {
      setRunning(false);
      setProgreso('');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Generador rápido de ideas</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Genera ideas con el research y la competencia ya cargados — sin re-scrapear. Termina en minutos.
          </p>
        </div>
      </div>

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
              <button key={f.id} onClick={() => setFormato(f.id)} disabled={running}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition disabled:opacity-50 ${
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
              <button key={n} onClick={() => setCantidad(n)} disabled={running}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition disabled:opacity-50 ${
                  cantidad === n
                    ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-700'
                }`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <button onClick={generar} disabled={running}
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-gradient-to-br from-brand-600 to-brand-500 rounded-lg hover:from-brand-700 hover:to-brand-600 shadow-sm transition disabled:opacity-50">
          {running
            ? <><Loader2 size={14} className="animate-spin" /> {progreso || 'Generando…'}</>
            : <><Sparkles size={14} /> Generar ideas</>}
        </button>

        {running && insertadas > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <Check size={13} /> {insertadas} en la Bandeja
          </span>
        )}
      </div>
    </div>
  );
}
