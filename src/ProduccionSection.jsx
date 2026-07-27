// Producción — capa de control del equipo creativo (Fase 1).
// Asignás productos por semana a cada persona, seguís el estado de cada entrega
// (asignado → subido → en revisión → aprobado → publicado) y ves el pago que le
// corresponde a cada uno. Reemplaza los dos Excels (control master + detalle).
//
// Local por ahora. El login del equipo y el push a Drive son Fase 2.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Plus, X, Trash2, Film, ChevronDown, Wallet, Check, UploadCloud,
  Loader2, CheckCircle2, AlertTriangle, ExternalLink,
} from 'lucide-react';
import {
  ESTADOS, ESTADO_LABELS, VIDEOS_POR_PRODUCTO, weekKeyOf, weekLabel, allWeekKeys,
  listAssignments, addAssignment, updateAssignment, removeAssignment, paymentSummary,
  subscribeProduccion, esCompleto, findOrCreateAssignment, addArchivos,
} from './produccionStore.js';
import { fmtMoney, toUSD, subscribeMoney } from './moneyStore.js';
import { supabase, getCurrentUser } from './supabase.js';

const BUCKET = 'creativos';

async function getAuthToken() {
  try { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ''; }
  catch { return ''; }
}

const EQUIPO_DEFAULT = ['Fran', 'Wanda', 'Flor'];
// Formatea un monto en ARS respetando el switch de moneda global.
const fmtPago = (ars) => fmtMoney(toUSD(ars, 'ARS'));

function readProductos() {
  try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]'); }
  catch { return []; }
}

