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

import React, { useState, useEffect } from 'react';
import {
  Package, Target, Play, Check, Loader2, AlertTriangle, ChevronRight, ChevronDown,
  Plus, X, Sparkles, Link2, Search, Clock, Inbox, Trash2,
} from 'lucide-react';
import { ideaFromDeepAnalysis, addGeneratedIdeas, loadIdeas, countIdeasGeneratedToday } from './bandejaStore.js';
import { logCostsFromResponse } from './costsStore.js';
import BandejaSection from './Bandeja.jsx';
import InspiracionSection from './InspiracionSection.jsx';
import CreativosTab from './CreativosTab.jsx';

const GEN_CONFIG_KEY = 'viora-marketing-gen-config-v1';
const DEFAULT_GEN_CONFIG = {
  limiteDiario: 50,
  formatoStatic: 60, // %
  formatoVideo: 40, // %
};
// Tope superior de ideas por corrida — Claude Sonnet 4.6 puede devolver hasta
// ~100 ideas ricas antes de agotar la budget de output. 100 es un techo
// realista; más que eso empieza a truncar.
const MAX_IDEAS_PER_RUN = 100;

const PRODUCTOS_KEY = 'viora-marketing-productos-v1';
const COMPETIDORES_KEY = 'viora-marketing-competidores-v1';
const META_ACCOUNT_KEY = 'viora-marketing-meta-account-v1';
const LAST_RUN_KEY = 'viora-marketing-last-pipeline-run-v1';
const RUN_HISTORY_KEY = 'viora-marketing-run-history-v1';
// Cap del historial guardado — cada entry tiene los steps + stats + cost.
// 20 corridas cubren ~3 semanas a 1 run/día, sin explotar localStorage.
const RUN_HISTORY_CAP = 20;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Consume el stream SSE de /api/marketing/generate y devuelve los docs
// cuando el stream se completa. onProgress recibe strings de estado para
// mostrar en el stepper mientras corre.
async function streamGenerateDocs({ productoNombre, productoUrl, descripcion, onProgress }) {
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
        } else if (ev.type === 'error') {
          throw new Error(ev.error || 'Error en el stream de docs');
        } else if (ev.type === 'complete') {
          // Nada — seguimos hasta done.
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue; // línea parcial
        throw err;
      }
    }
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
  useEffect(() => {
    if (!productoTabKey) { setProductoTab('setup'); return; }
    try { setProductoTab(localStorage.getItem(productoTabKey) || 'setup'); } catch { setProductoTab('setup'); }
  }, [productoTabKey]);
  useEffect(() => {
    if (productoTabKey) try { localStorage.setItem(productoTabKey, productoTab); } catch {}
  }, [productoTab, productoTabKey]);

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
  const [ideasToday, setIdeasToday] = useState(() => countIdeasGeneratedToday());

  // Pipeline runner
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]); // { id, label, detail, status: 'pending'|'running'|'done'|'error', startedAt, endedAt }
  const [cancelled, setCancelled] = useState(false);
  // Ideas generadas en vivo durante el pipeline — se llena por streaming
  // y se muestra debajo del paso "Generando ideas" en el stepper.
  const [liveIdeas, setLiveIdeas] = useState([]);
  // Costo acumulado de la corrida actual — se resetea al arrancar el pipeline
  // y va sumando a medida que cada endpoint devuelve su cost{}. Se muestra
  // en vivo en el stepper.
  const [runCost, setRunCost] = useState({ anthropic: 0, openai: 0, apify: 0, meta: 0, total: 0 });
  // Historial de corridas — persistido. Al completar un run, pusheamos un
  // resumen (productoId, timestamps, steps, stats, costo). Luego se muestra
  // en la UI como colapsable para que el user vea qué se ejecutó antes.
  const [runHistory, setRunHistory] = useState(() => loadJSON(RUN_HISTORY_KEY, []));

  useEffect(() => { saveJSON(PRODUCTOS_KEY, productos); }, [productos]);
  useEffect(() => { saveJSON(GEN_CONFIG_KEY, genConfig); }, [genConfig]);
  useEffect(() => { saveJSON(RUN_HISTORY_KEY, runHistory); }, [runHistory]);

  // Refrescar contador de ideas del día cada vez que montamos o cambia la bandeja.
  useEffect(() => {
    setIdeasToday(countIdeasGeneratedToday());
    const interval = setInterval(() => setIdeasToday(countIdeasGeneratedToday()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Mix promedio de la competencia (% video vs static) — calculado sobre
  // todos los ads scrapeados de los competidores cargados. Sirve como
  // sugerencia del default: "tu competencia usa X% video, te recomendamos eso".
  const competitorMix = (() => {
    let totalAds = 0, videoAds = 0, staticAds = 0;
    for (const c of competidores) {
      for (const ad of (c.ads || [])) {
        const hasVideo = (ad.videoUrls?.length || 0) > 0;
        const hasImage = (ad.imageUrls?.length || 0) > 0;
        if (!hasVideo && !hasImage) continue;
        totalAds++;
        if (hasVideo) videoAds++;
        else staticAds++;
      }
    }
    if (totalAds === 0) return null;
    return {
      totalAds,
      videoPct: Math.round((videoAds / totalAds) * 100),
      staticPct: Math.round((staticAds / totalAds) * 100),
      competidoresConAds: competidores.filter(c => (c.ads || []).length > 0).length,
    };
  })();

  const usarMixCompetencia = () => {
    if (!competitorMix) return;
    setGenConfig(c => ({
      ...c,
      formatoStatic: competitorMix.staticPct,
      formatoVideo: competitorMix.videoPct,
    }));
    addToast?.({ type: 'success', message: `Mix ajustado al promedio de la competencia: ${competitorMix.staticPct}/${competitorMix.videoPct}` });
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
    const nombre = compDraft.nombre.trim();
    if (!nombre) { addToast?.({ type: 'error', message: 'Ponele nombre al competidor' }); return; }
    const landingUrl = compDraft.landingUrl.trim();
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

    setRunning(true);
    setCancelled(false);
    setLiveIdeas([]);
    setRunCost({ anthropic: 0, openai: 0, apify: 0, meta: 0, total: 0 });

    // Wrapper sobre logCostsFromResponse que también suma al runCost local.
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
      }
      return added;
    };

    // Pasos dinámicos según estado:
    //   - docs-gen: solo si el producto aún no tiene research doc
    //   - post-research: siempre tras docs (infiere stage + keywords)
    //   - scrape/analyze: uno por competidor (los tiene que cargar el user a mano)
    // La sugerencia automática de competidores fue sacada — devolvía matches
    // imprecisos (e.g. la propia tienda) que confundían más que ayudaban.
    const necesitaDocs = !producto?.docs?.research;

    const pasosIniciales = [
      { id: 'prep', label: '🚀 Arrancando', detail: `Producto: ${producto.nombre}`, status: 'pending' },
    ];
    if (necesitaDocs) {
      pasosIniciales.push(
        { id: 'docs-gen', label: '📄 Generando documentación del producto', detail: 'Research + avatar + offer brief + creencias + resumen (~3-4 min)', status: 'pending' },
      );
    }
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
    // ============================================================
    let productoActualizado = producto;
    if (necesitaDocs && !cancelled) {
      updateStep('docs-gen', { status: 'running', startedAt: Date.now() });
      try {
        const docs = await streamGenerateDocs({
          productoNombre: producto.nombre,
          productoUrl: producto.landingUrl || '',
          descripcion: producto.descripcion || '',
          onProgress: (msg) => updateStep('docs-gen', { detail: msg }),
        });
        // Guardar los docs en el producto
        productoActualizado = {
          ...producto,
          docs: docs.docs,
          resumenEjecutivo: docs.resumenEjecutivo,
          docsGeneratedAt: new Date().toISOString(),
        };
        setProductos(prev => prev.map(p => p.id === producto.id ? productoActualizado : p));
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
    // ============================================================
    let searchKeywords = [];
    if (!cancelled && productoActualizado?.docs?.research) {
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
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        trackCost(data, `post-research-analysis · ${productoActualizado.nombre}`);

        searchKeywords = data.searchKeywords || [];
        productoActualizado = {
          ...productoActualizado,
          stage: data.stage,
          stageReason: data.stageReason,
          searchKeywords,
        };
        setProductos(prev => prev.map(p => p.id === productoActualizado.id ? productoActualizado : p));

        updateStep('post-research', {
          status: 'done',
          endedAt: Date.now(),
          detail: `Stage: ${data.stage.replace('_', '-')} · ${searchKeywords.length} keywords: ${searchKeywords.slice(0, 3).join(', ')}${searchKeywords.length > 3 ? '…' : ''}`,
        });
      } catch (err) {
        updateStep('post-research', { status: 'error', endedAt: Date.now(), detail: err.message });
        // No es fatal — seguimos con keywords vacíos.
      }
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
        { id: 'done', label: '✅ Listo', detail: 'Tenés análisis fresco + ideas nuevas en la Bandeja', status: 'pending' },
      ];
      return [...base, ...nuevos];
    });

    // Paso scrape: para cada competidor (incluye los recién auto-sugeridos).
    const compWithAds = []; // { comp, winners }
    for (const c of competidoresLocal) {
      if (cancelled) break;
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
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        trackCost(data, `apify-ingest · ${c.nombre}`);

        const ads = data.ads || [];
        const allWinners = ads.filter(a => a.isWinner);

        // Guardar en el competidor (con historial de corridas)
        setCompetidores(prev => prev.map(x => {
          if (x.id !== c.id) return x;
          const prevHistory = Array.isArray(x.adsHistory) ? x.adsHistory : [];
          const history = [...prevHistory, {
            ts: new Date().toISOString(),
            total: data.total || 0,
            winners: data.winners || 0,
          }].slice(-10);
          return {
            ...x, ads, adsTotal: data.total || 0, winnersCount: data.winners || 0,
            lastAdsCheck: new Date().toISOString(), adsHistory: history,
          };
        }));

        // Deep-analyze: top 10 winners por score (los más fuertes).
        // Todos los demás ads (winners o no) llegan al generador con
        // su copy crudo — no los tiramos.
        const topWinnersForAnalysis = allWinners
          .slice().sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 10);
        compWithAds.push({ comp: c, winners: topWinnersForAnalysis, allAds: ads });
        updateStep(stepId, {
          status: 'done',
          endedAt: Date.now(),
          detail: `${allWinners.length} ganador${allWinners.length !== 1 ? 'es' : ''} de ${ads.length} ads · top ${topWinnersForAnalysis.length} para análisis profundo`,
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
      // Filtrar: no re-analizar los ads que ya tienen análisis guardado.
      // Ahorramos tokens + tiempo + evitamos tirar ideas duplicadas en la
      // bandeja. Solo analizamos ads nuevos que aparecieron en este scrape.
      const compFresh = loadJSON(COMPETIDORES_KEY, competidores).find(x => x.id === comp.id);
      const existingAnalyses = compFresh?.adsAnalysis || {};
      const nuevosParaAnalizar = winners.filter(ad => !existingAnalyses[ad.id]);
      const yaAnalizados = winners.length - nuevosParaAnalizar.length;

      if (nuevosParaAnalizar.length === 0) {
        updateStep(stepId, {
          status: 'done',
          endedAt: Date.now(),
          detail: `Todos (${winners.length}) ya analizados en corridas anteriores — nada nuevo.`,
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
    if (!cancelled) {
      updateStep('generate', { status: 'running', startedAt: Date.now() });
      try {
        // Armar el contexto competitivo COMPLETO para el generador.
        // 1. compAnalisis: ads con deep-analysis (hooks, ángulo, why_it_works)
        // 2. allCompAds: TODOS los ads scrapeados (body + headline + score +
        //    días + formato). El generador ve los 700+ ads crudos para
        //    identificar patrones que no capturamos con deep-analyze.
        const compAnalisis = [];
        const allCompAds = [];
        const compsActualizados = loadJSON(COMPETIDORES_KEY, competidores);
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
              formato: (ad.videoUrls?.length > 0) ? 'video' : 'static',
              daysRunning: ad.daysRunning || 0,
              score: ad.score || 0,
              isWinner: !!ad.isWinner,
              winnerTier: ad.winnerTier || null,
              variantes: ad.variantes || 0,
            });
          }
        }

        const ideasExistentes = loadIdeas().map(i => ({ titulo: i.titulo, angulo: i.angulo, tipo: i.tipo }));

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

        // Target count: primera vez (bandeja vacía) escala con la cantidad
        // de ads analizados — si la competencia tiene mucho material,
        // pedimos proporcional (con techo MAX_IDEAS_PER_RUN). Después, cap
        // al límite diario restante.
        const yaGeneradasHoy = countIdeasGeneratedToday();
        const esPrimeraVez = ideasExistentes.length === 0;
        const adsTotales = (compWithAds || []).reduce((sum, c) => sum + (c.allAds?.length || 0), 0);
        const primeraVezTarget = Math.min(
          MAX_IDEAS_PER_RUN,
          Math.max(50, Math.round(adsTotales * 0.2))
        );
        const targetCount = esPrimeraVez
          ? primeraVezTarget
          : Math.max(0, genConfig.limiteDiario - yaGeneradasHoy);

        if (targetCount === 0) {
          updateStep('generate', {
            status: 'done',
            endedAt: Date.now(),
            detail: `Ya generaste ${yaGeneradasHoy} ideas hoy (límite ${genConfig.limiteDiario}). Subí el límite o esperá al reset de medianoche.`,
          });
          throw new Error('SKIP_GENERATE');
        }

        const sumaMix = Math.max(1, genConfig.formatoStatic + genConfig.formatoVideo);
        const formatoMix = {
          static: genConfig.formatoStatic / sumaMix,
          video: genConfig.formatoVideo / sumaMix,
        };

        // Consumimos SSE stream. Cada evento 'idea' llega en vivo apenas
        // Claude termina de escribirla → la empujamos a la Bandeja y al
        // stepper al toque. Al final viene 'complete' con el costo total.
        const resp = await fetch('/api/marketing/generate-ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            producto: productoActualizado || producto || { nombre: 'Producto sin definir' },
            competidoresAnalisis: compAnalisis,
            allCompAds,
            ideasExistentes,
            propiosAds,
            targetCount,
            formatoMix,
          }),
        });
        if (!resp.ok || !resp.body) {
          // Error antes de que arranque el stream — lo leemos como text y
          // damos un mensaje accionable.
          const text = await resp.text().catch(() => '');
          const isTimeout = /504|timeout|FUNCTION_INVOCATION_TIMEOUT/i.test(text);
          throw new Error(isTimeout
            ? 'Timeout: el generador tardó más de 5 min. Probá con menos competidores o menos ideas.'
            : `HTTP ${resp.status}${text ? ': ' + text.slice(0, 120) : ''}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let insertadas = 0;
        let streamErr = null;
        let costPayload = null;

        while (true) {
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
                // Empujamos a la Bandeja — addGeneratedIdeas dedupea
                // por (tipo, titulo), así que si ya existe no molesta.
                const nuevas = addGeneratedIdeas([ev.idea], { producto: productoActualizado || producto });
                if (nuevas.length > 0) insertadas++;
                setLiveIdeas(prev => [...prev, ev.idea]);
                updateStep('generate', {
                  detail: `${insertadas} ideas nuevas en la Bandeja · generando…`,
                });
              } else if (ev.type === 'complete') {
                costPayload = ev;
              } else if (ev.type === 'error') {
                streamErr = new Error(ev.error || 'Error desconocido del stream');
              }
            } catch {
              // Línea parcial / no-JSON: ignoramos.
            }
          }
        }

        if (streamErr) throw streamErr;
        if (costPayload) logCostsFromResponse(costPayload, `generate-ideas · ${(productoActualizado || producto)?.nombre || ''}`);
        setIdeasToday(countIdeasGeneratedToday());
        updateStep('generate', {
          status: 'done',
          endedAt: Date.now(),
          detail: `${insertadas} ideas nuevas agregadas${costPayload?.count ? ` (${costPayload.count} generadas)` : ''}`,
        });
      } catch (err) {
        // SKIP_GENERATE es un soft-skip (ya avisamos en updateStep), no error.
        if (err.message !== 'SKIP_GENERATE') {
          updateStep('generate', { status: 'error', endedAt: Date.now(), detail: err.message });
        }
      }
    }

    // Paso final
    updateStep('done', { status: 'running', startedAt: Date.now() });
    await new Promise(r => setTimeout(r, 400));
    updateStep('done', { status: 'done', endedAt: Date.now() });

    setRunning(false);
    if (!cancelled) {
      try { localStorage.setItem(LAST_RUN_KEY, new Date().toISOString()); } catch {}
      // Persistir el resumen de esta corrida al historial del producto.
      setSteps(currentSteps => {
        const endedAt = Date.now();
        const startedAt = currentSteps.find(s => s.startedAt)?.startedAt || endedAt;
        const runEntry = {
          id: `run-${endedAt}`,
          productoId: producto?.id ? String(producto.id) : null,
          productoNombre: producto?.nombre || '',
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          durationMs: endedAt - startedAt,
          cost: { ...runCost },
          // Guardamos los steps (sin Date timestamps grandes) — sirve para
          // mostrar el detalle de qué pasó.
          steps: currentSteps.map(s => ({
            id: s.id,
            label: s.label,
            detail: s.detail,
            status: s.status,
            startedAt: s.startedAt || null,
            endedAt: s.endedAt || null,
          })),
          stats: {
            competidoresCount: (currentSteps.filter(s => s.id.startsWith('scrape-')).length),
            competidoresOk: (currentSteps.filter(s => s.id.startsWith('scrape-') && s.status === 'done').length),
            stepsError: currentSteps.filter(s => s.status === 'error').length,
          },
        };
        setRunHistory(prev => [runEntry, ...prev].slice(0, RUN_HISTORY_CAP));
        return currentSteps;
      });
      addToast?.({ type: 'success', message: '¡Listo! Mirá los análisis + ideas en la Bandeja.' });
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
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center text-white shadow-sm">
              <Package size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Tus productos</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Cada producto tiene su propia competencia, research y bandeja de ideas.</p>
            </div>
          </div>
          <button onClick={() => setShowProdForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-purple-600 to-violet-600 rounded-lg hover:from-purple-700 hover:to-violet-700 shadow-sm transition">
            <Plus size={16} /> Nuevo producto
          </button>
        </div>

        {/* Form de nuevo producto */}
        {showProdForm && (
          <div className="bg-white dark:bg-gray-800 border-2 border-purple-300 dark:border-purple-700 rounded-xl p-5 space-y-3 animate-fade-in">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Nuevo producto</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="text" value={prodDraft.nombre} onChange={e => setProdDraft({ ...prodDraft, nombre: e.target.value })}
                placeholder="Nombre del producto"
                className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <input type="url" value={prodDraft.landingUrl} onChange={e => setProdDraft({ ...prodDraft, landingUrl: e.target.value })}
                placeholder="URL de la landing"
                className="px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <textarea value={prodDraft.descripcion} onChange={e => setProdDraft({ ...prodDraft, descripcion: e.target.value })}
              placeholder="Descripción corta (opcional)"
              rows={2}
              className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowProdForm(false); setProdDraft({ nombre: '', landingUrl: '', descripcion: '' }); }}
                className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleAddProducto}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-purple-600 to-violet-600 rounded-md hover:from-purple-700 hover:to-violet-700 transition">
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
              const deepAnalyses = comps.reduce((sum, c) => sum + Object.keys(c.deepAnalyses || {}).length, 0);
              const adsMatched = (p.metaAccount?.ads || []).filter(a => a.productMatch).length;
              const runsDelProducto = runHistory.filter(r => String(r.productoId || '') === String(p.id));
              const ultimoRun = runsDelProducto[0];
              const costoTotal = runsDelProducto.reduce((sum, r) => sum + (r.cost?.total || 0), 0);
              return (
                <div key={p.id} className="flex items-stretch gap-2">
                  <button
                    onClick={() => setActiveProductoId(String(p.id))}
                    className="flex-1 text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-md transition group"
                  >
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition">
                        {p.nombre?.charAt(0)?.toUpperCase() || 'P'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 flex-wrap">
                          {p.landingUrl && <span className="truncate max-w-[200px]">{p.landingUrl}</span>}
                          <span className={`font-semibold ${hasResearch ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {hasResearch ? '✓ documentado' : '○ sin research'}
                          </span>
                          {p.stage && <span className="text-purple-600 dark:text-purple-400">· {p.stage.replace('_', '-')}</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-400 group-hover:text-purple-500 transition shrink-0" />
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
                        <span className="text-purple-600 dark:text-purple-400 font-mono">· 💰 ${costoTotal.toFixed(4)} acumulado</span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`¿Eliminar "${p.nombre}"? Se borran sus competidores, cuenta Meta y research. No se pueden recuperar.`)) {
                        setProductos(prev => prev.filter(x => x.id !== p.id));
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
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header con breadcrumb */}
      <div className="flex items-center gap-3">
        <button onClick={() => setActiveProductoId(null)}
          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition shrink-0"
          title="Volver a la lista de productos">
          <ChevronRight size={16} className="rotate-180" />
        </button>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center text-white shadow-sm">
          <Play size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            <button onClick={() => setActiveProductoId(null)} className="hover:text-purple-500 transition">Productos</button> / {producto.nombre}
          </p>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{producto.nombre}</h2>
        </div>
      </div>

      {/* Tabs del workspace — Setup, Bandeja, Inspiración, Creativos */}
      <ProductTabs activeTab={productoTab} onChange={setProductoTab} />

      {productoTab === 'bandeja' && (
        <div className="-mx-4">
          <BandejaSection addToast={addToast} forcedProductoId={String(producto.id)} embedded />
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

      {productoTab === 'setup' && <>

      {/* Nudge de auto-run: si pasaron > 24h y el user no está corriendo ahora */}
      {ofrecerRun && (
        <div className="px-4 py-3 bg-gradient-to-br from-fuchsia-50 to-purple-50 dark:from-fuchsia-900/20 dark:to-purple-900/20 border border-fuchsia-200 dark:border-fuchsia-800 rounded-lg flex items-center gap-3">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center text-white">
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
            className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-fuchsia-600 to-purple-600 rounded-md hover:from-fuchsia-700 hover:to-purple-700 transition shadow-sm">
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
              <a href={producto.landingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
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
                  onChange={e => setProductos(prev => prev.map(p => p.id === producto.id ? { ...p, stage: e.target.value } : p))}
                  className="px-2 py-0.5 text-[11px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
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
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded">
                  ℹ️ Sin research doc todavía — el pipeline lo genera solo en el primer paso (~3-4 min).
                </div>
              );
            })()}

            {/* Activo visual de marca — elemento icónico reutilizable que se
                propaga a todos los prompts de imagen. */}
            <details className="mt-3 group">
              <summary className="cursor-pointer inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400">
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
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y"
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
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </details>
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
            <p className="text-[10px] text-gray-500 dark:text-gray-400 italic -mt-1">
              No te pedimos stage (problem/solution/product-aware) porque lo inferimos solos del research doc cuando corras el pipeline.
            </p>
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
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded">
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-violet-600 to-purple-600 rounded-md hover:from-violet-700 hover:to-purple-700 transition disabled:opacity-40">
                {matching ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Identificar ads del producto con IA
              </button>
            )}
            {producto?.nombre && metaAccount.productMatched && metaAccount.productMatched !== producto.nombre && (
              <button onClick={matchProductAds} disabled={matching}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 bg-white dark:bg-gray-700 border border-violet-300 dark:border-violet-800 rounded-md hover:bg-violet-50 transition disabled:opacity-40">
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
                      warming:   { icon: '📈', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', label: 'escalando' },
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
                              ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                              : 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
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
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition disabled:opacity-40">
                    <span className="font-semibold text-gray-900 dark:text-gray-100 flex-1">{acc.name}</span>
                    <span className="text-[10px] text-gray-500">{acc.currency}</span>
                    {acc.business && <span className="text-[10px] text-gray-400">· {acc.business}</span>}
                    {loadingAds && <Loader2 size={12} className="animate-spin text-blue-500" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </WizardCard>

      {/* Paso 3 — Competidores */}
      <WizardCard
        num="3"
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
                  {(c.ads?.length > 0 || c.adsTotal > 0) ? (() => {
                    const total = c.adsTotal || c.ads?.length || 0;
                    const winners = c.winnersCount || 0;
                    const history = Array.isArray(c.adsHistory) ? c.adsHistory : [];
                    const prev = history.length >= 2 ? history[history.length - 2] : null;
                    const delta = prev ? total - prev.total : null;
                    return (
                      <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] tabular-nums">
                        <span className="font-bold text-gray-900 dark:text-gray-100">{total} ads</span>
                        {winners > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-bold">{winners} 🏆</span>}
                        {delta != null && delta !== 0 && (
                          <span className={delta > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-500'}>
                            {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
                          </span>
                        )}
                      </span>
                    );
                  })() : null}
                  <button onClick={() => handleRemoveCompetidor(c.id)}
                    className="p-0.5 text-gray-400 hover:text-red-600 transition" title="Sacar">
                    <X size={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!showCompForm ? (
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={() => setShowCompForm(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-md hover:bg-purple-100 transition">
                <Plus size={11} /> Agregar a mano
              </button>
            </div>
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
              Si tu producto aún no tiene research doc, el sistema lo genera primero (~4 min). Después infiere el stage del prospect, sugiere competidores si no cargaste ninguno, scrapea los ads, detecta ganadores y genera ideas. Primera corrida: 8-15 min. Corridas siguientes: 2-5 min.
            </p>

            {/* Config del generador — colapsable */}
            <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-lg">
              <button onClick={() => setShowGenConfig(v => !v)}
                className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-200">
                <span className="inline-flex items-center gap-2">
                  ⚙️ Generador de ideas
                  <span className="text-[10px] font-mono text-gray-400">
                    {ideasToday}/{genConfig.limiteDiario} hoy · {genConfig.formatoStatic}/{genConfig.formatoVideo} static/video
                  </span>
                </span>
                <ChevronDown size={12} className={`text-gray-400 transition-transform ${showGenConfig ? 'rotate-180' : ''}`} />
              </button>
              {showGenConfig && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Límite diario de ideas</label>
                    <input type="number" min="1" max={MAX_IDEAS_PER_RUN} value={genConfig.limiteDiario}
                      onChange={e => setGenConfig(c => ({ ...c, limiteDiario: Math.max(1, Math.min(MAX_IDEAS_PER_RUN, Number(e.target.value) || 50)) }))}
                      className="w-24 px-2 py-1 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500" />
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      Se resetea a las 00:00 hs Argentina. Primera corrida (bandeja vacía) ignora el límite y genera hasta 40 con piso de calidad.
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase">Mix static / video</label>
                      {competitorMix && (
                        <button onClick={usarMixCompetencia}
                          className="text-[10px] font-semibold text-fuchsia-600 dark:text-fuchsia-400 hover:underline">
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
                      className="w-full accent-purple-600 cursor-pointer" />
                    <div className="flex items-center gap-2 mt-1">
                      <input type="number" min="0" max="100" value={genConfig.formatoStatic}
                        onChange={e => {
                          const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          setGenConfig(c => ({ ...c, formatoStatic: v, formatoVideo: 100 - v }));
                        }}
                        className="w-16 px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500" />
                      <span className="text-[10px] text-gray-500">% static</span>
                      <span className="text-gray-400 mx-1">·</span>
                      <input type="number" min="0" max="100" value={genConfig.formatoVideo}
                        onChange={e => {
                          const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          setGenConfig(c => ({ ...c, formatoVideo: v, formatoStatic: 100 - v }));
                        }}
                        className="w-16 px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500" />
                      <span className="text-[10px] text-gray-500">% video</span>
                    </div>

                    {competitorMix ? (
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5">
                        <span className="font-semibold">Dato de tu competencia:</span> entre {competitorMix.competidoresConAds} competidor{competitorMix.competidoresConAds > 1 ? 'es' : ''} con ads, {competitorMix.videoPct}% usa video ({competitorMix.totalAds} ads analizados).
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

        {/* Banner de éxito al terminar — CTA grande para ir a la Bandeja */}
        {!running && steps.length > 0 && steps[steps.length - 1]?.id === 'done' && steps[steps.length - 1]?.status === 'done' && (() => {
          // Contamos qué se logró: ganadores totales + ideas nuevas.
          const winnersTotal = steps
            .filter(s => s.id.startsWith('scrape-') && s.status === 'done')
            .reduce((sum, s) => {
              const m = (s.detail || '').match(/(\d+)\s+ganador/i);
              return sum + (m ? Number(m[1]) : 0);
            }, 0);
          const genStep = steps.find(s => s.id === 'generate');
          const ideasMatch = genStep?.detail?.match(/(\d+)\s+ideas\s+nuevas/i);
          const ideasNuevas = ideasMatch ? Number(ideasMatch[1]) : 0;
          return (
            <div className="mt-5 p-4 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border-2 border-emerald-300 dark:border-emerald-700 rounded-xl">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow">
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
                  onClick={() => onGoToSection?.('mk-bandeja')}
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-fuchsia-500 to-pink-500 rounded-lg hover:from-fuchsia-600 hover:to-pink-600 shadow-sm transition"
                >
                  <Inbox size={14} /> Ver ideas en la Bandeja <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => onGoToSection?.('mk-competencia')}
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2.5 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 transition"
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
                    <span className="text-purple-600 dark:text-purple-400 font-bold">💰 ${runCost.total.toFixed(4)}</span>
                    <span className="text-gray-400">·</span>
                    {runCost.anthropic > 0 && <span className="text-violet-600 dark:text-violet-400">🧠 ${runCost.anthropic.toFixed(4)}</span>}
                    {runCost.openai > 0 && <span className="text-emerald-600 dark:text-emerald-400">🎤 ${runCost.openai.toFixed(4)}</span>}
                    {runCost.apify > 0 && <span className="text-amber-600 dark:text-amber-400">🔍 ${runCost.apify.toFixed(4)}</span>}
                  </span>
                )}
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
                      {run.cost?.total > 0 && (
                        <span className="text-purple-600 dark:text-purple-400 font-mono">· 💰 ${run.cost.total.toFixed(4)}</span>
                      )}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-3 py-2">
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
                        <span className="text-purple-600 dark:text-purple-400 font-bold">💰 ${run.cost.total.toFixed(4)}</span>
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

// Tabs del workspace de un producto: Setup / Bandeja / Inspiración / Creativos.
function ProductTabs({ activeTab, onChange }) {
  const tabs = [
    { id: 'setup', label: 'Setup', emoji: '⚙️' },
    { id: 'bandeja', label: 'Bandeja', emoji: '📥' },
    { id: 'inspiracion', label: 'Inspiración', emoji: '✨' },
    { id: 'creativos', label: 'Creativos', emoji: '🎨' },
  ];
  return (
    <div className="border-b border-gray-200 dark:border-gray-700 -mt-2">
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`px-3 py-2 text-xs font-bold transition relative shrink-0 ${
              activeTab === t.id
                ? 'text-purple-700 dark:text-purple-300'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <span className="mr-1">{t.emoji}</span>{t.label}
            {activeTab === t.id && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-purple-500 to-violet-500 rounded-t" />
            )}
          </button>
        ))}
      </div>
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
    <div className={`px-2 py-1.5 rounded-md border ${colors[color]} ${accent ? 'ring-1 ring-fuchsia-300 dark:ring-fuchsia-700' : ''}`}>
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
        ? 'bg-fuchsia-50 dark:bg-fuchsia-900/20 border-fuchsia-200 dark:border-fuchsia-800 text-fuchsia-900 dark:text-fuchsia-200'
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

function StepRow({ step, liveIdeas }) {
  const { status, label, detail, startedAt, endedAt } = step;
  const elapsed = startedAt
    ? Math.round(((endedAt || Date.now()) - startedAt) / 1000)
    : null;

  const TIPO_EMOJI = { replica: '🔵', iteracion: '🟡', diferenciacion: '🟢', desde_cero: '✨' };

  return (
    <li className={`rounded-md text-xs transition ${
      status === 'running' ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800' :
      status === 'done' ? 'bg-emerald-50/50 dark:bg-emerald-900/10' :
      status === 'error' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' :
      'bg-gray-50/50 dark:bg-gray-800/30'
    }`}>
      <div className="flex items-start gap-2 px-3 py-2">
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
