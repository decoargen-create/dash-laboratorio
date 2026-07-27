// Workspace del CREATOR (equipo creativo). Experiencia acotada: el chico entra
// desde su compu y ve SOLO sus tarjetas asignadas. Puede:
//   - subir creativos (van a la carpeta de Drive del producto),
//   - mover el estado entre "Por hacer" y "En revisión".
// NO puede: aprobar/publicar, reasignar, borrar tarjetas, ver pagos ni el
// tablero de otros. Todo eso lo garantiza la RLS + la RPC del server; acá el
// UI simplemente no lo ofrece.
//
// La data ya viene acotada por la RLS (el store solo trae sus filas), así que
// leemos del store como siempre.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Film, LogOut, Moon, Sun, RefreshCw, CheckCircle2, Clock, ChevronDown, ChevronRight, Sparkles,
} from 'lucide-react';
import {
  subscribeProduccion, allWeekKeys, listAssignments, weekLabel, weekKeyOf,
  ESTADO_LABELS, ESTADOS_CREATOR, VIDEOS_POR_PRODUCTO, updateAssignment, refreshProduccion,
} from './produccionStore.js';
import { CreativosSection } from './produccionUpload.jsx';

const ESTADO_BADGE = {
  porhacer: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
  revision: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  aprobado: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  publicado: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

function EstadoBadge({ estado }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ESTADO_BADGE[estado] || ESTADO_BADGE.porhacer}`}>
      {ESTADO_LABELS[estado] || estado}
    </span>
  );
}

function CreatorCard({ a, addToast }) {
  const [openBrief, setOpenBrief] = useState(false);
  const puedeMover = ESTADOS_CREATOR.includes(a.estado);
  const enRevision = a.estado === 'revision';

  const toggleEstado = () => {
    updateAssignment(a.id, { estado: enRevision ? 'porhacer' : 'revision' });
    addToast?.({
      type: 'success',
      message: enRevision ? 'Volviste la tarjeta a "Por hacer"' : '¡Listo! Pasó a "En revisión"',
    });
  };

  const nSubidos = (a.archivos || []).length;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 dark:text-white truncate">{a.productoNombre || 'Producto'}</h3>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="uppercase font-semibold tracking-wide">{a.tipo === 'testeo' ? 'Testeo' : 'Renovado'}</span>
              <span>·</span>
              <span>{weekLabel(a.weekKey)}</span>
            </div>
          </div>
          <EstadoBadge estado={a.estado} />
        </div>

        {/* Meta: videos objetivo + subidos */}
        <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          <span className="inline-flex items-center gap-1">
            <Film size={12} className="text-emerald-500" />
            {nSubidos} subido{nSubidos === 1 ? '' : 's'}
          </span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span>Objetivo: {a.videosTotal || VIDEOS_POR_PRODUCTO} videos</span>
        </div>

        {/* Brief (consignas / guiones) — solo lectura, colapsable */}
        {(a.brief || '').trim() && (
          <div className="mb-3">
            <button
              onClick={() => setOpenBrief(o => !o)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline">
              {openBrief ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Consigna / guiones
            </button>
            {openBrief && (
              <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                {a.brief}
              </pre>
            )}
          </div>
        )}

        {/* Subida de creativos */}
        <CreativosSection a={a} addToast={addToast} canDelete />
      </div>

      {/* Acción de estado (solo entre Por hacer / En revisión) */}
      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-2.5 bg-gray-50/60 dark:bg-gray-900/30">
        {puedeMover ? (
          <button
            onClick={toggleEstado}
            className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition ${
              enRevision
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}>
            {enRevision ? <><Clock size={14} /> Volver a "Por hacer"</> : <><CheckCircle2 size={14} /> Marcar "En revisión"</>}
          </button>
        ) : (
          <p className="text-center text-[11px] text-gray-400 dark:text-gray-500 py-1">
            {a.estado === 'aprobado' ? '✓ Aprobado por el equipo' : '✓ Publicado'}
          </p>
        )}
      </div>
    </div>
  );
}

export default function CreatorWorkspace({ user, onLogout, addToast, darkMode, toggleDarkMode }) {
  const [, force] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => subscribeProduccion(() => force(x => x + 1)), []);

  // Semanas con tarjetas (más reciente primero). Aseguramos la semana actual.
  const weeks = useMemo(() => {
    const set = new Set(allWeekKeys());
    return [...set].sort().reverse();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const thisWeek = weekKeyOf();
  const grupos = weeks
    .map(wk => ({ wk, cards: listAssignments(wk).sort((a, b) => (a.productoNombre || '').localeCompare(b.productoNombre || '', 'es')) }))
    .filter(g => g.cards.length > 0);

  const totalCards = grupos.reduce((n, g) => n + g.cards.length, 0);

  const doRefresh = async () => {
    setRefreshing(true);
    try { await refreshProduccion(); } finally { setRefreshing(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur bg-white/80 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center text-white shrink-0">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-gray-900 dark:text-white leading-tight truncate">Producción</h1>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">Hola, {user?.name || 'equipo'} 👋</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={doRefresh} title="Actualizar"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button onClick={toggleDarkMode} title="Tema"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition">
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={onLogout} title="Salir"
              className="p-2 rounded-lg text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {totalCards === 0 ? (
          <div className="text-center py-24">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Film size={24} className="text-gray-400" />
            </div>
            <h2 className="font-bold text-gray-700 dark:text-gray-200">Todavía no tenés productos asignados</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-xs mx-auto">
              Cuando el equipo te asigne productos de la semana, van a aparecer acá para que subas los creativos.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {grupos.map(({ wk, cards }) => (
              <section key={wk}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">{weekLabel(wk)}</h2>
                  {wk === thisWeek && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300 rounded-full px-2 py-0.5">
                      esta semana
                    </span>
                  )}
                  <span className="text-[11px] text-gray-400">· {cards.length} producto{cards.length === 1 ? '' : 's'}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {cards.map(a => <CreatorCard key={a.id} a={a} addToast={addToast} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
