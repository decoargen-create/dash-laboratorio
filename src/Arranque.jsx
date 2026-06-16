// Sección Arranque — punto de entrada de Marketing.
//
// 4 cards de setup (producto, cuenta Meta opcional, competidores, correr
// pipeline). El botón "Correr pipeline" dispara el flow end-to-end:
//   1. Si el producto no tiene research → genera docs (research + avatar
//      + offer brief + creencias + resumen ejecutivo).
//   2. Post-research analysis: infiere stage del prospect + genera 5-8
//      keywords de búsqueda para competencia.
//   3. Si no hay competidores cargados → auto-sugiere top-5 con esos
//      keywords vía Meta Ad Library.
//   4. Para cada competidor: scrape de ads activos + deep-analyze de los
//      ganadores (Claude Vision + Whisper).
//   5. Generator: crea ideas clasificadas (réplica / iteración /
//      diferenciación / desde cero) y las puebla en la Bandeja.
//
// Todo lo que carga usa los mismos localStorage keys que las otras secciones
// para continuidad entre Arranque, Documentación (viewer), Competencia,
// Bandeja y Gastos.

import React, { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import {
  Package, Target, Play, Check, Loader2, AlertTriangle, ChevronRight, ChevronDown,
  Plus, X, Sparkles, Link2, Search, Clock, Inbox, Trash2, Upload, Download, Activity,
  LayoutGrid, List as ListIcon, BarChart3, Copy, Pencil, MoreHorizontal,
} from 'lucide-react';
import { ideaFromDeepAnalysis, addGeneratedIdeas, loadIdeas, countIdeasGeneradorHoy, updateIdea, formatoDeAd } from './bandejaStore.js';
import { deleteProducto as deleteProductoFromCloud } from './marketingSync.js';
import { supabase } from './supabase.js';
import { downloadProductoExport, importProductoFromFile } from './productoExport.js';
import DiagnosticoSyncModal from './DiagnosticoSyncModal.jsx';
import { logCostsFromResponse } from './costsStore.js';
// Static imports — lazy() causaba TDZ en prod por chunking inconsistente.
import BandejaSection from './Bandeja.jsx';
import InspiracionSection from './InspiracionSection.jsx';
import CreativosTab from './CreativosTab.jsx';
import DocumentacionTab from './DocumentacionTab.jsx';
import CopilotoTab from './CopilotoTab.jsx';
import CampanasTracker from './CampanasTracker.jsx';
import GeneradorRapido from './GeneradorRapido.jsx';
import ProductoImagenUploader from './ProductoImagenUploader.jsx';
import GaleriaReferencialesModal from './GaleriaReferencialesModal.jsx';
import { usePipelineRun } from './PipelineRunContext.jsx';
import { getProductoImagen } from './productoImagen.js';
import { setCompAds, getCompAds, hydrateCompetidoresAds, removeCompAds } from './competidorAdsIDB.js';
import { stringifyApiError } from './apiHelpers.js';
import { trackQuotaFailure, isQuotaError, removeFromQuotaQueue } from './quotaRetryStore.js';
import AnimatedCounter from './AnimatedCounter.jsx';

// Avatar del producto: muestra el pote (foto cargada en Setup) y cae al
// gradiente con la inicial si todavía no hay foto. getProductoImagen resuelve
// desde IDB/cloud y está memoizado, así que es barato re-montarlo por card.
function ProductAvatar({ id, nombre, producto = null, sizeClass = 'w-12 h-12', radiusClass = 'rounded-lg', extra = '' }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    // Limpiamos la imagen previa al cambiar de id: si esta misma instancia se
    // reusa para otro producto, no mostramos la foto vieja mientras carga.
    setSrc(null);
    const load = () => {
      // ⚠️ CROSS-PC FIX: pasamos producto como fallback. Sin esto,
      // getProductoImagen leía readProducto(id) de localStorage; en PC2
      // el localStorage puede estar stale → fotoUrl ausente → null →
      // caía al avatar de letra ("C", "B", "P"). Con el producto en mano
      // (que el caller ya tiene del cloud-pull), accede a fotoUrl directo.
      getProductoImagen(id, producto)
        .then(img => { if (alive) setSrc(img || null); })
        .catch(() => {});
    };
    load();
    // Re-cargar cuando se sube/cambia/borra la foto (setProductoImagen patchea
    // el producto → dispara este evento). Sin esto el avatar mostraba la foto
    // vieja hasta recargar la página.
    const onChange = (e) => {
      if (!e?.detail?.key || e.detail.key.startsWith('adslab-marketing-productos')) load();
    };
    window.addEventListener('viora:marketing-storage-changed', onChange);
    return () => {
      alive = false;
      window.removeEventListener('viora:marketing-storage-changed', onChange);
    };
  }, [id]);
  if (src) {
    return (
      <img
        src={src}
        alt={nombre || 'Producto'}
        className={`${sizeClass} ${radiusClass} object-cover shrink-0 border border-black/5 dark:border-white/10 ${extra}`}
      />
    );
  }
  return (
    <div className={`${sizeClass} ${radiusClass} bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold shrink-0 ${extra}`}>
      {nombre?.charAt(0)?.toUpperCase() || 'P'}
    </div>
  );
}

// Etiquetas cortas de la etapa de awareness del prospecto — para el chip
// del header del workspace.
const STAGE_LABEL = {
  problem_aware: 'Problem-Aware',
  solution_aware: 'Solution-Aware',
  product_aware: 'Product-Aware',
};

const GEN_CONFIG_KEY = 'adslab-marketing-gen-config-v1';
const DEFAULT_GEN_CONFIG = {
  limiteDiario: 50,
  formatoStatic: 60, // %
  formatoVideo: 40, // %
};
// Tope superior de ideas por corrida. Con el generador en TANDAS (chunking
// de a 12), ya no hay riesgo de truncar una respuesta gigante — cada tanda
// es una request corta. Por eso el techo puede ser alto: 200 ideas por
// corrida. El user igual controla el volumen real con el límite diario.
const MAX_IDEAS_PER_RUN = 200;

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const COMPETIDORES_KEY = 'adslab-marketing-competidores-v1';
const META_ACCOUNT_KEY = 'adslab-marketing-meta-account-v1';
const LAST_RUN_KEY = 'adslab-marketing-last-pipeline-run-v1';
const RUN_HISTORY_KEY = 'adslab-marketing-run-history-v1';
// Cap del historial guardado — cada entry tiene los steps + stats + cost.
// 20 corridas cubren ~3 semanas a 1 run/día, sin explotar localStorage.
const RUN_HISTORY_CAP = 20;
// Marker que seteamos mientras corre el pipeline. Si al montar Arranque lo
// encontramos pero `running=false`, significa que el user cerró/refreshó la
// pestaña a medio run. Sirve para no dejar al user sin aviso de que quedaron
// docs/ads/análisis a medias en el storage.
const PIPELINE_RUNNING_KEY = 'adslab-marketing-pipeline-running-v1';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Notificar al sync de Marketing si la key es relevante (productos o brands).
    if (key.startsWith('adslab-marketing-')) {
      try { window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', { detail: { key } })); } catch {}
    }
    return true;
  }
  catch (err) {
    // Quota exceeded es lo único que vamos a surface — el resto de errores
    // (storage disabled en navegadores raros) no son accionables y mantienen
    // el comportamiento previo de fallar silencioso.
    if (err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014)) {
      // ANTES: dispatcheábamos el toast en seguida sin intentar liberar
      // nada. Pero hay caches gordas (skeleton, creative-refresh, debug log
      // viejo) que ocupan MB y son descartables. Replicamos la estrategia
      // de marketingSync.js: liberar caches → retry → si AÚN no entra,
      // recién ahí surface el error al user.
      const cachesAReleasar = [
        'adslab-marketing-skeleton-cache',
        'adslab-marketing-creative-refresh-cache',
        'adslab-marketing-execution-log',
        'adslab-marketing-cost-log',
        'adslab-debug-log-v1',
      ];
      let liberadas = 0;
      for (const k of cachesAReleasar) {
        try {
          if (localStorage.getItem(k)) { localStorage.removeItem(k); liberadas++; }
        } catch {}
      }
      if (liberadas > 0) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
          if (key.startsWith('adslab-marketing-')) {
            try { window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', { detail: { key } })); } catch {}
          }
          console.info(`[saveJSON] quota recuperado liberando ${liberadas} caches`);
          return true;
        } catch {
          // sigue sin entrar — caer al toast
        }
      }
      try {
        // Notificamos vía CustomEvent así el componente puede mostrar toast
        // sin tener que pasar `addToast` a esta función pura.
        window.dispatchEvent(new CustomEvent('adslab-storage-quota-exceeded', { detail: { key } }));
      } catch {}
    }
    return false;
  }
}

// Consume el stream SSE de /api/marketing/generate y devuelve los docs
// cuando el stream se completa. onProgress recibe strings de estado para
// mostrar en el stepper mientras corre. onCost recibe el breakdown { anthropic, total }
// emitido por el server por step (incremental) y al final como total.
async function streamGenerateDocs({ productoNombre, productoUrl, descripcion, productoId, authToken, onProgress, onCost }) {
  // producto.id + auth token van server-side para que cada step se persista a
  // Supabase apenas se completa. Si el user cierra la pestaña a mitad, los
  // docs ya hechos están guardados — en el próximo login los recupera.
  const resp = await fetch('/api/marketing/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ productoNombre, productoUrl, descripcion, productoId }),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`/api/marketing/generate HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const outputs = {};
  let resumenEjecutivo = '';
  // Tracking para mejor diagnóstico cuando docs incompletos.
  let stepStartsSeen = 0;
  let lastStepStarted = null;
  let streamCompleted = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === 'info' && ev.message) onProgress?.(ev.message);
        else if (ev.type === 'step-start') {
          stepStartsSeen++;
          lastStepStarted = ev.label || ev.key;
          onProgress?.(`Generando ${ev.label}…`);
        }
        else if (ev.type === 'step-done') {
          outputs[ev.key] = ev.content;
          if (ev.key === 'resumenEjecutivo') resumenEjecutivo = ev.content || '';
          onProgress?.(`✓ ${ev.label} listo`);
        } else if (ev.type === 'step-cost' && ev.cost) {
          // Cost incremental por paso — lo reportamos al runner para que
          // se vea en vivo en el display "💰 $X" sin esperar al complete.
          onCost?.(ev.cost, `docs · ${ev.label || ev.key || ''}`);
        } else if (ev.type === 'error') {
          throw new Error(ev.error || 'Error en el stream de docs');
        } else if (ev.type === 'complete') {
          streamCompleted = true;
          // El cliente ya recibió los step-cost incrementales — el cost
          // total del `complete` es solo para validación del lado del
          // server, NO lo volvemos a sumar (sería doble contabilización).
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue; // línea parcial
        throw err;
      }
    }
  }

  // Validamos que todos los docs hayan llegado completos. Si el stream
  // se cortó a mitad (red flap, 503 transitorio del proveedor) podemos
  // tener `research` listo pero `avatar` vacío — y la condición de skip
  // downstream (`!docs?.research`) nos haría tratar al producto como
  // documentado cuando le falta material crítico para el generador.
  // Mejor fallar acá explícitamente y que el user reintente.
  const REQUIRED_DOCS = ['research', 'avatar', 'offerBrief', 'beliefs'];
  const incomplete = REQUIRED_DOCS.filter(k => !outputs[k] || String(outputs[k]).trim().length < 200);
  if (incomplete.length > 0) {
    // Diagnóstico accionable según en qué estado quedó el stream:
    //   - 0 step-start: server murió antes de arrancar (scrape landing, init).
    //   - N start, no complete: timeout de Vercel (300s) o red caída
    //     durante "<lastStepStarted>".
    //   - complete + outputs vacíos: Anthropic devolvió content vacío
    //     (safety filter / edge case con el nombre).
    let diag;
    if (stepStartsSeen === 0) {
      diag = 'El server no arrancó ningún paso — probablemente falló al scrapear la landing (15s timeout) o se cayó antes de empezar.';
    } else if (!streamCompleted) {
      diag = `Se cortó durante "${lastStepStarted || 'desconocido'}". Probable: timeout de Vercel (300s), red del cliente caída, o Anthropic colgado. Reintentá — los docs ya completos se persistieron server-side.`;
    } else {
      diag = `Stream completo pero faltan: ${incomplete.join(', ')}. Anthropic devolvió contenido vacío (safety filter o prompt edge case). Reintentá; si vuelve a fallar, simplificá el nombre del producto.`;
    }
    throw new Error(`Documentación incompleta. ${diag}`);
  }

  return { docs: outputs, resumenEjecutivo };
}

