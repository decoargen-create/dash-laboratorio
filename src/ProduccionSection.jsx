// Producción — capa de control del equipo creativo (Fase 1).
// Asignás productos por semana a cada persona, seguís el estado de cada entrega
// (asignado → subido → en revisión → aprobado → publicado) y ves el pago que le
// corresponde a cada uno. Reemplaza los dos Excels (control master + detalle).
//
// Local por ahora. El login del equipo y el push a Drive son Fase 2.

import React, { useEffect, useMemo, useState } from 'react';
import { Users, Plus, X, Trash2, Film, ChevronDown, Wallet, Check } from 'lucide-react';
import {
  ESTADOS, ESTADO_LABELS, VIDEOS_POR_PRODUCTO, weekKeyOf, weekLabel, allWeekKeys,
  listAssignments, addAssignment, updateAssignment, removeAssignment, paymentSummary,
  subscribeProduccion, esCompleto,
} from './produccionStore.js';
import { fmtMoney, toUSD, subscribeMoney } from './moneyStore.js';

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
          <button onClick={() => setShowForm(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg hover:from-brand-600 hover:to-brand-800 transition">
            <Plus size={14} /> Asignar
          </button>
        </div>
      </div>

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
