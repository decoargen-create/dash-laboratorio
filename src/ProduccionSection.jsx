// Producción — capa de control del equipo creativo (Fase 1).
//
// Flujo en cascada, tal cual trabaja el equipo:
//   1. El admin le pasa a Fran los PRODUCTOS de la semana (cuáles y cuántos).
//      Quedan "por distribuir".
//   2. Fran los REPARTE entre los agentes (Fran / Wanda / Flor).
//   3. Cada agente SUBE sus videos eligiendo para qué producto son.
//      → van directo a Google Drive (o al bucket de AdsLab como fallback) y el
//        producto pasa a "subido".
//
// Seguís el estado de cada entrega (asignado → subido → en revisión → aprobado
// → publicado) y ves el pago de cada uno. Reemplaza los dos Excels.
//
// Local por ahora. El login del equipo es Fase 2.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Plus, X, Trash2, Film, ChevronDown, Wallet, UploadCloud, Package,
  Loader2, CheckCircle2, AlertTriangle, ExternalLink, ArrowRight,
} from 'lucide-react';
import {
  ESTADOS, ESTADO_LABELS, VIDEOS_POR_PRODUCTO, weekKeyOf, weekLabel, allWeekKeys,
  listAssignments, addProductoSemana, assignPersona, updateAssignment, removeAssignment,
  paymentSummary, subscribeProduccion, esCompleto, addArchivos,
} from './produccionStore.js';
import { fmtMoney, toUSD, subscribeMoney } from './moneyStore.js';
import { supabase, getCurrentUser } from './supabase.js';

