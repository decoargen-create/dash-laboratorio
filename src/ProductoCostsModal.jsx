// Modal de resumen de costos de UN producto. Muestra:
//   - Total gastado (todo lo externo: Apify, Claude, OpenAI, Meta)
//   - Breakdown por SERVICIO (a quién le pagás)
//   - Breakdown por TIPO de operación (scrape / análisis / ideas / creativos)
//   - Últimos movimientos con fecha + descripción + monto
//
// Los datos salen de costsStore.spendByProducto — los logs con productoId.
// Logs viejos (previos a la atribución per-product) no tienen productoId y
// no aparecen acá; siguen contando en GastosStack global.

import React, { useEffect, useMemo, useState } from 'react';
import { X, DollarSign, Server, Layers, Clock } from 'lucide-react';
import { logsForProducto, AUTO_TIPO_LABELS } from './costsStore.js';
import { supabase } from './supabase.js';
import AnimatedCounter from './AnimatedCounter.jsx';

const KIND_LABELS = {
  scrape: '🔍 Scrapes',
  'análisis': '🧠 Análisis IA',
  ideas: '💡 Ideas',
  creativos: '🎨 Creativos',
  research: '📄 Research',
  copy: '📝 Copy',
  copilot: '🤖 Copiloto',
  otros: '· Otros',
};

const PERIODOS = [
  { key: 'all', label: 'Todo' },
  { key: '30d', label: '30 días' },
  { key: '7d', label: '7 días' },
];

function sinceForPeriodo(key) {
  if (key === '7d') return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  if (key === '30d') return new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  return null;
}

function Money({ v, className = '' }) {
  return (
    <span className={`tabular-nums ${className}`}>
      ${(v || 0) < 0.01 && v > 0 ? v.toFixed(4) : (v || 0).toFixed(2)}
    </span>
  );
}

