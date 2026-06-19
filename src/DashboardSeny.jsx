// =============================================================================
// DASHBOARD SENY — lectura en vivo del Google Sheet "Dashboard Senydrop"
// -----------------------------------------------------------------------------
// Lee el CSV del sheet público vía el proxy /api/seny-sheet (que resuelve el
// CORS sin necesitar credenciales — el sheet es público con link). Parsea el
// formato de números argentino ($ 1.234.567,89 / 82,22%) y arma KPIs, una
// serie diaria, ranking de clientes y una tabla filtrable de órdenes.
//
// El "sync en vivo" es un refetch automático cada REFRESH_MS + al volver el
// foco a la pestaña, más un botón de refresh manual.
//
// Para apuntar a otra pestaña del sheet: agregá su gid a TABS (lo sacás de la
// URL del sheet: ...#gid=<numero>). El proxy ya acepta cualquier gid numérico.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import {
  RefreshCw, TrendingUp, TrendingDown, ShoppingCart, Package, DollarSign,
  Percent, AlertTriangle, Search, Users, Loader2,
} from 'lucide-react';

// Pestañas conocidas del sheet. La primera es la default. Agregá más sumando
// { gid, label } — el gid sale de la URL del sheet (#gid=<numero>).
const TABS = [
  { gid: '718012315', label: 'Órdenes (Marzo)' },
];

const REFRESH_MS = 60_000; // refetch automático cada 60s
const SENY = '#FFD33D';    // amarillo marca Senydrop

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Parser CSV con soporte de comillas (campos con comas / saltos de línea).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c === '\r') {
      // ignorar — el \n que sigue cierra la fila
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Número en formato AR: "$1.234.567,89" → 1234567.89 ; "82,22%" → 82.22 ;
// "-$4.565" → -4565. Devuelve NaN si no es numérico.
function parseAR(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s || s === '-') return NaN;
  s = s.replace(/[$\s%]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

// Fecha "05/03" o "1/5/2026" → { label, sortKey }. Sin año asume el corriente.
function parseFecha(v) {
  const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  let y = m[3] ? +m[3] : new Date().getFullYear();
  if (y < 100) y += 2000;
  return { label: `${d}/${mo}`, sortKey: y * 10000 + mo * 100 + d };
}

const norm = (s) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

// Mapea los headers del sheet a campos lógicos por nombre (tolerante a tildes).
function mapColumns(headers) {
  const idx = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    if (idx.cliente == null && n.includes('cliente')) idx.cliente = i;
    else if (idx.monto == null && n === 'monto') idx.monto = i;
    else if (idx.cant == null && n.includes('cant') && n.includes('venta')) idx.cant = i;
    else if (idx.fecha == null && n === 'fecha') idx.fecha = i;
    else if (idx.margen == null && n.includes('margen')) idx.margen = i;
    else if (n === 'ganancia total') idx.ganancia = i; // última gana (la real)
    else if (idx.estado == null && n.includes('estado real')) idx.estado = i;
  });
  // Fallback de estado si no hay "estado real".
  if (idx.estado == null) {
    const i = headers.findIndex((h) => norm(h) === 'estado');
    if (i >= 0) idx.estado = i;
  }
  return idx;
}

