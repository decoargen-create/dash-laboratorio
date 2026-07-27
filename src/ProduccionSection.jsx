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
  AlertTriangle, ExternalLink, FileText, GripVertical,
} from 'lucide-react';
import {
  ESTADOS, ESTADO_LABELS, VIDEOS_POR_PRODUCTO, weekKeyOf, weekLabel, allWeekKeys,
  listAssignments, addAssignment, updateAssignment, removeAssignment, assignPersona,
  addArchivos, removeArchivo, subscribeProduccion, esCompleto,
} from './produccionStore.js';
import { supabase, getCurrentUser } from './supabase.js';

const BUCKET = 'creativos';
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

async function getAuthToken() {
  try { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ''; }
  catch { return ''; }
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
  const [detailId, setDetailId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  useEffect(() => {
    const un = subscribeProduccion(() => force(x => x + 1));
    return un;
  }, []);

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
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg hover:from-brand-600 hover:to-brand-800 transition shadow-sm">
            <Plus size={14} /> Agregar producto
          </button>
        </div>
      </div>

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
                  <KanbanCard key={a.id} a={a} personas={personas}
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
        <AgregarProductoModal productos={productos} personas={personas} asigs={asigs} weekKey={weekKey}
          onClose={() => setShowAdd(false)} addToast={addToast} />
      )}
      {detail && (
        <CardDetailModal a={detail} personas={personas} onClose={() => setDetailId(null)} addToast={addToast} />
      )}
    </div>
  );
}

