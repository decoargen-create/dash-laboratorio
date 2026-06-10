// Reporte agregado de winners. Lee del array de items (ya filtrado por
// producto en el modal padre) los que tienen winner=true y computa:
//   - Métricas promedio (CTR, ROAS, CPA, thumb-stop)
//   - Distribución de "qué funcionó" → identifica qué variable rinde más
//   - Brand sources más exitosas
//   - Variant styles más exitosos
//
// El user lo usa para responder preguntas tipo:
//   • "¿Mis winners qué tienen en común?"
//   • "¿Qué ángulo estoy explotando más?"
//   • "¿De qué brand sacó más winners?"
// Y decide qué pinear / qué descartar.

import React from 'react';
import { Trophy, TrendingUp, Target, Palette, Tag } from 'lucide-react';

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pct(num) {
  return num == null ? '—' : `${num.toFixed(2)}%`;
}

function num(n, decimals = 2) {
  return n == null ? '—' : Number(n).toFixed(decimals);
}

function dollar(n) {
  return n == null ? '—' : `$${Number(n).toFixed(2)}`;
}

export default function WinnersReport({ winners }) {
  if (winners.length === 0) {
    return (
      <div className="border-2 border-dashed border-amber-300 dark:border-amber-700 rounded-xl p-12 text-center bg-amber-50/40 dark:bg-amber-900/10">
        <Trophy size={36} className="mx-auto text-amber-400 dark:text-amber-600 mb-3" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin winners marcados todavía</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
          Cuando publiques creativos en Meta y concluyas que algunos rinden, marcalos como winners desde el lightbox de Galería (botón Trophy). Acá vas a ver el análisis agregado.
        </p>
      </div>
    );
  }

  // Métricas agregadas
  const metrics = {
    ctr: winners.map(w => w.winnerMetrics?.ctr).filter(v => v != null).map(Number),
    roas: winners.map(w => w.winnerMetrics?.roas).filter(v => v != null).map(Number),
    cpa: winners.map(w => w.winnerMetrics?.cpa).filter(v => v != null).map(Number),
    thumb_stop: winners.map(w => w.winnerMetrics?.thumb_stop).filter(v => v != null).map(Number),
    purchases: winners.map(w => w.winnerMetrics?.purchases).filter(v => v != null).map(Number),
  };

  // Qué funcionó — distribución
  const queFuncCount = {};
  for (const w of winners) {
    const arr = w.winnerMetrics?.que_funciono;
    if (!Array.isArray(arr)) continue;
    for (const k of arr) {
      queFuncCount[k] = (queFuncCount[k] || 0) + 1;
    }
  }
  const queFuncSorted = Object.entries(queFuncCount).sort((a, b) => b[1] - a[1]);
  const QUE_FUNC_LABELS = {
    hook: '🎣 Hook', visual: '🎨 Visual', copy: '📝 Copy', cta: '🖱️ CTA',
    angulo: '📐 Ángulo', oferta: '💰 Oferta', audience: '👥 Audiencia',
  };

  // Brand sources
  const brandCount = {};
  for (const w of winners) {
    const b = w.sourceBrand || '(sin brand)';
    brandCount[b] = (brandCount[b] || 0) + 1;
  }
  const brandSorted = Object.entries(brandCount).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Variant styles
  const styleCount = {};
  for (const w of winners) {
    const s = w.variantStyle || '(default)';
    styleCount[s] = (styleCount[s] || 0) + 1;
  }
  const styleSorted = Object.entries(styleCount).sort((a, b) => b[1] - a[1]);

  // ROAS top 3 winners
  const topRoas = winners
    .filter(w => w.winnerMetrics?.roas != null)
    .sort((a, b) => Number(b.winnerMetrics.roas) - Number(a.winnerMetrics.roas))
    .slice(0, 3);

  const maxQueFunc = queFuncSorted[0]?.[1] || 1;
  const maxBrand = brandSorted[0]?.[1] || 1;
  const maxStyle = styleSorted[0]?.[1] || 1;

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header con count */}
      <div className="flex items-center gap-3">
        <Trophy size={22} className="text-amber-500" />
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
            {winners.length} winner{winners.length !== 1 ? 's' : ''} analizados
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Patrones agregados de lo que está rindiendo en tus campañas
          </p>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard icon={<TrendingUp size={14} />} label="CTR promedio" value={pct(avg(metrics.ctr))} sub={`mediana ${pct(median(metrics.ctr))}`} count={metrics.ctr.length} />
        <MetricCard icon={<TrendingUp size={14} />} label="ROAS promedio" value={num(avg(metrics.roas))} sub={`mediana ${num(median(metrics.roas))}`} count={metrics.roas.length} />
        <MetricCard icon={<TrendingUp size={14} />} label="CPA promedio" value={dollar(avg(metrics.cpa))} sub={`mediana ${dollar(median(metrics.cpa))}`} count={metrics.cpa.length} />
        <MetricCard icon={<TrendingUp size={14} />} label="Thumb-stop avg" value={pct(avg(metrics.thumb_stop))} sub={`mediana ${pct(median(metrics.thumb_stop))}`} count={metrics.thumb_stop.length} />
      </div>

      {/* Qué funcionó */}
      <Section icon={<Target size={14} />} title="Qué está funcionando" subtitle="Variables que vos identificaste como ganadoras en los winners. Lo que más se repite es donde está tu fuerza actual — explotalo más.">
        {queFuncSorted.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Nadie completó "qué funcionó" en los winners. Editalos para verlo.</p>
        ) : (
          <div className="space-y-2">
            {queFuncSorted.map(([key, count]) => (
              <BarRow key={key} label={QUE_FUNC_LABELS[key] || key} count={count} max={maxQueFunc} color="amber" total={winners.length} />
            ))}
          </div>
        )}
      </Section>

      {/* Brand sources */}
      <Section icon={<Palette size={14} />} title="Inspiraciones que generan winners" subtitle="De qué brands/competidores estás sacando más ganadores. Hint: scrappeá más ads de los top.">
        <div className="space-y-2">
          {brandSorted.map(([brand, count]) => (
            <BarRow key={brand} label={brand} count={count} max={maxBrand} color="brand" total={winners.length} />
          ))}
        </div>
      </Section>

      {/* Variant styles */}
      <Section icon={<Tag size={14} />} title="Estilos de variante más exitosos" subtitle="¿Tus winners son réplicas fieles, rebrandings de paleta, o desde idea? Sabés qué estilo invertir más.">
        <div className="space-y-2">
          {styleSorted.map(([style, count]) => (
            <BarRow key={style} label={style} count={count} max={maxStyle} color="emerald" total={winners.length} />
          ))}
        </div>
      </Section>

      {/* Top ROAS */}
      {topRoas.length > 0 && (
        <Section icon={<Trophy size={14} />} title="Top 3 winners por ROAS" subtitle="Los más rentables. Estos son los candidatos #1 para iterar.">
          <div className="space-y-2">
            {topRoas.map((w, i) => (
              <div key={w.id} className="flex items-center gap-3 p-2.5 bg-gradient-to-r from-amber-50 to-transparent dark:from-amber-900/20 dark:to-transparent border border-amber-200 dark:border-amber-800/60 rounded-lg">
                <div className="w-7 h-7 rounded-full bg-amber-500 text-white font-bold text-xs flex items-center justify-center shrink-0">{i + 1}</div>
                {w.imageUrl && (
                  <img src={w.imageUrl} alt="" className="w-10 h-10 object-cover rounded border border-amber-200" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">{w.sourceHeadline || w.sourceBrand || w.id}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    ROAS {num(w.winnerMetrics.roas)}{w.winnerMetrics.ctr != null && ` · CTR ${pct(w.winnerMetrics.ctr)}`}{w.winnerMetrics.ad_id && ` · Ad ${w.winnerMetrics.ad_id}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, sub, count }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5">
      <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mb-1">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
        {count > 0 ? sub : 'sin datos'} · {count} winner{count !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

function Section({ icon, title, subtitle, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 mb-1">
        {icon}
        <h4 className="text-xs font-bold uppercase tracking-wider">{title}</h4>
      </div>
      {subtitle && <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">{subtitle}</p>}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
        {children}
      </div>
    </div>
  );
}

function BarRow({ label, count, max, color = 'amber', total }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  const sharePct = total > 0 ? Math.round((count / total) * 100) : 0;
  const colors = {
    amber: 'bg-amber-400',
    brand: 'bg-brand-400',
    emerald: 'bg-emerald-400',
  };
  return (
    <div className="flex items-center gap-3">
      <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate w-32 shrink-0">{label}</p>
      <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden relative">
        <div className={`${colors[color] || colors.amber} h-full rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] tabular-nums text-gray-600 dark:text-gray-400 w-16 text-right shrink-0">
        <span className="font-bold">{count}</span> · {sharePct}%
      </p>
    </div>
  );
}
