// Módulo "Guiones IA" — transcripción y adaptación de video ads de la
// competencia.
//
// Flujo: el user asigna el producto (viene forzado desde el workspace),
// sube N videos de ads validados de la competencia → por cada uno:
//   1. SUBIR       → bucket 'creativos' path `<user_id>/transcripcion/<id>.<ext>`
//   2. TRANSCRIBIR → /api/marketing/transcribir-video (Whisper, idioma auto)
//   3. ADAPTAR     → /api/marketing/adaptar-guion-video (Claude: traducción
//                    fiel + guion rioplatense con avatar/oferta del producto
//                    + 3 hooks para testear + notas para el editor)
//
// Persistencia: producto.transcripcionesVideos[] (viaja con el sync de
// productos existente — localStorage + push a marketing_productos). Los
// videos quedan en el bucket; acá solo guardamos texto + storagePath.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Clapperboard, Upload, Loader2, Check, X, Copy, Trash2, RefreshCw,
  ChevronDown, AlertTriangle, FileText, Languages, Wand2, Lightbulb,
  ScrollText, Film, CheckSquare, Square, BadgeCheck, Undo2,
} from 'lucide-react';
import { supabase, getCurrentUser } from './supabase.js';
import { notifyMarketingChange } from './useMarketingSync.js';
import { parseJsonOrThrow } from './apiHelpers.js';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const BUCKET = 'creativos';
const MAX_MB = 24; // límite de Whisper (25MB) con buffer
const CONCURRENCY = 2;

function loadProductos() {
  try { return JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]'); } catch { return []; }
}

async function getAuthToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
}

// Contexto del producto que viaja a la adaptación — mismos fallbacks que usa
// el resto del código (docs.* como fuente secundaria).
function buildProductoCtx(p) {
  return {
    nombre: p?.nombre || '',
    descripcion: p?.descripcion || '',
    research: p?.research || p?.docs?.research || '',
    avatar: p?.avatar || p?.docs?.avatar || '',
    stage: p?.stage || '',
    ofertasReales: (p?.ofertasReales || p?.offerBrief || p?.docs?.offerBrief || '').toString(),
  };
}

// Serializa un guion listo a Markdown — el "paquete" que recibe el editor:
// guion + hooks alternativos + notas de producción. La transcripción cruda
// NO va (al editor no le sirve y mete ruido).
function guionToMd(item, productoNombre) {
  const lines = [];
  lines.push(`# Guion — ${productoNombre}`);
  lines.push(`Fuente: ${item.nombre}${item.durationSec ? ` · ${Math.round(item.durationSec)}s` : ''}${item.idioma ? ` · original en ${item.idioma}` : ''}`);
  if (item.estructuraDetectada) lines.push(`Fórmula: ${item.estructuraDetectada}`);
  lines.push('');
  lines.push('## GUION (rioplatense — leer en voz alta)');
  lines.push(item.guion || '');
  if (Array.isArray(item.hooksAlternativos) && item.hooksAlternativos.length) {
    lines.push('');
    lines.push('## HOOKS ALTERNATIVOS (para testear — reemplazan solo la apertura)');
    item.hooksAlternativos.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
  }
  if (item.notasEditor) {
    lines.push('');
    lines.push('## NOTAS PARA EL EDITOR');
    lines.push(item.notasEditor);
  }
  return lines.join('\n');
}

function slugFile(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'guion';
}

const STATUS_LABEL = {
  subiendo: 'Subiendo video…',
  transcribiendo: 'Transcribiendo (Whisper)…',
  adaptando: 'Adaptando guion (Claude)…',
  listo: 'Listo',
  error: 'Error',
};

function StatusChip({ status, error }) {
  if (status === 'listo') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><Check size={10} /> Listo</span>;
  }
  if (status === 'error') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800" title={error || ''}><AlertTriangle size={10} /> Error</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800"><Loader2 size={10} className="animate-spin" /> {STATUS_LABEL[status] || status}</span>;
}