function KanbanCard({ a, personas, onOpen, onAssign }) {
  const [menu, setMenu] = useState(false);
  const nFiles = a.archivos?.length || 0;
  return (
    <div draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/prod-id', a.id); }}
      onClick={() => onOpen()}
      className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-sm hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600 transition cursor-pointer">
      <div className="flex items-start gap-1.5">
        <GripVertical size={13} className="text-gray-300 dark:text-gray-600 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition" />
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight flex-1">{a.productoNombre || 'Producto'}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mt-2 pl-4 relative">
        <span onClick={e => { e.stopPropagation(); setMenu(v => !v); }}>
          <PersonaChip persona={a.persona} small onClick={() => {}} />
        </span>
        {nFiles > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 dark:text-gray-400" title={`${nFiles} creativos subidos`}>
            <Film size={11} className="text-emerald-500" />{nFiles}
          </span>
        )}
        {a.brief?.trim() && <FileText size={11} className="text-gray-400" title="Tiene brief" />}
        <span className="ml-auto text-[10px] font-mono text-gray-400 tabular-nums">{a.videosAprobados}/{a.videosTotal}</span>

        {menu && (
          <div className="absolute top-6 left-4 z-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1 flex flex-col gap-0.5"
            onClick={e => e.stopPropagation()}>
            {personas.map(p => (
              <button key={p} onClick={() => { onAssign(p); setMenu(false); }}
                className="text-left text-[11px] font-semibold px-2 py-1 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 text-gray-700 dark:text-gray-200 whitespace-nowrap">{p}</button>
            ))}
            {a.persona && (
              <button onClick={() => { onAssign(''); setMenu(false); }}
                className="text-left text-[11px] px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 border-t border-gray-100 dark:border-gray-700 mt-0.5">Sin asignar</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agregar producto (crea una tarjeta en "Por hacer").
function AgregarProductoModal({ productos, personas, asigs, weekKey, onClose, addToast }) {
  const [prodId, setProdId] = useState('');
  const [persona, setPersona] = useState('');

  const yaEnSemana = useMemo(() => new Set(asigs.map(a => String(a.productoId))), [asigs]);
  const prod = productos.find(p => String(p.id) === String(prodId));

  const crear = () => {
    if (!prod) { addToast?.({ type: 'warning', message: 'Elegí un producto.' }); return; }
    addAssignment({ weekKey, productoId: prod.id, productoNombre: prod.nombre, persona });
    addToast?.({ type: 'success', message: `${prod.nombre} agregado${persona ? ` para ${persona}` : ''}` });
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
            <div className="flex flex-wrap gap-1.5">
              {personas.map(p => (
                <button key={p} onClick={() => setPersona(persona === p ? '' : p)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition ${persona === p ? CHIP_CLS[personaColor(p)] : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>{p}</button>
              ))}
            </div>
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

// ── Detalle de la tarjeta (estilo Trello): persona, tipo, estado, brief a mano,
// creativos (subida a Drive), y contador de videos aprobados.
function CardDetailModal({ a, personas, onClose, addToast }) {
  const [brief, setBrief] = useState(a.brief || '');
  const nFiles = a.archivos?.length || 0;

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
          {/* Persona + estado */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Persona</span>
              <div className="flex flex-wrap gap-1.5">
                {personas.map(p => (
                  <button key={p} onClick={() => assignPersona(a.id, a.persona === p ? '' : p)}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition ${a.persona === p ? CHIP_CLS[personaColor(p)] : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>{p}</button>
                ))}
              </div>
            </div>
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

          {/* Videos aprobados */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Videos aprobados</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => updateAssignment(a.id, { videosAprobados: Math.max(0, (a.videosAprobados || 0) - 1) })}
                className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 font-bold leading-none">−</button>
              <span className="font-mono tabular-nums text-sm w-12 text-center">{a.videosAprobados}/{a.videosTotal}</span>
              <button onClick={() => updateAssignment(a.id, { videosAprobados: Math.min(a.videosTotal, (a.videosAprobados || 0) + 1) })}
                className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 font-bold leading-none">+</button>
            </div>
            {esCompleto(a.estado) && <span className="ml-auto text-[11px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={13} /> Cuenta para el pago</span>}
          </div>
        </div>

        <div className="flex items-center px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={() => { if (window.confirm(`¿Eliminar la tarjeta de ${a.productoNombre}?`)) { removeAssignment(a.id); onClose(); } }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-600 transition">
            <Trash2 size={14} /> Eliminar tarjeta
          </button>
          <button onClick={() => { saveBrief(); onClose(); }} className="ml-auto px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">Listo</button>
        </div>
      </div>
    </div>
  );
}

// ── Sección de creativos dentro de la tarjeta: subir + lista de archivos.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|hevc)$/i;
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function uploadToSupabase(file, user, ext) {
  const path = `${user.id}/produccion/pv-${uid()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'video/mp4', upsert: true,
  });
  if (error) throw new Error(`Subida falló: ${error.message}`);
  return { name: file.name, storagePath: path, destino: 'adslab', sizeMB: +(file.size / 1024 / 1024).toFixed(1), ts: uid() };
}

async function uploadOne(file, ctx) {
  const { user, token, weekKey, productoNombre, persona } = ctx;
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  let sess = null;
  try {
    const r = await fetch('/api/produccion/drive-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ productoNombre, persona, weekKey, filename: file.name, mimeType: file.type || 'video/mp4', size: file.size }),
    });
    sess = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(sess.error || `HTTP ${r.status}`);
  } catch { sess = { configured: false }; }

  if (sess.configured && sess.sessionUri) {
    try {
      const put = await fetch(sess.sessionUri, { method: 'PUT', headers: { 'Content-Type': sess.contentType || file.type || 'video/mp4' }, body: file });
      if (put.ok) {
        const meta = await put.json().catch(() => ({}));
        const link = meta.webViewLink || (meta.id ? `https://drive.google.com/file/d/${meta.id}/view` : sess.folderLink) || null;
        return { name: sess.finalName || file.name, driveId: meta.id || null, link, folderLink: sess.folderLink || null, destino: 'drive', sizeMB: +(file.size / 1024 / 1024).toFixed(1), ts: uid() };
      }
    } catch { /* fallback abajo */ }
  }
  return await uploadToSupabase(file, user, ext);
}

function CreativosSection({ a, addToast }) {
  const [files, setFiles] = useState([]); // { file, id, status, destino?, msg? }
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const folderLink = (a.archivos || []).find(f => f.folderLink)?.folderLink;

  const addFiles = (list) => {
    const nuevos = Array.from(list || [])
      .filter(f => VIDEO_EXT.test(f.name) || (f.type || '').startsWith('video/'))
      .map(f => ({ file: f, id: uid(), status: 'espera' }));
    if (nuevos.length === 0) { addToast?.({ type: 'warning', message: 'Arrastrá videos (.mp4, .mov, …).' }); return; }
    setFiles(prev => [...prev, ...nuevos]);
  };

  const subir = async () => {
    if (files.length === 0) return;
    setBusy(true);
    const user = await getCurrentUser();
    if (!user) { setBusy(false); addToast?.({ type: 'error', message: 'Iniciá sesión de nuevo.' }); return; }
    const token = await getAuthToken();
    const ctx = { user, token, weekKey: a.weekKey, productoNombre: a.productoNombre, persona: a.persona || 'Equipo' };
    let ok = 0, dest = null;
    for (const item of files) {
      if (item.status === 'ok') continue;
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'subiendo' } : f));
      try {
        const archivo = await uploadOne(item.file, ctx);
        addArchivos(a.id, [archivo]);
        ok++; dest = archivo.destino;
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'ok', destino: archivo.destino } : f));
      } catch (err) {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', msg: err.message } : f));
      }
    }
    setBusy(false);
    if (ok > 0) addToast?.({ type: 'success', message: `${ok} video${ok > 1 ? 's' : ''} → ${dest === 'drive' ? 'Google Drive' : 'AdsLab'}` });
    setFiles(prev => prev.filter(f => f.status !== 'ok'));
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <UploadCloud size={13} className="text-gray-400" />
        <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Creativos</span>
        {folderLink && (
          <a href={folderLink} target="_blank" rel="noopener noreferrer" className="text-[10px] text-brand-500 hover:text-brand-600 inline-flex items-center gap-0.5 ml-1">
            carpeta de Drive <ExternalLink size={10} />
          </a>
        )}
      </div>

      {/* Archivos ya subidos */}
      {(a.archivos?.length > 0) && (
        <div className="space-y-1 mb-2">
          {a.archivos.map(f => (
            <div key={f.ts} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 rounded px-2.5 py-1.5">
              <Film size={12} className="text-emerald-500 flex-shrink-0" />
              <span className="truncate flex-1 text-gray-700 dark:text-gray-200" title={f.name}>{f.name}</span>
              <span className="text-[9px] uppercase font-bold text-gray-400">{f.destino === 'drive' ? 'Drive' : 'AdsLab'}</span>
              {f.link && <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:text-brand-600"><ExternalLink size={11} /></a>}
              <button onClick={() => removeArchivo(a.id, f.ts)} className="text-gray-300 hover:text-red-500"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Dropzone */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) addFiles(e.dataTransfer.files); }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition ${drag ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-300 dark:border-gray-700 hover:border-emerald-400'}`}>
        <UploadCloud size={20} className="mx-auto mb-1 text-gray-400" />
        <p className="text-xs text-gray-500 dark:text-gray-400">Arrastrá los videos o <span className="text-emerald-600 font-semibold">buscalos</span></p>
        <input ref={inputRef} type="file" accept="video/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Cola de subida */}
      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 rounded px-2.5 py-1.5">
              <span className="flex-shrink-0">
                {f.status === 'error' ? <AlertTriangle size={12} className="text-red-500" />
                  : f.status === 'subiendo' ? <Loader2 size={12} className="text-brand-500 animate-spin" />
                    : <Film size={12} className="text-gray-400" />}
              </span>
              <span className="truncate flex-1 text-gray-600 dark:text-gray-300">{f.file.name}</span>
              {f.status === 'error' && <span className="text-[10px] text-red-500 truncate max-w-[110px]" title={f.msg}>{f.msg}</span>}
              {!busy && <button onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))} className="text-gray-300 hover:text-red-500"><X size={12} /></button>}
            </div>
          ))}
          <button onClick={subir} disabled={busy}
            className="w-full mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50">
            {busy ? <><Loader2 size={14} className="animate-spin" /> Subiendo…</> : <><UploadCloud size={14} /> Subir {files.length} video{files.length > 1 ? 's' : ''}</>}
          </button>
        </div>
      )}
    </div>
  );
}
