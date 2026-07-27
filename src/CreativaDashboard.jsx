// Área creativa — Dashboard del mes.
// Resumen de lo que hay que pagarle al equipo creativo: total del mes, ya
// pagado, pendiente, y el detalle por persona (semana por semana) con un botón
// para marcar cada semana como pagada. Los montos respetan el switch ARS/USD.
//
// El "operativo" (asignar, repartir, subir) vive en Producción; esto es la
// vista de plata/resumen.

import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, ChevronDown, Check, Clock, CheckCircle2, Users, Film, TrendingUp } from 'lucide-react';
import {
  monthKeyOf, monthLabel, allMonthKeys, monthlySummary, setWeekPaid,
  weekLabel, subscribeProduccion,
} from './produccionStore.js';
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

          {/* Detalle por persona */}
          <div className="space-y-2.5">
            {personas.map(p => {
              const open = expanded === p.persona;
              return (
                <div key={p.persona} className={`bg-white dark:bg-gray-800 border rounded-xl overflow-hidden ${p.pendiente > 0 ? 'border-amber-200 dark:border-amber-900/40' : 'border-emerald-200 dark:border-emerald-900/40'}`}>
                  <button onClick={() => setExpanded(open ? null : p.persona)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition text-left">
                    <div className="w-8 h-8 rounded-lg bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center text-brand-600 dark:text-brand-300 flex-shrink-0">
                      <Users size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-gray-900 dark:text-gray-100">{p.persona}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">{p.completados} completos · {p.semanas.length} sem.</div>
                    </div>
                    <div className="ml-auto flex items-center gap-3">
                      {p.pendiente > 0 ? (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{fmtPago(p.pendiente)} pendiente</span>
                      ) : (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 inline-flex items-center gap-1"><Check size={12} /> Al día</span>
                      )}
                      <span className="text-sm font-mono font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtPago(p.total)}</span>
                      <ChevronDown size={15} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-2 bg-gray-50/50 dark:bg-gray-800/30">
                      {p.semanas.map(s => (
                        <div key={s.weekKey} className="flex items-center gap-3 text-sm flex-wrap">
                          <span className="font-semibold text-gray-700 dark:text-gray-200 min-w-[110px]">{weekLabel(s.weekKey)}</span>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            {s.completados} × $42k{s.bonus > 0 ? ` + objetivo ${fmtPago(s.bonus)}` : ''}
                          </span>
                          <span className="ml-auto font-mono tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtPago(s.total)}</span>
                          {s.paid ? (
                            <button onClick={() => pagarSemana(s.weekKey, p.persona, false)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 hover:bg-emerald-200 transition" title="Marcar como no pagada">
                              <Check size={12} /> Pagada
                            </button>
                          ) : (
                            <button onClick={() => pagarSemana(s.weekKey, p.persona, true)}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition">
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
                  )}
                </div>
              );
            })}
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
