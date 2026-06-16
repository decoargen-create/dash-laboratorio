// Generador de copy para Meta Ads. UI standalone (sección mk-copy).
//
// Flujo:
//   1. User elige producto (default: producto activo)
//   2. Elige cuántas variaciones (2-8)
//   3. Click "Generar" → backend devuelve N copies vía SSE
//   4. Cada copy en una card con copy-to-clipboard por field (primary text,
//      headline, CTA), tag de ángulo, "por qué rinde", y export ZIP de todos.
//
// El backend usa winners marcados del producto como pista de qué ángulo
// rinde. Si no hay winners, igual genera (vuelve a research/avatar).

import React, { useState, useEffect } from 'react';
import { Sparkles, Copy, Check, Loader2, RefreshCw, FileText, Trophy, Package } from 'lucide-react';
import { loadIdeas } from './bandejaStore.js';
import AnimatedCounter from './AnimatedCounter.jsx';

function loadProductos() {
  try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]'); }
  catch { return []; }
}

// Trae winners de IDB+cloud para el producto. Lazy import para no bloquear.
// Si falla, devuelve {winners: [], error: msg} en vez de array vacío silencioso.
// Audit MED — antes el user no se enteraba si el chunk de galería no descargaba.
async function loadWinnersForProducto(productoId) {
  if (!productoId) return { winners: [], error: null };
  try {
    const mod = await import('./galeriaReferenciales.js');
    const refs = await mod.getReferencialesByProducto(productoId, { includeArchived: false });
    return { winners: refs.filter(r => r.winner), error: null };
  } catch (err) {
    console.warn('No pude cargar winners:', err);
    return { winners: [], error: err.message || 'error desconocido' };
  }
}

