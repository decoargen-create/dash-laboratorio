// Panel de "Automatización de renovación de creativos" dentro de Meta Ads.
// Portea el flujo del prompt de Cowork a server-side (via /api/meta/*):
//
//   1. User conecta Meta (si no lo hizo).
//   2. Elige IG Business Account + Campaña + Conjunto base + Umbral + Posts
//      fijados + Webhook Discord (opcional).
//   3. "Previsualizar" (dry-run) → detecta el último post IG, cuenta likes
//      por conjunto activo, loggea lo que haría sin mutar.
//   4. "Ejecutar ahora" → duplica el conjunto base, le mete el nuevo post
//      como creativo ("publicación existente"), activa, pausa los viejos
//      con likes ≥ umbral si queda al menos uno activo.
//
// Estado por producto en localStorage bajo `viora-creative-refresh-<prodId>`:
//   {
//     config: { igId, pageId, campaignId, baseAdsetId, threshold, pinnedPosts, webhookUrl },
//     state:  { lastPostId, activeAdsets: [{adsetId, postId, postPermalink, createdAt}], history }
//   }

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Loader2, Play, Zap, ExternalLink, Clock, CheckCircle2, XCircle,
  RefreshCw, Pause, AlertTriangle, Heart, Instagram,
} from 'lucide-react';

const STATE_PREFIX = 'viora-creative-refresh-';

