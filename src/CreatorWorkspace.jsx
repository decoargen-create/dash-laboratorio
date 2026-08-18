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
  Film, LogOut, Moon, Sun, RefreshCw, CheckCircle2, Clock, ChevronDown, ChevronRight, Sparkles, ExternalLink, AlertTriangle, Wallet,
} from 'lucide-react';
import {
  subscribeProduccion, allWeekKeys, listAssignments, weekLabel, weekKeyOf,
  ESTADO_LABELS, ESTADOS_CREATOR, updateAssignment, refreshProduccion, esCompleto,
  monthKeyOf, monthLabel, weeksInMonth, bonusObjetivo, PAGO_POR_PRODUCTO,
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
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${ESTADO_BADGE[estado] || ESTADO_BADGE.porhacer}`}>
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
  const aprob = Math.min(a.videosAprobados || 0, nSubidos);
  const folderLink = (a.archivos || []).find(f => f.folderLink)?.folderLink;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 dark:text-white truncate">{a.productoNombre || 'Producto'}</h3>
            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="uppercase font-semibold tracking-wide">{a.tipo === 'testeo' ? 'Testeo' : 'Renovado'}</span>
              <span>·</span>
              <span>{weekLabel(a.weekKey)}</span>
            </div>
          </div>
          <EstadoBadge estado={a.estado} />
        </div>

        {/* Cambios pedidos por el equipo — bien visible */}
        {(a.nota || '').trim() && (
          <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300 mb-0.5"><AlertTriangle size={11} /> Hay que corregir</div>
            <p className="text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">{a.nota}</p>
          </div>
        )}

        {/* Meta: subidos + aprobados + link a Drive */}
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-3 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Film size={12} className="text-emerald-500" />
            <b className="text-gray-700 dark:text-gray-200">{nSubidos}</b> subido{nSubidos === 1 ? '' : 's'}
          </span>
          {nSubidos > 0 && (
            <span className="inline-flex items-center gap-1" title="Aprobados por el equipo">
              <CheckCircle2 size={12} className={aprob >= nSubidos ? 'text-emerald-500' : 'text-gray-400'} />
              <b className="text-gray-700 dark:text-gray-200">{aprob}/{nSubidos}</b> aprob.
            </span>
          )}
          {folderLink && (
            <a href={folderLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-bold text-brand-600 dark:text-brand-300 hover:underline">
              <ExternalLink size={11} /> Ver en Drive
            </a>
          )}
        </div>

        {/* Brief (consignas / guiones) — solo lectura, colapsable */}
        {(a.brief || '').trim() && (
          <div className="mb-3">
            <button
              onClick={() => setOpenBrief(o => !o)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">
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
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-1">
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

  // Re-consulta al server cuando el editor vuelve a la pestaña y cada ~1 min.
  // Necesario porque una tarjeta recién asignada NO estaba en su vista (RLS), así
  // que el realtime no se la empuja: hay que re-fetchear para que aparezca sola.
  useEffect(() => {
    const refetch = () => { refreshProduccion().catch(() => {}); };
    window.addEventListener('focus', refetch);
    const iv = setInterval(refetch, 60000);
    return () => { window.removeEventListener('focus', refetch); clearInterval(iv); };
  }, []);

  // Semanas con tarjetas (más reciente primero). Se calcula en cada render (no
  // memoizar con []: al primer login el cache está vacío hasta que hidrata, y
  // un memo congelado dejaría el tablero vacío para siempre).
  const weeks = [...new Set(allWeekKeys())].sort().reverse();

  const thisWeek = weekKeyOf();
  const grupos = weeks
    .map(wk => ({ wk, cards: listAssignments(wk).sort((a, b) => (a.productoNombre || '').localeCompare(b.productoNombre || '', 'es')) }))
    .filter(g => g.cards.length > 0);

  const totalCards = grupos.reduce((n, g) => n + g.cards.length, 0);

  // Resumen motivador de la semana (aprobados + cuánto falta para el bonus) +
  // el avance propio (asignados / por hacer / en revisión).
  const cardsSemana = listAssignments(thisWeek);
  const aprobadosSemana = cardsSemana.filter(a => esCompleto(a.estado)).length;
  const asignadosSemana = cardsSemana.length;
  const porHacerSemana = cardsSemana.filter(a => a.estado === 'porhacer').length;
  const revisionSemana = cardsSemana.filter(a => a.estado === 'revision').length;
  const faltaBonus = aprobadosSemana < 3 ? 3 - aprobadosSemana : 0;

  // Resumen personal del MES (solo lo suyo — la RLS ya acota sus filas): cuánto
  // ganó (productos aprobados × $42k + bonus semanal por objetivo), cuántos
  // aprobó y cuántos videos subió.
  const monthKey = monthKeyOf();
  let completadosMes = 0, bonusMes = 0, videosMes = 0;
  for (const wk of weeksInMonth(monthKey)) {
    const cards = listAssignments(wk);
    const comp = cards.filter(a => esCompleto(a.estado)).length;
    completadosMes += comp;
    bonusMes += bonusObjetivo(comp);
    videosMes += cards.reduce((n, a) => n + (a.archivos?.length || 0), 0);
  }
  const ganadoMes = completadosMes * PAGO_POR_PRODUCTO + bonusMes;
  const fmtArs = (n) => '$' + Math.round(n).toLocaleString('es-AR');

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
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Hola, {user?.name || 'equipo'} 👋</p>
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
        <div className="space-y-8">
            {/* Resumen motivador de la semana */}
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 text-white px-4 py-3 flex items-center gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} />
              </div>
              <div className="text-sm leading-tight flex-1">
                <div className="font-bold">{aprobadosSemana} aprobado{aprobadosSemana === 1 ? '' : 's'} esta semana</div>
                <div className="text-white/80 text-[12px]">
                  {faltaBonus > 0
                    ? `Te falta${faltaBonus === 1 ? '' : 'n'} ${faltaBonus} para el bonus 🎯`
                    : '¡Bonus conseguido! Seguí sumando 🎉'}
                </div>
              </div>
              {/* Tu avance de la semana */}
              <div className="hidden sm:flex items-stretch gap-1.5 text-center">
                {[['Asignados', asignadosSemana], ['Por hacer', porHacerSemana], ['Revisión', revisionSemana], ['Aprob.', aprobadosSemana]].map(([lab, val]) => (
                  <div key={lab} className="rounded-lg bg-white/15 px-2.5 py-1 min-w-[52px]">
                    <div className="text-base font-extrabold tabular-nums leading-none">{val}</div>
                    <div className="text-[10px] uppercase tracking-wide text-white/75 mt-0.5">{lab}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tu resumen personal del mes (plata + cantidades) — solo tuyo. */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shrink-0"><Wallet size={16} /></div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Tu resumen del mes</h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 capitalize">{monthLabel(monthKey)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700/70 dark:text-emerald-400/70 mb-1">Ganado</div>
                  <div className="text-lg md:text-xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">{fmtArs(ganadoMes)}</div>
                </div>
                <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">Aprobados</div>
                  <div className="text-lg md:text-xl font-extrabold tabular-nums text-gray-900 dark:text-gray-100">{completadosMes}</div>
                </div>
                <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">Videos subidos</div>
                  <div className="text-lg md:text-xl font-extrabold tabular-nums text-gray-900 dark:text-gray-100">{videosMes}</div>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2.5">
                $42.000 por producto aprobado + bonus por objetivo semanal. Es tu total del mes (antes de que te lo transfieran).
              </p>
            </div>

            {totalCards === 0 ? (
              <div className="text-center py-16 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-white/40 dark:bg-gray-800/30">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <Film size={24} className="text-gray-400" />
                </div>
                <h2 className="font-bold text-gray-700 dark:text-gray-200">Todavía no tenés productos asignados</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-xs mx-auto">
                  Cuando el equipo te asigne productos de la semana, van a aparecer acá para que subas los creativos.
                </p>
              </div>
            ) : (
              grupos.map(({ wk, cards }) => (
                <section key={wk}>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">{weekLabel(wk)}</h2>
                    {wk === thisWeek && (
                      <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300 rounded-full px-2 py-0.5">
                        esta semana
                      </span>
                    )}
                    <span className="text-xs text-gray-400">· {cards.length} producto{cards.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {cards.map(a => <CreatorCard key={a.id} a={a} addToast={addToast} />)}
                  </div>
                </section>
              ))
            )}
          </div>
      </main>
    </div>
  );
}
