// Sección IG Sync — Renovador diario de creative desde el último post de IG.
//
// Problema que resuelve:
//   Cuando corrés una campaña de interacción con un post específico de IG,
//   cada vez que subís un nuevo post al feed querés que el ad use ese post
//   en lugar del anterior — sin tener que entrar manualmente a Ads Manager
//   todos los días a duplicar el ad set, cambiar el creative y pausar el
//   viejo.
//
// Cómo funciona:
//   1. El user elige en esta pantalla: cuenta publicitaria + campaña (de
//      tipo interacción) + cuenta de Instagram Business.
//   2. Guardamos la config en localStorage para poder correr pruebas manuales.
//   3. Para que corra automáticamente todos los días, hay que pegar el JSON
//      que generamos en la env var IG_SYNC_CONFIG de Vercel (Settings →
//      Environment Variables) y redeployar. La UI muestra el botón "Copiar
//      config JSON" para eso.
//   4. El cron (vercel.json → /api/ig-sync/cron a las 12:00 UTC) dispara la
//      lógica: compara el último post de IG vs los ads activos. Si coincide,
//      no hace nada. Si no coincide, duplica el ad set activo, crea un ad
//      con el nuevo post y pausa el ad set viejo.
//
// Botones en la UI:
//   - "Verificar (dry-run)" → llama /check, muestra qué haría sin ejecutar.
//   - "Ejecutar ahora" → llama /run, ejecuta con confirmación previa.

import React, { useState, useEffect } from 'react';
import {
  Instagram, Zap, Check, AlertTriangle, Loader2, RefreshCw, Play, Copy, ChevronRight,
  Clock, Target, ExternalLink, Pause,
} from 'lucide-react';

const CONFIG_KEY = 'viora-ig-sync-config-v1';
const HISTORY_KEY = 'viora-ig-sync-history-v1';
const HISTORY_CAP = 20;

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function pushHistory(entry) {
  const h = [{ ...entry, ts: new Date().toISOString() }, ...loadHistory()].slice(0, HISTORY_CAP);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
  return h;
}