function loadPersisted(productoId) {
  try {
    const raw = localStorage.getItem(STATE_PREFIX + productoId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function savePersisted(productoId, payload) {
  try { localStorage.setItem(STATE_PREFIX + productoId, JSON.stringify(payload)); } catch {}
}

const DEFAULT_CONFIG = {
  igId: '',
  pageId: '',
  campaignId: '',
  baseAdsetId: '',
  threshold: 50,
  pinnedPosts: 0,
  webhookUrl: '',
};

const DEFAULT_STATE = {
  lastPostId: null,
  lastRunAt: null,
  activeAdsets: [],
  history: [],
};

export default function CreativeRefreshPanel({ producto, addToast }) {
  const productoId = String(producto?.id || '');
  const accountId = producto?.metaAccount?.id || null; // incluye prefijo act_

  const persisted = useMemo(() => loadPersisted(productoId) || {}, [productoId]);
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG, ...(persisted.config || {}) });
  const [runtimeState, setRuntimeState] = useState({ ...DEFAULT_STATE, ...(persisted.state || {}) });

  // --- Conexión Meta ---
  const [metaConn, setMetaConn] = useState({ loading: true, connected: false });
  const [igAccounts, setIgAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [adsets, setAdsets] = useState([]);
  const [loadingIg, setLoadingIg] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdsets, setLoadingAdsets] = useState(false);

  // --- Ejecución ---
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  // Persistimos config/state cada vez que cambian.
  useEffect(() => {
    savePersisted(productoId, { config, state: runtimeState });
  }, [productoId, config, runtimeState]);

  // Verificamos conexión Meta.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/meta/me');
        const d = await r.json();
        if (alive) setMetaConn({ loading: false, connected: !!d.connected, user: d.user });
      } catch {
        if (alive) setMetaConn({ loading: false, connected: false });
      }
    })();
    return () => { alive = false; };
  }, []);

  // Cargamos IG accounts + campañas cuando Meta está conectado y hay accountId.
  const loadIgAccounts = useCallback(async () => {
    setLoadingIg(true);
    try {
      const r = await fetch('/api/meta/ig-accounts');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error cargando IG');
      setIgAccounts(d.accounts || []);
    } catch (err) {
      addToast?.({ type: 'error', message: `IG: ${err.message}` });
    } finally { setLoadingIg(false); }
  }, [addToast]);

  const loadCampaigns = useCallback(async () => {
    if (!accountId) return;
    setLoadingCampaigns(true);
    try {
      const r = await fetch(`/api/meta/campaigns?account_id=${encodeURIComponent(accountId)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error cargando campañas');
      setCampaigns(d.campaigns || []);
    } catch (err) {
      addToast?.({ type: 'error', message: `Campañas: ${err.message}` });
    } finally { setLoadingCampaigns(false); }
  }, [accountId, addToast]);

  const loadAdsets = useCallback(async (campaignId) => {
    if (!campaignId) { setAdsets([]); return; }
    setLoadingAdsets(true);
    try {
      const r = await fetch(`/api/meta/campaign-adsets?campaign_id=${encodeURIComponent(campaignId)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error cargando conjuntos');
      setAdsets(d.adsets || []);
    } catch (err) {
      addToast?.({ type: 'error', message: `Conjuntos: ${err.message}` });
    } finally { setLoadingAdsets(false); }
  }, [addToast]);

  useEffect(() => {
    if (metaConn.connected) {
      loadIgAccounts();
      loadCampaigns();
    }
  }, [metaConn.connected, loadIgAccounts, loadCampaigns]);

  useEffect(() => {
    if (config.campaignId) loadAdsets(config.campaignId);
  }, [config.campaignId, loadAdsets]);

  // --- Helpers ---
  const selectedIg = igAccounts.find(a => a.igId === config.igId) || null;
  const selectedCampaign = campaigns.find(c => c.id === config.campaignId) || null;
  const selectedAdset = adsets.find(a => a.id === config.baseAdsetId) || null;

  // Auto-autocompletar pageId cuando cambia igId.
  useEffect(() => {
    if (config.igId && selectedIg && selectedIg.pageId !== config.pageId) {
      setConfig(c => ({ ...c, pageId: selectedIg.pageId }));
    }
  }, [config.igId, selectedIg]); // eslint-disable-line react-hooks/exhaustive-deps

  const canRun = config.igId && config.pageId && config.campaignId && config.baseAdsetId && !running;

  const run = async ({ dryRun }) => {
    if (!canRun) return;
    setRunning(true);
    setLastResult(null);
    try {
      const r = await fetch('/api/meta/run-creative-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          campaignId: config.campaignId,
          baseAdsetId: config.baseAdsetId,
          igId: config.igId,
          pageId: config.pageId,
          threshold: Number(config.threshold) || 50,
          pinnedPosts: Number(config.pinnedPosts) || 0,
          webhookUrl: config.webhookUrl?.trim() || null,
          state: runtimeState,
          dryRun: !!dryRun,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setLastResult({ error: data.error || `HTTP ${r.status}`, log: data.log || [] });
        addToast?.({ type: 'error', message: `Falló: ${data.error || r.status}` });
      } else {
        setLastResult(data);
        if (!dryRun && data.newState) setRuntimeState(data.newState);
        addToast?.({ type: 'success', message: dryRun ? 'Preview listo' : `Acción: ${data.action}` });
        // Si se creó un adset, refrescamos la lista.
        if (!dryRun && data.created) loadAdsets(config.campaignId);
      }
    } catch (err) {
      setLastResult({ error: err.message });
      addToast?.({ type: 'error', message: err.message });
    } finally { setRunning(false); }
  };

  const resetState = () => {
    if (!confirm('¿Borrar el estado persistido (última publicación vista, conjuntos activos, historial)? La config se mantiene.')) return;
    setRuntimeState(DEFAULT_STATE);
    setLastResult(null);
    addToast?.({ type: 'success', message: 'Estado reseteado' });
  };

  // ====================================================================
  // RENDER
  // ====================================================================
  if (!accountId) {
    return (
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin cuenta Meta conectada al producto</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Conectá la cuenta publicitaria desde Arranque (paso 2) y volvé acá.
        </p>
      </div>
    );
  }

  if (metaConn.loading) {
    return (
      <div className="p-8 text-center">
        <Loader2 size={20} className="animate-spin mx-auto text-gray-400" />
      </div>
    );
  }

  if (!metaConn.connected) {
    return (
      <div className="border-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-5">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Conectate a Meta para usar la automatización</p>
        <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 mb-3">
          Necesitamos los scopes <code className="font-mono">ads_management</code>, <code className="font-mono">instagram_basic</code>,{' '}
          <code className="font-mono">pages_read_engagement</code>. Si ya estabas conectado, reconectá para aceptar los nuevos permisos.
        </p>
        <a
          href="/api/meta/connect?returnTo=/acceso"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-md shadow-sm"
        >
          <Zap size={12} /> Conectar / Reconectar Meta
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Encabezado explicativo */}
      <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <RefreshCw size={14} className="text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Renovación automática de creativos</h3>
        </div>
        <p className="text-[11px] text-gray-700 dark:text-gray-300 leading-snug">
          Detectamos cuando publicás un post nuevo en Instagram, duplicamos el conjunto base en Meta Ads,
          le ponemos el nuevo post como creativo y pausamos los conjuntos viejos que ya llegaron al umbral
          de likes. Nunca dejamos la campaña sin conjuntos activos.
        </p>
      </div>

      {/* Config */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Configuración</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* IG Account */}
          <Field label="Cuenta de Instagram Business">
            <div className="flex gap-1">
              <select
                value={config.igId}
                onChange={e => setConfig(c => ({ ...c, igId: e.target.value }))}
                className="flex-1 px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
              >
                <option value="">{loadingIg ? 'Cargando…' : '— Elegí IG —'}</option>
                {igAccounts.map(a => (
                  <option key={a.igId} value={a.igId}>
                    @{a.igUsername || a.igId} · via {a.pageName}
                  </option>
                ))}
              </select>
              <button onClick={loadIgAccounts} disabled={loadingIg} title="Recargar"
                className="px-2 py-1.5 text-gray-500 hover:text-blue-600 disabled:opacity-40">
                <RefreshCw size={12} className={loadingIg ? 'animate-spin' : ''} />
              </button>
            </div>
          </Field>

          {/* Umbral */}
          <Field label={`Umbral de likes (default 50)`}>
            <input
              type="number" min={1}
              value={config.threshold}
              onChange={e => setConfig(c => ({ ...c, threshold: e.target.value }))}
              className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
            />
          </Field>

          {/* Campaña */}
          <Field label="Campaña">
            <div className="flex gap-1">
              <select
                value={config.campaignId}
                onChange={e => setConfig(c => ({ ...c, campaignId: e.target.value, baseAdsetId: '' }))}
                className="flex-1 px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
              >
                <option value="">{loadingCampaigns ? 'Cargando…' : '— Elegí campaña —'}</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.objective} · {c.effectiveStatus}
                  </option>
                ))}
              </select>
              <button onClick={loadCampaigns} disabled={loadingCampaigns} title="Recargar"
                className="px-2 py-1.5 text-gray-500 hover:text-blue-600 disabled:opacity-40">
                <RefreshCw size={12} className={loadingCampaigns ? 'animate-spin' : ''} />
              </button>
            </div>
          </Field>

          {/* Posts fijados */}
          <Field label="Cantidad de posts fijados (0-10)">
            <input
              type="number" min={0} max={10}
              value={config.pinnedPosts}
              onChange={e => setConfig(c => ({ ...c, pinnedPosts: e.target.value }))}
              className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
            />
          </Field>

          {/* Conjunto base */}
          <Field label="Conjunto base (se duplica cada renovación)">
            <select
              value={config.baseAdsetId}
              onChange={e => setConfig(c => ({ ...c, baseAdsetId: e.target.value }))}
              disabled={!config.campaignId}
              className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded disabled:opacity-40"
            >
              <option value="">
                {!config.campaignId ? 'Elegí campaña primero' : loadingAdsets ? 'Cargando…' : '— Elegí conjunto —'}
              </option>
              {adsets.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.effectiveStatus}
                </option>
              ))}
            </select>
          </Field>

          {/* Webhook */}
          <Field label="Webhook Discord (opcional)">
            <input
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={config.webhookUrl}
              onChange={e => setConfig(c => ({ ...c, webhookUrl: e.target.value }))}
              className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
            />
          </Field>
        </div>

        {/* Info del IG seleccionado */}
        {selectedIg && (
          <div className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 rounded px-2 py-1.5">
            <Instagram size={12} />
            <span>@{selectedIg.igUsername}</span>
            <span className="text-gray-400">·</span>
            <span>Page: {selectedIg.pageName}</span>
            <span className="text-gray-400">·</span>
            <span className="font-mono">IG {selectedIg.igId}</span>
          </div>
        )}

        {/* Botones */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => run({ dryRun: true })}
            disabled={!canRun}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md disabled:opacity-40"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Previsualizar (dry-run)
          </button>
          <button
            onClick={() => run({ dryRun: false })}
            disabled={!canRun}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-br from-blue-600 to-cyan-500 rounded-md shadow-sm hover:from-blue-700 hover:to-cyan-600 disabled:opacity-40"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            Ejecutar ahora
          </button>
          <button onClick={resetState}
            className="ml-auto text-[10px] text-gray-500 hover:text-red-600 underline">
            Resetear estado persistido
          </button>
        </div>
      </div>

      {/* Resultado de la última corrida */}
      {lastResult && <RunResult result={lastResult} />}

      {/* Estado persistido */}
      <PersistedState state={runtimeState} />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">{label}</label>
      {children}
    </div>
  );
}

