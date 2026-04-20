// Tab "Documentación" del workspace de un producto.
//
// Muestra los 5 documentos generados por el pipeline (research, avatar,
// offerBrief, beliefs, resumenEjecutivo). Cada uno se puede expandir,
// editar (textarea) y descargar como .md.
//
// Si el producto no tiene docs todavía, sugiere correr el pipeline desde Setup.

import React, { useState } from 'react';
import { FileText, Edit3, Download, Check, X, Copy } from 'lucide-react';

const DOC_KEYS = [
  { key: 'resumenEjecutivo', label: '🎯 Resumen ejecutivo', desc: 'Síntesis de research + avatar + offer en una página.' },
  { key: 'research', label: '🔬 Research Doc', desc: 'Mercado, dolores, deseos, conversaciones, lenguaje del avatar.' },
  { key: 'avatar', label: '👤 Avatar Sheet', desc: 'Persona ideal: demos, dolores, jobs to be done, miedos, sueños.' },
  { key: 'offerBrief', label: '💎 Offer Brief', desc: 'Big idea, oferta única, mecanismo, prueba, urgencia.' },
  { key: 'beliefs', label: '🧠 Creencias necesarias', desc: 'Qué tiene que creer el avatar para comprar (cadena de creencias).' },
];

export default function DocumentacionTab({ producto, onUpdateProducto, addToast }) {
  const docs = producto?.docs || {};
  const tieneDocs = DOC_KEYS.some(d => docs[d.key]);

  const [expandedKey, setExpandedKey] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [draft, setDraft] = useState('');

  if (!tieneDocs) {
    return (
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
        <FileText size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin documentación todavía</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Corré el pipeline desde el tab Setup → la documentación (research + avatar + offer brief + creencias + resumen) se genera automáticamente y aparece acá.
        </p>
      </div>
    );
  }

  const startEdit = (key) => {
    setEditingKey(key);
    setDraft(docs[key] || '');
    setExpandedKey(key);
  };
  const cancelEdit = () => {
    setEditingKey(null);
    setDraft('');
  };
  const saveEdit = () => {
    if (!editingKey) return;
    onUpdateProducto?.({ docs: { ...docs, [editingKey]: draft } });
    addToast?.({ type: 'success', message: `${DOC_KEYS.find(d => d.key === editingKey)?.label} actualizado` });
    setEditingKey(null);
    setDraft('');
  };

  const downloadAsMd = (key, label, content) => {
    const blob = new Blob([`# ${label}\n\n${content || ''}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = String(producto?.nombre || 'producto').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    a.href = url;
    a.download = `${slug}-${key}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyText = (key, content) => {
    navigator.clipboard?.writeText(content || '');
    addToast?.({ type: 'success', message: 'Copiado al portapapeles' });
  };

  const downloadAll = () => {
    const lines = [];
    lines.push(`# Documentación — ${producto?.nombre || ''}`);
    lines.push('');
    if (producto?.docsGeneratedAt) {
      lines.push(`Generada: ${new Date(producto.docsGeneratedAt).toLocaleString('es-AR')}`);
      lines.push('');
    }
    for (const d of DOC_KEYS) {
      const content = docs[d.key];
      if (!content) continue;
      lines.push(`---`);
      lines.push('');
      lines.push(`## ${d.label}`);
      lines.push('');
      lines.push(content);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = String(producto?.nombre || 'producto').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    a.href = url;
    a.download = `${slug}-documentacion.md`;
    a.click();
    URL.revokeObjectURL(url);
    addToast?.({ type: 'success', message: 'Documentación completa descargada' });
  };

  return (
    <div className="space-y-3">
      {/* Header con info + descargar todo */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Documentación generada por Claude basada en la landing del producto.
          </p>
          {producto?.docsGeneratedAt && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              Generada: {new Date(producto.docsGeneratedAt).toLocaleString('es-AR')}
            </p>
          )}
        </div>
        <button
          onClick={downloadAll}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-purple-600 to-violet-600 rounded-lg hover:from-purple-700 hover:to-violet-700 shadow-sm transition"
        >
          <Download size={12} /> Descargar toda como .md
        </button>
      </div>

      {/* Cards por documento */}
      {DOC_KEYS.map(d => {
        const content = docs[d.key];
        if (!content) return null;
        const isExpanded = expandedKey === d.key;
        const isEditing = editingKey === d.key;
        const charCount = content.length;
        return (
          <div key={d.key} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpandedKey(isExpanded ? null : d.key)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{d.label}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{d.desc}</p>
              </div>
              <span className="text-[10px] font-mono text-gray-400 shrink-0">
                {charCount.toLocaleString('es-AR')} chars
              </span>
              <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>›</span>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900/30">
                {/* Botones de acción */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {!isEditing && (
                    <>
                      <button onClick={() => startEdit(d.key)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition">
                        <Edit3 size={10} /> Editar
                      </button>
                      <button onClick={() => copyText(d.key, content)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition">
                        <Copy size={10} /> Copiar
                      </button>
                      <button onClick={() => downloadAsMd(d.key, d.label, content)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition">
                        <Download size={10} /> Descargar .md
                      </button>
                    </>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      rows={20}
                      className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={cancelEdit}
                        className="inline-flex items-center gap-1 px-3 py-1 text-[10px] font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 transition">
                        <X size={10} /> Cancelar
                      </button>
                      <button onClick={saveEdit}
                        className="inline-flex items-center gap-1 px-3 py-1 text-[10px] font-bold text-white bg-purple-600 rounded hover:bg-purple-700 transition">
                        <Check size={10} /> Guardar
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="text-xs whitespace-pre-wrap text-gray-800 dark:text-gray-200 font-sans leading-relaxed bg-white dark:bg-gray-800 rounded-md px-3 py-2 border border-gray-200 dark:border-gray-700 max-h-[60vh] overflow-y-auto">
                    {content}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
