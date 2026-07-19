// Modal de resumen de costos de UN producto. Muestra:
//   - Total gastado (todo lo externo: Apify, Claude, OpenAI, Meta)
//   - Breakdown por SERVICIO (a quién le pagás)
//   - Breakdown por TIPO de operación (scrape / análisis / ideas / creativos)
//   - Últimos movimientos con fecha + descripción + monto
//
// Los datos salen de costsStore.spendByProducto — los logs con productoId.
// Logs viejos (previos a la atribución per-product) no tienen productoId y
// no aparecen acá; siguen contando en GastosStack global.

import React, { useMemo, useState } from 'react';
import { X, DollarSign, Server, Layers, Clock } from 'lucide-react';
import { spendByProducto, AUTO_TIPO_LABELS } from './costsStore.js';
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
  const summary = useMemo(
    () => spendByProducto(producto?.id, { sinceIso: sinceForPeriodo(periodo), recentN: 25 }),
    [producto?.id, periodo]
  );
  if (!producto) return null;

  const services = Object.entries(summary.byService).sort((a, b) => b[1] - a[1]);
  const kinds = Object.entries(summary.byKind).sort((a, b) => b[1] - a[1]);
  const maxService = services[0]?.[1] || 0;
  const maxKind = kinds[0]?.[1] || 0;

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
