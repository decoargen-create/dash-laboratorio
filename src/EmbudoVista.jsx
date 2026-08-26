// Embudo de compra — la vista "Embudo" de Métricas.
//
// Campañas (CampanasTracker) responde "cuánto rindió cada campaña". Esta
// vista responde otra pregunta: "¿DÓNDE se me cae la gente?". Toma del
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
//
// Antes esto era una sección aparte con su propio selector de cuenta y de
// período. Ahora vive dentro de Métricas (MetricasSection.jsx la monta como
// una pestaña más) y hereda la cuenta, el período y el filtro por producto:
// el embudo y los testeos hablan siempre del mismo recorte.

import React, { useMemo } from 'react';
import {
  Filter, AlertTriangle, TrendingDown,
  Eye, MousePointerClick, FileText, ShoppingCart, CreditCard, BadgeCheck,
} from 'lucide-react';

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
// ========================================================================
// La vista: KPIs de plata + embudo + tabla por campaña
// ========================================================================
export function VistaEmbudo({ totals, campaigns, total, currency }) {
  if (!totals) {
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
        <Kpi label="Gasto" value={fmtMoney(totals.spend, currency)} sub={`${total || 0} campaña${total === 1 ? '' : 's'}`} />
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
      <FunnelTable campaigns={campaigns} currency={currency} />
    </div>
  );
}
