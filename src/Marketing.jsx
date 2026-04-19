// Plataforma "Marketing": generador de documentación profunda de producto
// para después armar creativos, copys y funnels.
//
// Pipeline actual: 4 pasos
//   1. Research Doc (~6 páginas)
//   2. Avatar Sheet
//   3. Offer Brief
//   4. Necessary Beliefs
//
// Próxima iteración: generador de Meta Ads Creatives (hooks + prompts IA + brief .docx).

import React, { useEffect, useState, useRef } from 'react';
import {
  FileText, Sparkles, Download, Loader2, Check, AlertTriangle, X,
  RefreshCw, Trash2, ChevronRight, Copy, Package, Plus, MessageSquare,
  Users, BookOpen, Clock, ExternalLink, ChevronDown, Target,
} from 'lucide-react';

const STORAGE_KEY = 'viora-marketing-productos-v1';

const STEPS = [
  {
    key: 'research',
    label: 'Research Doc',
    desc: 'Investigación profunda de 6+ páginas con demographics, attitudes, hopes & dreams, existing solutions, horror stories, curiosity y corruption angles.',
    bullets: [
      'Analizando la landing y extrayendo claims reales',
      'Mapeando demographics + attitudes del avatar',
      'Buscando hopes/dreams y victories/failures',
      'Identificando existing solutions y lo que el mercado le gusta/disgusta',
      'Armando horror stories y curiosity angles',
    ],
    etaSec: 180, // ~3 min
  },
  {
    key: 'avatar',
    label: 'Avatar Sheet',
    desc: 'Ficha completa del cliente ideal: demographics, pain points, goals, emotional drivers y journey. Incluye quotes realistas en primera persona.',
    bullets: [
      'Extrayendo pain points y challenges',
      'Escribiendo quotes del avatar (primera persona)',
      'Mapeando awareness → frustración → desesperación → alivio',
    ],
    etaSec: 60,
  },
  {
    key: 'offerBrief',
    label: 'Offer Brief',
    desc: 'Brief para copywriter: Big Idea, Unique Mechanism of Problem/Solution, guru, headlines, 8+ objections, belief chains y funnel architecture.',
    bullets: [
      'Identificando la Big Idea y Metaphor central',
      'Armando UMP (problema) + UMS (solución) propietarios',
      'Escribiendo 3-5 headlines candidatos',
      'Listando objections + belief chains',
    ],
    etaSec: 60,
  },
  {
    key: 'beliefs',
    label: 'Creencias necesarias',
    desc: '6 creencias "Yo creo que…" que el prospect debe adoptar antes de comprar — la estrella del norte del copy, método E5 de Agora.',
    bullets: [
      'Destilando la secuencia de creencias crítica',
      'Ordenando de fundamental a cercana a la compra',
      'Explicando por qué cada una es necesaria',
    ],
    etaSec: 45,
  },
  {
    key: 'resumenEjecutivo',
    label: 'Resumen ejecutivo',
    desc: 'Síntesis en 2-3 oraciones con lo central del producto, avatar y ángulo estratégico. Queda como anclaje rápido del expediente.',
    bullets: [
      'Condensando el análisis completo',
      'Extrayendo el ángulo estratégico central',
    ],
    etaSec: 20,
  },
];

// Segundos totales estimados para el pipeline completo.
const TOTAL_ETA_SEC = STEPS.reduce((s, step) => s + (step.etaSec || 60), 0);

// Config del auto-refresh de competidores (Ad Library).
const COMP_REFRESH_STALE_HOURS = 6;     // si un competidor tiene lastCheck > 6h, re-checkeamos
const COMP_REFRESH_INTERVAL_MS = 30 * 60 * 1000;  // cada 30 min revisamos si hay algo stale

// Formatea "hace X" relativo.
function timeAgo(iso) {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const d = Math.round(hr / 24);
  return `hace ${d}d`;
}

