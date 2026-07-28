// Diálogo de confirmación / entrada PROPIO de la plataforma. Reemplaza a
// window.confirm / window.prompt, que se ven como popups crudos del navegador
// ("adslab.vercel.app dice…") fuera de la estética de la app.
//
// Uso:
//   <ConfirmDialog open title="¿Eliminar?" message="…" tone="danger"
//     confirmLabel="Eliminar" onConfirm={() => …} onClose={() => …} />
// Con entrada de texto: withInput (+ multiline para textarea).

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

export default function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  tone = 'brand', // 'brand' | 'warn' | 'danger'
  withInput = false, inputLabel, defaultValue = '', placeholder, multiline = false,
  onConfirm, onClose,
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  // Reset del valor cada vez que se abre.
  useEffect(() => { if (open) setValue(defaultValue); }, [open, defaultValue]);

  // Esc cierra; autofocus en la entrada (o nada, y Enter confirma en inputs).
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, onClose]);
  useEffect(() => {
    if (open && withInput) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, withInput]);

  if (!open) return null;
  const confirm = () => onConfirm?.(withInput ? value : undefined);
  const toneCls = tone === 'danger' ? 'bg-red-600 hover:bg-red-700'
    : tone === 'warn' ? 'bg-amber-500 hover:bg-amber-600'
    : 'bg-brand-600 hover:bg-brand-700';

  // PORTAL a <body>: si el diálogo se renderizara dentro de un ancestro con
  // transform (ej. la tarjeta del kanban, que se mueve al hover), `fixed` deja
  // de ser relativo a la pantalla y el popup queda pegado/tapado. En el body
  // siempre se centra en el viewport, por encima de todo.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-start gap-2.5">
            {tone !== 'brand' && (
              <AlertTriangle size={18} className={`${tone === 'danger' ? 'text-red-500' : 'text-amber-500'} mt-0.5 shrink-0`} />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
              {message && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{message}</p>}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X size={16} /></button>
          </div>
          {withInput && (
            <div className="mt-3">
              {inputLabel && <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1">{inputLabel}</span>}
              {multiline ? (
                <textarea ref={inputRef} value={value} onChange={e => setValue(e.target.value)} rows={3} placeholder={placeholder}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y" />
              ) : (
                <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder}
                  onKeyDown={e => { if (e.key === 'Enter') confirm(); }}
                  className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition">{cancelLabel}</button>
          <button onClick={confirm} className={`px-3.5 py-1.5 text-xs font-bold text-white rounded-lg transition ${toneCls}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