export default function ProduccionSection({ addToast }) {
  const [, force] = useState(0);
  const [productos] = useState(() => readProductos());
  const [weekKey, setWeekKey] = useState(() => weekKeyOf());
  const [showForm, setShowForm] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [fProducto, setFProducto] = useState('');
  const [fPersona, setFPersona] = useState(EQUIPO_DEFAULT[0]);
  const [fTipo, setFTipo] = useState('renovado');

  useEffect(() => {
    const un1 = subscribeProduccion(() => force(x => x + 1));
    const un2 = subscribeMoney(() => force(x => x + 1));
    return () => { un1(); un2(); };
  }, []);

  const semanas = useMemo(() => {
    const keys = new Set(allWeekKeys());
    keys.add(weekKeyOf()); // siempre la actual disponible
    return [...keys].sort().reverse();
  }, [weekKey]); // eslint-disable-line

  const asigs = listAssignments(weekKey);
  const resumen = paymentSummary(weekKey);
  const totalSemana = resumen.reduce((s, r) => s + r.totalArs, 0);

  // Personas conocidas (default + las que ya aparecen en asignaciones + responsables).
  const personas = useMemo(() => {
    const set = new Set(EQUIPO_DEFAULT);
    listAssignments(weekKey).forEach(a => set.add(a.persona));
    allWeekKeys().forEach(wk => listAssignments(wk).forEach(a => set.add(a.persona)));
    productos.forEach(p => { const r = (p.responsable || '').trim(); if (r) set.add(r); });
    return [...set];
  }, [weekKey, productos]);

  const gruposPorPersona = useMemo(() => {
    const map = {};
    for (const a of asigs) { (map[a.persona] = map[a.persona] || []).push(a); }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [asigs]);

  const handleAsignar = () => {
    if (!fPersona.trim()) { addToast?.({ type: 'warning', message: 'Elegí a quién le asignás.' }); return; }
    const prod = productos.find(p => String(p.id) === String(fProducto));
    addAssignment({
      weekKey,
      productoId: prod ? prod.id : null,
      productoNombre: prod ? prod.nombre : (fProducto || 'Producto'),
      persona: fPersona,
      tipo: fTipo,
    });
    addToast?.({ type: 'success', message: `Asignado ${prod ? prod.nombre : 'producto'} a ${fPersona}` });
    setShowForm(false);
    setFProducto('');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
          <Film size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Producción</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Asignación semanal, estado de entregas y pago del equipo.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <select value={weekKey} onChange={e => setWeekKey(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              {semanas.map(wk => <option key={wk} value={wk}>{weekLabel(wk)}{wk === weekKeyOf() ? ' (esta semana)' : ''}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg hover:from-emerald-600 hover:to-emerald-800 transition shadow-sm">
            <UploadCloud size={14} /> Subir creativos
          </button>
          <button onClick={() => setShowForm(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/25 border border-brand-200 dark:border-brand-800 rounded-lg hover:bg-brand-100 transition">
            <Plus size={14} /> Asignar
          </button>
        </div>
      </div>

      {showUpload && (
        <SubirCreativosModal
          weekKey={weekKey}
          productos={productos}
          personas={personas}
          onClose={() => setShowUpload(false)}
          addToast={addToast}
        />
      )}

      {/* Form de asignación */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 border-2 border-brand-300 dark:border-brand-700 rounded-xl p-4 flex flex-wrap items-end gap-3 animate-fade-in">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Producto</span>
            <select value={fProducto} onChange={e => setFProducto(e.target.value)}
              className="min-w-[180px] px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Elegí un producto…</option>
              {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Persona</span>
            <input list="personas-dl" value={fPersona} onChange={e => setFPersona(e.target.value)}
              className="w-32 px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <datalist id="personas-dl">{personas.map(p => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Tipo</span>
            <div className="inline-flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600 text-xs font-bold">
              {['renovado', 'testeo'].map(t => (
                <button key={t} onClick={() => setFTipo(t)}
                  className={`px-3 py-1.5 capitalize ${fTipo === t ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>{t}</button>
              ))}
            </div>
          </label>
          <button onClick={handleAsignar} className="px-3 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-md transition">
            Asignar ({VIDEOS_POR_PRODUCTO} videos)
          </button>
          <button onClick={() => setShowForm(false)} className="text-xs text-gray-400 hover:text-gray-600">cancelar</button>
        </div>
      )}

      {/* Tablero por persona */}
      {gruposPorPersona.length === 0 ? (
        <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-10 text-center text-gray-400 dark:text-gray-500">
          <Users size={26} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm">Nada asignado en {weekLabel(weekKey).toLowerCase()}. Tocá <b>Asignar</b> para arrancar.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {gruposPorPersona.map(([persona, items]) => {
            const r = resumen.find(x => x.persona === persona);
            return (
              <div key={persona}>
                <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                  <Users size={14} className="text-brand-500" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{persona}</h3>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    · {r?.completados || 0}/{items.length} completos
                  </span>
                  {r && r.totalArs > 0 && (
                    <span className="ml-auto text-xs font-mono font-bold tabular-nums text-brand-600 dark:text-brand-400"
                      title={`Productos: ${fmtPago(r.montoProductos)}${r.bonus ? ` · Objetivo: ${fmtPago(r.bonus)}` : ''}`}>
                      {fmtPago(r.totalArs)}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {items.map(a => <AsignacionRow key={a.id} a={a} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resumen de pago de la semana */}
      {resumen.length > 0 && (
        <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Wallet size={14} className="text-brand-500" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Pago de la semana</h3>
            <span className="ml-auto text-sm font-mono font-bold tabular-nums text-brand-600 dark:text-brand-400">{fmtPago(totalSemana)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[440px]">
              <thead>
                <tr className="text-[10px] uppercase text-gray-400 dark:text-gray-500">
                  <th className="text-left font-bold py-1.5">Persona</th>
                  <th className="text-right font-bold py-1.5">Completos</th>
                  <th className="text-right font-bold py-1.5">Productos</th>
                  <th className="text-right font-bold py-1.5">Objetivo</th>
                  <th className="text-right font-bold py-1.5">Total</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map(r => (
                  <tr key={r.persona} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1.5 font-semibold text-gray-800 dark:text-gray-100">{r.persona}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-gray-600 dark:text-gray-300">{r.completados}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-gray-600 dark:text-gray-300">{fmtPago(r.montoProductos)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">{r.bonus ? fmtPago(r.bonus) : '—'}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums font-bold text-brand-600 dark:text-brand-400">{fmtPago(r.totalArs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
            $42.000 por producto <b>completo y aprobado</b> + objetivo semanal ($24k/$30k/$36k por 3/4/5). Los montos respetan el switch de moneda del header.
          </p>
        </div>
      )}
    </div>
  );
}

// Fila de una asignación: producto, tipo, control de estado y de videos.
function AsignacionRow({ a }) {
  const completo = esCompleto(a.estado);
  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${completo ? 'border-emerald-300 dark:border-emerald-800' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="flex items-center gap-2 min-w-[160px]">
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{a.productoNombre || 'Producto'}</span>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${a.tipo === 'testeo' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'}`}>{a.tipo}</span>
      </div>

      {/* Estados */}
      <div className="flex items-center gap-1 flex-wrap">
        {ESTADOS.map(e => {
          const active = a.estado === e;
          const done = ESTADOS.indexOf(e) <= ESTADOS.indexOf(a.estado);
          return (
            <button key={e} onClick={() => updateAssignment(a.id, { estado: e })}
              className={`text-[10px] font-bold px-2 py-1 rounded-md transition ${
                active ? 'bg-brand-600 text-white'
                  : done ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 hover:bg-gray-200'}`}
              title={ESTADO_LABELS[e]}>
              {ESTADO_LABELS[e]}
            </button>
          );
        })}
      </div>

      {/* Archivos subidos */}
      {(a.archivos?.length > 0) && (
        <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
          <Film size={12} className="text-emerald-500" />
          <span className="font-mono tabular-nums">{a.archivos.length}</span>
          <span>subidos</span>
          {a.archivos.find(f => f.link) && (
            <a href={a.archivos.find(f => f.link).link} target="_blank" rel="noopener noreferrer"
              className="text-brand-500 hover:text-brand-600" title="Ver en Drive">
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}

      {/* Videos aprobados */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ml-auto">
        <span className="font-mono tabular-nums">{a.videosAprobados}/{a.videosTotal}</span>
        <button onClick={() => updateAssignment(a.id, { videosAprobados: Math.max(0, (a.videosAprobados || 0) - 1) })}
          className="w-5 h-5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 font-bold leading-none">−</button>
        <button onClick={() => updateAssignment(a.id, { videosAprobados: Math.min(a.videosTotal, (a.videosAprobados || 0) + 1) })}
          className="w-5 h-5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 font-bold leading-none">+</button>
        <span className="text-[10px]">videos</span>
      </div>

      <button onClick={() => { if (window.confirm(`¿Sacar ${a.productoNombre} de ${a.persona}?`)) removeAssignment(a.id); }}
        className="text-gray-300 hover:text-red-500 transition" title="Sacar asignación">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── "Subir creativos": elegís producto + persona y arrastrás los videos.
// Van directo a Google Drive (si está configurado) o al bucket de AdsLab como
// fallback. Al subir, la asignación se crea/actualiza sola y pasa a "subido".
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
  const { user, token, weekKey, prod, productoNombre, persona, tipo } = ctx;
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();

  // 1. Pedimos al server que abra la subida a Drive (o nos diga que no está).
  let sess = null;
  try {
    const r = await fetch('/api/produccion/drive-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        productoNombre, persona, tipo, weekKey,
        filename: file.name, mimeType: file.type || 'video/mp4', size: file.size,
      }),
    });
    sess = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(sess.error || `HTTP ${r.status}`);
  } catch {
    sess = { configured: false }; // el server falló → caemos al bucket
  }

  // 2a. Drive listo → PUT directo del video a la session URI.
  if (sess.configured && sess.sessionUri) {
    try {
      const put = await fetch(sess.sessionUri, {
        method: 'PUT',
        headers: { 'Content-Type': sess.contentType || file.type || 'video/mp4' },
        body: file,
      });
      if (put.ok) {
        const meta = await put.json().catch(() => ({}));
        const link = meta.webViewLink
          || (meta.id ? `https://drive.google.com/file/d/${meta.id}/view` : sess.folderLink)
          || null;
        return {
          name: sess.finalName || file.name,
          driveId: meta.id || null,
          link,
          destino: 'drive',
          sizeMB: +(file.size / 1024 / 1024).toFixed(1),
          ts: uid(),
        };
      }
    } catch { /* Drive falló en el PUT → fallback abajo */ }
  }

  // 2b. Fallback: al bucket de AdsLab (browser-direct, RLS por user.id).
  return await uploadToSupabase(file, user, ext);
}

function SubirCreativosModal({ weekKey, productos, personas, onClose, addToast }) {
  const [prodId, setProdId] = useState('');
  const [persona, setPersona] = useState('');
  const [tipo, setTipo] = useState('renovado');
  const [files, setFiles] = useState([]); // { file, id, status:'espera'|'subiendo'|'ok'|'error', destino?, msg? }
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const addFiles = (list) => {
    const nuevos = Array.from(list || [])
      .filter(f => VIDEO_EXT.test(f.name) || (f.type || '').startsWith('video/'))
      .map(f => ({ file: f, id: uid(), status: 'espera' }));
    if (nuevos.length === 0) {
      addToast?.({ type: 'warning', message: 'Arrastrá archivos de video (.mp4, .mov, …).' });
      return;
    }
    setFiles(prev => [...prev, ...nuevos]);
  };

  const prod = productos.find(p => String(p.id) === String(prodId));
  const productoNombre = prod ? prod.nombre : '';
  const listo = !busy && files.length > 0 && !!prodId && !!persona.trim();

  const handleSubir = async () => {
    if (!prodId) { addToast?.({ type: 'warning', message: 'Elegí para qué producto son.' }); return; }
    if (!persona.trim()) { addToast?.({ type: 'warning', message: '¿Quién los subió?' }); return; }
    setBusy(true);
    const user = await getCurrentUser();
    if (!user) { setBusy(false); addToast?.({ type: 'error', message: 'Iniciá sesión de nuevo.' }); return; }
    const token = await getAuthToken();
    const asig = findOrCreateAssignment({
      weekKey, productoId: prod ? prod.id : null, productoNombre, persona: persona.trim(), tipo,
    });
    if (!asig) { setBusy(false); addToast?.({ type: 'error', message: 'No pude crear la asignación.' }); return; }

    const ctx = { user, token, weekKey, prod, productoNombre, persona: persona.trim(), tipo };
    let okCount = 0, dest = null;
    // Secuencial: los videos son pesados, mejor no saturar la conexión.
    for (const item of files) {
      if (item.status === 'ok') continue;
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'subiendo' } : f));
      try {
        const archivo = await uploadOne(item.file, ctx);
        addArchivos(asig.id, [archivo]);
        okCount++; dest = archivo.destino;
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'ok', destino: archivo.destino } : f));
      } catch (err) {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', msg: err.message } : f));
      }
    }
    setBusy(false);
    if (okCount > 0) {
      const donde = dest === 'drive' ? 'Google Drive' : 'AdsLab';
      addToast?.({ type: 'success', message: `${okCount} video${okCount > 1 ? 's' : ''} de ${productoNombre} → ${donde}. Marcado como "subido".` });
    }
  };

  const allDone = files.length > 0 && files.every(f => f.status === 'ok');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white">
            <UploadCloud size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Subir creativos</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Elegí el producto, quién los hizo, y arrastrá los videos.</p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Producto</span>
              <select value={prodId} onChange={e => setProdId(e.target.value)} disabled={busy}
                className="px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="">Elegí un producto…</option>
                {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 w-36">
              <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">¿Quién?</span>
              <input list="up-personas-dl" value={persona} onChange={e => setPersona(e.target.value)} disabled={busy}
                placeholder="Fran…"
                className="px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              <datalist id="up-personas-dl">{(personas || []).map(p => <option key={p} value={p} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Tipo</span>
              <div className="inline-flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600 text-xs font-bold h-[38px]">
                {['renovado', 'testeo'].map(t => (
                  <button key={t} onClick={() => setTipo(t)} disabled={busy}
                    className={`px-3 capitalize ${tipo === t ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>{t}</button>
                ))}
              </div>
            </label>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) addFiles(e.dataTransfer.files); }}
            onClick={() => !busy && inputRef.current?.click()}
            className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
              drag ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-300 dark:border-gray-700 hover:border-emerald-400'}`}>
            <UploadCloud size={26} className="mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-600 dark:text-gray-300">Arrastrá los videos acá o <span className="text-emerald-600 font-semibold">buscalos</span></p>
            <p className="text-[10px] text-gray-400 mt-1">Podés soltar los 9 juntos. AdsLab les pone la nomenclatura y los ordena solo.</p>
            <input ref={inputRef} type="file" accept="video/*" multiple hidden
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {/* Lista de archivos */}
          {files.length > 0 && (
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {files.map(f => (
                <div key={f.id} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                  <span className="flex-shrink-0">
                    {f.status === 'ok' ? <CheckCircle2 size={14} className="text-emerald-500" />
                      : f.status === 'error' ? <AlertTriangle size={14} className="text-red-500" />
                        : f.status === 'subiendo' ? <Loader2 size={14} className="text-brand-500 animate-spin" />
                          : <Film size={14} className="text-gray-400" />}
                  </span>
                  <span className="truncate flex-1 text-gray-700 dark:text-gray-200" title={f.file.name}>{f.file.name}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">{(f.file.size / 1024 / 1024).toFixed(1)}MB</span>
                  {f.status === 'ok' && <span className="text-[9px] font-bold uppercase text-emerald-600 flex-shrink-0">{f.destino === 'drive' ? 'Drive' : 'AdsLab'}</span>}
                  {f.status === 'error' && <span className="text-[10px] text-red-500 truncate max-w-[120px]" title={f.msg}>{f.msg}</span>}
                  {!busy && f.status !== 'ok' && (
                    <button onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))} className="text-gray-300 hover:text-red-500 flex-shrink-0"><X size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          {allDone ? (
            <button onClick={onClose} className="ml-auto px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition">Listo</button>
          ) : (
            <>
              <span className="text-[11px] text-gray-400">
                {files.length > 0 ? `${files.length} video${files.length > 1 ? 's' : ''}` : 'Sin videos todavía'}
              </span>
              <button onClick={handleSubir} disabled={!listo}
                className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
                {busy ? <><Loader2 size={15} className="animate-spin" /> Subiendo…</> : <><UploadCloud size={15} /> Subir</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
