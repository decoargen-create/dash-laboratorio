// Área creativa — Dashboard del mes.
// Resumen de lo que hay que pagarle al equipo creativo: total del mes, ya
// pagado, pendiente, y el detalle por persona (semana por semana) con un botón
// para marcar cada semana como pagada. Los montos respetan el switch ARS/USD.
//
// El "operativo" (asignar, repartir, subir) vive en Producción; esto es la
// vista de plata/resumen.

import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, ChevronDown, Check, Clock, CheckCircle2, Users, Film, TrendingUp, Rocket, ExternalLink, Table2 } from 'lucide-react';
import {
  monthKeyOf, monthLabel, allMonthKeys, monthlySummary, setWeekPaid,
  weekLabel, subscribeProduccion, weeksInMonth, listAssignments, paymentSummary,
  weekNumber, weekRange, esCompleto,
} from './produccionStore.js';
import { probeDrive } from './produccionUpload.jsx';
import { fmtMoney, toUSD, subscribeMoney } from './moneyStore.js';

const fmtPago = (ars) => fmtMoney(toUSD(ars, 'ARS'));

export default function CreativaDashboard({ addToast }) {
  const [, force] = useState(0);
  const [monthKey, setMonthKey] = useState(() => monthKeyOf());
  const [expanded, setExpanded] = useState(null);

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
  const conPendiente = personas.filter(p => p.pendiente > 0);

  // ── Grilla semanal tipo Excel: filas = personas, columnas = Semana N ──
  const [gridMode, setGridMode] = useState('money'); // 'money' | 'videos'
  const grid = useMemo(() => {
    const weeks = weeksInMonth(monthKey); // weekKeys del mes con asignaciones
    const porSemana = weeks.map(wk => ({ wk, rows: paymentSummary(wk) }));
    const set = new Set();
    porSemana.forEach(w => w.rows.forEach(r => set.add(r.persona)));
    const filas = [...set].sort((a, b) => a.localeCompare(b, 'es')).map(persona => {
      const cel = {}; let money = 0, comp = 0;
      weeks.forEach(wk => {
        const r = (porSemana.find(w => w.wk === wk)?.rows || []).find(x => x.persona === persona);
        cel[wk] = { money: r?.totalArs || 0, comp: r?.completados || 0 };
        money += cel[wk].money; comp += cel[wk].comp;
      });
      return { persona, cel, money, comp };
    });
    const colTot = {};
    weeks.forEach(wk => { colTot[wk] = filas.reduce((s, f) => ({ money: s.money + f.cel[wk].money, comp: s.comp + f.cel[wk].comp }), { money: 0, comp: 0 }); });
    return { weeks, filas, colTot };
  }, [monthKey]); // eslint-disable-line

  // ── KPIs de producción del mes (aprobados / publicados / en curso) ──
  const prodKpis = useMemo(() => {
    const asigs = weeksInMonth(monthKey).flatMap(wk => listAssignments(wk));
    return {
      aprobados: asigs.filter(a => esCompleto(a.estado)).length,
      publicados: asigs.filter(a => a.estado === 'publicado').length,
      enCurso: asigs.filter(a => a.estado === 'porhacer' || a.estado === 'revision').length,
      videos: asigs.reduce((n, a) => n + (a.archivos?.length || 0), 0),
    };
  }, [monthKey]); // eslint-disable-line

  // ── Links de Drive por producto del mes ──
  const [driveRoot, setDriveRoot] = useState(null);
  useEffect(() => { let dead = false; probeDrive().then(d => { if (!dead && d?.configured) setDriveRoot(d.rootLink); }); return () => { dead = true; }; }, []);
  const productosDrive = useMemo(() => {
    const asigs = weeksInMonth(monthKey).flatMap(wk => listAssignments(wk));
    const byProd = new Map();
    asigs.forEach(a => {
      const nombre = a.productoNombre || 'Producto';
      const folder = (a.archivos || []).find(f => f.folderLink)?.folderLink;
      const cur = byProd.get(nombre) || { nombre, folder: null, subidos: 0 };
      cur.subidos += (a.archivos?.length || 0);
      if (folder && !cur.folder) cur.folder = folder;
      byProd.set(nombre, cur);
    });
    return [...byProd.values()].filter(p => p.subidos > 0).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [monthKey]); // eslint-disable-line

  const pagarSemana = (weekKey, persona, paid) => {
    setWeekPaid(weekKey, persona, paid);
    if (paid) addToast?.({ type: 'success', message: `${persona} — ${weekLabel(weekKey).toLowerCase()} marcada como pagada` });
  };
  const pagarTodoPersona = (p) => {
    p.semanas.filter(s => !s.paid).forEach(s => setWeekPaid(s.weekKey, p.persona, true));
    addToast?.({ type: 'success', message: `Todo lo pendiente de ${p.persona} marcado como pagado` });
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
          <p className="text-xs text-gray-500 dark:text-gray-400">Pagos del equipo creativo — pendientes y detalle.</p>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={TrendingUp} label="A pagar (mes)" value={fmtPago(totals.total)} tone="brand" />
        <KpiCard icon={Clock} label="Pendiente" value={fmtPago(totals.pendiente)} tone={totals.pendiente > 0 ? 'amber' : 'gray'} />
        <KpiCard icon={CheckCircle2} label="Pagado" value={fmtPago(totals.pagado)} tone="emerald" />
        <KpiCard icon={Film} label="Productos completos" value={String(totals.completados)} tone="gray" />
      </div>

      {/* KPIs de PRODUCCIÓN del mes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={CheckCircle2} label="Aprobados (mes)" value={String(prodKpis.aprobados)} tone="emerald" />
        <KpiCard icon={Rocket} label="Publicados (mes)" value={String(prodKpis.publicados)} tone="brand" />
        <KpiCard icon={Clock} label="En curso" value={String(prodKpis.enCurso)} tone={prodKpis.enCurso > 0 ? 'amber' : 'gray'} />
        <KpiCard icon={Film} label="Videos subidos" value={String(prodKpis.videos)} tone="gray" />
      </div>

      {/* GRILLA SEMANAL tipo Excel: personas × Semana 1..N + Total */}
      {grid.filas.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/60">
            <Table2 size={15} className="text-brand-500" />
            <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Grilla del mes · por persona y semana</span>
            <div className="ml-auto inline-flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-[11px] font-bold">
              <button onClick={() => setGridMode('money')} className={`px-2.5 py-1 ${gridMode === 'money' ? 'bg-brand-600 text-white' : 'text-gray-500 dark:text-gray-300'}`}>$</button>
              <button onClick={() => setGridMode('videos')} className={`px-2.5 py-1 ${gridMode === 'videos' ? 'bg-brand-600 text-white' : 'text-gray-500 dark:text-gray-300'}`}>videos</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2.5 sticky left-0 bg-white dark:bg-gray-800">Persona</th>
                  {grid.weeks.map(wk => (
                    <th key={wk} className="text-right px-3 py-2.5 whitespace-nowrap" title={weekRange(wk)}>Sem {weekNumber(wk)}</th>
                  ))}
                  <th className="text-right px-4 py-2.5">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                {grid.filas.map(f => (
                  <tr key={f.persona} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-2 font-semibold text-gray-800 dark:text-gray-100 sticky left-0 bg-white dark:bg-gray-800">{f.persona}</td>
                    {grid.weeks.map(wk => {
                      const c = f.cel[wk];
                      const v = gridMode === 'money' ? c.money : c.comp;
                      return <td key={wk} className={`text-right px-3 py-2 tabular-nums ${v > 0 ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'}`}>{v > 0 ? (gridMode === 'money' ? fmtPago(c.money) : c.comp) : '·'}</td>;
                    })}
                    <td className="text-right px-4 py-2 font-mono tabular-nums font-bold text-gray-900 dark:text-white">{gridMode === 'money' ? fmtPago(f.money) : f.comp}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 font-bold">
                  <td className="px-4 py-2.5 text-[11px] uppercase tracking-wide text-gray-400 sticky left-0 bg-gray-50 dark:bg-gray-900/60">Total</td>
                  {grid.weeks.map(wk => {
                    const c = grid.colTot[wk];
                    return <td key={wk} className="text-right px-3 py-2.5 font-mono tabular-nums text-gray-700 dark:text-gray-200">{gridMode === 'money' ? fmtPago(c.money) : c.comp}</td>;
                  })}
                  <td className="text-right px-4 py-2.5 font-mono tabular-nums text-brand-600 dark:text-brand-400">{gridMode === 'money' ? fmtPago(totals.total) : totals.completados}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* LINKS de Drive de los productos del mes */}
      {(productosDrive.length > 0 || driveRoot) && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Film size={15} className="text-brand-500" />
            <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Creativos en Drive</span>
            {driveRoot && (
              <a href={driveRoot} target="_blank" rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-brand-600 dark:text-brand-300 hover:underline">
                <ExternalLink size={13} /> Abrir Drive
              </a>
            )}
          </div>
          {productosDrive.length === 0 ? (
            <p className="text-xs text-gray-400">Todavía no hay creativos subidos este mes.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {productosDrive.map(p => (
                <div key={p.nombre} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
                  <Film size={14} className="text-emerald-500 shrink-0" />
                  <span className="flex-1 truncate text-gray-800 dark:text-gray-100" title={p.nombre}>{p.nombre}</span>
                  <span className="text-[11px] tabular-nums text-gray-400">{p.subidos}</span>
                  {p.folder
                    ? <a href={p.folder} target="_blank" rel="noopener noreferrer" title="Carpeta en Drive" className="text-brand-500 hover:text-brand-600"><ExternalLink size={14} /></a>
                    : <span className="text-[10px] text-gray-400" title="Se subió a AdsLab (antes de conectar Drive)">AdsLab</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {personas.length === 0 ? (
        <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-10 text-center text-gray-400 dark:text-gray-500">
          <Wallet size={26} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm">No hay productos aprobados en {monthLabel(monthKey).toLowerCase()} todavía.</p>
          <p className="text-xs mt-1">El pago se cuenta cuando un producto queda <b>aprobado</b> en Producción.</p>
        </div>
      ) : (
        <>
          {/* Aviso de pendientes */}
          {conPendiente.length > 0 && (
            <div className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2 text-amber-800 dark:text-amber-300">
              <Clock size={15} />
              <span>Tenés <b>{fmtPago(totals.pendiente)}</b> pendiente con {conPendiente.map(p => p.persona).join(', ')}.</span>
            </div>
          )}

          {/* Detalle por persona — formato TABLA (pedido del user), con fila
              expandible para el detalle semana por semana. */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left px-4 py-2.5">Persona</th>
                    <th className="text-center px-3 py-2.5">Completos</th>
                    <th className="text-center px-3 py-2.5">Sem.</th>
                    <th className="text-right px-3 py-2.5">Total</th>
                    <th className="text-right px-3 py-2.5">Pagado</th>
                    <th className="text-right px-3 py-2.5">Pendiente</th>
                    <th className="w-10" aria-label="detalle" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                  {personas.map(p => {
                    const open = expanded === p.persona;
                    return (
                      <React.Fragment key={p.persona}>
                        <tr onClick={() => setExpanded(open ? null : p.persona)}
                          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-2 font-bold text-gray-900 dark:text-gray-100">
                              <span className="w-7 h-7 rounded-lg bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center text-brand-600 dark:text-brand-300 shrink-0">
                                <Users size={14} />
                              </span>
                              {p.persona}
                            </span>
                          </td>
                          <td className="text-center px-3 py-2.5 tabular-nums font-semibold text-gray-700 dark:text-gray-200">{p.completados}</td>
                          <td className="text-center px-3 py-2.5 tabular-nums text-gray-500 dark:text-gray-400">{p.semanas.length}</td>
                          <td className="text-right px-3 py-2.5 font-mono tabular-nums font-bold text-gray-800 dark:text-gray-100">{fmtPago(p.total)}</td>
                          <td className="text-right px-3 py-2.5 font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{p.pagado > 0 ? fmtPago(p.pagado) : '—'}</td>
                          <td className="text-right px-3 py-2.5">
                            {p.pendiente > 0
                              ? <span className="font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">{fmtPago(p.pendiente)}</span>
                              : <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400"><Check size={12} /> Al día</span>}
                          </td>
                          <td className="text-center pr-3">
                            <ChevronDown size={15} className={`inline text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={7} className="px-4 py-3 bg-gray-50/60 dark:bg-gray-900/30">
                              <div className="space-y-2">
                                {p.semanas.map(s => (
                                  <div key={s.weekKey} className="flex items-center gap-3 text-sm flex-wrap">
                                    <span className="font-semibold text-gray-700 dark:text-gray-200 min-w-[150px]">{weekLabel(s.weekKey)}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {s.completados} × $42k{s.bonus > 0 ? ` + objetivo ${fmtPago(s.bonus)}` : ''}
                                    </span>
                                    <span className="ml-auto font-mono tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtPago(s.total)}</span>
                                    {s.paid ? (
                                      <button onClick={() => pagarSemana(s.weekKey, p.persona, false)}
                                        className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 hover:bg-emerald-200 transition" title="Marcar como no pagada">
                                        <Check size={12} /> Pagada
                                      </button>
                                    ) : (
                                      <button onClick={() => pagarSemana(s.weekKey, p.persona, true)}
                                        className="text-xs font-bold px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition">
                                        Marcar pagada
                                      </button>
                                    )}
                                  </div>
                                ))}
                                {p.pendiente > 0 && (
                                  <div className="flex justify-end pt-1">
                                    <button onClick={() => pagarTodoPersona(p)}
                                      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition">
                                      <CheckCircle2 size={14} /> Pagar todo lo pendiente ({fmtPago(p.pendiente)})
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 font-bold">
                    <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-gray-400">Total del mes</td>
                    <td className="text-center px-3 py-2.5 tabular-nums text-gray-700 dark:text-gray-200">{totals.completados}</td>
                    <td />
                    <td className="text-right px-3 py-2.5 font-mono tabular-nums text-gray-900 dark:text-gray-100">{fmtPago(totals.total)}</td>
                    <td className="text-right px-3 py-2.5 font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{fmtPago(totals.pagado)}</td>
                    <td className="text-right px-3 py-2.5 font-mono tabular-nums text-amber-600 dark:text-amber-400">{totals.pendiente > 0 ? fmtPago(totals.pendiente) : '—'}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1">
            $42.000 por producto completo y aprobado + objetivo semanal ($24k/$30k/$36k por 3/4/5 completos). El pago se salda por semana. Marcá una semana como pagada cuando le transferís al agente.
          </p>
        </>
      )}
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
