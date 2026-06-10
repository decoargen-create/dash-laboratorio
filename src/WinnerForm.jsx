// Form modal para marcar un creativo como winner — captura las métricas
// + ad ID + qué funcionó. Todo opcional excepto: el user tiene que pinchar
// "Confirmar". El shape coincide con winner_metrics (jsonb) en marketing_creativos.

import React, { useState } from 'react';
import { X, Trophy } from 'lucide-react';

const QUE_FUNCIONO_OPTS = [
  { v: 'hook', label: 'Hook', emoji: '🎣' },
  { v: 'visual', label: 'Visual', emoji: '🎨' },
  { v: 'copy', label: 'Copy', emoji: '📝' },
  { v: 'cta', label: 'CTA', emoji: '🖱️' },
  { v: 'angulo', label: 'Ángulo', emoji: '📐' },
  { v: 'oferta', label: 'Oferta', emoji: '💰' },
  { v: 'audience', label: 'Audiencia', emoji: '👥' },
];

export default function WinnerForm({ creativo, onConfirm, onCancel }) {
  const existing = creativo?.winnerMetrics || {};
  const [adId, setAdId] = useState(existing.ad_id || '');
  const [daysRunning, setDaysRunning] = useState(existing.days_running || '');
  const [ctr, setCtr] = useState(existing.ctr || '');
  const [roas, setRoas] = useState(existing.roas || '');
  const [cpa, setCpa] = useState(existing.cpa || '');
  const [thumbStop, setThumbStop] = useState(existing.thumb_stop || '');
  const [impressions, setImpressions] = useState(existing.impressions || '');
  const [purchases, setPurchases] = useState(existing.purchases || '');
  const [queFunciono, setQueFunciono] = useState(new Set(existing.que_funciono || []));
  const [notas, setNotas] = useState(existing.notas || '');
  const [saving, setSaving] = useState(false);

  const toggleQueFunciono = (v) => {
    setQueFunciono(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  };

  const handleSubmit = async () => {
    setSaving(true);
    const metrics = {
      ad_id: adId.trim() || undefined,
      days_running: daysRunning ? Number(daysRunning) : undefined,
      ctr: ctr ? Number(ctr) : undefined,
      roas: roas ? Number(roas) : undefined,
      cpa: cpa ? Number(cpa) : undefined,
      thumb_stop: thumbStop ? Number(thumbStop) : undefined,
      impressions: impressions ? Number(impressions) : undefined,
      purchases: purchases ? Number(purchases) : undefined,
      que_funciono: [...queFunciono],
      notas: notas.trim() || undefined,
    };
    // Sacamos undefined para que el jsonb quede limpio.
    Object.keys(metrics).forEach(k => metrics[k] === undefined && delete metrics[k]);
    try {
      await onConfirm(metrics);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 py-8 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onCancel}>
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={18} className="text-amber-500" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              Marcar como winner
            </h3>
          </div>
          <button onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Todos los campos son opcionales — completá lo que tengas. La metadata
            te sirve para después iterar (entender qué funcionó) y para análisis
            agregado de tus ganadores.
          </p>

          {/* Ad ID */}
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1">
              Ad ID de Meta
            </label>
            <input type="text" value={adId} onChange={e => setAdId(e.target.value)}
              placeholder="ej: 120211234567890"
              className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
            <p className="text-[10px] text-gray-400 mt-0.5">
              Si tenés conectado Meta Ads, esto habilita auto-pull de performance.
            </p>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="CTR (%)" value={ctr} onChange={setCtr} type="number" step="0.01" />
            <Field label="ROAS" value={roas} onChange={setRoas} type="number" step="0.01" />
            <Field label="CPA (USD)" value={cpa} onChange={setCpa} type="number" step="0.01" />
            <Field label="Thumb-stop (%)" value={thumbStop} onChange={setThumbStop} type="number" step="0.1" />
            <Field label="Impresiones" value={impressions} onChange={setImpressions} type="number" />
            <Field label="Compras" value={purchases} onChange={setPurchases} type="number" />
          </div>

          <Field label="Días corriendo" value={daysRunning} onChange={setDaysRunning} type="number" />

          {/* Qué funcionó */}
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">
              Qué creés que hizo que funcione
            </label>
            <div className="flex flex-wrap gap-1.5">
              {QUE_FUNCIONO_OPTS.map(o => {
                const active = queFunciono.has(o.v);
                return (
                  <button key={o.v}
                    onClick={() => toggleQueFunciono(o.v)}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md border transition ${
                      active
                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-amber-300'
                    }`}>
                    {o.emoji} {o.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Esto te ayuda después a iterar pinneando lo que ganó y variando lo demás.
            </p>
          </div>

          {/* Notas */}
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1">
              Notas
            </label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)}
              rows={3} placeholder="Ej: corre bien con público frío 25-40, en frío puro. Atribución 7d-click."
              className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onCancel}
            className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg hover:from-amber-600 hover:to-amber-700 transition disabled:opacity-60">
            <Trophy size={12} />
            {saving ? 'Guardando…' : 'Confirmar winner'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', step }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1">
        {label}
      </label>
      <input type={type} step={step} value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
    </div>
  );
}
