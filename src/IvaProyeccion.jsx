import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Landmark, Percent, TrendingUp, TrendingDown, Calculator, Target, Sparkles,
  Loader2, Plus, Trash2, ChevronDown, Info, ArrowRight, Receipt,
} from 'lucide-react';
import {
  emptyPeriodo, liquidar, proyectar, ventasParaPosicion,
  facturacionParaRentabilidad, fmtARS, parseARS, IVA_DEFAULTS,
} from './ivaCalc.js';
import {
  loadPeriodos, savePeriodo, deletePeriodo, crearPeriodo, subscribeIva,
} from './ivaStore.js';

// =============================================================================
// PROYECCIÓN DE IVA — módulo fiscal (Argentina · ARCA ex-AFIP)
// -----------------------------------------------------------------------------
// A partir del Libro IVA Ventas y Compras: liquida la posición mensual
// (DF − CF), aplica saldos del período anterior y el beneficio fiscal, y
// permite PROYECTAR cuánto falta facturar para neutralizar el saldo o alcanzar
// un objetivo de rentabilidad. Todo en pesos ARS nativos.
// =============================================================================

const NF0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

// -----------------------------------------------------------------------------
// Campo numérico editable: mantiene texto local, commitea número parseado.
// -----------------------------------------------------------------------------
function NumField({ value, onCommit, className = '', prefix = '$', placeholder = '0' }) {
  const [txt, setTxt] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) {
      const n = Number(value) || 0;
      setTxt(n ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n) : '');
    }
  }, [value, focused]);
  return (
    <div className={`relative flex items-center ${className}`}>
      {prefix && <span className="absolute left-2.5 text-xs text-gray-400 dark:text-gray-500 pointer-events-none">{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={txt}
        placeholder={placeholder}
        onFocus={(e) => { setFocused(true); const n = Number(value) || 0; setTxt(n ? String(n) : ''); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { setFocused(false); onCommit(parseARS(txt)); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className={`w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 py-1.5 pr-2.5 ${prefix ? 'pl-6' : 'pl-2.5'} text-right text-sm tabular-nums text-gray-800 dark:text-gray-100 outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500`}
      />
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{label}</div>
        {hint && <div className="text-[11px] text-gray-400 dark:text-gray-500">{hint}</div>}
      </div>
      <div className="w-44 shrink-0">{children}</div>
    </div>
  );
}

function Card({ title, icon: Icon, tint = 'emerald', children, right }) {
  const tints = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
    indigo: 'text-indigo-600 dark:text-indigo-400',
    amber: 'text-amber-600 dark:text-amber-400',
  };
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/60">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} className={tints[tint]} />}
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// KPI grande.
function Kpi({ label, value, sub, tone = 'neutral', icon: Icon }) {
  const tones = {
    neutral: 'text-gray-900 dark:text-white',
    good: 'text-emerald-600 dark:text-emerald-400',
    bad: 'text-rose-600 dark:text-rose-400',
    warn: 'text-amber-600 dark:text-amber-400',
  };
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {Icon && <Icon size={13} />} {label}
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{sub}</div>}
    </div>
  );
}

// Línea de la cascada de liquidación.
function WaterRow({ label, value, kind = 'plain', hint }) {
  const styles = {
    plain: 'text-gray-700 dark:text-gray-300',
    add: 'text-gray-700 dark:text-gray-300',
    sub: 'text-gray-500 dark:text-gray-400',
    total: 'font-semibold text-gray-900 dark:text-white',
    result: 'font-bold',
  };
  const sign = kind === 'sub' ? '(−) ' : kind === 'add' ? '(+) ' : '';
  return (
    <div className={`flex items-center justify-between py-1.5 text-sm ${kind === 'total' || kind === 'result' ? 'border-t border-gray-200 dark:border-gray-700 mt-1 pt-2' : ''}`}>
      <span className={styles[kind]}>{sign}{label}{hint && <span className="ml-1 text-[11px] text-gray-400">{hint}</span>}</span>
      <span className={`tabular-nums ${styles[kind]}`}>{value}</span>
    </div>
  );
}

export default function IvaProyeccionSection({ addToast }) {
  const [periodos, setPeriodos] = useState(() => loadPeriodos());
  const [selId, setSelId] = useState(() => (loadPeriodos()[0]?.id || ''));
  const [analisis, setAnalisis] = useState(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [objetivoPos, setObjetivoPos] = useState('0'); // objetivo de posición IVA

  useEffect(() => subscribeIva((arr) => setPeriodos(arr.slice())), []);
  useEffect(() => {
    if (!periodos.find((p) => p.id === selId)) setSelId(periodos[0]?.id || '');
  }, [periodos, selId]);

  const periodo = useMemo(
    () => periodos.find((p) => p.id === selId) || periodos[0] || emptyPeriodo(),
    [periodos, selId]
  );

  const liq = useMemo(() => liquidar(periodo), [periodo]);
  const proy = useMemo(
    () => proyectar(periodo, Number(periodo.ventasAdicionalesTotal) || 0),
    [periodo]
  );
  const neutralizar = useMemo(() => ventasParaPosicion(periodo, 0), [periodo]);
  const objetivo = useMemo(
    () => ventasParaPosicion(periodo, parseARS(objetivoPos)),
    [periodo, objetivoPos]
  );
  const rent = useMemo(
    () => facturacionParaRentabilidad(periodo.targetRentabilidad, periodo.margenRentabilidad, periodo.alicuota),
    [periodo]
  );

  const patch = useCallback((changes) => {
    savePeriodo({ ...periodo, ...changes });
  }, [periodo]);

  const setNum = useCallback((field) => (v) => patch({ [field]: v }), [patch]);

  const nuevoPeriodo = () => {
    const d = new Date();
    // Siguiente mes al más reciente cargado, o el mes actual.
    let ym = periodos[0]?.periodo;
    if (ym) {
      const [y, m] = ym.split('-').map(Number);
      const nd = new Date(y, m, 1); // m es 1-based → nd apunta al mes siguiente
      ym = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`;
    } else {
      ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    const nuevo = crearPeriodo(ym);
    setSelId(nuevo.id);
    setAnalisis(null);
    addToast?.({ type: 'success', message: `Período ${ym} creado` });
  };

  const borrarPeriodo = () => {
    if (!periodo?.id) return;
    if (!window.confirm(`¿Borrar el período ${periodo.periodo}? Esta acción no se puede deshacer.`)) return;
    deletePeriodo(periodo.id);
    addToast?.({ type: 'info', message: 'Período borrado' });
  };

  const pedirAnalisis = async () => {
    setLoadingAI(true);
    setAnalisis(null);
    try {
      const res = await fetch('/api/iva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo, liquidacion: liq, proyeccion: proy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Error del servidor');
      setAnalisis(data);
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude generar el análisis: ${err.message}` });
    } finally {
      setLoadingAI(false);
    }
  };

  // Datos del gráfico comparativo DF vs CF (actual vs proyectado).
  const chartData = useMemo(() => ([
    { name: 'Débito Fiscal', Actual: liq.df, Proyectado: proy.proyectado.df },
    { name: 'Crédito Fiscal', Actual: liq.cf, Proyectado: proy.proyectado.cf },
  ]), [liq, proy]);

  const alic = Number(periodo.alicuota) || IVA_DEFAULTS.alicuota;
  const proyPos = proy.proyectado.posicion;

  if (!periodo?.id && periodos.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <Landmark className="mx-auto text-gray-300" size={48} />
        <p className="mt-4 text-gray-500 dark:text-gray-400">No hay períodos cargados.</p>
        <button onClick={nuevoPeriodo} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          <Plus size={16} /> Crear período
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
            <Landmark size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Proyección de IVA</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Libro IVA Ventas / Compras · liquidación y proyección · ARCA</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={selId}
              onChange={(e) => { setSelId(e.target.value); setAnalisis(null); }}
              className="appearance-none rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-3 pr-9 text-sm font-medium text-gray-800 dark:text-gray-100 outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              {periodos.map((p) => (
                <option key={p.id} value={p.id}>{p.periodo || 'Sin período'}</option>
              ))}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
          <button onClick={nuevoPeriodo} title="Nuevo período" className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            <Plus size={15} /> Período
          </button>
          <button onClick={borrarPeriodo} title="Borrar período" className="inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 p-2 text-gray-400 hover:text-rose-500 hover:border-rose-300">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Débito Fiscal" value={fmtARS(liq.df, { decimales: 0 })} sub="IVA de ventas" icon={TrendingUp} />
        <Kpi label="Crédito Fiscal" value={fmtARS(liq.cf, { decimales: 0 })} sub="IVA de compras" icon={TrendingDown} />
        <Kpi
          label="Posición IVA"
          value={fmtARS(liq.posicion, { decimales: 0 })}
          sub={liq.esAPagar ? 'A pagar (DF > CF)' : 'Saldo técnico a favor'}
          tone={liq.esAPagar ? 'bad' : 'good'}
          icon={Calculator}
        />
        <Kpi
          label="Beneficio fiscal"
          value={fmtARS(liq.beneficio, { decimales: 0 })}
          sub={`${Math.round((Number(periodo.beneficioRate) || 0) * 100)}% s/ (DF−CF)`}
          tone={liq.beneficio > 0 ? 'good' : 'neutral'}
          icon={Percent}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ---- Libro IVA Ventas ---- */}
        <Card title="Libro IVA Ventas" icon={TrendingUp} tint="emerald">
          <Row label="Operaciones de ventas — Neto"><NumField value={periodo.ventasOpNeto} onCommit={setNum('ventasOpNeto')} /></Row>
          <Row label="Operaciones de ventas — Débito Fiscal"><NumField value={periodo.ventasOpIva} onCommit={setNum('ventasOpIva')} /></Row>
          <Row label="Notas de crédito — Neto"><NumField value={periodo.ventasNcNeto} onCommit={setNum('ventasNcNeto')} /></Row>
          <Row label="Notas de crédito — Débito Fiscal" hint="Resta del DF"><NumField value={periodo.ventasNcIva} onCommit={setNum('ventasNcIva')} /></Row>
          <Row label="Ajustes al Débito Fiscal" hint="+/−"><NumField value={periodo.ajustesDf} onCommit={setNum('ajustesDf')} /></Row>
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 dark:border-gray-700/60 pt-2 text-sm">
            <span className="font-medium text-gray-600 dark:text-gray-300">Débito Fiscal neto</span>
            <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtARS(liq.df)}</span>
          </div>
        </Card>

        {/* ---- Libro IVA Compras ---- */}
        <Card title="Libro IVA Compras" icon={TrendingDown} tint="rose">
          <Row label="Operaciones de compras — Neto"><NumField value={periodo.comprasOpNeto} onCommit={setNum('comprasOpNeto')} /></Row>
          <Row label="Operaciones de compras — Crédito Fiscal"><NumField value={periodo.comprasOpIva} onCommit={setNum('comprasOpIva')} /></Row>
          <Row label="Notas de crédito — Neto"><NumField value={periodo.comprasNcNeto} onCommit={setNum('comprasNcNeto')} /></Row>
          <Row label="Notas de crédito — Crédito Fiscal" hint="Resta del CF"><NumField value={periodo.comprasNcIva} onCommit={setNum('comprasNcIva')} /></Row>
          <Row label="Ajustes al Crédito Fiscal" hint="+/−"><NumField value={periodo.ajustesCf} onCommit={setNum('ajustesCf')} /></Row>
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 dark:border-gray-700/60 pt-2 text-sm">
            <span className="font-medium text-gray-600 dark:text-gray-300">Crédito Fiscal neto</span>
            <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">{fmtARS(liq.cf)}</span>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ---- Saldos anteriores + parámetros ---- */}
        <Card title="Saldos anteriores y parámetros" icon={Receipt} tint="indigo">
          <Row label="Saldo técnico a favor (período anterior)" hint="Sólo compensa IVA futuro"><NumField value={periodo.saldoTecnicoAnterior} onCommit={setNum('saldoTecnicoAnterior')} /></Row>
          <Row label="Saldo de libre disponibilidad (anterior)" hint="Compensa otros impuestos"><NumField value={periodo.saldoLibreDispAnterior} onCommit={setNum('saldoLibreDispAnterior')} /></Row>
          <div className="my-2 border-t border-gray-100 dark:border-gray-700/60" />
          <Row label="Alícuota de IVA" hint="Ej: 0,21 = 21%"><NumField prefix="" value={periodo.alicuota} onCommit={(v) => patch({ alicuota: v > 1 ? v / 100 : v })} /></Row>
          <Row label="Beneficio fiscal" hint="% s/ (DF−CF) si DF>CF"><NumField prefix="" value={periodo.beneficioRate} onCommit={(v) => patch({ beneficioRate: v > 1 ? v / 100 : v })} /></Row>
        </Card>

        {/* ---- Cascada de liquidación ---- */}
        <Card title="Liquidación del período" icon={Calculator} tint="emerald">
          <WaterRow label="Débito Fiscal" value={fmtARS(liq.df)} />
          <WaterRow label="Crédito Fiscal" value={fmtARS(liq.cf)} kind="sub" />
          <WaterRow label="Posición IVA (DF − CF)" value={fmtARS(liq.posicion)} kind="total" />
          {liq.esAPagar ? (
            <>
              <WaterRow label="Saldo técnico anterior usado" value={fmtARS(liq.usadoTecnico)} kind="sub" />
              <WaterRow label="Libre disponibilidad usada" value={fmtARS(liq.usadoLibreDisp)} kind="sub" />
              <WaterRow label="Beneficio fiscal" value={fmtARS(liq.beneficio)} kind="sub" hint={`(${Math.round((liq.beneficioRate || 0) * 100)}%)`} />
              <WaterRow label="IVA a pagar" value={fmtARS(liq.aPagarNeto)} kind="result" />
            </>
          ) : (
            <>
              <WaterRow label="+ Saldo técnico anterior" value={fmtARS(liq.saldoTecnicoAnterior)} kind="add" />
              <WaterRow label="Saldo técnico a favor acumulado" value={fmtARS(liq.saldoTecnicoGenerado)} kind="result" />
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-2.5 text-[12px] text-emerald-700 dark:text-emerald-300">
                <Info size={14} className="mt-0.5 shrink-0" />
                <span>DF &lt; CF: no se paga IVA. El saldo a favor se arrastra al período siguiente y sólo se usa contra débito fiscal futuro.</span>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ---- Proyección / simulador ---- */}
      <Card
        title="Proyección — ventas por facturar"
        icon={Target}
        tint="amber"
        right={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400">Ventas adicionales (total c/IVA)</span>
            <div className="w-44"><NumField value={periodo.ventasAdicionalesTotal} onCommit={setNum('ventasAdicionalesTotal')} /></div>
          </div>
        }
      >
        <div className="grid md:grid-cols-2 gap-5">
          <div>
            {/* Desglose de las ventas adicionales */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Neto</div>
                <div className="mt-1 text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(proy.ventas.neto, { decimales: 0 })}</div>
              </div>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">IVA ({Math.round(alic * 100)}%)</div>
                <div className="mt-1 text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(proy.ventas.iva, { decimales: 0 })}</div>
              </div>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Total</div>
                <div className="mt-1 text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(proy.ventas.total, { decimales: 0 })}</div>
              </div>
            </div>

            {/* Posición proyectada */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Posición actual</span>
                <span className="tabular-nums font-medium text-gray-700 dark:text-gray-200">{fmtARS(liq.posicion, { decimales: 0 })}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1"><ArrowRight size={13} /> Posición proyectada</span>
                <span className={`tabular-nums font-bold ${proyPos > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{fmtARS(proyPos, { decimales: 0 })}</span>
              </div>
              {proy.faltaParaNeutralizar > 0 ? (
                <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
                  Todavía falta neutralizar <strong className="tabular-nums">{fmtARS(proy.faltaParaNeutralizar, { decimales: 0 })}</strong> de IVA para llegar a posición 0.
                </div>
              ) : (
                <div className="mt-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300">
                  Con estas ventas la posición pasa a ser {proyPos >= 0 ? 'a pagar' : 'neutra/a favor'} · beneficio proyectado <strong className="tabular-nums">{fmtARS(proy.proyectado.beneficio, { decimales: 0 })}</strong>.
                </div>
              )}
            </div>
          </div>

          {/* Gráfico DF vs CF */}
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.2)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tickFormatter={(v) => NF0.format(v / 1e6) + 'M'} tick={{ fontSize: 10, fill: '#94a3b8' }} width={38} />
                <Tooltip
                  formatter={(v, n) => [fmtARS(v, { decimales: 0 }), n]}
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid rgba(148,163,184,.3)' }}
                />
                <Bar dataKey="Actual" radius={[6, 6, 0, 0]} fill="#94a3b8" />
                <Bar dataKey="Proyectado" radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#10b981' : '#f43f5e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      {/* ---- Objetivos inversos ---- */}
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="¿Cuánto facturar para un objetivo?" icon={Calculator} tint="indigo">
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-100 dark:border-gray-700/60 p-3">
              <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">Neutralizar el saldo técnico (posición → 0)</div>
              {neutralizar.yaCumplido ? (
                <p className="text-[12px] text-emerald-600 dark:text-emerald-400">Ya estás en posición a pagar o neutra: no hace falta facturar más para neutralizar.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-[10px] uppercase text-gray-400">Neto</div><div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(neutralizar.neto, { decimales: 0 })}</div></div>
                  <div><div className="text-[10px] uppercase text-gray-400">IVA</div><div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(neutralizar.iva, { decimales: 0 })}</div></div>
                  <div><div className="text-[10px] uppercase text-gray-400">Total</div><div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtARS(neutralizar.total, { decimales: 0 })}</div></div>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-gray-100 dark:border-gray-700/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-gray-600 dark:text-gray-300">Alcanzar una posición objetivo</div>
                <div className="w-32"><NumField value={parseARS(objetivoPos)} onCommit={(v) => setObjetivoPos(String(v))} /></div>
              </div>
              {objetivo.yaCumplido ? (
                <p className="text-[12px] text-gray-500 dark:text-gray-400">La posición actual ya iguala o supera el objetivo.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-[10px] uppercase text-gray-400">Neto</div><div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(objetivo.neto, { decimales: 0 })}</div></div>
                  <div><div className="text-[10px] uppercase text-gray-400">IVA</div><div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(objetivo.iva, { decimales: 0 })}</div></div>
                  <div><div className="text-[10px] uppercase text-gray-400">Total</div><div className="text-sm font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{fmtARS(objetivo.total, { decimales: 0 })}</div></div>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card title="Rentabilidad objetivo" icon={Target} tint="amber">
          <Row label="Objetivo de rentabilidad mensual"><NumField value={periodo.targetRentabilidad} onCommit={setNum('targetRentabilidad')} /></Row>
          <Row label="Margen supuesto" hint="Ej: 0,20 = 20%"><NumField prefix="" value={periodo.margenRentabilidad} onCommit={(v) => patch({ margenRentabilidad: v > 1 ? v / 100 : v })} /></Row>
          <div className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3">
            <div className="text-[12px] text-amber-800 dark:text-amber-300 mb-2">
              Para ganar <strong className="tabular-nums">{fmtARS(periodo.targetRentabilidad, { decimales: 0 })}</strong> con un margen del {Math.round((Number(periodo.margenRentabilidad) || 0) * 100)}%, necesitás facturar (neto):
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-[10px] uppercase text-gray-400">Neto</div><div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(rent.neto, { decimales: 0 })}</div></div>
              <div><div className="text-[10px] uppercase text-gray-400">IVA</div><div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtARS(rent.iva, { decimales: 0 })}</div></div>
              <div><div className="text-[10px] uppercase text-gray-400">Total</div><div className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmtARS(rent.total, { decimales: 0 })}</div></div>
            </div>
          </div>
        </Card>
      </div>

      {/* ---- Análisis IA ---- */}
      <Card
        title="Análisis del contador IA"
        icon={Sparkles}
        tint="indigo"
        right={
          <button
            onClick={pedirAnalisis}
            disabled={loadingAI}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loadingAI ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loadingAI ? 'Analizando…' : 'Generar análisis'}
          </button>
        }
      >
        {!analisis && !loadingAI && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Pedile a Claude un análisis contable del período: diagnóstico de la posición de IVA, uso del beneficio fiscal, saldos a favor y recomendaciones de facturación para llegar al objetivo.
          </p>
        )}
        {loadingAI && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Generando análisis contable…
          </div>
        )}
        {analisis && (
          <div className="space-y-4">
            {analisis.resumen && (
              <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{analisis.resumen}</p>
            )}
            {Array.isArray(analisis.diagnostico) && analisis.diagnostico.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Diagnóstico</div>
                <ul className="space-y-1">
                  {analisis.diagnostico.map((d, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300"><span className="text-indigo-500">•</span>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(analisis.recomendaciones) && analisis.recomendaciones.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Recomendaciones</div>
                <ul className="space-y-1">
                  {analisis.recomendaciones.map((r, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300"><span className="text-emerald-500">→</span>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {analisis.alerta && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300 flex gap-2">
                <Info size={14} className="mt-0.5 shrink-0" /> {analisis.alerta}
              </div>
            )}
          </div>
        )}
      </Card>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 flex items-start gap-1.5 px-1">
        <Info size={13} className="mt-0.5 shrink-0" />
        Herramienta de proyección interna. La liquidación oficial de IVA debe confirmarla el estudio contable. El "beneficio fiscal" se aplica según la regla indicada (30% s/ DF−CF cuando DF&gt;CF) y es configurable por período.
      </p>
    </div>
  );
}