function BreakdownRow({ label, amount, max }) {
  const pct = max > 0 ? Math.round((amount / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-600 dark:text-gray-300 w-32 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-3.5 bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <Money v={amount} className="text-[11px] font-bold text-gray-800 dark:text-gray-100 w-16 text-right shrink-0" />
    </div>
  );
}

export default function ProductoCostsModal({ producto, onClose }) {
  const [periodo, setPeriodo] = useState('all');
  // Costos del CRON (server-side, tabla marketing_costs). El cron scrapea a
  // las 6AM sin browser — su gasto solo existe en esta tabla. RLS: el user
  // solo ve sus propias filas.
  const [cloudLogs, setCloudLogs] = useState([]);
  useEffect(() => {
    if (!producto?.id || !supabase) { setCloudLogs([]); return; }
    let cancelled = false;
    supabase
      .from('marketing_costs')
      .select('id, auto_tipo, amount, descripcion, kind, source, created_at')
      .eq('producto_id', String(producto.id))
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Migration 0017 no aplicada o red caída — degradar sin romper.
          console.warn('[costos] fetch marketing_costs falló:', error.message);
          setCloudLogs([]);
          return;
        }
        setCloudLogs((data || []).map(r => ({
          id: `cloud-${r.id}`,
          ts: r.created_at,
          autoTipo: r.auto_tipo,
          amount: Number(r.amount) || 0,
          descripcion: r.descripcion || '',
          kind: r.kind || 'scrape',
          source: r.source || 'cron',
        })));
      });
    return () => { cancelled = true; };
  }, [producto?.id]);

  const summary = useMemo(() => {
    const sinceIso = sinceForPeriodo(periodo);
    const sinceMs = sinceIso ? new Date(sinceIso).getTime() : null;
    const all = [...logsForProducto(producto?.id), ...cloudLogs]
      .filter(l => {
        if (sinceMs == null) return true;
        const t = new Date(l.ts).getTime();
        return !isNaN(t) && t >= sinceMs;
      })
      .sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const byService = {};
    const byKind = {};
    // Desglose POR DÍA (huso Argentina) — el user quiere ver "capaz un día
    // gasté más, un día menos". Key YYYY-MM-DD para ordenar; label corto
    // para mostrar.
    const byDay = new Map();
    const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    let total = 0;
    for (const l of all) {
      total += l.amount || 0;
      byService[l.autoTipo] = (byService[l.autoTipo] || 0) + (l.amount || 0);
      const k = l.kind || 'otros';
      byKind[k] = (byKind[k] || 0) + (l.amount || 0);
      try {
        const dayKey = dayFmt.format(new Date(l.ts)); // YYYY-MM-DD
        const prev = byDay.get(dayKey) || { total: 0, count: 0 };
        byDay.set(dayKey, { total: prev.total + (l.amount || 0), count: prev.count + 1 });
      } catch {}
    }
    // Días ordenados del más reciente al más viejo, cap 21 (3 semanas).
    const days = [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 21)
      .map(([day, v]) => ({ day, ...v }));
    return { total, byService, byKind, days, recent: all.slice(0, 25), count: all.length };
  }, [producto?.id, periodo, cloudLogs]);
  if (!producto) return null;

  const services = Object.entries(summary.byService).sort((a, b) => b[1] - a[1]);
  const kinds = Object.entries(summary.byKind).sort((a, b) => b[1] - a[1]);
  const maxService = services[0]?.[1] || 0;
  const maxKind = kinds[0]?.[1] || 0;
  const maxDay = summary.days?.reduce((m, d) => Math.max(m, d.total), 0) || 0;
  // Label legible del día: "hoy", "ayer", o "mié 15/07".
  const dayLabel = (dayKey) => {
    try {
      const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
      const ayer = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() - 24 * 3600 * 1000));
      if (dayKey === hoy) return 'Hoy';
      if (dayKey === ayer) return 'Ayer';
      const d = new Date(`${dayKey}T12:00:00`);
      return d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    } catch { return dayKey; }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose} role="dialog">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-lg glass-card border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <DollarSign size={16} className="text-brand-500" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">Costos de {producto.nombre}</h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">Todo lo externo: Apify, Claude, OpenAI, Meta</p>
          </div>
          <div className="flex items-center gap-1">
            {PERIODOS.map(p => (
              <button key={p.key} onClick={() => setPeriodo(p.key)}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded transition ${
                  periodo === p.key
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="ml-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Total */}
          <div className="text-center py-2">
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
              $<AnimatedCounter value={summary.total} decimals={2} />
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
              {summary.count} operaci{summary.count === 1 ? 'ón' : 'ones'} con costo{periodo !== 'all' ? ` · últimos ${periodo === '7d' ? '7' : '30'} días` : ' · histórico'}
            </p>
          </div>

          {summary.count === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
              Sin gastos registrados para este producto{periodo !== 'all' ? ' en este período' : ''}.
              {periodo === 'all' && ' Los gastos se registran a partir de ahora — corridas viejas no tienen atribución por producto.'}
            </p>
          ) : (
            <>
              {/* Por servicio */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Server size={12} className="text-gray-400" />
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Por servicio</p>
                </div>
                <div className="space-y-1.5">
                  {services.map(([svc, amt]) => (
                    <BreakdownRow key={svc} label={AUTO_TIPO_LABELS[svc] || svc} amount={amt} max={maxService} />
                  ))}
                </div>
              </div>

              {/* Por tipo de operación */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Layers size={12} className="text-gray-400" />
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Por tipo de operación</p>
                </div>
                <div className="space-y-1.5">
                  {kinds.map(([kind, amt]) => (
                    <BreakdownRow key={kind} label={KIND_LABELS[kind] || kind} amount={amt} max={maxKind} />
                  ))}
                </div>
              </div>

              {/* Por día — para ver picos: "un día gasté más, un día menos". */}
              {summary.days?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Clock size={12} className="text-gray-400" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Por día <span className="normal-case font-normal">(últimos {summary.days.length} con gasto)</span>
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {summary.days.map(d => (
                      <div key={d.day} className="flex items-center gap-2" title={`${d.count} operaci${d.count === 1 ? 'ón' : 'ones'}`}>
                        <span className="text-[11px] text-gray-600 dark:text-gray-300 w-32 shrink-0 truncate capitalize">
                          {dayLabel(d.day)}
                        </span>
                        <div className="flex-1 h-3.5 bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${maxDay > 0 ? Math.round((d.total / maxDay) * 100) : 0}%` }} />
                        </div>
                        <Money v={d.total} className="text-[11px] font-bold text-gray-800 dark:text-gray-100 w-16 text-right shrink-0" />
                        <span className="text-[9px] text-gray-400 w-8 text-right shrink-0 tabular-nums">×{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Últimos movimientos */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Clock size={12} className="text-gray-400" />
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Últimos movimientos</p>
                </div>
                <div className="space-y-1">
                  {summary.recent.map(l => (
                    <div key={l.id} className="flex items-center gap-2 text-[10px] py-0.5">
                      <span className="text-gray-400 dark:text-gray-500 w-14 shrink-0 tabular-nums">
                        {new Date(l.ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <span className="flex-1 text-gray-600 dark:text-gray-300 truncate">{l.descripcion}</span>
                      {l.source === 'cron' && (
                        <span className="shrink-0 px-1 py-0.5 text-[8px] font-bold rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300" title="Gasto del scrape automático nocturno">
                          cron
                        </span>
                      )}
                      <Money v={l.amount} className="font-semibold text-gray-800 dark:text-gray-100 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
