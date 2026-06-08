// Bell de actividad — muestra histórico de ejecuciones completadas + fallidas.
// Click → dropdown con lista. Badge muestra count de errores no leídos.

import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check, AlertCircle, X, Trash2, Filter } from 'lucide-react';
import {
  subscribeActivity, getUnreadErrorCount, markAllRead, clearActivity,
} from './activityLogStore.js';
import { fetchDolarCripto, subscribeDolar, usdToArsString, getDolarCriptoCached } from './dolarStore.js';

function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-AR', { month: '2-digit', day: '2-digit' }) + ' ' +
         d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export default function ActivityBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'errors'
  const [expandedId, setExpandedId] = useState(null);
  const [dolar, setDolar] = useState(() => getDolarCriptoCached());
  const popoverRef = useRef(null);

  useEffect(() => subscribeActivity(setItems), []);
  useEffect(() => {
    fetchDolarCripto().catch(() => {});
    return subscribeDolar(setDolar);
  }, []);

  // Cerrar al click afuera.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const unreadErrorCount = getUnreadErrorCount();
  const visible = filter === 'errors' ? items.filter(i => i.status === 'error') : items;
  const doneCount = items.filter(i => i.status === 'done').length;
  const errorCount = items.filter(i => i.status === 'error').length;

  const handleOpen = () => {
    setOpen(o => !o);
    if (!open) markAllRead();
  };

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className={`relative p-2 rounded-lg border transition ${
          unreadErrorCount > 0
            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50'
            : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
        title="Actividad reciente"
      >
        <Bell size={14} />
        {unreadErrorCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadErrorCount > 9 ? '9+' : unreadErrorCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 z-50 w-[400px] max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-xs font-bold text-gray-900 dark:text-gray-100">Actividad reciente</p>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {doneCount} OK · {errorCount > 0 && <span className="text-red-500 font-bold">{errorCount} error{errorCount !== 1 ? 'es' : ''}</span>}
                {errorCount === 0 && <span>sin errores</span>}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilter(f => f === 'errors' ? 'all' : 'errors')}
                className={`p-1 rounded text-[10px] font-bold transition ${
                  filter === 'errors'
                    ? 'bg-red-500 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                title={filter === 'errors' ? 'Mostrar todo' : 'Solo errores'}
              >
                <Filter size={10} />
              </button>
              {items.length > 0 && (
                <button
                  onClick={() => { if (window.confirm('¿Borrar todo el log?')) clearActivity(); }}
                  className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                  title="Borrar log"
                >
                  <Trash2 size={10} />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Cerrar">
                <X size={10} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-[60vh] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-3 py-8 text-xs text-gray-500 dark:text-gray-400 text-center italic">
                {filter === 'errors' ? 'Sin errores recientes 🎉' : 'Sin actividad todavía. Las ejecuciones que termines van a aparecer acá.'}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {visible.map(item => (
                  <li key={item.id} className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
                    <button
                      onClick={() => setExpandedId(e => e === item.id ? null : item.id)}
                      className="w-full flex items-start gap-2 text-left"
                    >
                      <div className="shrink-0 mt-0.5">
                        {item.status === 'done'
                          ? <Check size={12} className="text-emerald-500" />
                          : <AlertCircle size={12} className="text-red-500" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[11px] font-bold truncate ${item.status === 'error' ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-gray-100'}`}>
                          {item.label}
                        </p>
                        {item.sublabel && (
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{item.sublabel}</p>
                        )}
                        <div className="flex items-center gap-2 text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">
                          <span>{fmtDate(item.finishedAt)}</span>
                          {item.durationMs > 0 && <span>· {fmtMs(item.durationMs)}</span>}
                          {item.cost > 0 && (
                            <span className={item.status === 'error' ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}>
                              · ${Number(item.cost).toFixed(3)}
                              {dolar?.venta && ` · ${usdToArsString(item.cost, dolar)}`}
                            </span>
                          )}
                        </div>
                        {/* Mensaje expandible: errores en rojo, success en gris */}
                        {expandedId === item.id && item.message && (
                          <div className={`mt-1.5 p-2 rounded text-[10px] whitespace-pre-wrap ${
                            item.status === 'error'
                              ? 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                          }`}>
                            {item.message}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
