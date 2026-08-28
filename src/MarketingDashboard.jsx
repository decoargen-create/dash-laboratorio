// Dashboard de estado del workspace. Vista de un pantallazo con lo que
// tenés (ideas, winners, ads, productos) + qué te conviene atacar hoy.
//
// Filosofía: en vez de caer en "Arranque" (lista de productos) al loguearte,
// llegás acá y ves: cuántos winners frescos te están esperando, qué cron
// corrió hoy, qué tenés sin tocar hace 7d. Tipo Vercel deployments + Linear
// inbox.
//
// Lectura 100% local (sin server). Si querés métricas server-side podés
// extender después.

import React, { useEffect, useState } from 'react';
import {
  Sparkles, TrendingUp, Package, Inbox, Trophy, Activity, ArrowRight,
  Clock, CheckCircle2, Wallet, Image as ImageIcon, Search, Film, BarChart3,
} from 'lucide-react';
import AnimatedCounter from './AnimatedCounter.jsx';
import { loadIdeas } from './bandejaStore.js';
import { globalCostKPIs } from './costsStore.js';
import { fmtMoney, subscribeMoney } from './moneyStore.js';
import { entregasPorDiaSemana, entregasNuevas, subscribeProduccion } from './produccionStore.js';

function readProductos() {
  try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]'); }
  catch { return []; }
}

// Entregas del equipo que el admin todavía no miró (misma marca local que usa
// el aviso de Producción). Para el badge del acceso rápido.
function entregasNuevasCount() {
  try {
    const n = parseInt(localStorage.getItem('adslab-produccion-entregas-vistas-v1'), 10);
    const vistas = Number.isFinite(n) ? n : 0;
    return entregasNuevas(vistas).reduce((s, e) => s + e.nuevos, 0);
  } catch { return 0; }
}

