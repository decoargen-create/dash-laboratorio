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

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Package, Target, Play, Check, Loader2, AlertTriangle, ChevronRight, ChevronDown,
  Plus, X, Sparkles, Link2, Search, Clock, Inbox, Trash2,
} from 'lucide-react';
import { ideaFromDeepAnalysis, addGeneratedIdeas, loadIdeas, countIdeasGeneradorHoy, updateIdea, formatoDeAd } from './bandejaStore.js';
import { logCostsFromResponse } from './costsStore.js';
import BandejaSection from './Bandeja.jsx';
import InspiracionSection from './InspiracionSection.jsx';
import CreativosTab from './CreativosTab.jsx';
import DocumentacionTab from './DocumentacionTab.jsx';
import CopilotoTab from './CopilotoTab.jsx';
import DashboardTab from './DashboardTab.jsx';
import GeneradorRapido from './GeneradorRapido.jsx';
import ProductoImagenUploader from './ProductoImagenUploader.jsx';
import GeneradorCreativosMasivo, { BulkProgressBar } from './GeneradorCreativosMasivo.jsx';
import { generarCreativoParaIdea, pickEstilo } from './bulkCreativos.js';
import { usePipelineRun } from './PipelineRunContext.jsx';

// Etiquetas cortas de la etapa de awareness del prospecto — para el chip
// del header del workspace.
const STAGE_LABEL = {
  problem_aware: 'Problem-Aware',
  solution_aware: 'Solution-Aware',
  product_aware: 'Product-Aware',
};

const GEN_CONFIG_KEY = 'viora-marketing-gen-config-v1';
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

const PRODUCTOS_KEY = 'viora-marketing-productos-v1';
const COMPETIDORES_KEY = 'viora-marketing-competidores-v1';
const META_ACCOUNT_KEY = 'viora-marketing-meta-account-v1';
const LAST_RUN_KEY = 'viora-marketing-last-pipeline-run-v1';
const RUN_HISTORY_KEY = 'viora-marketing-run-history-v1';
// Cap del historial guardado — cada entry tiene los steps + stats + cost.
// 20 corridas cubren ~3 semanas a 1 run/día, sin explotar localStorage.
const RUN_HISTORY_CAP = 20;
// Marker que seteamos mientras corre el pipeline. Si al montar Arranque lo
// encontramos pero `running=false`, significa que el user cerró/refreshó la
// pestaña a medio run. Sirve para no dejar al user sin aviso de que quedaron
// docs/ads/análisis a medias en el storage.
const PIPELINE_RUNNING_KEY = 'viora-marketing-pipeline-running-v1';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (err) {
    // Quota exceeded es lo único que vamos a surface — el resto de errores
    // (storage disabled en navegadores raros) no son accionables y mantienen
    // el comportamiento previo de fallar silencioso.
    if (err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014)) {
      try {
        // Notificamos vía CustomEvent así el componente puede mostrar toast
        // sin tener que pasar `addToast` a esta función pura.
        window.dispatchEvent(new CustomEvent('viora-storage-quota-exceeded', { detail: { key } }));
      } catch {}
    }
    return false;
  }
}

