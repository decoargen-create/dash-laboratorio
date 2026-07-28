// Producción — tablero kanban del equipo creativo (estilo Trello).
//
// Cada tarjeta = 1 producto, con su persona (label de color), su brief a mano
// (consignas + guiones + links de Drive) y los creativos subidos. Las columnas
// son los estados: Por hacer → En revisión → Aprobado → Publicado. Arrastrás la
// tarjeta para cambiarle el estado. "Aprobado/Publicado" es lo que cuenta para
// el pago (que se ve en Área creativa → Resumen).
//
// Local por ahora. El login del equipo es Fase 2.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Film, Plus, X, Trash2, ChevronDown, UploadCloud, Loader2, CheckCircle2,
  AlertTriangle, ExternalLink, FileText, GripVertical, Users, History, Search, ArrowLeftRight,
} from 'lucide-react';
import {
  ESTADOS, ESTADO_LABELS, VIDEOS_POR_PRODUCTO, weekKeyOf, weekLabel, weekRange, allWeekKeys,
  listAssignments, addAssignment, updateAssignment, removeAssignment, assignPersona,
  assignCreator, subscribeProduccion, esCompleto, bonusObjetivo,
} from './produccionStore.js';
import { CreativosSection, subirParaTarjeta, VIDEO_ACCEPT } from './produccionUpload.jsx';
import { listTeam } from './produccionTeam.js';
import TeamModal from './TeamModal.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

const EQUIPO_DEFAULT = ['Fran', 'Wanda', 'Flor'];

// Escape cierra el modal (detalle de uso: el user espera Esc en cualquier popup).
function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

