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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Film, LogOut, Moon, Sun, RefreshCw, CheckCircle2, Clock, ChevronDown, ChevronRight, Sparkles, ExternalLink, AlertTriangle, Wallet, X, FileText, UploadCloud, Loader2, FolderOpen, Star,
} from 'lucide-react';
import {
  subscribeProduccion, allWeekKeys, listAssignments, weekLabel, weekKeyOf,
  ESTADO_LABELS, ESTADOS_CREATOR, updateAssignment, refreshProduccion, esCompleto,
  monthKeyOf, monthLabel, weeksInMonth, pagoProductoDe, bonusDe,
  resumenVideosPorProducto, VIDEOS_POR_PRODUCTO,
} from './produccionStore.js';
import { CreativosSection } from './produccionUpload.jsx';
import { numerarDuplicados, columnaEfectiva } from './produccionCalc.js';
import TarjetaProduccion, { CAPS_EDITOR } from './produccionCard.jsx';
import { registrarColoresPersonas } from './produccionColors.js';

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

// Columnas del tablero del editor (mismo orden que ve el admin).
const COLS_CREATOR = [
  { key: 'porhacer', label: 'Por hacer', dot: 'bg-slate-400' },
  { key: 'revision', label: 'En revisión', dot: 'bg-amber-400' },
  { key: 'aprobado', label: 'Aprobado', dot: 'bg-emerald-500' },
  { key: 'publicado', label: 'Publicado', dot: 'bg-violet-500' },
  { key: 'archivado', label: 'Archivado', dot: 'bg-gray-400' },
];