// Convierte el CSV crudo en filas de órdenes normalizadas + detecta esquema.
function buildModel(rows) {
  if (!rows.length) return { ok: false, headers: [], orders: [], rawRows: [] };
  // Header = primera fila con contenido.
  let headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim()));
  if (headerIdx < 0) headerIdx = 0;
  const headers = rows[headerIdx];
  const body = rows.slice(headerIdx + 1);
  const col = mapColumns(headers);

  const isTransactions = col.cliente != null && col.monto != null;
  if (!isTransactions) {
    return { ok: true, isTransactions: false, headers, orders: [], rawRows: body };
  }

  const orders = [];
  for (const r of body) {
    const cliente = String(r[col.cliente] ?? '').trim();
    const monto = parseAR(r[col.monto]);
    if (!cliente || /^(suma|total)/i.test(cliente)) continue; // saltar totales
    if (!Number.isFinite(monto)) continue;
    const ganancia = col.ganancia != null ? parseAR(r[col.ganancia]) : NaN;
    const fecha = col.fecha != null ? parseFecha(r[col.fecha]) : null;
    orders.push({
      cliente,
      monto,
      cant: col.cant != null ? (parseAR(r[col.cant]) || 0) : 0,
      ganancia: Number.isFinite(ganancia) ? ganancia : 0,
      margen: col.margen != null ? parseAR(r[col.margen]) : NaN,
      estado: col.estado != null ? String(r[col.estado] ?? '').trim() : '',
      fechaLabel: fecha?.label || '',
      fechaSort: fecha?.sortKey || 0,
    });
  }
  return { ok: true, isTransactions: true, headers, orders, rawRows: body };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
