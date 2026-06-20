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
  ResponsiveContainer, BarChart, Bar, Area, AreaChart,
  PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import {
  RefreshCw, TrendingUp, TrendingDown, ShoppingCart, Package, DollarSign,
  Percent, AlertTriangle, Search, Users, Loader2, Landmark, Calendar, Settings,
} from 'lucide-react';

// Pestaña por defecto (Resumen maestro) si todavía no se descubrieron las del
// sheet vía /api/seny-sheet?list=1.
const DEFAULT_GID = '718012315';
const FALLBACK_TABS = [{ gid: DEFAULT_GID, name: 'Resumen' }];
const TAB_KEY = 'seny-dash-tab-v1';

const REFRESH_MS = 60_000; // refetch automático cada 60s
const SENY = '#FFD33D';    // amarillo marca Senydrop

// Config de impuestos y costos fijos (no viven en la pestaña de órdenes, los
// carga el usuario). Se persiste en localStorage. Las tasas son % sobre la
// facturación; sueldos/gastos son importes fijos del período.
const FIN_KEY = 'seny-dash-fin-v1';
const FIN_DEFAULTS = { iibbPct: 3, ivaPct: 0, sueldos: 0, gastos: 0 };

// Variables seleccionables del gráfico de evolución diaria.
const SERIE_OPTS = [
  { value: 'profit', label: 'Profit' },
  { value: 'ventas', label: 'Facturación' },
  { value: 'ordenes', label: 'Órdenes' },
];

// Presets de período. Anclados a la última fecha con datos (ver applyPreset).
const PRESETS = [
  { value: 'todo', label: 'Todo' },
  { value: '7', label: '7 días' },
  { value: '30', label: '30 días' },
  { value: 'mes', label: 'Este mes' },
  { value: 'mesant', label: 'Mes anterior' },
];

// Número para los inputs de config (type="number" → string con punto decimal).
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

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

// sortKey (yyyymmdd) <-> ISO 'yyyy-mm-dd', para los date pickers del rango.
const sortKeyToISO = (k) => {
  const s = String(k).padStart(8, '0');
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};
const isoToSortKey = (iso) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : 0;
};
const sortKeyToDate = (k) => {
  const s = String(k).padStart(8, '0');
  return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
};
const dateToISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((sortKeyToDate(b) - sortKeyToDate(a)) / 86400000) + 1;

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
    else if (idx.limpio == null && n === 'limpio') idx.limpio = i;
    else if (idx.costoStock == null && n.includes('costo') && n.includes('stock')) idx.costoStock = i;
    else if (idx.costoEnvio == null && n.includes('costo') && n.includes('envio')) idx.costoEnvio = i;
    else if (idx.ganProducto == null && n.includes('ganancia') && n.includes('producto')) idx.ganProducto = i;
    else if (idx.ganEnvio == null && n.includes('ganancia') && n.includes('envio')) idx.ganEnvio = i;
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

