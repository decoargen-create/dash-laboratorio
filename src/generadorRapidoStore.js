// Generador rápido de ideas — ejecución en SEGUNDO PLANO.
//
// Antes el loop de generación vivía dentro de GeneradorRapido.jsx (el async
// `generar()` + AbortController + state local). Al navegar a otra sección el
// componente se desmontaba, React cortaba el fetch SSE y la corrida moría.
//
// Ahora, igual que Inspiración (bandejaBulkGenerate.js + executionsStore.js),
// el trabajo vive en este módulo suelto:
//   - Reporta progreso al executionsStore global → el ExecutionsTray (montado
//     en App.jsx) muestra la barra desde CUALQUIER parte de la página.
//   - Mantiene un live store propio (subscribeGenerador) para que la card
//     inline de GeneradorRapido siga mostrando las ideas en vivo cuando estás
//     parado en esa pantalla.
//   - El AbortController vive acá (no en un useRef), así se puede cancelar
//     desde la card inline aunque el componente se haya remontado.

import { addGeneratedIdeas, loadIdeas, formatoDeAd } from './bandejaStore.js';
import { logCostsFromResponse } from './costsStore.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';

const CHUNK = 8;

// Costo estimado por idea (Claude generando briefs). Aproximado para el
// pre-cálculo del tray; el costo real lo loguea logCostsFromResponse.
const COSTO_POR_IDEA = 0.02;

// ---- Live store (para la card inline) -------------------------------------

let _state = null;
let _ctrl = null;
const listeners = new Set();

function emit() {
  listeners.forEach(fn => {
    try { fn(_state); } catch {}
  });
}

function patch(p) {
  if (!_state) return;
  _state = { ..._state, ...(typeof p === 'function' ? p(_state) : p) };
  emit();
}

export function subscribeGenerador(fn) {
  listeners.add(fn);
  try { fn(_state); } catch {}
  return () => listeners.delete(fn);
}

export function getGenerador() {
  return _state;
}

export function isGeneradorRunning(productoId) {
  if (!_state || _state.status !== 'running') return false;
  if (productoId == null) return true;
  return String(_state.productoId) === String(productoId);
}

export function cancelGenerador() {
  _ctrl?.abort();
}

// ---- Loop de generación ----------------------------------------------------

