// Métricas — embudo de compra de la cuenta publicitaria.
//
// Campañas (CampanasTracker) responde "cuánto rindió cada campaña". Esta
// sección responde otra pregunta: "¿DÓNDE se me cae la gente?". Trae del
// endpoint /api/meta/funnel-insights los 6 pasos del embudo por campaña:
//
//   impresiones → clicks al enlace → landing page views → add to cart
//   → iniciar pago → compras
//
// y muestra, para cada paso, cuántos llegaron, qué % del paso anterior
// sobrevivió y cuánto costó cada uno. El paso con peor retención queda
// marcado como "mayor caída" — ese es el cuello de botella a atacar.
//
// Las barras del embudo miden RETENCIÓN (% del paso anterior), no volumen
// absoluto: con 1.2M de impresiones y 40 compras, una barra proporcional al
// volumen sería invisible en los últimos pasos y no diría nada.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Filter, Loader2, RefreshCw, AlertCircle, AlertTriangle, ChevronDown, Plug,
  TrendingDown, Eye, MousePointerClick, FileText, ShoppingCart, CreditCard, BadgeCheck,
} from 'lucide-react';
import {
  useMetaConnections, useMetaAdAccounts, authHeaders, openMetaConnect,
} from './MetaConnect.jsx';

const LS_PRESET = 'adslab-metricas-date-preset';
const LS_ACCOUNT = 'adslab-metricas-account';

const PRESETS = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'last_7d', label: 'Últimos 7 días' },
  { value: 'last_14d', label: 'Últimos 14 días' },
  { value: 'last_30d', label: 'Últimos 30 días' },
  { value: 'this_month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes pasado' },
  { value: 'maximum', label: 'Histórico' },
];

// Definición de los pasos del embudo. `rate` es la clave del ratio contra el
// paso anterior; el primero no tiene (es el 100% de referencia).
const STEPS = [
  { key: 'impressions',      label: 'Impresiones',      icon: Eye,               rate: null,             cost: null,               help: 'Veces que se mostró el anuncio.' },
  { key: 'linkClicks',       label: 'Clicks al enlace',  icon: MousePointerClick, rate: 'linkCtr',        cost: 'costPerLinkClick', help: 'Clicks que van a tu sitio (no incluye likes ni clicks en el perfil).', fueraDeCompetencia: true },
  { key: 'landingPageViews', label: 'Vieron la landing', icon: FileText,          rate: 'lpvRate',        cost: 'costPerLpv',       help: 'La página terminó de cargar. La diferencia contra los clicks es gente que se fue antes de que cargue.' },
  { key: 'addToCart',        label: 'Agregaron al carrito', icon: ShoppingCart,   rate: 'atcRate',        cost: 'costPerAtc',       help: 'Evento AddToCart del pixel.' },
  { key: 'initiateCheckout', label: 'Iniciaron el pago', icon: CreditCard,        rate: 'checkoutRate',   cost: 'costPerCheckout',  help: 'Evento InitiateCheckout del pixel.' },
  { key: 'purchases',        label: 'Compraron',         icon: BadgeCheck,        rate: 'purchaseRate',   cost: 'cpa',              help: 'Evento Purchase del pixel.' },
];

// --- formato ---

function fmtNum(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function fmtMoney(n, currency) {
  if (n == null) return '—';
  const v = Number(n);
  const formatted = v >= 1000
    ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 })
    : v.toFixed(v < 100 ? 2 : 0);
  return currency ? `${formatted} ${currency}` : `$${formatted}`;
}

function fmtPct(n, decimals = 1) {
  if (n == null) return '—';
  return `${Number(n).toFixed(decimals)}%`;
}

