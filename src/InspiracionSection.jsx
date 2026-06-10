// Sección Inspiración de estáticos.
//
// Idea: marcas (de cualquier rubro) que hacen estáticos buenos, las agregás
// como "fuente de inspiración" del producto. Después scrapeamos sus ads
// activos diariamente y dedupeamos día a día (los que ya viste, no
// vuelven). Cuando ves un static que te gusta, click → "adaptar a
// {producto}" → arma ideas con ese ad como base de inspiración visual.
//
// Diferencia con "Competencia":
//   - Competencia = marcas del MISMO rubro que vos, ángulos copiables
//     directos. Generador hace réplicas.
//   - Inspiración = marcas de CUALQUIER rubro que hacen buenos estáticos.
//     No copiamos el ángulo (no aplica), copiamos la ESTÉTICA visual.
//
// Pipeline:
//   1. Selector de productos (igual UX que Bandeja/MetaAds)
//   2. Una vez elegido el producto, lista de marcas inspiración con
//      botón "+ Agregar marca"
//   3. Por marca: thumb de su última corrida, conteo de ads frescos
//      (desde la última vista) y botón "Scrapear ahora"
//   4. (Parte 7.2): grilla de ads del scrape, con dedup día a día
//   5. (Parte 7.4): botón "Adaptar a {producto}" en cada ad

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles, Package, ChevronRight, ChevronDown, Plus, Trash2, Link2, X,
  Loader2, Download, Image as ImageIcon, ExternalLink, Wand2, Search,
  Check, AlertCircle, LayoutGrid, Rows3, Table2, Settings2, RefreshCw,
} from 'lucide-react';
import { logCostsFromResponse } from './costsStore.js';
import { addGeneratedIdeas } from './bandejaStore.js';
import { getProductoImagen, getAccentColor } from './productoImagen.js';
import { saveReferencial, getUsedAdIdsForProducto } from './galeriaReferenciales.js';
import { cacheAdImagesBatch, getCachedAdImageUrl } from './adImagesStore.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';
import { playDoneChime, playBulkDoneChime, playErrorTone } from './sounds.js';
import EmptyState from './EmptyState.jsx';
import { supabase } from './supabase.js';
import { notifyMarketingChange } from './useMarketingSync.js';
// Galería ahora vive como tab independiente en el workspace (Arranque),
// no más como modal acá.

// Máximo de ads por tanda: 10. Más allá saturaríamos rate limits de
// gpt-image-2 (típicamente 5-15 RPM) y el browser quedaría unresponsive.
// Con concurrencia 5 paralela y n=2 fijo, 10 ads × 2 variantes = 20 imágenes
// en ~3 min, costo ~$3.60.
const MAX_SELECCIONADOS = 10;
// Bajamos de 5 a 3 paralelos — gpt-image-2 tier 1 = 5 RPM, queremos margen
// para no triggear el rate limit. El endpoint igual hace auto-retry con
// backoff (15s, 30s) si OpenAI tira 429, así que los pico que sí lleguen
// los salva transparente.
// BULK_CONCURRENCY=1: procesamos los ads UNO POR VEZ. Antes era 3 (3 ads en
// paralelo) pero la cuenta OpenAI del user encolaba los 3+ calls concurrentes
// → cada call tardaba 2-3x más por congestión. Total ≈ igual pero la UX era
// peor: imágenes salían desordenadas a la galería.
// Sequential = ad1 (4 imgs) → ad2 (4 imgs) → ad3 (4 imgs). Cada call corre
// sin cola = ~75s en vez de ~150s. Galería se llena en orden predecible.
const BULK_CONCURRENCY = 1;

// Máximo de marcas scrapeándose en paralelo cuando se usa "Scrape nuevas" /
// "Forzar todas". Antes se disparaban TODAS de una (for sin await), lo que
// saturaba la cuenta de Apify: cada run reserva ~1GB y, pasado el límite de
// memoria/concurrencia del plan, Apify encola (o aborta) las extra en silencio
// y algunas marcas quedaban vacías. Con un pool de 3 mantenemos paralelismo
// real pero acotado: cuando una termina, arranca la siguiente.
const SCRAPE_CONCURRENCY = 3;

// Corre `worker(item)` sobre `items` con un límite de concurrencia: arranca
// hasta `limit` workers y, a medida que cada uno termina, toma el próximo de
// la cola. Devuelve cuando se procesaron todos. Los errores de un item no
// frenan al resto (cada worker async ya maneja su try/catch internamente).
async function runScrapePool(items, limit, worker) {
  const queue = [...items];
  const runNext = async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  };
  const runners = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(runners);
}

// Mutex para serializar el read-modify-write de PRODUCTOS_KEY en localStorage.
// Sin esto, varios scrapes de competidores corriendo en paralelo (runScrapePool,
// SCRAPE_CONCURRENCY=3) hacen loadProductos() → setItem() sobre snapshots stale
// y el último writer pisa los resultados de los otros → se pierden ads de los
// scrapes concurrentes. El lock garantiza que cada writer lea DESPUÉS de que el
// anterior terminó de escribir, así los cambios se acumulan en vez de pisarse.
let productosWriteChain = Promise.resolve();
function withProductosLock(fn) {
  const next = productosWriteChain.then(() => fn());
  // No propagamos el rechazo a la cadena para que un fallo no rompa los locks
  // siguientes; el caller recibe el error real vía el `next` que retornamos.
  productosWriteChain = next.then(() => {}, () => {});
  return next;
}

// Extrae una keyword sensata desde una landing URL — preferimos el hostname
// COMPLETO con www. si está, porque eso es lo que pegarías a mano en la
// Ads Library de Meta. La búsqueda con dominio devuelve los ads reales del
// brand, no basura genérica.
function landingToKeyword(url) {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname; // ej: "www.vitamiplus.com"
  } catch {
    return String(url).replace(/^https?:\/\//, '').split('/')[0];
  }
}

// Valida que el keyword sea utilizable. Refuse si es muy corto o solo
// dígitos — para no caer en el bug de scrapear con nombre="1" y traer
// phone cases / cuchillos / random.
function isKeywordUsable(kw) {
  if (!kw) return false;
  const s = String(kw).trim();
  if (s.length < 4) return false;
  if (/^\d+$/.test(s)) return false;
  return true;
}

// Parse seguro de respuestas: si el server devuelve HTML (típico Vercel 504
// "An error occurred...", o un 502 del runtime), no rompe con
// "Unexpected token 'A', \"An error o\"... is not valid JSON". Detecta el caso
// y devuelve un error legible.
// Normaliza el campo `error` de una response del backend a string legible.
// El backend a veces devuelve `error: "string"` y otras veces `error:
// { type, message }` (formato de OpenAI/Apify). Sin esto el .message del
// Error quedaba como "[object Object]" en los toasts.
function stringifyApiError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    // Estructura típica: { type, message } o { error: { ... } } anidado.
    if (err.message) return String(err.message);
    if (err.error) return stringifyApiError(err.error);
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

async function parseJsonOrThrow(resp, contexto = 'API') {
  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // No es JSON — heurísticas para errores conocidos del servidor.
    if (resp.status === 504 || /timeout/i.test(raw) || /An error occurred with your deployment/i.test(raw)) {
      throw new Error(`${contexto} timeout — la operación tardó más que el límite del servidor. Reintentá con menos ads seleccionados o quality medium.`);
    }
    if (resp.status >= 500) {
      throw new Error(`${contexto} error ${resp.status} — el servidor devolvió HTML/texto en vez de JSON. Probá de nuevo en unos segundos.`);
    }
    throw new Error(`${contexto} respuesta inválida (HTTP ${resp.status}): ${raw.slice(0, 120)}`);
  }
  // Es JSON — detectar errores conocidos de OpenAI/Anthropic con mensajes amigables.
  const errStr = stringifyApiError(data?.error).toLowerCase();
  if (errStr.includes('safety system') || errStr.includes('content policy') || errStr.includes('rejected by the safety')) {
    throw new Error(`OpenAI rechazó por su safety filter — probá con OTRO ad de referencia. Triggers comunes: contenido íntimo explícito, claims médicos fuertes, palabras gatillo. El producto/marca no es el problema, es el ad ref.`);
  }
  if (errStr.includes('rate limit') || errStr.includes('too many requests')) {
    throw new Error(`OpenAI rate limit — reintentá en 20-30s con menos ads en paralelo.`);
  }
  return data;
}

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const ACTIVE_KEY = 'adslab-marketing-inspiracion-active-product';
const brandsKey = (productoId) => `adslab-marketing-inspiracion-brands-${productoId}`;

