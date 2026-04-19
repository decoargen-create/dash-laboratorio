// Sección Arranque — punto de entrada de Marketing.
//
// 3 cards de setup (producto, competidores, correr pipeline) que se van
// completando a medida que tenés data. El botón "Correr pipeline" dispara
// un flow completo:
//   1. Scrape de ads de cada competidor (apify-ingest, force=true)
//   2. Para cada competidor, deep-analyze de los top 3 winners
//   3. Poblado de ideas en la Bandeja (futuro — por ahora solo el análisis)
//
// Todo lo que carga usa los mismos localStorage keys que las otras secciones:
//   - 'viora-marketing-productos-v1' (Marketing.jsx)
//   - 'viora-marketing-competidores-v1' (Competencia.jsx)
// Así tenés continuidad entre secciones.

import React, { useState, useEffect } from 'react';
import {
  Package, Target, Play, Check, Loader2, AlertTriangle, ChevronRight,
  Plus, X, Sparkles, Link2, Search, Clock,
} from 'lucide-react';
import { ideaFromDeepAnalysis, addGeneratedIdeas, loadIdeas } from './bandejaStore.js';

const PRODUCTOS_KEY = 'viora-marketing-productos-v1';
const COMPETIDORES_KEY = 'viora-marketing-competidores-v1';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Derivamos keyword para búsqueda en Ad Library (igual que el bookmarklet
// del user): si es app.dropi, último segmento del path; sino hostname sin www.
function landingToKeyword(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('app.dropi')) {
      const parts = u.pathname.split('/').filter(Boolean);
      return (parts[parts.length - 1] || '').replace(/-/g, ' ');
    }
    return u.hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

export default function ArranqueSection({ addToast, onGoToSection }) {
  const [productos, setProductos] = useState(() => loadJSON(PRODUCTOS_KEY, []));
  const [competidores, setCompetidores] = useState(() => loadJSON(COMPETIDORES_KEY, []));

  // Wizard product form
  const [showProdForm, setShowProdForm] = useState(false);
  const [prodDraft, setProdDraft] = useState({ nombre: '', landingUrl: '', descripcion: '' });

  // Wizard competitors
  const [showCompForm, setShowCompForm] = useState(false);
  const [compDraft, setCompDraft] = useState({ nombre: '', landingUrl: '' });

  // Pipeline runner
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]); // { id, label, detail, status: 'pending'|'running'|'done'|'error', startedAt, endedAt }
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => { saveJSON(PRODUCTOS_KEY, productos); }, [productos]);
  useEffect(() => { saveJSON(COMPETIDORES_KEY, competidores); }, [competidores]);

  // El producto "principal" es el primero (simplificamos: 1 producto por ahora).
  const producto = productos[0];

  const handleAddProducto = async () => {
    const nombre = prodDraft.nombre.trim();
    const landingUrl = prodDraft.landingUrl.trim();
    if (!nombre) { addToast?.({ type: 'error', message: 'Ponele nombre al producto' }); return; }

    const nuevo = {
      id: Date.now(),
      nombre,
      landingUrl,
      descripcion: prodDraft.descripcion.trim(),
      createdAt: new Date().toISOString(),
    };
    setProductos(prev => [nuevo, ...prev]);
    setProdDraft({ nombre: '', landingUrl: '', descripcion: '' });
    setShowProdForm(false);
    addToast?.({ type: 'success', message: `Producto "${nombre}" cargado` });
  };

  const handleAddCompetidor = () => {
    const nombre = compDraft.nombre.trim();
    if (!nombre) { addToast?.({ type: 'error', message: 'Ponele nombre al competidor' }); return; }
    const nuevo = {
      id: Date.now(),
      nombre,
      landingUrl: compDraft.landingUrl.trim(),
      notas: '',
      ads: [],
      lastAdsCheck: null,
      createdAt: new Date().toISOString(),
    };
    setCompetidores(prev => [nuevo, ...prev]);
    setCompDraft({ nombre: '', landingUrl: '' });
    setShowCompForm(false);
    addToast?.({ type: 'success', message: `Competidor "${nombre}" sumado` });
  };

  const handleRemoveCompetidor = (id) => {
    if (!window.confirm('¿Sacar a este competidor de la lista?')) return;
    setCompetidores(prev => prev.filter(c => c.id !== id));
  };

  // --- Pipeline runner ---
  // Se ejecuta en el cliente: una serie de fetches a endpoints existentes.
  // Cada "paso" tiene copy en rioplatense así el user entiende qué pasa.

  const updateStep = (id, patch) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const runPipeline = async () => {
    if (!competidores.length) {
      addToast?.({ type: 'error', message: 'Primero cargá al menos un competidor' });
      return;
    }

    setRunning(true);
    setCancelled(false);

    // Construimos los pasos dinámicamente según cuántos competidores hay.
    const pasos = [
      { id: 'prep', label: '🚀 Arrancando', detail: `Vamos a analizar ${competidores.length} competidor${competidores.length > 1 ? 'es' : ''}`, status: 'pending' },
      ...competidores.map(c => ({
        id: `scrape-${c.id}`,
        label: `🔍 Buscando ads de ${c.nombre}`,
        detail: 'Meta Ad Library vía Apify',
        status: 'pending',
      })),
      ...competidores.map(c => ({
        id: `analyze-${c.id}`,
        label: `🧠 Analizando ganadores de ${c.nombre}`,
        detail: 'Claude Vision + Whisper (si hay video)',
        status: 'pending',
      })),
      { id: 'generate', label: '💡 Generando ideas nuevas con IA', detail: 'Réplicas + diferenciaciones + ideas desde cero', status: 'pending' },
      { id: 'done', label: '✅ Listo', detail: 'Tenés análisis fresco + ideas nuevas en la Bandeja', status: 'pending' },
    ];
    setSteps(pasos);

    // Paso 1: prep
    updateStep('prep', { status: 'running', startedAt: Date.now() });
    await new Promise(r => setTimeout(r, 500));
    updateStep('prep', { status: 'done', endedAt: Date.now() });

    // Paso 2..N+1: scrape de cada competidor
    const compWithAds = []; // { comp, winners }
    for (const c of competidores) {
      if (cancelled) break;
      const stepId = `scrape-${c.id}`;
      updateStep(stepId, { status: 'running', startedAt: Date.now() });
      try {
        const payload = { country: 'AR', limit: 50 };
        if (c.fbPageUrl) {
          payload.fbPageUrl = c.fbPageUrl.startsWith('http') ? c.fbPageUrl : `https://www.facebook.com/${c.fbPageUrl}`;
        } else if (c.landingUrl) {
          payload.searchKeyword = landingToKeyword(c.landingUrl) || c.nombre;
        } else {
          payload.searchKeyword = c.nombre;
        }
        const resp = await fetch('/api/marketing/apify-ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

        const ads = data.ads || [];
        const winners = ads.filter(a => a.isWinner).slice(0, 3);

        // Guardar en el competidor
        setCompetidores(prev => prev.map(x =>
          x.id === c.id ? {
            ...x,
            ads,
            adsTotal: data.total || 0,
            winnersCount: data.winners || 0,
            lastAdsCheck: new Date().toISOString(),
          } : x
        ));

        compWithAds.push({ comp: c, winners });
        updateStep(stepId, {
          status: 'done',
          endedAt: Date.now(),
          detail: `${winners.length} ganador${winners.length !== 1 ? 'es' : ''} de ${ads.length} ads`,
        });
      } catch (err) {
        updateStep(stepId, { status: 'error', endedAt: Date.now(), detail: err.message });
      }
    }

    // Paso N+2..2N+1: deep-analyze de winners de cada competidor
    for (const { comp, winners } of compWithAds) {
      if (cancelled) break;
      const stepId = `analyze-${comp.id}`;
      if (winners.length === 0) {
        updateStep(stepId, { status: 'done', endedAt: Date.now(), detail: 'Sin ganadores para analizar todavía' });
        continue;
      }
      updateStep(stepId, { status: 'running', startedAt: Date.now(), detail: `0/${winners.length} analizados` });
      let analyzed = 0;
      for (const ad of winners) {
        if (cancelled) break;
        try {
          const resp = await fetch('/api/marketing/deep-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ad: {
                id: ad.id, body: ad.body, headline: ad.headline,
                cta: ad.cta, ctaLink: ad.ctaLink, pageName: ad.pageName,
                imageUrls: ad.imageUrls || [], videoUrls: ad.videoUrls || [],
                daysRunning: ad.daysRunning, platforms: ad.platforms || [],
                isMultiplatform: ad.isMultiplatform,
                score: ad.score, variantes: ad.variantes,
              },
              transcribe: true,
            }),
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

          setCompetidores(prev => prev.map(x =>
            x.id === comp.id ? {
              ...x,
              adsAnalysis: {
                ...(x.adsAnalysis || {}),
                [ad.id]: {
                  analysis: data.analysis,
                  transcript: data.transcript,
                  transcriptStatus: data.transcriptStatus,
                  model: data.model,
                  generatedAt: data.generatedAt,
                },
              },
            } : x
          ));
          // Empuja la idea a la Bandeja automáticamente.
          ideaFromDeepAnalysis({ analysis: data.analysis, transcript: data.transcript, ad, competidor: comp });
          analyzed++;
          updateStep(stepId, { detail: `${analyzed}/${winners.length} analizados` });
        } catch (err) {
          // Un análisis fallido no rompe el resto — seguimos.
          console.error(`deep-analyze falló para ad ${ad.id}:`, err);
        }
      }
      updateStep(stepId, { status: 'done', endedAt: Date.now(), detail: `${analyzed}/${winners.length} analizados` });
    }

    // Paso generate: llamar a generate-ideas con todo el contexto acumulado.
    if (!cancelled) {
      updateStep('generate', { status: 'running', startedAt: Date.now() });
      try {
        // Armar el array de análisis para el endpoint.
        const compAnalisis = [];
        // Leemos state fresh del localStorage porque setCompetidores es async.
        const compsActualizados = loadJSON(COMPETIDORES_KEY, competidores);
        for (const c of compsActualizados) {
          const analyses = c.adsAnalysis || {};
          for (const adId of Object.keys(analyses)) {
            const a = analyses[adId];
            const ad = (c.ads || []).find(x => x.id === adId);
            compAnalisis.push({
              competidorNombre: c.nombre,
              adId,
              adHeadline: ad?.headline || '',
              adBody: ad?.body || '',
              analysis: a.analysis,
            });
          }
        }

        const ideasExistentes = loadIdeas().map(i => ({ titulo: i.titulo, angulo: i.angulo, tipo: i.tipo }));

        const resp = await fetch('/api/marketing/generate-ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            producto: producto || { nombre: 'Producto sin definir' },
            competidoresAnalisis: compAnalisis,
            ideasExistentes,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

        const nuevas = addGeneratedIdeas(data.ideas || [], { producto });
        updateStep('generate', {
          status: 'done',
          endedAt: Date.now(),
          detail: `${nuevas.length} ideas nuevas agregadas (${data.count || 0} generadas)`,
        });
      } catch (err) {
        updateStep('generate', { status: 'error', endedAt: Date.now(), detail: err.message });
      }
    }

    // Paso final
    updateStep('done', { status: 'running', startedAt: Date.now() });
    await new Promise(r => setTimeout(r, 400));
    updateStep('done', { status: 'done', endedAt: Date.now() });

    setRunning(false);
    if (!cancelled) {
      addToast?.({ type: 'success', message: '¡Listo! Mirá los análisis + ideas en la Bandeja.' });
    }
  };

  const handleCancel = () => {
    setCancelled(true);
    addToast?.({ type: 'info', message: 'Cancelando después del paso actual…' });
  };

  const stepsDone = steps.filter(s => s.status === 'done').length;
  const stepsTotal = steps.length || 1;
  const progress = Math.round((stepsDone / stepsTotal) * 100);

  // --- Estados derivados para los checks de la wizard ---
  const prodReady = !!producto;
  const compsReady = competidores.length >= 1;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center text-white shadow-sm">
          <Play size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Arranque</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Cargá tu producto + competidores una vez y corré el pipeline cuando quieras.</p>
        </div>
      </div>

      {/* Paso 1 — Producto */}
      <WizardCard
        num="1"
        title="Tu producto"
        done={prodReady}
        badge={prodReady ? producto.nombre : null}
      >
        {prodReady ? (
          <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
            <p><strong>{producto.nombre}</strong></p>
            {producto.landingUrl && (
              <a href={producto.landingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                <Link2 size={11} /> {producto.landingUrl}
              </a>
            )}
            {producto.descripcion && <p className="text-gray-600 dark:text-gray-400">{producto.descripcion}</p>}
          </div>
        ) : !showProdForm ? (
          <button onClick={() => setShowProdForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-purple-600 to-violet-600 rounded-md hover:from-purple-700 hover:to-violet-700 transition">
            <Plus size={12} /> Cargar producto
          </button>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" value={prodDraft.nombre} onChange={e => setProdDraft({ ...prodDraft, nombre: e.target.value })}
                placeholder="Nombre del producto"
                className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <input type="url" value={prodDraft.landingUrl} onChange={e => setProdDraft({ ...prodDraft, landingUrl: e.target.value })}
                placeholder="URL de la landing"
                className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <textarea value={prodDraft.descripcion} onChange={e => setProdDraft({ ...prodDraft, descripcion: e.target.value })}
              placeholder="Descripción corta (opcional — qué es, para quién, diferenciales)"
              rows={2}
              className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowProdForm(false); setProdDraft({ nombre: '', landingUrl: '', descripcion: '' }); }}
                className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleAddProducto}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-purple-600 to-violet-600 rounded-md hover:from-purple-700 hover:to-violet-700 transition">
                <Check size={12} /> Guardar
              </button>
            </div>
          </div>
        )}
      </WizardCard>

      {/* Paso 2 — Competidores */}
      <WizardCard
        num="2"
        title="Competidores a analizar"
        done={compsReady}
        badge={compsReady ? `${competidores.length} cargado${competidores.length > 1 ? 's' : ''}` : null}
      >
        <div className="space-y-2">
          {competidores.length > 0 && (
            <ul className="space-y-1">
              {competidores.map(c => (
                <li key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-800/50 rounded">
                  <Target size={10} className="text-orange-500 shrink-0" />
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{c.nombre}</span>
                  {c.landingUrl && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{c.landingUrl}</span>
                  )}
                  {c.ads?.length > 0 && (
                    <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400">
                      {c.ads.length} ads · {c.winnersCount || 0} 🏆
                    </span>
                  )}
                  <button onClick={() => handleRemoveCompetidor(c.id)}
                    className="p-0.5 text-gray-400 hover:text-red-600 transition" title="Sacar">
                    <X size={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!showCompForm ? (
            <button onClick={() => setShowCompForm(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-md hover:bg-purple-100 transition">
              <Plus size={11} /> Agregar competidor
            </button>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 items-stretch">
              <input type="text" value={compDraft.nombre} onChange={e => setCompDraft({ ...compDraft, nombre: e.target.value })}
                placeholder="Nombre del competidor"
                className="flex-1 px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <input type="url" value={compDraft.landingUrl} onChange={e => setCompDraft({ ...compDraft, landingUrl: e.target.value })}
                placeholder="URL landing (opcional)"
                className="flex-1 px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <div className="flex gap-1">
                <button onClick={() => { setShowCompForm(false); setCompDraft({ nombre: '', landingUrl: '' }); }}
                  className="px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                  <X size={12} />
                </button>
                <button onClick={handleAddCompetidor}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-purple-600 to-violet-600 rounded-md hover:from-purple-700 hover:to-violet-700 transition">
                  <Check size={11} />
                </button>
              </div>
            </div>
          )}
        </div>
      </WizardCard>

      {/* Paso 3 — Correr pipeline */}
      <WizardCard
        num="3"
        title="Correr el pipeline"
        done={false}
        disabled={!compsReady}
        badge={null}
      >
        {!compsReady ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">Cargá al menos un competidor para habilitar el pipeline.</p>
        ) : (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">
              Va a buscar los ads activos de cada competidor, detectar los ganadores (≥17d o ≥2 variantes) y analizarlos en profundidad con Claude Vision + Whisper. Tarda 2-5 min según cuántos competidores tengas.
            </p>
            <div className="flex items-center gap-2">
              {!running ? (
                <button onClick={runPipeline}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-purple-600 to-violet-600 rounded-lg hover:from-purple-700 hover:to-violet-700 shadow-sm transition">
                  <Play size={14} /> Correr pipeline
                </button>
              ) : (
                <button onClick={handleCancel}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 transition">
                  <X size={14} /> Cancelar
                </button>
              )}
              {!running && steps.length > 0 && (
                <>
                  <button onClick={() => onGoToSection?.('mk-bandeja')}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 rounded transition">
                      Ver Bandeja de ideas <ChevronRight size={12} />
                  </button>
                  <button onClick={() => onGoToSection?.('mk-competencia')}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition">
                      Ver Competencia <ChevronRight size={12} />
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* Stepper */}
        {steps.length > 0 && (
          <div className="mt-5 space-y-3">
            {/* Barra de progreso */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-gray-600 dark:text-gray-400">
                <span>{stepsDone} de {stepsTotal} pasos</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-violet-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Lista de pasos */}
            <ul className="space-y-1.5">
              {steps.map(step => (
                <StepRow key={step.id} step={step} />
              ))}
            </ul>
          </div>
        )}
      </WizardCard>
    </div>
  );
}

function WizardCard({ num, title, done, disabled = false, badge, children }) {
  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-xl p-5 shadow-sm transition ${
      disabled
        ? 'border-gray-200 dark:border-gray-700 opacity-60'
        : done
          ? 'border-emerald-300 dark:border-emerald-700'
          : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          done
            ? 'bg-emerald-500 text-white'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
        }`}>
          {done ? <Check size={14} /> : num}
        </div>
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex-1">{title}</h3>
        {badge && (
          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      <div className="pl-10">
        {children}
      </div>
    </div>
  );
}

function StepRow({ step }) {
  const { status, label, detail, startedAt, endedAt } = step;
  const elapsed = startedAt
    ? Math.round(((endedAt || Date.now()) - startedAt) / 1000)
    : null;

  return (
    <li className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs transition ${
      status === 'running' ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800' :
      status === 'done' ? 'bg-emerald-50/50 dark:bg-emerald-900/10' :
      status === 'error' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' :
      'bg-gray-50/50 dark:bg-gray-800/30'
    }`}>
      <span className="mt-0.5 shrink-0">
        {status === 'running' && <Loader2 size={13} className="animate-spin text-purple-600 dark:text-purple-400" />}
        {status === 'done' && <Check size={13} className="text-emerald-600 dark:text-emerald-400" />}
        {status === 'error' && <AlertTriangle size={13} className="text-red-600" />}
        {status === 'pending' && <Clock size={13} className="text-gray-400" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold ${
          status === 'done' ? 'text-emerald-900 dark:text-emerald-200' :
          status === 'error' ? 'text-red-900 dark:text-red-200' :
          'text-gray-800 dark:text-gray-200'
        }`}>{label}</p>
        <p className="text-[10px] text-gray-600 dark:text-gray-400">{detail}</p>
      </div>
      {elapsed != null && status !== 'pending' && (
        <span className="text-[10px] font-mono text-gray-400 shrink-0">{elapsed}s</span>
      )}
    </li>
  );
}