// ========================================================================
// Tarjeta de KPI
// ========================================================================
function Kpi({ label, value, sub, tone = 'default', title }) {
  const tones = {
    default: 'text-gray-900 dark:text-gray-100',
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400',
  };
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5" title={title}>
      <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">{label}</p>
      <p className={`text-lg font-bold tabular-nums leading-tight ${tones[tone]}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{sub}</p>}
    </div>
  );
}

// ========================================================================
// Embudo — un renglón por paso, con barra de retención
// ========================================================================
export function Funnel({ totals, currency }) {
  // El peor paso: el de menor retención entre los que tienen datos. Es el
  // que hay que arreglar antes de subir presupuesto.
  //
  // El salto impresiones → clicks queda AFUERA de la comparación: es el CTR,
  // que vive en el 1% por naturaleza de la subasta. Si lo dejábamos competir
  // contra retenciones on-site (20-80%), ganaba siempre y el badge no
  // señalaba nada. El CTR se juzga contra el benchmark de la industria, no
  // contra los pasos del carrito.
  const worstKey = useMemo(() => {
    let worst = null;
    for (const step of STEPS) {
      if (!step.rate || step.fueraDeCompetencia) continue;
      const prevIdx = STEPS.findIndex(s => s.key === step.key) - 1;
      const prevValue = totals[STEPS[prevIdx].key] || 0;
      const value = totals[step.key] || 0;
      // Un paso sin datos (0) cuando el anterior tampoco tuvo no cuenta como
      // caída: no hay nada que perder ahí.
      if (prevValue <= 0 || value <= 0) continue;
      const rate = totals[step.rate] || 0;
      if (worst === null || rate < worst.rate) worst = { key: step.key, rate };
    }
    return worst?.key || null;
  }, [totals]);

  // Pasos "mudos": el pixel no reporta ese evento (0) pero sí reporta pasos
  // POSTERIORES. Ahí el 0 no es una caída, es data que no llega.
  const mudos = useMemo(() => {
    const set = new Set();
    STEPS.forEach((step, i) => {
      if ((totals[step.key] || 0) > 0) return;
      const posterior = STEPS.slice(i + 1).some(s => (totals[s.key] || 0) > 0);
      if (posterior) set.add(step.key);
    });
    return set;
  }, [totals]);

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-wrap">
        <Filter size={15} className="text-brand-600 dark:text-brand-400" />
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Embudo de compra</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          la barra es cuánta gente sobrevive de un paso al siguiente
        </span>
        <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">
          la «mayor caída» se busca de la landing para abajo — el CTR se mide contra el benchmark, no contra el resto
        </span>
      </div>

      <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const value = totals[step.key] || 0;
          const rate = step.rate ? (totals[step.rate] || 0) : 100;
          const cost = step.cost ? totals[step.cost] : null;
          const esMudo = mudos.has(step.key);
          const esPeor = step.key === worstKey;
          // Piso de 2% para que una retención microscópica igual se vea.
          const width = Math.max(2, Math.min(100, rate));
          const tone = esMudo
            ? 'bg-gray-300 dark:bg-gray-600'
            : esPeor
              ? 'bg-gradient-to-r from-red-400 to-red-500'
              : 'bg-gradient-to-r from-brand-400 to-brand-600';

          return (
            <li key={step.key} className="px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <Icon size={14} className="text-gray-400 shrink-0" />
                <span className="text-xs font-bold text-gray-900 dark:text-gray-100" title={step.help}>
                  {step.label}
                </span>
                {i > 0 && !esMudo && (
                  <span className={`text-[10px] font-bold tabular-nums ${esPeor ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {fmtPct(rate, rate < 10 ? 2 : 1)} del paso anterior
                  </span>
                )}
                {esPeor && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                    <TrendingDown size={9} /> mayor caída
                  </span>
                )}
                {esMudo && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                    title="Hay compras registradas pero este evento llega en cero: casi seguro el pixel no lo está mandando.">
                    <AlertTriangle size={9} /> el pixel no manda este evento
                  </span>
                )}
                <span className="ml-auto text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {esMudo ? '—' : fmtNum(value)}
                </span>
                {cost != null && !esMudo && value > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums w-24 text-right">
                    {fmtMoney(cost, currency)} c/u
                  </span>
                )}
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${width}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ========================================================================
// Tabla por campaña
// ========================================================================
export function FunnelTable({ campaigns, currency }) {
  if (!campaigns || campaigns.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
        <Filter size={26} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin datos en este período</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Meta solo devuelve campañas que tuvieron entrega. Probá con un período más largo.
        </p>
      </div>
    );
  }

  const convTone = (v) => (v >= 2 ? 'text-emerald-600 dark:text-emerald-400' : v >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400');
  const roasTone = (v) => (v >= 2 ? 'text-emerald-600 dark:text-emerald-400' : v >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400');

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 text-[10px] uppercase tracking-wider">
              <th className="text-left font-bold px-3 py-2.5 sticky left-0 bg-gray-50 dark:bg-gray-900/50">Campaña</th>
              <th className="text-right font-bold px-2 py-2.5">Gasto</th>
              <th className="text-right font-bold px-2 py-2.5" title="Clicks al enlace">Clicks</th>
              <th className="text-right font-bold px-2 py-2.5" title="Landing page views">Landing</th>
              <th className="text-right font-bold px-2 py-2.5" title="Add to cart">Carrito</th>
              <th className="text-right font-bold px-2 py-2.5" title="Iniciar pago">Pago</th>
              <th className="text-right font-bold px-2 py-2.5">Compras</th>
              <th className="text-right font-bold px-2 py-2.5" title="Compras / clicks al enlace">Conv.</th>
              <th className="text-right font-bold px-2 py-2.5">CPA</th>
              <th className="text-right font-bold px-2 py-2.5">ROAS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {campaigns.map(c => {
              const f = c.funnel || {};
              const fbUrl = `https://business.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${c.id}`;
              return (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition">
                  <td className="px-3 py-2.5 sticky left-0 bg-white dark:bg-gray-800 max-w-[240px]">
                    <a href={fbUrl} target="_blank" rel="noreferrer"
                      className="font-semibold text-gray-900 dark:text-gray-100 truncate block hover:text-brand-600 dark:hover:text-brand-400"
                      title={c.name}>
                      {c.name || '(sin nombre)'}
                    </a>
                    {c.objective && <p className="text-[9px] text-gray-400 truncate">{c.objective}</p>}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fmtMoney(f.spend, currency)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtNum(f.linkClicks)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtNum(f.landingPageViews)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtNum(f.addToCart)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtNum(f.initiateCheckout)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">{fmtNum(f.purchases)}</td>
                  <td className={`px-2 py-2.5 text-right tabular-nums font-semibold ${convTone(f.conversionRate || 0)}`}>{fmtPct(f.conversionRate, 2)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{f.cpa ? fmtMoney(f.cpa, currency) : '—'}</td>
                  <td className={`px-2 py-2.5 text-right tabular-nums font-semibold ${roasTone(f.roas || 0)}`}>{(f.roas || 0).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ========================================================================
// Sección
// ========================================================================
export default function MetricasSection({ addToast }) {
  const { connections, loading: connLoading } = useMetaConnections();
  const { accounts, loading: acctLoading, errors: acctErrors } = useMetaAdAccounts(connections);

  const [accountId, setAccountId] = useState(() => {
    try { return localStorage.getItem(LS_ACCOUNT) || ''; } catch { return ''; }
  });
  const [preset, setPreset] = useState(() => {
    try { return localStorage.getItem(LS_PRESET) || 'last_7d'; } catch { return 'last_7d'; }
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const account = accounts.find(a => a.id === accountId) || null;
  const currency = account?.currency || null;

  // Si la cuenta guardada ya no está accesible, caemos a la primera.
  useEffect(() => {
    if (accounts.length === 0) return;
    if (!accounts.some(a => a.id === accountId)) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  useEffect(() => {
    try { if (accountId) localStorage.setItem(LS_ACCOUNT, accountId); } catch {}
  }, [accountId]);
  useEffect(() => {
    try { localStorage.setItem(LS_PRESET, preset); } catch {}
  }, [preset]);

  useEffect(() => {
    if (acctErrors.length > 0) {
      addToast?.({ type: 'warning', message: `No pude leer una conexión — ${acctErrors.join(' · ')}` });
    }
  }, [acctErrors, addToast]);

  const load = useCallback(async (acct, datePreset) => {
    if (!acct) return;
    setLoading(true); setError(null);
    try {
      let url = `/api/meta/funnel-insights?account_id=${encodeURIComponent(acct.id)}&date_preset=${encodeURIComponent(datePreset)}`;
      if (acct.connId && acct.connId !== '__cookie__') url += `&connection_id=${encodeURIComponent(acct.connId)}`;
      const r = await fetch(url, { headers: await authHeaders(false) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setData(d);
    } catch (err) {
      setError(err.message); setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) load(account, preset);
  }, [account, preset, load]);

  const header = (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-400 flex items-center justify-center text-white shadow-sm shrink-0">
        <Filter size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Métricas</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          El embudo de compra de tu cuenta: dónde entra la gente, dónde se cae y cuánto cuesta cada paso.
        </p>
      </div>
    </div>
  );

  // Sin conexión todavía.
  if (!connLoading && connections.length === 0) {
    return (
      <div className="max-w-6xl mx-auto space-y-5">
        {header}
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
          <Plug size={28} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Conectá tu cuenta publicitaria</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
            Las métricas salen directo de Meta — hace falta una cuenta conectada.
          </p>
          <button onClick={openMetaConnect}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#1877F2] rounded-lg hover:bg-[#0f6ae0] shadow-sm transition">
            <Plug size={14} /> Conectar cuenta publicitaria
          </button>
        </div>
      </div>
    );
  }

  const totals = data?.totals || null;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {header}

      {/* Controles */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <select
            value={accountId} onChange={e => setAccountId(e.target.value)}
            className="w-full pl-3 pr-8 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md appearance-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">{acctLoading ? 'Cargando cuentas…' : '— Elegí una cuenta publicitaria —'}</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.accountId}{a.currency ? ` (${a.currency})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        <select
          value={preset} onChange={e => setPreset(e.target.value)}
          className="px-2.5 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        <button
          onClick={() => account && load(account, preset)}
          disabled={!account || loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50"
          title="Refrescar"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refrescar
        </button>
      </div>

      {error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">No pude cargar las métricas</p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-0.5 break-words">{error}</p>
          </div>
        </div>
      ) : loading && !data ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Cargando el embudo…</span>
        </div>
      ) : !totals ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
          <Filter size={26} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Elegí una cuenta para empezar</p>
        </div>
      ) : (
        <>
          {/* KPIs de plata */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            <Kpi label="Gasto" value={fmtMoney(totals.spend, currency)} sub={`${data.total} campaña${data.total === 1 ? '' : 's'}`} />
            <Kpi label="Compras" value={fmtNum(totals.purchases)} sub={`de ${fmtNum(totals.linkClicks)} clicks`} />
            <Kpi label="Ingresos" value={fmtMoney(totals.revenue, currency)} />
            <Kpi
              label="ROAS" value={(totals.roas || 0).toFixed(2)}
              tone={totals.roas >= 2 ? 'good' : totals.roas >= 1 ? 'warn' : 'bad'}
              sub="ingresos / gasto"
            />
            <Kpi label="CPA" value={totals.cpa ? fmtMoney(totals.cpa, currency) : '—'} sub="costo por compra" />
            <Kpi label="Ticket promedio" value={totals.aov ? fmtMoney(totals.aov, currency) : '—'} title="Ingresos dividido compras (AOV)" />
            <Kpi
              label="Conversión" value={fmtPct(totals.conversionRate, 2)}
              tone={totals.conversionRate >= 2 ? 'good' : totals.conversionRate >= 1 ? 'warn' : 'bad'}
              sub="compras / clicks"
            />
          </div>

          <Funnel totals={totals} currency={currency} />

          <FunnelTable campaigns={data.campaigns} currency={currency} />
        </>
      )}
    </div>
  );
}