// Derivamos keyword para búsqueda en Ad Library (igual que el bookmarklet
// del user):
//   - app.dropi: último segmento del path con guiones como espacios
//   - resto: hostname completo con TLD (ej: "elova.es" — NO recortar a "elova",
//     Meta Ad Library da resultados distintos con cada forma).
function landingToKeyword(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('app.dropi')) {
      const parts = u.pathname.split('/').filter(Boolean);
      return (parts[parts.length - 1] || '').replace(/-/g, ' ');
    }
    return u.hostname.replace(/^www\./, '');
  } catch {
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

// Hostname normalizado (sin www) — para detectar competidores duplicados:
// dos landings del mismo dominio son la misma marca, no importa el path.
function hostnameOf(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

// Deriva el nombre de la marca desde la URL de la landing.
// Ej: "https://femprobiotics.co/products/x" → "Femprobiotics".
// Saca los segmentos de TLD comunes y se queda con el más largo de lo
// que resta (ej. "app.dropi.com.ar" → "Dropi").
function brandFromUrl(url) {
  const host = hostnameOf(url);
  if (!host) return '';
  const TLDS = new Set(['com', 'co', 'net', 'org', 'io', 'ar', 'es', 'mx', 'cl', 'pe', 'uy', 'br', 'app', 'shop', 'store', 'online', 'me']);
  const segments = host.split('.').filter(s => s && !TLDS.has(s));
  if (segments.length === 0) return '';
  const main = segments.reduce((a, b) => (b.length > a.length ? b : a), '');
  return main.charAt(0).toUpperCase() + main.slice(1);
}

// Parsea la respuesta de un endpoint de forma defensiva. Si NO es JSON
// válido —típicamente cuando una serverless function de Vercel crashea o
// timeoutea y Vercel devuelve su página de error en texto plano ("An error
// occurred...")— tiramos un mensaje claro en lugar del críptico
// "Unexpected token 'A'... is not valid JSON".
async function parseJsonResponse(resp, contextLabel) {
  const raw = await resp.text();
  try {
    return JSON.parse(raw);
  } catch {
    // Vercel mata la función serverless al pasar maxDuration y devuelve
    // su página HTML genérica "Internal Server Error" / "An error occurred
    // with your deployment". Detectamos esos patrones para dar un mensaje
    // accionable en lugar del críptico "Unexpected token '<' is not JSON".
    const isVercelTimeout = /FUNCTION_INVOCATION_TIMEOUT|TIMEOUT|gateway timeout/i.test(raw);
    const isVercelGenericError = /Internal Server Error|An error occurred with your deployment|FUNCTION_INVOCATION_FAILED/i.test(raw);
    const isHTML = /^\s*<(!doctype|html)/i.test(raw);
    const status5xx = resp.status === 504 || resp.status === 502 || resp.status === 500;

    let detalle;
    if (isVercelTimeout || resp.status === 504) {
      detalle = 'el servidor tardó demasiado y cortó la conexión (timeout > 300s) — reintentá en la próxima corrida';
    } else if (isVercelGenericError || (isHTML && status5xx)) {
      detalle = 'la función serverless crasheó o agotó memoria — Vercel devolvió error genérico. Reintentá; si persiste, revisá los logs en Vercel';
    } else if (status5xx) {
      detalle = `el servidor devolvió un error inesperado (HTTP ${resp.status})`;
    } else {
      detalle = `respuesta no-JSON inesperada (HTTP ${resp.status})`;
    }
    throw new Error(`${contextLabel}: ${detalle}`);
  }
}

// =========================================================
// Componentes internos ANTES del export — fix TDZ Vite/Rollup.
// =========================================================

function RunHistoryCard({ history, onClear }) {
  const [collapsed, setCollapsed] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState(null);

  if (!history || history.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-3 text-left"
      >
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
          <Clock size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            Historial de corridas
            <span className="ml-2 text-[10px] font-normal text-gray-500 dark:text-gray-400">
              {history.length} corrida{history.length !== 1 ? 's' : ''} guardada{history.length !== 1 ? 's' : ''}
            </span>
          </h3>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Lo que ejecutaste antes no se pierde — click para ver cuándo corriste + qué pasó + cuánto costó.
          </p>
        </div>
        <ChevronDown
          size={16}
          className={`text-gray-400 transition-transform shrink-0 ${collapsed ? '' : 'rotate-180'}`}
        />
      </button>

      {!collapsed && (
        <div className="mt-4 space-y-2">
          {history.map(run => {
            const fecha = new Date(run.startedAt).toLocaleString('es-AR', {
              year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            });
            const durMin = run.durationMs ? Math.round(run.durationMs / 60000) : 0;
            const durSec = run.durationMs ? Math.round((run.durationMs % 60000) / 1000) : 0;
            const dur = durMin > 0 ? `${durMin}m ${durSec}s` : `${durSec}s`;
            const isExpanded = expandedRunId === run.id;
            const hasErrors = (run.stats?.stepsError || 0) > 0;

            return (
              <div key={run.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                  className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition text-left"
                >
                  <ChevronRight size={14} className={`text-gray-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {fecha}
                      {hasErrors && <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400 font-bold">⚠ {run.stats.stepsError} error{run.stats.stepsError !== 1 ? 'es' : ''}</span>}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 flex-wrap mt-0.5">
                      <span>⏱ {dur}</span>
                      {run.stats?.competidoresCount > 0 && (
                        <span>· {run.stats.competidoresOk}/{run.stats.competidoresCount} competidores ok</span>
                      )}
                      {run.stats?.breakdown && (
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          · 💡 {run.stats.breakdown.ideasNuevas} idea{run.stats.breakdown.ideasNuevas !== 1 ? 's' : ''}
                        </span>
                      )}
                      {run.cost?.total > 0 && (
                        <span className="text-brand-600 dark:text-brand-400 font-mono">· 💰 ${run.cost.total.toFixed(4)}</span>
                      )}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-3 py-2">
                    {run.stats?.breakdown && (
                      <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                          📊 Qué generó esta corrida
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { label: 'Total ideas', val: run.stats.breakdown.ideasNuevas, cls: 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300' },
                            { label: '🔵 Réplicas', val: run.stats.breakdown.replica },
                            { label: '🟡 Iteraciones', val: run.stats.breakdown.iteracion },
                            { label: '🟢 Diferenciación', val: run.stats.breakdown.diferenciacion },
                            { label: '✨ Desde cero', val: run.stats.breakdown.desde_cero },
                            { label: '🖼️ Para imagen', val: run.stats.breakdown.imagenes },
                            { label: '🎬 Para video', val: run.stats.breakdown.videos },
                            { label: '🏆 Winners analizados', val: run.stats.winnersAnalyzed || 0 },
                            ...(run.stats.hooksLowScore ? [{ label: '⚠ Hooks flojos', val: run.stats.hooksLowScore, cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' }] : []),
                          ].map((p, i) => (
                            <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded ${p.cls || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                              {p.label} <span className="font-bold tabular-nums">{p.val}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <ul className="space-y-0.5 text-[10px]">
                      {(run.steps || []).map((s, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="shrink-0 w-4 text-center">
                            {s.status === 'done' ? '✓' : s.status === 'error' ? '✗' : '○'}
                          </span>
                          <span className={`flex-1 min-w-0 ${s.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                            <span className="font-semibold">{s.label}</span>
                            {s.detail && <span className="block text-gray-500 dark:text-gray-400 ml-0">{s.detail}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {run.cost && run.cost.total > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-[10px] font-mono text-gray-600 dark:text-gray-400 flex flex-wrap gap-2">
                        <span className="text-brand-600 dark:text-brand-400 font-bold">💰 ${run.cost.total.toFixed(4)}</span>
                        {run.cost.anthropic > 0 && <span>🧠 ${run.cost.anthropic.toFixed(4)}</span>}
                        {run.cost.openai > 0 && <span>🎤 ${run.cost.openai.toFixed(4)}</span>}
                        {run.cost.apify > 0 && <span>🔍 ${run.cost.apify.toFixed(4)}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <button
            onClick={onClear}
            className="mt-2 text-[10px] text-gray-400 hover:text-red-500 transition"
          >
            Borrar historial
          </button>
        </div>
      )}
    </div>
  );
}

// Guía del flujo del módulo. Vive arriba de todo (lista de productos y
// workspace) para que sea la MISMA referencia desde cualquier tab, incluida
// Bandeja. Colapsada por defecto como un pill chico para no sumar ruido
// ("demasiada info"): el user la abre solo si la necesita. El estado
// abierto/cerrado se persiste.
const FLOW_STEPS = [
  { emoji: '⚙️', tab: 'setup', titulo: 'Setup', desc: 'Cargá el producto (foto, oferta) y sus competidores.' },
  { emoji: '▶️', tab: null, titulo: 'Correr pipeline', desc: 'Leemos los ads ganadores de la competencia y armamos ideas.' },
  { emoji: '📥', tab: 'bandeja', titulo: 'Bandeja', desc: 'Revisás cada idea y generás el creativo ahí mismo.' },
  { emoji: '🎨', tab: 'creativos', titulo: 'Creativos', desc: 'Ves los estáticos generados, listos para descargar.' },
  { emoji: '🧠', tab: 'copiloto', titulo: 'Santi', desc: 'Hablale a Santi — el cerebro de la plataforma. Pedíle variantes, ajustes o feedback en lenguaje natural.' },
];

function FlowGuide() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('adslab-flow-guide-open') === '1'; } catch { return false; }
  });
  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('adslab-flow-guide-open', next ? '1' : '0'); } catch {}
      return next;
    });
  };
  const goTab = (tab) => {
    if (!tab) return;
    try { window.dispatchEvent(new CustomEvent('viora:product-tab', { detail: { tab } })); } catch {}
  };
  return (
    <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-brand-100/60 dark:hover:bg-brand-900/30 transition"
        title={open ? 'Ocultar guía' : 'Ver cómo funciona el módulo'}
      >
        <span className="shrink-0">🗺️</span>
        <span className="flex-1 min-w-0 text-[12px] font-bold text-brand-800 dark:text-brand-200">
          ¿Cómo funciona? <span className="font-normal text-brand-600/80 dark:text-brand-400/80">— guía rápida del flujo en 5 pasos</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-brand-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1">
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
            {FLOW_STEPS.map((s, i) => (
              <button
                key={s.titulo}
                onClick={() => goTab(s.tab)}
                disabled={!s.tab}
                className={`flex flex-col gap-0.5 p-2 rounded-md border text-left transition ${
                  s.tab
                    ? 'bg-white/70 dark:bg-gray-800/50 border-brand-200 dark:border-brand-800 hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-sm cursor-pointer'
                    : 'bg-white/40 dark:bg-gray-800/30 border-brand-200/60 dark:border-brand-800/60 cursor-default'
                }`}
              >
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-brand-800 dark:text-brand-200">
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}.</span>
                  <span>{s.emoji}</span>{s.titulo}
                </span>
                <span className="text-[10px] leading-snug text-gray-600 dark:text-gray-400">{s.desc}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-brand-600/70 dark:text-brand-400/70">
            Tip: tocá un paso para saltar a esa tab. Setup → pipeline es lo primero; el resto se va llenando solo.
          </p>
        </div>
      )}
    </div>
  );
}

// Tabs del workspace de un producto: Setup / Bandeja / Inspiración / Creativos.

function ProductTabs({ activeTab, onChange }) {
  // Dos grupos para que un usuario nuevo entienda el flujo a primera vista:
  // - "Datos": configuración + información del producto / competencia.
  // - "Creación": donde se generan y ven los outputs (ideas + creativos).
  const groups = [
    {
      id: 'datos',
      label: 'Datos',
      tabs: [
        { id: 'setup', label: 'Setup', emoji: '⚙️' },
        { id: 'documentos', label: 'Documentos', emoji: '📄' },
        { id: 'campanas', label: 'Campañas', emoji: '📈' },
      ],
    },
    {
      id: 'creacion',
      label: 'Creación',
      tabs: [
        { id: 'bandeja', label: 'Bandeja', emoji: '📥' },
        { id: 'inspiracion', label: 'Inspiración', emoji: '✨' },
        { id: 'creativos', label: 'Creativos', emoji: '🎨' },
        { id: 'galeria', label: 'Galería', emoji: '🖼️' },
        { id: 'copiloto', label: 'Santi', emoji: '🧠' },
      ],
    },
  ];
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto p-1 bg-gray-100 dark:bg-gray-800/70 rounded-xl border border-gray-200 dark:border-gray-700">
      {groups.map((g, idx) => (
        <Fragment key={g.id}>
          {idx > 0 && (
            <div className="w-px bg-gray-300 dark:bg-gray-600 my-1.5 shrink-0" aria-hidden />
          )}
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-1.5 hidden md:inline">
              {g.label}
            </span>
            {g.tabs.map(t => (
              <button
                key={t.id}
                onClick={() => onChange(t.id)}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg transition shrink-0 flex items-center gap-1.5 ${
                  activeTab === t.id
                    ? 'bg-white dark:bg-gray-700 text-brand-700 dark:text-brand-200 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-white/60 dark:hover:bg-gray-700/40'
                }`}
              >
                <span>{t.emoji}</span>{t.label}
              </button>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// Métrica limpia (número grande + label chico, sin caja) para las cards de
// producto. Estilo dashboard pro (Linear/Vercel): jerarquía por tipografía,
// no por bordes.
// Menú de acciones secundarias del header de la lista de productos
// (Diagnóstico, Importar). Antes vivían como 2 botones que saturaban
// el header. Ahora colapsadas detrás de un "•••" — accionables pero
// fuera del primer scroll.
function ProductosOverflowMenu({ onDiagnostico, onImportar }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:border-brand-300 dark:hover:border-brand-700 transition"
        title="Más opciones">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 w-44 glass-card border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 animate-fade-in-down">
          <button onClick={() => { onImportar?.(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition text-left">
            <Upload size={13} /> Importar producto
          </button>
          <button onClick={() => { onDiagnostico?.(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition text-left">
            <Activity size={13} /> Diagnóstico cloud
          </button>
        </div>
      )}
    </div>
  );
}

function ProductMetric({ label, value, tone = 'default', animate = true }) {
  const tones = {
    default: 'text-gray-900 dark:text-gray-100',
    brand: 'text-brand-600 dark:text-brand-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    muted: 'text-gray-300 dark:text-gray-600',
  };
  // Si value es número y queremos animar, usamos AnimatedCounter. Si ya
  // viene formateado (ej. "1,234") lo mostramos tal cual.
  const numericValue = typeof value === 'number' ? value : null;
  return (
    <div className="min-w-0">
      <p className={`text-lg font-bold tabular-nums leading-none ${tones[tone] || tones.default}`}>
        {animate && numericValue !== null
          ? <AnimatedCounter value={numericValue} />
          : value}
      </p>
      <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-1 truncate">{label}</p>
    </div>
  );
}


// Nombre del producto editable inline. Por defecto muestra el nombre como
// texto; al tocar el lápiz se vuelve input. Delega el guardado a onRename
// (el padre persiste y, si hay research viejo, ofrece regenerarlo).
function ProductoNombreEditable({ producto, onRename }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(producto.nombre || '');

  const guardar = () => {
    const nombre = val.trim();
    if (!nombre || nombre === producto.nombre) { setEditing(false); setVal(producto.nombre || ''); return; }
    onRename(nombre);
    setEditing(false);
  };

  if (!editing) {
    return (
      <p className="flex items-center gap-1.5 group/nombre">
        <strong>{producto.nombre}</strong>
        <button
          onClick={() => { setVal(producto.nombre || ''); setEditing(true); }}
          title="Cambiar nombre"
          className="opacity-0 group-hover/nombre:opacity-100 transition text-gray-400 hover:text-brand-600 dark:hover:text-brand-400"
        >
          <Pencil size={11} />
        </button>
      </p>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') { setEditing(false); setVal(producto.nombre || ''); } }}
        onBlur={guardar}
        className="px-2 py-0.5 text-xs font-bold bg-white dark:bg-gray-700 border border-brand-400 dark:border-brand-600 rounded focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-0 flex-1 max-w-[260px]"
      />
      <button onMouseDown={e => e.preventDefault()} onClick={guardar}
        title="Guardar" className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700">
        <Check size={13} />
      </button>
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


function StepRow({ step, liveIdeas, onRerun, rerunBusy = false }) {
  const { status, label, detail, startedAt, endedAt } = step;
  const elapsed = startedAt
    ? Math.round(((endedAt || Date.now()) - startedAt) / 1000)
    : null;

  const TIPO_EMOJI = { replica: '🔵', iteracion: '🟡', diferenciacion: '🟢', desde_cero: '✨' };

  return (
    <li className={`rounded-md text-xs transition ${
      status === 'running' ? 'bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800' :
      status === 'done' ? 'bg-emerald-50/50 dark:bg-emerald-900/10' :
      status === 'error' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' :
      'bg-gray-50/50 dark:bg-gray-800/30'
    }`}>
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="mt-0.5 shrink-0">
          {status === 'running' && <Loader2 size={13} className="animate-spin text-brand-600 dark:text-brand-400" />}
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
        {onRerun && (status === 'done' || status === 'error') && (
          <button
            onClick={onRerun}
            disabled={rerunBusy}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-700 border border-brand-300 dark:border-brand-700 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 transition disabled:opacity-50"
            title="Re-ejecutar este paso solo"
          >
            {rerunBusy ? <Loader2 size={10} className="animate-spin" /> : <>↻ Re-ejecutar</>}
          </button>
        )}
        {elapsed != null && status !== 'pending' && (
          <span className="text-[10px] font-mono text-gray-400 shrink-0">{elapsed}s</span>
        )}
      </div>

      {/* Mini-lista de ideas cayendo en vivo (solo en el paso 'generate') */}
      {Array.isArray(liveIdeas) && liveIdeas.length > 0 && status !== 'pending' && (
        <ul className="px-3 pb-2 pl-9 space-y-1 max-h-52 overflow-y-auto">
          {liveIdeas.map((idea, i) => (
            <li key={i} className="flex items-start gap-2 text-[10px] text-gray-700 dark:text-gray-300 animate-fade-in-up">
              <span className="shrink-0 mt-0.5">{TIPO_EMOJI[idea.tipo] || '•'}</span>
              <span className="flex-1 min-w-0">
                <span className="font-semibold truncate block">{idea.titulo}</span>
                {idea.hook && <span className="text-gray-500 dark:text-gray-400 italic truncate block">"{idea.hook.slice(0, 80)}{idea.hook.length > 80 ? '…' : ''}"</span>}
              </span>
              <span className="shrink-0 text-[9px] text-gray-400 font-mono">{idea.formato}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}


export default function ArranqueSection({ addToast, onGoToSection }) {
  const [productos, setProductos] = useState(() => {
    const prods = loadJSON(PRODUCTOS_KEY, []);
    let mutated = false;
    // Migración: si hay competidores globales sueltos y el primer producto
    // no tiene competidores propios, los migramos al primer producto.
    const globalComps = loadJSON(COMPETIDORES_KEY, []);
    if (globalComps.length > 0 && prods.length > 0 && !prods[0].competidores?.length) {
      prods[0] = { ...prods[0], competidores: globalComps };
      mutated = true;
    }
    // Migración: cuenta Meta global → al primer producto si no tiene una.
    const globalMeta = loadJSON(META_ACCOUNT_KEY, null);
    if (globalMeta && prods.length > 0 && !prods[0].metaAccount) {
      prods[0] = { ...prods[0], metaAccount: globalMeta };
      mutated = true;
    }
    if (mutated) {
      saveJSON(PRODUCTOS_KEY, prods);
      try { localStorage.removeItem(COMPETIDORES_KEY); } catch {}
      try { localStorage.removeItem(META_ACCOUNT_KEY); } catch {}
    }
    return prods;
  });

  // Re-leer productos del localStorage cuando termina el pull del cloud,
  // cuando otra parte del código actualiza localStorage (eventos
  // viora:marketing-storage-changed dispatcheados por InspiracionSection
  // tras scrapear, etc), o ante storage events de otras tabs.
  // Sin esto, si el user entra con localStorage vacío en la URL nueva,
  // el pull baja los productos a localStorage pero Arranque queda con
  // su state inicial = [] → user ve "Sin productos" hasta que refresca.
  useEffect(() => {
    const reload = () => {
      try {
        const fresh = loadJSON(PRODUCTOS_KEY, []);
        if (Array.isArray(fresh)) {
          // Comparación PROFUNDA por JSON.stringify. Antes comparábamos solo
          // length + ids — eso preservaba el `prev` stale cuando otro
          // componente (InspiracionSection.handleScrapeCompetidor) actualizaba
          // lastAdsCheck DENTRO de p.competidores: misma cantidad, mismos
          // ids, pero datos profundos cambiados. Resultado: scrape "perdido"
          // al re-pisar localStorage con el state stale al próximo render.
          setProductos(prev => {
            const prevStr = JSON.stringify(prev);
            const freshStr = JSON.stringify(fresh);
            return prevStr === freshStr ? prev : fresh;
          });
        }
      } catch {}
    };
    // Cobertura:
    // 1. viora:marketing-pulled — pullMarketingFromCloud terminó
    // 2. viora:marketing-storage-changed — otro componente escribió
    //    localStorage en la misma tab (no dispara 'storage' nativo)
    // 3. storage — otra tab modificó localStorage
    // 4. Polling cada 3s durante los primeros 15s (defensivo, antes de
    //    los eventos custom existiera; queda como red de seguridad)
    window.addEventListener('viora:marketing-pulled', reload);
    window.addEventListener('viora:marketing-storage-changed', reload);
    const onStorage = (e) => {
      if (!e.key || e.key === PRODUCTOS_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    let polls = 0;
    const pollId = setInterval(() => {
      polls++;
      reload();
      if (polls >= 5) clearInterval(pollId);
    }, 3000);
    return () => {
      window.removeEventListener('viora:marketing-pulled', reload);
      window.removeEventListener('viora:marketing-storage-changed', reload);
      window.removeEventListener('storage', onStorage);
      clearInterval(pollId);
    };
  }, []);

  // Producto activo — null = vista de lista, id = workspace del producto.
  // IMPORTANTE: arrancamos siempre en null (vista de lista) — el user pidió
  // que al entrar a Marketing tenga que elegir el producto, NO que lo
  // auto-meta en el último que abrió. El click en una card del listado lo
  // setea. El back button del workspace lo limpia.
  const [activeProductoId, setActiveProductoId] = useState(() => {
    try { return localStorage.getItem('adslab-marketing-active-product') || null; } catch { return null; }
  });
  useEffect(() => {
    try {
      if (activeProductoId) localStorage.setItem('adslab-marketing-active-product', activeProductoId);
      else localStorage.removeItem('adslab-marketing-active-product');
      // Notificar al hook de sync — sin esto el cambio queda solo local
      // (el evento 'storage' nativo no se dispara en la misma tab que escribe).
      window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', {
        detail: { key: 'adslab-marketing-active-product' },
      }));
    } catch {}
  }, [activeProductoId]);
  // Re-hidratamos si OTRO componente (ej: Copiloto) cambió el producto activo.
  // El evento custom se dispara en la MISMA tab; el 'storage' nativo solo en
  // otras tabs. Cubrimos ambos.
  useEffect(() => {
    const sync = () => {
      try {
        const fresh = localStorage.getItem('adslab-marketing-active-product') || null;
        setActiveProductoId(prev => prev === fresh ? prev : fresh);
      } catch {}
    };
    window.addEventListener('viora:marketing-storage-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('viora:marketing-storage-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Tab activo dentro del workspace del producto (Setup / Bandeja / Inspiración / Creativos).
  // Se persiste por producto para que volver al mismo producto te lleve al
  // último tab que estabas viendo.
  const productoTabKey = activeProductoId ? `adslab-marketing-prod-tab-${activeProductoId}` : null;
  const [productoTab, setProductoTab] = useState('setup');
  // Bumpeamos esta key para forzar el remount de la Bandeja embebida cuando
  // el generador rápido inserta ideas — así aparecen sin recargar la página.
  const [bandejaRefreshKey, setBandejaRefreshKey] = useState(0);
  // Estado de la generación masiva de creativos. null = no corriendo. El
  // loop vive acá (no en la pestaña Bandeja) para que sobreviva al cambio
  // de pestaña dentro del workspace.
  useEffect(() => {
    if (!productoTabKey) { setProductoTab('setup'); return; }
    // Tabs retiradas (dashboard, competencia) caen a 'setup' — competencia
    // ahora vive como sección dentro de Setup.
    const REMOVED = ['dashboard', 'competencia'];
    try {
      const saved = localStorage.getItem(productoTabKey) || 'setup';
      setProductoTab(REMOVED.includes(saved) ? 'setup' : saved);
    } catch { setProductoTab('setup'); }
  }, [productoTabKey]);
  useEffect(() => {
    if (productoTabKey) try { localStorage.setItem(productoTabKey, productoTab); } catch {}
  }, [productoTab, productoTabKey]);

  // Sync del contexto del producto activo + lista para que el sidebar de
  // App.jsx pueda renderizar el nav vertical estilo Apify (lista de productos
  // con su set de tabs adentro del activo). Usamos eventos en lugar de prop
  // drilling para no tener que tocar 5 componentes intermedios.
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('viora:product-ctx', {
        detail: {
          productos: productos.map(p => ({ id: String(p.id), nombre: p.nombre || `Producto ${p.id}` })),
          activeProductoId: activeProductoId != null ? String(activeProductoId) : null,
          activeTab: productoTab,
        },
      }));
    } catch {}
    return () => {
      try { window.dispatchEvent(new CustomEvent('viora:product-ctx-clear')); } catch {}
    };
  }, [productos, activeProductoId, productoTab]);

  // Listener: el sidebar dispara 'viora:product-select' cuando el user clickea
  // otro producto en el menú lateral. Cambiamos el active acá.
  useEffect(() => {
    const onSelect = (e) => {
      const id = e?.detail?.productoId;
      if (id != null) setActiveProductoId(String(id));
    };
    const onTab = (e) => {
      const tab = e?.detail?.tab;
      // Tabs retiradas caen a 'setup' (competencia ahora vive ahí).
      if (tab) setProductoTab(['dashboard', 'competencia'].includes(tab) ? 'setup' : tab);
    };
    window.addEventListener('viora:product-select', onSelect);
    window.addEventListener('viora:product-tab', onTab);
    return () => {
      window.removeEventListener('viora:product-select', onSelect);
      window.removeEventListener('viora:product-tab', onTab);
    };
  }, []);

  // Cuando estamos parados en tab Setup, el stepper inline ya muestra el
  // progreso detallado del pipeline — el pill flotante sería redundante.
  // En cualquier otro tab (o sin producto activo), dejamos el pill visible.
  useEffect(() => {
    const inSetup = !!activeProductoId && productoTab === 'setup';
    pipelineRun.setSuppressOverlay?.(inSetup);
    return () => pipelineRun.setSuppressOverlay?.(false);
  }, [activeProductoId, productoTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Producto activo derivado + competidores + cuenta Meta del producto activo.
  const producto = productos.find(p => String(p.id) === String(activeProductoId)) || null;
  const competidoresBase = producto?.competidores || [];
  // Ads ahora viven en IDB. compAdsByCompId hidrata por competidor.id.
  // useMemo de `competidores` mete los ads adentro para que el código
  // legacy (memos, pipeline) sigan leyendo c.ads como antes.
  const [compAdsByCompId, setCompAdsByCompId] = useState({});
  const [hydratingAds, setHydratingAds] = useState(false);
  // RESET al cambiar producto — sin esto el state acumula entries de TODOS
  // los productos navegados → memory leak masivo (50 productos × 5 comps ×
  // 200 ads × 5KB ≈ 250MB en el state). Hacemos cleanup explícito.
  const prevProductoIdRef = useRef(null);
  useEffect(() => {
    if (prevProductoIdRef.current && prevProductoIdRef.current !== producto?.id) {
      setCompAdsByCompId({});
    }
    prevProductoIdRef.current = producto?.id;
  }, [producto?.id]);
  useEffect(() => {
    let cancelled = false;
    if (!producto?.id) { setCompAdsByCompId({}); return; }
    setHydratingAds(true);
    (async () => {
      // PRIORITY: IDB > inline legacy. Antes preferíamos inline si existía,
      // lo que dejaba productos parcialmente migrados leyendo datos stale.
      const updates = {};
      const recordsByCompId = {};
      for (const c of competidoresBase) {
        const rec = await getCompAds(producto.id, c.id);
        if (rec?.ads?.length) { updates[c.id] = rec.ads; recordsByCompId[c.id] = rec; continue; }
        if (Array.isArray(c.ads) && c.ads.length > 0) { updates[c.id] = c.ads; }
      }
      if (!cancelled) {
        // MERGE FIX (round 3): antes comparábamos `ads.length > prev.length`
        // que perdía datos cuando un re-scrape devolvía MENOS ads (algunos
        // expiraron en Meta). Ahora comparamos por timestamp (ts del record
        // IDB). El más fresco gana, sin importar el length.
        setCompAdsByCompId(prev => {
          const next = {};
          const validIds = new Set(competidoresBase.map(c => c.id));
          // Conservar solo entries de comps que aún existen (drop zombi).
          for (const [k, v] of Object.entries(prev)) {
            if (validIds.has(k)) next[k] = v;
          }
          // Aplicar updates priorizando frescura por timestamp.
          for (const [cid, ads] of Object.entries(updates)) {
            const rec = recordsByCompId[cid];
            const incomingTs = rec?.ts || 0;
            const currentTs = next[cid]?._ts || 0;
            if (!next[cid] || incomingTs >= currentTs) {
              next[cid] = ads;
              if (incomingTs) ads._ts = incomingTs;
            }
          }
          return next;
        });
        setHydratingAds(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto?.id, competidoresBase.length, competidoresBase.map(c => c.lastAdsCheck).join('|')]);
  const competidores = useMemo(
    () => competidoresBase.map(c => (compAdsByCompId[c.id] ? { ...c, ads: compAdsByCompId[c.id] } : c)),
    [competidoresBase, compAdsByCompId]
  );
  const metaAccount = producto?.metaAccount || null;
  // Setter de competidores que los guarda DENTRO del producto activo.
  const setCompetidores = (updater) => {
    setProductos(prev => prev.map(p => {
      if (String(p.id) !== String(activeProductoId)) return p;
      const current = p.competidores || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...p, competidores: next };
    }));
  };
  // Setter de cuenta Meta que la guarda DENTRO del producto activo — cada
  // producto tiene su propio metaAccount con sus ads + su productMatched.
  const setMetaAccount = (updater) => {
    setProductos(prev => prev.map(p => {
      if (String(p.id) !== String(activeProductoId)) return p;
      const current = p.metaAccount || null;
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...p, metaAccount: next };
    }));
  };

  // Wizard product form
  const [showProdForm, setShowProdForm] = useState(false);
  const [showDiagnostico, setShowDiagnostico] = useState(false);
  // Vista de la lista de productos: 'grid' (tarjetas) | 'list' (filas compactas).
  const [vista, setVista] = useState(() => {
    try { return localStorage.getItem('adslab-productos-vista') || 'grid'; } catch { return 'grid'; }
  });
  useEffect(() => {
    try { localStorage.setItem('adslab-productos-vista', vista); } catch {}
  }, [vista]);
  const [prodDraft, setProdDraft] = useState({ nombre: '', landingUrl: '', descripcion: '' });

  // Wizard competitors
  const [showCompForm, setShowCompForm] = useState(false);
  const [compDraft, setCompDraft] = useState({ nombre: '', landingUrl: '', adLibraryUrl: '' });

  // Meta ad account picker
  const [metaConnected, setMetaConnected] = useState(null); // null = unknown, bool = checked
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);
  const [matching, setMatching] = useState(false);
  // Sugerencia de competidores
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  // Config del generador de ideas (límite diario + mix de formato)
  const [genConfig, setGenConfig] = useState(() => ({ ...DEFAULT_GEN_CONFIG, ...loadJSON(GEN_CONFIG_KEY, {}) }));
  // (Antes había acá un useEffect duplicado con los mismos listeners de
  // viora:product-select + viora:product-tab — venían de un merge fix viejo.
  // El useEffect de arriba ya cubre ambos. Eliminado para no duplicar dispatch.)

  const [showGenConfig, setShowGenConfig] = useState(false);
  // Inicializamos el contador de ideas del día YA filtrado por el producto
  // activo (si lo hay). Antes lo inicializábamos global y el effect lo
  // corregía después → flicker en pantalla con un número que no se respeta.
  const [ideasToday, setIdeasToday] = useState(() => {
    try {
      const aid = localStorage.getItem('adslab-marketing-active-product');
      return countIdeasGeneradorHoy(aid || null);
    } catch { return 0; }
  });

  // Pipeline runner — el state vive en el PipelineRunContext global para
  // que sobreviva al cambio de sección (corre en background mientras
  // navegás). Wrap los setters acá para keep API existente.
  const pipelineRun = usePipelineRun();
  const running = pipelineRun.running;
  const setRunning = (v) => { if (!v) pipelineRun.finishRun(); /* startRun se llama abajo con productoId */ };
  const steps = pipelineRun.steps;
  const setSteps = pipelineRun.setSteps;
  const liveIdeas = pipelineRun.liveIdeas;
  const setLiveIdeas = pipelineRun.setLiveIdeas;
  const runCost = pipelineRun.runCost;
  const setRunCost = pipelineRun.setRunCost;
  // Ref que sigue al `cancelRequested` del context. Antes leíamos el valor
  // como `const cancelled = pipelineRun.cancelRequested` y eso queda como
  // snapshot en el closure del `runPipeline()` — si el user clickea Cancelar
  // a mitad del run, los `if (cancelled) break` nunca disparan porque la
  // variable local no se actualiza. Usando un ref síncronizado con un effect
  // sí leemos el valor actual en cada chequeo.
  const cancelledRef = useRef(false);
  // AbortController para cancelar fetches in-flight. Antes el cancel solo
  // se checkeaba ENTRE awaits, así un deep-analyze de 60s que ya estaba
  // disparado se completaba y cobraba aunque el user clickara Cancelar.
  // Ahora cancelar dispara abort() y todas las fetches que pasaron
  // signal se cortan.
  const pipelineAbortRef = useRef(null);
  useEffect(() => {
    cancelledRef.current = pipelineRun.cancelRequested;
    if (pipelineRun.cancelRequested && pipelineAbortRef.current) {
      try { pipelineAbortRef.current.abort(); } catch {}
    }
  }, [pipelineRun.cancelRequested]);
  // Ref al <input type=file> oculto para que el botón "Importar" pueda
  // triggerar el file picker via click().
  const importFileInputRef = useRef(null);
  const setCancelled = (v) => { if (v) pipelineRun.requestCancel(); };
  // Historial de corridas — persistido. Al completar un run, pusheamos un
  // resumen (productoId, timestamps, steps, stats, costo). Luego se muestra
  // en la UI como colapsable para que el user vea qué se ejecutó antes.
  const [runHistory, setRunHistory] = useState(() => loadJSON(RUN_HISTORY_KEY, []));

  // Ref siempre actualizado al state más reciente de productos. Lo usamos
  // adentro del runner del pipeline para evitar leer snapshots stale del
  // closure cuando llamamos a pasos asincrónicos. Antes el runner leía de
  // `loadJSON(COMPETIDORES_KEY, ...)` que está borrado tras la migración,
  // y caía a un fallback que perdía actualizaciones recientes.
  const productosRef = useRef(productos);
  useEffect(() => { productosRef.current = productos; }, [productos]);

  // Ref a los steps del pipeline — para construir el resumen del run al
  // final SIN tener que leer `currentSteps` desde adentro del updater de
  // setSteps (donde meter un setRunHistory duplicaba la entrada si React
  // re-ejecutaba el updater).
  const stepsRef = useRef(pipelineRun.steps);
  useEffect(() => { stepsRef.current = pipelineRun.steps; }, [pipelineRun.steps]);

  useEffect(() => { saveJSON(PRODUCTOS_KEY, productos); }, [productos]);
  useEffect(() => { saveJSON(GEN_CONFIG_KEY, genConfig); }, [genConfig]);
  useEffect(() => { saveJSON(RUN_HISTORY_KEY, runHistory); }, [runHistory]);

  // Surface de quota exceeded — saveJSON dispara este event si el navegador
  // rechaza el write por límite (~5MB). El user necesita saber que dejamos
  // de persistir, sino podría perder docs/análisis al refrescar.
  useEffect(() => {
    const onQuota = (e) => {
      addToast?.({
        type: 'error',
        message: `Storage del navegador lleno (clave: ${e.detail?.key || '—'}). Limpiá historial o productos viejos para liberar espacio.`,
      });
    };
    window.addEventListener('adslab-storage-quota-exceeded', onQuota);
    return () => window.removeEventListener('adslab-storage-quota-exceeded', onQuota);
  }, [addToast]);

  // Detectar pipeline a medias: si al montar Arranque encontramos el marker
  // de "running" pero acá running=false, significa que el user cerró/refreshó
  // la pestaña a mitad de un run. Avisamos para que reinicie a mano.
  useEffect(() => {
    const stale = loadJSON(PIPELINE_RUNNING_KEY, null);
    if (stale && Date.now() - stale.startedAt < 30 * 60 * 1000 && !running) {
      addToast?.({
        type: 'warning',
        message: `Detecté un pipeline a medias de "${stale.productoNombre || 'un producto'}". Re-corré el pipeline para terminar lo que faltó.`,
      });
      try { localStorage.removeItem(PIPELINE_RUNNING_KEY); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo al mount

  // Mientras corre el pipeline, mantenemos un marker persistido. Si el user
  // cierra la pestaña a medio run, el efecto de arriba lo va a detectar al
  // próximo mount.
  useEffect(() => {
    if (running) {
      saveJSON(PIPELINE_RUNNING_KEY, {
        startedAt: Date.now(),
        productoId: pipelineRun.productoId,
        productoNombre: pipelineRun.productoNombre,
      });
    } else {
      try { localStorage.removeItem(PIPELINE_RUNNING_KEY); } catch {}
    }
  }, [running, pipelineRun.productoId, pipelineRun.productoNombre]);

  // Refrescar contador de ideas del día cada vez que montamos o cambia la bandeja.
  // Cuando hay producto activo, contamos solo las suyas.
  useEffect(() => {
    const count = () => setIdeasToday(countIdeasGeneradorHoy(activeProductoId || null));
    count();
    const interval = setInterval(count, 60 * 1000);
    return () => clearInterval(interval);
  }, [activeProductoId]);

  // Mix promedio de la competencia (% video vs static) — calculado sobre
  // todos los ads scrapeados de los competidores cargados. Sirve como
  // sugerencia del default: "tu competencia usa X% video, te recomendamos eso".
  // useMemo: con muchos ads (700+) iterar en cada render lagueaba el setup.
  const competitorMix = useMemo(() => {
    let totalAds = 0, totalVideo = 0;
    let winnerAds = 0, winnerVideo = 0;
    for (const c of competidores) {
      for (const ad of (c.ads || [])) {
        // Usamos el formato real (display_format de Meta vía formatoDeAd),
        // no la heurística vieja que marcaba video cualquier ad con un
        // rastro de video — sesgaba el mix de la competencia a video.
        const esVideo = formatoDeAd(ad) === 'video';
        totalAds++;
        if (esVideo) totalVideo++;
        if (ad.isWinner) {
          winnerAds++;
          if (esVideo) winnerVideo++;
        }
      }
    }
    if (totalAds === 0) return null;
    // El mix se calcula sobre los GANADORES, no sobre todos los ads: lo que
    // querés copiar es el formato de lo que FUNCIONA, no del descarte que la
    // competencia tira a la pared. Si hay pocos winners (<5) la muestra es
    // poco fiable y caemos al mix general.
    const usaWinners = winnerAds >= 5;
    const baseAds = usaWinners ? winnerAds : totalAds;
    const baseVideo = usaWinners ? winnerVideo : totalVideo;
    const videoPct = Math.round((baseVideo / baseAds) * 100);
    return {
      totalAds,
      winnerAds,
      basadoEnWinners: usaWinners,
      videoPct,
      staticPct: 100 - videoPct,
      competidoresConAds: competidores.filter(c => (c.ads || []).length > 0).length,
    };
  }, [competidores]);

  const usarMixCompetencia = () => {
    if (!competitorMix) return;
    // Piso de 25% static. Si la competencia es 100% video y copiábamos el
    // mix tal cual, el generador quedaba en 0% imagen → no producía NINGÚN
    // estático. Siempre querés algunas imágenes (las producís vos directo
    // con IA, y conviene testear ambos formatos).
    const staticPct = Math.max(25, competitorMix.staticPct);
    const videoPct = 100 - staticPct;
    setGenConfig(c => ({ ...c, formatoStatic: staticPct, formatoVideo: videoPct }));
    addToast?.({
      type: 'success',
      message: competitorMix.staticPct < 25
        ? `Mix ajustado a ${staticPct}/${videoPct} (la competencia usa ${competitorMix.staticPct}% imagen — subimos a 25% mínimo)`
        : `Mix ajustado al promedio de la competencia: ${staticPct}/${videoPct}`,
    });
  };

  // Chequeo rápido de conexión Meta al montar — solo para habilitar/deshabilitar la card.
  useEffect(() => {
    let abort = false;
    fetch('/api/meta/me')
      .then(r => r.json())
      .then(d => { if (!abort) setMetaConnected(!!d.connected); })
      .catch(() => { if (!abort) setMetaConnected(false); });
    return () => { abort = true; };
  }, []);

  // Cargar lista de ad accounts disponibles (llama cuando el user abre el picker).
  const loadAdAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const r = await fetch('/api/meta/ad-accounts');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setAvailableAccounts(d.accounts || []);
      if ((d.accounts || []).length === 0) {
        addToast?.({ type: 'info', message: 'No se encontraron cuentas publicitarias activas en tu Meta.' });
      }
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude listar cuentas: ${err.message}` });
    } finally {
      setLoadingAccounts(false);
    }
  };

  // Seleccionar una cuenta + traer sus ads activos con insights 7d.
  const selectAccount = async (acc) => {
    setLoadingAds(true);
    try {
      const url = `/api/meta/ads-with-insights?account_id=${encodeURIComponent(acc.id)}&limit=50&date_preset=last_7d`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const metaAcc = {
        id: acc.id,
        name: acc.name,
        currency: acc.currency,
        ads: d.ads || [],
        fetchedAt: new Date().toISOString(),
      };
      setMetaAccount(metaAcc);
      addToast?.({ type: 'success', message: `${(d.ads || []).length} ads cargados de ${acc.name}` });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude traer ads: ${err.message}` });
    } finally {
      setLoadingAds(false);
    }
  };

  const resetMetaAccount = () => {
    setMetaAccount(null);
    setAvailableAccounts([]);
  };

  // Matcher IA — identifica cuáles de los ads cargados son del producto actual.
  const matchProductAds = async () => {
    if (!producto?.nombre) {
      addToast?.({ type: 'error', message: 'Primero cargá el producto (paso 1)' });
      return;
    }
    if (!metaAccount?.ads?.length) {
      addToast?.({ type: 'error', message: 'Primero cargá los ads de la cuenta' });
      return;
    }
    setMatching(true);
    try {
      const resp = await fetch('/api/marketing/match-product-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto: {
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            landingUrl: producto.landingUrl,
          },
          ads: metaAccount.ads,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      logCostsFromResponse(data, `match-product-ads · ${metaAccount.ads.length} ads`);

      // Enriquecemos los ads con el confidence match.
      const matchMap = new Map(data.matches.map(m => [m.adId, m]));
      setMetaAccount(prev => prev ? {
        ...prev,
        ads: prev.ads.map(ad => {
          const m = matchMap.get(ad.id);
          return m ? { ...ad, productMatch: m } : { ...ad, productMatch: null };
        }),
        matchedAt: new Date().toISOString(),
        productMatched: producto.nombre,
      } : prev);

      addToast?.({ type: 'success', message: `${data.matched} de ${data.total} ads identificados como "${producto.nombre}"` });
    } catch (err) {
      addToast?.({ type: 'error', message: `Matcher falló: ${err.message}` });
    } finally {
      setMatching(false);
    }
  };

  // `producto` ahora es el activo (derivado arriba, no productos[0]).

  const handleAddProducto = async () => {
    const nombre = prodDraft.nombre.trim();
    const landingUrl = prodDraft.landingUrl.trim();
    if (!nombre) { addToast?.({ type: 'error', message: 'Ponele nombre al producto' }); return; }

    // Suffix random — antes era solo Date.now() que colisiona en double-click.
    const nuevoId = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nuevo = {
      id: nuevoId,
      nombre,
      landingUrl,
      descripcion: prodDraft.descripcion.trim(),
      competidores: [],
      createdAt: new Date().toISOString(),
    };
    setProductos(prev => [nuevo, ...prev]);
    setProdDraft({ nombre: '', landingUrl: '', descripcion: '' });
    setShowProdForm(false);
    setActiveProductoId(String(nuevoId));
    addToast?.({ type: 'success', message: `Producto "${nombre}" creado — cargá competidores y corré el pipeline` });
  };

  const handleAddCompetidor = async () => {
    const landingUrl = compDraft.landingUrl.trim();
    const adLibraryUrl = compDraft.adLibraryUrl.trim();
    // Validar adLibraryUrl si la pegó: debe ser facebook.com.
    if (adLibraryUrl) {
      try {
        const u = new URL(adLibraryUrl);
        const host = u.hostname.toLowerCase();
        if (!(host === 'facebook.com' || host.endsWith('.facebook.com'))) {
          addToast?.({ type: 'error', message: `La biblioteca de anuncios tiene que ser de facebook.com (mandaste ${host}).` });
          return;
        }
      } catch {
        addToast?.({ type: 'error', message: 'La URL de la biblioteca de anuncios no es válida.' });
        return;
      }
    }
    // Nombre: si el user no puso uno, o puso algo poco descriptivo (vacío o
    // puramente numérico tipo "5"), lo derivamos de la URL de la landing.
    // Así la lista muestra "Femprobiotics" en vez de "5".
    let nombre = compDraft.nombre.trim();
    if (!nombre || /^\d+$/.test(nombre)) {
      nombre = brandFromUrl(landingUrl) || nombre;
    }
    if (!nombre) {
      addToast?.({ type: 'error', message: 'Ponele nombre al competidor o cargá su landing URL' });
      return;
    }
    // Anti-duplicado: si ya hay un competidor con el mismo dominio, es la
    // misma marca — scrapearla dos veces gasta de más y duplica ideas.
    if (landingUrl) {
      const host = hostnameOf(landingUrl);
      const dup = competidores.find(c => c.landingUrl && hostnameOf(c.landingUrl) === host);
      if (dup) {
        addToast?.({ type: 'error', message: `Ya tenés esa marca cargada: "${dup.nombre}". No la agregamos de nuevo.` });
        return;
      }
    }
    // Suffix random — mismo motivo que arriba para competidores.
    const nuevoId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nuevo = {
      id: nuevoId,
      nombre,
      landingUrl,
      // adLibraryUrl: URL DIRECTA de Meta Ad Library (con filtros + sort)
      // que el user pegó a mano. Tiene prioridad sobre fbPageUrl y
      // searchKeyword al scrapear — si la pegó, sabe qué quiere ver.
      adLibraryUrl: adLibraryUrl || '',
      fbPageUrl: '',
      notas: '',
      ads: [],
      lastAdsCheck: null,
      createdAt: new Date().toISOString(),
    };
    setCompetidores(prev => [nuevo, ...prev]);
    setCompDraft({ nombre: '', landingUrl: '', adLibraryUrl: '' });
    setShowCompForm(false);
    addToast?.({ type: 'success', message: `Competidor "${nombre}" sumado` });

    // Si tiene landing URL, intentamos resolver la Facebook Page en
    // background — sin bloquear el UI. Si la encontramos, la guardamos
    // silenciosamente en el competidor. Scrapear por Page es mucho más
    // confiable que por keyword.
    if (landingUrl) {
      resolveFbPageAsync(nuevoId, nombre, landingUrl);
    }
  };

  // Dispara el resolve de FB page en background y actualiza el competidor
  // si lo encuentra. Errores silenciosos — es un best-effort.
  const resolveFbPageAsync = async (competidorId, competidorNombre, landingUrl) => {
    try {
      const resp = await fetch('/api/marketing/resolve-fb-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landingUrl }),
      });
      const data = await resp.json();
      if (data.pageUrl) {
        setCompetidores(prev => prev.map(x =>
          x.id === competidorId ? { ...x, fbPageUrl: data.pageUrl } : x
        ));
        addToast?.({ type: 'success', message: `FB page de ${competidorNombre} detectada: @${data.handle}` });
      }
    } catch {
      // Silencioso — si no pudimos resolver, el user puede cargarla manual.
    }
  };

  const handleRemoveCompetidor = async (id) => {
    if (!window.confirm('¿Sacar a este competidor de la lista?')) return;
    setCompetidores(prev => prev.filter(c => c.id !== id));
    // Limpiar el brand "auto-sincronizado" en Inspiración (fromCompetidorId)
    // → sin esto quedaba una marca huérfana en la galería de inspiración
    // apuntando a un competidor que ya no existe.
    if (producto?.id) {
      try {
        const brandsKey = `adslab-marketing-inspiracion-brands-${producto.id}`;
        const raw = localStorage.getItem(brandsKey);
        if (raw) {
          const arr = JSON.parse(raw);
          const filtered = arr.filter(b => String(b.fromCompetidorId || '') !== String(id));
          if (filtered.length !== arr.length) {
            localStorage.setItem(brandsKey, JSON.stringify(filtered));
          }
        }
      } catch {}
      // Y borrar los ads del competidor en IDB — no tienen razón de seguir
      // ocupando MB después de que el comp se va.
      try { await removeCompAds(producto.id, id); } catch {}
    }
  };

  // Sugerencia automática de competidores: buscamos en Ad Library por keyword
  // derivada del producto (landing hostname o nombre) y agrupamos por page.
  const handleSuggestCompetidores = async () => {
    const keyword = producto?.landingUrl
      ? (landingToKeyword(producto.landingUrl) || producto.nombre)
      : producto?.nombre;
    if (!keyword) {
      addToast?.({ type: 'error', message: 'Primero cargá un producto para poder buscar competidores' });
      return;
    }
    setSuggesting(true);
    setSuggestions([]);
    try {
      const resp = await fetch('/api/marketing/suggest-competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchKeyword: keyword, country: 'ALL', limit: 30 }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      logCostsFromResponse(data, `suggest-competitors · "${keyword}"`);
      // Filtramos los que ya están agregados (por pageName).
      const existentes = new Set(competidores.map(c => (c.nombre || '').toLowerCase()));
      const nuevas = (data.suggestions || []).filter(s => !existentes.has((s.pageName || '').toLowerCase()));
      setSuggestions(nuevas);
      if (nuevas.length === 0) {
        addToast?.({ type: 'info', message: data.suggestions?.length ? 'Las sugerencias ya están agregadas' : 'Sin sugerencias para este keyword' });
      } else {
        addToast?.({ type: 'success', message: `${nuevas.length} sugerencias encontradas` });
      }
    } catch (err) {
      addToast?.({ type: 'error', message: `Búsqueda falló: ${err.message}` });
    } finally {
      setSuggesting(false);
    }
  };

  const handleAddSuggestion = (sug) => {
    setCompetidores(prev => [{
      id: Date.now() + Math.random(),
      nombre: sug.pageName,
      landingUrl: '',
      fbPageUrl: sug.pageId ? `https://www.facebook.com/${sug.pageId}` : '',
      notas: `Auto-sugerido · ${sug.adsCount} ads activos · máx ${sug.maxDaysRunning}d corriendo`,
      imagen: sug.sampleImage,
      descripcion: sug.sampleHeadline,
      ads: [], lastAdsCheck: null,
      createdAt: new Date().toISOString(),
    }, ...prev]);
    setSuggestions(prev => prev.filter(s => s.pageId !== sug.pageId));
    addToast?.({ type: 'success', message: `"${sug.pageName}" agregado` });
  };

  // --- Pipeline runner ---
  // Se ejecuta en el cliente: una serie de fetches a endpoints existentes.
  // Cada "paso" tiene copy en rioplatense así el user entiende qué pasa.

  const updateStep = (id, patch) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  // Regeneración de research pendiente tras un rename. Guardamos el id del
  // producto; un effect dispara runPipeline({docsOnly}) cuando el state ya se
  // asentó (docs limpios + nombre nuevo), evitando leer un closure stale.
  const [pendingRegen, setPendingRegen] = useState(null);

  // Rename del producto. Persiste el nombre nuevo y, si ya había research
  // generado con el nombre viejo, ofrece regenerarlo (solo research + stage).
  const handleRenameProducto = (nombre) => {
    const tieneResearch = !!(producto?.docs?.research);
    let regen = false;
    if (tieneResearch) {
      regen = window.confirm(
        `Ya hay un research doc generado con el nombre anterior.\n\n¿Regenerarlo con "${nombre}"?\n\nBorra research + avatar + offer brief + creencias + stage y los vuelve a generar (~3-4 min). Las ideas que ya están en la Bandeja no se tocan; las nuevas saldrán con el nombre correcto.`
      );
    }
    setProductos(prev => prev.map(p =>
      String(p.id) === String(producto.id)
        ? {
            ...p,
            nombre,
            updated_at: new Date().toISOString(),
            ...(regen ? {
              docs: {}, resumenEjecutivo: '', docsGeneratedAt: null,
              stage: null, stageReason: '', searchKeywords: [],
            } : {}),
          }
        : p
    ));
    if (regen) setPendingRegen(String(producto.id));
  };

  // Dispara la regeneración una vez que el producto activo quedó con docs
  // limpios (necesitaDocs=true) y no hay otro pipeline corriendo.
  useEffect(() => {
    if (!pendingRegen || running) return;
    if (String(producto?.id) !== String(pendingRegen)) return;
    const limpio = ['research', 'avatar', 'offerBrief', 'beliefs'].some(k => !producto?.docs?.[k]);
    if (!limpio) return;
    setPendingRegen(null);
    runPipeline({ docsOnly: true });
  }, [pendingRegen, producto, running]);

  const runPipeline = async (opts) => {
    // docsOnly: regenerar SOLO research + stage (post-rename), sin re-scrapear
    // competidores ni generar ideas. opts puede venir como evento de onClick
    // (que no tiene docsOnly) → queda false.
    const docsOnly = opts?.docsOnly === true;
    if (!producto?.nombre) {
      addToast?.({ type: 'error', message: 'Primero cargá el producto (nombre + landing)' });
      return;
    }
    // AbortController nuevo por cada run. Lo pasamos a todas las fetches
    // del pipeline para que un cancel mid-run pare deep-analyze, generate-
    // ideas, etc. y deje de cobrar al instante.
    pipelineAbortRef.current = new AbortController();
    const pipelineSignal = pipelineAbortRef.current.signal;
    // Guard contra double-run. Aunque el botón se oculta cuando running=true,
    // hay paths concurrentes (auto-run pill, Enter rápido, otra pestaña) que
    // pueden disparar dos invocaciones en paralelo y pisarse setProductos /
    // setCompetidores sin orden definido.
    if (running) {
      addToast?.({ type: 'info', message: 'Ya hay un pipeline corriendo. Esperá a que termine o cancelá primero.' });
      return;
    }

    // Iniciar corrida en el context global — limpia state previo y marca
    // running=true. Así el pipeline sigue vivo aunque el user salga de
    // Arranque (Bandeja, Meta Ads, etc.).
    pipelineRun.startRun({
      productoId: String(producto.id),
      productoNombre: producto.nombre,
    });

    // Acumulador local del costo del run. Antes leíamos `runCost` del closure
    // al final del run para persistir, pero ese valor era el snapshot inicial
    // (cero), no el final — el costo guardado en runHistory salía siempre 0.
    // Usamos una local mutable y la consultamos al persistir.
    const acumuladoLocal = { anthropic: 0, openai: 0, apify: 0, meta: 0, total: 0 };
    // Contadores en vivo del run — los persistimos al final. Reemplazan los
    // regex frágiles que parseaban el detail string del stepper para sacar
    // ganadores e ideas (cualquier cambio de copy rompía el banner).
    const liveStats = { winnersAnalyzed: 0, ideasInsertadas: 0, ideasGeneradas: 0, hooksLowScore: 0 };
    // Ideas realmente insertadas en la bandeja durante este run, con su id
    // del store. Se llena en el loop SSE del generator y se manda al step
    // `score-hooks` después para que Haiku puntúe cada una y marquemos las
    // <6 con flag `lowScore` (el user las puede archivar de un click).
    const insertedIdeasForScoring = [];

    // Wrapper sobre logCostsFromResponse que también suma al runCost (display
    // en vivo) y al acumulado local (persistencia final).
    const trackCost = (data, descripcion) => {
      const added = logCostsFromResponse(data, descripcion);
      if (added?.total > 0) {
        setRunCost(prev => ({
          anthropic: prev.anthropic + added.anthropic,
          openai: prev.openai + added.openai,
          apify: prev.apify + added.apify,
          meta: prev.meta + added.meta,
          total: prev.total + added.total,
        }));
        acumuladoLocal.anthropic += added.anthropic || 0;
        acumuladoLocal.openai += added.openai || 0;
        acumuladoLocal.apify += added.apify || 0;
        acumuladoLocal.meta += added.meta || 0;
        acumuladoLocal.total += added.total || 0;
      }
      return added;
    };

    // Pasos dinámicos según estado:
    //   - docs-gen: solo si el producto aún no tiene research doc
    //   - post-research: siempre tras docs (infiere stage + keywords)
    //   - scrape/analyze: uno por competidor (los tiene que cargar el user a mano)
    // La sugerencia automática de competidores fue sacada — devolvía matches
    // imprecisos (e.g. la propia tienda) que confundían más que ayudaban.
    // Chequeamos los 4 docs, no solo `research`. Si una corrida quedó con
    // docs PARCIALES (research sí, avatar no), mirar solo research activaba
    // el skip y el avatar faltante nunca se regeneraba.
    const necesitaDocs = docsOnly || ['research', 'avatar', 'offerBrief', 'beliefs']
      .some(k => !producto?.docs?.[k]);

    const pasosIniciales = [
      { id: 'prep', label: '🚀 Arrancando', detail: `Producto: ${producto.nombre}`, status: 'pending' },
    ];
    pasosIniciales.push(
      necesitaDocs
        ? { id: 'docs-gen', label: '📄 Generando documentación del producto', detail: 'Research + avatar + offer brief + creencias + resumen (~3-4 min)', status: 'pending' }
        : { id: 'docs-gen', label: '📄 Documentación del producto', detail: '↻ Reusada de corrida previa (skip · ahorra ~3 min)', status: 'pending' },
    );
    pasosIniciales.push(
      { id: 'post-research', label: '🧠 Inferiendo stage del prospect', detail: 'Claude clasifica el awareness según el research', status: 'pending' },
    );
    pasosIniciales.push(
      { id: 'done', label: '✅ Listo', detail: 'Tenés análisis fresco + ideas nuevas en la Bandeja', status: 'pending' },
    );
    setSteps(pasosIniciales);

    // Paso 1: prep
    updateStep('prep', { status: 'running', startedAt: Date.now() });
    await new Promise(r => setTimeout(r, 300));
    updateStep('prep', { status: 'done', endedAt: Date.now() });

    // ============================================================
    // PASO: Generar docs del producto si no los tiene todavía.
    // Si ya están, el step se marca como done con label '↻ Reusada'
    // y saltamos directo al post-research.
    // ============================================================
    let productoActualizado = producto;
    if (!necesitaDocs) {
      updateStep('docs-gen', { status: 'done', endedAt: Date.now() });
    } else if (necesitaDocs && !cancelledRef.current) {
      updateStep('docs-gen', { status: 'running', startedAt: Date.now() });
      try {
        // Auth token + productoId van server-side para persistir cada paso
        // a Supabase. Si el user cierra la pestaña, los docs igual quedan.
        let authToken = '';
        try {
          const { data: { session } } = await supabase.auth.getSession();
          authToken = session?.access_token || '';
        } catch {}
        const docs = await streamGenerateDocs({
          productoNombre: producto.nombre,
          productoUrl: producto.landingUrl || '',
          descripcion: producto.descripcion || '',
          productoId: producto.id,
          authToken,
          onProgress: (msg) => updateStep('docs-gen', { detail: msg }),
          // Cada step-cost del SSE se traduce en un trackCost para que el
          // gasto del docs-gen aparezca en vivo en "💰 $X" y persista en
          // runHistory. Antes este endpoint no devolvía cost → el run
          // mostraba $0 mientras gastaba lo más caro del pipeline.
          onCost: (costBreakdown, descripcion) => {
            // trackCost espera shape `{ cost: { anthropic, ... } }` igual
            // que un response del backend → wrapeamos el breakdown.
            trackCost({ cost: costBreakdown }, descripcion);
          },
        });
        // Guardar los docs en el producto
        productoActualizado = {
          ...producto,
          docs: docs.docs,
          resumenEjecutivo: docs.resumenEjecutivo,
          docsGeneratedAt: new Date().toISOString(),
        };
        setProductos(prev => prev.map(p => String(p.id) === String(producto.id) ? productoActualizado : p));
        updateStep('docs-gen', {
          status: 'done',
          endedAt: Date.now(),
          detail: `Research ${(docs.docs?.research || '').length} chars · avatar + offer brief + creencias listos`,
        });
      } catch (err) {
        updateStep('docs-gen', { status: 'error', endedAt: Date.now(), detail: err.message });
        setRunning(false);
        return;
      }
    }

    // ============================================================
    // PASO: Post-research analysis — stage + keywords.
    // Skip si el producto YA tiene stage inferido y keywords guardadas
    // (corridas previas). Reutilizamos lo que ya está. Ahorra ~30-60s.
    // ============================================================
    let searchKeywords = productoActualizado?.searchKeywords || [];
    // Mín 3 keywords para considerar "ya hecho". Antes con 1 sola keyword el
    // skip se activaba y nunca regenerábamos — quedabas atascado con keywords
    // pobres salvo que borraras el producto. 3 es el mínimo que da una mezcla
    // viable de problema + categoría + ángulo.
    const yaTienePostResearch = !docsOnly && !!productoActualizado?.stage && searchKeywords.length >= 3;
    if (!cancelledRef.current && productoActualizado?.docs?.research && !yaTienePostResearch) {
      updateStep('post-research', { status: 'running', startedAt: Date.now() });
      try {
        const resp = await fetch('/api/marketing/post-research-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            producto: {
              nombre: productoActualizado.nombre,
              landingUrl: productoActualizado.landingUrl,
              descripcion: productoActualizado.descripcion,
            },
            research: productoActualizado.docs.research,
            avatar: productoActualizado.docs.avatar,
          }),
        });
        const data = await parseJsonResponse(resp, 'Inferir stage del prospect');
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        trackCost(data, `post-research-analysis · ${productoActualizado.nombre}`);

        searchKeywords = data.searchKeywords || [];
        productoActualizado = {
          ...productoActualizado,
          stage: data.stage,
          stageReason: data.stageReason,
          searchKeywords,
        };
        setProductos(prev => prev.map(p => String(p.id) === String(productoActualizado.id) ? productoActualizado : p));

        updateStep('post-research', {
          status: 'done',
          endedAt: Date.now(),
          detail: `Stage: ${data.stage.replace('_', '-')} · ${searchKeywords.length} keywords: ${searchKeywords.slice(0, 3).join(', ')}${searchKeywords.length > 3 ? '…' : ''}`,
        });
      } catch (err) {
        updateStep('post-research', { status: 'error', endedAt: Date.now(), detail: err.message });
        // No es fatal — seguimos con keywords vacíos.
      }
    } else if (yaTienePostResearch) {
      // Skip: ya tenemos stage + keywords de una corrida previa.
      updateStep('post-research', {
        status: 'done',
        endedAt: Date.now(),
        detail: `↻ Reusado · Stage: ${productoActualizado.stage.replace('_', '-')} · ${searchKeywords.length} keywords (sin re-llamar a Claude)`,
      });
    }

    // Modo docsOnly (regeneración post-rename): cortamos acá. Solo queríamos
    // research + stage frescos con el nombre nuevo — no re-scrapear competencia
    // ni generar ideas (eso lo dispara el user con el pipeline completo).
    if (docsOnly) {
      updateStep('done', {
        status: 'done',
        endedAt: Date.now(),
        detail: `Research regenerado con "${productoActualizado.nombre}"`,
      });
      setRunning(false);
      addToast?.({ type: 'success', message: 'Research regenerado con el nombre nuevo. Las próximas ideas y estáticos ya lo usan.' });
      return;
    }

    // La competencia la carga el user a mano — sin auto-sugerencia
    // (daba matches imprecisos y confundía más que ayudaba).
    const competidoresLocal = competidores;
    if (competidoresLocal.length === 0) {
      addToast?.({ type: 'error', message: 'Sin competidores no podemos analizar ganadores. Agregá a mano y reejecutá.' });
      setRunning(false);
      return;
    }

    // Agregamos los pasos de scrape/analyze/generate ahora que sabemos
    // cuántos competidores hay.
    setSteps(prev => {
      const base = prev.filter(p => p.id !== 'done');
      const nuevos = [
        ...competidoresLocal.map(c => ({
          id: `scrape-${c.id}`,
          label: `🔍 Buscando ads de ${c.nombre}`,
          detail: 'Meta Ad Library vía Apify',
          status: 'pending',
        })),
        ...competidoresLocal.map(c => ({
          id: `analyze-${c.id}`,
          label: `🧠 Analizando ganadores de ${c.nombre}`,
          detail: 'Claude Vision + Whisper (si hay video)',
          status: 'pending',
        })),
        { id: 'generate', label: '💡 Generando ideas nuevas con IA', detail: 'Réplicas + iteraciones + diferenciaciones + desde cero', status: 'pending' },
        { id: 'score-hooks', label: '🎯 Filtrando hooks flojos', detail: 'Haiku scorea cada hook 1-10 y marca los <6 para que los archives', status: 'pending' },
        { id: 'done', label: '✅ Listo', detail: 'Tenés análisis fresco + ideas nuevas en la Bandeja', status: 'pending' },
      ];
      return [...base, ...nuevos];
    });

    // Paso scrape: siempre re-scrapeamos para detectar ads nuevos en la
    // biblioteca. Los ads que ya deep-analizamos en corridas previas se
    // saltean en el paso de análisis (no gastan Claude de nuevo). El user
    // quiere ver la diff: cuántos son nuevos vs ya vistos.
    //
    // PARALELIZACIÓN: antes era secuencial (`for (const c of comps)`), 4
    // comps × ~120s polling Apify = ~480s. Con concurrency 3 baja a ~200s.
    // Los react updates concurrentes son safe porque setCompetidores +
    // setCompAdsByCompId usan functional updaters (cada uno modifica solo su
    // propia entrada).
    const compWithAds = []; // { comp, winners }
    let apifyQuotaExhausted = false;
    const SCRAPE_CONCURRENCY = 3;

    // Closure por competidor — antes era el cuerpo del for-loop.
    const scrapeOneCompetidor = async (c) => {
      if (cancelledRef.current) return;
      if (apifyQuotaExhausted) {
        updateStep(`scrape-${c.id}`, {
          status: 'error',
          endedAt: Date.now(),
          detail: 'Salteado · Apify sin quota mensual',
        });
        trackQuotaFailure({ kind: 'comp', id: c.id, productoId: producto.id, nombre: c.nombre });
        return;
      }
      const stepId = `scrape-${c.id}`;
      updateStep(stepId, { status: 'running', startedAt: Date.now() });
      try {
        // Setup inicial scrape — limit alto para barrer todo lo que tiene
        // el competidor en la biblioteca por primera vez. Refreshes
        // posteriores usan 100 (en InspiracionSection).
        const payload = { country: 'ALL', limit: 500 };
        // PRIORIDAD: adLibraryUrl (URL armada a mano por el user con filtros
        // + sort específicos) > fbPageUrl resuelto > searchKeyword. La URL
        // a mano es la más precisa porque garantiza scrapear los ads
        // reales de la marca (no random que pueda resolver una FB page
        // genérica como Shopify).
        let resolvedFbPage = c.adLibraryUrl || c.fbPageUrl;
        if (!resolvedFbPage && c.landingUrl) {
          updateStep(stepId, { detail: 'Detectando Facebook Page de la landing…' });
          try {
            const rr = await fetch('/api/marketing/resolve-fb-page', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ landingUrl: c.landingUrl }),
            });
            const rd = await rr.json();
            if (rd.pageUrl) {
              resolvedFbPage = rd.pageUrl;
              setCompetidores(prev => prev.map(x =>
                x.id === c.id ? { ...x, fbPageUrl: rd.pageUrl } : x
              ));
            }
          } catch { /* silencioso — caemos a keyword */ }
        }

        if (resolvedFbPage) {
          payload.fbPageUrl = resolvedFbPage.startsWith('http') ? resolvedFbPage : `https://www.facebook.com/${resolvedFbPage}`;
        } else if (c.landingUrl) {
          payload.searchKeyword = landingToKeyword(c.landingUrl) || c.nombre;
        } else {
          payload.searchKeyword = c.nombre;
        }
        // Pasamos productoId + competidorId + auth para que el server pueda
        // upsertear al search index. Si no podemos obtener token, igual
        // funciona el scrape — solo no entra al index.
        payload.productoId = producto.id;
        payload.competidorId = c.id;
        let authToken = '';
        try {
          const { data: { session } } = await supabase.auth.getSession();
          authToken = session?.access_token || '';
        } catch {}
        let resp = await fetch('/api/marketing/apify-ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        let data = await parseJsonResponse(resp, `Scrape de ${c.nombre}`);
        // AUTO-RETRY con limit reducido si el server lo sugiere. Esto
        // resuelve el caso "Apify tardó demasiado y no quedó tiempo para
        // reintentar" sin que el user tenga que reintentar a mano.
        if (!resp.ok && data.retryWithLimit && typeof data.retryWithLimit === 'number') {
          updateStep(stepId, { detail: `Reintentando con limit ${data.retryWithLimit}…` });
          const retryPayload = { ...payload, limit: data.retryWithLimit };
          resp = await fetch('/api/marketing/apify-ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(retryPayload),
          });
          data = await parseJsonResponse(resp, `Scrape de ${c.nombre} (retry)`);
          if (resp.ok) {
            addToast?.({ type: 'info', message: `${c.nombre}: scrape automático bajó el limit a ${data.retryWithLimit || retryPayload.limit} y funcionó.` });
          }
        }
        if (!resp.ok) {
          // Si el endpoint sugiere algo (ej: cargar fbPageUrl manual), lo
          // mostramos al user — más útil que el error crudo de Apify.
          // stringifyApiError: sin esto, si data.error venía como objeto el
          // mensaje quedaba en "[object Object]" en el step del pipeline.
          const errBase = stringifyApiError(data.error) || `HTTP ${resp.status}`;
          const errMsg = data.sugerencia ? `${errBase} — ${data.sugerencia}` : errBase;
          throw new Error(errMsg);
        }
        trackCost(data, `apify-ingest · ${c.nombre}`);
        // Si hubo retry transparente, lo mostramos como nota al user.
        if (data.attemptNote) {
          addToast?.({ type: 'info', message: `${c.nombre}: ${data.attemptNote}` });
        }

        const ads = data.ads || [];
        const allWinners = ads.filter(a => a.isWinner);

        // Calcular cuántos ads son NUEVOS vs ya vistos. Para esto necesitamos
        // los ads previos — antes vivían inline en c.ads, ahora en IDB.
        // skipCloud: para la diferencia de "nuevos vs vistos" alcanza con
        // los previos LOCAL. Si bajamos del cloud bloqueamos el pipeline.
        const prevRecord = await getCompAds(producto.id, c.id, { skipCloud: true });
        const prevAds = (Array.isArray(c.ads) && c.ads.length > 0 ? c.ads : prevRecord?.ads) || [];
        const prevAdIds = new Set(prevAds.map(a => a.id));
        const newAds = ads.filter(a => !prevAdIds.has(a.id));
        const seenAds = ads.filter(a => prevAdIds.has(a.id));

        // STORAGE SPLIT: ads → IDB (sin cap); metadata → localStorage.
        await setCompAds(producto.id, c.id, {
          ads,
          total: data.total || 0,
          winners: data.winners || 0,
          lastAdsCheck: new Date().toISOString(),
        });
        setCompAdsByCompId(prev => ({ ...prev, [c.id]: ads }));

        // Guardar SOLO metadata en el competidor (con historial de corridas)
        setCompetidores(prev => prev.map(x => {
          if (x.id !== c.id) return x;
          const prevHistory = Array.isArray(x.adsHistory) ? x.adsHistory : [];
          const history = [...prevHistory, {
            ts: new Date().toISOString(),
            total: data.total || 0,
            winners: data.winners || 0,
            newAds: newAds.length,
          }].slice(-10);
          // Quitamos `ads` inline (vive en IDB). consecutiveZeroAds: tracking
          // para "estable" en el smart scrape.
          const prevZeroes = x.consecutiveZeroAds || 0;
          const { ads: _legacy, ...meta } = x;
          return {
            ...meta, adsTotal: data.total || 0, winnersCount: data.winners || 0,
            lastAdsCheck: new Date().toISOString(), adsHistory: history,
            consecutiveZeroAds: newAds.length > 0 ? 0 : prevZeroes + 1,
          };
        }));

        // Deep-analyze: top 20 winners por score (los más fuertes).
        // Todos los demás ads (winners o no) llegan al generador con
        // su copy crudo — no los tiramos.
        const topWinnersForAnalysis = allWinners
          .slice().sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 20);
        compWithAds.push({ comp: c, winners: topWinnersForAnalysis, allAds: ads });
        const newWinners = topWinnersForAnalysis.filter(a => !prevAdIds.has(a.id));
        updateStep(stepId, {
          status: 'done',
          endedAt: Date.now(),
          detail: `${ads.length} ads (${newAds.length} nuevos · ${seenAds.length} ya vistos) · ${allWinners.length} ganadores · ${newWinners.length} nuevos para analizar`,
        });
      } catch (err) {
        updateStep(stepId, { status: 'error', endedAt: Date.now(), detail: err.message });
        // Detectar quota mensual de Apify para abortar el resto del loop +
        // encolar el comp para retry batch cuando el user suba el plan.
        // Sin esto, los 7 competidores restantes mandan requests inútiles
        // y el user tenía que click-por-comp después de re-habilitar Apify.
        if (isQuotaError(err.message)) {
          apifyQuotaExhausted = true;
          trackQuotaFailure({ kind: 'comp', id: c.id, productoId: producto.id, nombre: c.nombre });
          addToast?.({
            type: 'error',
            message: 'Apify se quedó sin quota mensual. Encolé este comp para reintentar — subí el plan en console.apify.com y usá "Reintentar fallidos" en Inspiración.',
          });
        }
      }
    };

    // Ejecutar scrapes en batches paralelos. Si en cualquier batch detectamos
    // que el user canceló o que Apify se quedó sin quota, salimos del loop.
    for (let i = 0; i < competidoresLocal.length; i += SCRAPE_CONCURRENCY) {
      if (cancelledRef.current) break;
      if (apifyQuotaExhausted) {
        // Marcamos los que quedan como salteados + encolamos para retry.
        for (const c of competidoresLocal.slice(i)) {
          updateStep(`scrape-${c.id}`, {
            status: 'error', endedAt: Date.now(),
            detail: 'Salteado · Apify sin quota mensual',
          });
          trackQuotaFailure({ kind: 'comp', id: c.id, productoId: producto.id, nombre: c.nombre });
        }
        break;
      }
      const batch = competidoresLocal.slice(i, i + SCRAPE_CONCURRENCY);
      await Promise.allSettled(batch.map(scrapeOneCompetidor));
    }

    // Cap GLOBAL de deep-analyze por corrida. Antes se analizaban hasta 20
    // winners POR competidor (100+ en total). Cada análisis (Claude Vision +
    // Whisper) tarda 30-60s → el deep-analyze podía durar 30-60 min y el
    // user cerraba la pestaña ANTES de que corriera el generador. Resultado:
    // la bandeja se llenaba SOLO de réplicas del deep-analyze (todas video,
    // sin ángulo, sin score). Ahora analizamos solo los mejores N winners de
    // TODA la competencia — el generador igual recibe los 800+ ads crudos
    // para minar patrones, y los análisis se acumulan entre corridas.
    const MAX_DEEP_ANALYZE_PER_RUN = 12;
    const yaAnalizadosGlobal = new Set();
    {
      const pf = productosRef.current.find(p => String(p.id) === String(producto.id));
      for (const c of (pf?.competidores || [])) {
        for (const aid of Object.keys(c.adsAnalysis || {})) yaAnalizadosGlobal.add(aid);
      }
    }
    const analyzeSet = new Set(
      compWithAds
        .flatMap(({ winners }) => winners)
        .filter(ad => ad && !yaAnalizadosGlobal.has(ad.id))
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, MAX_DEEP_ANALYZE_PER_RUN)
        .map(a => a.id)
    );

    // Paso N+2..2N+1: deep-analyze de winners de cada competidor
    for (const { comp, winners } of compWithAds) {
      if (cancelledRef.current) break;
      const stepId = `analyze-${comp.id}`;
      if (winners.length === 0) {
        updateStep(stepId, { status: 'done', endedAt: Date.now(), detail: 'Sin ganadores para analizar todavía' });
        continue;
      }
      // Filtrar: no re-analizar los ads que ya tienen análisis guardado, y
      // respetar el cap global (analyzeSet) — solo los mejores N de toda la
      // competencia se analizan en esta corrida.
      // Leemos del ref del state global de productos — la key vieja
      // COMPETIDORES_KEY está borrada tras la migración inicial.
      const productoFresh = productosRef.current.find(p => String(p.id) === String(producto.id));
      const compFresh = (productoFresh?.competidores || []).find(x => x.id === comp.id);
      const existingAnalyses = compFresh?.adsAnalysis || {};
      const nuevosParaAnalizar = winners.filter(ad => !existingAnalyses[ad.id] && analyzeSet.has(ad.id));
      const yaAnalizados = winners.filter(ad => existingAnalyses[ad.id]).length;

      if (nuevosParaAnalizar.length === 0) {
        const habiaNuevos = winners.some(ad => !existingAnalyses[ad.id]);
        updateStep(stepId, {
          status: 'done',
          endedAt: Date.now(),
          detail: habiaNuevos
            ? `Sus ganadores quedaron fuera del top ${MAX_DEEP_ANALYZE_PER_RUN} de esta corrida — se analizan en la próxima.`
            : `Todos (${winners.length}) ya analizados en corridas anteriores — nada nuevo.`,
        });
        continue;
      }

      updateStep(stepId, {
        status: 'running',
        startedAt: Date.now(),
        detail: `0/${nuevosParaAnalizar.length} analizados${yaAnalizados > 0 ? ` · ${yaAnalizados} salteados (ya había análisis)` : ''}`,
      });
      let analyzed = 0;
      for (const ad of nuevosParaAnalizar) {
        if (cancelledRef.current) break;
        try {
          const resp = await fetch('/api/marketing/deep-analyze', {
            method: 'POST',
            signal: pipelineSignal,
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
          const data = await parseJsonResponse(resp, `Análisis de ad de ${comp.nombre}`);
          if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
          trackCost(data, `deep-analyze · ${comp.nombre} · ${ad.id}`);

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
          ideaFromDeepAnalysis({ analysis: data.analysis, transcript: data.transcript, ad, competidor: comp, producto });
          analyzed++;
          liveStats.winnersAnalyzed++;
          updateStep(stepId, { detail: `${analyzed}/${nuevosParaAnalizar.length} analizados${yaAnalizados > 0 ? ` · ${yaAnalizados} salteados (ya había análisis)` : ''}` });
        } catch (err) {
          if (err.name === 'AbortError') {
            console.info(`deep-analyze abortado por cancel (ad ${ad.id})`);
            break;
          }
          // Un análisis fallido no rompe el resto — seguimos.
          console.error(`deep-analyze falló para ad ${ad.id}:`, err);
        }
      }
      updateStep(stepId, {
        status: 'done',
        endedAt: Date.now(),
        detail: `${analyzed} nuevos analizados${yaAnalizados > 0 ? ` · ${yaAnalizados} salteados (ya había análisis)` : ''}`,
      });
    }

    // Paso generate: llamar a generate-ideas con todo el contexto acumulado.
    if (!cancelledRef.current) {
      updateStep('generate', { status: 'running', startedAt: Date.now() });
      try {
        // Armar el contexto competitivo COMPLETO para el generador.
        // 1. compAnalisis: ads con deep-analysis (hooks, ángulo, why_it_works)
        // 2. allCompAds: TODOS los ads scrapeados (body + headline + score +
        //    días + formato). El generador ve los 700+ ads crudos para
        //    identificar patrones que no capturamos con deep-analyze.
        const compAnalisis = [];
        const allCompAds = [];
        // Releemos los competidores desde el ref del state — así capturamos
        // los `adsAnalysis` recién guardados por el deep-analyze loop. Antes
        // leíamos `loadJSON(COMPETIDORES_KEY, ...)` que está borrada tras la
        // migración → caía al fallback del closure y perdía análisis frescos.
        // CRÍTICO POST-REFACTOR: productosRef.current tiene ads STRIPPED (viven
        // en IDB ahora). Sin hidratar, el pipeline corre ciego — allCompAds
        // queda vacío y el generador no recibe contexto de competencia.
        const productoFreshGen = productosRef.current.find(p => String(p.id) === String(producto.id));
        const compsBase = productoFreshGen?.competidores || competidores;
        const compsActualizados = await hydrateCompetidoresAds(compsBase, producto.id);
        for (const c of compsActualizados) {
          // Deep-analyzed (con insights completos)
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
          // TODOS los ads (copy crudo — para pattern mining)
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

        // Ideas existentes SOLO del producto activo — para dedup y para
        // saber si es la "primera vez" generando para este producto.
        // Antes usábamos todas las ideas globalmente, lo que rompía en
        // multi-producto (si producto A tenía 30 ideas, producto B se
        // comportaba como si ya tuviera todas esas).
        // Ahora también pasamos el `estado` y el `hook` para que el generator
        // pueda usar las ideas usadas como ejemplos POSITIVOS y las
        // archivadas como ejemplos NEGATIVOS (feedback loop). Antes solo
        // mandábamos titulo/angulo/tipo y el generador no sabía qué se
        // había aprobado.
        const productoActualId = String(producto.id);
        const ideasExistentes = loadIdeas()
          .filter(i => String(i.productoId || '') === productoActualId)
          .map(i => ({
            titulo: i.titulo,
            angulo: i.angulo,
            tipo: i.tipo,
            hook: i.hook || '',
            estado: i.estado || 'pendiente',
          }));

        // Ads propios matcheados al producto (solo si ya corrió el matcher IA
        // y son high/medium confidence). Sirven para generar iteraciones.
        const propiosAds = (metaAccount?.ads || [])
          .filter(a => a.productMatch && ['high', 'medium'].includes(a.productMatch.confidence))
          .map(a => ({
            id: a.id,
            name: a.name,
            creative: { title: a.creative?.title, body: a.creative?.body },
            insights: a.insights,
            fatigue: a.fatigue,
          }));

        // Target count = cuántas ideas pide el generador en ESTA corrida.
        // El `limiteDiario` es un cap POR CORRIDA, no un presupuesto diario
        // que se agota: cada corrida pide su cupo completo; el dedup evita
        // repetir entre corridas. Antes había un "primeraVezTarget" que
        // escalaba con la cantidad de ads (llegaba a 163) → 14 tandas, 32
        // min de generación. Ahora respetamos siempre el límite que puso el
        // user — más predecible y rápido.
        const targetCount = Math.max(1, Math.min(MAX_IDEAS_PER_RUN, genConfig.limiteDiario || 50));

        const sumaMix = Math.max(1, genConfig.formatoStatic + genConfig.formatoVideo);
        const formatoMix = {
          static: genConfig.formatoStatic / sumaMix,
          video: genConfig.formatoVideo / sumaMix,
        };

        // CHUNKING + PARALELISMO: pedimos las ideas en TANDAS chicas y las
        // corremos EN PARALELO (igual que generadorRapidoStore.js). Antes
        // eran tandas de 8 SECUENCIALES — con contexto pobre (ej: 1 solo
        // competidor por quota de Apify) el modelo divagaba, alargaba el
        // time-to-first-token y la función moría en el límite de 5min de
        // Vercel SIN emitir `complete` → "tanda truncada" en cascada.
        // CHUNK 4 (era 8): tandas más chicas = menos tokens = menos riesgo
        // de timeout. Concurrency 3: tiempo de pared ~3x más rápido.
        const CHUNK_SIZE = 4;
        const CHUNK_CONCURRENCY = 3;
        const totalTandas = Math.max(1, Math.ceil(targetCount / CHUNK_SIZE));
        let insertadas = 0;
        let tandasOk = 0;

        // ideasExistentes se calcula UNA vez al arrancar. Las tandas paralelas
        // no se ven entre sí (arrancan con la misma base), así que puede haber
        // algún solape → el dedup de addGeneratedIdeas lo filtra del lado
        // cliente. Antes era fresco por tanda (servía para el modo secuencial).
        const ideasExistBase = loadIdeas()
          .filter(i => String(i.productoId || '') === productoActualId)
          .map(i => ({ titulo: i.titulo, angulo: i.angulo, tipo: i.tipo, hook: i.hook || '', estado: i.estado || 'pendiente' }));

        // Corre UNA tanda del generador: pide `chunkTarget` ideas, consume
        // el stream SSE e inserta en la Bandeja. Devuelve cuántas insertó.
        const correrTanda = async (chunkTarget) => {
          const resp = await fetch('/api/marketing/generate-ideas', {
            method: 'POST',
            signal: pipelineSignal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              producto: productoActualizado || producto || { nombre: 'Producto sin definir' },
              competidoresAnalisis: compAnalisis,
              allCompAds,
              ideasExistentes: ideasExistBase,
              propiosAds,
              targetCount: chunkTarget,
              formatoMix,
            }),
          });
          if (!resp.ok || !resp.body) {
            const text = await resp.text().catch(() => '');
            throw new Error(`generate-ideas HTTP ${resp.status}${text ? ': ' + text.slice(0, 100) : ''}`);
          }
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';
          let streamErr = null;
          let costPayload = null;
          let insertadasTanda = 0;
          while (true) {
            if (cancelledRef.current) { try { await reader.cancel(); } catch {} break; }
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const payload = line.slice(6).trim();
              if (!payload) continue;
              try {
                const ev = JSON.parse(payload);
                if (ev.type === 'idea' && ev.idea) {
                  const nuevas = addGeneratedIdeas([ev.idea], { producto: productoActualizado || producto });
                  if (nuevas.length > 0) {
                    insertadas++;
                    insertadasTanda++;
                    liveStats.ideasInsertadas++;
                    for (const n of nuevas) {
                      insertedIdeasForScoring.push({
                        id: n.id, titulo: n.titulo, hook: n.hook || '',
                        tipo: n.tipo, anguloCategoria: n.anguloCategoria || null,
                      });
                    }
                  }
                  liveStats.ideasGeneradas++;
                  setLiveIdeas(prev => [...prev, ev.idea]);
                  // Progreso por IDEAS (no por nº de tanda) — con tandas
                  // paralelas el contador de tanda parpadea incoherente.
                  updateStep('generate', { detail: `${insertadas}/${targetCount} ideas en la Bandeja…` });
                } else if (ev.type === 'complete') {
                  costPayload = ev;
                } else if (ev.type === 'error') {
                  streamErr = new Error(ev.error || 'Error del stream');
                }
              } catch { /* línea parcial */ }
            }
          }
          if (streamErr) throw streamErr;
          if (costPayload) trackCost(costPayload, `generate-ideas · ${(productoActualizado || producto)?.nombre || ''}`);
          // Tanda truncada: 0 ideas y sin `complete` = se cortó a mitad.
          if (!costPayload && insertadasTanda === 0 && !cancelledRef.current) {
            throw new Error('tanda truncada (timeout)');
          }
          tandasOk++;
          return insertadasTanda;
        };

        // Tamaños de cada tanda (ej. target=10, CHUNK=4 → [4,4,2]).
        const chunkSizes = [];
        for (let t = 0; t < totalTandas; t++) {
          chunkSizes.push(Math.min(CHUNK_SIZE, targetCount - t * CHUNK_SIZE));
        }

        // Worker pool — corre las tandas en paralelo con tope de concurrencia.
        // Mismo patrón que generadorRapidoStore.js. Guardamos el 1er error en
        // chunkErr y solo lo propagamos si NINGUNA tanda insertó algo.
        const queue = [...chunkSizes];
        let chunkErr = null;
        const worker = async () => {
          while (queue.length && !cancelledRef.current) {
            const size = queue.shift();
            try {
              await correrTanda(size);
            } catch (e) {
              if (e?.name === 'AbortError') throw e; // cancelación: propagar
              console.error('generate tanda falló:', e);
              chunkErr = chunkErr || e; // 1ra falla: guardar, seguir el resto
            }
          }
        };
        try {
          await Promise.all(
            Array.from({ length: Math.min(CHUNK_CONCURRENCY, queue.length) }, worker)
          );
        } catch (e) {
          if (e?.name === 'AbortError') {
            console.info('generate-ideas abortado por cancel');
          } else {
            throw e;
          }
        }

        // Fallo real = NINGUNA tanda completó Y hubo error. Si tandasOk > 0
        // pero insertadas === 0, NO es error — el generador devolvió ideas
        // que ya estaban en la Bandeja (dedup en bandejas saturadas).
        if (tandasOk === 0 && chunkErr && !cancelledRef.current) {
          // Mensaje accionable: distinguimos contexto pobre de timeout puro.
          // El diagnóstico mostró que el truncado se gatilla casi siempre por
          // poca data de competencia (scrape incompleto por quota Apify).
          const contextoPobre = (compAnalisis?.length || 0) < 3;
          throw new Error(contextoPobre
            ? 'El generador se quedó sin contexto suficiente (pocos competidores analizados — probablemente el scrape no terminó por quota de Apify). Reintentá cuando tengas más ads scrapeados.'
            : `El generador no pudo producir ideas: ${chunkErr.message}. Reintentá el pipeline.`);
        }
        setIdeasToday(countIdeasGeneradorHoy(productoActualId));
        updateStep('generate', {
          status: 'done',
          endedAt: Date.now(),
          detail: insertadas > 0
            ? `${insertadas} ideas nuevas agregadas en ${tandasOk} tanda${tandasOk !== 1 ? 's' : ''}`
            : 'El generador no encontró ideas nuevas — las que generó ya estaban en la Bandeja.',
        });
      } catch (err) {
        // SKIP_GENERATE es un soft-skip (ya avisamos en updateStep), no error.
        if (err.message !== 'SKIP_GENERATE') {
          updateStep('generate', { status: 'error', endedAt: Date.now(), detail: err.message });
        }
      }
    }

    // ============================================================
    // PASO: Score de hooks con Haiku — descarta los flojos.
    // Haiku barato puntúa 1-10 cada hook contra criterios fijos
    // (pattern-interrupt, especificidad, porteño, claims). Las ideas
    // con score <6 quedan en la bandeja con flag `lowScore` para que
    // el user las archive de un click. Antes ningún piso de calidad
    // existía → la bandeja se llenaba de hooks genéricos.
    // ============================================================
    if (!cancelledRef.current && insertedIdeasForScoring.length > 0) {
      updateStep('score-hooks', {
        status: 'running',
        startedAt: Date.now(),
        detail: `Scorando ${insertedIdeasForScoring.length} hooks con Haiku…`,
      });
      try {
        const scoreResp = await fetch('/api/marketing/score-hooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ideas: insertedIdeasForScoring }),
        });
        const scoreData = await parseJsonResponse(scoreResp, 'Scoring de hooks');
        if (!scoreResp.ok) throw new Error(scoreData.error || `HTTP ${scoreResp.status}`);
        trackCost(scoreData, `score-hooks · ${insertedIdeasForScoring.length} hooks`);

        const scoresMap = new Map((scoreData.scores || []).map(s => [s.id, s]));
        let lowScored = 0;
        let scoredOk = 0;
        for (const idea of insertedIdeasForScoring) {
          const s = scoresMap.get(idea.id);
          // Si no hay score numérico (idea sin entry, o Claude no la
          // puntuó), no marcamos nada — ni lowScore ni scoreValue. Antes
          // se trataba como floja por defecto.
          if (!s || typeof s.score !== 'number') continue;
          if (s.score < 6) {
            updateIdea(idea.id, { lowScore: true, scoreValue: s.score, scoreReason: s.reason });
            lowScored++;
          } else {
            updateIdea(idea.id, { lowScore: false, scoreValue: s.score, scoreReason: s.reason });
            scoredOk++;
          }
        }
        liveStats.hooksLowScore = lowScored;
        updateStep('score-hooks', {
          status: 'done',
          endedAt: Date.now(),
          detail: `${scoredOk} hooks pasaron · ${lowScored} marcados como flojos (revisá y archivá si querés)`,
        });
      } catch (err) {
        // No es fatal — las ideas ya están en la bandeja sin scoring.
        updateStep('score-hooks', {
          status: 'error',
          endedAt: Date.now(),
          detail: `Scoring falló: ${err.message}. Las ideas igual están en la Bandeja.`,
        });
      }
    } else if (!cancelledRef.current) {
      // No hay ideas nuevas para scorear — skip silencioso.
      updateStep('score-hooks', {
        status: 'done',
        endedAt: Date.now(),
        detail: 'Sin hooks nuevos para scorear (no se generaron ideas).',
      });
    }

    // Paso final
    updateStep('done', { status: 'running', startedAt: Date.now() });
    await new Promise(r => setTimeout(r, 400));
    updateStep('done', { status: 'done', endedAt: Date.now() });

    setRunning(false);
    const wasCancelled = cancelledRef.current;
    if (!wasCancelled) {
      try { localStorage.setItem(LAST_RUN_KEY, new Date().toISOString()); } catch {}
    }
    // Siempre persistimos el resumen al historial — incluso runs cancelados
    // o con errores, para que el user tenga traza completa de qué pasó.
    // Leemos los steps del ref (no desde adentro del updater de setSteps):
    // meter setRunHistory dentro del updater duplicaba la entrada si React
    // re-ejecutaba el updater (StrictMode / re-render).
    const finalSteps = stepsRef.current || [];
    const endedAt = Date.now();
    const startedAt = finalSteps.find(s => s.startedAt)?.startedAt || endedAt;
    const stepsError = finalSteps.filter(s => s.status === 'error').length;

    // Resumen de lo que produjo ESTA corrida: contamos las ideas de la
    // Bandeja de este producto creadas desde que arrancó el run y las
    // desglosamos por tipo y formato. Es lo que el user quiere ver al
    // terminar — cuántas réplicas, iteraciones, desde cero, imágenes y
    // videos. El -2000ms es un colchón por desfasaje de reloj.
    const runIdeas = loadIdeas().filter(i =>
      String(i.productoId || '') === String(producto?.id || '') &&
      i.createdAt && new Date(i.createdAt).getTime() >= startedAt - 2000
    );
    const breakdown = {
      ideasNuevas: runIdeas.length,
      replica: runIdeas.filter(i => i.tipo === 'replica').length,
      iteracion: runIdeas.filter(i => i.tipo === 'iteracion').length,
      diferenciacion: runIdeas.filter(i => i.tipo === 'diferenciacion').length,
      desde_cero: runIdeas.filter(i => i.tipo === 'desde_cero').length,
      imagenes: runIdeas.filter(i => i.formato !== 'video').length,
      videos: runIdeas.filter(i => i.formato === 'video').length,
    };

    const runEntry = {
      id: `run-${endedAt}`,
      productoId: producto?.id ? String(producto.id) : null,
      productoNombre: producto?.nombre || '',
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
      cancelled: wasCancelled,
      // Cost del run = acumulado local. Antes guardábamos `{ ...runCost }`
      // que cerraba sobre el snapshot inicial del state (siempre 0).
      cost: { ...acumuladoLocal },
      // Guardamos los steps (sin Date timestamps grandes) — sirve para
      // mostrar el detalle de qué pasó.
      steps: finalSteps.map(s => ({
        id: s.id,
        label: s.label,
        detail: s.detail,
        status: s.status,
        startedAt: s.startedAt || null,
        endedAt: s.endedAt || null,
      })),
      stats: {
        competidoresCount: (finalSteps.filter(s => s.id.startsWith('scrape-')).length),
        competidoresOk: (finalSteps.filter(s => s.id.startsWith('scrape-') && s.status === 'done').length),
        stepsError,
        // Contadores reales — no parseados con regex sobre el detail
        // string que rompía cualquier cambio de copy.
        winnersAnalyzed: liveStats.winnersAnalyzed,
        ideasInsertadas: liveStats.ideasInsertadas,
        ideasGeneradas: liveStats.ideasGeneradas,
        hooksLowScore: liveStats.hooksLowScore,
        // Desglose de lo producido — alimenta el resumen del historial.
        breakdown,
      },
    };
    setRunHistory(prev => [runEntry, ...prev].slice(0, RUN_HISTORY_CAP));
    if (!wasCancelled) {
      const partes = [];
      if (breakdown.replica) partes.push(`${breakdown.replica} réplica${breakdown.replica !== 1 ? 's' : ''}`);
      if (breakdown.iteracion) partes.push(`${breakdown.iteracion} iteración${breakdown.iteracion !== 1 ? 'es' : ''}`);
      const nuevasDesdeCero = breakdown.diferenciacion + breakdown.desde_cero;
      if (nuevasDesdeCero) partes.push(`${nuevasDesdeCero} desde cero`);
      const detalle = partes.length ? ` — ${partes.join(' · ')}` : '';
      addToast?.({
        type: 'success',
        message: `¡Listo! ${breakdown.ideasNuevas} idea${breakdown.ideasNuevas !== 1 ? 's' : ''} nueva${breakdown.ideasNuevas !== 1 ? 's' : ''}${detalle} · 🖼️ ${breakdown.imagenes} para imagen / 🎬 ${breakdown.videos} para video`,
      });
    }
  };

  const handleCancel = () => {
    setCancelled(true);
    addToast?.({ type: 'info', message: 'Cancelando después del paso actual…' });
  };

  // --- Estados derivados para los checks de la wizard ---
  // IMPORTANTE: tienen que estar declarados antes de `ofrecerRun` (que los
  // usa). `const` tiene temporal dead zone — usar antes de declarar
  // explota en prod minificado aunque el dev mode lo tolere.
  const prodReady = !!producto;
  const compsReady = competidores.length >= 1;

  const stepsDone = steps.filter(s => s.status === 'done').length;
  const stepsTotal = steps.length || 1;
  const progress = Math.round((stepsDone / stepsTotal) * 100);

  // Sugerencia de auto-run diario: si pasaron más de 24h desde el último
  // pipeline exitoso y hay competidores cargados, mostramos un prompt
  // suave al tope de la página.
  const lastRun = (() => {
    try {
      const raw = localStorage.getItem(LAST_RUN_KEY);
      return raw || null;
    } catch { return null; }
  })();
  const horasDesdeUltimoRun = lastRun
    ? Math.round((Date.now() - new Date(lastRun).getTime()) / 3600000)
    : null;
  const ofrecerRun = !running && prodReady && (horasDesdeUltimoRun == null || horasDesdeUltimoRun >= 24);

  // ====================================================================
  // VISTA DE LISTA DE PRODUCTOS (si no hay producto activo seleccionado)
  // ====================================================================
  if (!producto) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Guía del flujo — arriba de todo el módulo, también en la lista. */}
        <FlowGuide />
        {/* Antes había acá <BulkProgressBar state={bulkCreativos} .../> pero
            bulkCreativos / bulkAbortRef nunca se declararon — era código
            muerto que crasheaba al primer render. La barra real de bulk
            progress vive en InspiracionSection (renderizada cuando el bulk
            está corriendo). */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
              <Package size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Tus productos</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Cada producto tiene su propia competencia, research y bandeja de ideas.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Import file input — hidden, triggered by button */}
            <input
              type="file"
              ref={importFileInputRef}
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = ''; // reset para permitir re-importar el mismo archivo
                if (!file) return;
                try {
                  const result = await importProductoFromFile(file);
                  setProductos(loadJSON(PRODUCTOS_KEY, []));
                  addToast?.({
                    type: 'success',
                    message: `Importado "${result.producto.nombre}" — ${result.stats.brandsCount} brands · ${result.stats.ideasCount} ideas`,
                  });
                  if (result.warning) {
                    addToast?.({ type: 'info', message: result.warning });
                  }
                } catch (err) {
                  addToast?.({ type: 'error', message: `Import falló: ${err.message}` });
                }
              }}
            />
            {/* Toggle de vista grilla / lista */}
            {productos.length > 0 && (
              <div className="inline-flex items-center bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5">
                <button onClick={() => setVista('grid')}
                  className={`p-1.5 rounded-md transition ${vista === 'grid' ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}
                  title="Vista de grilla">
                  <LayoutGrid size={16} />
                </button>
                <button onClick={() => setVista('list')}
                  className={`p-1.5 rounded-md transition ${vista === 'list' ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}
                  title="Vista de lista">
                  <ListIcon size={16} />
                </button>
              </div>
            )}
            {/* Diagnóstico + Importar quedaron movidos al menú "..." (overflow
                menu) para liberar el header de la lista de productos. Eran
                acciones poco frecuentes que saturaban el primer scroll. */}
            <ProductosOverflowMenu
              onDiagnostico={() => setShowDiagnostico(true)}
              onImportar={() => importFileInputRef.current?.click()}
            />
            <button onClick={() => setShowProdForm(true)}
              className="btn-fluo inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg hover:from-brand-600 hover:to-brand-800 shadow-sm">
              <Plus size={16} /> Nuevo producto
            </button>
          </div>
        </div>

        {/* Form de nuevo producto */}
        {showProdForm && (
          <div className="bg-white dark:bg-gray-800 border-2 border-brand-300 dark:border-brand-700 rounded-xl p-5 space-y-3 animate-fade-in">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Nuevo producto</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="text" value={prodDraft.nombre} onChange={e => setProdDraft({ ...prodDraft, nombre: e.target.value })}
                placeholder="Nombre del producto"
                className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <input type="url" value={prodDraft.landingUrl} onChange={e => setProdDraft({ ...prodDraft, landingUrl: e.target.value })}
                placeholder="URL de la landing"
                className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <textarea value={prodDraft.descripcion} onChange={e => setProdDraft({ ...prodDraft, descripcion: e.target.value })}
              placeholder="Descripción corta (opcional)"
              rows={2}
              className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowProdForm(false); setProdDraft({ nombre: '', landingUrl: '', descripcion: '' }); }}
                className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleAddProducto}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-md hover:from-brand-600 hover:to-brand-800 transition">
                <Check size={12} /> Crear
              </button>
            </div>
          </div>
        )}

        {/* Lista de productos existentes */}
        {productos.length === 0 ? (
          /* ONBOARDING DE PRIMER USO — un usuario nuevo cae acá sin productos.
             En vez de un empty-state seco, lo recibimos, le mostramos el flujo
             en 3 pasos y le damos un CTA claro para arrancar. */
          <div className="relative overflow-hidden border border-brand-200 dark:border-brand-800 rounded-2xl p-8 md:p-10 bg-gradient-to-br from-brand-50 via-white to-amber-50 dark:from-brand-950/40 dark:via-gray-900 dark:to-amber-950/20">
            <div className="max-w-2xl mx-auto text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-amber-500 flex items-center justify-center text-white shadow-lg mb-4">
                <Sparkles size={26} />
              </div>
              <h3 className="text-xl md:text-2xl font-extrabold text-gray-900 dark:text-gray-100">¡Bienvenido a AdsLab!</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 max-w-md mx-auto">
                Acá cargás un producto, analizamos los ads ganadores de tu competencia y te generamos ideas y creativos listos para publicar. Empecemos por tu primer producto.
              </p>

              {/* Flujo en 3 pasos */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-7 mb-7 text-left">
                {[
                  { n: 1, ic: <Package size={16} />, t: 'Cargá tu producto', d: 'Nombre, landing y una foto. En segundos.' },
                  { n: 2, ic: <Search size={16} />, t: 'Sumá competencia', d: 'Scrapeamos sus ads ganadores de Meta.' },
                  { n: 3, ic: <Sparkles size={16} />, t: 'Generá ideas y creativos', d: 'Hooks, estáticos y briefs con IA.' },
                ].map(s => (
                  <div key={s.n} className="bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-xl p-3.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-6 h-6 rounded-lg bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 flex items-center justify-center text-xs font-bold shrink-0">{s.n}</span>
                      <span className="text-brand-600 dark:text-brand-400">{s.ic}</span>
                    </div>
                    <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{s.t}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{s.d}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
                <button onClick={() => setShowProdForm(true)}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-xl hover:from-brand-600 hover:to-brand-800 shadow-md transition">
                  <Plus size={16} /> Crear mi primer producto
                </button>
                <button onClick={() => importFileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/20 transition">
                  <Upload size={15} /> Importar uno existente
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={vista === 'grid' ? 'grid grid-cols-1 lg:grid-cols-2 gap-3' : 'space-y-2'}>
            {productos.map(p => {
              const comps = p.competidores || [];
              const hasResearch = !!(p.docs?.research);
              const ideasDelProducto = loadIdeas().filter(i => String(i.productoId || '') === String(p.id));
              const ideasCount = ideasDelProducto.length;
              const ideasByEstado = ideasDelProducto.reduce((acc, i) => {
                acc[i.estado || 'pendiente'] = (acc[i.estado || 'pendiente'] || 0) + 1;
                return acc;
              }, {});
              // adsTotal vive en localStorage (metadata). c.ads.length solo
              // existe si los ads aún están hidratados en memory. Fallback a
              // adsTotal previene el bug "0 ads tras reload" post-refactor IDB.
              const adsScrapeados = comps.reduce((sum, c) => sum + (c.adsTotal || c.ads?.length || 0), 0);
              const deepAnalyses = comps.reduce((sum, c) => sum + Object.keys(c.adsAnalysis || {}).length, 0);
              const runsDelProducto = runHistory.filter(r => String(r.productoId || '') === String(p.id));
              const ultimoRun = runsDelProducto[0];
              const costoTotal = runsDelProducto.reduce((sum, r) => sum + (r.cost?.total || 0), 0);

              const open = () => setActiveProductoId(String(p.id));

              // Pills compartidas entre grilla y lista.
              const researchPill = (
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold rounded ${
                  hasResearch
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                }`}>
                  {hasResearch ? '✓ Documentado' : '○ Sin research'}
                </span>
              );
              const stagePill = p.stage ? (
                <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300">
                  {(STAGE_LABEL[p.stage] || p.stage).replace('_', '-')}
                </span>
              ) : null;
              const metaPill = (
                <span className={`inline-flex items-center gap-1 ${p.metaAccount ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500 italic'}`}>
                  <BarChart3 size={11} />
                  {p.metaAccount ? `${p.metaAccount.name} · ${p.metaAccount.ads?.length || 0} ads` : 'Sin cuenta Meta'}
                </span>
              );

              // Botones de acción (sync / export / borrar) — aparecen en hover.
              const actions = (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      try {
                        const arr = JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]');
                        window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', { detail: { key: 'adslab-marketing-productos-v1' } }));
                        const brandsKey = `adslab-marketing-inspiracion-brands-${p.id}`;
                        if (localStorage.getItem(brandsKey)) {
                          window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', { detail: { key: brandsKey } }));
                        }
                        addToast?.({ type: 'info', message: `Sync forzado al cloud (${arr.length} productos). Esperá 2-3 segundos antes de cambiar de PC.` });
                      } catch (err) {
                        addToast?.({ type: 'error', message: `Sync falló: ${err.message}` });
                      }
                    }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition"
                    title="Forzar sync al cloud (útil al cambiar de PC)"
                  >
                    <Upload size={15} />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await downloadProductoExport(p.id);
                        addToast?.({ type: 'success', message: `Producto "${p.nombre}" exportado.` });
                      } catch (err) {
                        addToast?.({ type: 'error', message: `No pude exportar: ${err.message}` });
                      }
                    }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition"
                    title="Exportar producto (JSON backup)"
                  >
                    <Download size={15} />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      // Duplicar — útil cuando launching variantes del mismo concept
                      // (mismo research/competencia, ofertas distintas, etc).
                      // Se duplica TODO el producto salvo: id nuevo + sufijo " (copia)"
                      // en el nombre + bandejaIdeas vacía (las ideas son específicas
                      // del original).
                      const newName = window.prompt(`Nombre del producto duplicado:`, `${p.nombre} (copia)`);
                      if (!newName?.trim()) return;
                      const newId = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                      const dup = {
                        ...p,
                        id: newId,
                        nombre: newName.trim(),
                        createdAt: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        bandejaIdeas: [],          // las ideas son del original
                        competidores: (p.competidores || []).map(c => ({ ...c, id: `${c.id}-dup-${Math.random().toString(36).slice(2, 4)}`, ads: [] })),  // mismas brands, sin ads scrapeados (re-scrape para fresh data)
                        // Reseteamos lo que el user probablemente quiere refresh por variante:
                        fotoUrl: null,
                        fotoUpdatedAt: null,
                      };
                      setProductos(prev => [dup, ...prev]);
                      setActiveProductoId(String(newId));
                      addToast?.({ type: 'success', message: `"${newName}" duplicado. Re-scrapeá competidores y subí foto si cambia.` });
                    }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition"
                    title="Duplicar producto (mismo research/competencia, nuevo nombre)"
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!window.confirm(`¿Eliminar "${p.nombre}"? Se borran sus competidores, cuenta Meta y research. No se pueden recuperar.`)) return;
                      try {
                        await deleteProductoFromCloud(p.id);
                      } catch (err) {
                        addToast?.({ type: 'error', message: `No pude borrar del cloud: ${err.message}. Intentá de nuevo.` });
                        return;
                      }
                      setProductos(prev => prev.filter(x => String(x.id) !== String(p.id)));
                      if (String(p.id) === String(activeProductoId)) setActiveProductoId(null);
                    }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                    title="Eliminar producto"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              );

              // -------- VISTA LISTA (fila compacta) --------
              if (vista === 'list') {
                return (
                  <div key={p.id} onClick={open}
                    className="group glass-card card-hover flex items-center gap-3 border border-gray-200 dark:border-gray-700/80 rounded-xl px-3 py-2.5 cursor-pointer animate-fade-in-up">
                    <ProductAvatar id={p.id} nombre={p.nombre} producto={p} sizeClass="w-10 h-10" extra="text-base shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                      {/* Un solo chip de estado (research) + stage en texto sutil. */}
                      <div className="flex items-center gap-2 mt-0.5">
                        {researchPill}
                        {stagePill && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                            {(STAGE_LABEL[p.stage] || p.stage).replace('_', '-')}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 2 números fuertes (ideas, ads) — animados al cargar. */}
                    <div className="hidden md:flex items-center gap-5 shrink-0 px-2 text-xs">
                      <div className="text-right leading-none">
                        <div className={`text-base font-bold ${ideasCount > 0 ? 'text-brand-600 dark:text-brand-400' : 'text-gray-300 dark:text-gray-600'}`}>
                          <AnimatedCounter value={ideasCount} />
                        </div>
                        <div className="text-[9px] text-gray-400 mt-0.5">ideas</div>
                      </div>
                      <div className="text-right leading-none">
                        <div className={`text-base font-bold ${adsScrapeados > 0 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600'}`}>
                          <AnimatedCounter value={adsScrapeados} />
                        </div>
                        <div className="text-[9px] text-gray-400 mt-0.5">ads</div>
                      </div>
                      <div className="hidden lg:block w-28 text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
                        {(ideasByEstado.pendiente || 0)} pend{comps.length > 0 ? ` · ${comps.length} comp` : ''}{deepAnalyses > 0 ? ` · ${deepAnalyses} IA` : ''}
                      </div>
                    </div>
                    <div className="hidden xl:block text-[10px] shrink-0 w-40 truncate">{metaPill}</div>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition" onClick={e => e.stopPropagation()}>
                      {actions}
                    </div>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-brand-500 transition shrink-0" />
                  </div>
                );
              }

              // -------- VISTA GRILLA (tarjeta) --------
              return (
                <div key={p.id} onClick={open}
                  className="group glass-card card-hover relative border border-gray-200 dark:border-gray-700/80 rounded-2xl p-4 cursor-pointer animate-fade-in-up">
                  {/* Acciones (hover) */}
                  <div className="absolute top-3 right-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition" onClick={e => e.stopPropagation()}>
                    {actions}
                  </div>
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-4 pr-20">
                    <ProductAvatar id={p.id} nombre={p.nombre} producto={p} extra="text-lg group-hover:scale-105 transition" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {researchPill}
                        {stagePill && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                            {(STAGE_LABEL[p.stage] || p.stage).replace('_', '-')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Métricas */}
                  <div className="grid grid-cols-4 gap-2 py-3 border-y border-gray-100 dark:border-gray-700/60">
                    <ProductMetric label="Ideas" value={ideasCount} tone={ideasCount > 0 ? 'brand' : 'muted'} />
                    <ProductMetric label="Pendientes" value={ideasByEstado.pendiente || 0} tone={(ideasByEstado.pendiente || 0) > 0 ? 'amber' : 'muted'} />
                    <ProductMetric label="Competidores" value={comps.length} tone={comps.length > 0 ? 'default' : 'muted'} />
                    <ProductMetric label="Ads" value={adsScrapeados} tone={adsScrapeados > 0 ? 'default' : 'muted'} />
                  </div>
                  {/* Footer */}
                  <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-500 dark:text-gray-400 flex-wrap">
                    {metaPill}
                    {deepAnalyses > 0 && <span>· 🤖 {deepAnalyses} análisis</span>}
                    {ultimoRun && <span>· {new Date(ultimoRun.startedAt).toLocaleDateString('es-AR')}</span>}
                    {costoTotal > 0 && <span className="font-mono text-brand-600 dark:text-brand-400">· ${costoTotal.toFixed(2)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {showDiagnostico && <DiagnosticoSyncModal onClose={() => setShowDiagnostico(false)} />}
      </div>
    );
  }

  // ====================================================================
  // WORKSPACE DEL PRODUCTO ACTIVO
  // ====================================================================
  return (
    <div className="max-w-[1500px] mx-auto space-y-6">
      {/* Guía del flujo — arriba de todo, misma referencia en cualquier tab. */}
      <FlowGuide />
      {/* Header del producto */}
      <div className="flex items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm">
        <button onClick={() => setActiveProductoId(null)}
          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition shrink-0"
          title="Volver a la lista de productos">
          <ChevronRight size={18} className="rotate-180" />
        </button>
        <ProductAvatar
          id={producto.id}
          nombre={producto.nombre}
          producto={producto}
          radiusClass="rounded-xl"
          extra="shadow-sm text-xl"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            <button onClick={() => setActiveProductoId(null)} className="hover:text-brand-500 transition">Productos</button>
            <span className="mx-1">/</span>Workspace
          </p>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate leading-tight">{producto.nombre}</h2>
        </div>
        {producto.stage && (
          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800 shrink-0"
            title="Etapa del prospecto (awareness)">
            {STAGE_LABEL[producto.stage] || producto.stage}
          </span>
        )}
      </div>

      {/* Tabs del workspace — Dashboard, Setup, Bandeja, Inspiración, Creativos.
          Se muestran siempre en el panel principal: el nav vertical del sidebar
          (ProductNavInSidebar) fue removido por pedido del user, así que estas
          son la única forma de cambiar de tab — antes quedaban ocultas con el
          sidebar abierto y no aparecían en ningún lado. */}
      <ProductTabs activeTab={productoTab} onChange={setProductoTab} />

      {productoTab === 'bandeja' && (
        <div className="space-y-4">
          <GeneradorRapido
            producto={producto}
            addToast={addToast}
            onDone={() => setBandejaRefreshKey(k => k + 1)}
          />
          <div className="-mx-4">
            <BandejaSection key={bandejaRefreshKey} addToast={addToast} forcedProductoId={String(producto.id)} embedded />
          </div>
        </div>
      )}

      {productoTab === 'documentos' && (
        <DocumentacionTab
          producto={producto}
          addToast={addToast}
          onUpdateProducto={(patch) => {
            setProductos(prev => prev.map(p =>
              String(p.id) === String(producto.id) ? { ...p, ...patch } : p
            ));
          }}
        />
      )}

      {productoTab === 'campanas' && (
        <div className="-mx-4">
          <CampanasTracker addToast={addToast} />
        </div>
      )}

      {productoTab === 'inspiracion' && (
        <div className="-mx-4">
          <InspiracionSection addToast={addToast} forcedProductoId={String(producto.id)} embedded />
        </div>
      )}

      {productoTab === 'galeria' && (
        <GaleriaReferencialesModal
          productoId={producto.id}
          productoNombre={producto.nombre}
          embedded
        />
      )}

      {productoTab === 'creativos' && (
        <CreativosTab
          producto={producto}
          addToast={addToast}
          onUpdateProducto={(patch) => {
            setProductos(prev => prev.map(p =>
              String(p.id) === String(producto.id) ? { ...p, ...patch } : p
            ));
          }}
        />
      )}

      {productoTab === 'copiloto' && (
        <CopilotoTab producto={producto} addToast={addToast} />
      )}

      {productoTab === 'setup' && <>

      {/* Nudge de auto-run: si pasaron > 24h y el user no está corriendo ahora */}
      {ofrecerRun && (
        <div className="px-4 py-3 bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-900/20 dark:to-brand-950/20 border border-brand-200 dark:border-brand-800 rounded-lg flex items-center gap-3">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white">
            <Sparkles size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {lastRun
                ? `Hace ${horasDesdeUltimoRun >= 48 ? `${Math.round(horasDesdeUltimoRun / 24)} días` : `${horasDesdeUltimoRun} horas`} que no corrés el pipeline`
                : 'Todavía no corriste el pipeline'}
            </p>
            <p className="text-[11px] text-gray-600 dark:text-gray-300">
              Lo ideal es correrlo 1 vez por día para detectar ganadores nuevos, ads propios fatigando y armar ideas frescas para la Bandeja.
            </p>
          </div>
          <button onClick={runPipeline}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-md hover:from-brand-600 hover:to-brand-800 transition shadow-sm">
            <Play size={12} /> Correr ahora
          </button>
        </div>
      )}

      {/* Paso 1 — Producto */}
      <WizardCard
        num="1"
        title="Tu producto"
        done={prodReady}
        badge={prodReady ? producto.nombre : null}
      >
        {prodReady ? (
          <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
            <ProductoNombreEditable producto={producto} onRename={handleRenameProducto} />
            {producto.landingUrl && (
              <a href={producto.landingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                <Link2 size={11} /> {producto.landingUrl}
              </a>
            )}
            {producto.descripcion && <p className="text-gray-600 dark:text-gray-400">{producto.descripcion}</p>}
            {/* Stage — solo visible si ya se infirió en el pipeline.
                Editable por si el user quiere override el juicio de la IA. */}
            {producto.stage && (
              <div className="flex items-center gap-2 mt-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Stage inferido:</label>
                <select value={producto.stage}
                  onChange={e => setProductos(prev => prev.map(p => String(p.id) === String(producto.id) ? { ...p, stage: e.target.value } : p))}
                  className="px-2 py-0.5 text-[11px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                  title={producto.stageReason || ''}>
                  <option value="problem_aware">Problem-Aware</option>
                  <option value="solution_aware">Solution-Aware</option>
                  <option value="product_aware">Product-Aware</option>
                </select>
                {producto.stageReason && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate flex-1" title={producto.stageReason}>
                    · {producto.stageReason.slice(0, 80)}{producto.stageReason.length > 80 ? '…' : ''}
                  </span>
                )}
              </div>
            )}
            {/* Estado del research doc — ahora lo genera el pipeline automático
                como primer paso, no hay que ir a Documentación aparte. */}
            {(() => {
              const hasResearch = !!(producto.docs?.research || producto.research || producto.docs?.avatar || producto.avatar);
              if (hasResearch) {
                return (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded">
                    ✓ Research doc cargado — ideas van a salir más ancladas al avatar
                  </div>
                );
              }
              return (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800 rounded">
                  ℹ️ Sin research doc todavía — el pipeline lo genera solo en el primer paso (~3-4 min).
                </div>
              );
            })()}

            {/* Foto del producto para usar como referencia en gpt-image-2
                cuando se generan creativos referenciales desde Inspiración. */}
            <ProductoImagenUploader productoId={producto.id} producto={producto} addToast={addToast} />

            {/* Activo visual de marca — elemento icónico reutilizable que se
                propaga a todos los prompts de imagen. */}
            <details className="mt-3 group">
              <summary className="cursor-pointer inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-400">
                <ChevronDown size={10} className="group-open:rotate-180 transition-transform" />
                🎨 Activo visual de marca (opcional)
                {producto.activoVisual?.descripcion && <span className="text-emerald-600 dark:text-emerald-400">✓ definido</span>}
              </summary>
              <div className="mt-2 space-y-2 pl-4">
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Elemento icónico reutilizable de tu marca (frasco distintivo, textura, forma, empaque). Claude lo va a incluir en 40-60% de los prompts de imagen como hilo conductor visual.
                </p>
                <textarea
                  value={producto.activoVisual?.descripcion || ''}
                  onChange={e => setProductos(prev => prev.map(p =>
                    String(p.id) === String(activeProductoId)
                      ? { ...p, activoVisual: { ...(p.activoVisual || {}), descripcion: e.target.value } }
                      : p
                  ))}
                  placeholder="Ej: Frasco de vidrio ámbar con tapa dorada, textura tallada en el cuerpo, etiqueta minimalista granate con tipografía serif."
                  rows={3}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
                />
                <input
                  type="url"
                  value={producto.activoVisual?.imageUrl || ''}
                  onChange={e => setProductos(prev => prev.map(p =>
                    String(p.id) === String(activeProductoId)
                      ? { ...p, activoVisual: { ...(p.activoVisual || {}), imageUrl: e.target.value } }
                      : p
                  ))}
                  placeholder="URL de una imagen de referencia (opcional)"
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </details>

            {/* Formato físico del producto — gomitas / cápsulas / etc.
                CRÍTICO porque el generador de imágenes copia el formato del ad
                de referencia si no le decimos explícito. Si tenés gomitas y
                la inspiración es cápsulas → el creativo va a salir con cápsulas
                a menos que cargues ESTO. */}
            <details className="mt-3 group">
              <summary className="cursor-pointer inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-400">
                <ChevronDown size={10} className="group-open:rotate-180 transition-transform" />
                🧪 Formato del producto (CRÍTICO para generar bien)
                {producto.formato?.trim() && <span className="text-emerald-600 dark:text-emerald-400">✓ {producto.formato}</span>}
              </summary>
              <div className="mt-2 space-y-2 pl-4">
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Forma física en la que viene tu producto. Sin esto, el generador puede dibujarte cápsulas cuando vendés gomitas (porque copia del ad de inspiración). Con esto, la palabra y el visual coinciden con tu formato real.
                </p>
                <select
                  value={producto.formato || ''}
                  onChange={e => setProductos(prev => prev.map(p =>
                    String(p.id) === String(activeProductoId)
                      ? { ...p, formato: e.target.value, updated_at: new Date().toISOString() }
                      : p
                  ))}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— No seleccionado (heurística) —</option>
                  <option value="gomitas">🟢 Gomitas / gummies</option>
                  <option value="cápsulas">💊 Cápsulas / softgels / pastillas</option>
                  <option value="comprimidos">⚪ Comprimidos / tabletas</option>
                  <option value="polvo">🥄 Polvo (mix)</option>
                  <option value="gotas">💧 Gotas / liquid drops</option>
                  <option value="shot">🥤 Shot líquido</option>
                  <option value="sachet">📦 Sachet / stick individual</option>
                  <option value="sérum">🧴 Sérum</option>
                  <option value="crema">🪞 Crema / loción / emulsión</option>
                  <option value="aceite">🛢️ Aceite</option>
                  <option value="bálsamo">💄 Bálsamo</option>
                  <option value="spray">🌬️ Spray</option>
                  <option value="stick">📍 Stick / barra</option>
                  <option value="mascarilla">🎭 Mascarilla / máscara</option>
                  <option value="parches">🩹 Parches</option>
                  <option value="otros">❓ Otros (deja heurística)</option>
                </select>
              </div>
            </details>

            {/* Ofertas y claims reales — opcional. Si no se carga, los creativos
                referenciales generados van a SACAR cualquier promo/claim del ad
                de referencia (mejor decir menos que inventar una oferta falsa).
                Si se carga, Vision tiene permiso explícito para usarlos. */}
            <details className="mt-3 group">
              <summary className="cursor-pointer inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-400">
                <ChevronDown size={10} className="group-open:rotate-180 transition-transform" />
                💰 Tus ofertas reales — precio, promos, claims (recomendado)
                {producto.ofertasReales?.trim() && <span className="text-emerald-600 dark:text-emerald-400">✓ cargado</span>}
              </summary>
              <div className="mt-2 space-y-2 pl-4">
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Precio actual, promos vigentes y claims regulatorios de TU tienda. Cuando lo cargás, el generador REEMPLAZA las ofertas del ad de la competencia ("$29", "lleva 2 + 1 gratis", "FDA Approved") por las tuyas. Sin esto, las quita por defecto (no inventa). Ejemplo: si el ad ref dice "$29 USD" y vos ponés "USD 49 + envío gratis", el creativo va a decir "USD 49 + envío gratis".
                </p>
                <textarea
                  value={producto.ofertasReales || ''}
                  onChange={e => setProductos(prev => prev.map(p =>
                    String(p.id) === String(activeProductoId)
                      ? { ...p, ofertasReales: e.target.value, updated_at: new Date().toISOString() }
                      : p
                  ))}
                  placeholder={`Ejemplos:
• Precio: USD 49 (o ARS 49.900)
• 3x2 — Comprá 3 frascos y pagás 2
• Envío gratis a todo el país
• 30 días para devolverlo si no te gusta
• ANMAT registrado
• Sin gluten · Sin TACC
• Formulado por farmacéuticos`}
                  rows={6}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y font-mono"
                />
              </div>
            </details>
          </div>
        ) : !showProdForm ? (
          <button onClick={() => setShowProdForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-md hover:from-brand-600 hover:to-brand-800 transition">
            <Plus size={12} /> Cargar producto
          </button>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" value={prodDraft.nombre} onChange={e => setProdDraft({ ...prodDraft, nombre: e.target.value })}
                placeholder="Nombre del producto"
                className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <input type="url" value={prodDraft.landingUrl} onChange={e => setProdDraft({ ...prodDraft, landingUrl: e.target.value })}
                placeholder="URL de la landing"
                className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <textarea value={prodDraft.descripcion} onChange={e => setProdDraft({ ...prodDraft, descripcion: e.target.value })}
              placeholder="Descripción corta (opcional — qué es, para quién, diferenciales)"
              rows={2}
              className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y" />
            <p className="text-[10px] text-gray-500 dark:text-gray-400 italic -mt-1">
              No te pedimos stage (problem/solution/product-aware) porque lo inferimos solos del research doc cuando corras el pipeline.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowProdForm(false); setProdDraft({ nombre: '', landingUrl: '', descripcion: '' }); }}
                className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleAddProducto}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-md hover:from-brand-600 hover:to-brand-800 transition">
                <Check size={12} /> Guardar
              </button>
            </div>
          </div>
        )}
      </WizardCard>

      {/* Paso 2 — Cuenta publicitaria Meta (opcional) */}
      <WizardCard
        num="2"
        title="Tu cuenta publicitaria (opcional)"
        done={!!metaAccount}
        badge={metaAccount ? `${metaAccount.ads?.length || 0} ads activos` : null}
      >
        {!metaConnected ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            Conectá Meta arriba para elegir la cuenta publicitaria del producto.
            Es opcional — sin esto solo analizamos competencia, no tus propios creativos.
          </p>
        ) : metaAccount ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{metaAccount.name}</span>
              <span className="text-gray-400">· {metaAccount.currency}</span>
              <span className="text-gray-400">· {metaAccount.ads?.length || 0} ads</span>
              {metaAccount.productMatched && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">
                  ✓ {metaAccount.ads.filter(a => a.productMatch).length} del producto
                </span>
              )}
              <button onClick={resetMetaAccount}
                className="ml-auto p-1 text-gray-400 hover:text-red-600 transition" title="Cambiar cuenta">
                <X size={12} />
              </button>
            </div>

            {/* Resumen de fatigue — solo si hay al menos 1 ad con estado detectado */}
            {(() => {
              const summary = (metaAccount.ads || []).reduce((acc, a) => {
                const s = a.fatigue?.status || 'new';
                acc[s] = (acc[s] || 0) + 1;
                return acc;
              }, {});
              const critical = (summary.dying || 0) + (summary.fatiguing || 0);
              if ((metaAccount.ads?.length || 0) === 0 || critical === 0 && !summary.healthy) return null;
              return (
                <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                  {summary.dying > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded font-bold">
                      💀 {summary.dying} muriendo
                    </span>
                  )}
                  {summary.fatiguing > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded font-bold">
                      🔻 {summary.fatiguing} fatigando
                    </span>
                  )}
                  {summary.warming > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded">
                      📈 {summary.warming} escalando
                    </span>
                  )}
                  {summary.healthy > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">
                      ✅ {summary.healthy} sanos
                    </span>
                  )}
                  {critical > 0 && (
                    <span className="text-gray-500 dark:text-gray-400 italic ml-1">
                      · el pipeline va a priorizar iteraciones sobre los {critical} que están cayendo
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Botón matcher IA */}
            {producto?.nombre && !metaAccount.productMatched && (
              <button onClick={matchProductAds} disabled={matching}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-md hover:from-brand-600 hover:to-brand-800 transition disabled:opacity-40">
                {matching ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Identificar ads del producto con IA
              </button>
            )}
            {producto?.nombre && metaAccount.productMatched && metaAccount.productMatched !== producto.nombre && (
              <button onClick={matchProductAds} disabled={matching}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-700 border border-brand-300 dark:border-brand-800 rounded-md hover:bg-brand-50 transition disabled:opacity-40">
                {matching ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Re-matchear (producto cambió a "{producto.nombre}")
              </button>
            )}

            {metaAccount.ads?.length > 0 && (
              <details className="bg-gray-50 dark:bg-gray-800/50 rounded-md">
                <summary className="cursor-pointer px-3 py-2 text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  Ver ads cargados
                </summary>
                <ul className="px-3 pb-3 space-y-1 text-xs text-gray-700 dark:text-gray-300 max-h-72 overflow-y-auto">
                  {metaAccount.ads.slice(0, 30).map(ad => {
                    const fat = ad.fatigue || {};
                    const fatBadge = {
                      dying:     { icon: '💀', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', label: 'muriendo' },
                      fatiguing: { icon: '🔻', color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', label: 'fatigando' },
                      warming:   { icon: '📈', color: 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300', label: 'escalando' },
                      healthy:   { icon: '✅', color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', label: 'saludable' },
                      new:       { icon: '🆕', color: 'bg-gray-100 dark:bg-gray-700 text-gray-600', label: 'nuevo' },
                    }[fat.status] || null;
                    return (
                      <li key={ad.id} className="flex items-center gap-2 py-1 border-b border-gray-100 dark:border-gray-700/50">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                          ad.effectiveStatus === 'ACTIVE' ? 'bg-emerald-500' : 'bg-gray-400'
                        }`} />
                        {ad.productMatch && (
                          <span className={`inline-flex items-center px-1 py-0.5 text-[9px] font-bold rounded ${
                            ad.productMatch.confidence === 'high' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' :
                            ad.productMatch.confidence === 'medium' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' :
                            'bg-gray-100 dark:bg-gray-700 text-gray-600'
                          }`} title={ad.productMatch.reason}>
                            ✓ {ad.productMatch.confidence}
                          </span>
                        )}
                        {fatBadge && (
                          <span className={`inline-flex items-center px-1 py-0.5 text-[9px] font-bold rounded ${fatBadge.color}`}
                            title={fat.reason}>
                            {fatBadge.icon} {fatBadge.label}
                          </span>
                        )}
                        {ad.audienceSegment && (
                          <span className={`inline-flex items-center px-1 py-0.5 text-[9px] font-semibold rounded ${
                            ad.audienceSegment === 'retargeting'
                              ? 'bg-brand-200 dark:bg-brand-900/40 text-brand-800 dark:text-brand-300'
                              : 'bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300'
                          }`} title={
                            ad.audienceSegment === 'retargeting'
                              ? 'Retargeting / warm — CTR esperado 2-5%, tolera freq 5-8'
                              : 'Prospecting / cold — CTR esperado 0.8-1.5%, freq >4 quema'
                          }>
                            {ad.audienceSegment === 'retargeting' ? '🔥 warm' : '❄️ cold'}
                          </span>
                        )}
                        <span className="flex-1 truncate font-semibold">{ad.creative?.title || ad.name}</span>
                        {ad.insights && (
                          <span className="text-[10px] text-gray-500 font-mono flex items-center gap-1.5" title={
                            `CTR ${ad.insights.ctr.toFixed(2)}% · ROAS ${ad.insights.roas.toFixed(2)} · CPA $${ad.insights.cpa.toFixed(2)}${
                              ad.insights.thumbStopRate > 0 ? ` · thumb-stop ${ad.insights.thumbStopRate.toFixed(1)}%` : ''
                            }`
                          }>
                            <span>CTR {(ad.insights.ctr).toFixed(2)}%</span>
                            {fat.ctrChangePct != null && (
                              <span className={fat.ctrChangePct < 0 ? 'text-red-500' : 'text-emerald-500'}>
                                ({fat.ctrChangePct > 0 ? '+' : ''}{fat.ctrChangePct}%)
                              </span>
                            )}
                            {ad.insights.roas > 0 && (
                              <span className={`${ad.insights.roas >= 2 ? 'text-emerald-600' : ad.insights.roas >= 1 ? 'text-amber-600' : 'text-red-500'}`}>
                                · ROAS {ad.insights.roas.toFixed(2)}
                              </span>
                            )}
                          </span>
                        )}
                      </li>
                    );
                  })}
                  {metaAccount.ads.length > 30 && (
                    <li className="text-[10px] text-gray-400 italic pt-1">+ {metaAccount.ads.length - 30} ads más</li>
                  )}
                </ul>
              </details>
            )}
          </div>
        ) : availableAccounts.length === 0 ? (
          <button onClick={loadAdAccounts} disabled={loadingAccounts}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-md hover:from-[#0556BE] hover:to-[#1668D8] transition disabled:opacity-40">
            {loadingAccounts ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            Ver mis cuentas publicitarias
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
              Elegí qué cuenta usar para este producto
            </p>
            <ul className="space-y-1">
              {availableAccounts.map(acc => (
                <li key={acc.id}>
                  <button onClick={() => selectAccount(acc)} disabled={loadingAds}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition disabled:opacity-40">
                    <span className="font-semibold text-gray-900 dark:text-gray-100 flex-1">{acc.name}</span>
                    <span className="text-[10px] text-gray-500">{acc.currency}</span>
                    {acc.business && <span className="text-[10px] text-gray-400">· {acc.business}</span>}
                    {loadingAds && <Loader2 size={12} className="animate-spin text-brand-500" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </WizardCard>

      {/* Paso 3 — Competidores (summary). Gestión completa vive en tab Competencia. */}
      <WizardCard
        num="3"
        title="Competencia"
        done={compsReady}
        badge={compsReady ? `${competidores.length} cargado${competidores.length > 1 ? 's' : ''}` : null}
      >
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          Marcas que monitoreás. Cada corrida del pipeline scrapea sus ads y extrae los ganadores para inspirar ideas.
        </p>

        {!showCompForm && (
          <button onClick={() => setShowCompForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-3 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-md hover:from-brand-600 hover:to-brand-700 shadow-sm transition">
            <Plus size={12} /> Agregar competidor
          </button>
        )}

        {/* Form de agregar */}
        {showCompForm && (
          <div className="bg-gray-50 dark:bg-gray-900/40 border border-brand-300 dark:border-brand-700 rounded-xl p-3 mb-3 flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={compDraft.nombre} onChange={e => setCompDraft({ ...compDraft, nombre: e.target.value })}
                placeholder="Nombre de la marca (opcional)"
                className="flex-1 px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <input type="url" value={compDraft.landingUrl} onChange={e => setCompDraft({ ...compDraft, landingUrl: e.target.value })}
                placeholder="https://landing-del-competidor.com (recomendado)"
                className="flex-1 px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            {/* Biblioteca de anuncios DIRECTA — Meta Ad Library URL con
                filtros + sort que el user armó a mano. Es la forma más
                precisa de scrapear: garantiza que veamos los ads que
                realmente pertenecen a la marca (no los random que resuelva
                la FB page). Es opcional pero recomendado para marcas
                grandes con muchos ads. */}
            <div className="flex flex-col gap-1">
              <input type="url" value={compDraft.adLibraryUrl} onChange={e => setCompDraft({ ...compDraft, adLibraryUrl: e.target.value })}
                placeholder="https://www.facebook.com/ads/library/?... (opcional, URL armada a mano)"
                className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <p className="text-[10px] text-gray-500 dark:text-gray-400 italic px-1">
                Si pegás la URL exacta de la biblioteca de anuncios (con filtros, sort por impressions, etc), la usamos directo en vez de adivinar la FB page. Recomendado para marcas con muchos ads.
              </p>
            </div>
            <div className="flex gap-1 justify-end">
              <button onClick={() => { setShowCompForm(false); setCompDraft({ nombre: '', landingUrl: '', adLibraryUrl: '' }); }}
                className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleAddCompetidor}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-red-500 rounded-md hover:from-brand-600 hover:to-red-600 transition">
                <Check size={12} /> Agregar
              </button>
            </div>
          </div>
        )}

        {/* Master switch del auto-refresh — controla si el cron diario
            scrapea ESTE producto. Si está OFF, ningún competidor de este
            producto se refresca automático (independiente de sus toggles
            individuales). Default OFF — opt-in explícito del user. */}
        {competidores.length > 0 && (
          <div className="mb-3 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 flex items-center gap-2.5">
            <Clock size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-gray-900 dark:text-gray-100 leading-tight">
                Auto-refresh diario {producto?.autoRefreshEnabled ? '✓ ON' : '○ OFF'}
              </p>
              <p className="text-[10px] text-gray-600 dark:text-gray-400 leading-tight mt-0.5">
                {producto?.autoRefreshEnabled
                  ? 'Santi scrapea los competidores marcados con ⏰ a las 3 AM. Activá ⏰ en cada uno que quieras refrescar.'
                  : 'Cada producto controla su propio auto-refresh. Activá si querés que el cron scrapee TUS competidores de este producto.'}
              </p>
            </div>
            <button
              onClick={() => {
                if (!producto) return;
                setProductos(prev => prev.map(p =>
                  String(p.id) === String(producto.id)
                    ? { ...p, autoRefreshEnabled: !p.autoRefreshEnabled, updated_at: new Date().toISOString() }
                    : p
                ));
              }}
              className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition ${
                producto?.autoRefreshEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
              title={producto?.autoRefreshEnabled ? 'Desactivar auto-refresh para este producto' : 'Activar auto-refresh para este producto'}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  producto?.autoRefreshEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        )}

        {/* Lista de competidores */}
        {competidores.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            Sin competidores todavía. Agregá al menos 1 con la URL de su landing.
          </p>
        ) : (
          <div className="space-y-2">
            {competidores.map(c => {
              const total = c.adsTotal || c.ads?.length || 0;
              const winners = c.winnersCount || 0;
              const analizado = !!c.lastAdsCheck;
              const favHost = hostnameOf(c.landingUrl);
              return (
                <div key={c.id} className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-400 to-red-400 flex items-center justify-center text-white font-bold text-sm shrink-0 relative overflow-hidden">
                    {c.nombre?.charAt(0)?.toUpperCase() || '?'}
                    {favHost && (
                      <img src={`https://www.google.com/s2/favicons?domain=${favHost}&sz=64`} alt=""
                        className="absolute inset-0 w-full h-full object-contain bg-white p-1.5"
                        onError={e => { e.currentTarget.style.display = 'none'; }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{c.nombre}</p>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 flex-wrap mt-0.5">
                      {c.landingUrl && (
                        <a href={c.landingUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline truncate max-w-[280px]">
                          {c.landingUrl.replace(/^https?:\/\//, '').replace(/^www\./, '')}
                        </a>
                      )}
                      {c.lastAdsCheck && <span>· {new Date(c.lastAdsCheck).toLocaleDateString('es-AR')}</span>}
                    </div>
                    <div className="mt-1.5">
                      {!analizado ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                          ○ Sin analizar — la próxima corrida scrapea sus ads
                        </span>
                      ) : total === 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded">
                          ⚠ Analizado pero sin ads activos
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">
                          ✓ Analizado
                        </span>
                      )}
                    </div>
                  </div>
                  {total > 0 && (
                    <div className="shrink-0 text-right text-xs tabular-nums">
                      <p className="font-bold text-gray-900 dark:text-gray-100">{total} ads</p>
                      {winners > 0 && <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">{winners} ganadores 🏆</p>}
                    </div>
                  )}
                  {/* Toggle "auto-refresh diario" — opt-in. Si activado, el
                      cron de las 6 AM scrapea este competidor diariamente. */}
                  <button
                    onClick={() => setCompetidores(prev => prev.map(x =>
                      x.id === c.id ? { ...x, autoRefresh: !x.autoRefresh } : x
                    ))}
                    className={`p-1.5 rounded transition shrink-0 ${
                      c.autoRefresh
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100'
                        : 'text-gray-300 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                    }`}
                    title={c.autoRefresh
                      ? 'Auto-refresh diario ACTIVADO — el cron scrapea este competidor a las 3 AM (Buenos Aires). Click para desactivar.'
                      : 'Activar auto-refresh diario — Santi va a scrapear este competidor todas las noches a las 3 AM sin que tengas que pedirlo.'}
                  >
                    <Clock size={14} />
                  </button>
                  <button onClick={() => handleRemoveCompetidor(c.id)}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition shrink-0"
                    title="Quitar competidor">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </WizardCard>

      {/* Paso 4 — Correr pipeline */}
      <WizardCard
        num="4"
        title="Correr el pipeline"
        done={false}
        disabled={!prodReady}
        badge={null}
      >
        {!prodReady ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">Primero cargá el producto (nombre + landing) en el paso 1.</p>
        ) : (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">
              Si tu producto aún no tiene research doc, el sistema lo genera primero (~4 min). Después infiere el stage del prospect, scrapea los ads de los competidores que cargaste, detecta ganadores, genera ideas y scorea los hooks. Primera corrida: 8-15 min. Corridas siguientes: 2-5 min. Necesitás al menos 1 competidor cargado.
            </p>

            {/* Config del generador — colapsable */}
            <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-lg">
              <button onClick={() => setShowGenConfig(v => !v)}
                className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-200">
                <span className="inline-flex items-center gap-2">
                  ⚙️ Generador de ideas
                  <span className="text-[10px] font-mono text-gray-400">
                    {genConfig.limiteDiario} ideas/corrida · {genConfig.formatoStatic}/{genConfig.formatoVideo} static/video
                  </span>
                </span>
                <ChevronDown size={12} className={`text-gray-400 transition-transform ${showGenConfig ? 'rotate-180' : ''}`} />
              </button>
              {showGenConfig && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Ideas por corrida</label>
                    <input type="number" min="1" max={MAX_IDEAS_PER_RUN} value={genConfig.limiteDiario}
                      onChange={e => {
                        // FIX: antes hacíamos `Number(value) || 50`. Eso pisaba
                        // el input con 50 cuando el field quedaba vacío (al
                        // borrar para tipear "10"), imposibilitando llegar a
                        // números chicos. Ahora permitimos vacío y clampeamos
                        // SOLO si el user ingresó un número válido.
                        const raw = e.target.value;
                        if (raw === '') {
                          setGenConfig(c => ({ ...c, limiteDiario: '' }));
                          return;
                        }
                        const n = Number(raw);
                        if (isNaN(n)) return;
                        setGenConfig(c => ({ ...c, limiteDiario: Math.max(1, Math.min(MAX_IDEAS_PER_RUN, n)) }));
                      }}
                      onBlur={e => {
                        // Al perder foco, si quedó vacío o inválido, restauramos
                        // el mínimo viable. Sin esto el form se rompía al submit.
                        const n = Number(e.target.value);
                        if (isNaN(n) || n < 1) setGenConfig(c => ({ ...c, limiteDiario: 1 }));
                      }}
                      className="w-24 px-2 py-1 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      Cuántas ideas pide el generador en cada corrida. La primera corrida del producto genera entre 50 y {MAX_IDEAS_PER_RUN} según cuántos ads tenga la competencia. El dedup evita repetir ideas entre corridas.
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase">Mix static / video</label>
                      {competitorMix && (
                        <button onClick={usarMixCompetencia}
                          className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline">
                          📊 Usar mix de la competencia ({competitorMix.staticPct}/{competitorMix.videoPct})
                        </button>
                      )}
                    </div>

                    {/* Slider + inputs numéricos sincronizados */}
                    <input type="range" min="0" max="100" step="5" value={genConfig.formatoStatic}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setGenConfig(c => ({ ...c, formatoStatic: v, formatoVideo: 100 - v }));
                      }}
                      className="w-full accent-brand-600 cursor-pointer" />
                    <div className="flex items-center gap-2 mt-1">
                      <input type="number" min="0" max="100" value={genConfig.formatoStatic}
                        onChange={e => {
                          const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          setGenConfig(c => ({ ...c, formatoStatic: v, formatoVideo: 100 - v }));
                        }}
                        className="w-16 px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-brand-500" />
                      <span className="text-[10px] text-gray-500">% static</span>
                      <span className="text-gray-400 mx-1">·</span>
                      <input type="number" min="0" max="100" value={genConfig.formatoVideo}
                        onChange={e => {
                          const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          setGenConfig(c => ({ ...c, formatoVideo: v, formatoStatic: 100 - v }));
                        }}
                        className="w-16 px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-brand-500" />
                      <span className="text-[10px] text-gray-500">% video</span>
                    </div>

                    {competitorMix ? (
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5">
                        <span className="font-semibold">Dato de tu competencia:</span>{' '}
                        {competitorMix.basadoEnWinners
                          ? `de los ${competitorMix.winnerAds} ads ganadores de tu competencia, ${competitorMix.videoPct}% son video — ese es el formato de lo que funciona.`
                          : `${competitorMix.videoPct}% de los ${competitorMix.totalAds} ads usa video (pocos ganadores todavía — mix general).`}
                      </p>
                    ) : (
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 italic">
                        Corré el pipeline al menos una vez para ver qué mix usa tu competencia y ajustar en base a eso.
                      </p>
                    )}
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      Videos incluyen guión con beats numerados + duración + VO. Statics incluyen layout + composición + paleta.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!running ? (
                <button onClick={runPipeline}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-700 hover:to-brand-600 shadow-sm transition">
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
                  <button onClick={() => setProductoTab('bandeja')}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded transition">
                      Ver Bandeja de ideas <ChevronRight size={12} />
                  </button>
                  <button onClick={() => setProductoTab('setup')}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded transition">
                      Ver Competencia <ChevronRight size={12} />
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* Banner de éxito al terminar — CTA grande para ir a la Bandeja */}
        {!running && steps.length > 0 && steps[steps.length - 1]?.id === 'done' && steps[steps.length - 1]?.status === 'done' && (() => {
          const ultimoRun = runHistory.find(r => String(r.productoId || '') === String(producto?.id || ''));
          const winnersTotal = ultimoRun?.stats?.winnersAnalyzed || 0;
          // Total REAL de ideas nuevas = todas las del producto creadas
          // durante el run (réplicas del deep-analyze + las del generador).
          // Antes mostrábamos solo stats.ideasInsertadas (del generador) →
          // decía "0 ideas" aunque hubiera 14 réplicas. Eso confundía.
          const runStart = ultimoRun ? new Date(ultimoRun.startedAt).getTime() : 0;
          const ideasNuevas = runStart
            ? loadIdeas().filter(i =>
                String(i.productoId || '') === String(producto?.id || '') &&
                i.createdAt && new Date(i.createdAt).getTime() >= runStart - 5000
              ).length
            : (ultimoRun?.stats?.ideasInsertadas || 0);
          return (
            <div className="mt-5 p-4 bg-gradient-to-br from-emerald-50 to-brand-50 dark:from-emerald-900/20 dark:to-brand-900/20 border-2 border-emerald-300 dark:border-emerald-700 rounded-xl">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-brand-500 flex items-center justify-center text-white shadow">
                  <Check size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-emerald-900 dark:text-emerald-100">¡Pipeline terminado!</p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    {winnersTotal > 0 && <><strong>{winnersTotal}</strong> ganador{winnersTotal !== 1 ? 'es' : ''} analizado{winnersTotal !== 1 ? 's' : ''} · </>}
                    {ideasNuevas > 0 ? <><strong>{ideasNuevas}</strong> idea{ideasNuevas !== 1 ? 's' : ''} nueva{ideasNuevas !== 1 ? 's' : ''} esperándote en la Bandeja</> : 'Todo procesado'}
                    {runCost.total > 0 && <> · gasto total: <strong className="font-mono">${runCost.total.toFixed(4)}</strong></>}
                  </p>
                </div>
                <button
                  onClick={() => setProductoTab('bandeja')}
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-600 hover:to-brand-700 shadow-sm transition"
                >
                  <Inbox size={14} /> Ver ideas en la Bandeja <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setProductoTab('setup')}
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2.5 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 border border-brand-200 dark:border-brand-800 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/20 transition"
                >
                  Ver Competencia <ChevronRight size={12} />
                </button>
              </div>
            </div>
          );
        })()}

        {/* Stepper */}
        {steps.length > 0 && (
          <div className="mt-5 space-y-3">
            {/* Barra de progreso + costo en vivo */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-gray-600 dark:text-gray-400 flex-wrap gap-2">
                <span>{stepsDone} de {stepsTotal} pasos</span>
                {runCost.total > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <span className="text-brand-600 dark:text-brand-400 font-bold">💰 ${runCost.total.toFixed(4)}</span>
                    <span className="text-gray-400">·</span>
                    {runCost.anthropic > 0 && <span className="text-brand-600 dark:text-brand-400">🧠 ${runCost.anthropic.toFixed(4)}</span>}
                    {runCost.openai > 0 && <span className="text-emerald-600 dark:text-emerald-400">🎤 ${runCost.openai.toFixed(4)}</span>}
                    {runCost.apify > 0 && <span className="text-amber-600 dark:text-amber-400">🔍 ${runCost.apify.toFixed(4)}</span>}
                  </span>
                )}
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Lista de pasos */}
            <ul className="space-y-1.5">
              {steps.map(step => (
                <StepRow key={step.id} step={step} liveIdeas={step.id === 'generate' ? liveIdeas : null} />
              ))}
            </ul>
          </div>
        )}
      </WizardCard>

      {/* Historial de corridas del producto activo — persistido. */}
      <RunHistoryCard
        history={runHistory.filter(r => String(r.productoId || '') === String(producto?.id || ''))}
        onClear={() => {
          if (window.confirm('¿Borrar el historial de corridas de este producto?')) {
            setRunHistory(prev => prev.filter(r => String(r.productoId || '') !== String(producto?.id || '')));
          }
        }}
      />
      </>}
    </div>
  );
}

// Card colapsable que muestra las últimas corridas del pipeline para el
// producto activo. Cada corrida se puede expandir para ver el detalle de
// pasos, duración y costo. Así el user no pierde info al refrescar o
// cambiar de sección.