export default function IGSyncSection({ addToast }) {
  const [config, setConfig] = useState(() => loadConfig());
  const [adAccounts, setAdAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [igAccounts, setIgAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingIg, setLoadingIg] = useState(false);
  const [busyAction, setBusyAction] = useState(null); // 'check' | 'run' | null
  const [lastPlan, setLastPlan] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [metaConnected, setMetaConnected] = useState(null);

  useEffect(() => { saveConfig(config); }, [config]);

  // Chequeamos el estado de Meta + cargamos accounts al montar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetch('/api/meta/me').then(r => r.json()).catch(() => null);
        if (cancelled) return;
        setMetaConnected(!!me?.connected);
        if (me?.connected) {
          loadAdAccounts();
          loadIgAccounts();
        }
      } catch {
        if (!cancelled) setMetaConnected(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cuando se elige ad account, traer sus campañas.
  useEffect(() => {
    if (config.adAccountId) loadCampaigns(config.adAccountId);
    else setCampaigns([]);
  }, [config.adAccountId]);

  async function loadAdAccounts() {
    setLoadingAccounts(true);
    try {
      const r = await fetch('/api/meta/ad-accounts');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'error');
      setAdAccounts(d.accounts || []);
    } catch (err) {
      addToast?.(`No pude listar ad accounts: ${err.message}`, 'error');
    } finally { setLoadingAccounts(false); }
  }

  async function loadCampaigns(adAccountId) {
    setLoadingCampaigns(true);
    try {
      const r = await fetch(`/api/ig-sync/campaigns?ad_account_id=${encodeURIComponent(adAccountId)}&objective=engagement`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'error');
      setCampaigns(d.campaigns || []);
    } catch (err) {
      addToast?.(`No pude listar campañas: ${err.message}`, 'error');
    } finally { setLoadingCampaigns(false); }
  }

  async function loadIgAccounts() {
    setLoadingIg(true);
    try {
      const r = await fetch('/api/ig-sync/ig-accounts');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'error');
      setIgAccounts(d.accounts || []);
    } catch (err) {
      addToast?.(`No pude listar cuentas de Instagram: ${err.message}`, 'error');
    } finally { setLoadingIg(false); }
  }

  const configComplete = !!(config.adAccountId && config.campaignId && config.igUserId && config.pageId);

  async function handleCheck() {
    if (!configComplete) return;
    setBusyAction('check');
    setLastPlan(null);
    try {
      const r = await fetch('/api/ig-sync/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adAccountId: config.adAccountId,
          campaignId: config.campaignId,
          igUserId: config.igUserId,
          pageId: config.pageId,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'error');
      setLastPlan(d.plan);
    } catch (err) {
      addToast?.(`Dry-run falló: ${err.message}`, 'error');
    } finally { setBusyAction(null); }
  }

  async function handleRun() {
    if (!configComplete) return;
    if (!confirm('Esto va a duplicar el ad set activo, crear un ad con el último post de IG y pausar el ad set viejo. ¿Seguimos?')) return;
    setBusyAction('run');
    try {
      const r = await fetch('/api/ig-sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adAccountId: config.adAccountId,
          campaignId: config.campaignId,
          igUserId: config.igUserId,
          pageId: config.pageId,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        addToast?.(d.error || 'Run falló', 'error');
        setHistory(pushHistory({ status: 'failed', error: d.error, plan: d.plan || null }));
        return;
      }
      if (d.skipped) {
        addToast?.(d.plan?.reason || 'Nada que hacer', 'info');
        setHistory(pushHistory({ status: 'skipped', plan: d.plan }));
        setLastPlan(d.plan);
      } else {
        addToast?.('Ad renovado correctamente', 'success');
        setHistory(pushHistory({ status: 'done', plan: d.plan, results: d.results }));
        setLastPlan(d.plan);
      }
    } catch (err) {
      addToast?.(`Run falló: ${err.message}`, 'error');
    } finally { setBusyAction(null); }
  }

  function copyEnvJson() {
    if (!configComplete) return;
    const json = JSON.stringify({
      adAccountId: config.adAccountId,
      campaignId: config.campaignId,
      igUserId: config.igUserId,
      pageId: config.pageId,
      enabled: true,
    });
    navigator.clipboard.writeText(json).then(() => {
      addToast?.('JSON copiado — pegalo en IG_SYNC_CONFIG en Vercel', 'success');
    }).catch(() => addToast?.('No pude copiar al portapapeles', 'error'));
  }

  // ====================================================================
  // RENDER
  // ====================================================================

  if (metaConnected === false) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/40 p-6">
          <div className="flex gap-3">
            <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0" size={22} />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-100">Meta no está conectado</p>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                Conectate desde el banner de arriba de Marketing para habilitar esta sección.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white shadow-sm">
          <Instagram size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Renovador IG diario</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Mantiene tu campaña de interacción corriendo con el último post de Instagram — sin tocar Ads Manager.
          </p>
        </div>
      </div>

      {/* Explicación rápida */}
      <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/50 p-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-semibold">Qué hace todos los días:</span> mira el último post de tu IG,
          chequea si ya está publicado como anuncio en la campaña elegida y, si no, duplica el ad set
          activo cambiando el creative por el post nuevo + pausa el viejo.
        </p>
      </div>

      {/* CARD 1 — Ad Account */}
      <StepCard
        n={1}
        title="Cuenta publicitaria"
        done={!!config.adAccountId}
      >
        {loadingAccounts ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Cargando…</div>
        ) : adAccounts.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            No encontré ad accounts activas en tu cuenta de Meta.
            <button onClick={loadAdAccounts} className="ml-2 text-blue-600 dark:text-blue-400 underline">Reintentar</button>
          </div>
        ) : (
          <select
            value={config.adAccountId || ''}
            onChange={(e) => setConfig({ ...config, adAccountId: e.target.value, campaignId: '' })}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">— Elegí una —</option>
            {adAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name} · {a.currency} {a.business ? `· ${a.business}` : ''}</option>
            ))}
          </select>
        )}
      </StepCard>

      {/* CARD 2 — Campaña */}
      <StepCard
        n={2}
        title="Campaña de interacción"
        done={!!config.campaignId}
        disabled={!config.adAccountId}
      >
        {!config.adAccountId ? (
          <div className="text-sm text-gray-400 dark:text-gray-500">Primero elegí la cuenta.</div>
        ) : loadingCampaigns ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Cargando…</div>
        ) : campaigns.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            No encontré campañas de interacción en esta cuenta. Creá una en Ads Manager primero.
            <button onClick={() => loadCampaigns(config.adAccountId)} className="ml-2 text-blue-600 dark:text-blue-400 underline">Reintentar</button>
          </div>
        ) : (
          <select
            value={config.campaignId || ''}
            onChange={(e) => setConfig({ ...config, campaignId: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">— Elegí una —</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name} · {c.objective} · {c.effectiveStatus}</option>
            ))}
          </select>
        )}
      </StepCard>

      {/* CARD 3 — Instagram Business */}
      <StepCard
        n={3}
        title="Cuenta de Instagram"
        done={!!config.igUserId}
      >
        {loadingIg ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Cargando…</div>
        ) : igAccounts.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            No encontré Instagram business accounts vinculadas a tus Pages.
            Asegurate de que tu IG esté convertido a business y linkeado a una Page del Business Manager.
            <button onClick={loadIgAccounts} className="ml-2 text-blue-600 dark:text-blue-400 underline">Reintentar</button>
          </div>
        ) : (
          <select
            value={config.igUserId || ''}
            onChange={(e) => {
              const chosen = igAccounts.find(a => a.igUserId === e.target.value);
              setConfig({
                ...config,
                igUserId: chosen?.igUserId || '',
                pageId: chosen?.pageId || '',
              });
            }}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">— Elegí una —</option>
            {igAccounts.map(a => (
              <option key={a.igUserId} value={a.igUserId}>@{a.username || a.igUserId} · Page: {a.pageName}</option>
            ))}
          </select>
        )}
      </StepCard>

      {/* Acciones */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-5 space-y-4">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleCheck}
            disabled={!configComplete || busyAction !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {busyAction === 'check' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Verificar (dry-run)
          </button>
          <button
            onClick={handleRun}
            disabled={!configComplete || busyAction !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {busyAction === 'run' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Ejecutar ahora
          </button>
          <button
            onClick={copyEnvJson}
            disabled={!configComplete}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/40 disabled:opacity-40"
            title="Copiar JSON para pegar en IG_SYNC_CONFIG en Vercel"
          >
            <Copy size={16} />
            Copiar config JSON
          </button>
        </div>

        {/* Último plan */}
        {lastPlan && <PlanView plan={lastPlan} />}

        {/* Historial de corridas manuales */}
        {history.length > 0 && (
          <div>
            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Historial reciente</div>
            <div className="space-y-1">
              {history.slice(0, 8).map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <span className={
                    h.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' :
                    h.status === 'skipped' ? 'text-gray-500' :
                    'text-rose-600 dark:text-rose-400'
                  }>
                    {h.status === 'done' ? '✅' : h.status === 'skipped' ? '⏭' : '❌'}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums">{new Date(h.ts).toLocaleString('es-AR')}</span>
                  <span>{h.status === 'done' ? `Ad renovado (${h.results?.newAdId || '—'})` : h.status === 'skipped' ? h.plan?.reason : (h.error || 'Falló')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Info: cómo activar el cron */}
      <details className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-100">¿Cómo lo dejo corriendo automático todos los días?</summary>
        <div className="mt-3 space-y-2 text-gray-700 dark:text-gray-300">
          <p>El cron corre server-side, no ve tu navegador. Pasos:</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Armá la config eligiendo las 3 cosas arriba y tocá "Copiar config JSON".</li>
            <li>Andá a Vercel → tu proyecto → Settings → Environment Variables.</li>
            <li>Agregá <code className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">IG_SYNC_CONFIG</code> con el JSON copiado.</li>
            <li>Agregá <code className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">META_SYSTEM_ACCESS_TOKEN</code> con un long-lived token (idealmente de un System User del Business Manager — no expira).</li>
            <li>Redeployá (push vacío o "Redeploy" en el dashboard).</li>
          </ol>
          <p className="text-xs text-gray-500 dark:text-gray-400">El cron está configurado en <code>vercel.json</code> para correr a las 12:00 UTC (09:00 Argentina).</p>
        </div>
      </details>
    </div>
  );
}

function StepCard({ n, title, done, disabled, children }) {
  return (
    <div className={`rounded-xl border p-5 ${
      disabled ? 'border-gray-200 dark:border-gray-800 opacity-60' :
      done ? 'border-emerald-300 dark:border-emerald-700/50 bg-emerald-50/40 dark:bg-emerald-900/10' :
      'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40'
    }`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          done ? 'bg-emerald-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
        }`}>
          {done ? <Check size={14} /> : n}
        </div>
        <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{title}</div>
      </div>
      {children}
    </div>
  );
}

function PlanView({ plan }) {
  if (plan.action === 'skip') {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3 text-sm">
        <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
          <Check size={16} className="text-emerald-500" />
          No hay que hacer nada
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{plan.reason}</div>
        {plan.latest && (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-500">
            Último post: <a href={plan.latest.permalink} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">ver en IG <ExternalLink size={10} /></a>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-purple-300 dark:border-purple-800/50 bg-purple-50/60 dark:bg-purple-900/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold text-purple-900 dark:text-purple-100">
        <Zap size={16} />
        Renovar creative
      </div>
      <ul className="mt-2 space-y-1 text-xs text-gray-700 dark:text-gray-300">
        <li className="flex items-center gap-2"><ChevronRight size={12} /> Clonar ad set <span className="font-mono text-gray-500">{plan.source.adsetName}</span></li>
        <li className="flex items-center gap-2"><ChevronRight size={12} /> Crear ad con el post <a href={plan.latest.permalink} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">{plan.latest.id} <ExternalLink size={10} /></a></li>
        <li className="flex items-center gap-2"><Pause size={12} /> Pausar ad set viejo <span className="font-mono text-gray-500">{plan.source.adsetName}</span></li>
      </ul>
    </div>
  );
}