export default function MarketingDashboard({ onNavigate }) {
  const [productos, setProductos] = useState(() => readProductos());
  const [ideas, setIdeas] = useState(() => {
    try { return loadIdeas(); } catch { return []; }
  });

  const [, forceMoney] = useState(0);

  // Re-fetch al focus (vuelve a esta tab) — los counts cambian mientras
  // navegás otras secciones.
  useEffect(() => {
    const refresh = () => {
      setProductos(readProductos());
      try { setIdeas(loadIdeas()); } catch {}
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('viora:marketing-storage-changed', refresh);
    window.addEventListener('viora:cost-logged', refresh);
    const unMoney = subscribeMoney(() => forceMoney(x => x + 1));
    // Producción cambia (el equipo sube videos) → refrescamos el pulso + badge.
    const unProd = subscribeProduccion(() => forceMoney(x => x + 1));
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('viora:marketing-storage-changed', refresh);
      window.removeEventListener('viora:cost-logged', refresh);
      unMoney();
      unProd();
    };
  }, []);

  // Pulso de la semana: entregas (videos) por día + accesos rápidos.
  const pulso = entregasPorDiaSemana();
  const pulsoMax = Math.max(1, ...pulso.counts);
  const nuevasEntregas = entregasNuevasCount();

  // KPIs de costo (histórico de este dispositivo).
  const kpis = globalCostKPIs();

  // Stats agregados
  const totalProductos = productos.length;
  const totalIdeasPendientes = ideas.filter(i => i.estado === 'pendiente').length;
  const totalIdeasUsadas = ideas.filter(i => i.estado === 'usada').length;
  // Producto activo (si lo hay)
  const activeProductId = (() => {
    try { return localStorage.getItem('adslab-marketing-active-product') || null; } catch { return null; }
  })();
  const activeProducto = productos.find(p => String(p.id) === String(activeProductId));

  // Cálculo de ads totales scrapeados (sum de adsTotal por comp).
  let totalAds = 0;
  let totalComps = 0;
  let compsActivos = 0;
  let staleComps = 0;
  for (const p of productos) {
    for (const c of (p.competidores || [])) {
      totalComps++;
      totalAds += c.adsTotal || c.ads?.length || 0;
      if (c.smartScrapeEnabled !== false) {
        compsActivos++;
        const ts = c.lastAdsCheck ? new Date(c.lastAdsCheck).getTime() : 0;
        if (ts === 0 || (Date.now() - ts) > 36 * 3600 * 1000) staleComps++;
      }
    }
  }

  // Ideas frescas hoy (creadas en las últimas 24h)
  const ahora = Date.now();
  const ideasFrescas = ideas.filter(i => {
    const ts = i.createdAt ? new Date(i.createdAt).getTime() : 0;
    return ts > 0 && (ahora - ts) < 24 * 3600 * 1000;
  }).length;

  // Top 4 productos por actividad reciente (combinación de last comp scrape +
  // last idea created).
  const productosRanked = productos.map(p => {
    const lastCompTs = (p.competidores || []).reduce((max, c) => {
      const ts = c.lastAdsCheck ? new Date(c.lastAdsCheck).getTime() : 0;
      return ts > max ? ts : max;
    }, 0);
    const lastIdeaTs = ideas.filter(i => String(i.productoId || '') === String(p.id))
      .reduce((max, i) => {
        const ts = i.createdAt ? new Date(i.createdAt).getTime() : 0;
        return ts > max ? ts : max;
      }, 0);
    const lastActivity = Math.max(lastCompTs, lastIdeaTs, new Date(p.createdAt || 0).getTime());
    const ideasCount = ideas.filter(i => String(i.productoId || '') === String(p.id)).length;
    const adsCount = (p.competidores || []).reduce((s, c) => s + (c.adsTotal || c.ads?.length || 0), 0);
    return { p, lastActivity, ideasCount, adsCount };
  }).sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 4);

  const isStaleAcrossAll = compsActivos >= 3 && staleComps === compsActivos;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Hero card con greeting + active product hint */}
      <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-2xl p-5 md:p-6 animate-fade-in-up">
        <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 mb-1">
          <Sparkles size={14} />
          <p className="text-[10px] font-bold uppercase tracking-wider">Tu workspace</p>
        </div>
        <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
          {activeProducto
            ? <>Trabajando sobre <span className="text-brand-600 dark:text-brand-400">{activeProducto.nombre}</span></>
            : 'Bienvenido de vuelta'}
        </h2>
        <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-1">
          {totalProductos > 0
            ? <>{totalProductos} producto{totalProductos !== 1 ? 's' : ''} · {totalComps} competidor{totalComps !== 1 ? 'es' : ''} · {totalAds.toLocaleString('es-AR')} ads acumulados</>
            : 'Arrancá creando tu primer producto.'}
        </p>
      </div>

      {/* Métricas — 4 stats grandes con counters animados */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Package size={14} />}
          label="Productos"
          value={totalProductos}
          tone="default"
          onClick={() => onNavigate?.('mk-arranque')}
        />
        <StatCard
          icon={<Inbox size={14} />}
          label="Ideas pendientes"
          value={totalIdeasPendientes}
          sub={ideasFrescas > 0 ? `${ideasFrescas} nuevas hoy` : null}
          tone={totalIdeasPendientes > 0 ? 'brand' : 'muted'}
          onClick={() => onNavigate?.('mk-bandeja')}
        />
        <StatCard
          icon={<Trophy size={14} />}
          label="Ideas usadas"
          value={totalIdeasUsadas}
          tone={totalIdeasUsadas > 0 ? 'emerald' : 'muted'}
          onClick={() => onNavigate?.('mk-bandeja')}
        />
        <StatCard
          icon={<TrendingUp size={14} />}
          label="Ads competencia"
          value={totalAds}
          sub={isStaleAcrossAll ? '⚠ cron sin correr' : `${compsActivos} activos`}
          tone={isStaleAcrossAll ? 'amber' : 'default'}
          onClick={() => onNavigate?.('mk-inspiracion')}
        />
      </div>

      {/* Pulso de la semana + accesos rápidos */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Gráfico: entregas del equipo por día */}
        <div className="lg:col-span-3 glass-card border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-5">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={14} className="text-brand-500" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Entregas del equipo · esta semana</h3>
            <span className="ml-auto text-[11px] font-bold text-brand-600 dark:text-brand-400 tabular-nums">
              {pulso.total} video{pulso.total !== 1 ? 's' : ''}
            </span>
          </div>
          {pulso.total > 0 ? (
            <>
              <div className="flex items-end gap-2 h-24 mt-3">
                {pulso.counts.map((n, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                    {n > 0 && <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 tabular-nums">{n}</span>}
                    <div
                      className={`w-full rounded-t-md transition-all ${n > 0 ? 'bg-gradient-to-t from-brand-600 to-brand-400' : 'bg-gray-200 dark:bg-gray-700'}`}
                      style={{ height: `${Math.max(6, (n / pulsoMax) * 100)}%` }}
                      title={`${n} entrega${n !== 1 ? 's' : ''}`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-1.5">
                {pulso.labels.map((l, i) => (
                  <span key={i} className="flex-1 text-center text-[10px] text-gray-400 dark:text-gray-500">{l}</span>
                ))}
              </div>
            </>
          ) : (
            <div className="h-24 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
              Todavía no hay entregas esta semana.
            </div>
          )}
        </div>

        {/* Accesos rápidos */}
        <div className="lg:col-span-2 glass-card border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-5 flex flex-col gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-0.5">Accesos rápidos</p>
          <QuickAction icon={<Package size={14} />} label="Tus productos" onClick={() => onNavigate?.('mk-arranque')} />
          <QuickAction icon={<Film size={14} />} label="Producción" badge={nuevasEntregas > 0 ? `${nuevasEntregas} nuevas` : null} onClick={() => onNavigate?.('mk-produccion')} />
          <QuickAction icon={<Trophy size={14} />} label="Winners" onClick={() => onNavigate?.('mk-winners')} />
          <QuickAction icon={<Wallet size={14} />} label="Área creativa" onClick={() => onNavigate?.('mk-creativa-dash')} />
        </div>
      </div>

      {/* KPIs de costos — promedios sobre todo el histórico */}
      {kpis.total > 0 && (
        <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Wallet size={14} className="text-brand-500" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Costos</h3>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              · promedios sobre {kpis.productosCount} producto{kpis.productosCount !== 1 ? 's' : ''} y {kpis.creativosCount} estáticos generados
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CostKpi icon={<ImageIcon size={13} />} label="Costo por estático" value={fmtMoney(kpis.avgCreativo)} sub={`promedio · ${kpis.creativosCount} hechos`} tone="brand" />
            <CostKpi icon={<Package size={13} />} label="Costo por producto" value={fmtMoney(kpis.avgPorProducto)} sub="armado completo (prom)" tone="emerald" />
            <CostKpi icon={<Search size={13} />} label="Costo por scrapeo" value={fmtMoney(kpis.avgScrape)} sub={`promedio · ${kpis.scrapesCount} scrapes`} />
            <CostKpi icon={<Wallet size={13} />} label="Gasto total" value={fmtMoney(kpis.total)} sub="registrado" />
          </div>
        </div>
      )}

      {/* Top productos por actividad reciente */}
      {productosRanked.length > 0 && (
        <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-brand-500" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Actividad reciente</h3>
            </div>
            <button onClick={() => onNavigate?.('mk-arranque')}
              className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 inline-flex items-center gap-1">
              Ver todos <ArrowRight size={11} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {productosRanked.map(({ p, lastActivity, ideasCount, adsCount }) => {
              const days = lastActivity > 0 ? Math.floor((ahora - lastActivity) / (24 * 3600 * 1000)) : null;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    try { localStorage.setItem('adslab-marketing-active-product', String(p.id)); } catch {}
                    onNavigate?.('mk-arranque');
                  }}
                  className="card-hover text-left p-3 bg-white/40 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-200 to-brand-400 dark:from-brand-900/40 dark:to-brand-700/40 flex items-center justify-center shrink-0 text-white font-bold text-sm">
                    {(p.nombre || '?')[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">{p.nombre || `Producto ${p.id}`}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      <AnimatedCounter value={ideasCount} /> ideas · <AnimatedCounter value={adsCount} /> ads
                      {days != null && days < 999 && (
                        <span className="ml-1">· <Clock size={9} className="inline" /> hace {days === 0 ? 'hoy' : `${days}d`}</span>
                      )}
                    </p>
                  </div>
                  <ArrowRight size={13} className="text-gray-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {totalProductos === 0 && (
        <div className="glass-card border-2 border-dashed border-brand-300 dark:border-brand-700 rounded-2xl p-8 text-center">
          <CheckCircle2 size={32} className="text-brand-400 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Empezá creando tu primer producto</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto mt-1">
            En el Arranque cargás un producto, sus competidores y disparás el pipeline. Después acá vas a ver el resumen.
          </p>
          <button onClick={() => onNavigate?.('mk-arranque')}
            className="btn-fluo mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg">
            Ir al Arranque <ArrowRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// KPI de costo: valor ya formateado (string, respeta ARS/USD), sin counter.
function CostKpi({ icon, label, value, sub, tone = 'default' }) {
  const toneCls = tone === 'brand' ? 'text-brand-600 dark:text-brand-400'
    : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-gray-900 dark:text-gray-100';
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 p-3">
      <div className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500 mb-1.5">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight">{label}</span>
      </div>
      <div className={`text-xl md:text-2xl font-bold font-mono tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// Botón de acceso rápido del Home. Badge opcional (ej: "3 nuevas").
function QuickAction({ icon, label, badge, onClick }) {
  return (
    <button onClick={onClick}
      className="card-hover group flex items-center gap-2.5 px-3 py-2.5 bg-white/50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg text-left transition">
      <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 text-xs font-bold text-gray-800 dark:text-gray-100">{label}</span>
      {badge && (
        <span className="text-[10px] font-bold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 rounded-full px-2 py-0.5">{badge}</span>
      )}
      <ArrowRight size={13} className="text-gray-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
    </button>
  );
}

function StatCard({ icon, label, value, sub, tone = 'default', onClick }) {
  const tones = {
    default: 'text-gray-900 dark:text-gray-100',
    brand: 'text-brand-600 dark:text-brand-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    muted: 'text-gray-400 dark:text-gray-500',
  };
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`glass-card card-hover border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 mb-1.5">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-xl md:text-2xl font-bold tabular-nums leading-none ${tones[tone] || tones.default}`}>
        <AnimatedCounter value={typeof value === 'number' ? value : 0} />
      </p>
      {sub && <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </Comp>
  );
}