const COLS = [
  { key: 'porhacer', emoji: '🎬', dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400', hdr: 'bg-slate-200/60 dark:bg-slate-700/30', empty: '🎬 Agregá productos y ¡acción!' },
  { key: 'revision', emoji: '👀', dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', hdr: 'bg-amber-100/70 dark:bg-amber-900/20', empty: '👀 Nada en revisión — todo al día' },
  { key: 'aprobado', emoji: '✅', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', hdr: 'bg-emerald-100/70 dark:bg-emerald-900/20', empty: '✅ Acá caen los aprobados' },
  { key: 'publicado', emoji: '🚀', dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', hdr: 'bg-violet-100/70 dark:bg-violet-900/20', empty: '🚀 Listos para despegar' },
];

const PERSONA_PALETTE = ['amber', 'violet', 'sky', 'emerald', 'rose', 'indigo', 'teal'];
function personaColor(name) {
  if (!name) return 'gray';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PERSONA_PALETTE[h % PERSONA_PALETTE.length];
}
const CHIP_CLS = {
  amber: 'bg-amber-400 text-amber-950', violet: 'bg-violet-500 text-white',
  sky: 'bg-sky-500 text-white', emerald: 'bg-emerald-500 text-white',
  rose: 'bg-rose-500 text-white', indigo: 'bg-indigo-500 text-white',
  teal: 'bg-teal-500 text-white',
  gray: 'bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-200',
};
const PersonaChip = ({ persona, onClick, small }) => (
  <button onClick={onClick}
    className={`inline-flex items-center rounded font-bold uppercase tracking-wide ${small ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'} ${CHIP_CLS[personaColor(persona)]} ${onClick ? 'hover:opacity-80 transition' : ''}`}>
    {persona || 'Sin asignar'}
  </button>
);

// Badge de persona más grande y prolijo (avatar con inicial + nombre).
const PersonaBadge = ({ persona }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-0.5 ${CHIP_CLS[personaColor(persona)]}`}>
    <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[11px] font-black uppercase">
      {(persona || '?').charAt(0)}
    </span>
    <span className="text-[12px] font-extrabold">{persona || 'Sin asignar'}</span>
  </span>
);

// Resumen de la semana: cuántas tarjetas tiene cada persona + progreso hacia el
// objetivo (productos aprobados) con el bonus semanal.
// Formatea una duración en ms → "6 h" / "1.5 d".
function fmtDur(ms) {
  if (ms == null) return '—';
  const h = ms / 3600000;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

// Panel VERTICAL por persona: una fila por creativo con asignados, por hacer,
// en revisión y objetivo (aprobados/asignados) + su ritmo (tiempo prom).
// Las clases grid-cols van LITERALES (Tailwind no genera clases interpoladas).
function ResumenSemana({ asigs, filtroSinAsignar = false, onToggleSinAsignar }) {
  const { rows, sinAsignar, total, totals } = useMemo(() => {
    const now = Date.now();
    const by = {};
    let sin = 0;
    asigs.forEach(a => {
      const p = (a.persona || '').trim();
      if (!p) { sin++; return; }
      if (!by[p]) by[p] = { persona: p, asignados: 0, porhacer: 0, revision: 0, completos: 0, tiempos: [], trabadas: 0 };
      const s = by[p];
      s.asignados++;
      if (a.estado === 'porhacer') s.porhacer++;
      else if (a.estado === 'revision') s.revision++;
      if (esCompleto(a.estado)) s.completos++;
      const hist = a.historial || [];
      const creadaTs = a.createdAt ? Date.parse(a.createdAt)
        : (hist.find(e => e.tipo === 'creacion')?.ts ? Date.parse(hist.find(e => e.tipo === 'creacion').ts) : NaN);
      const aprobEv = [...hist].reverse().find(e => e.tipo === 'estado' && e.to === 'aprobado');
      if (!Number.isNaN(creadaTs) && aprobEv?.ts) { const d = Date.parse(aprobEv.ts) - creadaTs; if (d > 0) s.tiempos.push(d); }
      if (a.estado === 'revision') {
        const revEv = [...hist].reverse().find(e => e.tipo === 'estado' && e.to === 'revision');
        const t = revEv?.ts ? Date.parse(revEv.ts) : (a.updatedAt ? Date.parse(a.updatedAt) : NaN);
        if (!Number.isNaN(t) && (now - t) > 24 * 3600 * 1000) s.trabadas++;
      }
    });
    const rows = Object.values(by).map(s => ({
      ...s,
      avg: s.tiempos.length ? s.tiempos.reduce((x, y) => x + y, 0) / s.tiempos.length : null,
      bonus: bonusObjetivo(s.completos),
    })).sort((a, b) => b.asignados - a.asignados);
    // Totales del equipo (el "resumen de los 3 juntos" arriba de las tarjetas).
    const totals = {
      asignados: asigs.length,
      porhacer: asigs.filter(a => a.estado === 'porhacer').length,
      revision: asigs.filter(a => a.estado === 'revision').length,
      aprobados: asigs.filter(a => esCompleto(a.estado)).length,
    };
    // Orden: quien más aprobó primero (ranking suave, motiva sin medallas).
    rows.sort((a, b) => b.completos - a.completos || b.asignados - a.asignados);
    return { rows, sinAsignar: sin, total: asigs.length, totals };
  }, [asigs]);

  // Plegable (se acuerda de tu preferencia entre sesiones).
  const [plegado, setPlegado] = useState(() => {
    try { return localStorage.getItem('adslab-prod-resumen-plegado') === '1'; } catch { return false; }
  });
  const togglePlegado = () => setPlegado(v => {
    const n = !v;
    try { localStorage.setItem('adslab-prod-resumen-plegado', n ? '1' : '0'); } catch {}
    return n;
  });

  if (total === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* Resumen del EQUIPO (todos juntos) */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mr-auto">Semana del equipo</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            ['Asignados', totals.asignados, 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200'],
            ['Por hacer', totals.porhacer, 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300'],
            ['Revisión', totals.revision, 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'],
            ['Aprobados', totals.aprobados, 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'],
          ].map(([lab, val, cls]) => (
            <span key={lab} className={`inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1 font-bold ${cls}`}>
              <span className="tabular-nums text-sm leading-none">{val}</span>
              <span className="text-[10px] uppercase tracking-wide opacity-80">{lab}</span>
            </span>
          ))}
          {sinAsignar > 0 && (
            <button onClick={onToggleSinAsignar}
              title={filtroSinAsignar ? 'Quitar el filtro' : 'Ver solo las tarjetas sin asignar'}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${filtroSinAsignar ? 'bg-amber-500 text-white ring-2 ring-amber-300 dark:ring-amber-700' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60'}`}>
              <AlertTriangle size={10} /> {sinAsignar} sin asignar
            </button>
          )}
        </div>
        <button onClick={togglePlegado} title={plegado ? 'Mostrar el detalle por persona' : 'Plegar'}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <ChevronDown size={14} className={`transition-transform ${plegado ? '-rotate-90' : ''}`} />
        </button>
      </div>

      {/* Tarjeta por persona — piel "Estudio creativo": degradé de marca, anillo
          grande con gradiente, celdas de estado, MVP 👑 al que más aprobó. */}
      {!plegado && (rows.length === 0 ? (
        <p className="text-xs text-gray-400 px-4 py-3">Asigná tarjetas a cada uno para ver su avance.</p>
      ) : (
        <div className="flex gap-3 p-3 overflow-x-auto">
          {rows.map((s, idx) => {
            const pct = s.asignados ? Math.round((s.completos / s.asignados) * 100) : 0;
            const faltaBonus = Math.max(0, 3 - s.completos);
            const esMVP = idx === 0 && s.completos > 0;
            const copyPct = pct >= 100 ? 'objetivo cumplido ✨'
              : pct >= 80 ? `¡a un paso! (${pct}%)`
              : pct === 0 ? 'arrancando la semana'
              : `${pct}% del objetivo`;
            return (
              <div key={s.persona}
                className="relative min-w-[218px] max-w-[270px] flex-1 rounded-2xl border border-pink-200/50 dark:border-white/10 bg-gradient-to-br from-pink-500/10 via-violet-500/5 to-transparent p-3 flex flex-col gap-2.5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-pink-900/10">
                {esMVP && (
                  <span className="absolute -top-2 right-3 text-[10px] font-black uppercase tracking-wide bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 rounded-full px-2 py-0.5 shadow" title="La persona con más aprobados de la semana">
                    👑 MVP
                  </span>
                )}
                <div className="flex items-center gap-3">
                  {/* Anillo grande con gradiente de marca */}
                  <div className="w-14 h-14 rounded-full grid place-items-center shrink-0"
                    style={{ background: `conic-gradient(#ec4899, #f43f5e ${pct}%, rgba(127,140,170,.25) 0)` }}
                    title={`${pct}% de su objetivo aprobado`}>
                    <div className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 grid place-items-center text-[13px] font-extrabold tabular-nums text-gray-800 dark:text-gray-100">
                      {s.completos}/{s.asignados}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <span className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-0.5 text-xs font-bold ${CHIP_CLS[personaColor(s.persona)]}`}>
                      <span className="w-4 h-4 rounded-full bg-black/20 flex items-center justify-center text-[10px] font-black">{s.persona.charAt(0).toUpperCase()}</span>
                      {s.persona}
                    </span>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{copyPct}</div>
                  </div>
                </div>

                {/* Estados como celdas (número grande + micro-etiqueta) */}
                <div className="flex gap-1.5 text-center">
                  {[
                    ['por hacer', s.porhacer, 'bg-slate-200/60 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300'],
                    ['revisión', s.revision, 'bg-amber-100/80 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'],
                    ['aprob.', s.completos, 'bg-emerald-100/80 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'],
                  ].map(([lab, val, cls]) => (
                    <div key={lab} className={`flex-1 rounded-lg py-1 ${cls}`} title={`${val} ${lab}`}>
                      <div className="text-sm font-extrabold tabular-nums leading-none">{val}</div>
                      <div className="text-[9.5px] uppercase tracking-wide opacity-80 mt-0.5">{lab}</div>
                    </div>
                  ))}
                </div>

                {/* Pie: bonus + ritmo */}
                <div className="flex items-center justify-between border-t border-gray-200/60 dark:border-white/10 pt-2 text-[11px]">
                  {s.bonus > 0
                    ? <span className="font-extrabold text-emerald-600 dark:text-emerald-400">🎯 ¡Bonus!</span>
                    : <span className="text-gray-400">{faltaBonus} más y hay bonus 🎯</span>}
                  <span className="flex items-center gap-2 text-gray-400 tabular-nums">
                    {s.avg != null && <span title="Tiempo prom. a aprobado">⏱ {fmtDur(s.avg)}</span>}
                    {s.trabadas > 0 && <span className="text-amber-600 dark:text-amber-400 font-bold" title="Trabadas +24h en revisión">🐢 {s.trabadas}</span>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function readProductos() {
  try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]'); }
  catch { return []; }
}

export default function ProduccionSection({ addToast }) {
  const [, force] = useState(0);
  const [productos] = useState(() => readProductos());
  const [weekKey, setWeekKey] = useState(() => weekKeyOf());
  const [showAdd, setShowAdd] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showReasignar, setShowReasignar] = useState(false);
  const [team, setTeam] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  // Filtro rápido: mostrar solo las tarjetas sin repartir (click en el chip
  // "N sin asignar" del resumen).
  const [soloSinAsignar, setSoloSinAsignar] = useState(false);

  useEffect(() => {
    const un = subscribeProduccion(() => force(x => x + 1));
    return un;
  }, []);

  // Cargamos el equipo (creators) para poder asignar tarjetas a una cuenta.
  const reloadTeam = () => { listTeam().then(setTeam).catch(() => {}); };
  useEffect(reloadTeam, []);

  const semanas = useMemo(() => {
    const keys = new Set(allWeekKeys());
    keys.add(weekKeyOf());
    return [...keys].sort().reverse();
  }, [weekKey]); // eslint-disable-line

  const asigs = listAssignments(weekKey);
  const detail = asigs.find(a => a.id === detailId) || null;
  const nAprobSemana = asigs.filter(a => esCompleto(a.estado)).length;

  const personas = useMemo(() => {
    const set = new Set(EQUIPO_DEFAULT);
    allWeekKeys().forEach(wk => listAssignments(wk).forEach(a => { if (a.persona) set.add(a.persona); }));
    productos.forEach(p => { const r = (p.responsable || '').trim(); if (r) set.add(r); });
    return [...set];
  }, [weekKey, productos]); // eslint-disable-line

  const asigsBoard = useMemo(
    () => soloSinAsignar ? asigs.filter(a => !(a.persona || '').trim() && !a.creatorId) : asigs,
    [asigs, soloSinAsignar],
  );
  const byCol = useMemo(() => {
    const m = { porhacer: [], revision: [], aprobado: [], publicado: [] };
    for (const a of asigsBoard) (m[a.estado] || m.porhacer).push(a);
    return m;
  }, [asigsBoard]);

  const onDrop = (e, colKey) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/prod-id');
    if (id) updateAssignment(id, { estado: colKey });
  };

  return (
    <div className="max-w-full space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
          <Film size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Producción</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {asigs.length === 0
              ? 'Armá la semana: agregá productos y repartilos 🎬'
              : <>{asigs.length} en juego · <b className="text-emerald-600 dark:text-emerald-400">{nAprobSemana} aprobado{nAprobSemana === 1 ? '' : 's'}</b> esta semana {nAprobSemana > 0 ? '🔥' : '🎬'}</>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select value={weekKey} onChange={e => setWeekKey(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              {semanas.map(wk => <option key={wk} value={wk}>{weekLabel(wk)}{wk === weekKeyOf() ? ' (esta semana)' : ''}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={() => setShowReasignar(true)} title="Mover todas las tarjetas de una persona a otra"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition shadow-sm">
            <ArrowLeftRight size={14} /> Reasignar
          </button>
          <button onClick={() => setShowTeam(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition shadow-sm">
            <Users size={14} /> Equipo
          </button>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg hover:from-brand-600 hover:to-brand-800 transition shadow-sm">
            <Plus size={14} /> Agregar producto
          </button>
        </div>
      </div>

      {/* Resumen de la semana: carga por persona + objetivo */}
      <ResumenSemana asigs={asigs} filtroSinAsignar={soloSinAsignar}
        onToggleSinAsignar={() => setSoloSinAsignar(v => !v)} />

      {/* Aviso de filtro activo */}
      {soloSinAsignar && (
        <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5">
          <AlertTriangle size={12} /> Mostrando solo lo sin asignar
          <button onClick={() => setSoloSinAsignar(false)} className="ml-auto inline-flex items-center gap-1 hover:underline">
            <X size={12} /> quitar filtro
          </button>
        </div>
      )}

      {/* Tablero: en desktop, 4 columnas EXACTAMENTE iguales (grid); en
          pantallas chicas cae a scroll horizontal. */}
      <div className="flex gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {COLS.map(col => {
          const cards = byCol[col.key] || [];
          return (
            <div key={col.key}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(col.key); }}
              onDragLeave={() => setDragOver(d => d === col.key ? null : d)}
              onDrop={e => onDrop(e, col.key)}
              className={`flex-1 min-w-[240px] lg:min-w-0 rounded-xl p-2.5 transition ${dragOver === col.key ? 'bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-300 dark:ring-brand-700' : 'bg-gray-50 dark:bg-gray-800/40'}`}>
              {/* Cabecera tintada con el color del estado: se reconoce por zona */}
              <div className={`flex items-center gap-2 px-2.5 py-1.5 mb-2 rounded-lg ${col.hdr}`}>
                <span className="text-sm leading-none">{col.emoji}</span>
                <span className={`text-xs font-bold uppercase tracking-wide ${col.text}`}>{ESTADO_LABELS[col.key]}</span>
                <span className="ml-auto text-xs font-mono text-gray-400 tabular-nums">{cards.length}</span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {cards.map(a => (
                  <KanbanCard key={a.id} a={a} personas={personas} team={team} addToast={addToast}
                    onOpen={() => setDetailId(a.id)}
                    onAssign={(p) => assignPersona(a.id, p)} />
                ))}
                {cards.length === 0 && (
                  <div className="text-center text-xs text-gray-300 dark:text-gray-600 py-4 select-none">
                    {col.empty}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <AgregarProductoModal productos={productos} personas={personas} team={team} asigs={asigs} weekKey={weekKey}
          onClose={() => setShowAdd(false)} addToast={addToast} />
      )}
      {detail && (
        <CardDetailModal a={detail} personas={personas} team={team} onClose={() => setDetailId(null)} addToast={addToast} />
      )}
      {showTeam && (
        <TeamModal onClose={() => { setShowTeam(false); reloadTeam(); }} addToast={addToast} />
      )}
      {showReasignar && (
        <ReasignarModal asigs={asigs} team={team} weekKey={weekKey}
          onClose={() => setShowReasignar(false)} addToast={addToast} />
      )}
    </div>
  );
}

function KanbanCard({ a, personas, team = [], onOpen, onAssign, addToast }) {
  const [menu, setMenu] = useState(false);
  const [menuQ, setMenuQ] = useState('');
  const [moveMenu, setMoveMenu] = useState(false);
  const [prog, setProg] = useState(null); // { i, total } mientras sube
  const fileRef = useRef(null);

  // Los menús desplegables se cierran con Esc o click en cualquier otro lado
  // (los clicks internos no llegan acá: los wrappers hacen stopPropagation).
  useEffect(() => {
    if (!menu && !moveMenu) return;
    const cerrar = () => { setMenu(false); setMoveMenu(false); setMenuQ(''); };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', cerrar);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', cerrar); };
  }, [menu, moveMenu]);
  const subidos = a.archivos?.length || 0;
  const aprob = Math.min(a.videosAprobados || 0, subidos);
  const folderLink = (a.archivos || []).find(f => f.folderLink)?.folderLink;

  // ¿Trabada? +24h desde que entró a "En revisión" → borde ámbar (urgencia).
  const trabada = (() => {
    if (a.estado !== 'revision') return false;
    const revEv = [...(a.historial || [])].reverse().find(e => e.tipo === 'estado' && e.to === 'revision');
    const t = revEv?.ts ? Date.parse(revEv.ts) : (a.updatedAt ? Date.parse(a.updatedAt) : NaN);
    return !Number.isNaN(t) && (Date.now() - t) > 24 * 3600 * 1000;
  })();

  const onPick = async (fileList) => {
    setProg({ i: 0, total: 0 });
    await subirParaTarjeta(a, fileList, {
      addToast,
      onProgress: ({ i, total }) => setProg({ i, total }),
    });
    setProg(null);
  };

  const aprobarTodos = (e) => {
    e.stopPropagation();
    updateAssignment(a.id, { videosAprobados: subidos, estado: 'aprobado' });
    addToast?.({ type: 'success', message: `🎉 ¡${a.productoNombre} aprobado! (${subidos}/${subidos}) — listo para despegar` });
  };
  const publicar = (e) => {
    e.stopPropagation();
    updateAssignment(a.id, { estado: 'publicado' });
    addToast?.({ type: 'success', message: `🚀 ${a.productoNombre} publicado — ¡a volar!` });
  };

  return (
    <div draggable={!prog}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/prod-id', a.id); }}
      onClick={() => onOpen()}
      className={`group bg-white dark:bg-gray-800 border rounded-xl p-2.5 shadow-sm hover:shadow-lg hover:shadow-pink-500/10 hover:-translate-y-0.5 transition cursor-pointer ${trabada ? 'border-amber-400/80 dark:border-amber-500/60 hover:border-amber-500' : 'border-gray-200 dark:border-gray-700 hover:border-pink-300 dark:hover:border-pink-700/70'}`}>
      {/* Título grande + persona a la derecha (como el mock del Estudio) */}
      <div className="flex items-start gap-1.5">
        <GripVertical size={14} className="text-gray-300 dark:text-gray-600 mt-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition cursor-grab active:cursor-grabbing" />
        <span className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-white leading-tight flex-1 min-w-0 truncate" title={a.productoNombre}>{a.productoNombre || 'Producto'}</span>
        <div className="relative shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {/* Aviso compacto: etiqueta sin cuenta → nadie la ve en su tablero */}
          {a.persona && !a.creatorId && (
            <span className="text-amber-500 cursor-help" title="Sin cuenta asignada: ningún creativo la ve en su tablero. Tocá el nombre y elegí una cuenta del equipo.">
              <AlertTriangle size={13} />
            </span>
          )}
          <span onClick={() => setMenu(v => !v)} className="cursor-pointer">
            <PersonaBadge persona={a.persona} />
          </span>
        {menu && (
          <div className="absolute right-0 top-8 z-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[140px]"
            onClick={e => e.stopPropagation()}>
            {team.length > 0 ? (
              <>
                {team.length > 5 && (
                  <input autoFocus value={menuQ} onChange={e => setMenuQ(e.target.value)} placeholder="Buscar…"
                    className="mb-0.5 px-2 py-1 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500" />
                )}
                {team
                  .filter(m => !menuQ.trim() || `${m.display_name || ''} ${m.email || ''}`.toLowerCase().includes(menuQ.trim().toLowerCase()))
                  .map(m => (
                    <button key={m.id} onClick={() => { assignCreator(a.id, { creatorId: m.id, persona: m.display_name || m.email }); setMenu(false); setMenuQ(''); }}
                      className={`text-left text-xs font-semibold px-2 py-1 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 whitespace-nowrap ${a.creatorId === m.id ? 'text-brand-600 dark:text-brand-300' : 'text-gray-700 dark:text-gray-200'}`}>
                      {a.creatorId === m.id ? '✓ ' : ''}{m.display_name || m.email}
                    </button>
                  ))}
              </>
            ) : (
              <>
                {personas.map(p => (
                  <button key={p} onClick={() => { onAssign(p); setMenu(false); }}
                    className="text-left text-xs font-semibold px-2 py-1 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 text-gray-700 dark:text-gray-200 whitespace-nowrap">{p}</button>
                ))}
                <div className="text-[10px] text-gray-400 px-2 py-1 border-t border-gray-100 dark:border-gray-700">Creá cuentas en "Equipo" para que las vean en su tablero.</div>
              </>
            )}
            {(a.persona || a.creatorId) && (
              <button onClick={() => { assignCreator(a.id, { creatorId: null, persona: '' }); setMenu(false); }}
                className="text-left text-xs px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 border-t border-gray-100 dark:border-gray-700 mt-0.5">Sin asignar</button>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Meta: subidos · aprobados ✓ · brief · trabada · botón de mover */}
      <div className="mt-2 pl-5 flex items-center gap-2.5 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1" title={`${subidos} creativos subidos`}>
          <Film size={12} className="text-emerald-500" /><b className="text-gray-700 dark:text-gray-200">{subidos}</b> subidos
        </span>
        {subidos > 0 && (
          <b className={`tabular-nums ${aprob >= subidos ? 'text-emerald-500' : 'text-gray-400'}`} title="Aprobados sobre subidos">
            {aprob}/{subidos}{aprob >= subidos ? ' ✓' : ''}
          </b>
        )}
        {a.brief?.trim() && <FileText size={12} className="text-gray-400" title="Tiene brief" />}
        {trabada && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400" title="Hace más de 24h que está en revisión">🐢 +24h</span>}
        {/* Mover de columna (clave en celular): punto de color + chevron */}
        <div className="relative ml-auto" onClick={e => e.stopPropagation()}>
          <button onClick={() => setMoveMenu(v => !v)} title={`${ESTADO_LABELS[a.estado]} — mover a…`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition">
            <span className={`w-1.5 h-1.5 rounded-full ${(COLS.find(c => c.key === a.estado) || COLS[0]).dot}`} />
            <ChevronDown size={10} />
          </button>
          {moveMenu && (
            <div className="absolute right-0 top-6 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[120px]">
              <span className="text-[9.5px] font-bold uppercase text-gray-400 px-2 pt-1">Mover a</span>
              {ESTADOS.map(e => (
                <button key={e} onClick={() => { updateAssignment(a.id, { estado: e }); setMoveMenu(false); }}
                  className={`text-left text-xs font-semibold px-2 py-1 rounded whitespace-nowrap ${a.estado === e ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                  {a.estado === e ? '✓ ' : ''}{ESTADO_LABELS[e]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {subidos > 0 && (
        <div className="mt-1.5 pl-5">
          <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((aprob / subidos) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Acciones CONTEXTUALES según columna — menos ruido con muchas tarjetas:
          Por hacer → Subir · Revisión → Subir + Aprobar · Aprobado → Publicar ·
          Publicado → solo Drive. (Subir sigue siempre disponible en el detalle.) */}
      <div className="mt-2.5 pl-5 flex items-stretch gap-1.5">
        {prog ? (
          <span className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold text-brand-600 dark:text-brand-400">
            <Loader2 size={12} className="animate-spin" /> Subiendo {prog.total ? `${prog.i + 1}/${prog.total}` : ''}…
          </span>
        ) : (a.estado === 'porhacer' || a.estado === 'revision') && (
          <button onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-extrabold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-lg transition shadow-sm">
            <UploadCloud size={13} /> Subir
          </button>
        )}
        {folderLink && (
          <a href={folderLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-extrabold text-gray-500 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:border-pink-400 hover:text-pink-600 dark:hover:text-pink-300 rounded-lg transition">
            ▶ Drive
          </a>
        )}
        {a.estado === 'revision' && subidos > 0 && (
          <button onClick={aprobarTodos}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-extrabold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-lg transition">
            <CheckCircle2 size={13} /> Aprobar
          </button>
        )}
        {a.estado === 'aprobado' && (
          <button onClick={publicar}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-extrabold text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 rounded-lg transition shadow-sm">
            🚀 Publicar
          </button>
        )}
      </div>

      <input ref={fileRef} type="file" accept={VIDEO_ACCEPT} multiple hidden
        onClick={e => e.stopPropagation()}
        onChange={e => { const fl = Array.from(e.target.files || []); e.target.value = ''; onPick(fl); }} />
    </div>
  );
}

// ── Agregar productos (crea tarjetas en "Por hacer"). Multi-selección: podés
// tildar varios productos y crearlos todos juntos con una sola vuelta.
function AgregarProductoModal({ productos, personas, team = [], asigs, weekKey, onClose, addToast }) {
  useEscape(onClose);
  const [selected, setSelected] = useState(() => new Set());
  // Multi-persona con MULTIPLICADOR: click en un chip cicla ×1 → ×2 → ×3 → sacar.
  // key = id de cuenta del equipo, o "p:Nombre" para etiquetas sin cuenta.
  const [counts, setCounts] = useState(() => new Map());
  const [q, setQ] = useState('');

  const yaEnSemana = useMemo(() => new Set(asigs.map(a => String(a.productoId))), [asigs]);
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? productos.filter(p => (p.nombre || '').toLowerCase().includes(t)) : productos;
  }, [productos, q]);

  const toggle = (id) => setSelected(prev => {
    const n = new Set(prev);
    const k = String(id);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const cycle = (key) => setCounts(prev => {
    const n = new Map(prev);
    const c = (n.get(key) || 0) + 1;
    if (c > 3) n.delete(key); else n.set(key, c);
    return n;
  });

  // Destinos activos (persona × cantidad). Sin ninguno → tarjetas sin asignar.
  const targets = [...counts.entries()].filter(([, c]) => c > 0);
  const copiasPorProducto = targets.reduce((s, [, c]) => s + c, 0) || 1;
  const totalTarjetas = selected.size * copiasPorProducto;

  const crear = () => {
    const ids = [...selected];
    if (ids.length === 0) { addToast?.({ type: 'warning', message: 'Elegí al menos un producto.' }); return; }
    let n = 0;
    ids.forEach(id => {
      const prod = productos.find(p => String(p.id) === id);
      if (!prod) return;
      if (targets.length === 0) {
        addAssignment({ weekKey, productoId: prod.id, productoNombre: prod.nombre, persona: '', creatorId: null });
        n++;
        return;
      }
      targets.forEach(([key, c]) => {
        const m = team.find(t => t.id === key);
        const per = m ? (m.display_name || m.email) : key.slice(2); // "p:Nombre"
        for (let i = 0; i < c; i++) {
          addAssignment({ weekKey, productoId: prod.id, productoNombre: prod.nombre, persona: per, creatorId: m ? m.id : null });
          n++;
        }
      });
    });
    addToast?.({ type: 'success', message: `🎬 ${n} tarjeta${n === 1 ? '' : 's'} creada${n === 1 ? '' : 's'} para ${weekLabel(weekKey)}` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <Plus size={16} className="text-brand-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Agregar productos a la semana</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">
              Productos {selected.size > 0 && <span className="text-brand-500">· {selected.size} elegido{selected.size === 1 ? '' : 's'}</span>}
            </span>
            {/* Buscador — filtra la lista por nombre */}
            <div className="relative mb-1.5">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar producto…"
                className="w-full pl-8 pr-8 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {q && (
                <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
              )}
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
              {productos.length === 0 && <p className="text-xs text-gray-400 p-3">No hay productos cargados.</p>}
              {productos.length > 0 && filtrados.length === 0 && <p className="text-xs text-gray-400 p-3">Nada coincide con «{q}».</p>}
              {filtrados.map(p => {
                const ya = yaEnSemana.has(String(p.id));
                const sel = selected.has(String(p.id));
                return (
                  <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input type="checkbox" checked={sel} onChange={() => toggle(p.id)} className="w-4 h-4 accent-brand-600" />
                    <span className="flex-1 text-gray-800 dark:text-gray-100 truncate">{p.nombre}</span>
                    {/* Repetir está PERMITIDO: Fran puede hacer Tiva ×2 y Wanda ×3.
                        Solo avisamos que ya tiene tarjetas esta semana. */}
                    {ya && <span className="text-[11px] text-gray-400" title="Ya tiene tarjetas esta semana — podés agregarle más igual">ya está · se puede repetir</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">
              ¿Para quién? <span className="normal-case font-medium text-gray-400">(tocá de nuevo para ×2 / ×3 — podés elegir a varios)</span>
            </span>
            {(() => {
              // Chips con multiplicador: sirven para cuentas del equipo y, si no
              // hay cuentas, para las etiquetas de siempre.
              const opciones = team.length > 0
                ? team.map(m => ({ key: m.id, nombre: m.display_name || m.email }))
                : personas.map(p => ({ key: `p:${p}`, nombre: p }));
              return (
                <div className="flex flex-wrap gap-1.5">
                  {opciones.map(({ key, nombre }) => {
                    const c = counts.get(key) || 0;
                    return (
                      <button key={key} onClick={() => cycle(key)}
                        title={c === 0 ? `Asignarle a ${nombre}` : c < 3 ? `${nombre} ×${c} — tocá para ×${c + 1}` : `${nombre} ×3 — tocá para sacar`}
                        className={`text-xs font-bold px-2.5 py-1 rounded-md transition ${c > 0 ? CHIP_CLS[personaColor(nombre)] : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
                        {nombre}{c > 1 && <span className="ml-1 rounded bg-black/25 px-1 text-[11px] tabular-nums">×{c}</span>}
                      </button>
                    );
                  })}
                  {team.length === 0 && (
                    <p className="w-full text-[10px] text-gray-400 mt-1">Tip: creá cuentas en "Equipo" para que cada uno vea lo suyo.</p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          {/* Resumen del reparto: "2 productos × (Fran ×2 + Wanda ×3)" */}
          {selected.size > 0 && targets.length > 0 && (
            <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {selected.size} producto{selected.size === 1 ? '' : 's'} × ({targets.map(([key, c]) => {
                const m = team.find(t => t.id === key);
                const nombre = m ? (m.display_name || m.email) : key.slice(2);
                return c > 1 ? `${nombre} ×${c}` : nombre;
              }).join(' + ')})
            </span>
          )}
          <button onClick={crear} disabled={selected.size === 0}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus size={15} /> Crear {selected.size > 0 ? `${totalTarjetas} ` : ''}tarjeta{totalTarjetas === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reasignar en bloque: mueve TODAS las tarjetas de la semana de una persona
// (o las sin asignar) a una cuenta del equipo. Para cubrir vacaciones/bajas o
// repartir lo que quedó suelto, sin ir tarjeta por tarjeta.
function ReasignarModal({ asigs, team, weekKey, onClose, addToast }) {
  useEscape(onClose);
  const [from, setFrom] = useState('');
  const [toId, setToId] = useState('');

  // Orígenes: cada persona/cuenta con tarjetas en la semana + "Sin asignar".
  const origenes = useMemo(() => {
    const map = new Map();
    asigs.forEach(a => {
      const per = (a.persona || '').trim();
      const key = a.creatorId || (per ? `p:${per}` : 'sin');
      const label = per || 'Sin asignar';
      if (!map.has(key)) map.set(key, { key, label, n: 0 });
      map.get(key).n++;
    });
    return [...map.values()].sort((x, y) => y.n - x.n);
  }, [asigs]);

  const sel = origenes.find(o => o.key === from);
  const destino = team.find(m => m.id === toId);

  const mover = () => {
    if (!sel || !destino) { addToast?.({ type: 'warning', message: 'Elegí de quién y a quién.' }); return; }
    let n = 0;
    asigs.forEach(a => {
      const per = (a.persona || '').trim();
      const key = a.creatorId || (per ? `p:${per}` : 'sin');
      if (key !== sel.key) return;
      assignCreator(a.id, { creatorId: destino.id, persona: destino.display_name || destino.email });
      n++;
    });
    addToast?.({ type: 'success', message: `💪 ${n} tarjeta${n === 1 ? '' : 's'} de ${weekLabel(weekKey)} → ${destino.display_name || destino.email}` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <ArrowLeftRight size={16} className="text-brand-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Reasignar la semana</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {team.length === 0 ? (
            <p className="text-sm text-gray-400">Primero creá cuentas del equipo (botón "Equipo").</p>
          ) : origenes.length === 0 ? (
            <p className="text-sm text-gray-400">No hay tarjetas en esta semana.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Mover las tarjetas de…</span>
                <select autoFocus value={from} onChange={e => setFrom(e.target.value)}
                  className="px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">Elegí…</option>
                  {origenes.map(o => <option key={o.key} value={o.key}>{o.label} ({o.n})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">…a la cuenta de</span>
                <select value={toId} onChange={e => setToId(e.target.value)}
                  className="px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">Elegí…</option>
                  {team.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                </select>
              </label>
              {sel && destino && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Se mueven <b>{sel.n}</b> tarjeta{sel.n === 1 ? '' : 's'} de <b>{sel.label}</b> a <b>{destino.display_name || destino.email}</b> (va a verlas en su tablero).
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={mover} disabled={!sel || !destino}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
            <ArrowLeftRight size={14} /> Mover{sel ? ` ${sel.n}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Historial de la tarjeta: creación + cada cambio de estado (quién y cuándo).
// Base para medir tiempos de entrega / eficiencia del equipo.
function HistorialTarjeta({ a }) {
  const [abierto, setAbierto] = useState(false);
  const eventos = a.historial || [];
  if (eventos.length === 0) return null;
  const fmt = (ts) => {
    try { return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };
  const label = (ev) => {
    if (ev.tipo === 'creacion') return 'Tarjeta creada';
    if (ev.tipo === 'estado') return `${ESTADO_LABELS[ev.from] || ev.from || '—'} → ${ESTADO_LABELS[ev.to] || ev.to}`;
    if (ev.tipo === 'subida') return `Subió ${ev.n ? `${ev.n} ` : ''}video(s)`;
    return ev.tipo;
  };
  const ultimo = eventos[eventos.length - 1];
  return (
    <div>
      {/* Cabecera desplegable: cerrada muestra solo el último movimiento */}
      <button onClick={() => setAbierto(o => !o)} className="w-full flex items-center gap-1.5 text-left group">
        <History size={13} className="text-gray-400" />
        <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Historial</span>
        <span className="text-[11px] text-gray-400 tabular-nums">({eventos.length})</span>
        {!abierto && ultimo && (
          <span className="text-[11px] text-gray-400 truncate">· último: {label(ultimo)} — {fmt(ultimo.ts)}</span>
        )}
        <ChevronDown size={13} className={`ml-auto shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <ol className="mt-2 space-y-2 border-l border-gray-200 dark:border-gray-700 pl-3.5 ml-1 max-h-44 overflow-y-auto">
          {[...eventos].reverse().map((ev, i) => (
            <li key={i} className="relative text-xs leading-tight">
              <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-brand-400 ring-2 ring-white dark:ring-gray-900" />
              <span className="font-semibold text-gray-700 dark:text-gray-200">{label(ev)}</span>
              <div className="text-gray-400">{ev.byName || 'Alguien'} · {fmt(ev.ts)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Detalle de la tarjeta (estilo Trello): persona, tipo, estado, brief a mano,
// creativos (subida a Drive), y contador de videos aprobados.
function CardDetailModal({ a, personas, team = [], onClose, addToast }) {
  const [brief, setBrief] = useState(a.brief || '');
  const nFiles = a.archivos?.length || 0;

  // Asignar la tarjeta a una CUENTA del equipo: setea creator_id (lo que la RLS
  // usa para que ese chico vea la tarjeta) y la persona con su nombre.
  const onAssignCuenta = (cid) => {
    const m = team.find(t => t.id === cid);
    assignCreator(a.id, { creatorId: cid || null, persona: m ? (m.display_name || m.email) : a.persona });
    if (m) addToast?.({ type: 'success', message: `Tarjeta asignada a ${m.display_name || m.email}` });
  };

  const saveBrief = () => { if (brief !== (a.brief || '')) updateAssignment(a.id, { brief }); };
  // Diálogos propios (reemplazan window.confirm/prompt): 'eliminar' | 'cambios'.
  const [dlg, setDlg] = useState(null);
  useEscape(() => { if (dlg) return; saveBrief(); onClose(); }); // Esc = guardar brief y cerrar (salvo diálogo abierto)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={() => { saveBrief(); onClose(); }}>
      <div className="w-full max-w-2xl my-6 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <Film size={18} className="text-brand-500 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{a.productoNombre || 'Producto'}</h3>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <PersonaChip persona={a.persona} />
              <span className="text-[11px] text-gray-400">{ESTADO_LABELS[a.estado]}</span>
            </div>
          </div>
          <button onClick={() => { saveBrief(); onClose(); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Asignar a una cuenta del equipo (login del creator) */}
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Asignar a (cuenta)</span>
            <div className="relative">
              <select value={a.creatorId || ''} onChange={e => onAssignCuenta(e.target.value)}
                className="appearance-none w-full pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">— sin cuenta asignada —</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {team.length === 0
                ? 'No hay cuentas del equipo todavía. Creá una en "Equipo".'
                : 'El chico asignado va a ver esta tarjeta en su tablero y va a poder subir los creativos.'}
            </p>
          </div>

          {/* Persona (texto libre) + estado. Los chips de persona solo aparecen
              si TODAVÍA no hay cuentas del equipo — con cuentas, se asigna arriba
              en "Asignar a (cuenta)" y evitamos el doble control confuso. */}
          <div className="grid sm:grid-cols-2 gap-4">
            {team.length === 0 && (
              <div>
                <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Persona</span>
                <div className="flex flex-wrap gap-1.5">
                  {personas.map(p => (
                    <button key={p} onClick={() => assignPersona(a.id, a.persona === p ? '' : p)}
                      className={`text-xs font-bold px-2.5 py-1 rounded-md transition ${a.persona === p ? CHIP_CLS[personaColor(p)] : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>{p}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Estado</span>
              <div className="flex flex-wrap gap-1">
                {ESTADOS.map(e => (
                  <button key={e} onClick={() => updateAssignment(a.id, { estado: e })}
                    className={`text-[11px] font-bold px-2 py-1 rounded-md transition ${a.estado === e ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200'}`}>
                    {ESTADO_LABELS[e]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Cambios pedidos (lo que ve el creativo) */}
          {(a.nota || '').trim() && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300 mb-0.5"><AlertTriangle size={11} /> Cambios pedidos</div>
              <p className="text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">{a.nota}</p>
            </div>
          )}

          {/* Brief a mano */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileText size={13} className="text-gray-400" />
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Brief / guiones</span>
            </div>
            <textarea value={brief} onChange={e => setBrief(e.target.value)} onBlur={saveBrief}
              rows={7} placeholder="Pegá acá las consignas, los guiones de los 9 videos, links de Drive (material / creativos), lo que haga falta…"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y font-mono leading-relaxed" />
          </div>

          {/* Creativos */}
          <CreativosSection a={a} addToast={addToast} />

          {/* Videos aprobados (sobre los subidos) + Aprobar todos */}
          {(() => {
            const subidos = a.archivos?.length || 0;
            const aprob = Math.min(a.videosAprobados || 0, subidos);
            const todo = subidos > 0 && aprob >= subidos;
            return (
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Videos aprobados</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateAssignment(a.id, { videosAprobados: Math.max(0, aprob - 1) })}
                      className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 font-bold leading-none">−</button>
                    <span className="font-mono tabular-nums text-sm w-14 text-center">{aprob}/{subidos}</span>
                    <button onClick={() => updateAssignment(a.id, { videosAprobados: Math.min(subidos, aprob + 1) })}
                      disabled={aprob >= subidos}
                      className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 font-bold leading-none disabled:opacity-40">+</button>
                  </div>
                  {subidos > 0 && (
                    <button
                      onClick={() => { updateAssignment(a.id, { videosAprobados: subidos, estado: 'aprobado' }); addToast?.({ type: 'success', message: `Aprobado (${subidos}/${subidos}) — listo para publicar` }); }}
                      className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition ${todo && !esCompleto(a.estado) ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'}`}>
                      <CheckCircle2 size={14} /> Aprobar todos
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  El total es la cantidad de videos subidos ({subidos}). "Aprobar todos" marca todo aprobado y pasa la tarjeta a <b>Aprobado</b> (lista para publicar).
                </p>
                {esCompleto(a.estado) && <span className="mt-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={13} /> Cuenta para el pago</span>}
              </div>
            );
          })()}

          {/* Historial de la tarjeta (KPIs de tiempos) */}
          <HistorialTarjeta a={a} />
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={() => setDlg('eliminar')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-600 transition">
            <Trash2 size={14} /> Eliminar tarjeta
          </button>
          <button onClick={() => setDlg('cambios')}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition">
            <AlertTriangle size={14} /> Pedir cambios
          </button>
          <button onClick={() => { saveBrief(); onClose(); }} className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">Listo</button>
        </div>

        {/* Diálogos propios de la plataforma */}
        <ConfirmDialog
          open={dlg === 'eliminar'}
          title={`¿Eliminar la tarjeta de ${a.productoNombre}?`}
          message="Se pierde su historial y su lista de videos. Los archivos ya subidos a Drive/AdsLab no se borran."
          confirmLabel="Eliminar tarjeta" tone="danger"
          onConfirm={() => { setDlg(null); removeAssignment(a.id); onClose(); }}
          onClose={() => setDlg(null)}
        />
        <ConfirmDialog
          open={dlg === 'cambios'}
          title="Pedir cambios"
          message="La tarjeta vuelve a «Por hacer» y el creativo ve tu nota bien destacada."
          withInput multiline inputLabel="¿Qué hay que corregir?"
          defaultValue={a.nota || ''}
          placeholder="Ej: el video 3 está oscuro — rehacelo con más luz…"
          confirmLabel="Devolver al creativo" tone="warn"
          onConfirm={(nota) => {
            setDlg(null);
            updateAssignment(a.id, { nota: nota || '', estado: 'porhacer' });
            addToast?.({ type: 'success', message: 'Devuelta al creativo para corregir.' });
          }}
          onClose={() => setDlg(null)}
        />
      </div>
    </div>
  );
}