function RunResult({ result }) {
  if (result.error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <XCircle size={14} className="text-red-600" />
          <h4 className="text-sm font-bold text-red-900 dark:text-red-200">Falló la corrida</h4>
        </div>
        <p className="text-xs text-red-800 dark:text-red-300 font-mono">{result.error}</p>
        {result.log?.length > 0 && <LogView log={result.log} />}
      </div>
    );
  }

  const { action, detectedPost, adsetsChecked = [], created, paused = [], log = [], webhook } = result;
  const actionStyle = action === 'refreshed'
    ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
    : action === 'reviewed'
      ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
      : 'text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700';
  const actionLabel = action === 'refreshed' ? 'Renovado' : action === 'reviewed' ? 'Revisado' : 'Sin cambios';

  return (
    <div className={`border rounded-xl p-4 ${actionStyle}`}>
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 size={14} />
        <h4 className="text-sm font-bold">{actionLabel}</h4>
        {webhook?.sent && (
          <span className="ml-auto text-[10px] opacity-70">Discord: {webhook.status}</span>
        )}
      </div>

      {detectedPost && (
        <div className="mb-3 text-xs">
          <p className="font-semibold mb-1 flex items-center gap-1">
            <Instagram size={11} /> Último post detectado
          </p>
          <p className="italic opacity-80 line-clamp-2">"{detectedPost.caption || '(sin caption)'}"</p>
          <p className="text-[11px] opacity-70 flex items-center gap-2 mt-0.5">
            <Heart size={10} /> {detectedPost.likes}
            <span>·</span>
            <a href={detectedPost.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
              ver post <ExternalLink size={9} />
            </a>
          </p>
        </div>
      )}

      {adsetsChecked.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-bold opacity-70 uppercase mb-1">Engagement por conjunto</p>
          <ul className="space-y-0.5 text-[11px] font-mono">
            {adsetsChecked.map(c => (
              <li key={c.adsetId} className="flex items-center gap-2">
                <span className="opacity-60">{c.adsetId.slice(-10)}</span>
                <Heart size={10} /> {c.likes}
                {c.meetsThreshold && <span className="text-amber-600 font-sans">· supera umbral</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {created && (
        <div className="mb-2 text-[11px] font-mono">
          <CheckCircle2 size={11} className="inline mr-1" />
          Adset nuevo: <strong>{created.adsetId}</strong> · Ad: {created.adId} · Creative: {created.creativeId}
        </div>
      )}

      {paused.length > 0 && (
        <div className="mb-2 text-[11px] font-mono">
          <Pause size={11} className="inline mr-1" />
          Pausados: {paused.join(', ')}
        </div>
      )}

      {log.length > 0 && <LogView log={log} />}
    </div>
  );
}

function LogView({ log }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(o => !o)} className="text-[10px] opacity-60 hover:opacity-100 underline">
        {open ? 'Ocultar' : 'Ver'} log ({log.length})
      </button>
      {open && (
        <pre className="mt-1 p-2 bg-gray-900/80 text-gray-100 rounded text-[10px] leading-tight font-mono max-h-60 overflow-auto whitespace-pre-wrap">
{log.join('\n')}
        </pre>
      )}
    </div>
  );
}

function PersistedState({ state }) {
  const { lastPostId, lastRunAt, activeAdsets = [], history = [] } = state;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={12} className="text-gray-400" />
        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Estado persistido</h4>
        {lastRunAt && (
          <span className="ml-auto text-[10px] text-gray-500">
            Última corrida: {new Date(lastRunAt).toLocaleString('es-AR')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
        <div>
          <p className="font-bold text-gray-600 dark:text-gray-400 mb-1">Último post visto</p>
          <p className="font-mono text-gray-800 dark:text-gray-200">{lastPostId || <span className="opacity-50">ninguno</span>}</p>
        </div>
        <div>
          <p className="font-bold text-gray-600 dark:text-gray-400 mb-1">Conjuntos activos ({activeAdsets.length})</p>
          {activeAdsets.length === 0
            ? <p className="opacity-50">—</p>
            : <ul className="space-y-0.5 font-mono">
                {activeAdsets.map(a => (
                  <li key={a.adsetId} className="truncate">
                    {a.adsetId} <span className="opacity-50">· post {a.postId}</span>
                  </li>
                ))}
              </ul>}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <p className="font-bold text-gray-600 dark:text-gray-400 text-[11px] mb-1">Historial ({history.length})</p>
          <ul className="space-y-1 text-[10px] font-mono max-h-40 overflow-auto">
            {[...history].reverse().map((h, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="opacity-60 shrink-0">{new Date(h.at).toLocaleString('es-AR')}</span>
                <span className="shrink-0">{h.action}</span>
                {h.createdAdsetId && <span className="text-emerald-600">+{h.createdAdsetId.slice(-8)}</span>}
                {h.pausedAdsetIds?.length > 0 && (
                  <span className="text-amber-600">−{h.pausedAdsetIds.map(id => id.slice(-8)).join(',')}</span>
                )}
                {h.detectedPostId && <span className="opacity-60">post {h.detectedPostId.slice(-10)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length === 0 && activeAdsets.length === 0 && (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            Primera vez: el motor todavía no "conoce" los conjuntos activos. Si ya tenés conjuntos corriendo en la
            campaña, corré una vez y en la primera ejecución va a tomar el post actual como referencia sin crear nada nuevo.
          </span>
        </div>
      )}
    </div>
  );
}