export default function CopyGeneratorSection({ addToast }) {
  const [productos] = useState(() => loadProductos());
  const initialProductoId = (() => {
    try { return localStorage.getItem('adslab-marketing-active-product') || null; } catch { return null; }
  })();
  const [productoId, setProductoId] = useState(initialProductoId || (productos[0]?.id ? String(productos[0].id) : null));
  const [n, setN] = useState(4);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState([]);
  const [winners, setWinners] = useState([]);

  const producto = productos.find(p => String(p.id) === String(productoId));

  // Cargar winners cuando cambia el producto.
  useEffect(() => {
    if (!productoId) { setWinners([]); return; }
    let cancelled = false;
    loadWinnersForProducto(productoId).then(({ winners: ws, error: e }) => {
      if (cancelled) return;
      setWinners(ws);
      if (e) {
        addToast?.({ type: 'warning', message: `No pude cargar los winners (${e}). El copy se generará sin esa pista — probá recargar.` });
      }
    });
    return () => { cancelled = true; };
  }, [productoId, addToast]);

  const generar = async () => {
    if (!producto) {
      addToast?.({ type: 'error', message: 'Elegí un producto primero.' });
      return;
    }
    setRunning(true);
    setError('');
    setCopies([]);
    try {
      // Reducimos los winners a la info útil (sin imageBase64 / skeletons largos).
      const winnersLite = winners.map(w => ({
        id: w.id,
        sourceHeadline: w.sourceHeadline,
        winnerMetrics: w.winnerMetrics,
      }));
      const resp = await fetch('/api/marketing/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto: {
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            formato: producto.formato,
            ofertasReales: producto.ofertasReales,
            avatar: producto.docs?.avatar,
            research: producto.docs?.research,
            docs: producto.docs,
          },
          winners: winnersLite,
          n,
        }),
      });
      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}${text ? ': ' + text.slice(0, 200) : ''}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let final = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim());
            if (ev.type === 'complete') final = ev;
            if (ev.type === 'error') throw new Error(ev.error || 'Error del stream');
          } catch {}
        }
      }
      if (!final || !Array.isArray(final.copies)) {
        throw new Error('El generador devolvió un response vacío.');
      }
      setCopies(final.copies);
      addToast?.({ type: 'success', message: `${final.copies.length} copies generados.` });
    } catch (err) {
      setError(err.message || 'Error desconocido');
      addToast?.({ type: 'error', message: `Generador de copy falló: ${err.message}` });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-2xl p-5 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Generador de copy</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Copies para Meta Ads adaptados a tu producto + ofertas + avatar. Usa tus winners como pista.
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Producto</label>
            <select
              value={productoId || ''}
              onChange={e => setProductoId(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {productos.length === 0 && <option value="">Sin productos cargados</option>}
              {productos.map(p => (
                <option key={p.id} value={String(p.id)}>{p.nombre || `Producto ${p.id}`}</option>
              ))}
            </select>
          </div>

          {producto && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1">
                <Package size={11} />
                {producto.formato || 'sin formato'}
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Trophy size={11} className={winners.length > 0 ? 'text-amber-500' : ''} />
                <AnimatedCounter value={winners.length} /> winner{winners.length !== 1 ? 's' : ''} como pista
              </span>
              {producto.ofertasReales ? (
                <><span>·</span><span className="text-emerald-600 dark:text-emerald-400">✓ con ofertas declaradas</span></>
              ) : (
                <><span>·</span><span className="text-amber-600 dark:text-amber-400">⚠ sin ofertas — copy neutro</span></>
              )}
              {!producto.docs?.research && (
                <><span>·</span><span className="text-red-600 dark:text-red-400">⚠ sin research</span></>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Variantes:</span>
              {[2, 4, 6, 8].map(num => (
                <button key={num}
                  onClick={() => setN(num)}
                  className={`px-2.5 py-1 text-xs font-bold rounded transition ${
                    n === num
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
            <button
              onClick={generar}
              disabled={running || !producto}
              className="btn-fluo inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {running ? 'Generando…' : copies.length > 0 ? 'Regenerar' : 'Generar copies'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Resultados */}
      {copies.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {copies.map((c, i) => (
            <CopyCard key={i} copy={c} index={i} addToast={addToast} />
          ))}
        </div>
      )}
    </div>
  );
}

function CopyCard({ copy, index, addToast }) {
  const [copiedField, setCopiedField] = useState(null);
  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      addToast?.({ type: 'success', message: `${field} copiado.` });
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      addToast?.({ type: 'error', message: 'No pude copiar al portapapeles.' });
    }
  };
  const copyAll = () => {
    const txt = [
      `--- Primary text ---`,
      copy.primaryText,
      ``,
      `--- Headline ---`,
      copy.headline,
      copy.description ? `\n--- Description ---\n${copy.description}` : '',
      ``,
      `--- CTA ---`,
      copy.cta,
    ].filter(Boolean).join('\n');
    copyToClipboard(txt, 'todo');
  };

  return (
    <div className="glass-card card-hover border border-gray-200 dark:border-gray-700 rounded-xl p-4 animate-fade-in-up" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex items-center justify-between mb-3">
        <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
          {copy.angulo}
        </span>
        <button onClick={copyAll}
          className="text-[10px] font-semibold text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 inline-flex items-center gap-1">
          <Copy size={11} /> Copiar todo
        </button>
      </div>

      <FieldBlock label="Primary text" value={copy.primaryText} onCopy={() => copyToClipboard(copy.primaryText, 'primary text')} copied={copiedField === 'primary text'} multiline />
      <FieldBlock label="Headline" value={copy.headline} onCopy={() => copyToClipboard(copy.headline, 'headline')} copied={copiedField === 'headline'} />
      {copy.description && (
        <FieldBlock label="Description" value={copy.description} onCopy={() => copyToClipboard(copy.description, 'description')} copied={copiedField === 'description'} />
      )}
      <FieldBlock label="CTA" value={copy.cta} onCopy={() => copyToClipboard(copy.cta, 'CTA')} copied={copiedField === 'CTA'} />

      {copy.por_que_rinde && (
        <p className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 italic leading-snug">
          💡 {copy.por_que_rinde}
        </p>
      )}
    </div>
  );
}

function FieldBlock({ label, value, onCopy, copied, multiline = false }) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</span>
        <button onClick={onCopy}
          className="text-[10px] inline-flex items-center gap-1 text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition">
          {copied ? <><Check size={10} /> Copiado</> : <><Copy size={10} /> Copiar</>}
        </button>
      </div>
      {multiline ? (
        <p className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed bg-gray-50 dark:bg-gray-900/40 p-2 rounded">{value}</p>
      ) : (
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/40 p-2 rounded">{value}</p>
      )}
    </div>
  );
}