// Detalle de la tarjeta para el editor: la CONSIGNA del producto (lo que el
// admin le quiere pasar), los cambios pedidos, y la zona para subir los videos.
function CreatorCardDetail({ a, num, onClose, addToast }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const puedeMover = ESTADOS_CREATOR.includes(a.estado);
  const enRevision = a.estado === 'revision';
  const folderLink = (a.archivos || []).find(f => f.folderLink)?.folderLink;
  const brief = (a.brief || '').trim();
  // Regla: no se pasa a "En revisión" hasta subir los N videos.
  const nVideos = (a.archivos || []).length;
  const objetivo = a.videosTotal || VIDEOS_POR_PRODUCTO;
  const completo = nVideos >= objetivo;
  const toggleEstado = () => {
    if (!enRevision && !completo) {
      addToast?.({ type: 'warning', message: `Faltan videos: subí los ${objetivo} para pasar a revisión (${nVideos}/${objetivo}).` });
      return;
    }
    updateAssignment(a.id, { estado: enRevision ? 'porhacer' : 'revision' });
    addToast?.({ type: 'success', message: enRevision ? 'Volviste la tarjeta a "Por hacer"' : '¡Listo! Pasó a "En revisión"' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg my-6 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <Film size={18} className="text-pink-500 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 leading-tight">{a.productoNombre || 'Producto'}{num ? <span className="text-brand-500"> #{num}</span> : ''}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <EstadoBadge estado={a.estado} />
              <span className="text-[11px] text-gray-400">{a.tipo === 'testeo' ? 'Testeo' : 'Renovado'} · {weekLabel(a.weekKey)}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto">
          {/* Material del producto: carpeta de Drive con todo el contenido. */}
          {(a.materialLink || '').trim() && (
            <a href={a.materialLink.trim()} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-pink-300 dark:border-pink-800 bg-pink-50 dark:bg-pink-900/20 px-3 py-2.5 hover:bg-pink-100 dark:hover:bg-pink-900/30 transition">
              <FolderOpen size={16} className="text-pink-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold uppercase text-pink-700 dark:text-pink-300">Material del producto</div>
                <div className="text-xs text-pink-600 dark:text-pink-400">Abrí la carpeta de Drive con todo el contenido</div>
              </div>
              <ExternalLink size={14} className="text-pink-500 shrink-0" />
            </a>
          )}
          {(a.nota || '').trim() && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300 mb-1"><AlertTriangle size={12} /> Hay que corregir</div>
              <p className="text-sm text-amber-800 dark:text-amber-200 whitespace-pre-wrap">{a.nota}</p>
            </div>
          )}

          {/* Winners de referencia: los creativos que vendieron de este producto,
              para inspirarte / renovarlos. */}
          {(a.winners || []).length > 0 && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-900/15 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300 mb-1.5">
                <Star size={12} fill="currentColor" /> Winners de referencia · {a.winners.length}
              </div>
              <div className="space-y-1.5">
                {a.winners.map(w => (
                  <a key={w.driveId || w.link || w.name} href={w.link || '#'} target="_blank" rel="noopener noreferrer"
                    className={`flex items-center gap-2 rounded-md bg-white/70 dark:bg-gray-800/50 px-2.5 py-1.5 ${w.link ? 'hover:bg-white dark:hover:bg-gray-800 transition' : 'pointer-events-none opacity-70'}`}>
                    <Star size={11} className="text-amber-500 shrink-0" fill="currentColor" />
                    <span className="flex-1 min-w-0 truncate text-xs font-medium text-gray-800 dark:text-gray-100" title={w.name}>{w.name}</span>
                    {w.link && <ExternalLink size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />}
                  </a>
                ))}
              </div>
              <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 mt-1.5">Esto es lo que funcionó — usalo de base para renovar.</p>
            </div>
          )}

          {/* Consigna / guiones — LA info del producto que le pasa el admin */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileText size={14} className="text-brand-500" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Lo que tenés que hacer</span>
            </div>
            {brief ? (
              <pre className="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 leading-relaxed font-sans">{brief}</pre>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic">El equipo todavía no cargó la consigna. Consultá antes de arrancar.</p>
            )}
          </div>

          {/* Creativos: subir/ver videos (misma sección que ve el admin). Trae su
              propio header "CREATIVOS" + link a la carpeta de Drive + dropzone. */}
          <CreativosSection a={a} addToast={addToast} canDelete readOnly={!puedeMover} />
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3 bg-gray-50/60 dark:bg-gray-900/40">
          {puedeMover ? (
            !enRevision && !completo ? (
              <div className="text-center">
                <button disabled
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-bold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed">
                  <Clock size={15} /> Faltan {objetivo - nVideos} video{objetivo - nVideos === 1 ? '' : 's'} para revisión
                </button>
                <p className="text-[11px] text-gray-400 mt-1.5">Subí los {objetivo} videos y pasa a revisión solo.</p>
              </div>
            ) : (
              <button onClick={toggleEstado}
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-bold rounded-lg transition ${enRevision ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600' : 'bg-amber-500 text-white hover:bg-amber-600'}`}>
                {enRevision ? <><Clock size={15} /> Volver a "Por hacer"</> : <><CheckCircle2 size={15} /> Marcar "En revisión"</>}
              </button>
            )
          ) : (
            <p className="text-center text-sm font-semibold text-gray-400 dark:text-gray-500">{a.estado === 'aprobado' ? '✓ Aprobado por el equipo' : '✓ Publicado'}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CreatorWorkspace({ user, onLogout, addToast, darkMode, toggleDarkMode }) {
  const [, force] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [detailId, setDetailId] = useState(null); // tarjeta abierta en el detalle
  const [mostrarArch, setMostrarArch] = useState(false); // columna Archivado (oculta por defecto)

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
  const allCards = grupos.flatMap(g => g.cards);
  const numMap = numerarDuplicados(allCards);
  // Registrar los colores de las personas visibles, para que la tarjeta se tinte
  // con el mismo criterio que en el tablero del admin.
  registrarColoresPersonas(allCards.map(a => a.persona));
  const detailCard = allCards.find(a => a.id === detailId) || null;

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
  let completadosMes = 0, bonusMes = 0, videosMes = 0, ganadoProductos = 0;
  for (const wk of weeksInMonth(monthKey)) {
    const cards = listAssignments(wk);
    // Agrupamos por persona (normalmente una sola para el editor) para aplicar
    // su monto y bono propios.
    const byPer = {};
    for (const a of cards) { const p = a.persona || ''; (byPer[p] = byPer[p] || []).push(a); }
    for (const p in byPer) {
      const comp = byPer[p].filter(a => esCompleto(a.estado)).length;
      completadosMes += comp;
      ganadoProductos += comp * pagoProductoDe(p);
      bonusMes += bonusDe(p, comp);
    }
    videosMes += cards.reduce((n, a) => n + (a.archivos?.length || 0), 0);
  }
  const ganadoMes = ganadoProductos + bonusMes;
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
                Según tu tarifa por producto aprobado + tu bono por objetivo. Es tu total del mes (antes de que te lo transfieran).
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
              <div className="space-y-4">
                {/* Resumen: cuántos videos faltan por producto */}
                <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Film size={15} className="text-emerald-500" />
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Videos por producto</h3>
                  </div>
                  <div className="space-y-2.5">
                    {resumenVideosPorProducto(allCards).map(r => {
                      const pct = r.target > 0 ? Math.round((r.subidos / r.target) * 100) : 0;
                      return (
                        <div key={r.producto}>
                          <div className="flex items-center justify-between text-xs mb-1 gap-2">
                            <span className="font-semibold text-gray-800 dark:text-gray-100 truncate">
                              {r.producto}
                              {r.tarjetas > 1 && <span className="font-normal text-gray-400 dark:text-gray-500"> · {r.tarjetas} tarjetas</span>}
                            </span>
                            <span className="tabular-nums text-gray-500 dark:text-gray-400 shrink-0">{r.subidos}/{r.target} · faltan {r.faltan}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tablero por estado (como lo ve el admin). Tocá una tarjeta para
                    ver la consigna y subir los videos. Lo publicado hace +48h se
                    muestra solo en Archivado (columnaEfectiva). */}
                {(() => {
                  const now = Date.now();
                  const nArch = allCards.filter(a => columnaEfectiva(a, now) === 'archivado').length;
                  const colsVis = mostrarArch ? COLS_CREATOR : COLS_CREATOR.filter(c => c.key !== 'archivado');
                  return (
                <>
                <div className="flex justify-end">
                  <button onClick={() => setMostrarArch(v => !v)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg border transition ${mostrarArch ? 'border-gray-400 text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700' : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                    📦 {mostrarArch ? 'Ocultar archivado' : 'Archivado'}{nArch > 0 ? ` · ${nArch}` : ''}
                  </button>
                </div>
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${mostrarArch ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
                {colsVis.map(col => {
                  const cards = allCards
                    .filter(a => columnaEfectiva(a, now) === col.key)
                    .sort((x, y) => (y.weekKey || '').localeCompare(x.weekKey || '') || (x.productoNombre || '').localeCompare(y.productoNombre || '', 'es'));
                  return (
                    <div key={col.key} className="rounded-2xl bg-gray-100/70 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/60 p-2.5">
                      <div className="flex items-center gap-2 px-1 pb-2">
                        <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                        <span className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">{col.label}</span>
                        <span className="ml-auto text-[11px] font-bold text-gray-400 tabular-nums">{cards.length}</span>
                      </div>
                      <div className="space-y-2 min-h-[44px]">
                        {cards.length === 0
                          ? <p className="text-[11px] text-gray-400 dark:text-gray-600 text-center py-3">—</p>
                          : cards.map(a => <TarjetaProduccion key={a.id} a={a} num={numMap[a.id]} caps={CAPS_EDITOR} onOpen={() => setDetailId(a.id)} addToast={addToast} />)}
                      </div>
                    </div>
                  );
                })}
                </div>
                </>
                );
                })()}
              </div>
            )}
          </div>
      </main>

      {detailCard && (
        <CreatorCardDetail a={detailCard} num={numMap[detailCard.id]} onClose={() => setDetailId(null)} addToast={addToast} />
      )}
    </div>
  );
}