function loadProductos() {
  try {
    const raw = localStorage.getItem(PRODUCTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function loadBrands(productoId) {
  if (!productoId) return [];
  try {
    const raw = localStorage.getItem(brandsKey(productoId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveBrands(productoId, brands) {
  if (!productoId) return;
  const key = brandsKey(productoId);
  try {
    localStorage.setItem(key, JSON.stringify(brands));
    // Notificar al sync hook — sin esto el push al cloud nunca corre y
    // al recargar el pull pisa los cambios con datos viejos.
    notifyMarketingChange(key);
  } catch {}
}

// Props:
//   forcedProductoId: pisar el selector con un producto específico (cuando
//     vivimos embebidos en otra pantalla con tabs).
//   embedded: ocultar header con breadcrumb cuando el padre ya lo tiene.
function estimateProgress(progress) {
  if (!progress) return 0;
  const elapsed = (Date.now() - progress.startedAt) / 1000;
  if (progress.stage === 'preparando') return Math.min(8, elapsed * 4);
  if (progress.stage === 'generando') {
    // Asintótica hacia 92% con τ=30s.
    return 8 + (92 - 8) * (1 - Math.exp(-Math.max(0, elapsed - 0.5) / 30));
  }
  if (progress.stage === 'guardando') return 95;
  if (progress.stage === 'done') return 100;
  return 0;
}

function stageLabel(stage) {
  if (stage === 'preparando') return 'Preparando prompt…';
  if (stage === 'generando') return 'Generando con gpt-image-2…';
  if (stage === 'guardando') return 'Guardando en galería…';
  if (stage === 'done') return '¡Listo!';
  if (stage === 'error') return 'Falló';
  return '';
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Barra flotante de progreso del bulk. Muestra ad current, % total, ETA
// y un pill por cada ad para ver qué está done/doing/pending/error.
export function BulkProgressBar({ state, onClose }) {
  // Guard: si no hay bulk corriendo (state=null), no renderizamos nada.
  // El caller siempre debería check pero por defensiva acá lo doblamos —
  // Arranque renderiza esto en el shell del producto sin condicional.
  if (!state) return null;
  const { total, completed, currentIdx, current, startedAt, adsList, errors, adDurations } = state;
  const elapsedMs = Date.now() - startedAt;
  // ETA basado en duración promedio de los ads ya completos. Fallback: 45s/ad.
  const avgMs = adDurations.length > 0
    ? adDurations.reduce((a, b) => a + b, 0) / adDurations.length
    : 45000;
  const remainingMs = Math.max(0, (total - completed) * avgMs);
  const pct = Math.round((completed / total) * 100);
  const isDone = completed === total;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 border-2 border-brand-400 dark:border-brand-700 rounded-xl shadow-2xl w-[420px] max-w-[calc(100vw-3rem)] overflow-hidden">
      <div className="p-3.5">
        <div className="flex items-center gap-2 mb-2">
          {isDone
            ? <Check size={16} className="text-emerald-500" />
            : <Loader2 size={14} className="text-brand-500 animate-spin" />
          }
          <p className="text-xs font-bold text-gray-900 dark:text-gray-100 flex-1 truncate">
            {isDone
              ? `Completo · ${completed - errors.length}/${total} OK${errors.length > 0 ? ` · ${errors.length} fallaron` : ''}`
              : `Generando ${currentIdx + 1} de ${total}`
            }
          </p>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Cerrar">
            <X size={14} />
          </button>
        </div>

        {!isDone && current && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate mb-2">
            <span className="font-semibold text-brand-600 dark:text-brand-400">{current.brandNombre}</span>
            {current.adHeadline && <span> · {current.adHeadline}</span>}
          </p>
        )}

        {/* Barra de progreso total (basado en ads completos) */}
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-1">
          <div
            className={`h-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-500 to-brand-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
          <span>{pct}% · transcurrido {formatMs(elapsedMs)}</span>
          {!isDone && <span>ETA {formatMs(remainingMs)}</span>}
        </div>

        {/* Pills por ad — visual mini-status. */}
        <div className="flex flex-wrap gap-1 mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-700">
          {adsList.map((x, i) => (
            <div
              key={x.adId + i}
              title={`${x.brandNombre} · ${x.status}`}
              className={`w-2.5 h-2.5 rounded-full ${
                x.status === 'done' ? 'bg-emerald-500'
                : x.status === 'error' ? 'bg-red-500'
                : x.status === 'doing' ? 'bg-brand-500 animate-pulse'
                : 'bg-gray-300 dark:bg-gray-600'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// =========================================================
// Componentes internos definidos ANTES del export — fix TDZ
// para Vite/Rollup en builds minificados.
// =========================================================

function BrandCard({ brand, ads, isScraping, adaptingAdIds, creandoAdIds, seleccionados, selectedOrder, usedAdIds, progressById, onScrape, onAdapt, onCrearReferencial, onToggleSelect, onRemove }) {
  const isCompetidor = !!brand.isCompetidor;
  return (
    <div className="group/brand bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-amber-300 dark:hover:border-amber-700 transition">
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center text-white font-bold text-sm shrink-0 ${
          isCompetidor
            ? 'bg-gradient-to-br from-brand-500 to-brand-600'
            : 'bg-gradient-to-br from-amber-400 to-brand-400'
        }`}>
          {brand.nombre?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{brand.nombre}</p>
            {isCompetidor && (
              <span className="px-1 py-px text-[8px] font-bold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded uppercase tracking-wider shrink-0">
                comp
              </span>
            )}
            {(() => {
              // Badge "estable" — marcas que el smart scrape va a saltear porque
              // devolvieron 0 ads nuevos 3 veces seguidas. El user puede forzar
              // si quiere. Lo mostramos para que el user entienda por qué a
              // veces el smart scrape salta marcas.
              const z = isCompetidor
                ? (brand.__sourceComp?.consecutiveZeroAds || 0)
                : (brand.consecutiveZeroAds || 0);
              if (z < 3) return null;
              return (
                <span
                  className="px-1 py-px text-[8px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded uppercase tracking-wider shrink-0"
                  title={`Estable: ${z} scrapes sin ads nuevos. Smart scrape la saltea, usá "Forzar" para igual scrapearla.`}
                >
                  estable
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 truncate">
            {brand.landingUrl && (
              <a href={brand.landingUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-brand-600 hover:underline truncate">
                <Link2 size={9} /> {brand.landingUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]}
              </a>
            )}
            {brand.lastScraped && (
              <span className="shrink-0">· {new Date(brand.lastScraped).toLocaleDateString('es-AR')}</span>
            )}
            {!brand.lastScraped && <span className="italic shrink-0">· sin scrapear</span>}
          </div>
        </div>
        {/* Botón scrape inline en el header — más compacto que antes (estaba en una fila aparte) */}
        {onScrape && (
          <button
            onClick={onScrape}
            disabled={isScraping}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded hover:from-amber-600 hover:to-brand-600 transition disabled:opacity-50 shrink-0"
            title={brand.lastScraped ? 'Volver a scrapear' : 'Scrapear ads'}
          >
            {isScraping
              ? <><Loader2 size={10} className="animate-spin" /> Scrapeando…</>
              : <><Download size={10} /> {brand.lastScraped ? 'Re-scrape' : 'Scrape'}</>
            }
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove}
            className="p-1 text-gray-300 opacity-0 group-hover/brand:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition shrink-0"
            title="Eliminar marca">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {/* Notas — solo si hay, en línea aparte chiquita */}
      {brand.notas && (
        <p className="text-[10px] text-gray-600 dark:text-gray-400 italic mt-1.5 line-clamp-1">"{brand.notas}"</p>
      )}
      {/* Contador de ads cargados — solo si hay ads */}
      {ads.length > 0 && (
        <div className="mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
          {ads.length} estáticos cargados
        </div>
      )}

      {/* Grilla de estáticos scrapeados */}
      {ads.length > 0 && (
        <BrandAdsGrid
          ads={ads}
          brandNombre={brand.nombre}
          adaptingAdIds={adaptingAdIds}
          creandoAdIds={creandoAdIds}
          seleccionados={seleccionados}
          selectedOrder={selectedOrder}
          usedAdIds={usedAdIds}
          progressById={progressById}
          onAdapt={onAdapt}
          onCrearReferencial={onCrearReferencial}
          onToggleSelect={onToggleSelect}
        />
      )}
    </div>
  );
}


function AdThumb({ ad, brandNombre, fresh = false, adapting = false, creando = false, selected = false, selectionIndex = null, used = false, onAdapt, onCrearReferencial, onToggleSelect, progress = null }) {
  const cdnThumb = ad.imageUrls?.[0];
  const fbUrl = ad.snapshotUrl;
  // Si tenemos el ad cacheado en IndexedDB (sobreviven el TTL de 24h del CDN),
  // preferimos el blob URL. Sino, caemos al CDN.
  // Perf: NO ejecutamos la lookup en mount — usamos IntersectionObserver para
  // que solo corra cuando el thumb está cerca del viewport. Con 400+ thumbs
  // en pantalla, mount-time lookups eran el principal bottleneck.
  const [cachedUrl, setCachedUrl] = useState(null);
  const containerRef = React.useRef(null);
  useEffect(() => {
    let active = true;
    if (!ad?.id || !containerRef.current) return;

    const fetchCached = () => {
      getCachedAdImageUrl(ad.id).then(url => { if (active) setCachedUrl(url); });
    };

    // Si IntersectionObserver no está disponible (browsers viejos), fetch sync.
    if (typeof IntersectionObserver === 'undefined') {
      fetchCached();
      return;
    }

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          fetchCached();
          io.disconnect();
          break;
        }
      }
    }, { rootMargin: '200px' }); // pre-fetch 200px antes de que entre en pantalla

    io.observe(containerRef.current);

    const onSaved = (e) => {
      if (String(e?.detail?.adId || '') === String(ad?.id)) fetchCached();
    };
    window.addEventListener('viora:ad-image-cached', onSaved);

    return () => {
      active = false;
      io.disconnect();
      window.removeEventListener('viora:ad-image-cached', onSaved);
    };
  }, [ad?.id]);
  const thumb = cachedUrl || cdnThumb;
  return (
    <div
      ref={containerRef}
      className={`group/thumb relative aspect-square rounded-md overflow-hidden bg-gray-100 dark:bg-gray-900 border-2 transition ${
        used && !selected ? 'opacity-50 grayscale-[40%] hover:opacity-100 hover:grayscale-0' : ''
      } ${
        selected
          ? 'border-brand-500 ring-2 ring-brand-300 dark:ring-brand-700'
          : fresh
            ? 'border-emerald-300 dark:border-emerald-700 hover:border-emerald-500'
            : 'border-gray-200 dark:border-gray-700 hover:border-amber-400'
      }`}
      title={ad.body?.slice(0, 200) || ad.headline || ''}
    >
      {thumb ? (
        <img src={thumb} alt="" className="w-full h-full object-cover"
          loading="lazy" decoding="async"
          onError={(e) => { e.target.style.display = 'none'; }} />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon size={20} className="text-gray-300" />
        </div>
      )}
      {/* Indicador de imagen cacheada localmente — solo on-hover para no
          contaminar. Le da feedback al usuario de que las imágenes están
          seguras de la expiración del CDN. */}
      {cachedUrl && (
        <div className="absolute top-1 right-7 w-1.5 h-1.5 rounded-full bg-emerald-400/80 opacity-0 group-hover/thumb:opacity-100 transition" title="Imagen cacheada localmente" />
      )}

      {/* Selector numerado — siempre visible (más prominente que el checkbox).
          Cuando seleccionás muestra el ORDEN (1, 2, 3...) según el orden en
          que clickeaste. Sin selección, muestra un + suave. */}
      {onToggleSelect && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(); }}
          className={`absolute top-1.5 left-1.5 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all shadow-md ${
            selected
              ? 'bg-brand-600 text-white scale-110 ring-2 ring-white dark:ring-gray-900'
              : 'bg-white/90 dark:bg-gray-900/90 text-gray-400 dark:text-gray-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-900/40 dark:hover:text-brand-300 hover:scale-110 opacity-70 group-hover/thumb:opacity-100'
          }`}
          title={selected ? `Seleccionado #${selectionIndex} — click para deseleccionar` : 'Click para seleccionar'}
        >
          {selected ? (selectionIndex || <Check size={14} />) : <Plus size={14} />}
        </button>
      )}

      {/* Progress overlay — visible mientras el ad se está generando o
          acaba de terminar/fallar. Tapa todo el thumb para que se vea claro. */}
      {progress && (
        <div className="absolute inset-0 bg-gray-900/85 z-10 flex flex-col items-center justify-center gap-2 p-3 text-white">
          {progress.stage === 'done' ? (
            <Check size={28} className="text-emerald-400" />
          ) : progress.stage === 'error' ? (
            <AlertCircle size={28} className="text-red-400" />
          ) : (
            <Loader2 size={20} className="text-brand-300 animate-spin" />
          )}
          <p className="text-[10px] font-bold text-center leading-tight">
            {stageLabel(progress.stage)}
          </p>
          {progress.stage !== 'done' && progress.stage !== 'error' && (
            <>
              <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-400 to-brand-200 transition-all duration-500"
                  style={{ width: `${estimateProgress(progress)}%` }}
                />
              </div>
              <p className="text-[9px] text-white/70">
                {formatMs(Date.now() - progress.startedAt)}
              </p>
            </>
          )}
          {progress.stage === 'error' && progress.error && (
            <p className="text-[9px] text-red-200 text-center line-clamp-2">{progress.error}</p>
          )}
        </div>
      )}

      <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/60 transition flex flex-col items-stretch justify-end gap-1 p-1.5">
        {onCrearReferencial && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCrearReferencial(); }}
            disabled={creando}
            className="opacity-0 group-hover/thumb:opacity-100 transition inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded disabled:opacity-70"
            title="Genera 2 variaciones con tu producto real"
          >
            {creando
              ? <><Loader2 size={10} className="animate-spin" /> Generando…</>
              : <><Sparkles size={10} /> Crear creativo</>
            }
          </button>
        )}
        {onAdapt && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdapt(); }}
            disabled={adapting}
            className="opacity-0 group-hover/thumb:opacity-100 transition inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-semibold text-white bg-amber-500/90 hover:bg-amber-600 rounded disabled:opacity-70"
            title="Genera ideas (texto) en la Bandeja"
          >
            {adapting
              ? <><Loader2 size={10} className="animate-spin" /> Adaptando…</>
              : <><Wand2 size={10} /> + ideas en Bandeja</>
            }
          </button>
        )}
        <a
          href={fbUrl} target="_blank" rel="noreferrer"
          className="opacity-0 group-hover/thumb:opacity-100 transition inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-semibold text-white bg-black/70 hover:bg-black/90 rounded"
        >
          <ExternalLink size={10} /> Ver en FB
        </a>
      </div>
      {ad.daysRunning > 0 && (
        <div className="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-black/60 text-white pointer-events-none">
          {ad.daysRunning}d
        </div>
      )}
      {fresh && !used && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[8px] font-bold rounded bg-emerald-500 text-white pointer-events-none">
          NUEVO
        </div>
      )}
      {used && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[8px] font-bold rounded bg-gray-700 text-white pointer-events-none inline-flex items-center gap-0.5" title="Ya usaste este ad para generar creativos — ver Galería">
          <Check size={8} /> Usado
        </div>
      )}
    </div>
  );
}


