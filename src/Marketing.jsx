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
  RefreshCw, Trash2, ChevronRight, Copy, Package,
} from 'lucide-react';

const STORAGE_KEY = 'viora-marketing-productos-v1';

const STEPS = [
  { key: 'research',   label: 'Research Doc',        desc: 'Investigación profunda del mercado, avatar, competidores, horror stories, corruption angles.' },
  { key: 'avatar',     label: 'Avatar Sheet',        desc: 'Ficha completa del cliente ideal con quotes y emotional journey.' },
  { key: 'offerBrief', label: 'Offer Brief',         desc: 'Brief para el copywriter: Big Idea, UMP/UMS, headlines, objections, belief chains.' },
  { key: 'beliefs',    label: 'Creencias',           desc: '6 creencias que el prospect debe adoptar antes de comprar.' },
];

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

export default function MarketingSection({ addToast }) {
  const [productos, setProductos] = useState(() => loadProductos());
  const [form, setForm] = useState({ productoUrl: '', productoNombre: '', descripcion: '' });
  const [activeProductId, setActiveProductId] = useState(null);
  const [activeTab, setActiveTab] = useState('research');

  // Estado de generación.
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
  const [stepStatus, setStepStatus] = useState({});
  const [liveOutputs, setLiveOutputs] = useState({});
  const [infoMsg, setInfoMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const readerRef = useRef(null);

  useEffect(() => { saveProductos(productos); }, [productos]);

  const activeProduct = productos.find(p => p.id === activeProductId) || null;

  const resetRun = () => {
    setCurrentStep(null);
    setStepStatus({});
    setLiveOutputs({});
    setInfoMsg('');
    setErrorMsg('');
  };

  const handleGenerate = async () => {
    const productoNombre = form.productoNombre.trim();
    const descripcion = form.descripcion.trim();
    const productoUrl = form.productoUrl.trim();
    if (!productoNombre) { addToast?.({ type: 'error', message: 'Falta el nombre del producto' }); return; }
    if (!descripcion) { addToast?.({ type: 'error', message: 'Falta la descripción (qué vende y a quién)' }); return; }

    setRunning(true);
    resetRun();

    try {
      const resp = await fetch('/api/marketing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoUrl, productoNombre, descripcion }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      const collectedOutputs = { research: '', avatar: '', offerBrief: '', beliefs: '' };

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
          } else if (ev.type === 'step-start') {
            setCurrentStep(ev.key);
            setStepStatus(s => ({ ...s, [ev.key]: 'running' }));
          } else if (ev.type === 'step-done') {
            setStepStatus(s => ({ ...s, [ev.key]: 'done' }));
            collectedOutputs[ev.key] = ev.content || '';
            setLiveOutputs(prev => ({ ...prev, [ev.key]: ev.content || '' }));
          } else if (ev.type === 'complete') {
            // Guardamos el paquete en la lista.
            const paquete = {
              id: Date.now(),
              productoNombre,
              descripcion,
              productoUrl,
              docs: ev.outputs || collectedOutputs,
              createdAt: new Date().toISOString(),
            };
            setProductos(prev => [paquete, ...prev]);
            setActiveProductId(paquete.id);
            setActiveTab('research');
            setForm({ productoUrl: '', productoNombre: '', descripcion: '' });
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

  // Determina qué mostrar en el viewer: el producto activo o el progreso live.
  const showingLive = running || Object.keys(liveOutputs).length > 0;

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

      {/* Form de generación */}
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
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">URL de la landing <span className="text-gray-400 normal-case font-normal">(opcional pero recomendado)</span></label>
            <input
              type="url"
              value={form.productoUrl}
              onChange={(e) => setForm({ ...form, productoUrl: e.target.value })}
              placeholder="https://tumarca.com.ar/productos/slug"
              className="w-full px-3 py-2.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Si la poné, scrapeo la landing y la uso como contexto. Si no, trabajo solo con nombre + descripción.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Qué vende y a quién <span className="text-red-500">*</span></label>
            <textarea
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              placeholder="Ej: Suplemento en gomitas para reducir celulitis en mujeres de 30-55 años que ya probaron cremas y dietas sin resultados duraderos."
              rows={3}
              className="w-full px-3 py-2.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y"
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Cuanto más específico seas sobre el avatar y el dolor, mejor sale el research.</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={running || !form.productoNombre.trim() || !form.descripcion.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold text-white bg-gradient-to-br from-purple-600 to-violet-500 rounded-xl hover:from-purple-700 hover:to-violet-600 shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles size={18} /> Generar documentación completa
          </button>
          <p className="text-[11px] text-center text-gray-500 dark:text-gray-400">Tarda entre 3 y 8 minutos. No cierres la pestaña.</p>
        </div>
      )}

      {/* Progreso en vivo */}
      {showingLive && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              {running ? 'Generando…' : 'Resultado'}
            </h3>
            {!running && Object.keys(liveOutputs).length > 0 && (
              <button
                onClick={() => { resetRun(); setActiveProductId(null); }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 rounded-md transition"
              >
                <X size={12} /> Cerrar
              </button>
            )}
          </div>
          {infoMsg && !errorMsg && (
            <div className="mb-3 p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-800 dark:text-blue-200">
              {infoMsg}
            </div>
          )}
          {errorMsg && (
            <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
              <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-800 dark:text-red-200">{errorMsg}</p>
            </div>
          )}
          {/* Stepper */}
          <div className="space-y-2">
            {STEPS.map(s => {
              const status = stepStatus[s.key] || 'pending';
              const content = liveOutputs[s.key];
              const isOpen = !!content;
              return (
                <div key={s.key} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <div className={`p-3 flex items-center gap-3 ${status === 'running' ? 'bg-purple-50 dark:bg-purple-900/20' : status === 'done' ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-gray-800/50'}`}>
                    <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center">
                      {status === 'done' ? <Check size={14} className="text-emerald-600 dark:text-emerald-300" /> :
                       status === 'running' ? <Loader2 size={14} className="text-purple-600 dark:text-purple-300 animate-spin" /> :
                       <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{s.label}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{s.desc}</p>
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
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-600 to-violet-500 flex items-center justify-center shrink-0">
                    <Package size={18} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{p.productoNombre}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {new Date(p.createdAt).toLocaleDateString('es-AR')}
                      {p.productoUrl && <> · <span className="text-purple-600 dark:text-purple-400">{new URL(p.productoUrl).hostname}</span></>}
                    </p>
                  </div>
                  <ChevronRight size={16} className={`text-gray-400 transition-transform ${activeProductId === p.id ? 'rotate-90' : ''}`} />
                </button>

                {/* Detalle expandido */}
                {activeProductId === p.id && (
                  <div className="bg-gray-50 dark:bg-gray-900/30 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between px-4 py-2 gap-2">
                      <div className="flex gap-1 overflow-x-auto">
                        {STEPS.map(s => (
                          <button
                            key={s.key}
                            onClick={() => setActiveTab(s.key)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition whitespace-nowrap ${activeTab === s.key ? 'bg-white dark:bg-gray-800 text-purple-700 dark:text-purple-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'}`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => handleCopy(p.docs[activeTab] || '')} className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition" title="Copiar doc actual">
                          <Copy size={12} />
                        </button>
                        <button onClick={() => handleDownloadSingle(p, activeTab, activeTab)} className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition" title="Descargar doc actual">
                          <Download size={12} />
                        </button>
                        <button onClick={() => handleDownloadPack(p)} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-white bg-purple-600 rounded hover:bg-purple-700 transition" title="Descargar paquete completo">
                          <Download size={11} /> Todo
                        </button>
                        <button onClick={() => handleDeleteProducto(p.id)} className="p-1.5 text-gray-400 hover:text-red-600 transition" title="Borrar">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="px-4 pb-4 max-h-[500px] overflow-y-auto">
                      <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        {p.docs[activeTab] || '(sin contenido)'}
                      </pre>
                    </div>
                  </div>
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
