// Comando "/" global estilo Notion/Linear AI. Cuando el user presiona "/"
// fuera de un input/textarea, abre un overlay centrado con acciones
// contextuales (varían por sección actual). Filtra por texto al tipear.
// Cierra con Escape o click afuera.
//
// Las acciones se registran desde fuera vía props/context. Acciones globales
// (cambiar sección, ir a producto, abrir copy generator) son built-in.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search, ArrowRight, LayoutGrid, Package, Inbox, Trophy,
  Bookmark, Sparkles, FileText, Activity, X, Command,
} from 'lucide-react';

const SECTION_ACTIONS = [
  { id: 'go-home', label: 'Ir al Home', section: 'mk-home', icon: LayoutGrid, keywords: ['home', 'dashboard', 'inicio'] },
  { id: 'go-arranque', label: 'Ir a Productos (Arranque)', section: 'mk-arranque', icon: Package, keywords: ['productos', 'arranque', 'lista'] },
  { id: 'go-bandeja', label: 'Ir a Bandeja de ideas', section: 'mk-bandeja', icon: Inbox, keywords: ['bandeja', 'ideas', 'inbox'] },
  { id: 'go-winners', label: 'Ir a Winners', section: 'mk-winners', icon: Trophy, keywords: ['winners', 'ganadores'] },
  { id: 'go-meta', label: 'Ir a Meta Ads', section: 'mk-meta', icon: Sparkles, keywords: ['meta', 'campañas', 'insights', 'facebook'] },
  { id: 'go-copy', label: 'Generador de copy', section: 'mk-copy', icon: FileText, keywords: ['copy', 'generador', 'texto', 'meta ads'] },
];

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

// Detecta si HAY un modal abierto en la página. Si lo hay, NO interceptamos
// "/" para no abrir el SlashCommand encima del modal del user. Heurística:
// busca elementos con role="dialog" o clases típicas de modal overlay
// (fixed inset-0 + bg-black/black-overlay) que estén montados ahora mismo.
// Audit HIGH #1: el listener era window-level y abría SlashCommand encima
// de cualquier modal con z-[60], destruyendo el contexto.
function isModalOpen() {
  if (typeof document === 'undefined') return false;
  // Cualquier dialog accesible.
  if (document.querySelector('[role="dialog"]')) return true;
  // Heurística para modales legacy sin role: overlay fixed inset-0 con bg.
  const overlays = document.querySelectorAll('.fixed.inset-0');
  for (const el of overlays) {
    // Skip el propio overlay del SlashCommand (lo identificamos por data-attr).
    if (el.dataset.slashRoot === '1') continue;
    if (el.offsetParent !== null || el.getBoundingClientRect().width > 0) return true;
  }
  return false;
}

export default function SlashCommand({ onNavigate, currentSection }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);

  // Atajo global: "/" abre, Escape cierra. NO se activa cuando el user
  // está tipeando en un input/textarea/contentEditable.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !isTypingTarget(e.target) && !open && !isModalOpen()) {
        e.preventDefault();
        setOpen(true);
        setQuery('');
        setHighlight(0);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus el input al abrir.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Acciones disponibles (filtradas por query).
  const actions = useMemo(() => SECTION_ACTIONS.filter(a => a.section !== currentSection), [currentSection]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(a => {
      if (a.label.toLowerCase().includes(q)) return true;
      if (a.keywords?.some(k => k.includes(q))) return true;
      return false;
    });
  }, [actions, query]);

  // Mantener highlight válido al filtrar.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered, highlight]);

  const runAction = (action) => {
    if (action.section) onNavigate?.(action.section);
    setOpen(false);
  };

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const action = filtered[highlight];
      if (action) runAction(action);
    }
  };

  if (!open) return null;

  return (
    <div
      data-slash-root="1"
      role="dialog"
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] px-4 animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg glass-card border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-700">
          <Search size={14} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onInputKey}
            placeholder="Tipea para buscar acciones…"
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
          />
          <kbd className="text-[10px] font-mono text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5">Esc</kbd>
        </div>

        {/* Acciones */}
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-4 text-center">Sin coincidencias</p>
          ) : (
            filtered.map((a, i) => {
              const Icon = a.icon || ArrowRight;
              return (
                <button
                  key={a.id}
                  onClick={() => runAction(a)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${
                    highlight === i
                      ? 'bg-brand-50 dark:bg-brand-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <Icon size={14} className={highlight === i ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500'} />
                  <span className="flex-1 text-xs font-semibold text-gray-800 dark:text-gray-200">{a.label}</span>
                  {highlight === i && (
                    <kbd className="text-[10px] font-mono text-brand-600 dark:text-brand-400 inline-flex items-center gap-1">
                      ↵
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 flex items-center justify-between">
          <span className="inline-flex items-center gap-1">
            <Command size={10} /> Comando rápido
          </span>
          <span className="inline-flex items-center gap-2">
            <kbd className="font-mono border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5">↑↓</kbd>
            navegar
            <kbd className="font-mono border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5">↵</kbd>
            seleccionar
          </span>
        </div>
      </div>
    </div>
  );
}
