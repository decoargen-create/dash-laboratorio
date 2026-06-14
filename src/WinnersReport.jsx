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
//
// ⚠️ TDZ FIX: helpers + inner components definidos ANTES del export default.
// El minifier de Vite/Rollup convierte function declarations a const expressions
// en algunos casos, y si MetricCard/Section/BarRow estaban DESPUÉS del componente
// que los usa, producía "Cannot access 'w' before initialization" en producción.

import React from 'react';
import { Trophy, TrendingUp, Target, Palette, Tag, Package } from 'lucide-react';

const ANZUELO_META = {
  hook:     { label: 'Hook',     emoji: '🎣', color: '#f59e0b' },
  visual:   { label: 'Visual',   emoji: '🎨', color: '#ec4899' },
  copy:     { label: 'Copy',     emoji: '📝', color: '#8b5cf6' },
  cta:      { label: 'CTA',      emoji: '🖱️', color: '#3b82f6' },
  angulo:   { label: 'Ángulo',   emoji: '📐', color: '#10b981' },
  oferta:   { label: 'Oferta',   emoji: '💰', color: '#eab308' },
  audience: { label: 'Audiencia', emoji: '👥', color: '#06b6d4' },
};

function AnzuelosMap({ winners, productoNombre, productoImagen }) {
  // Buckets por categoría — solo las que tienen winners.
  const buckets = {};
  for (const w of winners) {
    const arr = w.winnerMetrics?.que_funciono;
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const k of arr) {
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(w);
    }
  }
  const entries = Object.entries(buckets)
    .filter(([k]) => ANZUELO_META[k])
    .sort((a, b) => b[1].length - a[1].length);

  if (entries.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 text-center bg-gray-50/50 dark:bg-gray-800/30">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Marcá los winners completando "qué funcionó" (hook, visual, oferta, etc.)
          para que aparezca el mapa de ánzuelos.
        </p>
      </div>
    );
  }

  // Layout radial. Container 100% x 360px alto.
  const N = entries.length;
  const size = 360;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size * 0.36;
  // Nodos: posición + datos.
  const nodes = entries.map(([key, ws], i) => {
    // Empezamos en -90° (arriba) y vamos en sentido horario.
    const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    return { key, ws, x, y, meta: ANZUELO_META[key] };
  });

  // Buscamos thumbnail rep del bucket (winner con ROAS más alto si tiene,
  // sino el más nuevo). Usado para mostrar visualmente "este ángulo
  // está representado por estos creativos".
  const repFor = (ws) => {
    if (!ws.length) return null;
    const withRoas = ws.filter(w => w.winnerMetrics?.roas != null);
    if (withRoas.length > 0) {
      return [...withRoas].sort((a, b) => Number(b.winnerMetrics.roas) - Number(a.winnerMetrics.roas))[0];
    }
    return ws[0];
  };

  return (
    <Section
      icon={<Target size={14} />}
      title="Mapa de ánzuelos"
      subtitle="Tu producto en el centro, los hooks que están rindiendo apuntan hacia él. Lo que más grande aparece es donde está tu palanca actual."
    >
      <div className="relative mx-auto" style={{ width: size, height: size, maxWidth: '100%' }}>
        {/* SVG layer — flechas curvas desde cada nodo al centro */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${size} ${size}`}>
          <defs>
            {nodes.map((n, i) => (
              <marker
                key={`arr-${i}`}
                id={`arrow-${i}`}
                viewBox="0 0 10 10"
                refX="8" refY="5"
                markerWidth="6" markerHeight="6"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={n.meta.color} opacity={0.85} />
              </marker>
            ))}
          </defs>
          {nodes.map((n, i) => {
            // Curva: control point a mitad de camino, desplazado leve para
            // que no sea una recta. Endpoint un poco antes del centro para
            // que la cabeza de flecha no se meta en el producto card.
            const dx = centerX - n.x;
            const dy = centerY - n.y;
            const len = Math.hypot(dx, dy);
            const stopShort = 48;
            const tx = n.x + (dx / len) * (len - stopShort);
            const ty = n.y + (dy / len) * (len - stopShort);
            const midX = (n.x + centerX) / 2 + dy * 0.06;
            const midY = (n.y + centerY) / 2 - dx * 0.06;
            const strokeWidth = Math.max(1.5, Math.min(4, 1 + n.ws.length * 0.5));
            return (
              <path
                key={`p-${i}`}
                d={`M ${n.x} ${n.y} Q ${midX} ${midY} ${tx} ${ty}`}
                stroke={n.meta.color}
                strokeWidth={strokeWidth}
                fill="none"
                opacity={0.7}
                markerEnd={`url(#arrow-${i})`}
              />
            );
          })}
        </svg>

        {/* Producto en el centro */}
        <div
          className="absolute flex flex-col items-center justify-center bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-2xl shadow-lg border-2 border-amber-300 dark:border-amber-700"
          style={{
            left: centerX - 56, top: centerY - 56,
            width: 112, height: 112,
          }}
        >
          {productoImagen ? (
            <img src={productoImagen} alt="" className="w-12 h-12 object-cover rounded-lg mb-1 border border-amber-200" />
          ) : (
            <Package size={28} className="mb-1 opacity-90" />
          )}
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-95 px-2 text-center leading-tight line-clamp-2">
            {productoNombre || 'Producto'}
          </p>
          <p className="text-[9px] opacity-80 mt-0.5">{winners.length} winners</p>
        </div>

        {/* Nodos de ánzuelos */}
        {nodes.map((n) => {
          const rep = repFor(n.ws);
          const size = Math.max(72, Math.min(110, 60 + n.ws.length * 8));
          return (
            <div
              key={n.key}
              className="absolute flex flex-col items-center justify-center rounded-xl shadow-md border-2 bg-white dark:bg-gray-800"
              style={{
                left: n.x - size / 2, top: n.y - size / 2,
                width: size, height: size,
                borderColor: n.meta.color,
              }}
              title={`${n.ws.length} winner${n.ws.length !== 1 ? 's' : ''} con ${n.meta.label}`}
            >
              {rep?.imageUrl ? (
                <img src={rep.imageUrl} alt="" className="w-7 h-7 object-cover rounded mb-1 border border-gray-200 dark:border-gray-700" />
              ) : (
                <div className="text-lg leading-none mb-1">{n.meta.emoji}</div>
              )}
              <p
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: n.meta.color }}
              >
                {n.meta.label}
              </p>
              <p className="text-[9px] text-gray-500 dark:text-gray-400 tabular-nums">
                {n.ws.length} winner{n.ws.length !== 1 ? 's' : ''}
              </p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ============================================================
// Helpers de formato — declarados antes para que estén disponibles
// en el render del componente principal.
// ============================================================
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

function pct(n) {
  return n == null ? '—' : `${n.toFixed(2)}%`;
}

function num(n, decimals = 2) {
  return n == null ? '—' : Number(n).toFixed(decimals);
}

function dollar(n) {
  return n == null ? '—' : `$${Number(n).toFixed(2)}`;
}

// ============================================================
// Inner components — TODOS antes del export default.
// ============================================================

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
  const widthPct = max > 0 ? (count / max) * 100 : 0;
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
        <div className={`${colors[color] || colors.amber} h-full rounded-full transition-all duration-500`} style={{ width: `${widthPct}%` }} />
      </div>
      <p className="text-[10px] tabular-nums text-gray-600 dark:text-gray-400 w-16 text-right shrink-0">
        <span className="font-bold">{count}</span> · {sharePct}%
      </p>
    </div>
  );
}

// ============================================================
// Main export — ahora MetricCard/Section/BarRow ya están en scope.
// ============================================================

export default function WinnersReport({ winners, productoNombre, productoImagen }) {
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

      {/* Mapa radial de ánzuelos — vista de un pantallazo de los ángulos
          ganadores. Va arriba de las barras para que sea lo primero
          que ve el user al abrir la pestaña. */}
      <AnzuelosMap
        winners={winners}
        productoNombre={productoNombre}
        productoImagen={productoImagen}
      />

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