// Bloque de texto expandible con botón copiar.
function TextBlock({ icon, title, text, addToast }) {
  if (!text) return null;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(text);
      addToast?.({ type: 'success', message: `${title} copiado` });
    } catch {
      addToast?.({ type: 'error', message: 'No pude copiar — seleccioná el texto a mano' });
    }
  };
  return (
    <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{icon} {title}</p>
        <button onClick={copiar} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 transition" title={`Copiar ${title.toLowerCase()}`}>
          <Copy size={11} /> Copiar
        </button>
      </div>
      <p className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  );
}

export default function TranscripcionVideosSection({ addToast, forcedProductoId, embedded = false }) {
  const [producto, setProducto] = useState(() =>
    loadProductos().find(p => String(p.id) === String(forcedProductoId)) || null
  );
  const [items, setItems] = useState(() => producto?.transcripcionesVideos || []);
  const [expandedId, setExpandedId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  // Selección múltiple para acciones masivas (copiar / ZIP / marcar usados).
  const [seleccionados, setSeleccionados] = useState(() => new Set());
  // Filtro de vista: cuál se usó ya y cuál no (para no pisarse en el equipo).
  const [filtroUso, setFiltroUso] = useState('todos'); // 'todos' | 'sin-usar' | 'usados'
  const fileInputRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Re-leer producto cuando el sync actualiza localStorage (pull cloud, otra tab).
  useEffect(() => {
    const reload = () => {
      const fresh = loadProductos().find(p => String(p.id) === String(forcedProductoId)) || null;
      if (!mountedRef.current) return;
      setProducto(fresh);
      setItems(prev => {
        const cloudItems = fresh?.transcripcionesVideos || [];
        // No pisar items en curso (subiendo/transcribiendo/adaptando) con la
        // versión persistida — el estado transitorio vive en memoria.
        const inFlight = new Map(prev.filter(i => !['listo', 'error'].includes(i.status)).map(i => [i.id, i]));
        return cloudItems.map(i => inFlight.get(i.id) || i).concat(
          [...inFlight.values()].filter(i => !cloudItems.some(c => c.id === i.id))
        );
      });
    };
    window.addEventListener('viora:marketing-storage-changed', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('viora:marketing-storage-changed', reload);
      window.removeEventListener('storage', reload);
    };
  }, [forcedProductoId]);

  // Persiste el array de transcripciones dentro del producto (y notifica al
  // sync para que pushee al cloud). updater recibe el array actual y devuelve
  // el nuevo. También actualiza el state local.
  const persistItems = useCallback((updater) => {
    const productos = loadProductos();
    let nextItems = null;
    const updated = productos.map(p => {
      if (String(p.id) !== String(forcedProductoId)) return p;
      const current = Array.isArray(p.transcripcionesVideos) ? p.transcripcionesVideos : [];
      nextItems = updater(current);
      return { ...p, transcripcionesVideos: nextItems, updated_at: new Date().toISOString() };
    });
    try {
      localStorage.setItem(PRODUCTOS_KEY, JSON.stringify(updated));
      notifyMarketingChange(PRODUCTOS_KEY);
    } catch (e) {
      console.error('[guiones-ia] persist falló:', e);
    }
    if (nextItems && mountedRef.current) setItems(nextItems);
  }, [forcedProductoId]);

  // Patch de UN item por id (merge). Estados transitorios solo en memoria;
  // estados finales (listo/error y sus datos) se persisten.
  const patchItem = useCallback((id, patch, { persist = false } = {}) => {
    if (persist) {
      persistItems(curr => {
        const exists = curr.some(i => i.id === id);
        return exists
          ? curr.map(i => (i.id === id ? { ...i, ...patch } : i))
          : [...curr, patch.id ? patch : { id, ...patch }];
      });
    } else if (mountedRef.current) {
      setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
    }
  }, [persistItems]);

  // Pipeline de UN video: subir → transcribir → adaptar.
  const procesarVideo = useCallback(async (file, user) => {
    const id = `tv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
    const storagePath = `${user.id}/transcripcion/${id}.${ext}`;
    const baseItem = {
      id, nombre: file.name, storagePath, status: 'subiendo',
      createdAt: new Date().toISOString(), sizeMB: +(file.size / 1024 / 1024).toFixed(1),
    };
    if (mountedRef.current) setItems(prev => [baseItem, ...prev]);

    // Si Whisper ya corrió pero la adaptación falla, persistimos el transcript
    // igual — se pagó, y Re-adaptar puede retomarlo sin re-subir/re-transcribir.
    let transcriptData = null;
    try {
      // 1. SUBIR al bucket (directo del browser — sin pasar por Vercel, que
      //    tiene límite de body 4.5MB).
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
        contentType: file.type || 'video/mp4',
        upsert: true,
      });
      if (upErr) throw new Error(`Upload falló: ${upErr.message}`);

      // 2. TRANSCRIBIR
      patchItem(id, { status: 'transcribiendo' });
      const token = await getAuthToken();
      const tResp = await fetch('/api/marketing/transcribir-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ storagePath }),
      });
      const tData = await parseJsonOrThrow(tResp, 'transcribir-video');
      if (!tResp.ok || tData.error) throw new Error(tData.error || `HTTP ${tResp.status}`);
      if (!tData.transcript?.trim()) throw new Error('El video no tiene voz detectable (¿es solo música/texto?)');

      // 3. ADAPTAR
      transcriptData = { transcript: tData.transcript, idioma: tData.idioma, durationSec: tData.durationSec, costUSD: tData.costUSD || 0 };
      patchItem(id, { status: 'adaptando', ...transcriptData });
      const prodCtx = buildProductoCtx(loadProductos().find(p => String(p.id) === String(forcedProductoId)));
      const aResp = await fetch('/api/marketing/adaptar-guion-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ transcript: tData.transcript, idioma: tData.idioma, producto: prodCtx }),
      });
      const aData = await parseJsonOrThrow(aResp, 'adaptar-guion-video');
      if (!aResp.ok || aData.error) throw new Error(aData.error || `HTTP ${aResp.status}`);

      const final = {
        ...baseItem,
        status: 'listo',
        transcript: tData.transcript,
        idioma: tData.idioma,
        durationSec: tData.durationSec,
        traduccion: aData.traduccion,
        estructuraDetectada: aData.estructuraDetectada,
        guion: aData.guion,
        hooksAlternativos: aData.hooksAlternativos || [],
        notasEditor: aData.notasEditor,
        costUSD: +(((tData.costUSD || 0) + (aData.costUSD || 0)).toFixed(4)),
        finishedAt: new Date().toISOString(),
      };
      patchItem(id, final, { persist: true });
      if (mountedRef.current) setExpandedId(id);
      addToast?.({ type: 'success', message: `"${file.name}" listo — guion adaptado disponible` });
    } catch (err) {
      // Error también se persiste (con el transcript si llegó a existir) para
      // no perder lo pagado y poder Re-adaptar sin re-subir/re-transcribir.
      patchItem(id, { ...baseItem, ...(transcriptData || {}), status: 'error', error: err.message }, { persist: true });
      addToast?.({ type: 'error', message: `"${file.name}": ${err.message}` });
    }
  }, [patchItem, persistItems, forcedProductoId, addToast]);

  // Entrada de archivos (input o drop) con pool de concurrencia.
  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(f.name));
    if (files.length === 0) {
      addToast?.({ type: 'warning', message: 'Ningún archivo de video válido (mp4/mov/webm).' });
      return;
    }
    const user = await getCurrentUser();
    if (!user) {
      addToast?.({ type: 'error', message: 'Sesión vencida — recargá y volvé a entrar.' });
      return;
    }
    const validos = [];
    for (const f of files) {
      if (f.size > MAX_MB * 1024 * 1024) {
        addToast?.({ type: 'error', message: `"${f.name}" pesa ${(f.size / 1024 / 1024).toFixed(0)}MB — máximo ${MAX_MB}MB (comprimilo o recortalo).` });
      } else {
        validos.push(f);
      }
    }
    if (validos.length === 0) return;
    addToast?.({ type: 'info', message: `${validos.length} video${validos.length > 1 ? 's' : ''} en cola — transcribiendo de a ${CONCURRENCY}.` });
    let idx = 0;
    const worker = async () => {
      while (idx < validos.length) {
        const f = validos[idx++];
        await procesarVideo(f, user);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, validos.length) }, worker));
  }, [procesarVideo, addToast]);

  // Re-adaptar un item (research/oferta pudieron cambiar). No re-transcribe.
  const readaptar = useCallback(async (item) => {
    if (!item.transcript) {
      addToast?.({ type: 'error', message: 'Este item no tiene transcripción guardada — subí el video de nuevo.' });
      return;
    }
    patchItem(item.id, { status: 'adaptando' });
    try {
      const token = await getAuthToken();
      const prodCtx = buildProductoCtx(loadProductos().find(p => String(p.id) === String(forcedProductoId)));
      const resp = await fetch('/api/marketing/adaptar-guion-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ transcript: item.transcript, idioma: item.idioma, producto: prodCtx }),
      });
      const data = await parseJsonOrThrow(resp, 'adaptar-guion-video');
      if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
      patchItem(item.id, {
        status: 'listo', traduccion: data.traduccion, estructuraDetectada: data.estructuraDetectada,
        guion: data.guion, hooksAlternativos: data.hooksAlternativos || [], notasEditor: data.notasEditor,
        costUSD: +(((item.costUSD || 0) + (data.costUSD || 0)).toFixed(4)),
      }, { persist: true });
      addToast?.({ type: 'success', message: 'Guion re-adaptado con el research/oferta actuales' });
    } catch (err) {
      patchItem(item.id, { status: 'listo' }, { persist: true });
      addToast?.({ type: 'error', message: `Re-adaptación falló: ${err.message}` });
    }
  }, [patchItem, forcedProductoId, addToast]);

  const borrar = useCallback(async (item) => {
    if (!window.confirm(`¿Borrar "${item.nombre}" (transcripción + guion)?`)) return;
    // Bytes del bucket: best-effort, no bloquea.
    if (item.storagePath) {
      supabase.storage.from(BUCKET).remove([item.storagePath]).catch(() => {});
    }
    persistItems(curr => curr.filter(i => i.id !== item.id));
  }, [persistItems]);

  // ---- Acciones masivas ----
  const listos = useMemo(() => items.filter(i => i.status === 'listo' && i.guion), [items]);
  const itemsSel = useMemo(() => listos.filter(i => seleccionados.has(i.id)), [listos, seleccionados]);

  const toggleSel = useCallback((id) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelTodos = useCallback(() => {
    setSeleccionados(prev => prev.size === listos.length && listos.length > 0
      ? new Set()
      : new Set(listos.map(i => i.id)));
  }, [listos]);

  // Copiar N guiones al portapapeles, separados con encabezados claros.
  const copiarSeleccionados = useCallback(async () => {
    if (itemsSel.length === 0) return;
    const texto = itemsSel
      .map((it, i) => `${'='.repeat(60)}\nGUION ${i + 1} de ${itemsSel.length}\n${'='.repeat(60)}\n\n${guionToMd(it, producto?.nombre || '')}`)
      .join('\n\n\n');
    try {
      await navigator.clipboard.writeText(texto);
      addToast?.({ type: 'success', message: `${itemsSel.length} guion${itemsSel.length > 1 ? 'es' : ''} copiado${itemsSel.length > 1 ? 's' : ''} al portapapeles` });
    } catch {
      addToast?.({ type: 'error', message: 'No pude copiar — probá con la descarga ZIP' });
    }
  }, [itemsSel, producto, addToast]);

  // Word (.docx) formateado — un guion por página, con títulos y jerarquía.
  // Mucho más cómodo que texto plano para leer, imprimir y repartir entre
  // editores. Import dinámico de `docx` para no engordar el bundle inicial.
  const descargarDocx = useCallback(async () => {
    if (itemsSel.length === 0) return;
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = await import('docx');
      const MUTED = '6B7280', BRAND = '7C3AED', DARK = '111827', ACCENT = 'DB2777';
      const children = [];
      itemsSel.forEach((it, i) => {
        if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
        // Título del guion
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 80 },
          children: [new TextRun({ text: `Guion ${i + 1} — ${producto?.nombre || ''}`, bold: true, color: BRAND, size: 36 })],
        }));
        // Metadata
        const meta = [`Fuente: ${it.nombre}`, it.durationSec ? `${Math.round(it.durationSec)}s` : '', it.idioma ? `original en ${it.idioma}` : ''].filter(Boolean).join(' · ');
        children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: meta, italics: true, color: MUTED, size: 18 })] }));
        if (it.estructuraDetectada) {
          children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `Fórmula: ${it.estructuraDetectada}`, italics: true, color: MUTED, size: 18 })] }));
        }
        // GUION — el cuerpo principal, tipografía cómoda de leer en voz alta
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 },
          children: [new TextRun({ text: '🎙 GUION (leer en voz alta)', bold: true, color: DARK, size: 26 })],
        }));
        String(it.guion || '').split(/\n+/).filter(Boolean).forEach(parr => {
          children.push(new Paragraph({
            spacing: { after: 140, line: 320 },
            children: [new TextRun({ text: parr, size: 24, color: DARK })],
          }));
        });
        // Hooks alternativos
        if (Array.isArray(it.hooksAlternativos) && it.hooksAlternativos.length) {
          children.push(new Paragraph({
            heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: '🎣 Hooks alternativos (para testear)', bold: true, color: ACCENT, size: 26 })],
          }));
          it.hooksAlternativos.forEach((h, j) => {
            children.push(new Paragraph({
              spacing: { after: 100 },
              children: [
                new TextRun({ text: `${j + 1}.  `, bold: true, color: ACCENT, size: 22 }),
                new TextRun({ text: h, size: 22, color: DARK }),
              ],
            }));
          });
        }
        // Notas para el editor
        if (it.notasEditor) {
          children.push(new Paragraph({
            heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: '🎬 Notas para el editor', bold: true, color: DARK, size: 26 })],
          }));
          String(it.notasEditor).split(/\n+/).filter(Boolean).forEach(linea => {
            children.push(new Paragraph({
              spacing: { after: 80 },
              children: [new TextRun({ text: linea, size: 20, color: MUTED })],
            }));
          });
        }
      });
      const doc = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `guiones-${slugFile(producto?.nombre)}-${new Date().toISOString().slice(0, 10)}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      addToast?.({ type: 'success', message: `Word con ${itemsSel.length} guion${itemsSel.length > 1 ? 'es' : ''} descargado (uno por página)` });
    } catch (err) {
      addToast?.({ type: 'error', message: `Word falló: ${err.message}` });
    }
  }, [itemsSel, producto, addToast]);

  // Marca de uso — persiste, así el equipo ve qué guion ya se produjo y no
  // se pisan reutilizando el mismo.
  const marcarUsados = useCallback((ids, usado) => {
    const idSet = new Set(ids);
    persistItems(curr => curr.map(i => idSet.has(i.id)
      ? { ...i, usado, usadoAt: usado ? new Date().toISOString() : null }
      : i));
    if (usado) setSeleccionados(new Set());
    addToast?.({ type: 'success', message: `${ids.length} guion${ids.length > 1 ? 'es' : ''} marcado${ids.length > 1 ? 's' : ''} como ${usado ? 'usado' : 'sin usar'}` });
  }, [persistItems, addToast]);

  const itemsVisibles = useMemo(() => {
    if (filtroUso === 'sin-usar') return items.filter(i => !i.usado);
    if (filtroUso === 'usados') return items.filter(i => i.usado);
    return items;
  }, [items, filtroUso]);

  const countUsados = items.filter(i => i.usado).length;

  const hasResearch = !!(producto?.research || producto?.docs?.research);

  if (!producto) {
    return (
      <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Producto no encontrado — volvé a la lista y entrá de nuevo.
      </div>
    );
  }

  return (
    <div className={embedded ? 'px-4 py-4 space-y-4' : 'max-w-5xl mx-auto p-6 space-y-4'}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-brand-500 flex items-center justify-center text-white shrink-0">
          <Clapperboard size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Guiones IA — transcripción y adaptación de videos</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Subí videos de ads <strong>validados</strong> de la competencia. Por cada uno: transcripción → traducción → guion nuevo en rioplatense con el avatar, dolores y oferta de <strong>{producto.nombre}</strong> — listo para tus editores.
          </p>
        </div>
      </div>

      {!hasResearch && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Este producto no tiene research doc todavía — el guion va a salir menos anclado al avatar. Corré el pipeline en Setup primero para mejores resultados.</span>
        </div>
      )}

      {/* Dropzone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition ${
          dragOver
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-brand-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        <input ref={fileInputRef} type="file" accept="video/*,.mp4,.mov,.webm,.m4v" multiple className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
        <Upload size={22} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Arrastrá videos acá o hacé clic para elegir</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">MP4 / MOV / WEBM · hasta {MAX_MB}MB c/u (un reel de 15-60s entra sobrado) · los que quieras</p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Costo aprox: $0.006/min de Whisper + ~$0.02 de adaptación por video</p>
      </div>

      {/* Barra de acciones masivas — aparece cuando hay guiones listos.
          Flujo editor: tildá los que van a producción → Copiar o ZIP →
          Marcar usados para que el equipo no repita. */}
      {listos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
          <button onClick={toggleSelTodos}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            {seleccionados.size === listos.length ? <CheckSquare size={13} className="text-brand-600" /> : <Square size={13} />}
            {seleccionados.size === listos.length ? 'Deseleccionar' : `Seleccionar todos (${listos.length})`}
          </button>
          {itemsSel.length > 0 && (
            <>
              <span className="text-[11px] font-bold text-brand-600 dark:text-brand-400">{itemsSel.length} seleccionado{itemsSel.length > 1 ? 's' : ''}</span>
              <button onClick={copiarSeleccionados}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition">
                <Copy size={11} /> Copiar {itemsSel.length}
              </button>
              <button onClick={descargarDocx}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
                title="Un Word formateado con un guion por página — cómodo para leer, imprimir y repartir">
                <FileText size={11} /> Descargar Word
              </button>
              <button onClick={() => marcarUsados(itemsSel.map(i => i.id), true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition">
                <BadgeCheck size={11} /> Marcar usados
              </button>
            </>
          )}
          {/* Filtro de uso */}
          <div className="ml-auto flex items-center gap-1">
            {[['todos', `Todos (${items.length})`], ['sin-usar', `Sin usar (${items.length - countUsados})`], ['usados', `Usados (${countUsados})`]].map(([v, label]) => (
              <button key={v} onClick={() => setFiltroUso(v)}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-full transition ${
                  filtroUso === v
                    ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lista */}
      {items.length === 0 ? (
        <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500 italic">
          Todavía no subiste videos para {producto.nombre}.
        </div>
      ) : (
        <div className="space-y-2">
          {itemsVisibles.map(item => {
            const abierto = expandedId === item.id;
            const seleccionable = item.status === 'listo' && !!item.guion;
            return (
              <div key={item.id} className={`bg-white dark:bg-gray-800 border rounded-xl overflow-hidden transition ${
                seleccionados.has(item.id) ? 'border-brand-400 dark:border-brand-600 ring-1 ring-brand-200 dark:ring-brand-900/50' : 'border-gray-200 dark:border-gray-700'
              } ${item.usado ? 'opacity-60' : ''}`}>
                {/* Fila */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                  onClick={() => setExpandedId(abierto ? null : item.id)}>
                  {seleccionable && (
                    <button onClick={e => { e.stopPropagation(); toggleSel(item.id); }}
                      className="shrink-0 text-gray-400 hover:text-brand-600 transition" title="Seleccionar para acción masiva">
                      {seleccionados.has(item.id) ? <CheckSquare size={16} className="text-brand-600" /> : <Square size={16} />}
                    </button>
                  )}
                  <Film size={16} className="text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
                      {item.nombre}
                      {item.usado && (
                        <span className="ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 align-middle" title={item.usadoAt ? `Usado el ${new Date(item.usadoAt).toLocaleDateString()}` : ''}>
                          <BadgeCheck size={9} /> USADO
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      {item.durationSec ? `${Math.round(item.durationSec)}s · ` : ''}
                      {item.idioma ? `idioma: ${item.idioma} · ` : ''}
                      {item.sizeMB ? `${item.sizeMB}MB · ` : ''}
                      {item.costUSD ? `$${item.costUSD}` : ''}
                    </p>
                  </div>
                  <StatusChip status={item.status} error={item.error} />
                  <ChevronDown size={14} className={`text-gray-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
                </div>

                {/* Detalle */}
                {abierto && (
                  <div className="px-4 pb-4 space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                    {item.status === 'error' && (
                      <div className="flex items-start gap-2 p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {item.error}
                      </div>
                    )}
                    {item.estructuraDetectada && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 italic px-1">
                        Fórmula detectada: {item.estructuraDetectada}
                      </p>
                    )}
                    <TextBlock icon={<Wand2 size={11} />} title="Guion adaptado (rioplatense)" text={item.guion} addToast={addToast} />
                    {Array.isArray(item.hooksAlternativos) && item.hooksAlternativos.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5"><Lightbulb size={11} /> Hooks alternativos para testear</p>
                        <ul className="space-y-1">
                          {item.hooksAlternativos.map((h, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-gray-800 dark:text-gray-200">
                              <span className="text-gray-400 font-mono text-[10px] mt-0.5 shrink-0">{i + 1}.</span>
                              <span className="flex-1">{h}</span>
                              <button onClick={() => { navigator.clipboard.writeText(h).then(() => addToast?.({ type: 'success', message: 'Hook copiado' })).catch(() => {}); }}
                                className="text-gray-400 hover:text-brand-600 shrink-0" title="Copiar hook"><Copy size={11} /></button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <TextBlock icon={<ScrollText size={11} />} title="Notas para el editor" text={item.notasEditor} addToast={addToast} />
                    <TextBlock icon={<Languages size={11} />} title="Traducción fiel (qué dice el original)" text={item.traduccion} addToast={addToast} />
                    <TextBlock icon={<FileText size={11} />} title="Transcripción original" text={item.transcript} addToast={addToast} />

                    {/* Acciones */}
                    <div className="flex items-center gap-2 pt-1">
                      {item.status === 'listo' && item.guion && (
                        <button onClick={() => marcarUsados([item.id], !item.usado)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg transition ${
                            item.usado
                              ? 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          }`}>
                          {item.usado ? <><Undo2 size={11} /> Marcar sin usar</> : <><BadgeCheck size={11} /> Marcar como usado</>}
                        </button>
                      )}
                      {(item.status === 'listo' || (item.status === 'error' && item.transcript)) && (
                        <button onClick={() => readaptar(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition">
                          <RefreshCw size={11} /> Re-adaptar (usa research/oferta actuales)
                        </button>
                      )}
                      <button onClick={() => borrar(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
                        <Trash2 size={11} /> Borrar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