function loadProductos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveProductos(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function MarketingSection({ addToast, bgAnalysis, onStart, onCancel, onDismiss }) {
  const [productos, setProductos] = useState(() => loadProductos());
  const [form, setForm] = useState({ productoUrl: '', productoNombre: '' });
  const [activeProductId, setActiveProductId] = useState(null);
  const [activeTab, setActiveTab] = useState('research');

  // Estado de generación.
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
  const [stepStatus, setStepStatus] = useState({});
  const [liveOutputs, setLiveOutputs] = useState({});
  const [infoMsg, setInfoMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [startedAt, setStartedAt] = useState(null);   // timestamp del arranque
  const [elapsedSec, setElapsedSec] = useState(0);    // segundos que lleva
  const [tickerIdx, setTickerIdx] = useState(0);      // rota entre los bullets del paso activo

  const readerRef = useRef(null);

  useEffect(() => { saveProductos(productos); }, [productos]);

  // ------------------------------------------------------------------------
  // Auto-refresh de competidores.
  // Mientras la app esté abierta, cada 30 min chequeamos si algún competidor
  // tiene lastCheck > 6h. Si sí, re-consulta Ad Library en silencio.
  // Así no tenés que apretar "Actualizar ads" a mano.
  // ------------------------------------------------------------------------
  const productosRef = useRef(productos);
  useEffect(() => { productosRef.current = productos; }, [productos]);

  useEffect(() => {
    const refreshStaleCompetitors = async () => {
      const now = Date.now();
      const staleMs = COMP_REFRESH_STALE_HOURS * 60 * 60 * 1000;
      const current = productosRef.current;
      for (const p of current) {
        const comps = p.competidores || [];
        for (const c of comps) {
          if (!c.pageId) continue; // sin pageId no podemos consultar
          const last = c.lastCheck ? new Date(c.lastCheck).getTime() : 0;
          if (now - last < staleMs) continue;
          try {
            const resp = await fetch('/api/meta/ad-library', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pageId: c.pageId }),
            });
            if (!resp.ok) continue; // silencioso: si falla, no molestamos al user
            const data = await resp.json();
            // Actualizo el producto en el state, preservando todo lo demás.
            setProductos(prev => prev.map(prod => {
              if (prod.id !== p.id) return prod;
              const updatedComps = (prod.competidores || []).map(cc =>
                cc.id === c.id ? { ...cc, ads: data.ads || [], lastCheck: new Date().toISOString() } : cc
              );
              return { ...prod, competidores: updatedComps, updatedAt: new Date().toISOString() };
            }));
          } catch { /* silencioso */ }
        }
      }
    };

    // Corremos al montar (después de 3s para no pisar el primer render) y cada 30 min.
    const initial = setTimeout(refreshStaleCompetitors, 3000);
    const interval = setInterval(refreshStaleCompetitors, COMP_REFRESH_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  // Contador de segundos mientras corre el pipeline.
  useEffect(() => {
    if (!running || !startedAt) return;
    const t = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [running, startedAt]);

  // Rotador de bullets dentro del paso activo (muestra cada ~4s uno distinto).
  useEffect(() => {
    if (!running || !currentStep) return;
    setTickerIdx(0);
    const step = STEPS.find(s => s.key === currentStep);
    const bullets = step?.bullets || [];
    if (bullets.length <= 1) return;
    const t = setInterval(() => {
      setTickerIdx(i => (i + 1) % bullets.length);
    }, 4000);
    return () => clearInterval(t);
  }, [running, currentStep]);

  const activeProduct = productos.find(p => p.id === activeProductId) || null;

  const resetRun = () => {
    setCurrentStep(null);
    setStepStatus({});
    setLiveOutputs({});
    setInfoMsg('');
    setErrorMsg('');
    setStartedAt(null);
    setElapsedSec(0);
    setTickerIdx(0);
  };

  const handleGenerate = async () => {
    const productoNombre = form.productoNombre.trim();
    const productoUrl = form.productoUrl.trim();
    if (!productoNombre) { addToast?.({ type: 'error', message: 'Falta el nombre del producto' }); return; }

    // Si el padre (AppShell) nos pasó onStart, delegamos ahí para que el
    // análisis corra como "bg task" y siga vivo al cambiar de sección.
    // El padre nos devuelve el resultado vía onComplete, acá lo agregamos
    // a la lista de productos guardados.
    if (typeof onStart === 'function') {
      onStart({
        productoNombre, productoUrl,
        onComplete: (result) => {
          const paquete = {
            id: Date.now(),
            productoNombre: result.productoNombre,
            productoUrl: result.productoUrl,
            descripcion: result.descripcion || '',
            imagen: result.ogImage || null,
            resumenEjecutivo: result.resumenEjecutivo || '',
            docs: result.docs || { research: '', avatar: '', offerBrief: '', beliefs: '', resumenEjecutivo: '' },
            memoria: { notas: [], aprendizajes: [] },
            historial: [{ tipo: 'generacion-inicial', at: new Date().toISOString() }],
            createdAt: new Date().toISOString(),
          };
          setProductos(prev => [paquete, ...prev]);
          setActiveProductId(paquete.id);
          setActiveTab('research');
          setForm({ productoUrl: '', productoNombre: '' });
        },
      });
      return;
    }

    // Fallback: corre inline (pre-refactor). Útil si el componente se usa standalone.
    setRunning(true);
    resetRun();
    setStartedAt(Date.now());

    try {
      const resp = await fetch('/api/marketing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoUrl, productoNombre }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      const collectedOutputs = { research: '', avatar: '', offerBrief: '', beliefs: '', resumenEjecutivo: '' };
      let ogImage = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.substring(5).trim();
          if (!payload) continue;
          let ev;
          try { ev = JSON.parse(payload); } catch { continue; }

          if (ev.type === 'info') {
            setInfoMsg(ev.message || '');
          } else if (ev.type === 'og-image') {
            ogImage = ev.url || null;
          } else if (ev.type === 'step-start') {
            setCurrentStep(ev.key);
            setStepStatus(s => ({ ...s, [ev.key]: 'running' }));
          } else if (ev.type === 'step-done') {
            setStepStatus(s => ({ ...s, [ev.key]: 'done' }));
            collectedOutputs[ev.key] = ev.content || '';
            setLiveOutputs(prev => ({ ...prev, [ev.key]: ev.content || '' }));
          } else if (ev.type === 'complete') {
            // Guardamos el paquete en la lista (expediente del producto).
            const paquete = {
              id: Date.now(),
              productoNombre,
              productoUrl,
              descripcion: ev.descripcion || '', // la autogenera el backend
              imagen: ev.ogImage || ogImage || null,
              resumenEjecutivo: (ev.outputs?.resumenEjecutivo || collectedOutputs.resumenEjecutivo) || '',
              docs: ev.outputs || collectedOutputs,
              memoria: { notas: [], aprendizajes: [] }, // para Fase 2b
              historial: [{ tipo: 'generacion-inicial', at: new Date().toISOString() }],
              createdAt: new Date().toISOString(),
            };
            setProductos(prev => [paquete, ...prev]);
            setActiveProductId(paquete.id);
            setActiveTab('research');
            setForm({ productoUrl: '', productoNombre: '' });
            addToast?.({ type: 'success', message: `Documentación generada para "${productoNombre}"` });
          } else if (ev.type === 'error') {
            setErrorMsg(ev.error || 'Error durante la generación');
            addToast?.({ type: 'error', message: ev.error || 'Error durante la generación' });
          }
        }
      }
    } catch (err) {
      setErrorMsg(err.message);
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setRunning(false);
      setCurrentStep(null);
      readerRef.current = null;
    }
  };

  const handleDeleteProducto = (id) => {
    if (!window.confirm('¿Borrar esta documentación? No se puede deshacer.')) return;
    setProductos(prev => prev.filter(p => p.id !== id));
    if (activeProductId === id) setActiveProductId(null);
  };

  const handleDownloadPack = (p) => {
    const stamp = new Date().toISOString().split('T')[0];
    const slug = p.productoNombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const doc = [
      `# ${p.productoNombre} — Paquete de documentación de marketing`,
      `\n**URL**: ${p.productoUrl || 'N/A'}`,
      `**Descripción**: ${p.descripcion}`,
      `**Generado**: ${new Date(p.createdAt).toLocaleString('es-AR')}`,
      '\n---\n\n# 1. RESEARCH DOC\n\n' + (p.docs.research || ''),
      '\n\n---\n\n# 2. AVATAR SHEET\n\n' + (p.docs.avatar || ''),
      '\n\n---\n\n# 3. OFFER BRIEF\n\n' + (p.docs.offerBrief || ''),
      '\n\n---\n\n# 4. CREENCIAS NECESARIAS\n\n' + (p.docs.beliefs || ''),
    ].join('\n');
    downloadText(doc, `marketing-${slug}-${stamp}.md`);
  };

  const handleDownloadSingle = (p, key, label) => {
    const stamp = new Date().toISOString().split('T')[0];
    const slug = p.productoNombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    downloadText(p.docs[key] || '', `${slug}-${key}-${stamp}.md`);
  };

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast?.({ type: 'success', message: 'Copiado al portapapeles' });
    } catch { addToast?.({ type: 'error', message: 'No se pudo copiar' }); }
  };

  // Si el padre gestiona el bgAnalysis, usamos SU state. Si no, el nuestro.
  const effective = bgAnalysis || {
    status: running ? 'running' : 'idle',
    currentStep,
    stepStatus,
    liveOutputs,
    elapsedSec,
    infoMsg,
    errorMsg,
  };
  const effRunning = effective.status === 'running';
  const effStepStatus = effective.stepStatus || {};
  const effLiveOutputs = effective.liveOutputs || {};
  const effCurrentStep = effective.currentStep;
  const effElapsedSec = effective.elapsedSec || 0;
  const effInfoMsg = effective.infoMsg || '';
  const effErrorMsg = effective.errorMsg || '';

  // Mostrar viewer si hay progreso en vivo O si ya hay outputs (incluido done).
  const showingLive = effRunning || Object.keys(effLiveOutputs).length > 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-purple-50 to-white dark:from-purple-900/30 dark:to-gray-800 border border-purple-200 dark:border-purple-800 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-violet-500 flex items-center justify-center text-white font-bold shadow-sm">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Documentación de producto</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">Research + Avatar + Offer Brief + Creencias. 5-10 min por producto, 100% IA.</p>
          </div>
        </div>
      </div>

      {/* Form de generación — sólo nombre + URL. La descripción la autogenera el backend. */}
      {!showingLive && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Nombre del producto <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.productoNombre}
              onChange={(e) => setForm({ ...form, productoNombre: e.target.value })}
              placeholder="Ej: CELLU — suplemento anticelulitis"
              className="w-full px-3 py-2.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">URL de la landing <span className="text-gray-400 normal-case font-normal">(opcional)</span></label>
            <input
              type="url"
              value={form.productoUrl}
              onChange={(e) => setForm({ ...form, productoUrl: e.target.value })}
              placeholder="https://tumarca.com.ar/productos/slug"
              className="w-full px-3 py-2.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Si la poné, scrapeo la landing, extraigo foto + descripción y uso todo como contexto. Sin URL igual funciona pero el research queda más genérico.</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={effRunning || !form.productoNombre.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold text-white bg-gradient-to-br from-purple-600 to-violet-500 rounded-xl hover:from-purple-700 hover:to-violet-600 shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles size={18} /> {effRunning ? 'Generando… (mirá la pill)' : 'Generar documentación completa'}
          </button>
          <p className="text-[11px] text-center text-gray-500 dark:text-gray-400">Tarda entre 3 y 8 minutos. No cierres la pestaña.</p>
        </div>
      )}

      {/* Progreso en vivo */}
      {showingLive && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              {effRunning ? 'Generando…' : 'Resultado'}
            </h3>
            <div className="flex items-center gap-2">
              {effRunning && typeof onCancel === 'function' && (
                <button
                  onClick={() => { if (window.confirm('¿Cancelar el análisis en curso?')) onCancel(); }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 bg-white dark:bg-gray-700 border border-red-200 dark:border-red-800 hover:bg-red-50 rounded-md transition"
                >
                  <X size={12} /> Cancelar análisis
                </button>
              )}
              {!effRunning && Object.keys(effLiveOutputs).length > 0 && (
                <button
                  onClick={() => {
                    if (typeof onDismiss === 'function') onDismiss();
                    resetRun();
                    setActiveProductId(null);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 rounded-md transition"
                >
                  <X size={12} /> Cerrar
                </button>
              )}
            </div>
          </div>
          {effInfoMsg && !effErrorMsg && (
            <div className="mb-3 p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-800 dark:text-blue-200">
              {effInfoMsg}
            </div>
          )}
          {effErrorMsg && (
            <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
              <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-800 dark:text-red-200">{effErrorMsg}</p>
            </div>
          )}

          {/* Progress bar global */}
          {(() => {
            const doneCount = STEPS.filter(s => effStepStatus[s.key] === 'done').length;
            const totalSteps = STEPS.length;
            const pct = Math.round((doneCount / totalSteps) * 100);
            const mm = String(Math.floor(effElapsedSec / 60)).padStart(2, '0');
            const ss = String(effElapsedSec % 60).padStart(2, '0');
            const etaRemainingSec = Math.max(0, TOTAL_ETA_SEC - effElapsedSec);
            const etaMM = String(Math.floor(etaRemainingSec / 60)).padStart(2, '0');
            const etaSS = String(etaRemainingSec % 60).padStart(2, '0');
            const currentIdx = STEPS.findIndex(s => s.key === effCurrentStep);
            const currentStepLabel = currentIdx >= 0 ? STEPS[currentIdx].label : 'Preparando…';
            return (
              <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 border border-purple-200 dark:border-purple-800">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div>
                    <p className="text-xs font-bold text-purple-900 dark:text-purple-200 uppercase tracking-wider">
                      Paso {Math.max(doneCount, currentIdx < 0 ? 0 : currentIdx + 1)} de {totalSteps} · {currentStepLabel}
                    </p>
                    <p className="text-[11px] text-purple-700 dark:text-purple-300 mt-0.5">
                      Tiempo: {mm}:{ss}
                      {effRunning && etaRemainingSec > 0 && <> · ~{etaMM}:{etaSS} restante</>}
                    </p>
                  </div>
                  <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 tabular-nums">{pct}%</p>
                </div>
                <div className="h-2 bg-purple-200 dark:bg-purple-900/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-600 to-violet-500 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Stepper con bullets detallados */}
          <div className="space-y-2">
            {STEPS.map(s => {
              const status = effStepStatus[s.key] || 'pending';
              const content = effLiveOutputs[s.key];
              const isOpen = !!content;
              const isRunning = status === 'running';
              const activeBullet = isRunning && s.bullets && s.bullets.length > 0
                ? s.bullets[tickerIdx % s.bullets.length]
                : null;
              return (
                <div key={s.key} className={`border rounded-lg overflow-hidden transition-all ${isRunning ? 'border-purple-400 dark:border-purple-600 shadow-sm' : 'border-gray-200 dark:border-gray-700'}`}>
                  <div className={`p-3 flex items-start gap-3 ${isRunning ? 'bg-purple-50 dark:bg-purple-900/20' : status === 'done' ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-gray-800/50'}`}>
                    <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5">
                      {status === 'done' ? <Check size={14} className="text-emerald-600 dark:text-emerald-300" /> :
                       isRunning ? <Loader2 size={14} className="text-purple-600 dark:text-purple-300 animate-spin" /> :
                       <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{s.label}</p>
                        {status === 'done' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">
                            Listo
                          </span>
                        )}
                        {s.etaSec && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                            ~{Math.round(s.etaSec / 60 * 10) / 10 < 1 ? `${s.etaSec}s` : `${Math.round(s.etaSec / 60)}min`}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{s.desc}</p>
                      {/* Bullet dinámico mientras el paso está corriendo */}
                      {activeBullet && (
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-purple-700 dark:text-purple-300">
                          <div className="w-1 h-1 rounded-full bg-purple-600 dark:bg-purple-400 animate-pulse" />
                          <span className="italic">{activeBullet}…</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-4 max-h-80 overflow-y-auto">
                      <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">{content}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Listado de productos previamente generados */}
      {productos.length > 0 && !showingLive && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-5 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              Productos documentados ({productos.length})
            </h3>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {productos.map(p => (
              <div key={p.id}>
                <button
                  onClick={() => setActiveProductId(activeProductId === p.id ? null : p.id)}
                  className="w-full flex items-start gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition"
                >
                  {/* Thumbnail: og:image si existe, fallback al ícono */}
                  {p.imagen ? (
                    <img src={p.imagen} alt={p.productoNombre} className="w-14 h-14 rounded-lg object-cover bg-gray-100 dark:bg-gray-700 shrink-0 border border-gray-200 dark:border-gray-600" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-purple-600 to-violet-500 flex items-center justify-center shrink-0">
                      <Package size={22} className="text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.productoNombre}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mb-0.5">
                      {new Date(p.createdAt).toLocaleDateString('es-AR')}
                      {p.productoUrl && <> · <span className="text-purple-600 dark:text-purple-400">{(() => { try { return new URL(p.productoUrl).hostname; } catch { return p.productoUrl; } })()}</span></>}
                    </p>
                    {/* Resumen ejecutivo inline (si se generó) */}
                    {p.resumenEjecutivo && (
                      <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug line-clamp-2 mt-1">{p.resumenEjecutivo}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className={`text-gray-400 transition-transform shrink-0 mt-1 ${activeProductId === p.id ? 'rotate-90' : ''}`} />
                </button>

                {/* Dashboard expandido del producto */}
                {activeProductId === p.id && (
                  <ProductDashboard
                    product={p}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    onCopy={handleCopy}
                    onDownloadSingle={handleDownloadSingle}
                    onDownloadPack={handleDownloadPack}
                    onDelete={() => handleDeleteProducto(p.id)}
                    onUpdateProduct={(patch) => setProductos(prev => prev.map(x => x.id === p.id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x))}
                    addToast={addToast}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estado vacío */}
      {productos.length === 0 && !showingLive && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-12 text-center">
          <FileText size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Todavía no tenés productos documentados</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Completá el formulario arriba para generar el primero.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Dashboard expandido de un producto
// ============================================================
const DASH_TABS = [
  { key: 'resumen',      label: 'Resumen',      icon: BookOpen },
  { key: 'docs',         label: 'Documentos',   icon: FileText },
  { key: 'competencia',  label: 'Competencia',  icon: Target },
  { key: 'creativos',    label: 'Creativos',    icon: Sparkles },
  { key: 'memoria',      label: 'Memoria',      icon: MessageSquare },
  { key: 'historial',    label: 'Historial',    icon: Clock },
];

function ProductDashboard({ product: p, activeTab, setActiveTab, onCopy, onDownloadSingle, onDownloadPack, onDelete, onUpdateProduct, addToast }) {
  const [noteText, setNoteText] = useState('');
  const [learningText, setLearningText] = useState('');
  const [compName, setCompName] = useState('');
  const [compUrl, setCompUrl] = useState('');
  const [compPageId, setCompPageId] = useState('');
  const [hooksRunning, setHooksRunning] = useState(false);
  const [hooksTono, setHooksTono] = useState('argentino coloquial, directo');
  const [hooksObjetivo, setHooksObjetivo] = useState('TOFU');
  const [hooksRestricciones, setHooksRestricciones] = useState('');

  const tab = activeTab || 'resumen';
  // Si el tab no existe en DASH_TABS (ej: 'research'), mapear a 'docs'
  const effTab = DASH_TABS.some(t => t.key === tab) ? tab : 'docs';

  const memoria = p.memoria || { notas: [], aprendizajes: [] };
  const competidores = p.competidores || [];
  const historial = p.historial || [];
  const creativos = p.creativos || null;

  const generarHooks = async () => {
    setHooksRunning(true);
    try {
      const resp = await fetch('/api/marketing/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'hooks',
          producto: {
            productoNombre: p.productoNombre,
            productoUrl: p.productoUrl,
            descripcion: p.descripcion,
            resumenEjecutivo: p.resumenEjecutivo,
            docs: p.docs,
            competidores: competidores,
            memoria: memoria,
          },
          config: { tono: hooksTono, objetivo: hooksObjetivo, restricciones: hooksRestricciones },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
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
      onUpdateProduct({
        creativos: nuevosCreativos,
        historial: [...historial, { tipo: 'hooks-generados', at: new Date().toISOString(), meta: `${data.hooks?.length || 0} hooks` }],
      });
      addToast?.({ type: 'success', message: `${data.hooks?.length || 0} hooks generados` });
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setHooksRunning(false);
    }
  };

  const addNota = () => {
    const texto = noteText.trim();
    if (!texto) return;
    const nueva = { id: Date.now(), texto, at: new Date().toISOString() };
    onUpdateProduct({
      memoria: { ...memoria, notas: [nueva, ...memoria.notas] },
      historial: [...historial, { tipo: 'nota', at: nueva.at, meta: texto.slice(0, 80) }],
    });
    setNoteText('');
    addToast?.({ type: 'success', message: 'Nota guardada' });
  };

  const addAprendizaje = () => {
    const texto = learningText.trim();
    if (!texto) return;
    const nuevo = { id: Date.now(), texto, at: new Date().toISOString() };
    onUpdateProduct({
      memoria: { ...memoria, aprendizajes: [nuevo, ...memoria.aprendizajes] },
      historial: [...historial, { tipo: 'aprendizaje', at: nuevo.at, meta: texto.slice(0, 80) }],
    });
    setLearningText('');
    addToast?.({ type: 'success', message: 'Aprendizaje registrado — Claude lo usa en futuras generaciones' });
  };

  const addCompetidor = () => {
    const nombre = compName.trim();
    if (!nombre) return;
    const nuevo = { id: Date.now(), nombre, url: compUrl.trim(), pageId: compPageId.trim(), ads: [], lastCheck: null, addedAt: new Date().toISOString() };
    onUpdateProduct({
      competidores: [nuevo, ...competidores],
      historial: [...historial, { tipo: 'competidor-agregado', at: nuevo.addedAt, meta: nombre }],
    });
    setCompName(''); setCompUrl(''); setCompPageId('');
    addToast?.({ type: 'success', message: `Competidor "${nombre}" agregado` });
  };

  const removeCompetidor = (id) => {
    onUpdateProduct({ competidores: competidores.filter(c => c.id !== id) });
  };

  const checkCompetitorAds = async (comp) => {
    if (!comp.pageId) { addToast?.({ type: 'error', message: 'Necesitás el Page ID de Facebook para consultar sus ads' }); return; }
    try {
      const resp = await fetch('/api/meta/ad-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: comp.pageId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const updated = competidores.map(c => c.id === comp.id ? { ...c, ads: data.ads || [], lastCheck: new Date().toISOString() } : c);
      onUpdateProduct({
        competidores: updated,
        historial: [...historial, { tipo: 'ads-check', at: new Date().toISOString(), meta: `${comp.nombre}: ${data.total} ads` }],
      });
      addToast?.({ type: 'success', message: `${data.total} ads activos de ${comp.nombre}` });
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    }
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-900/30 border-t border-gray-200 dark:border-gray-700">
      {/* Resumen + acciones arriba */}
      <div className="p-4 flex items-start gap-4 border-b border-gray-200 dark:border-gray-700">
        {p.imagen && <img src={p.imagen} alt="" className="w-16 h-16 rounded-lg object-cover bg-gray-100 dark:bg-gray-700 shrink-0 border" />}
        <div className="flex-1 min-w-0">
          {p.resumenEjecutivo && <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed mb-1">{p.resumenEjecutivo}</p>}
          {p.descripcion && <p className="text-[11px] text-gray-500 dark:text-gray-400 italic">{p.descripcion}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onDownloadPack(p)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-white bg-purple-600 rounded-md hover:bg-purple-700 transition" title="Descargar todos los docs">
            <Download size={11} /> Paquete
          </button>
          <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-600 transition" title="Borrar producto">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 pt-3 overflow-x-auto">
        {DASH_TABS.map(t => {
          const Icon = t.icon;
          const isActive = effTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-t-md transition whitespace-nowrap ${isActive ? 'bg-white dark:bg-gray-800 text-purple-700 dark:text-purple-300 shadow-sm border border-b-0 border-gray-200 dark:border-gray-700' : 'text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'}`}
            >
              <Icon size={12} /> {t.label}
              {t.key === 'competencia' && competidores.length > 0 && (
                <span className="ml-0.5 px-1 py-0 text-[9px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded">{competidores.length}</span>
              )}
              {t.key === 'memoria' && (memoria.notas.length + memoria.aprendizajes.length) > 0 && (
                <span className="ml-0.5 px-1 py-0 text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">{memoria.notas.length + memoria.aprendizajes.length}</span>
              )}
              {t.key === 'creativos' && creativos?.fase1?.hooks?.length > 0 && (
                <span className="ml-0.5 px-1 py-0 text-[9px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded">{creativos.fase1.hooks.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">

        {/* RESUMEN */}
        {effTab === 'resumen' && (
          <div className="space-y-3 max-w-3xl">
            <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{p.resumenEjecutivo || 'Sin resumen ejecutivo generado.'}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[
                { label: 'Research', key: 'research', words: (p.docs?.research || '').split(/\s+/).length },
                { label: 'Avatar', key: 'avatar', words: (p.docs?.avatar || '').split(/\s+/).length },
                { label: 'Offer Brief', key: 'offerBrief', words: (p.docs?.offerBrief || '').split(/\s+/).length },
                { label: 'Creencias', key: 'beliefs', words: (p.docs?.beliefs || '').split(/\s+/).length },
              ].map(d => (
                <button key={d.key} onClick={() => setActiveTab('docs')} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition text-left">
                  <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase">{d.label}</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{d.words > 1 ? d.words : '—'}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">palabras</p>
                </button>
              ))}
            </div>
            <div className="flex gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <span>Competidores: {competidores.length}</span>
              <span>·</span>
              <span>Notas: {memoria.notas.length}</span>
              <span>·</span>
              <span>Aprendizajes: {memoria.aprendizajes.length}</span>
            </div>
          </div>
        )}

        {/* DOCUMENTOS */}
        {effTab === 'docs' && (
          <div className="space-y-2">
            {STEPS.filter(s => s.key !== 'resumenEjecutivo').map(s => {
              const content = p.docs?.[s.key] || '';
              return (
                <DocAccordion
                  key={s.key}
                  title={s.label}
                  content={content}
                  wordCount={content.split(/\s+/).length}
                  onCopy={() => onCopy(content)}
                  onDownload={() => onDownloadSingle(p, s.key, s.label)}
                />
              );
            })}
          </div>
        )}

        {/* COMPETENCIA */}
        {effTab === 'competencia' && (
          <div className="space-y-4">
            {/* Badge de auto-refresh */}
            <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-md">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Auto-actualización activa</span>
              </div>
              <span>Los ads se refrescan solos cada {COMP_REFRESH_STALE_HOURS}h mientras tengas la app abierta. También podés forzar refresh con el botón.</span>
            </div>
            <div className="flex gap-2">
              <input type="text" value={compName} onChange={e => setCompName(e.target.value)} placeholder="Nombre del competidor" className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <input type="text" value={compUrl} onChange={e => setCompUrl(e.target.value)} placeholder="URL (landing o FB)" className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <input type="text" value={compPageId} onChange={e => setCompPageId(e.target.value)} placeholder="Page ID (Meta)" className="w-32 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <button onClick={addCompetidor} disabled={!compName.trim()} className="inline-flex items-center gap-1 px-3 py-2 text-sm font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-40">
                <Plus size={14} /> Agregar
              </button>
            </div>
            {competidores.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-xl">
                <Users size={28} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Todavía no cargaste competidores.</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Agregá un competidor con su URL o Page ID de Facebook para monitorear sus ads.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {competidores.map(c => (
                  <div key={c.id} className="bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div>
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{c.nombre}</p>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                          {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-purple-600 inline-flex items-center gap-0.5"><ExternalLink size={10} /> Web</a>}
                          {c.pageId && <span className="font-mono">ID: {c.pageId}</span>}
                          <span className="inline-flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${c.lastCheck ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                            {c.lastCheck ? `Actualizado ${timeAgo(c.lastCheck)}` : 'Pendiente de primer check'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {c.pageId && (
                          <button onClick={() => checkCompetitorAds(c)} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 rounded hover:bg-purple-100 transition">
                            <RefreshCw size={11} /> Actualizar ads
                          </button>
                        )}
                        <button onClick={() => removeCompetidor(c.id)} className="p-1 text-gray-400 hover:text-red-600 transition"><Trash2 size={12} /></button>
                      </div>
                    </div>
                    {/* Ads del competidor */}
                    {Array.isArray(c.ads) && c.ads.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase">{c.ads.length} ads activos (top por días corriendo)</p>
                        {c.ads.slice(0, 5).map((ad, idx) => (
                          <div key={ad.id || idx} className="flex gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-100 dark:border-gray-700 text-xs">
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-900 dark:text-gray-100 font-medium line-clamp-2">{(ad.bodies || [])[0] || '(sin copy)'}</p>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                                {ad.daysRunning != null && <span className={`font-bold ${ad.daysRunning >= 30 ? 'text-emerald-600' : ad.daysRunning >= 14 ? 'text-amber-600' : 'text-gray-500'}`}>{ad.daysRunning}d</span>}
                                {ad.platforms && <span>{ad.platforms.join(', ')}</span>}
                                {ad.snapshotUrl && <a href={ad.snapshotUrl} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline">Ver ad →</a>}
                              </div>
                            </div>
                          </div>
                        ))}
                        {c.ads.length > 5 && <p className="text-[10px] text-gray-400 dark:text-gray-500">+ {c.ads.length - 5} ads más</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CREATIVOS */}
        {effTab === 'creativos' && (
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
                  <input type="text" value={hooksTono} onChange={e => setHooksTono(e.target.value)} placeholder="argentino coloquial, directo"
                    className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Objetivo</label>
                  <select value={hooksObjetivo} onChange={e => setHooksObjetivo(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="TOFU">TOFU (prospecting)</option>
                    <option value="MOFU">MOFU (consideración)</option>
                    <option value="BOFU">BOFU (conversión)</option>
                    <option value="Retargeting">Retargeting</option>
                    <option value="Mix">Mix</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Restricciones</label>
                  <input type="text" value={hooksRestricciones} onChange={e => setHooksRestricciones(e.target.value)} placeholder="sin palabras gatillo, sin vulgaridad"
                    className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
              </div>
              <button
                onClick={generarHooks}
                disabled={hooksRunning}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-purple-600 to-violet-500 rounded-lg hover:from-purple-700 hover:to-violet-600 shadow-sm transition disabled:opacity-40"
              >
                {hooksRunning ? <><Loader2 size={14} className="animate-spin" /> Generando…</> : <><Sparkles size={14} /> {creativos?.fase1 ? 'Regenerar hooks' : 'Generar hooks'}</>}
              </button>
              {creativos?.fase1?.generatedAt && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">Última generación: {new Date(creativos.fase1.generatedAt).toLocaleString('es-AR')}</p>
              )}
            </div>

            {/* Resultado: diagnóstico + hooks */}
            {creativos?.fase1 && (
              <>
                {/* Diagnóstico */}
                {creativos.fase1.diagnostico && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">🔵 Diagnóstico</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {creativos.fase1.diagnostico.beneficios && (
                        <div>
                          <p className="font-semibold text-gray-600 dark:text-gray-400 mb-1">Beneficios</p>
                          <ul className="space-y-0.5 list-disc pl-4 text-gray-700 dark:text-gray-300">
                            {creativos.fase1.diagnostico.beneficios.map((b, i) => <li key={i}>{b}</li>)}
                          </ul>
                        </div>
                      )}
                      {creativos.fase1.diagnostico.dolores && (
                        <div>
                          <p className="font-semibold text-gray-600 dark:text-gray-400 mb-1">Dolores</p>
                          <ul className="space-y-0.5 list-disc pl-4 text-gray-700 dark:text-gray-300">
                            {creativos.fase1.diagnostico.dolores.map((d, i) => <li key={i}>{d}</li>)}
                          </ul>
                        </div>
                      )}
                      {creativos.fase1.diagnostico.vaciosComunicacion && (
                        <div className="md:col-span-2">
                          <p className="font-semibold text-amber-700 dark:text-amber-300 mb-1">🔥 Vacíos de comunicación (el oro)</p>
                          <ul className="space-y-0.5 list-disc pl-4 text-gray-700 dark:text-gray-300">
                            {creativos.fase1.diagnostico.vaciosComunicacion.map((v, i) => <li key={i}>{v}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Hooks agrupados por ángulo */}
                {Array.isArray(creativos.fase1.hooks) && creativos.fase1.hooks.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">🎣 Hooks ({creativos.fase1.hooks.length})</h4>
                    {(creativos.fase1.angulosElegidos || []).map(a => {
                      const hooksDelAngulo = creativos.fase1.hooks.filter(h => h.angulo === a.id);
                      if (hooksDelAngulo.length === 0) return null;
                      return (
                        <div key={a.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-bold text-xs">{a.id}</span>
                            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{a.nombre}</p>
                            <span className="ml-auto text-[10px] text-gray-500 dark:text-gray-400">{hooksDelAngulo.length} hooks</span>
                          </div>
                          {a.porQueSirve && <p className="text-[11px] text-gray-500 dark:text-gray-400 italic mb-2">{a.porQueSirve}</p>}
                          <ul className="space-y-1.5">
                            {hooksDelAngulo.map(h => (
                              <li key={h.id} className="flex items-start gap-2 text-sm">
                                <span className="text-gray-400 font-mono text-[10px] tabular-nums mt-0.5">#{h.id}</span>
                                <span className="flex-1 text-gray-800 dark:text-gray-200">
                                  {h.texto}
                                  {h.riesgoMeta && (
                                    <span className="ml-1.5 inline-flex items-center gap-0.5 px-1 py-0 text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded" title={h.motivoRiesgoMeta || ''}>
                                      ⚠️ Meta
                                    </span>
                                  )}
                                </span>
                                <button onClick={() => { navigator.clipboard?.writeText(h.texto); addToast?.({ type: 'success', message: 'Hook copiado' }); }} className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition opacity-0 group-hover:opacity-100" title="Copiar hook">
                                  <Copy size={11} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Observaciones */}
                {Array.isArray(creativos.fase1.observaciones) && creativos.fase1.observaciones.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <h4 className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider mb-2">💡 Observaciones estratégicas</h4>
                    <ul className="space-y-1.5 text-xs text-gray-800 dark:text-gray-200">
                      {creativos.fase1.observaciones.map((o, i) => (
                        <li key={i} className="flex gap-2"><span className="text-amber-500">•</span><span>{o}</span></li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-3 bg-gray-50 dark:bg-gray-700/30 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    <strong>🚧 Próximas fases (en construcción):</strong> seleccionar hooks → dirección visual → plan por pieza (con prompts para Nano Banana / Midjourney) → brief completo en .docx para pasar al diseñador.
                  </p>
                </div>
              </>
            )}

            {!creativos?.fase1 && !hooksRunning && (
              <div className="p-8 text-center border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-xl">
                <Sparkles size={28} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Todavía no generaste hooks para este producto.</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Click en "Generar hooks" arriba — tarda ~60-90 segundos.</p>
              </div>
            )}
          </div>
        )}

        {/* MEMORIA */}
        {effTab === 'memoria' && (
          <div className="space-y-5 max-w-3xl">
            {/* Agregar nota */}
            <div>
              <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Agregar nota</label>
              <div className="flex gap-2">
                <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNota(); }}
                  placeholder='Ej: "Llamar a proveedor de envases" / "Revisar copy del hero"'
                  className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                <button onClick={addNota} disabled={!noteText.trim()} className="px-3 py-2 text-sm font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-40">Guardar</button>
              </div>
            </div>
            {/* Agregar aprendizaje */}
            <div>
              <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Registrar aprendizaje (la IA lo usa en futuras generaciones)</label>
              <div className="flex gap-2">
                <input type="text" value={learningText} onChange={e => setLearningText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addAprendizaje(); }}
                  placeholder='Ej: "Hook X tuvo 4.5% CTR" / "El ángulo conspiracional no funcionó con esta audiencia"'
                  className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-emerald-300 dark:border-emerald-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                <button onClick={addAprendizaje} disabled={!learningText.trim()} className="px-3 py-2 text-sm font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition disabled:opacity-40">Registrar</button>
              </div>
            </div>
            {/* Listado */}
            {(memoria.notas.length + memoria.aprendizajes.length) === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">Sin notas ni aprendizajes todavía.</p>
            ) : (
              <div className="space-y-1.5">
                {[...memoria.aprendizajes.map(a => ({ ...a, _tipo: 'aprendizaje' })), ...memoria.notas.map(n => ({ ...n, _tipo: 'nota' }))]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map(item => (
                    <div key={item.id} className={`px-3 py-2 rounded-lg text-xs ${item._tipo === 'aprendizaje' ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600'}`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[9px] font-bold uppercase ${item._tipo === 'aprendizaje' ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}`}>{item._tipo === 'aprendizaje' ? '🧠 Aprendizaje' : '📝 Nota'}</span>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500">{new Date(item.at).toLocaleString('es-AR')}</span>
                      </div>
                      <p className="text-gray-800 dark:text-gray-200">{item.texto}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* HISTORIAL */}
        {effTab === 'historial' && (
          <div className="space-y-1 max-w-3xl">
            {historial.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">Sin actividad registrada.</p>
            ) : (
              [...historial].reverse().map((h, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs px-3 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">{new Date(h.at).toLocaleString('es-AR')}</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {h.tipo === 'generacion-inicial' && '🚀 Documentación generada'}
                    {h.tipo === 'nota' && `📝 Nota: ${h.meta || ''}`}
                    {h.tipo === 'aprendizaje' && `🧠 Aprendizaje: ${h.meta || ''}`}
                    {h.tipo === 'competidor-agregado' && `👥 Competidor agregado: ${h.meta || ''}`}
                    {h.tipo === 'ads-check' && `📊 ${h.meta || ''}`}
                    {h.tipo === 'hooks-generados' && `🎣 Hooks generados: ${h.meta || ''}`}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Accordion para cada documento (en tab Docs).
function DocAccordion({ title, content, wordCount, onCopy, onDownload }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition"
      >
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{wordCount > 1 ? `${wordCount} palabras` : '—'}</span>
        <button onClick={(e) => { e.stopPropagation(); onCopy(); }} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Copiar"><Copy size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); onDownload(); }} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Descargar"><Download size={12} /></button>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 max-h-[500px] overflow-y-auto">
          <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">{content || '(sin contenido)'}</pre>
        </div>
      )}
    </div>
  );
}
