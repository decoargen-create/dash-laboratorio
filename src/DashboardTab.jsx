// Dashboard de producción creativa por producto.
//
// Resume, de un vistazo, qué está produciendo el pipeline para ESTE producto:
// volumen de ideas, calidad de los hooks, cobertura de ángulos, mix de
// formato, etapa de funnel, costo de IA e historial de corridas.
//
// Toda la data sale de lo que ya existe localmente (Bandeja + runHistory +
// competidores + creativos en IndexedDB) — no depende de Meta.

import React, { useState, useEffect, useMemo } from 'react';
import {
  Inbox, Image as ImageIcon, Video, Target, Trophy, DollarSign,
  Sparkles, Clock, Gauge, Layers, TrendingUp,
} from 'lucide-react';
import {
  loadIdeas, TIPO_META, ESTADO_META, ANGULO_META, CAMPAÑA_META, formatoDeAd,
} from './bandejaStore.js';

// KPI grande — número protagonista con ícono.
function KpiCard({ label, value, sublabel, icon, accent = false }) {
  return (
    <div className={`rounded-xl border p-4 ${
      accent
        ? 'bg-gradient-to-br from-brand-500 to-brand-600 border-brand-500 shadow-sm'
        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-center justify-between">
        <p className={`text-[10px] font-bold uppercase tracking-wider ${accent ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>
          {label}
        </p>
        <span className={accent ? 'text-white/80' : 'text-gray-300 dark:text-gray-600'}>{icon}</span>
      </div>
      <p className={`text-3xl font-bold tabular-nums mt-1 leading-none ${accent ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
        {value}
      </p>
      {sublabel && (
        <p className={`text-[10px] mt-1 ${accent ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`}>
          {sublabel}
        </p>
      )}
    </div>
  );
}

// Contenedor de panel con título.
function Panel({ title, icon, children, right }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
          {icon} {title}
        </p>
        {right}
      </div>
      {children}
    </div>
  );
}

// Barra horizontal etiquetada. El ancho es proporcional al máximo de la
// serie (no al total) — así la barra más alta llena el track y se comparan
// bien las categorías entre sí.
function BarRow({ label, value, max, color = 'bg-brand-500', emoji }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-600 dark:text-gray-300 w-32 shrink-0 truncate" title={label}>
        {emoji ? `${emoji} ` : ''}{label}
      </span>
      <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-900 rounded overflow-hidden">
        <div className={`h-full ${color} rounded transition-all`} style={{ width: `${value > 0 ? Math.max(pct, 4) : 0}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums text-gray-900 dark:text-gray-100 w-9 text-right shrink-0">
        {value}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
      <Gauge size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Todavía no hay datos para el dashboard</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        Corré el pipeline desde la pestaña Setup — cuando haya ideas en la Bandeja, acá vas a ver las estadísticas de producción.
      </p>
    </div>
  );
}

export default function DashboardTab({ producto, competidores = [], runHistory = [] }) {
  const [ideas, setIdeas] = useState(() => loadIdeas());

  // Refrescamos la data cada 4s — así el dashboard se actualiza mientras
  // corre el pipeline sin tener que recargar. Antes era polling cada 4s
  // (re-renders + localStorage reads para siempre). Ahora event-based:
  // suscribimos a los eventos del sync y reloadeamos solo cuando hay
  // cambio real.
  useEffect(() => {
    const reload = () => setIdeas(loadIdeas());
    reload();
    window.addEventListener('viora:marketing-pulled', reload);
    window.addEventListener('viora:marketing-storage-changed', reload);
    return () => {
      window.removeEventListener('viora:marketing-pulled', reload);
      window.removeEventListener('viora:marketing-storage-changed', reload);
    };
  }, []);

  const prodId = String(producto?.id || '');

  const stats = useMemo(() => {
    const mias = ideas.filter(i => String(i.productoId || '') === prodId);
    const porEstado = { pendiente: 0, en_uso: 0, usada: 0, archivada: 0 };
    const porTipo = { replica: 0, iteracion: 0, diferenciacion: 0, desde_cero: 0 };
    const porCampaña = {};
    const porAngulo = {};
    let imagen = 0, video = 0;
    let scoreSum = 0, scoreN = 0, fuertes = 0, ok = 0, flojos = 0;
    for (const i of mias) {
      porEstado[i.estado] = (porEstado[i.estado] || 0) + 1;
      if (porTipo[i.tipo] != null) porTipo[i.tipo]++;
      if (i.formato === 'video') video++; else imagen++;
      if (i.tipoCampaña) porCampaña[i.tipoCampaña] = (porCampaña[i.tipoCampaña] || 0) + 1;
      if (i.anguloCategoria) porAngulo[i.anguloCategoria] = (porAngulo[i.anguloCategoria] || 0) + 1;
      if (typeof i.scoreValue === 'number') {
        scoreSum += i.scoreValue; scoreN++;
        if (i.lowScore || i.scoreValue < 6) flojos++;
        else if (i.scoreValue >= 8) fuertes++;
        else ok++;
      }
    }
    const angulosCubiertos = Object.keys(porAngulo).length;

    // Corridas y costo de este producto.
    const runs = runHistory.filter(r => String(r.productoId || '') === prodId);
    const costo = { total: 0, anthropic: 0, openai: 0, apify: 0 };
    for (const r of runs) {
      costo.total += r.cost?.total || 0;
      costo.anthropic += r.cost?.anthropic || 0;
      costo.openai += r.cost?.openai || 0;
      costo.apify += r.cost?.apify || 0;
    }

    // Competencia.
    let adsTotal = 0, winners = 0;
    for (const c of competidores) {
      adsTotal += c.adsTotal || c.ads?.length || 0;
      winners += c.winnersCount || (c.ads || []).filter(a => a.isWinner).length || 0;
    }

    return {
      total: mias.length,
      porEstado, porTipo, porCampaña, porAngulo, angulosCubiertos,
      imagen, video,
      scorePromedio: scoreN > 0 ? scoreSum / scoreN : null,
      scoreN, fuertes, ok, flojos,
      runs, costo,
      competidoresCount: competidores.length,
      adsTotal, winners,
    };
  }, [ideas, runHistory, competidores, prodId]);

  if (stats.total === 0 && stats.runs.length === 0) {
    return <EmptyState />;
  }

  const fmtMoney = (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 4)}`;
  const maxEstado = Math.max(1, ...Object.values(stats.porEstado));
  const maxTipo = Math.max(1, ...Object.values(stats.porTipo));
  const maxCampaña = Math.max(1, ...Object.values(stats.porCampaña), 1);
  const maxAngulo = Math.max(1, ...Object.values(stats.porAngulo), 1);
  const maxFormato = Math.max(1, stats.imagen, stats.video);
  const maxScore = Math.max(1, stats.fuertes, stats.ok, stats.flojos);
  const maxCosto = Math.max(stats.costo.anthropic, stats.costo.openai, stats.costo.apify, 0.0001);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Ideas en Bandeja" value={stats.total} icon={<Inbox size={16} />} accent
          sublabel={`${stats.porEstado.pendiente} sin revisar`} />
        <KpiCard label="Hooks fuertes" value={stats.fuertes} icon={<TrendingUp size={16} />}
          sublabel={stats.scoreN > 0 ? `de ${stats.scoreN} puntuados` : 'sin puntuar aún'} />
        <KpiCard label="Competidores" value={stats.competidoresCount} icon={<Target size={16} />}
          sublabel={`${stats.adsTotal} ads scrapeados`} />
        <KpiCard label="Winners detectados" value={stats.winners} icon={<Trophy size={16} />}
          sublabel="ganadores de la competencia" />
        <KpiCard label="Gasto de IA" value={fmtMoney(stats.costo.total)} icon={<DollarSign size={16} />}
          sublabel={`${stats.runs.length} corrida${stats.runs.length !== 1 ? 's' : ''}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ideas por estado */}
        <Panel title="Ideas por estado" icon={<Inbox size={13} className="text-brand-500" />}>
          <div className="space-y-1.5">
            {Object.entries(ESTADO_META).map(([k, m]) => (
              <BarRow key={k} label={m.label} value={stats.porEstado[k] || 0} max={maxEstado}
                color={k === 'usada' ? 'bg-emerald-500' : k === 'en_uso' ? 'bg-amber-500' : k === 'archivada' ? 'bg-gray-400' : 'bg-brand-500'} />
            ))}
          </div>
        </Panel>

        {/* Ideas por tipo */}
        <Panel title="Ideas por tipo" icon={<Layers size={13} className="text-brand-500" />}>
          <div className="space-y-1.5">
            {Object.entries(TIPO_META).map(([k, m]) => (
              <BarRow key={k} label={m.label} emoji={m.emoji} value={stats.porTipo[k] || 0} max={maxTipo} />
            ))}
          </div>
        </Panel>

        {/* Formato */}
        <Panel title="Mix de formato" icon={<Video size={13} className="text-brand-500" />}>
          <div className="space-y-1.5">
            <BarRow label="Imagen / estático" emoji="🖼️" value={stats.imagen} max={maxFormato} color="bg-sky-500" />
            <BarRow label="Video" emoji="🎬" value={stats.video} max={maxFormato} color="bg-fuchsia-500" />
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
            {stats.total > 0 ? `${Math.round((stats.imagen / stats.total) * 100)}% imagen · ${Math.round((stats.video / stats.total) * 100)}% video` : '—'}
          </p>
        </Panel>

        {/* Calidad de hooks */}
        <Panel title="Calidad de los hooks" icon={<Gauge size={13} className="text-brand-500" />}
          right={stats.scorePromedio != null && (
            <span className="text-sm font-bold text-brand-600 dark:text-brand-400 tabular-nums">
              {stats.scorePromedio.toFixed(1)}<span className="text-[10px] text-gray-400">/10 prom.</span>
            </span>
          )}>
          {stats.scoreN > 0 ? (
            <div className="space-y-1.5">
              <BarRow label="Fuertes (8-10)" value={stats.fuertes} max={maxScore} color="bg-emerald-500" />
              <BarRow label="OK (6-7)" value={stats.ok} max={maxScore} color="bg-gray-400" />
              <BarRow label="Flojos (<6)" value={stats.flojos} max={maxScore} color="bg-red-500" />
            </div>
          ) : (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 italic py-4 text-center">
              Todavía no se puntuaron hooks. El pipeline los puntúa al final de cada corrida.
            </p>
          )}
        </Panel>
      </div>

      {/* Cobertura de ángulos */}
      <Panel title="Cobertura de ángulos estratégicos" icon={<Sparkles size={13} className="text-brand-500" />}
        right={<span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{stats.angulosCubiertos}/10 ángulos usados</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {Object.entries(ANGULO_META).map(([k, m]) => (
            <BarRow key={k} label={m.label} emoji={m.emoji} value={stats.porAngulo[k] || 0} max={maxAngulo} />
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Funnel */}
        <Panel title="Etapa de funnel" icon={<Target size={13} className="text-brand-500" />}>
          {Object.keys(stats.porCampaña).length > 0 ? (
            <div className="space-y-1.5">
              {Object.entries(CAMPAÑA_META).map(([k, m]) => (
                <BarRow key={k} label={m.label} emoji={m.emoji} value={stats.porCampaña[k] || 0} max={maxCampaña} />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 italic py-4 text-center">
              Las ideas todavía no tienen etapa de funnel asignada.
            </p>
          )}
        </Panel>

        {/* Costos */}
        <Panel title="Gasto de IA por servicio" icon={<DollarSign size={13} className="text-brand-500" />}
          right={<span className="text-sm font-bold text-brand-600 dark:text-brand-400">{fmtMoney(stats.costo.total)}</span>}>
          <div className="space-y-1.5">
            <BarRow label="Anthropic (texto)" emoji="🧠" value={Number(stats.costo.anthropic.toFixed(4))} max={maxCosto} color="bg-brand-500" />
            <BarRow label="OpenAI (imagen/voz)" emoji="🎨" value={Number(stats.costo.openai.toFixed(4))} max={maxCosto} color="bg-emerald-500" />
            <BarRow label="Apify (scraping)" emoji="🔍" value={Number(stats.costo.apify.toFixed(4))} max={maxCosto} color="bg-amber-500" />
          </div>
        </Panel>
      </div>

      {/* Historial de corridas */}
      {stats.runs.length > 0 && (
        <Panel title="Últimas corridas del pipeline" icon={<Clock size={13} className="text-brand-500" />}>
          <div className="space-y-1.5">
            {stats.runs.slice(0, 8).map(run => {
              const fecha = run.endedAt ? new Date(run.endedAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
              const b = run.stats?.breakdown;
              return (
                <div key={run.id} className="flex items-center gap-3 text-[11px] py-1.5 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                  <span className="text-gray-500 dark:text-gray-400 w-28 shrink-0">{fecha}</span>
                  <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">
                    {b
                      ? `${b.ideasNuevas} ideas · 🔵 ${b.replica} · 🟡 ${b.iteracion} · ✨ ${b.diferenciacion + b.desde_cero} · 🖼️ ${b.imagenes}/🎬 ${b.videos}`
                      : `${run.stats?.ideasInsertadas || 0} ideas`}
                  </span>
                  {run.cancelled && <span className="text-amber-600 dark:text-amber-400 font-semibold shrink-0">cancelada</span>}
                  {run.cost?.total > 0 && (
                    <span className="text-brand-600 dark:text-brand-400 font-mono font-bold shrink-0">{fmtMoney(run.cost.total)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