const BUCKET = 'creativos';
const EQUIPO_DEFAULT = ['Fran', 'Wanda', 'Flor'];
// Formatea un monto en ARS respetando el switch de moneda global.
const fmtPago = (ars) => fmtMoney(toUSD(ars, 'ARS'));

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
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    const un1 = subscribeProduccion(() => force(x => x + 1));
    const un2 = subscribeMoney(() => force(x => x + 1));
    return () => { un1(); un2(); };
  }, []);

  const semanas = useMemo(() => {
    const keys = new Set(allWeekKeys());
    keys.add(weekKeyOf());
    return [...keys].sort().reverse();
  }, [weekKey]); // eslint-disable-line

  const asigs = listAssignments(weekKey);
  const porDistribuir = asigs.filter(a => !a.persona);
  const resumen = paymentSummary(weekKey);
  const totalSemana = resumen.reduce((s, r) => s + r.totalArs, 0);

  const personas = useMemo(() => {
    const set = new Set(EQUIPO_DEFAULT);
    allWeekKeys().forEach(wk => listAssignments(wk).forEach(a => { if (a.persona) set.add(a.persona); }));
    productos.forEach(p => { const r = (p.responsable || '').trim(); if (r) set.add(r); });
    return [...set];
  }, [weekKey, productos]); // eslint-disable-line

  const gruposPorPersona = useMemo(() => {
    const map = {};
    for (const a of asigs) { if (a.persona) (map[a.persona] = map[a.persona] || []).push(a); }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [asigs]);

  const nadaEnSemana = asigs.length === 0;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
          <Film size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Producción</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Productos de la semana → Fran los reparte → cada agente sube.</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select value={weekKey} onChange={e => setWeekKey(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              {semanas.map(wk => <option key={wk} value={wk}>{weekLabel(wk)}{wk === weekKeyOf() ? ' (esta semana)' : ''}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={() => setShowUpload(true)} disabled={asigs.every(a => !a.persona)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg hover:from-emerald-600 hover:to-emerald-800 transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            title={asigs.every(a => !a.persona) ? 'Primero repartí algún producto a un agente' : 'Subir creativos'}>
            <UploadCloud size={14} /> Subir creativos
          </button>
          <button onClick={() => setShowAdd(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/25 border border-brand-200 dark:border-brand-800 rounded-lg hover:bg-brand-100 transition">
            <Plus size={14} /> Agregar productos
          </button>
        </div>
      </div>

      {showUpload && (
        <SubirCreativosModal
          weekKey={weekKey}
          asignaciones={asigs.filter(a => a.persona)}
          onClose={() => setShowUpload(false)}
          addToast={addToast}
        />
      )}

      {/* Paso 1 — agregar productos de la semana (multi-selección) */}
      {showAdd && (
        <AgregarProductosForm
          productos={productos}
          asigs={asigs}
          weekKey={weekKey}
          onClose={() => setShowAdd(false)}
          addToast={addToast}
        />
      )}

      {/* Estado vacío */}
      {nadaEnSemana && !showAdd && (
        <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-10 text-center text-gray-400 dark:text-gray-500">
          <Package size={26} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm">Todavía no cargaste productos para {weekLabel(weekKey).toLowerCase()}.</p>
          <button onClick={() => setShowAdd(true)} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">
            <Plus size={14} /> Agregar productos de la semana
          </button>
        </div>
      )}

      {/* Paso 2 — por distribuir (Fran reparte) */}
      {porDistribuir.length > 0 && (
        <div className="bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2.5 px-1">
            <ArrowRight size={14} className="text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300">Por distribuir</h3>
            <span className="text-[11px] text-amber-600/80 dark:text-amber-400/70">— Fran, repartí cada producto a un agente</span>
          </div>
          <div className="space-y-2">
            {porDistribuir.map(a => (
              <div key={a.id} className="bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-2 min-w-[150px]">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{a.productoNombre || 'Producto'}</span>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${a.tipo === 'testeo' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'}`}>{a.tipo}</span>
                </div>
                <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                  <span className="text-[11px] text-gray-400 mr-0.5">Asignar a:</span>
                  {personas.map(p => (
                    <button key={p} onClick={() => { assignPersona(a.id, p); addToast?.({ type: 'success', message: `${a.productoNombre} → ${p}` }); }}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-brand-600 hover:text-white transition">
                      {p}
                    </button>
                  ))}
                  <button onClick={() => { if (window.confirm(`¿Sacar ${a.productoNombre} de la semana?`)) removeAssignment(a.id); }}
                    className="text-gray-300 hover:text-red-500 transition ml-1" title="Sacar de la semana"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paso 3 — tablero por agente */}
      {gruposPorPersona.length > 0 && (
        <div className="space-y-5">
          {gruposPorPersona.map(([persona, items]) => {
            const r = resumen.find(x => x.persona === persona);
            return (
              <div key={persona}>
                <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                  <Users size={14} className="text-brand-500" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{persona}</h3>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">· {r?.completados || 0}/{items.length} completos</span>
                  {r && r.totalArs > 0 && (
                    <span className="ml-auto text-xs font-mono font-bold tabular-nums text-brand-600 dark:text-brand-400"
                      title={`Productos: ${fmtPago(r.montoProductos)}${r.bonus ? ` · Objetivo: ${fmtPago(r.bonus)}` : ''}`}>
                      {fmtPago(r.totalArs)}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {items.map(a => <AsignacionRow key={a.id} a={a} personas={personas} />)}
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

// ── Paso 1: agregar productos de la semana (multi-selección). Quedan "por
// distribuir" hasta que Fran los reparta.
function AgregarProductosForm({ productos, asigs, weekKey, onClose, addToast }) {
  const [sel, setSel] = useState(() => new Set());
  const [tipo, setTipo] = useState('renovado');

  const yaEnSemana = useMemo(() => {
    const ids = new Set(), nombres = new Set();
    asigs.forEach(a => { if (a.productoId != null) ids.add(String(a.productoId)); if (a.productoNombre) nombres.add(a.productoNombre); });
    return { ids, nombres };
  }, [asigs]);

  const toggle = (id) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const agregar = () => {
    if (sel.size === 0) { addToast?.({ type: 'warning', message: 'Elegí al menos un producto.' }); return; }
    let n = 0;
    for (const id of sel) {
      const p = productos.find(x => String(x.id) === String(id));
      if (!p) continue;
      addProductoSemana({ weekKey, productoId: p.id, productoNombre: p.nombre, tipo });
      n++;
    }
    addToast?.({ type: 'success', message: `${n} producto${n > 1 ? 's' : ''} agregado${n > 1 ? 's' : ''} a la semana` });
    onClose();
  };

  return (
    <div className="bg-white dark:bg-gray-800 border-2 border-brand-300 dark:border-brand-700 rounded-xl p-4 space-y-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <Package size={15} className="text-brand-500" />
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Productos de la semana</h3>
        <span className="text-[11px] text-gray-400">Elegí cuáles y cuántos — después Fran los reparte</span>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>

      {productos.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">No tenés productos cargados todavía. Creá uno en <b>Productos</b> primero.</p>
      ) : (
        <>
          <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1">
            {productos.map(p => {
              const ya = yaEnSemana.ids.has(String(p.id)) || yaEnSemana.nombres.has(p.nombre);
              const checked = sel.has(String(p.id));
              return (
                <button key={p.id} onClick={() => !ya && toggle(String(p.id))} disabled={ya}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition ${
                    ya ? 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                      : checked ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/25 text-brand-800 dark:text-brand-200'
                        : 'border-gray-200 dark:border-gray-600 hover:border-brand-300 text-gray-700 dark:text-gray-200'}`}>
                  <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${checked ? 'bg-brand-600 border-brand-600' : 'border-gray-300 dark:border-gray-500'}`}>
                    {checked && <CheckCircle2 size={11} className="text-white" />}
                  </span>
                  <span className="truncate">{p.nombre}</span>
                  {ya && <span className="ml-auto text-[9px] uppercase font-bold text-gray-400">en la semana</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="inline-flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600 text-xs font-bold">
              {['renovado', 'testeo'].map(t => (
                <button key={t} onClick={() => setTipo(t)}
                  className={`px-3 py-1.5 capitalize ${tipo === t ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>{t}</button>
              ))}
            </div>
            <button onClick={agregar} disabled={sel.size === 0}
              className="ml-auto px-3 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed">
              Agregar {sel.size > 0 ? `(${sel.size})` : ''} a la semana
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Fila de una asignación ya repartida: producto, tipo, estado, videos, archivos.
function AsignacionRow({ a, personas }) {
  const completo = esCompleto(a.estado);
  const [reasign, setReasign] = useState(false);
  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${completo ? 'border-emerald-300 dark:border-emerald-800' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="flex items-center gap-2 min-w-[150px]">
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{a.productoNombre || 'Producto'}</span>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${a.tipo === 'testeo' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'}`}>{a.tipo}</span>
        <button onClick={() => setReasign(v => !v)} className="text-gray-300 hover:text-brand-500 transition" title="Reasignar a otro agente"><ArrowRight size={12} /></button>
      </div>

      {reasign && (
        <div className="flex items-center gap-1 flex-wrap w-full sm:w-auto">
          {personas.filter(p => p !== a.persona).map(p => (
            <button key={p} onClick={() => { assignPersona(a.id, p); setReasign(false); }}
              className="text-[10px] font-bold px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 hover:bg-brand-600 hover:text-white transition">{p}</button>
          ))}
        </div>
      )}

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
              className="text-brand-500 hover:text-brand-600" title="Ver en Drive"><ExternalLink size={11} /></a>
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

// ── Paso 3: "Subir creativos". El agente elige uno de SUS productos de la
// semana (ya repartido) y sube los videos. Van directo a Google Drive (si está
// configurado) o al bucket de AdsLab como fallback. Al subir, el producto pasa
// a "subido".
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
  const { user, token, weekKey, productoNombre, persona, tipo } = ctx;
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();

  // 1. El server abre la subida a Drive (o nos dice que no está configurado).
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
    sess = { configured: false };
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
        return { name: sess.finalName || file.name, driveId: meta.id || null, link, destino: 'drive', sizeMB: +(file.size / 1024 / 1024).toFixed(1), ts: uid() };
      }
    } catch { /* Drive falló en el PUT → fallback abajo */ }
  }

  // 2b. Fallback: al bucket de AdsLab (browser-direct, RLS por user.id).
  return await uploadToSupabase(file, user, ext);
}

function SubirCreativosModal({ weekKey, asignaciones, onClose, addToast }) {
  const [asigId, setAsigId] = useState(asignaciones.length === 1 ? asignaciones[0].id : '');
  const [files, setFiles] = useState([]); // { file, id, status, destino?, msg? }
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const asig = asignaciones.find(a => a.id === asigId);

  const addFiles = (list) => {
    const nuevos = Array.from(list || [])
      .filter(f => VIDEO_EXT.test(f.name) || (f.type || '').startsWith('video/'))
      .map(f => ({ file: f, id: uid(), status: 'espera' }));
    if (nuevos.length === 0) { addToast?.({ type: 'warning', message: 'Arrastrá archivos de video (.mp4, .mov, …).' }); return; }
    setFiles(prev => [...prev, ...nuevos]);
  };

  const listo = !busy && files.length > 0 && !!asig;

  const handleSubir = async () => {
    if (!asig) { addToast?.({ type: 'warning', message: 'Elegí para qué producto son.' }); return; }
    setBusy(true);
    const user = await getCurrentUser();
    if (!user) { setBusy(false); addToast?.({ type: 'error', message: 'Iniciá sesión de nuevo.' }); return; }
    const token = await getAuthToken();
    const ctx = { user, token, weekKey, productoNombre: asig.productoNombre, persona: asig.persona, tipo: asig.tipo };
    let okCount = 0, dest = null;
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
      addToast?.({ type: 'success', message: `${okCount} video${okCount > 1 ? 's' : ''} de ${asig.productoNombre} → ${donde}. Marcado "subido".` });
    }
  };

  const allDone = files.length > 0 && files.every(f => f.status === 'ok');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white"><UploadCloud size={16} /></div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Subir creativos</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Elegí para qué producto son y arrastrá los videos.</p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {asignaciones.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
              Todavía no hay productos repartidos esta semana. Primero agregá productos y repartilos a un agente.
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">¿Para qué producto?</span>
                <select value={asigId} onChange={e => setAsigId(e.target.value)} disabled={busy}
                  className="px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">Elegí un producto…</option>
                  {asignaciones.map(a => <option key={a.id} value={a.id}>{a.productoNombre} — {a.persona}{a.archivos?.length ? ` (${a.archivos.length} ya)` : ''}</option>)}
                </select>
              </label>

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
                <input ref={inputRef} type="file" accept="video/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
              </div>

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
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          {allDone ? (
            <button onClick={onClose} className="ml-auto px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition">Listo</button>
          ) : (
            <>
              <span className="text-[11px] text-gray-400">{files.length > 0 ? `${files.length} video${files.length > 1 ? 's' : ''}` : 'Sin videos todavía'}</span>
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