// Mapea headers de una pestaña de RESUMEN diario (Pedidos / Ganancias por día).
function mapResumen(headers) {
  const idx = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    if (idx.fecha == null && n === 'fecha') idx.fecha = i;
    else if (idx.pedidos == null && n.includes('pedidos')) idx.pedidos = i;
    else if (idx.facturacion == null && (n.includes('facturacion') || n === 'sum de total')) idx.facturacion = i;
    else if (idx.ganFF == null && n.includes('ganancia') && (n.includes('ff') || n.includes('fullfilment') || n.includes('producto'))) idx.ganFF = i;
    else if (idx.ganEnvio == null && n.includes('ganancia') && n.includes('envio')) idx.ganEnvio = i;
    else if (idx.senyships == null && n.includes('senyship')) idx.senyships = i;
    else if (n.includes('ganancia') && n.includes('total')) idx.profit = i; // última gana = total general
  });
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
    // ¿Es una pestaña de RESUMEN diario? (Fecha + Pedidos/Ganancias por día)
    const rc = mapResumen(headers);
    const isResumen = rc.fecha != null && (rc.pedidos != null || rc.profit != null || rc.ganFF != null);
    if (isResumen) {
      const dias = [];
      for (const r of body) {
        const fecha = parseFecha(r[rc.fecha]);
        if (!fecha) continue; // saltar filas sin fecha (incluye "Suma total")
        const n = (k) => (rc[k] != null ? (parseAR(r[rc[k]]) || 0) : 0);
        const ganFF = n('ganFF'), ganEnvio = n('ganEnvio'), senyships = n('senyships');
        const profit = rc.profit != null ? n('profit') : (ganFF + ganEnvio + senyships);
        dias.push({
          fechaLabel: fecha.label, fechaSort: fecha.sortKey,
          pedidos: n('pedidos'),
          facturacion: n('facturacion'),
          ganFF, ganEnvio, senyships, profit,
          hasFact: rc.facturacion != null,
        });
      }
      return { ok: true, kind: 'resumen', headers, dias, has: rc, rawRows: body };
    }
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
    const num = (k) => (col[k] != null ? (parseAR(r[col[k]]) || 0) : 0);
    orders.push({
      cliente,
      monto,
      cant: num('cant'),
      ganancia: Number.isFinite(ganancia) ? ganancia : 0,
      margen: col.margen != null ? parseAR(r[col.margen]) : NaN,
      limpio: num('limpio'),
      costoStock: num('costoStock'),
      costoEnvio: num('costoEnvio'),
      ganProducto: num('ganProducto'), // "Seny Full" (margen del producto)
      ganEnvio: num('ganEnvio'),        // "Senyship" (margen del envío)
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

// % de variación cur vs prev. null si no hay base comparable.
const pctChange = (cur, prev) => (prev == null || !Number.isFinite(prev) || prev === 0)
  ? null : ((cur - prev) / Math.abs(prev)) * 100;

// ---------------------------------------------------------------------------
// UI atoms
// ---------------------------------------------------------------------------
function KpiCard({ icon: Icon, label, value, sub, tone = 'default', delta = null }) {
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
      {delta != null && (
        <div className={`mt-0.5 text-xs font-semibold flex items-center gap-1 ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(delta))}
          <span className="font-normal text-gray-400">vs período anterior</span>
        </div>
      )}
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

// Tarjeta de una línea de negocio con su % del total.
function LineaCard({ label, hint, value, total, color }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40 p-3">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${value >= 0 ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
        {fmtMoney(value)}
      </div>
      <div className="text-[11px] text-gray-400">{hint} · {fmtPct(pct)} del total</div>
      <div className="mt-2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
    </div>
  );
}

// Input numérico para la config financiera, con el monto calculado al lado.
function FinInput({ label, value, onChange, prefix, suffix, calc }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 focus-within:border-gray-400">
        {prefix && <span className="text-gray-400 text-sm">{prefix}</span>}
        <input
          type="number" inputMode="decimal" min="0" step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent py-1.5 px-1 text-sm text-gray-800 dark:text-gray-100 outline-none tabular-nums"
        />
        {suffix && <span className="text-gray-400 text-sm">{suffix}</span>}
      </div>
      {calc != null && <div className="mt-1 text-[11px] text-gray-400 tabular-nums">= {calc}</div>}
    </div>
  );
}

// Fila clave/valor para el resumen de egresos.
function RowKV({ k, v, strong, muted, tone }) {
  const toneCls = tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'bad' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-white';
  return (
    <div className="flex items-center justify-between">
      <span className={`${muted ? 'text-gray-500 dark:text-gray-400' : 'text-gray-600 dark:text-gray-300'} ${strong ? 'font-semibold' : ''}`}>{k}</span>
      <span className={`tabular-nums ${strong ? 'font-bold text-base ' + toneCls : 'text-gray-700 dark:text-gray-200'}`}>{v}</span>
    </div>
  );
}

// Encabezado de sección con el tick amarillo (estilo "Resumen ejecutivo").
function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2 mb-2.5 mt-1">
      <span className="w-1 h-4 rounded-full" style={{ background: SENY }} />
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{children}</h2>
    </div>
  );
}

// Control segmentado (pills) para elegir una opción.
function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            value === o.value
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Tarjeta con donut + leyenda lateral. `unit` = 'money' | 'count'.
function DonutCard({ title, data, unit = 'money' }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const fmtVal = unit === 'money' ? fmtMoney : fmtInt;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">{title}</h3>
      {data.length ? (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={140} height={140}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={2} strokeWidth={0}>
                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip content={<DonutTip total={total} fmtVal={fmtVal} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 min-w-0 space-y-1.5">
            {data.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
                <span className="text-gray-600 dark:text-gray-300 truncate flex-1">{d.name}</span>
                <span className="tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtVal(d.value)}</span>
                <span className="tabular-nums text-gray-400 w-10 text-right">{total ? fmtPct((d.value / total) * 100) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : <EmptyMini text="Sin datos" />}
    </div>
  );
}

function DonutTip({ active, payload, total, fmtVal }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 shadow-lg text-xs">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: p.payload.color }} />
        <span className="font-semibold text-gray-700 dark:text-gray-200">{p.name}</span>
      </div>
      <div className="tabular-nums text-gray-600 dark:text-gray-300 mt-0.5">
        {fmtVal(p.value)} · {total ? fmtPct((p.value / total) * 100) : '—'}
      </div>
    </div>
  );
}

function TooltipBox({ active, payload, label, unit = 'money' }) {
  if (!active || !payload?.length) return null;
  const fmt = unit === 'count' ? fmtInt : fmtMoney;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 shadow-lg text-xs">
      <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 tabular-nums">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-gray-500 dark:text-gray-400">{p.name}:</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista RESUMEN — para pestañas de agregados diarios (Pedidos + Ganancias).
// No tiene detalle por orden ni facturación/costos completos, así que muestra
// otros KPIs: pedidos, profit y el split Seny Full / Envío / Senyships.
// ---------------------------------------------------------------------------
function ResumenView({ dias, has }) {
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [preset, setPreset] = useState('todo');

  const dataRange = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const d of dias) {
      if (!d.fechaSort) continue;
      if (d.fechaSort < min) min = d.fechaSort;
      if (d.fechaSort > max) max = d.fechaSort;
    }
    if (min === Infinity) return null;
    return { minISO: sortKeyToISO(min), maxISO: sortKeyToISO(max) };
  }, [dias]);
  useEffect(() => { if (dataRange) { setRangeFrom(dataRange.minISO); setRangeTo(dataRange.maxISO); } }, [dataRange]);

  const applyPreset = (kind) => {
    if (!dataRange) return;
    const maxD = sortKeyToDate(isoToSortKey(dataRange.maxISO));
    let from = dataRange.minISO, to = dataRange.maxISO;
    if (kind === '7') from = dateToISO(addDays(maxD, -6));
    else if (kind === '30') from = dateToISO(addDays(maxD, -29));
    else if (kind === 'mes') from = dateToISO(new Date(maxD.getFullYear(), maxD.getMonth(), 1));
    else if (kind === 'mesant') {
      from = dateToISO(new Date(maxD.getFullYear(), maxD.getMonth() - 1, 1));
      to = dateToISO(new Date(maxD.getFullYear(), maxD.getMonth(), 0));
    }
    if (isoToSortKey(from) < isoToSortKey(dataRange.minISO)) from = dataRange.minISO;
    setRangeFrom(from); setRangeTo(to); setPreset(kind);
  };
  const onRangeEdit = (which, val) => { setPreset('custom'); which === 'from' ? setRangeFrom(val) : setRangeTo(val); };

  const view = useMemo(() => {
    const f = isoToSortKey(rangeFrom), t = isoToSortKey(rangeTo);
    return dias.filter((d) => {
      if (!d.fechaSort) return true;
      if (f && d.fechaSort < f) return false;
      if (t && d.fechaSort > t) return false;
      return true;
    });
  }, [dias, rangeFrom, rangeTo]);

  const k = useMemo(() => {
    let pedidos = 0, profit = 0, ff = 0, envio = 0, seny = 0, fact = 0;
    const days = new Set();
    for (const d of view) {
      pedidos += d.pedidos; profit += d.profit; ff += d.ganFF; envio += d.ganEnvio; seny += d.senyships; fact += d.facturacion;
      if (d.fechaSort) days.add(d.fechaSort);
    }
    const nd = days.size || 1;
    return { pedidos, profit, ff, envio, seny, fact, nDias: nd, pedidosDia: pedidos / nd, profitDia: profit / nd };
  }, [view]);

  const prev = useMemo(() => {
    const from = isoToSortKey(rangeFrom), to = isoToSortKey(rangeTo);
    if (!from || !to) return null;
    const len = daysBetween(from, to);
    const prevToDate = addDays(sortKeyToDate(from), -1);
    const pf = isoToSortKey(dateToISO(addDays(prevToDate, -(len - 1)))), pt = isoToSortKey(dateToISO(prevToDate));
    let pedidos = 0, profit = 0;
    for (const d of dias) {
      if (!d.fechaSort || d.fechaSort < pf || d.fechaSort > pt) continue;
      pedidos += d.pedidos; profit += d.profit;
    }
    return { pedidos, profit };
  }, [dias, rangeFrom, rangeTo]);

  const donut = useMemo(() => [
    { name: 'Seny Full', value: Math.max(0, k.ff), color: SENY },
    { name: 'Envío', value: Math.max(0, k.envio), color: '#3b82f6' },
    { name: 'Senyships', value: Math.max(0, k.seny), color: '#10b981' },
  ].filter((s) => s.value > 0), [k]);

  const serie = useMemo(() => [...view].sort((a, b) => a.fechaSort - b.fechaSort)
    .map((d) => ({ fecha: d.fechaLabel, profit: d.profit, pedidos: d.pedidos, facturacion: d.facturacion })), [view]);

  const serieOpts = [
    { value: 'profit', label: 'Profit' },
    { value: 'pedidos', label: 'Pedidos' },
    ...(has.facturacion != null ? [{ value: 'facturacion', label: 'Facturación' }] : []),
  ];
  const [sv, setSv] = useState('profit');

  return (
    <>
      {/* Filtros de período */}
      <div className="mb-5 p-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 p-0.5">
          {PRESETS.map((p) => (
            <button key={p.value} onClick={() => applyPreset(p.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${preset === p.value ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input type="date" value={rangeFrom} max={rangeTo || undefined} onChange={(e) => onRangeEdit('from', e.target.value)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-2 py-1.5 text-gray-700 dark:text-gray-200" />
          <span className="text-gray-400 text-sm">→</span>
          <input type="date" value={rangeTo} min={rangeFrom || undefined} onChange={(e) => onRangeEdit('to', e.target.value)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-2 py-1.5 text-gray-700 dark:text-gray-200" />
        </div>
        <div className="ml-auto text-xs text-gray-400">
          Mostrando: <span className="font-semibold text-gray-600 dark:text-gray-300">{PRESETS.find((p) => p.value === preset)?.label || 'Personalizado'}</span>
        </div>
      </div>

      <SectionLabel>Pulso del negocio</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard icon={ShoppingCart} label="Pedidos" value={fmtInt(k.pedidos)} sub={`${k.nDias} días`} delta={pctChange(k.pedidos, prev?.pedidos)} />
        <KpiCard icon={k.profit >= 0 ? TrendingUp : TrendingDown} label="Profit total" value={fmtMoney(k.profit)} tone={k.profit >= 0 ? 'good' : 'bad'} delta={pctChange(k.profit, prev?.profit)} />
        <KpiCard icon={Package} label="Pedidos/día" value={fmtInt(k.pedidosDia)} />
        <KpiCard icon={Calendar} label="Profit/día" value={fmtMoney(k.profitDia)} tone={k.profitDia >= 0 ? 'good' : 'bad'} />
      </div>

      <SectionLabel>Por línea de negocio</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard icon={DollarSign} label="Seny Full (FF)" value={fmtMoney(k.ff)} tone={k.ff >= 0 ? 'good' : 'bad'} />
        <KpiCard icon={DollarSign} label="Ganancia envío" value={fmtMoney(k.envio)} tone={k.envio >= 0 ? 'good' : 'bad'} />
        <KpiCard icon={DollarSign} label="Senyships" value={fmtMoney(k.seny)} tone={k.seny >= 0 ? 'good' : 'bad'} />
        {has.facturacion != null
          ? <KpiCard icon={DollarSign} label="Facturación" value={fmtMoney(k.fact)} />
          : <KpiCard icon={Percent} label="Margen s/profit" value={fmtPct(k.profit && k.pedidos ? (k.profit / k.pedidos) : NaN)} sub="profit por pedido" />}
      </div>

      <SectionLabel>Análisis visual</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <DonutCard title="Composición del profit" data={donut} unit="money" />
        <div className="lg:col-span-2">
          <ChartCard title={`Evolución diaria · ${serieOpts.find((s) => s.value === sv)?.label}`} right={<Segmented value={sv} onChange={setSv} options={serieOpts} />}>
            {serie.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="senyFillR" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SENY} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={SENY} stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888822" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <YAxis tickFormatter={sv === 'pedidos' ? fmtInt : fmtMoneyShort} tick={{ fontSize: 11, fill: '#9ca3af' }} width={48} />
                  <Tooltip content={<TooltipBox unit={sv === 'pedidos' ? 'count' : 'money'} />} />
                  <Area type="monotone" dataKey={sv} name={serieOpts.find((s) => s.value === sv)?.label} stroke={SENY} strokeWidth={2.5} fill="url(#senyFillR)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyMini text="Sin fechas para graficar" />}
          </ChartCard>
        </div>
      </div>

      <SectionLabel>Detalle diario</SectionLabel>
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
              <tr className="text-left">
                <th className="py-2 px-3 font-semibold">Fecha</th>
                <th className="py-2 px-3 font-semibold text-right">Pedidos</th>
                {has.facturacion != null && <th className="py-2 px-3 font-semibold text-right">Facturación</th>}
                <th className="py-2 px-3 font-semibold text-right">Seny Full</th>
                <th className="py-2 px-3 font-semibold text-right">Envío</th>
                <th className="py-2 px-3 font-semibold text-right">Senyships</th>
                <th className="py-2 px-3 font-semibold text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {serie.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-gray-400">Sin datos en el rango.</td></tr>}
              {[...view].sort((a, b) => b.fechaSort - a.fechaSort).map((d, i) => (
                <tr key={i} className="border-t border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">{d.fechaLabel}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtInt(d.pedidos)}</td>
                  {has.facturacion != null && <td className="py-2 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtMoney(d.facturacion)}</td>}
                  <td className="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMoney(d.ganFF)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMoney(d.ganEnvio)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMoney(d.senyships)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums font-semibold ${d.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function DashboardSeny({ addToast }) {
  const [tabs, setTabs] = useState(FALLBACK_TABS);
  const [tabGid, setTabGid] = useState(() => {
    try { return localStorage.getItem(TAB_KEY) || DEFAULT_GID; } catch { return DEFAULT_GID; }
  });
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

  // Descubre todas las pestañas del sheet (una vez, al montar).
  useEffect(() => {
    let cancel = false;
    fetch('/api/seny-sheet?list=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancel && Array.isArray(d.tabs) && d.tabs.length) setTabs(d.tabs); })
      .catch(() => {});
    return () => { cancel = true; };
  }, []);

  // Persistí la pestaña elegida.
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tabGid); } catch {} }, [tabGid]);

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

  // ----- Filtros: línea de negocio + rango de fechas -----
  const [linea, setLinea] = useState('ambos'); // ambos | full | ship
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');

  // Rango real de los datos (min/max fecha). Sirve de default de los pickers.
  const dataRange = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const o of orders) {
      if (!o.fechaSort) continue;
      if (o.fechaSort < min) min = o.fechaSort;
      if (o.fechaSort > max) max = o.fechaSort;
    }
    if (min === Infinity) return null;
    return { minISO: sortKeyToISO(min), maxISO: sortKeyToISO(max) };
  }, [orders]);

  // Al cambiar de pestaña / cargar datos, resetea el rango al total de los datos.
  useEffect(() => {
    if (dataRange) { setRangeFrom(dataRange.minISO); setRangeTo(dataRange.maxISO); }
  }, [dataRange]);

  // Ganancia efectiva por orden según la línea elegida.
  const gOf = useCallback((o) => (
    linea === 'full' ? o.ganProducto : linea === 'ship' ? o.ganEnvio : o.ganancia
  ), [linea]);

  // Vista = órdenes dentro del rango (la línea se aplica vía gOf en cada cálculo).
  const view = useMemo(() => {
    const from = isoToSortKey(rangeFrom);
    const to = isoToSortKey(rangeTo);
    return orders.filter((o) => {
      if (!o.fechaSort) return true; // sin fecha: no la filtramos por rango
      if (from && o.fechaSort < from) return false;
      if (to && o.fechaSort > to) return false;
      return true;
    });
  }, [orders, rangeFrom, rangeTo]);

  const resetRange = () => {
    if (dataRange) { setRangeFrom(dataRange.minISO); setRangeTo(dataRange.maxISO); setPreset('todo'); }
  };

  // Presets de período, anclados a la última fecha con datos (no al calendario
  // real, para que sirvan sea cual sea el mes que tenga la pestaña).
  const [preset, setPreset] = useState('todo');
  const applyPreset = (kind) => {
    if (!dataRange) return;
    const maxD = sortKeyToDate(isoToSortKey(dataRange.maxISO));
    let from = dataRange.minISO, to = dataRange.maxISO;
    if (kind === '7') from = dateToISO(addDays(maxD, -6));
    else if (kind === '30') from = dateToISO(addDays(maxD, -29));
    else if (kind === 'mes') from = dateToISO(new Date(maxD.getFullYear(), maxD.getMonth(), 1));
    else if (kind === 'mesant') {
      from = dateToISO(new Date(maxD.getFullYear(), maxD.getMonth() - 1, 1));
      to = dateToISO(new Date(maxD.getFullYear(), maxD.getMonth(), 0));
    }
    if (isoToSortKey(from) < isoToSortKey(dataRange.minISO)) from = dataRange.minISO;
    setRangeFrom(from); setRangeTo(to); setPreset(kind);
  };
  const onRangeEdit = (which, val) => {
    setPreset('custom');
    if (which === 'from') setRangeFrom(val); else setRangeTo(val);
  };

  // Agregado del período inmediatamente anterior (misma cantidad de días) para
  // los deltas "vs período anterior".
  const prevAgg = useMemo(() => {
    const from = isoToSortKey(rangeFrom), to = isoToSortKey(rangeTo);
    if (!from || !to) return null;
    const len = daysBetween(from, to);
    const prevToDate = addDays(sortKeyToDate(from), -1);
    const pf = isoToSortKey(dateToISO(addDays(prevToDate, -(len - 1))));
    const pt = isoToSortKey(dateToISO(prevToDate));
    let ventas = 0, profit = 0, ordenes = 0;
    for (const o of orders) {
      if (!o.fechaSort || o.fechaSort < pf || o.fechaSort > pt) continue;
      ventas += o.monto; profit += gOf(o); ordenes++;
    }
    return { ventas, profit, ordenes };
  }, [orders, rangeFrom, rangeTo, gOf]);

  // % de variación vs período anterior. null si no hay base comparable.
  const delta = (cur, prev) => {
    if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

  // ----- Agregados / KPIs -----
  const kpis = useMemo(() => {
    let ventas = 0, ganancia = 0, unidades = 0, perdidas = 0;
    let senyFull = 0, senyship = 0, costo = 0;
    const dias = new Set();
    for (const o of view) {
      const g = gOf(o);
      ventas += o.monto;
      ganancia += g;
      unidades += o.cant;
      senyFull += o.ganProducto;
      senyship += o.ganEnvio;
      costo += o.costoStock + o.costoEnvio;
      if (o.fechaSort) dias.add(o.fechaSort);
      if (g < 0) perdidas++;
    }
    const ordenes = view.length;
    const nDias = dias.size || 1;
    const margen = ventas > 0 ? (ganancia / ventas) * 100 : NaN;
    return {
      ventas, ganancia, unidades, perdidas, ordenes, margen,
      senyFull, senyship, costo,
      nDias,
      ventasDia: ventas / nDias,
      profitDia: ganancia / nDias,
      profitOrden: ordenes ? ganancia / ordenes : 0,
      costoOrden: ordenes ? costo / ordenes : 0,
    };
  }, [view, gOf]);

  // ----- Impuestos y costos fijos (configurable, persistido) -----
  const [fin, setFin] = useState(() => {
    try { return { ...FIN_DEFAULTS, ...JSON.parse(localStorage.getItem(FIN_KEY) || '{}') }; }
    catch { return { ...FIN_DEFAULTS }; }
  });
  useEffect(() => {
    try { localStorage.setItem(FIN_KEY, JSON.stringify(fin)); } catch {}
  }, [fin]);
  const setFinField = (k, v) => setFin((s) => ({ ...s, [k]: v }));

  const neto = useMemo(() => {
    const iibb = kpis.ventas * (num(fin.iibbPct) / 100);
    const iva = kpis.ventas * (num(fin.ivaPct) / 100);
    const sueldos = num(fin.sueldos);
    const gastos = num(fin.gastos);
    const totalEgresos = iibb + iva + sueldos + gastos;
    const profitNeto = kpis.ganancia - totalEgresos;
    return { iibb, iva, sueldos, gastos, totalEgresos, profitNeto };
  }, [kpis.ventas, kpis.ganancia, fin]);

  // ----- Serie diaria -----
  const serie = useMemo(() => {
    const byDay = new Map();
    for (const o of view) {
      if (!o.fechaSort) continue;
      const k = o.fechaSort;
      const cur = byDay.get(k) || { sort: k, fecha: o.fechaLabel, ventas: 0, profit: 0, ordenes: 0 };
      cur.ventas += o.monto;
      cur.profit += gOf(o);
      cur.ordenes += 1;
      byDay.set(k, cur);
    }
    return [...byDay.values()].sort((a, b) => a.sort - b.sort);
  }, [view, gOf]);

  // ----- Top clientes por profit -----
  const topClientes = useMemo(() => {
    const by = new Map();
    for (const o of view) {
      const cur = by.get(o.cliente) || { cliente: o.cliente, ganancia: 0, ventas: 0, ordenes: 0 };
      cur.ganancia += gOf(o);
      cur.ventas += o.monto;
      cur.ordenes++;
      by.set(o.cliente, cur);
    }
    return [...by.values()].sort((a, b) => b.ganancia - a.ganancia).slice(0, 8);
  }, [view, gOf]);

  const estados = useMemo(() => {
    const set = new Set();
    view.forEach((o) => o.estado && set.add(o.estado));
    return [...set];
  }, [view]);

  // ----- Donut: estructura de la facturación (a dónde va cada peso) -----
  const estructura = useMemo(() => {
    const fees = Math.max(0, kpis.ventas - kpis.costo - kpis.ganancia);
    return [
      { name: 'Profit', value: Math.max(0, kpis.ganancia), color: '#10b981' },
      { name: 'Costo producto', value: view.reduce((a, o) => a + Math.max(0, o.costoStock), 0), color: '#f59e0b' },
      { name: 'Costo envío', value: view.reduce((a, o) => a + Math.max(0, o.costoEnvio), 0), color: '#3b82f6' },
      { name: 'Comisiones', value: fees, color: '#a855f7' },
    ].filter((s) => s.value > 0);
  }, [view, kpis]);

  // ----- Donut: profit por línea de negocio -----
  const lineas = useMemo(() => [
    { name: 'Seny Full', value: Math.max(0, kpis.senyFull), color: SENY },
    { name: 'Senyship', value: Math.max(0, kpis.senyship), color: '#10b981' },
  ].filter((s) => s.value > 0), [kpis]);

  // ----- Donut: órdenes por estado -----
  const porEstado = useMemo(() => {
    const by = new Map();
    for (const o of view) {
      const k = o.estado || 'Sin estado';
      by.set(k, (by.get(k) || 0) + 1);
    }
    const palette = ['#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];
    return [...by.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({ name, value, color: palette[i % palette.length] }));
  }, [view]);

  // ----- Variable activa de la serie diaria -----
  const [serieVar, setSerieVar] = useState('profit'); // ventas | profit | ordenes

  // ----- Tabla filtrada -----
  const tablaRows = useMemo(() => {
    const q = norm(query);
    return view
      .filter((o) => (!q || norm(o.cliente).includes(q)) && (!estadoFilter || o.estado === estadoFilter))
      .sort((a, b) => b.fechaSort - a.fechaSort);
  }, [view, query, estadoFilter]);

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

  const isResumen = model && model.kind === 'resumen';
  const noTransactions = model && model.kind !== 'resumen' && model.isTransactions === false;

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
          {tabs.length > 1 && (
            <select
              value={tabGid}
              onChange={(e) => setTabGid(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-700 dark:text-gray-200 max-w-[200px]"
              title="Elegí la pestaña del sheet"
            >
              {tabs.map((t) => <option key={t.gid} value={t.gid}>{t.name}</option>)}
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

      {isResumen ? (
        <ResumenView dias={model.dias} has={model.has} />
      ) : noTransactions ? (
        <GenericTable headers={model.headers} rows={model.rawRows} />
      ) : (
        <>
          {/* Barra de filtros: presets + rango custom + línea de negocio */}
          <div className="mb-5 p-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 p-0.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => applyPreset(p.value)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      preset === p.value
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <input
                  type="date" value={rangeFrom} max={rangeTo || undefined}
                  onChange={(e) => onRangeEdit('from', e.target.value)}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-2 py-1.5 text-gray-700 dark:text-gray-200"
                />
                <span className="text-gray-400 text-sm">→</span>
                <input
                  type="date" value={rangeTo} min={rangeFrom || undefined}
                  onChange={(e) => onRangeEdit('to', e.target.value)}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-2 py-1.5 text-gray-700 dark:text-gray-200"
                />
              </div>
              <div className="ml-auto text-xs text-gray-400">
                Mostrando: <span className="font-semibold text-gray-600 dark:text-gray-300">{PRESETS.find((p) => p.value === preset)?.label || 'Personalizado'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Línea</span>
              <Segmented
                value={linea}
                onChange={setLinea}
                options={[
                  { value: 'ambos', label: 'Ambos' },
                  { value: 'full', label: 'Seny Full' },
                  { value: 'ship', label: 'Senyship' },
                ]}
              />
            </div>
          </div>

          {/* KPIs principales */}
          <SectionLabel>Pulso del negocio</SectionLabel>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <KpiCard
              icon={DollarSign} label="Facturación total" value={fmtMoney(kpis.ventas)}
              sub={`${fmtInt(kpis.ordenes)} órdenes · ${kpis.nDias} días`}
              delta={delta(kpis.ventas, prevAgg?.ventas)}
            />
            <KpiCard
              icon={kpis.ganancia >= 0 ? TrendingUp : TrendingDown}
              label="Profit total" value={fmtMoney(kpis.ganancia)}
              tone={kpis.ganancia >= 0 ? 'good' : 'bad'}
              delta={delta(kpis.ganancia, prevAgg?.profit)}
            />
            <KpiCard icon={Percent} label="Margen" value={fmtPct(kpis.margen)} tone={kpis.margen >= 0 ? 'good' : 'bad'} />
            <KpiCard
              icon={Landmark} label="Profit neto" value={fmtMoney(neto.profitNeto)}
              sub="después de impuestos y costos"
              tone={neto.profitNeto >= 0 ? 'good' : 'bad'}
            />
          </div>

          {/* Operación */}
          <SectionLabel>Operación</SectionLabel>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
            <KpiCard icon={Calendar} label="Facturación/día" value={fmtMoney(kpis.ventasDia)} />
            <KpiCard icon={Calendar} label="Profit/día" value={fmtMoney(kpis.profitDia)} tone={kpis.profitDia >= 0 ? 'good' : 'bad'} />
            <KpiCard icon={ShoppingCart} label="Profit/orden" value={fmtMoney(kpis.profitOrden)} tone={kpis.profitOrden >= 0 ? 'good' : 'bad'} />
            <KpiCard icon={Package} label="Costo prom./orden" value={fmtMoney(kpis.costoOrden)} />
            <KpiCard icon={Package} label="Unidades" value={fmtInt(kpis.unidades)} sub={`${fmtInt(kpis.ordenes)} órdenes`} />
            <KpiCard
              icon={AlertTriangle} label="Con pérdida" value={fmtInt(kpis.perdidas)}
              sub={kpis.ordenes ? fmtPct((kpis.perdidas / kpis.ordenes) * 100) + ' del total' : ''}
              tone={kpis.perdidas > 0 ? 'bad' : 'good'}
            />
          </div>

          {/* Líneas de negocio + Impuestos y costos fijos */}
          <SectionLabel>Rentabilidad y costos</SectionLabel>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Seny Full vs Senyship */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">Profit por línea de negocio</h3>
              <div className="grid grid-cols-2 gap-3">
                <LineaCard label="Seny Full" hint="Ganancia producto" value={kpis.senyFull} total={kpis.senyFull + kpis.senyship} color={SENY} />
                <LineaCard label="Senyship" hint="Ganancia envío" value={kpis.senyship} total={kpis.senyFull + kpis.senyship} color="#10b981" />
              </div>
              <p className="mt-3 text-[11px] text-gray-400">
                Seny Full = suma de “Ganancia Producto”. Senyship = suma de “Ganancia Envío”. Si el mapeo no es el correcto, avisame y lo ajusto.
              </p>
            </div>

            {/* Impuestos y costos fijos (editable) */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Settings className="w-4 h-4 text-gray-400" />
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">Impuestos y costos fijos</h3>
                <span className="text-[11px] text-gray-400">editable</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FinInput label="IIBB %" value={fin.iibbPct} onChange={(v) => setFinField('iibbPct', v)} suffix="%" calc={fmtMoney(neto.iibb)} />
                <FinInput label="IVA %" value={fin.ivaPct} onChange={(v) => setFinField('ivaPct', v)} suffix="%" calc={fmtMoney(neto.iva)} />
                <FinInput label="Sueldos" value={fin.sueldos} onChange={(v) => setFinField('sueldos', v)} prefix="$" />
                <FinInput label="Costos / gastos" value={fin.gastos} onChange={(v) => setFinField('gastos', v)} prefix="$" />
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1.5 text-sm">
                <RowKV k="Total egresos" v={fmtMoney(neto.totalEgresos)} muted />
                <RowKV k="Profit neto" v={fmtMoney(neto.profitNeto)} strong tone={neto.profitNeto >= 0 ? 'good' : 'bad'} />
              </div>
              <p className="mt-2 text-[11px] text-gray-400">IIBB e IVA se calculan como % sobre la facturación del período mostrado.</p>
            </div>
          </div>

          {/* Donas: composición y variables */}
          <SectionLabel>Análisis visual</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <DonutCard title="Estructura de la facturación" data={estructura} unit="money" />
            <DonutCard title="Profit por línea" data={lineas} unit="money" />
            <DonutCard title="Órdenes por estado" data={porEstado} unit="count" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
            <div className="xl:col-span-2">
              <ChartCard
                title={`Evolución diaria · ${SERIE_OPTS.find((s) => s.value === serieVar)?.label}`}
                right={<Segmented value={serieVar} onChange={setSerieVar} options={SERIE_OPTS} />}
              >
                {serie.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="senyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={SENY} stopOpacity={0.5} />
                          <stop offset="95%" stopColor={SENY} stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#88888822" />
                      <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                      <YAxis
                        tickFormatter={serieVar === 'ordenes' ? fmtInt : fmtMoneyShort}
                        tick={{ fontSize: 11, fill: '#9ca3af' }} width={48}
                      />
                      <Tooltip content={<TooltipBox unit={serieVar === 'ordenes' ? 'count' : 'money'} />} />
                      <Area
                        type="monotone" dataKey={serieVar}
                        name={SERIE_OPTS.find((s) => s.value === serieVar)?.label}
                        stroke={SENY} strokeWidth={2.5} fill="url(#senyFill)"
                      />
                    </AreaChart>
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
          <SectionLabel>Detalle de órdenes</SectionLabel>
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
