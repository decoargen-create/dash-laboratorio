// Tab "Referencias" — reels de Instagram agendados como referencia creativa.
//
// Flujo:
//   1. El admin pega uno o varios links de IG (reel / post / tv).
//   2. El server (api/marketing/referencias) los scrapea vía Apify y persiste
//      el mp4 + miniatura en el bucket `creativos` (las URLs del CDN de IG
//      expiran en horas). Acá se listan con reproductor.
//   3. "Analizar con IA" → Whisper (idioma auto) + Claude: ángulo, hooks,
//      estructura, estilo visual.
//   4. "Guion para editor" → adaptar-guion-video con el contexto del producto
//      (guion rioplatense + hooks alternativos + notas de producción).
//   5. "Enviar a tarjeta" → se adjunta a TODAS las tarjetas de un producto del
//      tablero de Producción (patrón winners) y el editor la ve en su workspace
//      con el embed de IG + guion.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Clapperboard, Plus, Loader2, Play, Sparkles, ScrollText, Send, ExternalLink,
  Trash2, X, Copy, Check, RefreshCw, AlertTriangle, Instagram, Lightbulb,
} from 'lucide-react';
import { authHeaders } from './authFetch.js';
import { parseJsonOrThrow } from './apiHelpers.js';
import { confirmDialog } from './dialogs.jsx';
import { productosEnTablero, addReferenciaAProducto } from './produccionStore.js';
import { referenciasApi as api, toCardRef, IG_URL_RE } from './referenciasApi.js';

// Contexto del producto para adaptar-guion-video — mismos fallbacks que
// TranscripcionVideosSection (docs.* como fuente secundaria).
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

function CopyBtn({ text, label = 'Copiar' }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch {}
      }}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
      {ok ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />} {ok ? 'Copiado' : label}
    </button>
  );
}

// Modal reproductor: mp4 firmado si existe, sino el embed público de IG.
function PlayerModal({ r, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-9 right-0 text-white/80 hover:text-white"><X size={22} /></button>
        {r.videoUrl ? (
          <video src={r.videoUrl} controls autoPlay playsInline
            className="max-h-[82vh] max-w-[92vw] rounded-xl bg-black shadow-2xl" />
        ) : (
          <iframe
            src={`https://www.instagram.com/p/${r.shortcode}/embed`}
            title={`Reel ${r.shortcode}`}
            className="w-[340px] h-[600px] max-h-[82vh] rounded-xl bg-white shadow-2xl border-0"
            allow="autoplay; encrypted-media" />
        )}
        {r.owner_username && (
          <div className="mt-2 text-center text-xs text-white/70">@{r.owner_username}</div>
        )}
      </div>
    </div>
  );
}

