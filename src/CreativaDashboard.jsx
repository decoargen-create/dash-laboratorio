// Área creativa — Resumen del mes.
//
// Workspace para PUBLICAR y seguir los pagos. Dos bloques:
//   1. Por producto: cuántas tarjetas hay por hacer / entregadas / listas para
//      publicar. Al abrir un producto se ven sus tarjetas listas, cada una con
//      acceso directo al Drive y un botón "Publicar" (la marca como Publicado).
//   2. Pagos del mes: por persona (total / pagado / pendiente) con "Pagar mes".
//
// El operativo (asignar, repartir, subir) vive en Producción; esto es la vista
// de publicación + plata.

import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, ChevronDown, Check, Clock, CheckCircle2, Film, Rocket, ExternalLink, Users } from 'lucide-react';
import {
  monthKeyOf, monthLabel, allMonthKeys, monthlySummary, setWeekPaid,
  weekLabel, subscribeProduccion, weeksInMonth, listAssignments, updateAssignment,
} from './produccionStore.js';
import { fmtMoney, toUSD, subscribeMoney } from './moneyStore.js';

const fmtPago = (ars) => fmtMoney(toUSD(ars, 'ARS'));

// Color estable del avatar según el nombre (para reconocer a la persona).
const AV = ['bg-brand-500', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500'];
function avColor(name) {
  let h = 0; const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
}

const ESTADO_BADGE = {
  aprobado: 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40',
  revision: 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40',
};

// Celda de chip en columna fija (para que los 3 conteos por producto queden
// alineados verticalmente entre filas). Si el número es 0, muestra "—".
const CHIP_TONE = {
  slate: 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50',
  emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40',
  brand: 'text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30',
};
function ChipCell({ n, label, tone }) {
  if (!n) return <span className="text-center text-xs text-gray-300 dark:text-gray-600 select-none">—</span>;
  return <span className={`block text-center text-[10.5px] font-bold px-1 py-1 rounded-full whitespace-nowrap ${CHIP_TONE[tone]}`}>{n} {label}</span>;
}

export default function CreativaDashboard({ addToast }) {
  const [, force] = useState(0);
  const [monthKey, setMonthKey] = useState(() => monthKeyOf());
  const [expandedProd, setExpandedProd] = useState(() => new Set());
  const toggleProd = (nombre) => setExpandedProd(prev => {
    const n = new Set(prev); n.has(nombre) ? n.delete(nombre) : n.add(nombre); return n;
  });

  useEffect(() => {
    const un1 = subscribeProduccion(() => force(x => x + 1));
    const un2 = subscribeMoney(() => force(x => x + 1));
    return () => { un1(); un2(); };
  }, []);

  const meses = useMemo(() => {
    const keys = new Set(allMonthKeys());
    keys.add(monthKeyOf());
    return [...keys].sort().reverse();
  }, [monthKey]); // eslint-disable-line

  const { personas, totals } = monthlySummary(monthKey);

  // ── Por producto (del mes). Sin useMemo: se recalcula por render, así al
  // marcar una tarjeta como publicada desaparece de "listas" al instante. ──
  //   entregadas = publicadas (o archivadas);
  //   listas     = aprobado/revisión con al menos 1 video (listas para publicar);
  //   por hacer  = el resto (asignadas − entregadas − listas).
  const asigsMes = weeksInMonth(monthKey).flatMap(wk => listAssignments(wk));
  const productos = (() => {
    const by = new Map();
    for (const a of asigsMes) {
      const nombre = (a.productoNombre || '').trim() || 'Sin producto';
      if (!by.has(nombre)) by.set(nombre, { nombre, asignadas: 0, entregadas: 0, listas: [] });
      const p = by.get(nombre);
      p.asignadas++;
      const videos = (a.archivos || []).length;
      if (a.estado === 'publicado' || a.estado === 'archivado') p.entregadas++;
      else if ((a.estado === 'aprobado' || a.estado === 'revision') && videos > 0) {
        p.listas.push({
          id: a.id, persona: (a.persona || '').trim() || 'Sin asignar', estado: a.estado, videos,
          folderLink: (a.archivos || []).find(f => f.folderLink)?.folderLink || null,
        });
      }
    }
    return [...by.values()]
      .map(p => ({
        ...p, porHacer: p.asignadas - p.entregadas - p.listas.length,
        listas: p.listas.sort((x, y) => (x.estado === y.estado ? 0 : x.estado === 'aprobado' ? -1 : 1) || x.persona.localeCompare(y.persona, 'es')),
      }))
      .sort((a, b) => b.listas.length - a.listas.length || b.asignadas - a.asignadas || a.nombre.localeCompare(b.nombre, 'es'));
  })();
  const mesKpis = {
    tarjetas: asigsMes.length,
    entregadas: productos.reduce((s, p) => s + p.entregadas, 0),
    revision: asigsMes.filter(a => a.estado === 'revision').length,
    listas: productos.reduce((s, p) => s + p.listas.length, 0),
  };

  const pagarMes = (p) => {
    p.semanas.filter(s => !s.paid).forEach(s => setWeekPaid(s.weekKey, p.persona, true));
    addToast?.({ type: 'success', message: `${p.persona} — el mes quedó pagado` });
  };
  const marcarPublicado = (c) => {
    updateAssignment(c.id, { estado: 'publicado' });
    addToast?.({ type: 'success', message: `🚀 Publicado — ${c.persona}` });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
          <Wallet size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Resumen del mes</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Publicá lo que está listo y seguí los pagos.</p>
        </div>
        <div className="ml-auto relative">
          <select value={monthKey} onChange={e => setMonthKey(e.target.value)}
            className="appearance-none pl-3 pr-8 py-1.5 text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 capitalize">
            {meses.map(mk => <option key={mk} value={mk}>{monthLabel(mk)}{mk === monthKeyOf() ? ' (este mes)' : ''}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard icon={Film} label="Tarjetas" value={String(mesKpis.tarjetas)} tone="gray" />
        <KpiCard icon={CheckCircle2} label="Entregadas" value={String(mesKpis.entregadas)} tone="emerald" />
        <KpiCard icon={Clock} label="En revisión" value={String(mesKpis.revision)} tone={mesKpis.revision > 0 ? 'amber' : 'gray'} />
        <KpiCard icon={Rocket} label="Listas p/ publicar" value={String(mesKpis.listas)} tone="brand" />
        <KpiCard icon={Wallet} label="Pendiente" value={fmtPago(totals.pendiente)} tone={totals.pendiente > 0 ? 'amber' : 'gray'} />
      </div>

      {/* POR PRODUCTO */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/60">
          <Film size={15} className="text-brand-500" />
          <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Por producto</span>
          <span className="ml-auto text-[11px] text-gray-400">tocá un producto para ver sus tarjetas</span>
        </div>
        {productos.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 py-6 text-center">No hay tarjetas en {monthLabel(monthKey).toLowerCase()} todavía.</p>
        ) : productos.map(p => {
          const open = expandedProd.has(p.nombre);
          return (
            <div key={p.nombre} className="border-t border-gray-100 dark:border-gray-700/60 first:border-t-0">
              <button onClick={() => toggleProd(p.nombre)}
                className={`w-full grid items-center gap-2 px-4 py-3 text-left transition grid-cols-[minmax(0,1fr)_80px_94px_64px] ${open ? 'bg-gray-50 dark:bg-gray-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                <span className="flex items-center gap-2 min-w-0">
                  <ChevronDown size={15} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                  <span className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{p.nombre}</span>
                </span>
                <ChipCell n={p.porHacer} label="por hacer" tone="slate" />
                <ChipCell n={p.entregadas} label={p.entregadas === 1 ? 'entregada' : 'entregadas'} tone="emerald" />
                <ChipCell n={p.listas.length} label={p.listas.length === 1 ? 'lista' : 'listas'} tone="brand" />
              </button>
              {open && (
                <div className="bg-gray-50/60 dark:bg-gray-900/20 border-t border-gray-100 dark:border-gray-700/60">
                  {p.listas.length === 0 ? (
                    <p className="text-xs text-gray-400 px-4 py-3">No hay tarjetas listas para publicar de este producto (están por hacer o ya entregadas).</p>
                  ) : p.listas.map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-dashed border-gray-200 dark:border-gray-700/60 first:border-t-0">
                      <span className={`w-7 h-7 rounded-lg ${avColor(c.persona)} text-white flex items-center justify-center text-xs font-bold uppercase shrink-0`}>{c.persona.charAt(0)}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight">{c.persona}</div>
                        <div className="text-[11px] text-gray-400">{c.videos} video{c.videos === 1 ? '' : 's'}</div>
                      </div>
                      <span className={`text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${ESTADO_BADGE[c.estado]}`}>
                        {c.estado === 'aprobado' ? '✓ Aprobado' : '👀 Revisión'}
                      </span>
                      <div className="ml-auto flex items-center gap-2 shrink-0">
                        {c.folderLink ? (
                          <a href={c.folderLink} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 dark:text-brand-300 hover:underline">
                            <ExternalLink size={12} /> Drive
                          </a>
                        ) : (
                          <span className="text-[10px] text-gray-400" title="Se subió a AdsLab (antes de conectar Drive)">AdsLab</span>
                        )}
                        <button onClick={() => marcarPublicado(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-extrabold text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 rounded-lg transition shadow-sm">
                          <Rocket size={12} /> Publicar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* PAGOS DEL MES */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/60">
          <Wallet size={15} className="text-brand-500" />
          <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Pagos del mes</span>
          {totals.pendiente > 0 && <span className="ml-auto text-[11px] font-bold text-amber-600 dark:text-amber-400">{fmtPago(totals.pendiente)} pendiente</span>}
        </div>
        {personas.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 py-6 text-center">No hay pagos en {monthLabel(monthKey).toLowerCase()} todavía. El pago se cuenta cuando un producto queda aprobado.</p>
        ) : (<>
          {/* Mobile: tarjetas apiladas por persona (la tabla scrollea feo en el celu). */}
          <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700/60">
            {personas.map(p => (
              <div key={p.persona} className="flex items-center gap-3 px-4 py-3">
                <span className={`w-9 h-9 rounded-lg ${avColor(p.persona)} text-white flex items-center justify-center text-sm font-bold uppercase shrink-0`}>{p.persona.charAt(0)}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{p.persona}</div>
                  <div className="text-[11px] text-gray-400">{p.completados} completos · total {fmtPago(p.total)}</div>
                </div>
                <div className="text-right shrink-0">
                  {p.pendiente > 0 ? (
                    <>
                      <div className="font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400 text-sm">{fmtPago(p.pendiente)}</div>
                      <button onClick={() => pagarMes(p)} className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">
                        <Check size={11} /> Pagar mes
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400"><Check size={12} /> Al día</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2.5">Persona</th>
                  <th className="text-center px-3 py-2.5">Completos</th>
                  <th className="text-right px-3 py-2.5">Total mes</th>
                  <th className="text-right px-3 py-2.5">Pagado</th>
                  <th className="text-right px-3 py-2.5">Pendiente</th>
                  <th className="text-right px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                {personas.map(p => (
                  <tr key={p.persona} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 font-bold text-gray-900 dark:text-gray-100">
                        <span className={`w-7 h-7 rounded-lg ${avColor(p.persona)} text-white flex items-center justify-center text-xs font-bold uppercase shrink-0`}>{p.persona.charAt(0)}</span>
                        {p.persona}
                      </span>
                    </td>
                    <td className="text-center px-3 py-2.5 tabular-nums font-semibold text-gray-700 dark:text-gray-200">{p.completados}</td>
                    <td className="text-right px-3 py-2.5 font-mono tabular-nums font-bold text-gray-800 dark:text-gray-100">{fmtPago(p.total)}</td>
                    <td className="text-right px-3 py-2.5 font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{p.pagado > 0 ? fmtPago(p.pagado) : '—'}</td>
                    <td className="text-right px-3 py-2.5">
                      {p.pendiente > 0
                        ? <span className="font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">{fmtPago(p.pendiente)}</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400"><Check size={12} /> Al día</span>}
                    </td>
                    <td className="text-right px-4 py-2.5">
                      {p.pendiente > 0 && (
                        <button onClick={() => pagarMes(p)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">
                          <Check size={13} /> Pagar mes
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 font-bold">
                  <td className="px-4 py-2.5 text-[11px] uppercase tracking-wide text-gray-400">Total</td>
                  <td className="text-center px-3 py-2.5 tabular-nums text-gray-700 dark:text-gray-200">{totals.completados}</td>
                  <td className="text-right px-3 py-2.5 font-mono tabular-nums text-gray-900 dark:text-gray-100">{fmtPago(totals.total)}</td>
                  <td className="text-right px-3 py-2.5 font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{fmtPago(totals.pagado)}</td>
                  <td className="text-right px-3 py-2.5 font-mono tabular-nums text-amber-600 dark:text-amber-400">{totals.pendiente > 0 ? fmtPago(totals.pendiente) : '—'}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>)}
        <p className="text-[10px] text-gray-400 dark:text-gray-500 px-4 py-2 border-t border-gray-100 dark:border-gray-700/60">
          Pago mensual por persona. "Pagar mes" salda todo lo pendiente del mes de esa persona.
        </p>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone = 'gray' }) {
  const tones = {
    brand: 'text-brand-600 dark:text-brand-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    gray: 'text-gray-500 dark:text-gray-400',
  };
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
        <Icon size={13} className={tones[tone]} /> {label}
      </div>
      <div className={`text-lg font-bold font-mono tabular-nums ${tone === 'gray' ? 'text-gray-900 dark:text-gray-100' : tones[tone]}`}>{value}</div>
    </div>
  );
}
