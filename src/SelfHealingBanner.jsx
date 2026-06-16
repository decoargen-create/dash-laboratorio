// Banner global de estado del sistema. Detecta problemas que normalmente
// el user solo descubre cuando algo falla "raro", y los expone como una
// franja amarilla/roja arriba del contenido. Cada problema tiene un CTA
// accionable (ir a settings / reintentar / dismissear).
//
// Detecciones actuales (todas heurísticas locales, sin server calls):
//   • Apify quota agotada — se prende cuando hay >=1 entry en quotaRetryStore
//   • Cron diario falló — última actividad cloud >36h Y hay comps con master ON
//   • Service key env var faltante — se infiere si los endpoints server-side
//     devolvieron 503 en sesión reciente (lo trackea sessionStorage)
//   • Migrations pendientes — se infiere si patches al cloud tiran
//     "column does not exist" (lo trackea sessionStorage via patch error)
//
// No molesta al user cuando no hay nada — devuelve null. Cuando hay,
// muestra el más crítico arriba con expand para ver el resto.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { getQuotaQueue, subscribeQuotaQueue } from './quotaRetryStore.js';

const DISMISS_KEY = 'adslab-self-healing-dismissed';
const DISMISS_TTL_MS = 12 * 60 * 60 * 1000; // 12h — vuelve a aparecer al día siguiente

function getDismissed() {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const { ids, ts } = JSON.parse(raw);
    if (Date.now() - ts > DISMISS_TTL_MS) return new Set();
    return new Set(ids || []);
  } catch { return new Set(); }
}
function setDismissed(set) {
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify({ ids: [...set], ts: Date.now() }));
  } catch {}
}

// Cada issue: { id, severity: 'critical' | 'warning' | 'info', title, hint, cta?: { label, onClick } }
function detectIssues() {
  const issues = [];

  // 1. Apify quota — hay scrapes encolados por hard limit.
  try {
    const queue = getQuotaQueue();
    if (queue.length > 0) {
      issues.push({
        id: 'apify-quota',
        severity: 'warning',
        title: 'Apify llegó al límite mensual',
        hint: `${queue.length} scrape${queue.length !== 1 ? 's' : ''} en cola — subí el plan en console.apify.com y reintentá desde Inspiración.`,
      });
    }
  } catch {}

  // 2. Service key faltante (inferido de un 503 reciente en server-side).
  try {
    if (sessionStorage.getItem('adslab-svc-key-missing') === '1') {
      issues.push({
        id: 'svc-key',
        severity: 'critical',
        title: 'SUPABASE_SERVICE_KEY no configurada',
        hint: 'Algunos endpoints server-side están devolviendo 503. Configurá la env var en Vercel y redeployá.',
      });
    }
  } catch {}

  // 3. Migration pendiente (inferido de "column does not exist" reciente).
  try {
    const pendingMig = sessionStorage.getItem('adslab-migration-pending');
    if (pendingMig) {
      issues.push({
        id: 'migration',
        severity: 'critical',
        title: `Migration pendiente en Supabase`,
        hint: `${pendingMig} — corré las migrations pendientes en Supabase SQL editor.`,
      });
    }
  } catch {}

  // 4. Cron diario que parece haber dejado de correr.
  // Heurística suave: si hay competidores con master switch ON y la última
  // entry de adsHistory es >36h, el cron probablemente no corrió.
  try {
    const productos = JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]');
    let activeComps = 0;
    let staleComps = 0;
    for (const p of productos) {
      for (const c of (p.competidores || [])) {
        if (c.smartScrapeEnabled === false) continue;
        activeComps++;
        const lastTs = c.lastAdsCheck ? new Date(c.lastAdsCheck).getTime() : 0;
        if (Date.now() - lastTs > 36 * 60 * 60 * 1000) staleComps++;
      }
    }
    if (activeComps >= 3 && staleComps === activeComps) {
      issues.push({
        id: 'cron-stale',
        severity: 'warning',
        title: 'El cron diario parece no estar corriendo',
        hint: `Ninguno de tus ${activeComps} competidores activos se scrapeó en las últimas 36h. Chequeá CRON_SECRET en Vercel.`,
      });
    }
  } catch {}

  return issues;
}

export default function SelfHealingBanner() {
  const [issues, setIssues] = useState(() => detectIssues());
  const [dismissed, setDismissedState] = useState(() => getDismissed());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Re-evaluamos cada 60s + cuando cambia la quota queue.
    const id = setInterval(() => setIssues(detectIssues()), 60000);
    const unsub = subscribeQuotaQueue(() => setIssues(detectIssues()));
    return () => { clearInterval(id); unsub(); };
  }, []);

  const visible = issues.filter(i => !dismissed.has(i.id));
  if (visible.length === 0) return null;

  const dismiss = (id) => {
    const next = new Set(dismissed); next.add(id);
    setDismissedState(next); setDismissed(next);
  };
  // El más crítico va arriba.
  const sorted = [...visible].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] || 99) - (order[b.severity] || 99);
  });
  const primary = sorted[0];
  const others = sorted.slice(1);
  const sevStyles = {
    critical: 'from-red-500/15 to-red-500/5 border-red-400/40 text-red-900 dark:text-red-200',
    warning: 'from-amber-500/15 to-amber-500/5 border-amber-400/40 text-amber-900 dark:text-amber-200',
    info: 'from-blue-500/15 to-blue-500/5 border-blue-400/40 text-blue-900 dark:text-blue-200',
  };

  return (
    <div className={`mx-4 md:mx-8 mt-3 rounded-xl border bg-gradient-to-r ${sevStyles[primary.severity] || sevStyles.warning} backdrop-blur-sm animate-fade-in-down`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <AlertTriangle size={16} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold truncate">{primary.title}</p>
          <p className="text-[11px] opacity-90 truncate">{primary.hint}</p>
        </div>
        {others.length > 0 && (
          <button onClick={() => setExpanded(v => !v)}
            className="text-[10px] font-semibold opacity-80 hover:opacity-100 px-1.5 py-0.5 rounded transition inline-flex items-center gap-0.5">
            +{others.length} más {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
        <button onClick={() => dismiss(primary.id)}
          className="opacity-60 hover:opacity-100 transition shrink-0" title="Dismiss 12h">
          <X size={14} />
        </button>
      </div>
      {expanded && others.length > 0 && (
        <div className="border-t border-current/10 px-3 py-2 space-y-1.5">
          {others.map(o => (
            <div key={o.id} className="flex items-center gap-2 text-[11px]">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${o.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
              <span className="font-semibold">{o.title}</span>
              <span className="opacity-70 truncate flex-1">— {o.hint}</span>
              <button onClick={() => dismiss(o.id)} className="opacity-60 hover:opacity-100 shrink-0" title="Dismiss">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