// Modal con el guion adaptado (output de adaptar-guion-video).
function GuionModal({ r, onClose }) {
  const g = r.guion || {};
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const md = [
    g.estructuraDetectada ? `Fórmula: ${g.estructuraDetectada}` : '',
    '',
    'GUION (rioplatense — leer en voz alta)',
    g.guion || '',
    (g.hooksAlternativos || []).length ? '\nHOOKS ALTERNATIVOS\n' + g.hooksAlternativos.map((h, i) => `${i + 1}. ${h}`).join('\n') : '',
    g.notasEditor ? `\nNOTAS PARA EL EDITOR\n${g.notasEditor}` : '',
  ].filter(Boolean).join('\n');
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl my-8 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <ScrollText size={16} className="text-brand-500" />
          <h3 className="flex-1 text-sm font-bold text-gray-900 dark:text-gray-100">Guion adaptado · @{r.owner_username || r.shortcode}</h3>
          <CopyBtn text={md} label="Copiar todo" />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {g.estructuraDetectada && (
            <p className="text-xs text-gray-500 dark:text-gray-400"><span className="font-bold">Fórmula:</span> {g.estructuraDetectada}</p>
          )}
          <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-100 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3.5 border border-gray-200 dark:border-gray-700 leading-relaxed font-sans">{g.guion || '(sin guion)'}</pre>
          {(g.hooksAlternativos || []).length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-1.5"><Lightbulb size={12} /> Hooks alternativos</div>
              <ul className="space-y-1">
                {g.hooksAlternativos.map((h, i) => (
                  <li key={i} className="text-sm text-gray-700 dark:text-gray-200 flex gap-2"><span className="text-brand-500 font-bold shrink-0">{i + 1}.</span> {h}</li>
                ))}
              </ul>
            </div>
          )}
          {g.notasEditor && (
            <div>
              <div className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-1.5">Notas para el editor</div>
              <pre className="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-200 leading-relaxed font-sans">{g.notasEditor}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Picker: a qué producto del tablero de Producción mandar la referencia.
function TarjetaPicker({ r, onClose, addToast }) {
  const productos = productosEnTablero();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md my-10 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <Send size={15} className="text-brand-500" />
          <h3 className="flex-1 text-sm font-bold text-gray-900 dark:text-gray-100">Enviar a tarjetas de Producción</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-3 max-h-[60vh] overflow-y-auto">
          {productos.length === 0 ? (
            <p className="text-sm text-gray-400 px-2 py-4 text-center">No hay tarjetas en el tablero de Producción todavía.</p>
          ) : productos.map(p => (
            <button key={`${p.productoId}|${p.productoNombre}`}
              onClick={() => {
                const n = addReferenciaAProducto(p.productoId, p.productoNombre, toCardRef(r));
                addToast?.({ type: n > 0 ? 'success' : 'info', message: n > 0 ? `Referencia agregada a ${n} tarjeta${n === 1 ? '' : 's'} de ${p.productoNombre}` : 'Ya estaba en esas tarjetas' });
                onClose();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition">
              <Clapperboard size={14} className="text-gray-400 shrink-0" />
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-100">{p.productoNombre || '(sin nombre)'}</span>
              <span className="text-[11px] text-gray-400 shrink-0">{p.tarjetas} tarjeta{p.tarjetas === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
        <p className="px-5 pb-4 text-[11px] text-gray-400">Se agrega a todas las tarjetas del producto — el editor la ve en su tablero con el reel + guion.</p>
      </div>
    </div>
  );
}

function RefCard({ r, busy, onPlay, onAnalyze, onGuion, onVerGuion, onEnviar, onDelete }) {
  const analizado = !!r.analisis;
  const tieneGuion = !!r.guion?.guion;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden flex flex-col">
      {/* Miniatura 9:16 con overlay de play */}
      <button onClick={onPlay} className="relative aspect-[9/16] max-h-72 w-full bg-gray-100 dark:bg-gray-800 group overflow-hidden">
        {r.thumbUrl ? (
          <img src={r.thumbUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600"><Instagram size={32} /></div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-80 group-hover:opacity-100 transition">
          <span className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play size={18} className="text-gray-900 ml-0.5" fill="currentColor" />
          </span>
        </div>
        {r.video_duration ? (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-bold">{Math.round(r.video_duration)}s</span>
        ) : null}
        {!r.videoUrl && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]" title="No tenemos el mp4 guardado — se reproduce con el embed de Instagram">embed</span>
        )}
      </button>

      <div className="p-3 flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Instagram size={12} className="text-pink-500 shrink-0" />
          <span className="flex-1 min-w-0 truncate text-xs font-bold text-gray-800 dark:text-gray-100">@{r.owner_username || r.shortcode}</span>
          <a href={r.url} target="_blank" rel="noopener noreferrer" title="Abrir en Instagram"
            className="text-gray-400 hover:text-pink-500 shrink-0"><ExternalLink size={13} /></a>
        </div>
        {r.caption && <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">{r.caption}</p>}
        {analizado && (
          <div className="flex flex-wrap gap-1">
            {r.analisis.angle && (
              <span className="px-1.5 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-300 text-[10px] font-bold">{r.analisis.angle}</span>
            )}
            {(r.analisis.hooks || []).slice(0, 1).map((h, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[10px] truncate max-w-full" title={h}>🪝 {h}</span>
            ))}
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <button onClick={onAnalyze} disabled={!!busy}
            title={analizado ? 'Re-analizar con IA' : 'Transcribir (Whisper) + analizar ángulo y hooks (Claude)'}
            className={`inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold rounded-lg transition disabled:opacity-50 ${analizado ? 'text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-white bg-brand-500 hover:bg-brand-600'}`}>
            {busy === 'analyze' ? <Loader2 size={12} className="animate-spin" /> : analizado ? <Check size={12} /> : <Sparkles size={12} />}
            {analizado ? 'Analizado' : 'Analizar IA'}
          </button>
          <button onClick={tieneGuion ? onVerGuion : onGuion} disabled={!!busy}
            title={tieneGuion ? 'Ver el guion adaptado' : 'Generar guion rioplatense adaptado al producto (usa la transcripción)'}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition disabled:opacity-50">
            {busy === 'guion' ? <Loader2 size={12} className="animate-spin" /> : <ScrollText size={12} />}
            {tieneGuion ? 'Ver guion' : 'Guion'}
          </button>
          <button onClick={onEnviar} disabled={!!busy}
            title="Adjuntar a las tarjetas de un producto en Producción"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition disabled:opacity-50">
            <Send size={12} /> A tarjeta
          </button>
          <button onClick={onDelete} disabled={!!busy} title="Eliminar referencia"
            className="ml-auto inline-flex items-center px-2 py-1.5 text-[11px] rounded-lg text-gray-300 hover:text-red-500 transition disabled:opacity-50">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReferenciasSection({ producto, addToast }) {
  const [refs, setRefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(null); // { done, total }
  const [busy, setBusy] = useState({});       // id → 'analyze' | 'guion'
  const [player, setPlayer] = useState(null);
  const [guionModal, setGuionModal] = useState(null);
  const [picker, setPicker] = useState(null);

  const productoId = producto?.id != null ? String(producto.id) : null;

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    try {
      // Sin filtro por producto: la biblioteca es global, un reel sirve de
      // referencia para cualquier producto.
      const data = await api('');
      setRefs(data.referencias || []);
    } catch (err) {
      setLoadErr(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patchRef = (id, patch) => setRefs(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  const setBusyFor = (id, v) => setBusy(prev => ({ ...prev, [id]: v }));

  const addLinks = async () => {
    const urls = [...new Set((input.match(IG_URL_RE) || []).map(u => u.trim()))];
    if (urls.length === 0) {
      addToast?.({ type: 'warning', message: 'Pegá uno o más links de Instagram (instagram.com/reel/… o /p/…).' });
      return;
    }
    setAdding({ done: 0, total: urls.length });
    let ok = 0;
    for (let i = 0; i < urls.length; i++) {
      try {
        const data = await api('', { method: 'POST', body: { url: urls[i], productoId } });
        if (data.dedup) {
          addToast?.({ type: 'info', message: 'Ese reel ya estaba agendado.' });
        } else {
          ok++;
          setRefs(prev => [data.referencia, ...prev.filter(r => r.id !== data.referencia.id)]);
          if (data.videoWarn) addToast?.({ type: 'warning', message: data.videoWarn });
        }
      } catch (err) {
        addToast?.({ type: 'error', message: `${urls[i].slice(0, 50)}… → ${err.message}` });
      }
      setAdding({ done: i + 1, total: urls.length });
    }
    setAdding(null);
    if (ok > 0) {
      setInput('');
      addToast?.({ type: 'success', message: `${ok} reel${ok === 1 ? '' : 's'} agendado${ok === 1 ? '' : 's'} ✓` });
    }
  };

  const analyze = async (r) => {
    setBusyFor(r.id, 'analyze');
    try {
      const data = await api('?action=analyze', { method: 'POST', body: { id: r.id } });
      patchRef(r.id, data.referencia);
      if (String(data.transcriptStatus || '').startsWith('skipped')) {
        addToast?.({ type: 'warning', message: `Analizado sin transcripción (${data.transcriptStatus.replace('skipped: ', '')}).` });
      } else {
        addToast?.({ type: 'success', message: 'Reel analizado ✓' });
      }
      return data.referencia;
    } catch (err) {
      addToast?.({ type: 'error', message: `Análisis falló: ${err.message}` });
      return null;
    } finally {
      setBusyFor(r.id, null);
    }
  };

  const generarGuion = async (r) => {
    let cur = r;
    // El guion necesita la transcripción — si falta, corremos el análisis primero.
    if (!cur.transcript) {
      setBusyFor(r.id, 'guion');
      cur = await analyze(r);
      if (!cur) return;
      if (!cur.transcript) {
        addToast?.({ type: 'warning', message: 'No hay transcripción para este reel (sin mp4 guardado o sin audio) — no puedo adaptar el guion.' });
        return;
      }
    }
    setBusyFor(r.id, 'guion');
    try {
      const resp = await fetch('/api/marketing/adaptar-guion-video', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ transcript: cur.transcript, idioma: cur.idioma, producto: buildProductoCtx(producto) }),
      });
      const aData = await parseJsonOrThrow(resp, 'adaptar-guion-video');
      if (!resp.ok || aData.error) throw new Error(aData.error || `HTTP ${resp.status}`);
      const guion = {
        traduccion: aData.traduccion,
        estructuraDetectada: aData.estructuraDetectada,
        guion: aData.guion,
        hooksAlternativos: aData.hooksAlternativos || [],
        notasEditor: aData.notasEditor,
      };
      const saved = await api(`?id=${encodeURIComponent(cur.id)}`, { method: 'PATCH', body: { guion } });
      patchRef(cur.id, saved.referencia);
      setGuionModal(saved.referencia);
      addToast?.({ type: 'success', message: 'Guion adaptado listo ✓' });
    } catch (err) {
      addToast?.({ type: 'error', message: `Guion falló: ${err.message}` });
    } finally {
      setBusyFor(cur.id, null);
    }
  };

  const borrar = async (r) => {
    const ok = await confirmDialog({
      title: 'Eliminar referencia',
      message: `¿Eliminar el reel de @${r.owner_username || r.shortcode}? Se borra el video guardado. Las tarjetas de Producción que ya lo tienen lo conservan.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api(`?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      setRefs(prev => prev.filter(x => x.id !== r.id));
    } catch (err) {
      addToast?.({ type: 'error', message: `No se pudo borrar: ${err.message}` });
    }
  };

  return (
    <div className="space-y-4">
      {/* Input de links */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Clapperboard size={16} className="text-pink-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Agendar reels de referencia</h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Pegá links de Instagram (reels o posts, públicos). Se guarda el video + miniatura, y después podés analizarlo con IA, generar el guion adaptado y mandarlo a una tarjeta de Producción.
        </p>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addLinks(); } }}
            rows={2}
            placeholder={'https://www.instagram.com/reel/…\nhttps://www.instagram.com/p/… (varios a la vez, uno por línea)'}
            className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 resize-y font-mono"
          />
          <button onClick={addLinks} disabled={!!adding}
            className="shrink-0 self-start inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-pink-500 hover:bg-pink-600 rounded-lg transition disabled:opacity-60">
            {adding ? <><Loader2 size={14} className="animate-spin" /> {adding.done}/{adding.total}</> : <><Plus size={14} /> Agendar</>}
          </button>
        </div>
        {adding && <p className="text-[11px] text-gray-400 mt-2">Scrapeando y guardando el video… tarda ~20-60s por reel.</p>}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-14 text-gray-400"><Loader2 size={18} className="animate-spin mr-2" /> Cargando referencias…</div>
      ) : loadErr ? (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-2">
          <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-amber-800 dark:text-amber-200">
            {/mi?gra/i.test(loadErr) || /does not exist|42P01|relation/i.test(loadErr)
              ? 'Falta aplicar la migración 0036 (tabla marketing_referencias) en Supabase.'
              : loadErr}
          </div>
          <button onClick={load} className="shrink-0 text-amber-600 hover:text-amber-700"><RefreshCw size={14} /></button>
        </div>
      ) : refs.length === 0 ? (
        <div className="text-center py-14 text-gray-400">
          <Instagram size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Todavía no agendaste ningún reel — pegá el primer link arriba.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {refs.map(r => (
            <RefCard key={r.id} r={r} busy={busy[r.id]}
              onPlay={() => setPlayer(r)}
              onAnalyze={() => analyze(r)}
              onGuion={() => generarGuion(r)}
              onVerGuion={() => setGuionModal(r)}
              onEnviar={() => setPicker(r)}
              onDelete={() => borrar(r)}
            />
          ))}
        </div>
      )}

      {player && <PlayerModal r={player} onClose={() => setPlayer(null)} />}
      {guionModal && <GuionModal r={guionModal} onClose={() => setGuionModal(null)} />}
      {picker && <TarjetaPicker r={picker} addToast={addToast} onClose={() => setPicker(null)} />}
    </div>
  );
}
