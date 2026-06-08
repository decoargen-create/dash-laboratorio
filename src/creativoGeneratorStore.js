// Store global para queue de generación de creativos desde Bandeja
// (idea → /api/marketing/generate-creative → IDB + galería).
//
// Por qué store global y no estado local en CreativoPanel:
// - Background execution: el user puede navegar a otra sección/tab y la
//   generación sigue corriendo. ExecutionsTray muestra el progreso.
// - Multi-select: el user puede mandar 5 ideas a generar y todas
//   comparten una cola sequential (concurrency=1 para no congestionar
//   la cuenta OpenAI).
// - State recovery: si el user vuelve al panel de una idea cuya
//   generación está corriendo, el panel se entera del estado actual.
//
// API:
//   enqueueGenerate(idea, { quality })          → encola y devuelve {execId, promise}
//   getStatus(ideaId) → 'pending'|'running'|'done'|'error' | null
//   subscribe(fn)     → unsubscribe; recibe (event) con detalles del cambio
//                       event: {type, ideaId, status, error?}

import { startExecution, updateExecution, finishExecution } from './executionsStore.js';
import { saveCreativo } from './creativosStorage.js';
import { supabase } from './supabase.js';
import { saveReferencial } from './galeriaReferenciales.js';
import { logCostsFromResponse } from './costsStore.js';
import { playDoneChime, playErrorTone, playBulkDoneChime } from './sounds.js';

const QUEUE = []; // ideas pending: {idea, opts, execId, resolve, reject}
const STATUS = new Map(); // ideaId → 'pending'|'running'|'done'|'error'
const ERRORS = new Map(); // ideaId → string
const RESULTS = new Map(); // ideaId → creativo guardado
let processing = false;
let activeBulkCount = 0; // counter de generaciones encoladas en este "lote"
const listeners = new Set();

function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch {}
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getStatus(ideaId) {
  return STATUS.get(ideaId) || null;
}
export function getError(ideaId) {
  return ERRORS.get(ideaId) || null;
}
export function getResult(ideaId) {
  return RESULTS.get(ideaId) || null;
}

// Encola una idea para generar. Si ya hay procesamiento en curso, se
// agrega al final de la cola. Devuelve {execId, promise}.
export function enqueueGenerate(idea, opts = {}) {
  const quality = opts.quality || 'medium';
  const productoId = opts.productoId || null;
  const estimatedCost = (quality === 'low' ? 0.013 : quality === 'medium' ? 0.046 : 0.180);
  const execId = startExecution({
    label: `Generando creativo: ${(idea.titulo || idea.hook || '').slice(0, 50)}`,
    sublabel: `gpt-image-2 · ${quality}`,
    kind: 'creative',
    estimatedMs: 70000,
    estimatedCost,
  });

  STATUS.set(idea.id, 'pending');
  ERRORS.delete(idea.id);
  emit({ type: 'enqueued', ideaId: idea.id, status: 'pending' });
  activeBulkCount++;

  let resolveFn, rejectFn;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve; rejectFn = reject;
  });
  QUEUE.push({ idea, opts: { ...opts, quality }, execId, resolve: resolveFn, reject: rejectFn, productoId });

  // Arrancar el worker si no está procesando.
  if (!processing) processNext();
  return { execId, promise };
}

async function processNext() {
  if (processing) return;
  const task = QUEUE.shift();
  if (!task) {
    // Cola vacía. Si veníamos de un bulk de varios, chime triunfal.
    if (activeBulkCount >= 2) playBulkDoneChime();
    activeBulkCount = 0;
    return;
  }
  processing = true;
  const { idea, opts, execId, resolve, reject } = task;
  STATUS.set(idea.id, 'running');
  emit({ type: 'started', ideaId: idea.id, status: 'running' });
  updateExecution(execId, { stage: 'Llamando a gpt-image-2…' });

  try {
    // Authorization header con el token de Supabase — para que el backend
    // pueda guardar el creativo al cloud (Storage + DB) en background.
    let authToken = '';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      authToken = session?.access_token || '';
    } catch {}

    const resp = await fetch('/api/marketing/generate-creative', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        quality: opts.quality,
        productoId: opts.productoId || null,
        idea: {
          id: idea.id,
          promptGeneradorImagen: idea.promptGeneradorImagen,
          descripcionImagen: idea.descripcionImagen,
          textoEnImagen: idea.textoEnImagen,
          hook: idea.hook,
          titulo: idea.titulo,
          formato: idea.formato,
          estiloVisual: idea.estiloVisual,
          copyPostMeta: idea.copyPostMeta || idea.copy,
        },
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    const cost = logCostsFromResponse(data, `generate-creative · ${(idea.titulo || idea.hook || '').slice(0, 50)}`);

    const nuevo = {
      imageBase64: data.imageBase64,
      mimeType: data.mimeType || 'image/png',
      formato: data.formato || idea.formato || 'static',
      size: data.size,
      quality: data.quality,
      model: data.model,
      generatedAt: data.generatedAt,
    };
    await saveCreativo(idea.id, nuevo);

    // Si el backend NO guardó al cloud (sin auth o sin Storage), fallback
    // al save local. Si sí guardó, skipeamos — la galería ya tiene el
    // creativo via marketing_creativos y se va a refrescar al abrir.
    if (!data.cloudCreativo && opts.productoId) {
      try {
        await saveReferencial({
          id: `from-bandeja-${idea.id}-${Date.now()}`,
          productoId: String(opts.productoId),
          sourceAdId: `bandeja-${idea.id}`,
          sourceBrand: 'Bandeja',
          sourceType: 'bandeja-idea',
          sourceHeadline: idea.titulo || idea.hook || '',
          variantStyle: 'bandeja',
          imageBase64: data.imageBase64,
          mimeType: data.mimeType || 'image/png',
          size: data.size,
          quality: data.quality,
          model: data.model,
          createdAt: data.generatedAt || new Date().toISOString(),
        });
      } catch (err) {
        console.warn('[creativoGenerator] no pude guardar a galería:', err.message);
      }
    }

    RESULTS.set(idea.id, nuevo);
    STATUS.set(idea.id, 'done');
    finishExecution(execId, { ok: true, message: 'Creativo listo', cost: cost?.total });
    emit({ type: 'finished', ideaId: idea.id, status: 'done', creativo: nuevo });
    playDoneChime();
    resolve(nuevo);
  } catch (err) {
    const msg = err?.message || 'Error generando';
    STATUS.set(idea.id, 'error');
    ERRORS.set(idea.id, msg);
    finishExecution(execId, { ok: false, message: msg });
    emit({ type: 'error', ideaId: idea.id, status: 'error', error: msg });
    playErrorTone();
    reject(err);
  } finally {
    processing = false;
    // Pequeña pausa entre tareas para no congestionar OpenAI.
    setTimeout(() => processNext(), 500);
  }
}

// Limpia status/error/result de una idea (para "Regenerar" después de error).
export function resetIdea(ideaId) {
  STATUS.delete(ideaId);
  ERRORS.delete(ideaId);
  RESULTS.delete(ideaId);
  emit({ type: 'reset', ideaId });
}

// Cuántas ideas hay en la cola (incluyendo la que se está procesando).
export function pendingCount() {
  return QUEUE.length + (processing ? 1 : 0);
}