const fmtMoney = (n) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n || 0)).toLocaleString('es-AR');
const fmtMoneyShort = (n) => {
  const a = Math.abs(n || 0);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}k`;
  return `${sign}$${Math.round(a)}`;
};
const fmtPct = (n) => (Number.isFinite(n) ? n.toFixed(1).replace('.', ',') + '%' : '—');
const fmtInt = (n) => Math.round(n || 0).toLocaleString('es-AR');

// ---------------------------------------------------------------------------
// UI atoms
// ---------------------------------------------------------------------------
function KpiCard({ icon: Icon, label, value, sub, tone = 'default' }) {
  const toneRing = {
    default: 'text-gray-900 dark:text-white',
    good: 'text-emerald-600 dark:text-emerald-400',
    bad: 'text-red-600 dark:text-red-400',
  }[tone];
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <Icon className="w-4 h-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${toneRing}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children, right }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function TooltipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 shadow-lg text-xs">
      <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 tabular-nums">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-gray-500 dark:text-gray-400">{p.name}:</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">{fmtMoney(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function DashboardSeny({ addToast }) {
  const [tabGid, setTabGid] = useState(TABS[0].gid);
  const [model, setModel] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filtros de la tabla.
  const [query, setQuery] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');

  const reqId = useRef(0);

  const load = useCallback(async (gid, { silent = false } = {}) => {
    const id = ++reqId.current;
    if (silent) setRefreshing(true);
    else setStatus('loading');
    try {
      const res = await fetch(`/api/seny-sheet?gid=${encodeURIComponent(gid)}`, { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Error ${res.status}`);
      }
      const text = await res.text();
      const built = buildModel(parseCSV(text));
      if (id !== reqId.current) return; // llegó una respuesta vieja
      setModel(built);
      setStatus('ok');
      setError('');
      setUpdatedAt(new Date());
    } catch (err) {
      if (id !== reqId.current) return;
      setStatus('error');
      setError(err?.message || 'No pude leer el sheet.');
      if (silent && typeof addToast === 'function') {
        addToast({ message: 'No pude actualizar el dashboard.', type: 'error' });
      }
    } finally {
      if (id === reqId.current) setRefreshing(false);
    }
  }, [addToast]);

  // Carga inicial + cuando cambia de pestaña.
  useEffect(() => { load(tabGid); }, [tabGid, load]);

  // Auto-refresh periódico + al volver el foco.
  useEffect(() => {
    const t = setInterval(() => load(tabGid, { silent: true }), REFRESH_MS);
    const onFocus = () => load(tabGid, { silent: true });
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [tabGid, load]);

  const orders = model?.orders || [];

  // ----- Agregados / KPIs -----
  const kpis = useMemo(() => {
    let ventas = 0, ganancia = 0, unidades = 0, perdidas = 0;
    for (const o of orders) {
      ventas += o.monto;
      ganancia += o.ganancia;
      unidades += o.cant;
      if (o.ganancia < 0) perdidas++;
    }
    const margen = ventas > 0 ? (ganancia / ventas) * 100 : NaN;
    return { ventas, ganancia, unidades, perdidas, ordenes: orders.length, margen };
  }, [orders]);

  // ----- Serie diaria -----
  const serie = useMemo(() => {
    const byDay = new Map();
    for (const o of orders) {
      if (!o.fechaSort) continue;
      const k = o.fechaSort;
      const cur = byDay.get(k) || { sort: k, fecha: o.fechaLabel, ventas: 0, ganancia: 0 };
      cur.ventas += o.monto;
      cur.ganancia += o.ganancia;
      byDay.set(k, cur);
    }
    return [...byDay.values()].sort((a, b) => a.sort - b.sort);
  }, [orders]);

  // ----- Top clientes por ganancia -----
  const topClientes = useMemo(() => {
    const by = new Map();
    for (const o of orders) {
      const cur = by.get(o.cliente) || { cliente: o.cliente, ganancia: 0, ventas: 0, ordenes: 0 };
      cur.ganancia += o.ganancia;
      cur.ventas += o.monto;
      cur.ordenes++;
      by.set(o.cliente, cur);
    }
    return [...by.values()].sort((a, b) => b.ganancia - a.ganancia).slice(0, 8);
  }, [orders]);

  const estados = useMemo(() => {
    const set = new Set();
    orders.forEach((o) => o.estado && set.add(o.estado));
    return [...set];
  }, [orders]);

  // ----- Tabla filtrada -----
  const tablaRows = useMemo(() => {
    const q = norm(query);
    return orders
      .filter((o) => (!q || norm(o.cliente).includes(q)) && (!estadoFilter || o.estado === estadoFilter))
      .sort((a, b) => b.fechaSort - a.fechaSort);
  }, [orders, query, estadoFilter]);

  // ---------------------------------------------------------------------------
  if (status === 'loading' && !model) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm">Leyendo el sheet de Senydrop…</p>
      </div>
    );
  }

  if (status === 'error' && !model) {
    return (
      <div className="max-w-md mx-auto mt-20 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <p className="font-semibold text-red-700 dark:text-red-300">No pude leer el sheet</p>
        <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error}</p>
        <button
          onClick={() => load(tabGid)}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 text-white text-sm font-semibold px-4 py-2 hover:bg-red-700"
        >
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      </div>
    );
  }

  const noTransactions = model && model.isTransactions === false;

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-gray-900 shadow" style={{ background: SENY }}>
            DS
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">Dashboard Seny</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              En vivo desde Google Sheets
              {updatedAt && ` · actualizado ${updatedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {TABS.length > 1 && (
            <select
              value={tabGid}
              onChange={(e) => setTabGid(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-700 dark:text-gray-200"
            >
              {TABS.map((t) => <option key={t.gid} value={t.gid}>{t.label}</option>)}
            </select>
          )}
          <button
            onClick={() => load(tabGid, { silent: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold px-3 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {noTransactions ? (
        <GenericTable headers={model.headers} rows={model.rawRows} />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
            <KpiCard icon={DollarSign} label="Ventas" value={fmtMoney(kpis.ventas)} sub={`${fmtInt(kpis.ordenes)} órdenes`} />
            <KpiCard
              icon={kpis.ganancia >= 0 ? TrendingUp : TrendingDown}
              label="Ganancia total" value={fmtMoney(kpis.ganancia)}
              tone={kpis.ganancia >= 0 ? 'good' : 'bad'}
            />
            <KpiCard icon={Percent} label="Margen prom." value={fmtPct(kpis.margen)} tone={kpis.margen >= 0 ? 'good' : 'bad'} />
            <KpiCard icon={ShoppingCart} label="Órdenes" value={fmtInt(kpis.ordenes)} />
            <KpiCard icon={Package} label="Unidades" value={fmtInt(kpis.unidades)} />
            <KpiCard
              icon={AlertTriangle} label="Con pérdida" value={fmtInt(kpis.perdidas)}
              sub={kpis.ordenes ? fmtPct((kpis.perdidas / kpis.ordenes) * 100) + ' del total' : ''}
              tone={kpis.perdidas > 0 ? 'bad' : 'good'}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
            <div className="xl:col-span-2">
              <ChartCard title="Ventas y ganancia por día">
                {serie.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#88888822" />
                      <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                      <YAxis tickFormatter={fmtMoneyShort} tick={{ fontSize: 11, fill: '#9ca3af' }} width={48} />
                      <Tooltip content={<TooltipBox />} />
                      <Bar dataKey="ventas" name="Ventas" fill={SENY} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      <Line dataKey="ganancia" name="Ganancia" stroke="#10b981" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <EmptyMini text="Sin fechas para graficar" />}
              </ChartCard>
            </div>

            <ChartCard title="Top clientes por ganancia">
              {topClientes.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topClientes} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#88888822" horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtMoneyShort} tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis type="category" dataKey="cliente" width={96} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip content={<TooltipBox />} />
                    <Bar dataKey="ganancia" name="Ganancia" radius={[0, 4, 4, 0]} maxBarSize={20}>
                      {topClientes.map((c, i) => (
                        <Cell key={i} fill={c.ganancia >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyMini text="Sin datos de clientes" />}
            </ChartCard>
          </div>

          {/* Tabla de órdenes */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-gray-800 dark:text-gray-100 font-bold text-sm mr-auto">
                <Users className="w-4 h-4" /> Órdenes <span className="text-gray-400 font-normal">({tablaRows.length})</span>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar cliente…"
                  className="pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-200 w-44"
                />
              </div>
              {estados.length > 0 && (
                <select
                  value={estadoFilter}
                  onChange={(e) => setEstadoFilter(e.target.value)}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-2 py-1.5 text-gray-700 dark:text-gray-200 max-w-[180px]"
                >
                  <option value="">Todos los estados</option>
                  {estados.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              )}
            </div>
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
                  <tr className="text-left">
                    <th className="py-2 px-3 font-semibold">Fecha</th>
                    <th className="py-2 px-3 font-semibold">Cliente</th>
                    <th className="py-2 px-3 font-semibold text-right">Cant.</th>
                    <th className="py-2 px-3 font-semibold text-right">Monto</th>
                    <th className="py-2 px-3 font-semibold text-right">Ganancia</th>
                    <th className="py-2 px-3 font-semibold text-right">Margen</th>
                    <th className="py-2 px-3 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {tablaRows.map((o, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="py-2 px-3 text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">{o.fechaLabel || '—'}</td>
                      <td className="py-2 px-3 text-gray-800 dark:text-gray-100 font-medium">{o.cliente}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{o.cant || '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtMoney(o.monto)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-semibold ${o.ganancia >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {fmtMoney(o.ganancia)}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums text-xs ${o.margen >= 0 ? 'text-gray-500 dark:text-gray-400' : 'text-red-500'}`}>
                        {fmtPct(o.margen)}
                      </td>
                      <td className="py-2 px-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{o.estado || '—'}</td>
                    </tr>
                  ))}
                  {!tablaRows.length && (
                    <tr><td colSpan={7} className="py-10 text-center text-gray-400">Sin órdenes que coincidan.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyMini({ text }) {
  return <div className="h-[300px] flex items-center justify-center text-sm text-gray-400">{text}</div>;
}

// Fallback: si la pestaña no tiene el esquema de transacciones, mostramos la
// grilla cruda para que igual se vea el contenido del sheet.
function GenericTable({ headers, rows }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="p-3 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
        Vista de tabla — esta pestaña no tiene el esquema de órdenes (Cliente + Monto).
      </div>
      <div className="overflow-auto max-h-[600px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
            <tr className="text-left">
              {headers.map((h, i) => <th key={i} className="py-2 px-3 font-semibold whitespace-nowrap">{h || '—'}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => r.some((c) => String(c).trim())).map((r, ri) => (
              <tr key={ri} className="border-t border-gray-100 dark:border-gray-700/60">
                {headers.map((_, ci) => (
                  <td key={ci} className="py-2 px-3 text-gray-700 dark:text-gray-200 whitespace-nowrap tabular-nums">{r[ci] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
