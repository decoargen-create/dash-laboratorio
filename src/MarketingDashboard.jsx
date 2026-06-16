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
  Clock, CheckCircle2,
} from 'lucide-react';
import AnimatedCounter from './AnimatedCounter.jsx';
import { loadIdeas } from './bandejaStore.js';

function readProductos() {
  try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]'); }
  catch { return []; }
}

export default function MarketingDashboard({ onNavigate }) {
  const [productos, setProductos] = useState(() => readProductos());
  const [ideas, setIdeas] = useState(() => {
    try { return loadIdeas(); } catch { return []; }
  });

  // Re-fetch al focus (vuelve a esta tab) — los counts cambian mientras
  // navegás otras secciones.
  useEffect(() => {
    const refresh = () => {
      setProductos(readProductos());
      try { setIdeas(loadIdeas()); } catch {}
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('viora:marketing-storage-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('viora:marketing-storage-changed', refresh);
    };
  }, []);

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
        <h2 className="text-xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
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
      <p className={`text-2xl md:text-3xl font-bold tabular-nums leading-none ${tones[tone] || tones.default}`}>
        <AnimatedCounter value={typeof value === 'number' ? value : 0} />
      </p>
      {sub && <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </Comp>
  );
}
