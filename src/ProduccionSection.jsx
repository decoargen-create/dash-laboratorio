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
  AlertTriangle, ExternalLink, FileText, GripVertical, Users, History,
} from 'lucide-react';
import {
  ESTADOS, ESTADO_LABELS, VIDEOS_POR_PRODUCTO, weekKeyOf, weekLabel, weekRange, allWeekKeys,
  listAssignments, addAssignment, updateAssignment, removeAssignment, assignPersona,
  assignCreator, subscribeProduccion, esCompleto, bonusObjetivo,
} from './produccionStore.js';
import { CreativosSection, subirParaTarjeta, VIDEO_ACCEPT } from './produccionUpload.jsx';
import { listTeam } from './produccionTeam.js';
import TeamModal from './TeamModal.jsx';

const EQUIPO_DEFAULT = ['Fran', 'Wanda', 'Flor'];

const COLS = [
  { key: 'porhacer', dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400' },
  { key: 'revision', dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400' },
  { key: 'aprobado', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'publicado', dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400' },
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
    className={`inline-flex items-center rounded font-bold uppercase tracking-wide ${small ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} ${CHIP_CLS[personaColor(persona)]} ${onClick ? 'hover:opacity-80 transition' : ''}`}>
    {persona || 'Sin asignar'}
  </button>
);

// Badge de persona más grande y prolijo (avatar con inicial + nombre).
const PersonaBadge = ({ persona }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-0.5 ${CHIP_CLS[personaColor(persona)]}`}>
    <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[10px] font-black uppercase">
      {(persona || '?').charAt(0)}
    </span>
    <span className="text-[12px] font-extrabold">{persona || 'Sin asignar'}</span>
  </span>
);

// Resumen de la semana: cuántas tarjetas tiene cada persona + progreso hacia el
// objetivo (productos aprobados) con el bonus semanal.
function ResumenSemana({ asigs }) {
  const { porPersona, sinAsignar, total, aprobados } = useMemo(() => {
    const map = {};
    let sin = 0, apr = 0;
    asigs.forEach(a => {
      if (esCompleto(a.estado)) apr++;
      const p = (a.persona || '').trim();
      if (p) map[p] = (map[p] || 0) + 1; else sin++;
    });
    return {
      porPersona: Object.entries(map).sort((x, y) => y[1] - x[1]),
      sinAsignar: sin, total: asigs.length, aprobados: apr,
    };
  }, [asigs]);

  if (total === 0) return null;
  const bonus = bonusObjetivo(aprobados);
  const pct = total ? Math.round((aprobados / total) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-bold uppercase text-gray-400 mr-0.5">Carga del equipo</span>
        {porPersona.map(([p, n]) => (
          <span key={p} className={`inline-flex items-center gap-1 rounded-full pl-1 pr-2 py-0.5 text-[11px] font-bold ${CHIP_CLS[personaColor(p)]}`}>
            <span className="w-4 h-4 rounded-full bg-black/20 flex items-center justify-center text-[9px] font-black">{n}</span>
            {p}
          </span>
        ))}
        {sinAsignar > 0 && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
            {sinAsignar} sin asignar
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2.5 min-w-[200px]">
        <div className="flex-1">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="font-bold uppercase text-gray-400">Objetivo de la semana</span>
            <span className="font-mono text-gray-500 dark:text-gray-400">{aprobados}/{total} aprobados</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {bonus > 0 && (
          <span className="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">🎯 bonus</span>
        )}
      </div>
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
  const [team, setTeam] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

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

  const personas = useMemo(() => {
    const set = new Set(EQUIPO_DEFAULT);
    allWeekKeys().forEach(wk => listAssignments(wk).forEach(a => { if (a.persona) set.add(a.persona); }));
    productos.forEach(p => { const r = (p.responsable || '').trim(); if (r) set.add(r); });
    return [...set];
  }, [weekKey, productos]); // eslint-disable-line

  const byCol = useMemo(() => {
    const m = { porhacer: [], revision: [], aprobado: [], publicado: [] };
    for (const a of asigs) (m[a.estado] || m.porhacer).push(a);
    return m;
  }, [asigs]);

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
          <p className="text-xs text-gray-500 dark:text-gray-400">Cada tarjeta es un producto. Arrastrala entre columnas para cambiar el estado.</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select value={weekKey} onChange={e => setWeekKey(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              {semanas.map(wk => <option key={wk} value={wk}>{weekLabel(wk)}{wk === weekKeyOf() ? ' (esta semana)' : ''}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
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
      <ResumenSemana asigs={asigs} />

      {/* Tablero */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLS.map(col => {
          const cards = byCol[col.key] || [];
          return (
            <div key={col.key}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(col.key); }}
              onDragLeave={() => setDragOver(d => d === col.key ? null : d)}
              onDrop={e => onDrop(e, col.key)}
              className={`flex-1 min-w-[240px] rounded-xl p-2.5 transition ${dragOver === col.key ? 'bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-300 dark:ring-brand-700' : 'bg-gray-50 dark:bg-gray-800/40'}`}>
              <div className="flex items-center gap-2 px-1 pb-2">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className={`text-xs font-bold uppercase tracking-wide ${col.text}`}>{ESTADO_LABELS[col.key]}</span>
                <span className="ml-auto text-[11px] font-mono text-gray-400 tabular-nums">{cards.length}</span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {cards.map(a => (
                  <KanbanCard key={a.id} a={a} personas={personas} team={team} addToast={addToast}
                    onOpen={() => setDetailId(a.id)}
                    onAssign={(p) => assignPersona(a.id, p)} />
                ))}
                {cards.length === 0 && (
                  <div className="text-center text-[11px] text-gray-300 dark:text-gray-600 py-4 select-none">
                    {col.key === 'porhacer' ? 'Agregá productos acá' : 'Arrastrá tarjetas acá'}
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
    </div>
  );
}

function KanbanCard({ a, personas, team = [], onOpen, onAssign, addToast }) {
  const [menu, setMenu] = useState(false);
  const [prog, setProg] = useState(null); // { i, total } mientras sube
  const fileRef = useRef(null);
  const subidos = a.archivos?.length || 0;
  const aprob = Math.min(a.videosAprobados || 0, subidos);
  const folderLink = (a.archivos || []).find(f => f.folderLink)?.folderLink;

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
    addToast?.({ type: 'success', message: `${a.productoNombre} · aprobado (${subidos}/${subidos}) — listo para publicar` });
  };
  const publicar = (e) => {
    e.stopPropagation();
    updateAssignment(a.id, { estado: 'publicado' });
    addToast?.({ type: 'success', message: `${a.productoNombre} · publicado 🚀` });
  };

  return (
    <div draggable={!prog}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/prod-id', a.id); }}
      onClick={() => onOpen()}
      className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600 transition cursor-pointer">
      <div className="flex items-start gap-1.5">
        <GripVertical size={14} className="text-gray-300 dark:text-gray-600 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition" />
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight flex-1">{a.productoNombre || 'Producto'}</span>
      </div>

      {/* Persona (badge grande) + menú de asignación por CUENTA del equipo */}
      <div className="mt-2.5 pl-4 relative flex items-center gap-1.5 flex-wrap">
        <span onClick={e => { e.stopPropagation(); setMenu(v => !v); }} className="cursor-pointer">
          <PersonaBadge persona={a.persona} />
        </span>
        {/* Aviso: tiene etiqueta pero ninguna cuenta la ve en su tablero */}
        {a.persona && !a.creatorId && (
          <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title="Esta tarjeta tiene etiqueta pero no está asignada a una cuenta, así que ningún creativo la ve. Elegí una cuenta del equipo.">
            <AlertTriangle size={9} /> sin cuenta
          </span>
        )}
        {menu && (
          <div className="absolute top-8 left-4 z-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[140px]"
            onClick={e => e.stopPropagation()}>
            {team.length > 0 ? (
              team.map(m => (
                <button key={m.id} onClick={() => { assignCreator(a.id, { creatorId: m.id, persona: m.display_name || m.email }); setMenu(false); }}
                  className={`text-left text-[11px] font-semibold px-2 py-1 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 whitespace-nowrap ${a.creatorId === m.id ? 'text-brand-600 dark:text-brand-300' : 'text-gray-700 dark:text-gray-200'}`}>
                  {a.creatorId === m.id ? '✓ ' : ''}{m.display_name || m.email}
                </button>
              ))
            ) : (
              <>
                {personas.map(p => (
                  <button key={p} onClick={() => { onAssign(p); setMenu(false); }}
                    className="text-left text-[11px] font-semibold px-2 py-1 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 text-gray-700 dark:text-gray-200 whitespace-nowrap">{p}</button>
                ))}
                <div className="text-[9px] text-gray-400 px-2 py-1 border-t border-gray-100 dark:border-gray-700">Creá cuentas en "Equipo" para que las vean en su tablero.</div>
              </>
            )}
            {(a.persona || a.creatorId) && (
              <button onClick={() => { assignCreator(a.id, { creatorId: null, persona: '' }); setMenu(false); }}
                className="text-left text-[11px] px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 border-t border-gray-100 dark:border-gray-700 mt-0.5">Sin asignar</button>
            )}
          </div>
        )}
      </div>

      {/* Contadores: subidos + aprobados (sobre lo subido) + brief */}
      <div className="mt-2 pl-4 flex items-center gap-2.5 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1" title={`${subidos} creativos subidos`}>
          <Film size={12} className="text-emerald-500" /><b className="text-gray-700 dark:text-gray-200">{subidos}</b> subidos
        </span>
        {subidos > 0 && (
          <span className="inline-flex items-center gap-1" title="Aprobados sobre subidos">
            <CheckCircle2 size={12} className={aprob >= subidos ? 'text-emerald-500' : 'text-gray-400'} />
            <b className="text-gray-700 dark:text-gray-200">{aprob}/{subidos}</b>
          </span>
        )}
        {a.brief?.trim() && <FileText size={12} className="text-gray-400" title="Tiene brief" />}
      </div>
      {subidos > 0 && (
        <div className="mt-1.5 pl-4">
          <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((aprob / subidos) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Acciones: subir, ver en Drive, y acción según estado */}
      <div className="mt-2.5 pl-4 flex items-center gap-1.5 flex-wrap">
        {prog ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-600 dark:text-brand-400">
            <Loader2 size={12} className="animate-spin" /> Subiendo {prog.total ? `${prog.i + 1}/${prog.total}` : ''}…
          </span>
        ) : (
          <button onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition shadow-sm">
            <UploadCloud size={12} /> Subir
          </button>
        )}
        {folderLink && (
          <a href={folderLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 hover:bg-brand-100 dark:hover:bg-brand-900/50 rounded-md transition">
            <ExternalLink size={11} /> Ver en Drive
          </a>
        )}
        {a.estado === 'revision' && subidos > 0 && (
          <button onClick={aprobarTodos}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-md transition">
            <CheckCircle2 size={12} /> Aprobar
          </button>
        )}
        {a.estado === 'aprobado' && (
          <button onClick={publicar}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 rounded-md transition">
            Publicar
          </button>
        )}
      </div>

      <input ref={fileRef} type="file" accept={VIDEO_ACCEPT} multiple hidden
        onClick={e => e.stopPropagation()}
        onChange={e => { const fl = e.target.files; e.target.value = ''; onPick(fl); }} />
    </div>
  );
}

// ── Agregar producto (crea una tarjeta en "Por hacer").
function AgregarProductoModal({ productos, personas, team = [], asigs, weekKey, onClose, addToast }) {
  const [prodId, setProdId] = useState('');
  const [creatorId, setCreatorId] = useState('');
  const [persona, setPersona] = useState('');

  const yaEnSemana = useMemo(() => new Set(asigs.map(a => String(a.productoId))), [asigs]);
  const prod = productos.find(p => String(p.id) === String(prodId));

  const crear = () => {
    if (!prod) { addToast?.({ type: 'warning', message: 'Elegí un producto.' }); return; }
    const m = team.find(t => t.id === creatorId);
    const per = m ? (m.display_name || m.email) : persona;
    addAssignment({ weekKey, productoId: prod.id, productoNombre: prod.nombre, persona: per, creatorId: m ? m.id : null });
    addToast?.({ type: 'success', message: `${prod.nombre} agregado${per ? ` para ${per}` : ''}` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <Plus size={16} className="text-brand-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Agregar producto a la semana</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Producto</span>
            <select value={prodId} onChange={e => setProdId(e.target.value)}
              className="px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Elegí un producto…</option>
              {productos.map(p => <option key={p.id} value={p.id} disabled={yaEnSemana.has(String(p.id))}>
                {p.nombre}{yaEnSemana.has(String(p.id)) ? ' (ya está)' : ''}
              </option>)}
            </select>
          </label>
          <div>
            <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">¿Para quién? (opcional)</span>
            {team.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {team.map(m => {
                  const nombre = m.display_name || m.email;
                  const sel = creatorId === m.id;
                  return (
                    <button key={m.id} onClick={() => setCreatorId(sel ? '' : m.id)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition ${sel ? CHIP_CLS[personaColor(nombre)] : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
                      {nombre}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {personas.map(p => (
                  <button key={p} onClick={() => setPersona(persona === p ? '' : p)}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition ${persona === p ? CHIP_CLS[personaColor(p)] : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>{p}</button>
                ))}
                <p className="w-full text-[9px] text-gray-400 mt-1">Tip: creá cuentas en "Equipo" para que cada uno vea lo suyo.</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={crear} disabled={!prod}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus size={15} /> Crear tarjeta
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Historial de la tarjeta: creación + cada cambio de estado (quién y cuándo).
// Base para medir tiempos de entrega / eficiencia del equipo.
function HistorialTarjeta({ a }) {
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
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <History size={13} className="text-gray-400" />
        <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Historial</span>
      </div>
      <ol className="space-y-2 border-l border-gray-200 dark:border-gray-700 pl-3.5 ml-1">
        {[...eventos].reverse().map((ev, i) => (
          <li key={i} className="relative text-[11px] leading-tight">
            <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-brand-400 ring-2 ring-white dark:ring-gray-900" />
            <span className="font-semibold text-gray-700 dark:text-gray-200">{label(ev)}</span>
            <div className="text-gray-400">{ev.byName || 'Alguien'} · {fmt(ev.ts)}</div>
          </li>
        ))}
      </ol>
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
              <span className="text-[10px] text-gray-400">{ESTADO_LABELS[a.estado]}</span>
            </div>
          </div>
          <button onClick={() => { saveBrief(); onClose(); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Asignar a una cuenta del equipo (login del creator) */}
          <div>
            <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Asignar a (cuenta)</span>
            <div className="relative">
              <select value={a.creatorId || ''} onChange={e => onAssignCuenta(e.target.value)}
                className="appearance-none w-full pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">— sin cuenta asignada —</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
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
                <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Persona</span>
                <div className="flex flex-wrap gap-1.5">
                  {personas.map(p => (
                    <button key={p} onClick={() => assignPersona(a.id, a.persona === p ? '' : p)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition ${a.persona === p ? CHIP_CLS[personaColor(p)] : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>{p}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Estado</span>
              <div className="flex flex-wrap gap-1">
                {ESTADOS.map(e => (
                  <button key={e} onClick={() => updateAssignment(a.id, { estado: e })}
                    className={`text-[10px] font-bold px-2 py-1 rounded-md transition ${a.estado === e ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200'}`}>
                    {ESTADO_LABELS[e]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Cambios pedidos (lo que ve el creativo) */}
          {(a.nota || '').trim() && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300 mb-0.5"><AlertTriangle size={11} /> Cambios pedidos</div>
              <p className="text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">{a.nota}</p>
            </div>
          )}

          {/* Brief a mano */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileText size={13} className="text-gray-400" />
              <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Brief / guiones</span>
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
                  <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Videos aprobados</span>
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
                <p className="text-[10px] text-gray-400 mt-1.5">
                  El total es la cantidad de videos subidos ({subidos}). "Aprobar todos" marca todo aprobado y pasa la tarjeta a <b>Aprobado</b> (lista para publicar).
                </p>
                {esCompleto(a.estado) && <span className="mt-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={13} /> Cuenta para el pago</span>}
              </div>
            );
          })()}

          {/* Historial de la tarjeta (KPIs de tiempos) */}
          <HistorialTarjeta a={a} />
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={() => { if (window.confirm(`¿Eliminar la tarjeta de ${a.productoNombre}?`)) { removeAssignment(a.id); onClose(); } }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-600 transition">
            <Trash2 size={14} /> Eliminar tarjeta
          </button>
          <button
            onClick={() => {
              const nota = window.prompt('¿Qué hay que corregir? El creativo lo va a ver en su tarjeta.', a.nota || '');
              if (nota == null) return;
              updateAssignment(a.id, { nota, estado: 'porhacer' });
              addToast?.({ type: 'success', message: 'Devuelta al creativo para corregir.' });
            }}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition">
            <AlertTriangle size={14} /> Pedir cambios
          </button>
          <button onClick={() => { saveBrief(); onClose(); }} className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">Listo</button>
        </div>
      </div>
    </div>
  );
}