// Consume el stream SSE de /api/marketing/generate y devuelve los docs
// cuando el stream se completa. onProgress recibe strings de estado para
// mostrar en el stepper mientras corre. onCost recibe el breakdown { anthropic, total }
// emitido por el server por step (incremental) y al final como total.
async function streamGenerateDocs({ productoNombre, productoUrl, descripcion, onProgress, onCost }) {
  const resp = await fetch('/api/marketing/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productoNombre, productoUrl, descripcion }),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`/api/marketing/generate HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const outputs = {};
  let resumenEjecutivo = '';

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
        else if (ev.type === 'step-start') onProgress?.(`Generando ${ev.label}…`);
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
    throw new Error(`Documentación incompleta: faltan ${incomplete.join(', ')}. El stream se cortó a mitad — reintentá el pipeline.`);
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
    const isTimeout = /timeout|FUNCTION_INVOCATION|gateway/i.test(raw)
      || resp.status === 504 || resp.status === 502;
    const detalle = isTimeout
      ? 'el servidor tardó demasiado y cortó la conexión (timeout) — reintentá en la próxima corrida'
      : `el servidor devolvió un error inesperado (HTTP ${resp.status})`;
    throw new Error(`${contextLabel}: ${detalle}`);
  }
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
      // Limpiamos las keys globales ya migradas para que no vuelvan a
      // contaminar a otros productos en corridas futuras.
      try { localStorage.removeItem(COMPETIDORES_KEY); } catch {}
      try { localStorage.removeItem(META_ACCOUNT_KEY); } catch {}
    }
    return prods;
  });

  // Producto activo — null = vista de lista, id = workspace del producto.
  const [activeProductoId, setActiveProductoId] = useState(() => {
    try { return localStorage.getItem('viora-marketing-active-product') || null; } catch { return null; }
  });
  useEffect(() => {
    try {
      if (activeProductoId) localStorage.setItem('viora-marketing-active-product', activeProductoId);
      else localStorage.removeItem('viora-marketing-active-product');
    } catch {}
  }, [activeProductoId]);

  // Tab activo dentro del workspace del producto (Setup / Bandeja / Inspiración / Creativos).
  // Se persiste por producto para que volver al mismo producto te lleve al
  // último tab que estabas viendo.
  const productoTabKey = activeProductoId ? `viora-marketing-prod-tab-${activeProductoId}` : null;
  const [productoTab, setProductoTab] = useState('setup');
  // Bumpeamos esta key para forzar el remount de la Bandeja embebida cuando
  // el generador rápido inserta ideas — así aparecen sin recargar la página.
  const [bandejaRefreshKey, setBandejaRefreshKey] = useState(0);
  // Estado de la generación masiva de creativos. null = no corriendo. El
  // loop vive acá (no en la pestaña Bandeja) para que sobreviva al cambio
  // de pestaña dentro del workspace.
  const [bulkCreativos, setBulkCreativos] = useState(null);
  const bulkAbortRef = useRef(null);

  // Genera el creativo de cada idea en loop, con barra de progreso.
  const startBulkCreativos = async (ideas, opts) => {
    if (!ideas?.length || bulkCreativos) return;
    const ctrl = new AbortController();
    bulkAbortRef.current = ctrl;
    setBulkCreativos({ running: true, total: ideas.length, done: 0, ok: 0, fail: 0, actual: '', ultimas: [] });
    let done = 0, ok = 0, fail = 0;
    let ultimas = []; // thumbnails de los últimos creativos generados (para feedback en vivo)
    // Si el user pidió "auto", el estilo de cada creativo se elige según
    // las características de la idea (tipo / etapa de campaña) con
    // round-robin de fallback — variedad visual en la tanda.
    const baseEstilo = opts?.estiloEscena || 'auto';
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      if (ctrl.signal.aborted) break;
      const estiloEscena = baseEstilo === 'auto' ? pickEstilo(idea, i) : baseEstilo;
      setBulkCreativos(b => b && ({ ...b, actual: idea.titulo || idea.hook || 'Idea' }));
      try {
        const nuevo = await generarCreativoParaIdea(idea, { ...opts, estiloEscena, signal: ctrl.signal });
        ok++;
        if (nuevo?.imageBase64) {
          // El más nuevo va primero, mantenemos solo los últimos 6.
          ultimas = [{ id: idea.id, b64: nuevo.imageBase64 }, ...ultimas].slice(0, 6);
        }
      } catch (err) {
        if (err.name === 'AbortError') break;
        console.error('bulk creativo falló:', err);
        fail++;
      }
      done++;
      setBulkCreativos(b => b && ({ ...b, done, ok, fail, ultimas }));
    }
    bulkAbortRef.current = null;
    setBulkCreativos(null);
    setBandejaRefreshKey(k => k + 1);
    addToast?.({
      type: ok > 0 ? 'success' : 'error',
      message: `Creativos: ${ok} generado${ok !== 1 ? 's' : ''}${fail > 0 ? ` · ${fail} fallaron` : ''}`,
    });
  };
  useEffect(() => {
    if (!productoTabKey) { setProductoTab('setup'); return; }
    try { setProductoTab(localStorage.getItem(productoTabKey) || 'setup'); } catch { setProductoTab('setup'); }
  }, [productoTabKey]);
  useEffect(() => {
    if (productoTabKey) try { localStorage.setItem(productoTabKey, productoTab); } catch {}
  }, [productoTab, productoTabKey]);

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
  const competidores = producto?.competidores || [];
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
  const [prodDraft, setProdDraft] = useState({ nombre: '', landingUrl: '', descripcion: '' });

  // Wizard competitors
  const [showCompForm, setShowCompForm] = useState(false);
  const [compDraft, setCompDraft] = useState({ nombre: '', landingUrl: '' });

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
  const [showGenConfig, setShowGenConfig] = useState(false);
  // Inicializamos el contador de ideas del día YA filtrado por el producto
  // activo (si lo hay). Antes lo inicializábamos global y el effect lo
  // corregía después → flicker en pantalla con un número que no se respeta.
  const [ideasToday, setIdeasToday] = useState(() => {
    try {
      const aid = localStorage.getItem('viora-marketing-active-product');
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
  useEffect(() => { cancelledRef.current = pipelineRun.cancelRequested; }, [pipelineRun.cancelRequested]);
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
    window.addEventListener('viora-storage-quota-exceeded', onQuota);
    return () => window.removeEventListener('viora-storage-quota-exceeded', onQuota);
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

    const nuevoId = Date.now();
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
    const nuevoId = Date.now();
    const nuevo = {
      id: nuevoId,
      nombre,
      landingUrl,
      fbPageUrl: '',
      notas: '',
      ads: [],
      lastAdsCheck: null,
      createdAt: new Date().toISOString(),
    };
    setCompetidores(prev => [nuevo, ...prev]);
    setCompDraft({ nombre: '', landingUrl: '' });
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

  const handleRemoveCompetidor = (id) => {
    if (!window.confirm('¿Sacar a este competidor de la lista?')) return;
    setCompetidores(prev => prev.filter(c => c.id !== id));
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

  const runPipeline = async () => {
    if (!producto?.nombre) {
      addToast?.({ type: 'error', message: 'Primero cargá el producto (nombre + landing)' });
      return;
    }
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
    const necesitaDocs = ['research', 'avatar', 'offerBrief', 'beliefs']
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
        const docs = await streamGenerateDocs({
          productoNombre: producto.nombre,
          productoUrl: producto.landingUrl || '',
          descripcion: producto.descripcion || '',
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
    const yaTienePostResearch = !!productoActualizado?.stage && searchKeywords.length >= 3;
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
    const compWithAds = []; // { comp, winners }
    let apifyQuotaExhausted = false;
    for (const c of competidoresLocal) {
      if (cancelledRef.current) break;
      if (apifyQuotaExhausted) {
        // Si Apify se quedó sin quota mensual no tiene sentido seguir —
        // todos los siguientes van a tirar el mismo error. Marcamos como
        // pending → done con nota.
        updateStep(`scrape-${c.id}`, {
          status: 'error',
          endedAt: Date.now(),
          detail: 'Salteado · Apify sin quota mensual',
        });
        continue;
      }
      const stepId = `scrape-${c.id}`;
      updateStep(stepId, { status: 'running', startedAt: Date.now() });
      try {
        const payload = { country: 'ALL', limit: 200 };
        // Fallback auto-resolver: si no tenemos fbPageUrl pero sí landing,
        // intentamos detectar la FB page antes de caer a keyword. Scrapear
        // por Page es mucho más estable que por keyword (keyword a veces
        // aborta en Apify). Si no la encontramos, seguimos con keyword.
        let resolvedFbPage = c.fbPageUrl;
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
        const resp = await fetch('/api/marketing/apify-ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await parseJsonResponse(resp, `Scrape de ${c.nombre}`);
        if (!resp.ok) {
          // Si el endpoint sugiere algo (ej: cargar fbPageUrl manual), lo
          // mostramos al user — más útil que el error crudo de Apify.
          const errMsg = data.sugerencia
            ? `${data.error || `HTTP ${resp.status}`} — ${data.sugerencia}`
            : (data.error || `HTTP ${resp.status}`);
          throw new Error(errMsg);
        }
        trackCost(data, `apify-ingest · ${c.nombre}`);
        // Si hubo retry transparente, lo mostramos como nota al user.
        if (data.attemptNote) {
          addToast?.({ type: 'info', message: `${c.nombre}: ${data.attemptNote}` });
        }

        const ads = data.ads || [];
        const allWinners = ads.filter(a => a.isWinner);

        // Calcular cuántos ads son NUEVOS vs ya vistos (para transparencia).
        const prevAdIds = new Set((c.ads || []).map(a => a.id));
        const newAds = ads.filter(a => !prevAdIds.has(a.id));
        const seenAds = ads.filter(a => prevAdIds.has(a.id));

        // Guardar en el competidor (con historial de corridas)
        setCompetidores(prev => prev.map(x => {
          if (x.id !== c.id) return x;
          const prevHistory = Array.isArray(x.adsHistory) ? x.adsHistory : [];
          const history = [...prevHistory, {
            ts: new Date().toISOString(),
            total: data.total || 0,
            winners: data.winners || 0,
            newAds: newAds.length,
          }].slice(-10);
          return {
            ...x, ads, adsTotal: data.total || 0, winnersCount: data.winners || 0,
            lastAdsCheck: new Date().toISOString(), adsHistory: history,
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
        // Detectar quota mensual de Apify para abortar el resto del loop.
        // Sin esto, los 7 competidores restantes mandan requests inútiles
        // que igual van a fallar.
        if (/usage hard limit|monthly|platform-feature-disabled|quota/i.test(err.message || '')) {
          apifyQuotaExhausted = true;
          addToast?.({
            type: 'error',
            message: 'Apify se quedó sin quota mensual. Cancelando los competidores restantes — corré el pipeline cuando renueve la cuota.',
          });
        }
      }
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
        const productoFreshGen = productosRef.current.find(p => String(p.id) === String(producto.id));
        const compsActualizados = productoFreshGen?.competidores || competidores;
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

        // CHUNKING: pedimos las ideas en TANDAS chicas en vez de una sola
        // request grande. Cada brief completo pesa ~1500-2000 tokens de
        // salida; con tandas de 8 el generador necesita ~16k tokens y
        // termina en ~3 min — cómodo dentro del límite de 5 min de Vercel.
        // Tandas más grandes arriesgan truncarse por timeout.
        const CHUNK_SIZE = 8;
        const totalTandas = Math.max(1, Math.ceil(targetCount / CHUNK_SIZE));
        let insertadas = 0;
        let tandaNum = 0;
        let tandasFallidasSeguidas = 0;

        // Corre UNA tanda del generador: pide `chunkTarget` ideas, consume
        // el stream SSE e inserta en la Bandeja. Devuelve cuántas insertó.
        const correrTanda = async (chunkTarget) => {
          // ideasExistentes fresco — incluye lo insertado en tandas
          // anteriores para que Claude no repita.
          const ideasExist = loadIdeas()
            .filter(i => String(i.productoId || '') === productoActualId)
            .map(i => ({ titulo: i.titulo, angulo: i.angulo, tipo: i.tipo, hook: i.hook || '', estado: i.estado || 'pendiente' }));
          const resp = await fetch('/api/marketing/generate-ideas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              producto: productoActualizado || producto || { nombre: 'Producto sin definir' },
              competidoresAnalisis: compAnalisis,
              allCompAds,
              ideasExistentes: ideasExist,
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
                  updateStep('generate', { detail: `Tanda ${tandaNum}/${totalTandas} · ${insertadas} ideas en la Bandeja…` });
                } else if (ev.type === 'complete') {
                  costPayload = ev;
                } else if (ev.type === 'error') {
                  streamErr = new Error(ev.error || 'Error del stream');
                }
              } catch { /* línea parcial */ }
            }
          }
          if (streamErr) throw streamErr;
          if (costPayload) trackCost(costPayload, `generate-ideas tanda ${tandaNum} · ${(productoActualizado || producto)?.nombre || ''}`);
          // Tanda truncada: 0 ideas y sin `complete` = se cortó a mitad.
          if (!costPayload && insertadasTanda === 0 && !cancelledRef.current) {
            throw new Error('tanda truncada (timeout)');
          }
          return insertadasTanda;
        };

        // Loop de tandas hasta cubrir el target (o agotar reintentos).
        let restante = targetCount;
        let tandasOk = 0;
        while (restante > 0 && !cancelledRef.current) {
          tandaNum++;
          const chunkTarget = Math.min(CHUNK_SIZE, restante);
          // Denominador `Math.max` para no mostrar "Tanda 18/17" si una
          // tanda falló y hubo que reintentar.
          updateStep('generate', { detail: `Tanda ${tandaNum}/${Math.max(totalTandas, tandaNum)} · generando…` });
          try {
            await correrTanda(chunkTarget);
            tandasOk++;
            tandasFallidasSeguidas = 0;
            // Solo descontamos del target si la tanda salió OK. Si falló,
            // `restante` no baja y la próxima iteración reintenta ese cupo
            // — sino una tanda fallida "consumía" 12 ideas en silencio.
            restante -= chunkTarget;
          } catch (err) {
            tandasFallidasSeguidas++;
            console.error(`generate tanda ${tandaNum} falló:`, err);
            // 2 tandas seguidas fallidas → cortamos, pero conservamos lo
            // que ya se insertó en las tandas anteriores.
            if (tandasFallidasSeguidas >= 2) break;
          }
        }

        // Fallo real = NINGUNA tanda completó (todas truncadas / timeout).
        // OJO: insertadas === 0 con tandas OK NO es error — es que el
        // generador devolvió solo ideas que ya estaban en la Bandeja
        // (dedup). Eso pasa con bandejas saturadas y NO debe marcar error.
        if (tandasOk === 0 && !cancelledRef.current) {
          throw new Error('El generador no pudo producir ideas (tandas truncadas o timeout). Reintentá el pipeline.');
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
        <BulkProgressBar state={bulkCreativos} onCancel={() => bulkAbortRef.current?.abort()} />
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
          <button onClick={() => setShowProdForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg hover:from-brand-600 hover:to-brand-800 shadow-sm transition">
            <Plus size={16} /> Nuevo producto
          </button>
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
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
            <Package size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin productos</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Creá tu primer producto para empezar a analizar la competencia y generar ideas.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {productos.map(p => {
              const comps = p.competidores || [];
              const hasResearch = !!(p.docs?.research);
              const ideasDelProducto = loadIdeas().filter(i => String(i.productoId || '') === String(p.id));
              const ideasCount = ideasDelProducto.length;
              const ideasByEstado = ideasDelProducto.reduce((acc, i) => {
                acc[i.estado || 'pendiente'] = (acc[i.estado || 'pendiente'] || 0) + 1;
                return acc;
              }, {});
              const adsScrapeados = comps.reduce((sum, c) => sum + (c.ads?.length || 0), 0);
              const competidoresConAds = comps.filter(c => (c.ads?.length || 0) > 0).length;
              // El runner persiste los deep-analyses en `c.adsAnalysis` (no
              // `c.deepAnalyses`). Antes esta lectura usaba el nombre viejo
              // y el stat siempre mostraba 0 sin importar cuántos análisis
              // se corrieran.
              const deepAnalyses = comps.reduce((sum, c) => sum + Object.keys(c.adsAnalysis || {}).length, 0);
              const adsMatched = (p.metaAccount?.ads || []).filter(a => a.productMatch).length;
              const runsDelProducto = runHistory.filter(r => String(r.productoId || '') === String(p.id));
              const ultimoRun = runsDelProducto[0];
              const costoTotal = runsDelProducto.reduce((sum, r) => sum + (r.cost?.total || 0), 0);
              return (
                <div key={p.id} className="flex items-stretch gap-2">
                  <button
                    onClick={() => setActiveProductoId(String(p.id))}
                    className="flex-1 text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-md transition group"
                  >
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition">
                        {p.nombre?.charAt(0)?.toUpperCase() || 'P'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 flex-wrap">
                          {p.landingUrl && <span className="truncate max-w-[200px]">{p.landingUrl}</span>}
                          <span className={`font-semibold ${hasResearch ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {hasResearch ? '✓ documentado' : '○ sin research'}
                          </span>
                          {p.stage && <span className="text-brand-600 dark:text-brand-400">· {p.stage.replace('_', '-')}</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-400 group-hover:text-brand-500 transition shrink-0" />
                    </div>

                    {/* Bandeja: contadores por estado (igual que Bandeja) */}
                    <div className="grid grid-cols-4 gap-1.5 mb-2">
                      <ProdMiniStat label="Pendientes" value={ideasByEstado.pendiente || 0} accent />
                      <ProdMiniStat label="En uso" value={ideasByEstado.en_uso || 0} color="amber" />
                      <ProdMiniStat label="Usadas" value={ideasByEstado.usada || 0} color="emerald" />
                      <ProdMiniStat label="Archivadas" value={ideasByEstado.archivada || 0} color="slate" />
                    </div>

                    {/* Reporting: stats del producto */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 text-[9px]">
                      <ProdReportStat label="Competidores" value={`${comps.length}${competidoresConAds > 0 ? ` · ${competidoresConAds} con ads` : ''}`} />
                      <ProdReportStat label="Ads scrapeados" value={adsScrapeados.toLocaleString('es-AR')} />
                      <ProdReportStat label="Análisis IA" value={deepAnalyses} />
                      <ProdReportStat label="Ideas totales" value={ideasCount} highlight={ideasCount > 0} />
                    </div>

                    {/* Footer: cuenta Meta + último run + costo */}
                    <div className="flex items-center gap-3 text-[9px] text-gray-500 dark:text-gray-400 flex-wrap mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                      {p.metaAccount ? (
                        <span>📊 Meta: <strong className="text-gray-700 dark:text-gray-300">{p.metaAccount.name}</strong> · {p.metaAccount.ads?.length || 0} ads{adsMatched > 0 ? ` · ${adsMatched} matched` : ''}</span>
                      ) : (
                        <span className="italic text-gray-400">Sin cuenta Meta conectada</span>
                      )}
                      {ultimoRun && (
                        <span>· ⏱ Último run: <strong className="text-gray-700 dark:text-gray-300">{new Date(ultimoRun.startedAt).toLocaleDateString('es-AR')}</strong></span>
                      )}
                      {costoTotal > 0 && (
                        <span className="text-brand-600 dark:text-brand-400 font-mono">· 💰 ${costoTotal.toFixed(4)} acumulado</span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`¿Eliminar "${p.nombre}"? Se borran sus competidores, cuenta Meta y research. No se pueden recuperar.`)) {
                        setProductos(prev => prev.filter(x => String(x.id) !== String(p.id)));
                        if (String(p.id) === String(activeProductoId)) setActiveProductoId(null);
                      }
                    }}
                    className="p-2.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition shrink-0"
                    title="Eliminar producto"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ====================================================================
  // WORKSPACE DEL PRODUCTO ACTIVO
  // ====================================================================
  return (
    <div className="max-w-[1500px] mx-auto space-y-6">
      <BulkProgressBar state={bulkCreativos} onCancel={() => bulkAbortRef.current?.abort()} />
      {/* Header del producto */}
      <div className="flex items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm">
        <button onClick={() => setActiveProductoId(null)}
          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition shrink-0"
          title="Volver a la lista de productos">
          <ChevronRight size={18} className="rotate-180" />
        </button>
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm shrink-0">
          <Play size={22} />
        </div>
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

      {/* Tabs del workspace — Dashboard, Setup, Bandeja, Inspiración, Creativos */}
      <ProductTabs activeTab={productoTab} onChange={setProductoTab} />
      <TabsGuide />

      {productoTab === 'dashboard' && (
        <DashboardTab producto={producto} competidores={competidores} runHistory={runHistory} />
      )}

      {productoTab === 'bandeja' && (
        <div className="space-y-4">
          <GeneradorRapido
            producto={producto}
            addToast={addToast}
            onDone={() => setBandejaRefreshKey(k => k + 1)}
          />
          <GeneradorCreativosMasivo
            producto={producto}
            bulkRunning={!!bulkCreativos}
            onGenerar={startBulkCreativos}
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

      {productoTab === 'competencia' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shrink-0">
                <Target size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Competencia del producto</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Marcas que monitoreás y de las que extraemos ganadores. Cada corrida scrapea sus ads.
                </p>
              </div>
            </div>
            {!showCompForm && (
              <button onClick={() => setShowCompForm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-600 hover:to-brand-700 shadow-sm transition shrink-0">
                <Plus size={12} /> Agregar competidor
              </button>
            )}
          </div>

          {/* Form de agregar */}
          {showCompForm && (
            <div className="bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded-xl p-3 flex flex-col sm:flex-row gap-2 items-stretch">
              <input type="text" value={compDraft.nombre} onChange={e => setCompDraft({ ...compDraft, nombre: e.target.value })}
                placeholder="Nombre de la marca (opcional — se autocompleta de la URL)"
                className="flex-1 px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <input type="url" value={compDraft.landingUrl} onChange={e => setCompDraft({ ...compDraft, landingUrl: e.target.value })}
                placeholder="https://landing-del-competidor.com (recomendado — autodetecta marca + FB page)"
                className="flex-1 px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <div className="flex gap-1">
                <button onClick={() => { setShowCompForm(false); setCompDraft({ nombre: '', landingUrl: '' }); }}
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

          {/* Lista de competidores */}
          {competidores.length === 0 ? (
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
              <Target size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin competidores todavía</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Agregá al menos 1 marca con la URL de su landing — el pipeline va a scrapear sus ads activos y extraer ganadores para inspirar las ideas.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {competidores.map(c => {
                const total = c.adsTotal || c.ads?.length || 0;
                const winners = c.winnersCount || 0;
                const history = Array.isArray(c.adsHistory) ? c.adsHistory : [];
                const prev = history.length >= 2 ? history[history.length - 2] : null;
                const delta = prev ? total - prev.total : null;
                const analizado = !!c.lastAdsCheck;
                const favHost = hostnameOf(c.landingUrl);
                return (
                  <div key={c.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-start gap-3">
                    {/* Avatar: favicon del sitio, con fallback a la inicial
                        de la marca si el favicon no carga. */}
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-400 to-red-400 flex items-center justify-center text-white font-bold text-sm shrink-0 relative overflow-hidden">
                      {c.nombre?.charAt(0)?.toUpperCase() || '?'}
                      {favHost && (
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${favHost}&sz=64`}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain bg-white p-1.5"
                          onError={e => { e.currentTarget.style.display = 'none'; }}
                        />
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
                        {c.fbPageUrl && <span>· FB: <span className="text-gray-700 dark:text-gray-300">@{c.fbPageUrl.replace(/^.*facebook\.com\//, '').replace(/\/$/, '')}</span></span>}
                        {c.lastAdsCheck && <span>· Última corrida: {new Date(c.lastAdsCheck).toLocaleDateString('es-AR')}</span>}
                      </div>
                      {/* Estado del scrapeo — sin esto la card no decía si el
                          competidor ya había sido analizado o no. */}
                      <div className="mt-1.5">
                        {!analizado ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                            ○ Sin analizar — la próxima corrida del pipeline scrapea sus ads
                          </span>
                        ) : total === 0 ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded">
                            ⚠ Analizado pero sin ads activos encontrados
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">
                            ✓ Analizado
                          </span>
                        )}
                      </div>
                    </div>
                    {total > 0 && (
                      <div className="shrink-0 flex items-center gap-2 text-xs tabular-nums">
                        <div className="text-right">
                          <p className="font-bold text-gray-900 dark:text-gray-100">{total} ads</p>
                          {winners > 0 && <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">{winners} ganadores 🏆</p>}
                          {delta != null && delta !== 0 && (
                            <p className={`text-[10px] font-semibold ${delta > 0 ? 'text-brand-600 dark:text-brand-400' : 'text-red-500'}`}>
                              {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`} vs corrida anterior
                            </p>
                          )}
                        </div>
                      </div>
                    )}
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
        </div>
      )}

      {productoTab === 'inspiracion' && (
        <div className="-mx-4">
          <InspiracionSection addToast={addToast} forcedProductoId={String(producto.id)} embedded />
        </div>
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
            <p><strong>{producto.nombre}</strong></p>
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

            {/* Foto real del producto — obligatoria para generar estáticos. */}
            <ProductoImagenUploader productoId={producto.id} addToast={addToast} />

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
        title="Competidores a analizar"
        done={compsReady}
        badge={compsReady ? `${competidores.length} cargado${competidores.length > 1 ? 's' : ''}` : null}
      >
        {competidores.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic mb-2">
            Sin competidores cargados todavía. Andá al tab <strong>Competencia</strong> para agregar.
          </p>
        ) : (
          <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">
            <p>{competidores.length} competidor{competidores.length !== 1 ? 'es' : ''}: <span className="text-gray-900 dark:text-gray-100 font-semibold">{competidores.slice(0, 3).map(c => c.nombre).join(', ')}{competidores.length > 3 ? `… +${competidores.length - 3}` : ''}</span></p>
            {compsReady && (() => {
              const totalAds = competidores.reduce((sum, c) => sum + (c.adsTotal || c.ads?.length || 0), 0);
              const totalWinners = competidores.reduce((sum, c) => sum + (c.winnersCount || 0), 0);
              return totalAds > 0 ? (
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  {totalAds.toLocaleString('es-AR')} ads scrapeados · {totalWinners} ganadores 🏆
                </p>
              ) : null;
            })()}
          </div>
        )}
        <button
          onClick={() => setProductoTab('competencia')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-red-500 rounded-md hover:from-brand-600 hover:to-red-600 shadow-sm transition"
        >
          <Target size={12} /> Gestionar competencia →
        </button>
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
                      onChange={e => setGenConfig(c => ({ ...c, limiteDiario: Math.max(1, Math.min(MAX_IDEAS_PER_RUN, Number(e.target.value) || 50)) }))}
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
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-brand-600 to-brand-500 rounded-lg hover:from-brand-700 hover:to-brand-600 shadow-sm transition">
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
                  <button onClick={() => setProductoTab('competencia')}
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
                  onClick={() => setProductoTab('competencia')}
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

// Guía corta del flujo del módulo — se muestra debajo de los tabs para
// que el user nuevo sepa el orden. Dismissable y persistido.
function TabsGuide() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem('viora-tabs-guide-hidden') === '1'; } catch { return false; }
  });
  if (hidden) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg text-[11px] text-brand-800 dark:text-brand-300">
      <span className="shrink-0">🗺️</span>
      <span className="flex-1 min-w-0">
        <strong>Cómo va el flujo:</strong> ⚙️ Setup (cargá producto + competidores) → ▶️ Correr pipeline → 📥 Bandeja (revisá las ideas y generá el creativo en cada una) → 🤖 Copiloto para pedir más.
      </span>
      <button
        onClick={() => { try { localStorage.setItem('viora-tabs-guide-hidden', '1'); } catch {} setHidden(true); }}
        className="shrink-0 text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 transition"
        title="Ocultar guía"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// Tabs del workspace de un producto: Setup / Bandeja / Inspiración / Creativos.
function ProductTabs({ activeTab, onChange }) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', emoji: '📊' },
    { id: 'setup', label: 'Setup', emoji: '⚙️' },
    { id: 'documentos', label: 'Documentos', emoji: '📄' },
    { id: 'competencia', label: 'Competencia', emoji: '🎯' },
    { id: 'bandeja', label: 'Bandeja', emoji: '📥' },
    { id: 'inspiracion', label: 'Inspiración', emoji: '✨' },
    { id: 'creativos', label: 'Creativos', emoji: '🎨' },
    { id: 'copiloto', label: 'Copiloto', emoji: '🤖' },
  ];
  return (
    <div className="flex items-center gap-1 overflow-x-auto p-1 bg-gray-100 dark:bg-gray-800/70 rounded-xl border border-gray-200 dark:border-gray-700">
      {tabs.map(t => (
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
  );
}

// Mini-stat para los contadores de Bandeja en la card del producto.
function ProdMiniStat({ label, value, color = 'gray', accent = false }) {
  const colors = {
    gray: 'bg-gray-50 dark:bg-gray-900/40 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700',
    amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
    slate: 'bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800',
  };
  return (
    <div className={`px-2 py-1.5 rounded-md border ${colors[color]} ${accent ? 'ring-1 ring-brand-300 dark:ring-brand-700' : ''}`}>
      <p className="text-[8px] font-bold uppercase tracking-wider opacity-60 leading-none">{label}</p>
      <p className="text-base font-bold tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

// Stat plano de reporte para la sección de stats del producto.
function ProdReportStat({ label, value, highlight = false }) {
  return (
    <div className={`px-2 py-1.5 rounded border ${
      highlight
        ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800 text-brand-900 dark:text-brand-200'
        : 'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
    }`}>
      <p className="text-[8px] font-bold uppercase tracking-wider opacity-60 leading-none">{label}</p>
      <p className="text-[11px] font-semibold leading-tight mt-0.5">{value}</p>
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