function BrandAdsGrid({ ads, brandNombre, adaptingAdIds, creandoAdIds, seleccionados, selectedOrder, usedAdIds, progressById, onAdapt, onCrearReferencial, onToggleSelect }) {
  const [showRepeated, setShowRepeated] = useState(false);
  const [showAllFresh, setShowAllFresh] = useState(false);
  const [showAllRepeated, setShowAllRepeated] = useState(false);
  const fresh = ads.filter(a => a.isFresh !== false);
  const repeated = ads.filter(a => a.isFresh === false);
  const FRESH_LIMIT = showAllFresh ? fresh.length : 30;
  const REPEATED_LIMIT = showAllRepeated ? repeated.length : 30;

  return (
    <div className="mt-3 space-y-3">
      {/* Frescos del día */}
      {fresh.length > 0 ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1.5 flex items-center gap-1">
            ✨ Nuevos del día <span className="text-gray-400 font-normal">({fresh.length})</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {fresh.slice(0, FRESH_LIMIT).map(ad => (
              <AdThumb
                key={ad.id}
                ad={ad}
                brandNombre={brandNombre}
                fresh
                adapting={adaptingAdIds?.has(ad.id)}
                creando={creandoAdIds?.has(ad.id)}
                selected={seleccionados?.has(ad.id)}
                selectionIndex={selectedOrder?.get(ad.id) || null}
                used={usedAdIds?.has(ad.id)}
                progress={progressById?.[ad.id]}
                onAdapt={onAdapt ? () => onAdapt(ad) : null}
                onCrearReferencial={onCrearReferencial ? () => onCrearReferencial(ad) : null}
                onToggleSelect={onToggleSelect ? () => onToggleSelect(ad.id) : null}
              />
            ))}
            {fresh.length > 30 && (
              <button
                onClick={() => setShowAllFresh(s => !s)}
                className="aspect-square rounded-md flex items-center justify-center bg-gray-50 dark:bg-gray-900 border-2 border-dashed border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 italic hover:bg-gray-100 dark:hover:bg-gray-800 hover:border-brand-400 dark:hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-300 transition cursor-pointer"
                title={showAllFresh ? 'Ver solo los 30 primeros' : `Ver los ${fresh.length - 30} restantes`}
              >
                {showAllFresh ? 'Mostrar menos' : `+${fresh.length - 30} más`}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[10px] italic text-gray-500 dark:text-gray-400 text-center py-2 bg-gray-50 dark:bg-gray-900/30 rounded">
          Sin estáticos nuevos hoy — todos ya los habías visto.
        </p>
      )}

      {/* Repetidos colapsables */}
      {repeated.length > 0 && (
        <div>
          <button
            onClick={() => setShowRepeated(s => !s)}
            className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition flex items-center gap-1"
          >
            <ChevronRight size={10} className={`transition-transform ${showRepeated ? 'rotate-90' : ''}`} />
            Ya vistos ({repeated.length})
          </button>
          {showRepeated && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 opacity-60">
              {repeated.slice(0, REPEATED_LIMIT).map(ad => (
                <AdThumb
                  key={ad.id}
                  ad={ad}
                  brandNombre={brandNombre}
                  adapting={adaptingAdIds?.has(ad.id)}
                  creando={creandoAdIds?.has(ad.id)}
                  selected={seleccionados?.has(ad.id)}
                  selectionIndex={selectedOrder?.get(ad.id) || null}
                  onAdapt={onAdapt ? () => onAdapt(ad) : null}
                  onCrearReferencial={onCrearReferencial ? () => onCrearReferencial(ad) : null}
                  onToggleSelect={onToggleSelect ? () => onToggleSelect(ad.id) : null}
                />
              ))}
              {repeated.length > 30 && (
                <button
                  onClick={() => setShowAllRepeated(s => !s)}
                  className="aspect-square rounded-md flex items-center justify-center bg-gray-50 dark:bg-gray-900 border-2 border-dashed border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 italic hover:bg-gray-100 dark:hover:bg-gray-800 hover:border-brand-400 hover:text-brand-600 transition cursor-pointer"
                  title={showAllRepeated ? 'Ver solo los 30 primeros' : `Ver los ${repeated.length - 30} restantes`}
                >
                  {showAllRepeated ? 'Menos' : `+${repeated.length - 30} más`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Estima un % de progreso "honesto" para una llamada de gpt-image-2.
// preparando: 0-8% / generando: 8-92% asintótico ~45s / guardando: 92-99% / done: 100%.

// Top 10 escalados — agrega ads de todas las brands del producto, los rankea
// por score (que el backend ya calcula con daysRunning + variantes +
// multiplatform + pageLikeCount + penalty pause early), y los muestra en una
// strip horizontal. Cada item es un AdThumb con sus acciones normales
// (Crear creativo, + ideas en Bandeja, multi-select).

function TopEscaladosBar({ items, adaptingAdIds, creandoAdIds, seleccionados, selectedOrder, usedAdIds, progressById, onAdapt, onCrearReferencial, onToggleSelect }) {
  const [expanded, setExpanded] = useState(true);
  // Vista del Top 10 — persistida en localStorage. 3 opciones:
  //   grid: strip horizontal de 10 thumbs (default, denso)
  //   list: rows con thumb chico + brand + métricas + acciones inline
  //   table: tabla compacta con columnas para escanear rápido
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('adslab-top10-view') || 'grid'; }
    catch { return 'grid'; }
  });
  const setMode = (m) => {
    setViewMode(m);
    try { localStorage.setItem('adslab-top10-view', m); } catch {}
  };
  return (
    <div className="bg-gradient-to-br from-amber-50 to-brand-50 dark:from-amber-950/30 dark:to-brand-950/30 border border-amber-200 dark:border-amber-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2.5 border-b border-amber-200/50 dark:border-amber-800/50">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2.5 text-left flex-1 min-w-0 hover:opacity-80 transition"
        >
          <span className="text-base">🏆</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
              Top {items.length} escalados de tu competencia
            </p>
            <p className="text-[10px] text-amber-700 dark:text-amber-300/80 truncate">
              Rankeados por: días corriendo + variantes activas + multiplataforma + popularidad de marca
            </p>
          </div>
        </button>
        {/* Toggle de vista — 3 iconos. Solo visible cuando está expanded. */}
        {expanded && (
          <div className="flex items-center gap-0.5 bg-white/60 dark:bg-gray-800/60 rounded-md p-0.5 shrink-0">
            {[
              { v: 'grid',  Icon: LayoutGrid, label: 'Grid'   },
              { v: 'list',  Icon: Rows3,      label: 'Lista'  },
              { v: 'table', Icon: Table2,     label: 'Tabla'  },
            ].map(({ v, Icon, label }) => (
              <button
                key={v}
                onClick={() => setMode(v)}
                className={`p-1 rounded transition ${viewMode === v
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30'}`}
                title={`Ver como ${label}`}
              >
                <Icon size={12} />
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          className="p-1 rounded transition text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 shrink-0"
          title={expanded ? 'Colapsar' : 'Expandir'}
        >
          <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-3">
          {viewMode === 'grid' && (
            <TopGridView items={items} adaptingAdIds={adaptingAdIds} creandoAdIds={creandoAdIds}
              seleccionados={seleccionados} selectedOrder={selectedOrder} usedAdIds={usedAdIds} progressById={progressById}
              onAdapt={onAdapt} onCrearReferencial={onCrearReferencial} onToggleSelect={onToggleSelect} />
          )}
          {viewMode === 'list' && (
            <TopListView items={items} seleccionados={seleccionados} selectedOrder={selectedOrder}
              adaptingAdIds={adaptingAdIds} creandoAdIds={creandoAdIds}
              onAdapt={onAdapt} onCrearReferencial={onCrearReferencial} onToggleSelect={onToggleSelect} />
          )}
          {viewMode === 'table' && (
            <TopTableView items={items} seleccionados={seleccionados} selectedOrder={selectedOrder}
              adaptingAdIds={adaptingAdIds} creandoAdIds={creandoAdIds}
              onAdapt={onAdapt} onCrearReferencial={onCrearReferencial} onToggleSelect={onToggleSelect} />
          )}
        </div>
      )}
    </div>
  );
}

// VISTA 1 — Grid: el strip horizontal original con 10 thumbs grandes.

function TopGridView({ items, adaptingAdIds, creandoAdIds, seleccionados, selectedOrder, usedAdIds, progressById, onAdapt, onCrearReferencial, onToggleSelect }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-10 gap-2">
      {items.map(({ ad, brandNombre, isCompetidor }, idx) => (
        <div key={ad.id} className="relative">
          <div className={`absolute -top-1 -left-1 z-20 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md ${
            idx === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600'
            : idx < 3 ? 'bg-gradient-to-br from-amber-500 to-brand-500'
            : 'bg-gradient-to-br from-gray-600 to-gray-700'
          }`}>{idx + 1}</div>
          <AdThumb
            ad={ad} brandNombre={brandNombre} fresh={ad.isFresh !== false}
            adapting={adaptingAdIds?.has(ad.id)} creando={creandoAdIds?.has(ad.id)}
            selected={seleccionados?.has(ad.id)} selectionIndex={selectedOrder?.get(ad.id) || null} used={usedAdIds?.has(ad.id)}
            progress={progressById?.[ad.id]}
            onAdapt={onAdapt ? () => onAdapt(brandNombre, ad) : null}
            onCrearReferencial={onCrearReferencial ? () => onCrearReferencial(brandNombre, ad) : null}
            onToggleSelect={onToggleSelect ? () => onToggleSelect(ad.id) : null}
          />
          <div className="mt-1 px-0.5">
            <p className="text-[9px] font-semibold text-gray-700 dark:text-gray-200 truncate">
              {isCompetidor && <span className="text-brand-600 dark:text-brand-400">●</span>} {brandNombre}
            </p>
            <div className="flex items-center gap-1.5 text-[9px] text-gray-500 dark:text-gray-400">
              {ad.daysRunning != null && <span title="Días corriendo">{ad.daysRunning}d</span>}
              {ad.variantes > 0 && <span title="Variantes activas">·{ad.variantes}v</span>}
              {typeof ad.score === 'number' && <span className="ml-auto font-bold text-amber-600 dark:text-amber-400" title="Score compuesto">{Math.round(ad.score)}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// VISTA 2 — List: rows compactas con thumb chico + métricas + acciones inline.
// Para escanear más rápido y ver el headline / body de cada ad.

function TopListView({ items, seleccionados, selectedOrder, adaptingAdIds, creandoAdIds, onAdapt, onCrearReferencial, onToggleSelect }) {
  return (
    <div className="space-y-1.5">
      {items.map(({ ad, brandNombre, isCompetidor }, idx) => {
        const isSel = seleccionados?.has(ad.id);
        const selIdx = selectedOrder?.get(ad.id);
        const thumb = ad.imageUrls?.[0];
        return (
          <div key={ad.id}
            className={`flex items-center gap-2.5 p-1.5 rounded-md border transition ${
              isSel
                ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700'
                : 'bg-white/60 dark:bg-gray-800/60 border-transparent hover:border-amber-300 dark:hover:border-amber-700'
            }`}
          >
            {/* Ranking badge */}
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-sm ${
              idx === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600'
              : idx < 3 ? 'bg-gradient-to-br from-amber-500 to-brand-500'
              : 'bg-gradient-to-br from-gray-600 to-gray-700'
            }`}>{idx + 1}</div>
            {/* Thumb chiquito */}
            <div className="w-12 h-12 rounded bg-gray-100 dark:bg-gray-900 overflow-hidden shrink-0 border border-gray-200 dark:border-gray-700">
              {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />}
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs">
                {isCompetidor && <span className="text-brand-600 dark:text-brand-400 text-[10px]">●</span>}
                <span className="font-bold text-gray-900 dark:text-gray-100 truncate">{brandNombre}</span>
                {typeof ad.score === 'number' && (
                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 tabular-nums shrink-0">score {Math.round(ad.score)}</span>
                )}
              </div>
              <p className="text-[10px] text-gray-600 dark:text-gray-300 truncate">
                {ad.headline || ad.body?.slice(0, 80) || <span className="italic text-gray-400">(sin texto)</span>}
              </p>
              <div className="flex items-center gap-2 text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">
                {ad.daysRunning != null && <span>{ad.daysRunning}d corriendo</span>}
                {ad.variantes > 0 && <span>· {ad.variantes} variantes</span>}
                {ad.isMultiplatform && <span>· multiplataforma</span>}
              </div>
            </div>
            {/* Acciones */}
            <div className="flex items-center gap-1 shrink-0">
              {onToggleSelect && (
                <button
                  onClick={() => onToggleSelect(ad.id)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${
                    isSel ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-brand-50 hover:text-brand-600'
                  }`}
                  title={isSel ? `Seleccionado #${selIdx}` : 'Seleccionar'}
                >
                  {isSel ? selIdx : <Plus size={12} />}
                </button>
              )}
              {onCrearReferencial && (
                <button
                  onClick={() => onCrearReferencial(brandNombre, ad)}
                  disabled={creandoAdIds?.has(ad.id)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded disabled:opacity-50"
                  title="Crear creativo"
                >
                  {creandoAdIds?.has(ad.id) ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                </button>
              )}
              {onAdapt && (
                <button
                  onClick={() => onAdapt(brandNombre, ad)}
                  disabled={adaptingAdIds?.has(ad.id)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 rounded disabled:opacity-50"
                  title="+ ideas en Bandeja"
                >
                  {adaptingAdIds?.has(ad.id) ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                </button>
              )}
              {ad.snapshotUrl && (
                <a href={ad.snapshotUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center px-2 py-1 text-[10px] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  title="Ver en FB"
                >
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// VISTA 3 — Table: tabla densa para escanear varias métricas a la vez.

function TopTableView({ items, seleccionados, selectedOrder, adaptingAdIds, creandoAdIds, onAdapt, onCrearReferencial, onToggleSelect }) {
  return (
    <div className="overflow-x-auto -mx-3 px-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-amber-700 dark:text-amber-300/80 border-b border-amber-200/50 dark:border-amber-800/50">
            <th className="text-left py-1.5 pr-2 font-bold">#</th>
            <th className="text-left py-1.5 px-2 font-bold">Ad</th>
            <th className="text-left py-1.5 px-2 font-bold">Marca</th>
            <th className="text-right py-1.5 px-2 font-bold">Días</th>
            <th className="text-right py-1.5 px-2 font-bold">Variantes</th>
            <th className="text-right py-1.5 px-2 font-bold">Multi</th>
            <th className="text-right py-1.5 px-2 font-bold">Score</th>
            <th className="text-right py-1.5 pl-2 font-bold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-amber-200/30 dark:divide-amber-800/30">
          {items.map(({ ad, brandNombre, isCompetidor }, idx) => {
            const isSel = seleccionados?.has(ad.id);
            const selIdx = selectedOrder?.get(ad.id);
            const thumb = ad.imageUrls?.[0];
            return (
              <tr key={ad.id} className={`${isSel ? 'bg-brand-50/50 dark:bg-brand-900/20' : 'hover:bg-amber-100/30 dark:hover:bg-amber-900/20'} transition`}>
                <td className="py-1.5 pr-2">
                  <span className={`inline-flex w-5 h-5 rounded-full items-center justify-center text-[9px] font-bold text-white ${
                    idx === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600'
                    : idx < 3 ? 'bg-gradient-to-br from-amber-500 to-brand-500'
                    : 'bg-gradient-to-br from-gray-600 to-gray-700'
                  }`}>{idx + 1}</span>
                </td>
                <td className="py-1.5 px-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded bg-gray-100 dark:bg-gray-900 overflow-hidden shrink-0 border border-gray-200 dark:border-gray-700">
                      {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />}
                    </div>
                    <span className="text-[10px] text-gray-700 dark:text-gray-300 truncate max-w-[200px]">{ad.headline || ad.body?.slice(0, 50) || '—'}</span>
                  </div>
                </td>
                <td className="py-1.5 px-2 text-gray-700 dark:text-gray-200">
                  {isCompetidor && <span className="text-brand-600 dark:text-brand-400 text-[10px]">●</span>} {brandNombre}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{ad.daysRunning ?? '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{ad.variantes || 0}</td>
                <td className="py-1.5 px-2 text-right text-gray-600 dark:text-gray-400">{ad.isMultiplatform ? '✓' : '—'}</td>
                <td className="py-1.5 px-2 text-right font-bold tabular-nums text-amber-600 dark:text-amber-400">{typeof ad.score === 'number' ? Math.round(ad.score) : '—'}</td>
                <td className="py-1.5 pl-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    {onToggleSelect && (
                      <button onClick={() => onToggleSelect(ad.id)}
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition ${
                          isSel ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-brand-50 hover:text-brand-600'
                        }`}
                        title={isSel ? `Seleccionado #${selIdx}` : 'Seleccionar'}
                      >
                        {isSel ? selIdx : <Plus size={10} />}
                      </button>
                    )}
                    {onCrearReferencial && (
                      <button onClick={() => onCrearReferencial(brandNombre, ad)}
                        disabled={creandoAdIds?.has(ad.id)}
                        className="p-1 text-white bg-brand-600 hover:bg-brand-700 rounded disabled:opacity-50"
                        title="Crear creativo"
                      >
                        {creandoAdIds?.has(ad.id) ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      </button>
                    )}
                    {onAdapt && (
                      <button onClick={() => onAdapt(brandNombre, ad)}
                        disabled={adaptingAdIds?.has(ad.id)}
                        className="p-1 text-white bg-amber-500 hover:bg-amber-600 rounded disabled:opacity-50"
                        title="+ ideas en Bandeja"
                      >
                        {adaptingAdIds?.has(ad.id) ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}



export default function InspiracionSection({ addToast, forcedProductoId, embedded = false }) {
  // Refs de cleanup — guards contra setState en componente desmontado,
  // doble-click en bulk generate, y setTimeouts sin cancel al unmount.
  // Sin esto se filtraban warnings de React + memoria de timeouts colgados
  // si el user navega fuera durante async ops (40-90s típico).
  const mountedRef = useRef(true);
  const bulkRunningRef = useRef(false);
  const timeoutsRef = useRef(new Set());
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const id of timeoutsRef.current) clearTimeout(id);
      timeoutsRef.current.clear();
    };
  }, []);
  const trackedTimeout = (fn, ms) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id);
      if (mountedRef.current) fn();
    }, ms);
    timeoutsRef.current.add(id);
    return id;
  };

  const [productos, setProductos] = useState(() => loadProductos());
  // Re-sync productos cuando otra parte del código (Arranque, useMarketingSync,
  // otro tab) modifica localStorage. Sin esto el state de InspiracionSection
  // queda stale después de un pull o un cambio en Setup. Comparación deep por
  // JSON para detectar cambios DENTRO de p.competidores.
  useEffect(() => {
    const reload = () => {
      try {
        const fresh = loadProductos();
        setProductos(prev => {
          return JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh;
        });
      } catch {}
    };
    window.addEventListener('viora:marketing-pulled', reload);
    window.addEventListener('viora:marketing-storage-changed', reload);
    const onStorage = (e) => {
      if (!e.key || e.key === PRODUCTOS_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('viora:marketing-pulled', reload);
      window.removeEventListener('viora:marketing-storage-changed', reload);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const [activeProductoIdRaw, setActiveProductoIdRaw] = useState(() => {
    try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
  });
  const activeProductoId = forcedProductoId != null ? forcedProductoId : activeProductoIdRaw;
  const setActiveProductoId = forcedProductoId != null
    ? () => {}
    : setActiveProductoIdRaw;
  const [brands, setBrands] = useState(() => loadBrands(activeProductoId));
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({ nombre: '', landingUrl: '', fbPageUrl: '', notas: '' });
  // Set de IDs scrapeando en paralelo. Antes era un único string — al
  // arrancar un 2do scrape se pisaba el 1ro y la card #1 perdía su
  // "Scrapeando..." aunque seguía corriendo. Bug visible cuando el user
  // disparaba varios scrapes seguidos.
  const [scrapingBrandIds, setScrapingBrandIds] = useState(() => new Set());
  const addScraping = (id) => setScrapingBrandIds(prev => { const n = new Set(prev); n.add(id); return n; });
  const removeScraping = (id) => setScrapingBrandIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  // brand.id → array de ads scrapeados de la última corrida (mostrados inline).
  const [adsByBrand, setAdsByBrand] = useState({});
  // ad.id → bool, true mientras se adapta al producto (loading).
  const [adaptingAdIds, setAdaptingAdIds] = useState(new Set());
  // Multi-select para bulk. Set preserva el orden de inserción → podemos
  // mostrar 1, 2, 3... en cada thumb según el orden en que el user clickeó.
  const [seleccionados, setSeleccionados] = useState(new Set());
  // Map { adId → 1-based selection index } recomputado cada vez que cambia
  // la selección. Lo pasamos a cada AdThumb para que muestre el número.
  const selectedOrder = useMemo(() => {
    const m = new Map();
    let i = 0;
    for (const adId of seleccionados) m.set(adId, ++i);
    return m;
  }, [seleccionados]);
  const [creandoAdIds, setCreandoAdIds] = useState(new Set());
  const [showGenOpts, setShowGenOpts] = useState(false);
  // Set de sourceAdIds que ya fueron usados para generar creativos en este
  // producto — viene de la galería. Se refresca al toque cuando guardamos un
  // nuevo referencial (evento viora:referencial-saved).
  // NOTA: el useEffect que lo refresca vive MÁS ABAJO, después de la
  // declaración del const `producto`. Acá solo declaramos el state.
  const [usedAdIds, setUsedAdIds] = useState(new Set());
  // Opciones de generación (las elige el usuario en la barra de bulk o en
  // el control de la sección). Persistimos en localStorage para que no se
  // pierdan entre sesiones.
  const [genOpts, setGenOpts] = useState(() => {
    try {
      const raw = localStorage.getItem('adslab-marketing-gen-opts');
      const parsed = raw ? JSON.parse(raw) : null;
      // MIGRACIÓN: si tenían cacheado 2048x2048 del default viejo, los
      // bajamos a 1024x1024 — 2K tarda 150-250s en gpt-image-2 high y
      // hace timeout de Vercel con cierta frecuencia. Quien quiera 2K
      // explícito lo elige a mano en el selector.
      if (parsed?.size === '2048x2048') parsed.size = '1024x1024';
      return parsed || { n: 2, size: '1024x1024', quality: 'high' };
    } catch { return { n: 2, size: '1024x1024', quality: 'high' }; }
  });
  useEffect(() => {
    try { localStorage.setItem('adslab-marketing-gen-opts', JSON.stringify(genOpts)); } catch {}
  }, [genOpts]);
  // Estimación de costo por imagen alineada con backend (_costs.js). Incluye
  // size porque 2048×2048 es ~4× más caro que 1024×1024 — antes lo ignorábamos
  // y subestimábamos por 3-4x el burn de OpenAI.
  const costPerImage = (quality, size) => {
    const TABLE = {
      low:    { '1024x1024': 0.013, '1024x1536': 0.020, '1536x1024': 0.020, '2048x2048': 0.050 },
      medium: { '1024x1024': 0.046, '1024x1536': 0.068, '1536x1024': 0.068, '2048x2048': 0.175 },
      high:   { '1024x1024': 0.180, '1024x1536': 0.262, '1536x1024': 0.262, '2048x2048': 0.680 },
    };
    return TABLE[quality]?.[size] ?? 0.18;
  };
  // Cache de skeletons extraídos por Vision — { [adId]: skeleton }. Si
  // re-generamos sobre el mismo ad, reusamos el skeleton y nos saltamos
  // Vision por completo. Se persiste en localStorage para sobrevivir refresh.
  const [skeletonCache, setSkeletonCache] = useState(() => {
    try {
      const raw = localStorage.getItem('adslab-marketing-skeleton-cache');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const upsertSkeleton = (adId, skel) => {
    if (!adId || !skel) return;
    setSkeletonCache(prev => {
      // Cap a 50 entries — el plan completo es 5-50KB. Sin tope llegaba al
      // límite de 5MB de localStorage y rompía writes silenciosamente.
      // LRU simple: si ya estamos en el cap, descartamos el más antiguo.
      const MAX_ENTRIES = 50;
      const entries = Object.entries(prev);
      let next;
      if (entries.length >= MAX_ENTRIES && !(adId in prev)) {
        // Quedarnos con los últimos MAX-1 + el nuevo.
        next = Object.fromEntries(entries.slice(-(MAX_ENTRIES - 1)));
        next[adId] = skel;
      } else {
        next = { ...prev, [adId]: skel };
      }
      try { localStorage.setItem('adslab-marketing-skeleton-cache', JSON.stringify(next)); }
      catch (err) {
        // Si todavía falla (quota), purgamos a la mitad y reintentamos.
        const halved = Object.fromEntries(Object.entries(next).slice(-Math.floor(MAX_ENTRIES / 2)));
        halved[adId] = skel;
        try { localStorage.setItem('adslab-marketing-skeleton-cache', JSON.stringify(halved)); } catch {}
        return halved;
      }
      return next;
    });
  };
  // Progreso per-ad: { [adId]: { startedAt, stage, error? } }
  // stages: 'preparando' | 'generando' | 'guardando' | 'done' | 'error'
  const [progressById, setProgressById] = useState({});
  // Progreso del bulk: null cuando no hay bulk en curso.
  // { total, completed, currentIdx, current: {adId, brandNombre, adHeadline}, startedAt,
  //   adsList: [{adId, brandNombre, status: 'pending'|'doing'|'done'|'error'}], errors: [] }
  const [bulkProgress, setBulkProgress] = useState(null);
  // Tick para re-renderizar progress bars (elapsed/ETA).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (creandoAdIds.size === 0 && !bulkProgress) return;
    const t = setInterval(() => setTick(x => x + 1), 250);
    return () => clearInterval(t);
  }, [creandoAdIds.size, bulkProgress]);

  // Filtros + ordenamiento (vistas)
  const [query, setQuery] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('all'); // 'all' | 'competidor' | 'custom'
  const [estadoFiltro, setEstadoFiltro] = useState('all'); // 'all' | 'con-ads' | 'sin-scrapear'
  const [orderBy, setOrderBy] = useState('reciente'); // 'reciente' | 'nombre' | 'ads-count'

  // Polling liviano de productos cada 3s.
  useEffect(() => {
    const t = setInterval(() => {
      const fresh = loadProductos();
      setProductos(prev => (prev.length !== fresh.length ? fresh : prev));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  // Persistir activo + recargar brands al cambiar producto.
  useEffect(() => {
    try {
      if (activeProductoId) localStorage.setItem(ACTIVE_KEY, activeProductoId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {}
    setBrands(loadBrands(activeProductoId));
  }, [activeProductoId]);

  // Persistir brands al cambiar.
  useEffect(() => {
    saveBrands(activeProductoId, brands);
  }, [brands, activeProductoId]);

  const producto = productos.find(p => String(p.id) === String(activeProductoId)) || null;

  // Sync uni-direccional: competidores → brands. Cada competidor cargado en
  // Setup/Competencia aparece automático en Inspiración como marca scrapeable.
  // Matcheamos por landingUrl (más estable que id porque competidor.id es
  // numérico y brand.id es string `brand-xxx`). Si no hay match, agregamos.
  // No removemos las brands que no tienen competidor — eso lo decide el user
  // explícito desde Inspiración (que también borra del competidores como
  // efecto cascade — ver handleRemoveBrand abajo).
  useEffect(() => {
    if (!producto?.competidores) return;
    const comps = producto.competidores;
    if (comps.length === 0) return;
    setBrands(prev => {
      const byHost = new Map();
      for (const b of prev) {
        const host = (b.landingUrl || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        if (host) byHost.set(host, b);
        // Match alternativo por nombre normalizado (lower + trim)
        const n = (b.nombre || '').toLowerCase().trim();
        if (n) byHost.set(`n:${n}`, b);
      }
      const nuevas = [];
      for (const c of comps) {
        const host = (c.landingUrl || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        const nKey = `n:${(c.nombre || '').toLowerCase().trim()}`;
        const existsBy = (host && byHost.get(host)) || byHost.get(nKey);
        if (existsBy) continue;
        nuevas.push({
          id: `brand-from-comp-${c.id}`,
          nombre: c.nombre,
          landingUrl: c.landingUrl || '',
          fbPageUrl: c.fbPageUrl || '',
          notas: c.notas || '',
          createdAt: c.createdAt || new Date().toISOString(),
          lastScraped: null,
          seenAdIds: [],
          fromCompetidorId: c.id,  // marker para tracking del origen
        });
      }
      return nuevas.length > 0 ? [...nuevas, ...prev] : prev;
    });
  }, [producto?.competidores]);

  // useEffect para usedAdIds — ahora SÍ podemos referenciar `producto`.
  useEffect(() => {
    if (!producto?.id) return;
    let active = true;
    const refresh = () => {
      getUsedAdIdsForProducto(producto.id).then(set => { if (active) setUsedAdIds(set); });
    };
    refresh();
    const onSaved = () => refresh();
    window.addEventListener('viora:referencial-saved', onSaved);
    return () => { active = false; window.removeEventListener('viora:referencial-saved', onSaved); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto?.id]);

  const handleAddBrand = () => {
    const nombre = draft.nombre.trim();
    if (!nombre) {
      addToast?.({ type: 'error', message: 'Ponele nombre a la marca' });
      return;
    }
    const nueva = {
      id: `brand-${Date.now()}`,
      nombre,
      landingUrl: draft.landingUrl.trim(),
      fbPageUrl: draft.fbPageUrl.trim(),
      notas: draft.notas.trim(),
      createdAt: new Date().toISOString(),
      lastScraped: null,
      seenAdIds: [],
    };
    setBrands(prev => [nueva, ...prev]);
    setDraft({ nombre: '', landingUrl: '', fbPageUrl: '', notas: '' });
    setShowAddForm(false);
    addToast?.({ type: 'success', message: `Marca "${nombre}" sumada` });
  };

  const handleRemoveBrand = (id) => {
    const b = brands.find(x => x.id === id);
    if (!b) return;
    if (!window.confirm(`¿Eliminar "${b.nombre}"? Si está cargado como competidor también lo quita de Setup → Competencia.`)) return;
    setBrands(prev => prev.filter(x => x.id !== id));
    setAdsByBrand(prev => {
      const next = { ...prev }; delete next[id]; return next;
    });
    // Cascade delete: si la brand vino de un competidor (o matchea por
    // landingUrl / nombre), borramos también el competidor del producto.
    // Source of truth unificado.
    // Computamos updated FUERA del setter para evitar side effects en el
    // updater (StrictMode dev dispara updaters dos veces → doble write +
    // doble dispatch). Y usamos notifyMarketingChange para consistencia.
    const updated = loadProductos().map(p => {
      if (String(p.id) !== String(activeProductoId)) return p;
      const comps = p.competidores || [];
      const host = (b.landingUrl || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const brandNombre = (b.nombre || '').toLowerCase().trim();
      const next = comps.filter(c => {
        if (b.fromCompetidorId && String(c.id) === String(b.fromCompetidorId)) return false;
        const cHost = (c.landingUrl || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        if (host && cHost === host) return false;
        if (brandNombre && (c.nombre || '').toLowerCase().trim() === brandNombre) return false;
        return true;
      });
      return { ...p, competidores: next };
    });
    try {
      localStorage.setItem(PRODUCTOS_KEY, JSON.stringify(updated));
      notifyMarketingChange(PRODUCTOS_KEY);
    } catch {}
    setProductos(updated);
  };

  // Adapta un ad de inspiración al producto activo: llama al endpoint
  // adapt-inspiracion (Claude Vision con la imagen + contexto del producto)
  // y mete las ideas generadas directamente en la Bandeja del producto.
  const handleAdapt = async (brandNombre, ad) => {
    if (!producto) return;
    setAdaptingAdIds(prev => new Set(prev).add(ad.id));
    const execId = startExecution({
      label: `Adaptando ideas desde ${brandNombre}`,
      // Sanitizamos templates Meta del estilo {{product.name}} que algunos
      // competidores dejan en el headline — Apify scrapea el raw template
      // sin que Meta lo interpole para nosotros.
      sublabel: (ad.headline || ad.body || '').replace(/\{\{[^}]+\}\}/g, '').trim().slice(0, 60),
      kind: 'adapt',
      estimatedMs: 40000,
    });
    try {
      const resp = await fetch('/api/marketing/adapt-inspiracion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto: {
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            landingUrl: producto.landingUrl,
            research: producto.docs?.research,
            avatar: producto.docs?.avatar,
            activoVisual: producto.activoVisual,
          },
          inspiracion: { brandNombre, ad },
        }),
      });
      const data = await parseJsonOrThrow(resp, 'adapt-inspiracion');
      if (!resp.ok) throw new Error(stringifyApiError(data.error) || `HTTP ${resp.status}`);
      const adaptCost = logCostsFromResponse(data, `adapt-inspiracion · ${brandNombre}`);

      const ideas = (data.ideas || []).map(i => ({
        ...i,
        tipo: 'replica',
        productoId: String(producto.id),
        productoNombre: producto.nombre,
        origen: {
          competidorNombre: `Inspiración: ${brandNombre}`,
          adId: ad.id,
          adSnapshotUrl: ad.snapshotUrl,
          imageUrl: ad.imageUrls?.[0],
          razonamiento: i.razonamiento,
        },
      }));
      addGeneratedIdeas(ideas);

      const msg = `${ideas.length} ideas adaptadas en la Bandeja de ${producto.nombre}`;
      addToast?.({ type: 'success', message: msg });
      finishExecution(execId, { ok: true, message: msg, cost: adaptCost?.total });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude adaptar: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
    } finally {
      if (mountedRef.current) {
        setAdaptingAdIds(prev => {
          const next = new Set(prev); next.delete(ad.id); return next;
        });
      }
    }
  };

  // Toggle un ad en la selección — cap MAX_SELECCIONADOS.
  const toggleSeleccion = (adId) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(adId)) {
        next.delete(adId);
      } else {
        if (next.size >= MAX_SELECCIONADOS) {
          addToast?.({ type: 'info', message: `Máximo ${MAX_SELECCIONADOS} ads por tanda. Deseleccioná alguno.` });
          return prev;
        }
        next.add(adId);
      }
      return next;
    });
  };

  const limpiarSeleccion = () => setSeleccionados(new Set());

  // Genera N variaciones de creativo referencial para UN ad de inspiración.
  // ESTRATEGIA — parallel client-side:
  //   • Call#1: pide n=1, nPlan=N, variationStartIndex=0. Backend corre
  //     Strategist con nPlan variations, genera 1 imagen (variation #0),
  //     devuelve plan completo. Frontend cachea el plan.
  //   • Calls#2..N en batches de 2 (concurrency=2): pide n=1 cada uno,
  //     skeletonCached=plan, variationStartIndex=i. Backend usa la
  //     variation[i] del plan cacheado sin re-correr Strategist.
  //
  // Ventajas vs n=N en un solo call:
  //   • Cada call ~70s — lejos del timeout de Vercel (300s).
  //   • Falla 1 → las otras 3 siguen funcionando.
  //   • Progreso real (1/4, 2/4, ...).
  //   • Mismo costo de Sonnet ($0.04 una vez) gracias al cache.
  const crearReferencialDeAd = async (brandNombre, ad) => {
    if (!producto) return false;
    // Pasamos producto como fallback — cross-device, localStorage puede no
    // tener producto.fotoUrl todavía pero el cloud sí.
    const prodImg = await getProductoImagen(producto.id, producto);
    if (!prodImg) {
      addToast?.({ type: 'error', message: 'Cargá la foto del producto en Setup primero.' });
      return false;
    }
    setCreandoAdIds(prev => new Set(prev).add(ad.id));
    setProgressById(prev => ({
      ...prev,
      [ad.id]: { startedAt: Date.now(), stage: 'preparando' },
    }));
    const costoPorImg = costPerImage(genOpts.quality, genOpts.size);
    const visionCost = skeletonCache[ad.id] ? 0 : 0.04; // Sonnet Strategist
    const nVar = Math.max(1, Math.min(10, genOpts.n || 2));
    const estimatedCost = nVar * costoPorImg + visionCost;
    const execId = startExecution({
      label: `Creando ${nVar} creativo${nVar !== 1 ? 's' : ''} de ${brandNombre}`,
      // Sanitizamos templates Meta del estilo {{product.name}} que algunos
      // competidores dejan en el headline — Apify scrapea el raw template
      // sin que Meta lo interpole para nosotros.
      sublabel: (ad.headline || ad.body || '').replace(/\{\{[^}]+\}\}/g, '').trim().slice(0, 60),
      kind: 'creative',
      estimatedMs: 80000 * Math.ceil(nVar / 2), // 80s por batch de 2
      estimatedCost,
    });

    const refImageUrl = ad.imageUrls?.[0];
    if (!refImageUrl) {
      addToast?.({ type: 'error', message: 'Este ad no tiene imagen para usar como referencia' });
      finishExecution(execId, { ok: false, message: 'sin imagen' });
      setCreandoAdIds(prev => { const n = new Set(prev); n.delete(ad.id); return n; });
      return false;
    }

    const baseBody = {
      producto: {
        id: producto.id,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        research: producto.docs?.research,
        // Ofertas: pasamos ambos campos para que el server pueda preferir
        // ofertasReales (focalizado, llenado en Setup) y caer a offerBrief
        // (doc generado por la pipeline) como fallback.
        ofertasReales: producto.ofertasReales || '',
        offerBrief: producto.ofertasReales || producto.docs?.offerBrief || '',
      },
      inspiracion: {
        brandNombre,
        body: ad.body, headline: ad.headline,
        formato: ad.formato,
        analysis: ad.analysis || null,
        visual: ad.visual || null,
      },
      inspiracionImageUrl: refImageUrl,
      productoImagen: prodImg,
      accentColor: getAccentColor(producto.id, producto) || '',
      quality: genOpts.quality,
      size: genOpts.size,
    };

    // Helper: una sola llamada (devuelve { data } o lanza).
    // Mandamos Authorization con el access_token de Supabase para que el
    // backend pueda guardar el creativo en cloud (Storage + DB) directamente
    // — eso permite que el user cierre la pestaña y el creativo igual quede.
    const doCall = async (variationStartIndex, planCached) => {
      let authToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        authToken = session?.access_token || '';
      } catch {}
      const resp = await fetch('/api/marketing/crear-creativo-referencial', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          ...baseBody,
          n: 1,
          nPlan: nVar,
          variationStartIndex,
          skeletonCached: planCached || null,
        }),
      });
      const data = await parseJsonOrThrow(resp, 'crear-creativo-referencial');
      if (!resp.ok) throw new Error(stringifyApiError(data.error) || `HTTP ${resp.status}`);
      return data;
    };

    // Helper: persiste UNA imagen del response a galería.
    // - Si el backend guardó al cloud (data.cloudCreativos existe), NO
    //   re-subimos — la galería va a leer del cloud automático. Solo
    //   notificamos que hay un nuevo creativo.
    // - Si NO hubo cloud save (fallback IDB local), guardamos con
    //   imageBase64 como antes.
    const saveOne = async (data, variantIndex, plan) => {
      // Background save server-side: ya está. Solo refrescar la galería.
      if (Array.isArray(data.cloudCreativos) && data.cloudCreativos.length > 0) {
        try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail: { productoId: String(producto.id), cloud: true } })); } catch {}
        return;
      }
      // El backend nos dice por qué no pudo guardar al cloud — mostrar al
      // user para que sepa que si cierra la pestaña, pierde el creativo.
      // (cloudSaveError viene del endpoint con detalle: auth, env, productoId).
      if (data.cloudSaveError) {
        console.warn('[crear-creativo-referencial] cloudSaveError:', data.cloudSaveError);
        addToast?.({
          type: 'warning',
          message: `Cloud save no funcionó (${data.cloudSaveError}). Guardando local — NO cierres la pestaña.`,
        });
      }
      // Fallback: backend NO guardó al cloud (sin auth o sin Storage). Save
      // local como antes.
      const variantStyle = data.variantStyles?.[0] || 'strategist';
      const promptStr = data.prompts?.[0]?.prompt || data.promptReference || '';
      await saveReferencial({
        id: `ref_${Date.now()}_${ad.id}_${variantIndex}`,
        productoId: String(producto.id),
        sourceAdId: ad.id,
        sourceBrand: brandNombre,
        sourceImageUrl: refImageUrl,
        sourceHeadline: ad.headline || ad.body?.slice(0, 200) || '',
        variantIndex,
        variantStyle,
        imageBase64: data.imagenes?.[0] || '',
        mimeType: data.mimeType || 'image/png',
        prompt: promptStr,
        skeleton: plan?.visual || data.skeleton || null,
        model: data.model,
        visionModel: data.visionModel || null,
        size: data.size,
        sizeFallback: !!data.sizeFallback,
        quality: data.quality || 'high',
        createdAt: new Date().toISOString(),
      });
    };

    try {
      await new Promise(r => setTimeout(r, 150));
      setProgressById(prev => ({
        ...prev,
        [ad.id]: { ...prev[ad.id], stage: `generando 1/${nVar}` },
      }));
      updateExecution(execId, { stage: `Generando 1/${nVar}…` });

      // CALL #1 — solo, para obtener el plan y poblar el cache.
      let cachedPlan = skeletonCache[ad.id] || null;
      const firstData = await doCall(0, cachedPlan);
      const totalCostAccum = { openai: 0, anthropic: 0 };
      const c1 = logCostsFromResponse(firstData, `crear-creativo-referencial · ${brandNombre} · 1/${nVar}`);
      totalCostAccum.openai += c1?.openai || 0;
      totalCostAccum.anthropic += c1?.anthropic || 0;

      const newPlan = firstData.plan || cachedPlan;
      if (newPlan && !firstData.skeletonFromCache) {
        upsertSkeleton(ad.id, newPlan);
        cachedPlan = newPlan;
      } else if (cachedPlan == null && firstData.skeleton) {
        upsertSkeleton(ad.id, firstData.skeleton);
      }

      await saveOne(firstData, 0, newPlan);
      // Limpiar ref del base64 inmediatamente — sin esto Chrome lo mantiene
      // ~5-15MB en heap hasta el siguiente GC. Con 4 imágenes seguidas
      // el renderer crashea (Código de error: 5).
      if (firstData.imagenes) firstData.imagenes.length = 0;
      let completed = 1;
      let failed = 0;
      setProgressById(prev => ({
        ...prev,
        [ad.id]: { ...prev[ad.id], stage: `generando ${completed}/${nVar}` },
      }));

      // CALLS #2..N — SECUENCIAL (concurrency=1) para no acumular base64s
      // en memoria. Con concurrency=2 dos imágenes de 5-15MB conviven en
      // heap → renderer OOM. Secuencial es 70s más lento por variación pero
      // estable.
      if (nVar > 1) {
        for (let idx = 1; idx < nVar; idx++) {
          try {
            const data = await doCall(idx, cachedPlan);
            await saveOne(data, idx, cachedPlan);
            const c = logCostsFromResponse(data, `crear-creativo-referencial · ${brandNombre} · ${idx + 1}/${nVar}`);
            totalCostAccum.openai += c?.openai || 0;
            totalCostAccum.anthropic += c?.anthropic || 0;
            // Liberar la referencia al base64 ANTES del próximo call.
            if (data.imagenes) data.imagenes.length = 0;
            completed++;
          } catch (err) {
            console.warn(`Variación ${idx + 1}/${nVar} de ${brandNombre} falló:`, err.message);
            failed++;
          }
          setProgressById(prev => ({
            ...prev,
            [ad.id]: { ...prev[ad.id], stage: `generando ${completed}/${nVar}${failed ? ` (${failed} ✗)` : ''}` },
          }));
          updateExecution(execId, { stage: `Generando ${completed}/${nVar}…` });
        }
      }

      setProgressById(prev => ({
        ...prev,
        [ad.id]: { ...prev[ad.id], stage: 'done' },
      }));
      const cacheNote = firstData.skeletonFromCache ? ' (plan cacheado)' : '';
      const failNote = failed > 0 ? ` (${failed} fallaron)` : '';
      const msg = `${completed}/${nVar} variaciones generadas${failNote}${cacheNote}`;
      addToast?.({ type: failed > 0 ? 'warning' : 'success', message: msg });
      finishExecution(execId, { ok: failed === 0, message: msg, cost: totalCostAccum.openai + totalCostAccum.anthropic });
      // Sonido de aviso — útil para seguir trabajando en otra cosa
      // mientras la generación corre en background.
      if (failed === 0) playDoneChime(); else if (completed > 0) playDoneChime(); else playErrorTone();
      // Auto-limpiar el estado del progreso después de 2.5s para que se vea el "✓".
      trackedTimeout(() => {
        setProgressById(prev => {
          const next = { ...prev }; delete next[ad.id]; return next;
        });
      }, 2500);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false; // user navegó fuera durante async
      setProgressById(prev => ({
        ...prev,
        [ad.id]: { ...prev[ad.id], stage: 'error', error: err?.message || 'Error' },
      }));
      addToast?.({ type: 'error', message: `No pude generar: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
      playErrorTone();
      // Limpiar el error después de 5s.
      trackedTimeout(() => {
        setProgressById(prev => {
          const next = { ...prev }; delete next[ad.id]; return next;
        });
      }, 5000);
      return false;
    } finally {
      if (mountedRef.current) {
        setCreandoAdIds(prev => {
          const next = new Set(prev); next.delete(ad.id); return next;
        });
      }
    }
  };

  // Bulk: itera los seleccionados en SECUENCIAL (gpt-image-2 toma 30-60s
  // por llamada y queremos evitar rate limits). Mantiene bulkProgress
  // actualizado para que la barra flotante muestre ETA real.
  const handleBulkCrear = async () => {
    // Guard contra doble-click. Sin esto, dos workers procesaban el mismo
    // index del queue por race en nextIndex → ads generados 2x o skipped.
    if (bulkRunningRef.current) {
      addToast?.({ type: 'info', message: 'Ya hay un bulk corriendo. Esperá a que termine.' });
      return;
    }
    if (seleccionados.size === 0) return;
    if (!producto) return;
    // Pasamos producto como fallback para que getProductoImagen pueda fallback
    // a producto.fotoUrl del cloud si localStorage aún no sincronizó.
    const prodImg = await getProductoImagen(producto.id, producto);
    if (!prodImg) {
      addToast?.({ type: 'error', message: 'Cargá la foto del producto en Setup primero.' });
      return;
    }
    bulkRunningRef.current = true;
    // Costo: $0.18/imagen (high) × 2 variantes + ~$0.005 vision (Haiku) por ad
    // que NO esté ya en cache. n=2 fijo.
    const costoPorImagen = costPerImage(genOpts.quality, genOpts.size);
    const visionAds = Array.from(seleccionados).filter(adId => !skeletonCache[adId]).length;
    const nVarBulk = Math.max(1, Math.min(10, genOpts.n || 2));
    const costoEstimado = seleccionados.size * nVarBulk * costoPorImagen + visionAds * 0.005;
    const total = seleccionados.size * nVarBulk;
    const sizeLabel = genOpts.size === '1024x1536' ? '1024×1536 portrait' : genOpts.size === '1024x1024' ? '1024×1024 1:1' : '2048×2048 1:1';
    const cacheNote = visionAds < seleccionados.size ? ` (${seleccionados.size - visionAds} con skeleton cacheado)` : '';
    if (!window.confirm(`Generar ${nVarBulk} variante${nVarBulk !== 1 ? 's' : ''} ${sizeLabel} por cada uno de los ${seleccionados.size} ads${cacheNote} → ${total} imágenes total, ~$${costoEstimado.toFixed(2)}. Corriendo en paralelo, debería tardar ~${Math.ceil(seleccionados.size / BULK_CONCURRENCY) * 90}s. ¿Seguir?`)) return;

    // Buscar los ad objects desde adsByBrand + de los competidores (que viven
    // en producto.competidores, no en brands custom).
    const adsAGenerar = [];
    const adsCompetidores = (producto.competidores || []).flatMap(c =>
      (c.ads || [])
        .filter(a => seleccionados.has(a.id) && (a.imageUrls?.length || 0) > 0)
        .map(a => ({ brandNombre: c.nombre, ad: a }))
    );
    const adsCustom = Object.entries(adsByBrand).flatMap(([brandId, lista]) => {
      const b = brands.find(x => x.id === brandId);
      const brandNombre = b?.nombre || 'Inspiración';
      return (lista || [])
        .filter(a => seleccionados.has(a.id))
        .map(a => ({ brandNombre, ad: a }));
    });
    adsAGenerar.push(...adsCompetidores, ...adsCustom);

    // Inicializar barra de progreso del bulk.
    setBulkProgress({
      total: adsAGenerar.length,
      completed: 0,
      currentIdx: 0,
      startedAt: Date.now(),
      adDurations: [],
      current: { adId: adsAGenerar[0].ad.id, brandNombre: adsAGenerar[0].brandNombre, adHeadline: adsAGenerar[0].ad.headline || adsAGenerar[0].ad.body?.slice(0, 60) || '' },
      adsList: adsAGenerar.map((x, i) => ({
        adId: x.ad.id,
        brandNombre: x.brandNombre,
        status: 'pending',
      })),
      errors: [],
    });

    // Ejecución en PARALELO con concurrencia BULK_CONCURRENCY.
    // Cada worker toma del queue y procesa hasta vaciarlo. Mucho más rápido
    // que el for-await secuencial anterior.
    let nextIndex = 0;
    const indexOf = new Map(adsAGenerar.map((x, i) => [x.ad.id, i]));
    const worker = async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= adsAGenerar.length) return;
        const { brandNombre, ad } = adsAGenerar[i];
        setBulkProgress(prev => prev ? ({
          ...prev,
          adsList: prev.adsList.map((x, idx) =>
            idx === i ? { ...x, status: 'doing' } : x
          ),
        }) : prev);
        const adStartedAt = Date.now();
        const ok = await crearReferencialDeAd(brandNombre, ad);
        const adDuration = Date.now() - adStartedAt;
        setBulkProgress(prev => prev ? ({
          ...prev,
          completed: prev.completed + 1,
          currentIdx: Math.min(prev.currentIdx + 1, prev.total - 1),
          adDurations: [...prev.adDurations, adDuration],
          adsList: prev.adsList.map((x, idx) =>
            idx === i ? { ...x, status: ok ? 'done' : 'error' } : x
          ),
          errors: ok ? prev.errors : [...prev.errors, brandNombre],
        }) : prev);
      }
    };
    const workers = Array.from(
      { length: Math.min(BULK_CONCURRENCY, adsAGenerar.length) },
      () => worker()
    );
    try {
      await Promise.all(workers);
    } finally {
      bulkRunningRef.current = false;
    }

    if (!mountedRef.current) return; // user navegó fuera durante el bulk
    limpiarSeleccion();
    trackedTimeout(() => setBulkProgress(null), 4000);
    addToast?.({ type: 'success', message: 'Generación bulk completa — revisá la galería' });
    playBulkDoneChime();
  };

  // Permite cerrar la barra de bulk manualmente.
  const cerrarBulkProgress = () => setBulkProgress(null);

  // Scrapea ads activos de una marca via Apify. Si tiene fbPageUrl, prefiere
  // eso (más estable). Sino, deriva keyword del landingUrl.
  const handleScrapeBrand = async (brand) => {
    addScraping(brand.id);
    const execId = startExecution({
      label: `Scrapeando ads de ${brand.nombre}`,
      sublabel: 'Meta Ads Library vía Apify',
      kind: 'scrape',
      estimatedMs: 60000,
    });
    try {
      const payload = { country: 'ALL', limit: 100 };
      if (brand.fbPageUrl) {
        payload.fbPageUrl = brand.fbPageUrl.startsWith('http') ? brand.fbPageUrl : `https://www.facebook.com/${brand.fbPageUrl}`;
      } else if (brand.landingUrl) {
        updateExecution(execId, { stage: 'Buscando la FB page del competidor…' });
        try {
          const r = await fetch('/api/marketing/resolve-fb-page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ landingUrl: brand.landingUrl }),
          });
          const d = await r.json();
          if (d.pageUrl) {
            payload.fbPageUrl = d.pageUrl;
            setBrands(prev => prev.map(x => x.id === brand.id ? { ...x, fbPageUrl: d.pageUrl } : x));
          } else {
            payload.searchKeyword = landingToKeyword(brand.landingUrl);
            // Avisamos al user que cayó a keyword — es común que el FB page
            // tenga un nombre distinto al dominio (ej. shopify storefronts).
            // Sin esto, el scrape puede devolver 0 y el user no entiende.
            if (d.error) {
              addToast?.({
                type: 'info',
                message: `No pude detectar la FB page de ${brand.nombre}. Buscando por keyword "${payload.searchKeyword}". Si scrape devuelve 0, cargá el FB page URL a mano en Setup.`,
              });
            }
          }
        } catch {
          payload.searchKeyword = landingToKeyword(brand.landingUrl);
        }
      } else if (isKeywordUsable(brand.nombre)) {
        payload.searchKeyword = brand.nombre;
      } else {
        throw new Error('Sin landing URL ni nombre utilizable. Cargá la landing o el FB page URL del competidor en Setup.');
      }
      if (!payload.fbPageUrl && !isKeywordUsable(payload.searchKeyword)) {
        throw new Error(`Keyword "${payload.searchKeyword}" no es utilizable (muy genérica). Cargá el FB page URL del competidor en Setup.`);
      }

      updateExecution(execId, { stage: `Scrapeando ${payload.fbPageUrl ? 'desde FB page' : `keyword "${payload.searchKeyword}"`}…` });
      const resp = await fetch('/api/marketing/apify-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseJsonOrThrow(resp, 'apify-ingest');
      if (!resp.ok) throw new Error(stringifyApiError(data.error) || `HTTP ${resp.status}`);
      const scrapeCost = logCostsFromResponse(data, `inspiracion · ${brand.nombre}`);

      const allAds = data.ads || [];
      // Solo statics (sin video) — para Inspiración nos interesan los estáticos.
      const staticAds = allAds.filter(a => (a.imageUrls?.length || 0) > 0 && (a.videoUrls?.length || 0) === 0);

      // Dedup día a día: marcamos como "fresh" los ads cuyo id NO estaba
      // en seenAdIds. El resto son repetidos de corridas anteriores —
      // los mostramos pero secundarios (collapsed por default en el UI).
      const seenSet = new Set(brand.seenAdIds || []);
      const enriched = staticAds.map(a => ({ ...a, isFresh: !seenSet.has(a.id) }));

      // Actualizamos seenAdIds con los ids de esta corrida (todos quedan
      // como vistos para la próxima).
      const newSeenIds = Array.from(new Set([...(brand.seenAdIds || []), ...staticAds.map(a => a.id)]));
      // Capamos a 1000 ids para no inflar localStorage.
      const cappedSeenIds = newSeenIds.slice(-1000);

      setAdsByBrand(prev => ({ ...prev, [brand.id]: enriched }));
      const freshCount = enriched.filter(a => a.isFresh).length;
      setBrands(prev => prev.map(x => x.id === brand.id ? {
        ...x,
        lastScraped: new Date().toISOString(),
        seenAdIds: cappedSeenIds,
        // Mismo tracking que para competidores — si 3 scrapes seguidos
        // devuelven 0 nuevos, el "Scrape todas" smart la saltea.
        consecutiveZeroAds: freshCount > 0 ? 0 : (x.consecutiveZeroAds || 0) + 1,
      } : x));
      const repeatedCount = enriched.length - freshCount;
      const msg = freshCount > 0
        ? `${freshCount} estáticos NUEVOS de ${brand.nombre}${repeatedCount > 0 ? ` (+${repeatedCount} repetidos)` : ''}`
        : `${repeatedCount} estáticos de ${brand.nombre} (todos ya vistos antes)`;
      addToast?.({ type: 'success', message: msg });

      // Cacheo de imágenes en background — para que sobrevivan a las 24h del CDN.
      cacheNewAdsInBackground(enriched, { productoId: producto?.id, brandId: brand.id, brandNombre: brand.nombre });

      finishExecution(execId, { ok: true, message: msg, cost: scrapeCost?.total });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude scrapear ${brand.nombre}: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
    } finally {
      removeScraping(brand.id);
    }
  };

  // Scrape específico para una marca COMPETIDOR (vive en producto.competidores).
  // Reusa apify-ingest pero el resultado lo escribimos en el producto, no en
  // `brands`. Después triggereamos refresh de productos.
  const handleScrapeCompetidor = async (brand) => {
    addScraping(brand.id);
    const comp = brand.__sourceComp;
    if (!comp || !producto) {
      removeScraping(brand.id);
      if (!producto) {
        addToast?.({
          type: 'warning',
          message: 'Cargando tus productos del cloud — probá de nuevo en un segundo.',
        });
      }
      return;
    }
    const execId = startExecution({
      label: `Scrapeando ads de ${comp.nombre}`,
      sublabel: 'Meta Ads Library vía Apify',
      kind: 'scrape',
      estimatedMs: 60000,
    });
    try {
      const payload = { country: 'ALL', limit: 100 };
      if (comp.fbPageUrl) {
        payload.fbPageUrl = comp.fbPageUrl.startsWith('http') ? comp.fbPageUrl : `https://www.facebook.com/${comp.fbPageUrl}`;
      } else if (comp.landingUrl) {
        updateExecution(execId, { stage: 'Buscando la FB page del competidor…' });
        try {
          const r = await fetch('/api/marketing/resolve-fb-page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ landingUrl: comp.landingUrl }),
          });
          const d = await r.json();
          if (d.pageUrl) {
            payload.fbPageUrl = d.pageUrl;
          } else {
            payload.searchKeyword = landingToKeyword(comp.landingUrl);
            if (d.error) {
              addToast?.({
                type: 'info',
                message: `No pude detectar la FB page de ${comp.nombre}. Buscando por keyword "${payload.searchKeyword}". Si devuelve 0, cargá el FB page URL en Setup.`,
              });
            }
          }
        } catch {
          payload.searchKeyword = landingToKeyword(comp.landingUrl);
        }
      } else if (isKeywordUsable(comp.nombre)) {
        payload.searchKeyword = comp.nombre;
      } else {
        throw new Error('Sin landing URL ni nombre utilizable. Cargá la landing o el FB page URL en Setup.');
      }
      if (!payload.fbPageUrl && !isKeywordUsable(payload.searchKeyword)) {
        throw new Error(`Keyword "${payload.searchKeyword}" no es utilizable (muy genérica). Cargá el FB page URL en Setup.`);
      }

      updateExecution(execId, { stage: `Scrapeando ${payload.fbPageUrl ? 'desde FB page' : `keyword "${payload.searchKeyword}"`}…` });
      const resp = await fetch('/api/marketing/apify-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseJsonOrThrow(resp, 'apify-ingest');
      if (!resp.ok) throw new Error(stringifyApiError(data.error) || `HTTP ${resp.status}`);
      const scrapeCost = logCostsFromResponse(data, `inspiracion · ${comp.nombre}`);

      const ads = data.ads || [];
      const prevIds = new Set((comp.ads || []).map(a => a.id));
      const newAds = ads.filter(a => !prevIds.has(a.id));

      // Actualizamos el producto en localStorage (donde viven los competidores).
      // consecutiveZeroAds: marcas que devuelven 0 nuevos N veces seguidas
      // se consideran "estables" y se saltan del "Scrape todas" smart.
      // Reset a 0 cuando aparecen nuevos.
      // Serializado vía mutex: el loadProductos() corre DESPUÉS de que el
      // scrape anterior (de la misma tanda paralela) terminó de escribir, así
      // los resultados de los 3 competidores concurrentes se acumulan en vez
      // de pisarse entre sí.
      await withProductosLock(() => {
        const fresh = loadProductos();
        const updated = fresh.map(p => {
          if (String(p.id) !== String(producto.id)) return p;
          const comps = (p.competidores || []).map(c => {
            if (c.id !== comp.id) return c;
            const prevZeroes = c.consecutiveZeroAds || 0;
            return {
              ...c, ads,
              adsTotal: data.total || 0, winnersCount: data.winners || 0,
              lastAdsCheck: new Date().toISOString(),
              consecutiveZeroAds: newAds.length > 0 ? 0 : prevZeroes + 1,
            };
          });
          return { ...p, competidores: comps, updated_at: new Date().toISOString() };
        });
        try {
          localStorage.setItem(PRODUCTOS_KEY, JSON.stringify(updated));
          // Sin esto, el scrape del competidor NO se pushea al cloud y al
          // recargar la página el pull pisa lastAdsCheck con null. Resultado:
          // "ya scrapie varias veces y queda igual" (PR fix de Aurivita).
          notifyMarketingChange(PRODUCTOS_KEY);
        } catch {}
        setProductos(updated);
      });

      const msg = newAds.length > 0
        ? `${newAds.length} estáticos NUEVOS de ${comp.nombre} (${ads.length} total)`
        : `${ads.length} estáticos de ${comp.nombre} (sin nuevos)`;
      addToast?.({ type: 'success', message: msg });

      // Cache en background. Para Inspiración solo nos interesan los estáticos.
      const staticAds = ads.filter(a => (a.imageUrls?.length || 0) > 0 && (a.videoUrls?.length || 0) === 0);
      cacheNewAdsInBackground(staticAds, { productoId: producto.id, brandId: brand.id, brandNombre: comp.nombre });

      finishExecution(execId, { ok: true, message: msg, cost: scrapeCost?.total });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude scrapear ${brand.nombre}: ${err.message}` });
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
    } finally {
      removeScraping(brand.id);
    }
  };

  // Cacheo asíncrono de imágenes — corre en background sin bloquear UI.
  // Avisa por toast al terminar (solo si cacheó algo significativo).
  const cacheNewAdsInBackground = (ads, { productoId, brandId, brandNombre }) => {
    if (!ads || ads.length === 0) return;
    // No await — fire and forget.
    cacheAdImagesBatch(ads, {
      productoId, brandId,
      concurrency: 4,
    }).then(({ cached, total }) => {
      if (cached > 0) {
        addToast?.({
          type: 'info',
          message: `${cached}/${total} imágenes de ${brandNombre} cacheadas localmente`,
        });
      }
    }).catch(() => {});
  };

  // ====================================================================
  // VISTA 1: SELECTOR DE PRODUCTOS
  // ====================================================================
  if (!activeProductoId || !producto) {
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-brand-500 flex items-center justify-center text-white shadow-sm">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Inspiración de estáticos</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Marcas de cualquier rubro que hacen buenos estáticos — para inspirar el diseño visual del producto.
            </p>
          </div>
        </div>

        {productos.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Sin productos cargados"
            description="Andá a Arranque y creá un producto primero. La inspiración compite contra la competencia de un producto específico — necesitás al menos uno."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {productos.map(p => {
              const brandsCount = loadBrands(String(p.id)).length;
              const inicial = p.nombre?.charAt(0)?.toUpperCase() || 'P';
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveProductoId(String(p.id))}
                  className="text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-md transition group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-500 to-brand-500 flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition">
                      {inicial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {brandsCount > 0
                          ? `${brandsCount} marca${brandsCount !== 1 ? 's' : ''} de inspiración`
                          : 'Sin marcas de inspiración todavía'}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400 group-hover:text-amber-500 transition shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ====================================================================
  // VISTA 2: BRANDS DE INSPIRACIÓN DEL PRODUCTO
  // ====================================================================
  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Barra flotante cuando hay ads seleccionados — bulk action + opciones. */}
      {seleccionados.size > 0 && !bulkProgress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded-xl shadow-2xl px-4 py-3 flex flex-wrap items-center gap-3 max-w-[calc(100vw-3rem)]">
          <div className="text-xs">
            <span className="font-bold text-gray-900 dark:text-gray-100">{seleccionados.size}</span>
            <span className="text-gray-500 dark:text-gray-400"> / {MAX_SELECCIONADOS} ads</span>
          </div>

          {/* Selector de variaciones — el user puede elegir entre 1, 2, 4 o 6.
              Con accentColor + n>=2, el backend alterna prompts (reference +
              rebrand). Con n=1 sale solo la variante "reference". */}
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-500 dark:text-gray-400">Var:</span>
            {[1, 2, 4, 6].map(n => (
              <button key={n}
                onClick={() => setGenOpts(o => ({ ...o, n }))}
                className={`px-2 py-0.5 rounded font-bold transition ${
                  (genOpts.n || 2) === n
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >{n}</button>
            ))}
          </div>

          {/* Selector de aspect ratio */}
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-500 dark:text-gray-400">Ratio:</span>
            {[
              { v: '1024x1024', label: '1:1' },
              { v: '1024x1536', label: 'Portrait' },
              { v: '2048x2048', label: '1:1 2K (4×$)' },
            ].map(opt => (
              <button key={opt.v}
                onClick={() => setGenOpts(o => ({ ...o, size: opt.v }))}
                className={`px-2 py-0.5 rounded font-bold transition ${
                  genOpts.size === opt.v
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >{opt.label}</button>
            ))}
          </div>

          <button onClick={limpiarSeleccion}
            className="text-[11px] text-gray-500 hover:text-red-500 transition">
            Limpiar
          </button>
          <button onClick={handleBulkCrear}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-700 hover:to-brand-600 transition">
            <Sparkles size={13} /> Generar {seleccionados.size * (genOpts.n || 2)} creativos
          </button>
        </div>
      )}

      {/* Barra de progreso del bulk — reemplaza a la barra de seleccionados
          mientras está corriendo. Muestra current ad, % total, ETA y pills
          por cada ad para ver qué está pendiente/listo/fallado. */}
      {bulkProgress && (
        <BulkProgressBar
          state={bulkProgress}
          onClose={cerrarBulkProgress}
        />
      )}

      {/* Galería pasó a ser su propio tab en el workspace — sin modal acá. */}

      {/* Header thin (Linear-style 36px) — solo cuando NO está embebido.
          Single line breadcrumb back. Las acciones primarias (Galería, +Marca)
          viven en la toolbar de abajo para evitar duplicar UI. */}
      {!embedded && (
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setActiveProductoId(null)}
            className="inline-flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition"
            title="Volver al selector"
          >
            <ChevronRight size={12} className="rotate-180" />
            <span className="font-semibold">Inspiración</span>
          </button>
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span className="font-bold text-gray-900 dark:text-gray-100 truncate">{producto.nombre}</span>
        </div>
      )}

      {/* Form de agregar marca */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Nueva marca de inspiración</p>
            <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600 transition">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Nombre *</label>
              <input
                type="text" value={draft.nombre}
                onChange={e => setDraft(d => ({ ...d, nombre: e.target.value }))}
                placeholder="Ej: Liquid Death, Glossier, Olipop…"
                className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Landing URL</label>
              <input
                type="text" value={draft.landingUrl}
                onChange={e => setDraft(d => ({ ...d, landingUrl: e.target.value }))}
                placeholder="https://liquiddeath.com"
                className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">FB Page URL (opcional, mejor scraping)</label>
              <input
                type="text" value={draft.fbPageUrl}
                onChange={e => setDraft(d => ({ ...d, fbPageUrl: e.target.value }))}
                placeholder="https://facebook.com/liquiddeath"
                className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Por qué te inspira (opcional)</label>
              <input
                type="text" value={draft.notas}
                onChange={e => setDraft(d => ({ ...d, notas: e.target.value }))}
                placeholder="Ej: Branding rebelde, paleta inversa, copy con doble sentido…"
                className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded transition hover:bg-gray-50">
              Cancelar
            </button>
            <button onClick={handleAddBrand}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded hover:from-amber-600 hover:to-brand-600 transition">
              Agregar
            </button>
          </div>
        </div>
      )}

      {/* Unificamos competidores (auto) + brands manuales en una sola lista
          aplicando los filtros de la barra de vistas. */}
      {(() => {
        // Construimos array unificado.
        const competidoresUnif = (producto.competidores || []).map(c => {
          const staticAds = (c.ads || []).filter(a => (a.imageUrls?.length || 0) > 0 && (a.videoUrls?.length || 0) === 0);
          return {
            id: `comp-${c.id}`,
            nombre: c.nombre,
            landingUrl: c.landingUrl,
            fbPageUrl: c.fbPageUrl,
            lastScraped: c.lastAdsCheck,
            seenAdIds: c._inspirationSeenIds || [],
            isCompetidor: true,
            __ads: staticAds,
            __sourceComp: c,
          };
        });
        // Antes filtrábamos competidores SIN ads — eso los ocultaba en Inspiración
        // y obligaba a ir a Setup primero. Ahora aparecen siempre con un card
        // vacío y botón "Scrapear ads ahora" — más directo.
        const customUnif = brands.map(b => ({
          ...b,
          isCompetidor: false,
          __ads: adsByBrand[b.id] || [],
        }));
        // Dedup competidor vs brand-from-comp: si una brand vino del competidor
        // (fromCompetidorId), o su host/nombre coincide con un competidor,
        // ocultamos la versión "custom" — la COMP tiene los datos sincronizados
        // con producto.competidores (lastAdsCheck, ads cache, etc.) y es la
        // que el user ve scrapeada cuando aprieta Scrape en cualquiera.
        const compHosts = new Set();
        const compNombres = new Set();
        const compIds = new Set();
        for (const c of competidoresUnif) {
          const host = (c.landingUrl || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
          if (host) compHosts.add(host);
          const n = (c.nombre || '').toLowerCase().trim();
          if (n) compNombres.add(n);
          if (c.__sourceComp?.id != null) compIds.add(String(c.__sourceComp.id));
        }
        const customDeduped = customUnif.filter(b => {
          if (b.fromCompetidorId && compIds.has(String(b.fromCompetidorId))) return false;
          const host = (b.landingUrl || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
          if (host && compHosts.has(host)) return false;
          const n = (b.nombre || '').toLowerCase().trim();
          if (n && compNombres.has(n)) return false;
          return true;
        });
        let unif = [...competidoresUnif, ...customDeduped];

        // Filtros
        if (tipoFiltro === 'competidor') unif = unif.filter(b => b.isCompetidor);
        else if (tipoFiltro === 'custom') unif = unif.filter(b => !b.isCompetidor);
        if (estadoFiltro === 'con-ads') unif = unif.filter(b => b.__ads.length > 0);
        else if (estadoFiltro === 'sin-scrapear') unif = unif.filter(b => !b.lastScraped && b.__ads.length === 0);
        if (query.trim()) {
          const q = query.toLowerCase();
          unif = unif.filter(b => `${b.nombre} ${b.landingUrl || ''} ${b.notas || ''}`.toLowerCase().includes(q));
        }

        // Ordenamiento
        unif = [...unif].sort((a, b) => {
          if (orderBy === 'nombre') return (a.nombre || '').localeCompare(b.nombre || '');
          if (orderBy === 'ads-count') return (b.__ads?.length || 0) - (a.__ads?.length || 0);
          // default 'reciente': lastScraped desc, sin scrape al final
          const aT = a.lastScraped ? new Date(a.lastScraped).getTime() : 0;
          const bT = b.lastScraped ? new Date(b.lastScraped).getTime() : 0;
          return bT - aT;
        });

        // ====================================================================
        // TOP 10 ESCALADOS — agregamos ads de TODAS las brands (competidores
        // y custom), filtramos estáticos, ordenamos por score desc.
        // El score ya considera daysRunning + variantes + multiplatform +
        // pageLikeCount + penalty pause early (ver _apify.js scoreAd).
        // ====================================================================
        const allAdsForRanking = [];
        unif.forEach(b => {
          (b.__ads || []).forEach(ad => {
            // Solo ads con imagen + score conocido (ya pasaron por scoreAd).
            if ((ad.imageUrls?.length || 0) === 0) return;
            if (typeof ad.score !== 'number') return;
            allAdsForRanking.push({ ad, brandNombre: b.nombre, isCompetidor: b.isCompetidor });
          });
        });
        const topEscalados = allAdsForRanking
          .sort((a, b) => (b.ad.score || 0) - (a.ad.score || 0))
          .slice(0, 10);

        return (
          <div className="space-y-4">
            {/* Top 10 escalados — solo aparece si hay 3+ ads para rankear. */}
            {topEscalados.length >= 3 && (
              <TopEscaladosBar
                items={topEscalados}
                adaptingAdIds={adaptingAdIds}
                creandoAdIds={creandoAdIds}
                seleccionados={seleccionados}
                selectedOrder={selectedOrder}
                usedAdIds={usedAdIds}
                progressById={progressById}
                onAdapt={(brandNombre, ad) => handleAdapt(brandNombre, ad)}
                onCrearReferencial={(brandNombre, ad) => crearReferencialDeAd(brandNombre, ad)}
                onToggleSelect={(adId) => toggleSeleccion(adId)}
              />
            )}

            {/* Toolbar consolidada (Stripe/Linear) — search + filtros + counter + acciones
                en una sola línea. Reemplaza la antigua barra de filtros + los botones
                Galería/Agregar marca del header. Densidad alta. */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text" value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar marca, URL, notas…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}
                className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">
                <option value="all">Todos</option>
                <option value="competidor">Competidores</option>
                <option value="custom">Custom</option>
              </select>
              <select value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}
                className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">
                <option value="all">Todos</option>
                <option value="con-ads">Con ads</option>
                <option value="sin-scrapear">Sin scrapear</option>
              </select>
              <select value={orderBy} onChange={e => setOrderBy(e.target.value)}
                className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">
                <option value="reciente">Reciente</option>
                <option value="ads-count">Más ads</option>
                <option value="nombre">Nombre</option>
              </select>
              <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400 px-1">
                {unif.length}
              </span>
              {/* Separador visual + acciones primarias */}
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" aria-hidden />
              {/* Opciones de generación — popover con variantes/ratio/quality.
                  Antes solo se veían en la barra de bulk; ahora siempre accesibles. */}
              <div className="relative">
                <button
                  onClick={() => setShowGenOpts(s => !s)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                  title={`Opciones de generación · ${genOpts.n || 2} var · ${genOpts.size === '1024x1536' ? 'Portrait' : '1:1'} · ${genOpts.quality}`}
                >
                  <Settings2 size={11} /> {genOpts.n || 2}v · {genOpts.size === '1024x1536' ? '9:16' : '1:1'} · {genOpts.quality === 'low' ? 'L' : genOpts.quality === 'medium' ? 'M' : 'H'}
                </button>
                {showGenOpts && (
                  <div className="absolute top-full right-0 mt-1.5 z-40 w-64 bg-white dark:bg-gray-800 border-2 border-brand-300 dark:border-brand-700 rounded-lg shadow-2xl p-3"
                    onMouseLeave={() => setShowGenOpts(false)}
                  >
                    <p className="text-[10px] font-bold text-gray-900 dark:text-gray-100 mb-1.5">Opciones para crear creativos</p>

                    <div className="mb-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Variantes por ad</p>
                      <div className="flex items-center gap-1">
                        {[1, 2, 4, 6].map(n => (
                          <button key={n}
                            onClick={() => setGenOpts(o => ({ ...o, n }))}
                            className={`flex-1 px-2 py-1 text-[11px] font-bold rounded transition ${
                              (genOpts.n || 2) === n
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >{n}</button>
                        ))}
                      </div>
                      {/* Explicación dinámica de qué saca cada cantidad de variantes.
                          Quita la pregunta "qué hace cada N" antes de generar y
                          ayuda a entender por qué con 1-2 sale "fiel" y con 4+
                          empieza a inventar escenarios nuevos respetando el
                          ángulo de venta. */}
                      <p className="text-[9px] text-gray-600 dark:text-gray-400 mt-1 leading-snug">
                        {(genOpts.n || 2) === 1 && (
                          <><strong className="text-gray-800 dark:text-gray-200">Tight:</strong> réplica fiel del ad ganador. Misma composición y escena, solo cambia el producto.</>
                        )}
                        {(genOpts.n || 2) === 2 && (
                          <><strong className="text-gray-800 dark:text-gray-200">Tight + Rebrand:</strong> #1 réplica fiel · #2 misma composición pero con la paleta de tu marca dominando la escena.</>
                        )}
                        {(genOpts.n || 2) === 4 && (
                          <><strong className="text-gray-800 dark:text-gray-200">Tight → Medium → Loose → Rebrand:</strong> #1 fiel · #2 mismo concepto distinto modelo/ángulo · #3 escena <em>nueva inventada</em> manteniendo el ángulo de venta · #4 paleta de marca.</>
                        )}
                        {(genOpts.n || 2) === 6 && (
                          <><strong className="text-gray-800 dark:text-gray-200">Mix amplio:</strong> #1 fiel · #2 medium · #3-5 escenas <em>nuevas inventadas</em> que comunican el mismo ángulo (cambia escenario, props, plano) · #6 paleta de marca.</>
                        )}
                      </p>
                    </div>

                    <div className="mb-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Tamaño</p>
                      <div className="flex items-center gap-1">
                        {[
                          { v: '1024x1024', label: '1:1 (feed)' },
                          { v: '1024x1536', label: 'Portrait (story)' },
                          { v: '2048x2048', label: '2K (4× costo)' },
                        ].map(opt => (
                          <button key={opt.v}
                            onClick={() => setGenOpts(o => ({ ...o, size: opt.v }))}
                            className={`flex-1 px-2 py-1 text-[10px] font-bold rounded transition ${
                              genOpts.size === opt.v
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >{opt.label}</button>
                        ))}
                      </div>
                    </div>

                    <div className="mb-1">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Calidad</p>
                      <div className="flex items-center gap-1">
                        {[
                          { v: 'low',    label: 'Low'    },
                          { v: 'medium', label: 'Medium' },
                          { v: 'high',   label: 'High'   },
                        ].map(opt => {
                          const cost = costPerImage(opt.v, genOpts.size);
                          return (
                          <button key={opt.v}
                            onClick={() => setGenOpts(o => ({ ...o, quality: opt.v }))}
                            className={`flex-1 px-1 py-1 text-[10px] font-bold rounded transition ${
                              genOpts.quality === opt.v
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                            title={`$${cost.toFixed(3)} por imagen a ${genOpts.size}`}
                          >{opt.label}<br /><span className="text-[8px] opacity-70 font-normal">${cost.toFixed(3)}</span></button>
                          );
                        })}
                      </div>
                    </div>

                    <p className="mt-2 text-[9px] text-gray-500 dark:text-gray-400 italic">
                      Aplica tanto a "Crear creativo" individual como al bulk. Costo por ad: ~${((genOpts.n || 2) * costPerImage(genOpts.quality, genOpts.size)).toFixed(2)} ({genOpts.size} {genOpts.quality}).
                    </p>
                  </div>
                )}
              </div>
              {/* Scrape todas (smart) — saltea marcas scrapeadas hace <24h y
                  las que devolvieron 0 nuevos 3 veces seguidas (estables).
                  Ahorra cuota de Apify. Para forzar todo igual, ver botón
                  "Forzar" al lado. */}
              {(() => {
                const STALE_HOURS = 24;
                const STABLE_THRESHOLD = 3;
                const isStaleEnough = (b) => {
                  if (!b.lastScraped) return true;
                  const t = new Date(b.lastScraped).getTime();
                  // Date inválido → tratar como stale para no quedar "cacheado para siempre"
                  if (!Number.isFinite(t)) return true;
                  return Date.now() - t > STALE_HOURS * 3600 * 1000;
                };
                const isStable = (b) => {
                  const z = b.isCompetidor
                    ? (b.__sourceComp?.consecutiveZeroAds || 0)
                    : (b.consecutiveZeroAds || 0);
                  return z >= STABLE_THRESHOLD;
                };
                const isScrapeable = (b) => b.fbPageUrl || b.landingUrl || isKeywordUsable(b.nombre);

                const eligibles = unif.filter(isScrapeable);
                const smartEligibles = eligibles.filter(b => isStaleEnough(b) && !isStable(b));
                const skippedByCache = eligibles.length - smartEligibles.length;

                const fireScrape = (b) => b.isCompetidor ? handleScrapeCompetidor(b) : handleScrapeBrand(b);

                const onSmart = () => {
                  if (smartEligibles.length === 0) {
                    addToast?.({
                      type: 'info',
                      message: skippedByCache > 0
                        ? `${skippedByCache} marcas ya frescas (<${STALE_HOURS}h) o estables. Usá "Forzar" para re-scrapearlas.`
                        : 'Ninguna marca tiene fbPage/landing/keyword utilizable.',
                    });
                    return;
                  }
                  addToast?.({
                    type: 'info',
                    message: `Scrape de ${smartEligibles.length} marcas (de a ${SCRAPE_CONCURRENCY})${skippedByCache > 0 ? ` · ${skippedByCache} salteadas por cache` : ''}.`,
                  });
                  runScrapePool(smartEligibles, SCRAPE_CONCURRENCY, fireScrape);
                };
                const onForce = () => {
                  if (eligibles.length === 0) {
                    addToast?.({ type: 'error', message: 'Ninguna marca del listado tiene fbPage/landing/keyword utilizable.' });
                    return;
                  }
                  addToast?.({ type: 'info', message: `Forzando scrape de ${eligibles.length} marcas (de a ${SCRAPE_CONCURRENCY}, ignorando cache).` });
                  runScrapePool(eligibles, SCRAPE_CONCURRENCY, fireScrape);
                };

                return (
                  <>
                    <button
                      disabled={scrapingBrandIds.size > 0 || smartEligibles.length === 0}
                      onClick={onSmart}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-purple-500 to-pink-500 rounded hover:from-purple-600 hover:to-pink-600 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Scrapea solo marcas no scrapeadas en las últimas ${STALE_HOURS}h y que no son estables (${STABLE_THRESHOLD}+ scrapes sin novedad).${skippedByCache > 0 ? ` ${skippedByCache} saltadas por cache.` : ''}`}
                    >
                      {scrapingBrandIds.size > 0
                        ? <><Loader2 size={11} className="animate-spin" /> Scrapeando {scrapingBrandIds.size}…</>
                        : <><Download size={11} /> Scrape nuevas ({smartEligibles.length})</>}
                    </button>
                    <button
                      disabled={scrapingBrandIds.size > 0 || eligibles.length === 0}
                      onClick={onForce}
                      className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-white dark:bg-gray-800 border border-purple-300 dark:border-purple-700 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Re-scrapea TODAS las marcas ignorando cache de 24h y estables. Gasta más cuota de Apify."
                    >
                      {scrapingBrandIds.size > 0
                        ? <><Loader2 size={11} className="animate-spin" /> En curso…</>
                        : <><RefreshCw size={11} /> Forzar todas</>}
                    </button>
                  </>
                );
              })()}
              {/* Para agregar una marca nueva el flujo va por Competencia
                  (single source of truth). Las marcas que aparecen acá son
                  derivadas de producto.competidores via el useEffect de sync. */}
              <button
                onClick={() => {
                  try { window.dispatchEvent(new CustomEvent('viora:product-tab', { detail: { tab: 'setup' } })); } catch {}
                  addToast?.({ type: 'info', message: 'Cargá la marca como competidor — va a aparecer acá automático.' });
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded hover:from-amber-600 hover:to-brand-600 shadow-sm transition"
                title="Las marcas se agregan desde Competencia. Click para ir."
              >
                <Plus size={11} /> Marca (en Competencia)
              </button>
            </div>

            {/* Grilla unificada */}
            {unif.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Ninguna marca coincide con el filtro"
                description="Probá ajustar los filtros o agregá marcas custom con el botón de arriba."
                primaryAction={{
                  label: 'Agregar competidor',
                  icon: Plus,
                  onClick: () => {
                    try { window.dispatchEvent(new CustomEvent('viora:product-tab', { detail: { tab: 'setup' } })); } catch {}
                    addToast?.({ type: 'info', message: 'Cargalo como competidor — va a aparecer acá automático.' });
                  },
                }}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {unif.map(b => (
                  <BrandCard
                    key={b.id}
                    brand={b}
                    ads={b.__ads}
                    isScraping={scrapingBrandIds.has(b.id)}
                    adaptingAdIds={adaptingAdIds}
                    creandoAdIds={creandoAdIds}
                    seleccionados={seleccionados}
                    selectedOrder={selectedOrder}
                    usedAdIds={usedAdIds}
                    progressById={progressById}
                    onScrape={() => b.isCompetidor ? handleScrapeCompetidor(b) : handleScrapeBrand(b)}
                    onAdapt={(ad) => handleAdapt(b.nombre, ad)}
                    onCrearReferencial={(ad) => crearReferencialDeAd(b.nombre, ad)}
                    onToggleSelect={(adId) => toggleSeleccion(adId)}
                    onRemove={b.isCompetidor ? null : () => handleRemoveBrand(b.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