// Dispara la generación. Devuelve inmediatamente si ya hay una corriendo.
// La corrida sobrevive a desmontajes del componente: el fetch SSE y el
// reporte de progreso viven acá, no en React.
export async function runGeneradorRapido({ producto, formato, cantidad, formatoMix, contextoTematico = '', addToast, onDone }) {
  if (_state?.status === 'running') {
    addToast?.({ type: 'info', message: 'Ya hay una generación de ideas en curso.' });
    return;
  }
  if (!producto?.id) {
    addToast?.({ type: 'error', message: 'Falta el producto.' });
    return;
  }

  const ctrl = new AbortController();
  _ctrl = ctrl;
  const totalTandas = Math.ceil(cantidad / CHUNK);
  const tema = String(contextoTematico || '').trim();
  // Un id de bloque por corrida temática: agrupa todas las ideas de ESTA
  // generación bajo el mismo tema (ej. "día del padre"), para mostrarlas como
  // un bloque con su título + contador de usadas en Creativos.
  const bloqueId = tema ? `bloque_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : null;

  _state = {
    productoId: producto.id,
    productoNombre: producto.nombre || '',
    formato,
    cantidad,
    contextoTematico: tema,
    startedAt: Date.now(),
    tanda: { actual: 0, total: totalTandas },
    liveIdeas: [],
    insertadas: 0,
    error: null,
    status: 'running',
  };
  emit();

  const execId = startExecution({
    label: tema
      ? `Ideas temáticas · ${cantidad} · "${tema.slice(0, 40)}"`
      : `Generador rápido · ${cantidad} ideas`,
    sublabel: `${producto.nombre || 'producto'} · podés cambiar de sección`,
    kind: 'generador-rapido',
    estimatedMs: cantidad * 25000,
    estimatedCost: cantidad * COSTO_POR_IDEA,
  });

  let totalInsertadas = 0;
  let totalGeneradas = 0;
  let costoUSD = 0;

  try {
    // Contexto desde lo ya guardado — sin scrape ni deep-analyze.
    const competidores = producto?.competidores || [];
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
    const mix = formatoMix || { static: 1, video: 0 };

    for (let t = 0; t < totalTandas; t++) {
      const chunkTarget = Math.min(CHUNK, cantidad - t * CHUNK);
      patch({ tanda: { actual: t + 1, total: totalTandas } });
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
          formatoMix: mix,
          contextoTematico: tema,
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
              const nuevas = addGeneratedIdeas([ev.idea], { producto });
              if (nuevas.length > 0) totalInsertadas++;
              const insertadasNow = totalInsertadas;
              patch(s => ({
                liveIdeas: [
                  { titulo: ev.idea.titulo, tipo: ev.idea.tipo, formato: ev.idea.formato },
                  ...s.liveIdeas,
                ],
                insertadas: insertadasNow,
              }));
              // Progreso real para la barra del tray: ideas generadas / total.
              updateExecution(execId, {
                progress: Math.min(99, Math.round((totalGeneradas / cantidad) * 100)),
                stage: `${totalGeneradas}/${cantidad} ideas · ${insertadasNow} en Bandeja`,
              });
            } else if (ev.type === 'complete') {
              const costo = logCostsFromResponse(ev, `generador rápido · ${producto?.nombre || ''}`);
              costoUSD += costo?.total || 0;
            } else if (ev.type === 'error') {
              streamErr = new Error(ev.error || 'Error del generador');
            }
          } catch { /* línea SSE parcial — se completa en el próximo chunk */ }
        }
      }
      if (streamErr) throw streamErr;
    }

    patch({ status: 'done' });
    finishExecution(execId, {
      ok: true,
      message: totalInsertadas > 0
        ? `${totalInsertadas} ideas nuevas en la Bandeja`
        : 'Sin ideas nuevas — probá otro formato o más cantidad',
      cost: costoUSD,
    });
    if (totalInsertadas > 0) {
      addToast?.({ type: 'success', message: `${totalInsertadas} ideas nuevas en la Bandeja` });
    } else {
      addToast?.({ type: 'info', message: 'El generador no encontró ideas nuevas — probá con otro formato o más cantidad.' });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      patch({ status: 'cancelled' });
      finishExecution(execId, {
        ok: true,
        message: totalInsertadas > 0
          ? `Cancelado — ${totalInsertadas} ideas quedaron en la Bandeja`
          : 'Generación cancelada',
        cost: costoUSD,
      });
      addToast?.({ type: 'info', message: `Generación cancelada${totalInsertadas > 0 ? ` — ${totalInsertadas} ideas quedaron en la Bandeja` : ''}` });
    } else {
      patch({ status: 'error', error: err.message || 'Error desconocido' });
      finishExecution(execId, { ok: false, message: err.message || 'Error desconocido', cost: costoUSD });
      addToast?.({ type: 'error', message: `Generador rápido: ${err.message}` });
    }
  } finally {
    _ctrl = null;
    // Refrescamos la Bandeja si se insertó algo — incluso si una tanda falló
    // o se canceló, las ideas ya generadas quedaron guardadas.
    if (totalInsertadas > 0) onDone?.();
    // Limpiamos el live store 6s después para que la card inline alcance a
    // mostrar el estado final. El tray tiene su propio auto-dismiss.
    const myStart = _state?.startedAt;
    setTimeout(() => {
      if (_state && _state.startedAt === myStart && _state.status !== 'running') {
        _state = null;
        emit();
      }
    }, 6000);
  }
}
