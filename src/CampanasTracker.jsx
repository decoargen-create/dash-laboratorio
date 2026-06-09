// Campañas — tracker simple de cuentas publicitarias de Meta.
//
// Objetivo: conectar CUALQUIER cuenta publicitaria (propia o de otra persona)
// y trackear sus campañas con métricas, sin depender del flujo OAuth (que
// requiere una app de Meta Developer con App Review).
//
// Flujo:
//   1. Si no hay conexión → form para pegar un Access Token de Meta. El token
//      determina a qué cuentas se puede acceder. Se valida contra Graph /me y
//      se guarda en una cookie HttpOnly firmada (server-side).
//   2. Conectado → selector de cuenta (dropdown de las cuentas accesibles +
//      entrada manual de un act_XXXX para cuentas compartidas vía Business
//      Manager) + selector de período.
//   3. Tabla de campañas con gasto, CTR, CPM, ROAS, compras, CPA y estado.
//
// Para conectar la cuenta de OTRA persona hay dos caminos:
//   a) Esa persona te comparte su cuenta publicitaria con tu Business Manager
//      (Configuración del negocio → Socios / Cuentas publicitarias) y usás un
//      token de System User de tu BM — un solo token ve todas las cuentas.
//   b) Esa persona genera un token con acceso a su cuenta y te lo pasa; lo
//      pegás acá. Para cambiar de cuenta, desconectás y pegás otro token.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, Check, Loader2, LogOut, AlertCircle, RefreshCw, ExternalLink,
  TrendingUp, KeyRound, ChevronDown, Search,
} from 'lucide-react';

const TOKEN_HELP_URL = 'https://developers.facebook.com/tools/explorer/';
const LS_ACCOUNT = 'adslab-campanas-account-id';
const LS_PRESET = 'adslab-campanas-date-preset';

const PRESETS = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'last_7d', label: 'Últimos 7 días' },
  { value: 'last_14d', label: 'Últimos 14 días' },
  { value: 'last_30d', label: 'Últimos 30 días' },
  { value: 'this_month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes pasado' },
  { value: 'maximum', label: 'Histórico' },
];

// --- helpers de formato ---

function fmtMoney(n, currency) {
  if (n == null) return '—';
  const v = Number(n);
  const formatted = v >= 1000 ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : v.toFixed(v < 100 ? 2 : 0);
  return currency ? `${formatted} ${currency}` : `$${formatted}`;
}

function fmtNum(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

const STATUS_BADGES = {
  ACTIVE: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  PAUSED: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  WITH_ISSUES: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  PENDING_REVIEW: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  DISAPPROVED: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  IN_PROCESS: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
};

function StatusBadge({ status }) {
  const cls = STATUS_BADGES[status] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
  const label = { ACTIVE: 'Activa', PAUSED: 'Pausada', WITH_ISSUES: 'Con problemas', PENDING_REVIEW: 'En revisión', DISAPPROVED: 'Rechazada', IN_PROCESS: 'Procesando' }[status] || status;
  return <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${cls}`}>{label}</span>;
}

// ========================================================================
// Form de conexión por token
// ========================================================================
function ConnectTokenForm({ onConnected, addToast }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    const t = token.trim();
    if (!t) { setError('Pegá un access token.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/meta/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: t }),
      });
      const d = await r.json();
      if (!r.ok || !d.connected) throw new Error(d.error || 'No se pudo conectar.');
      setToken('');
      addToast?.({ type: 'success', message: `Conectado a Meta como ${d.user?.name || d.user?.id}` });
      onConnected?.(d.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-[#E7F3FF] to-white dark:from-brand-900/20 dark:to-gray-800/60 border border-[#1877F2]/20 dark:border-brand-800 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0668E1] to-[#1877F2] flex items-center justify-center text-white shadow-sm shrink-0">
          <KeyRound size={20} />
        </div>
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Conectar cuenta publicitaria</h3>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Pegá un Access Token de Meta. Sirve para tu cuenta o la de cualquier persona que te dé acceso.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wider">
            Access Token
          </label>
          <textarea
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="EAAB..."
            rows={3}
            spellCheck={false}
            className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none break-all"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
            <AlertCircle size={15} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-300 break-words">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-lg hover:from-[#0556BE] hover:to-[#1668D8] shadow-sm transition disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
          Conectar
        </button>
      </form>

      <div className="mt-4 p-3 bg-white/70 dark:bg-gray-900/40 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">¿De dónde saco el token?</p>
        <ul className="text-[11px] text-gray-600 dark:text-gray-400 space-y-1 list-disc pl-4">
          <li>
            <strong>Cuenta de otra persona:</strong> que te comparta su cuenta publicitaria con tu Business Manager
            (Configuración del negocio → Cuentas publicitarias → Agregar socio) y usá un token de <em>System User</em> de tu BM:
            ese token ve todas las cuentas compartidas.
          </li>
          <li>
            <strong>Rápido / prueba:</strong> generá uno en el{' '}
            <a href={TOKEN_HELP_URL} target="_blank" rel="noreferrer" className="text-brand-600 dark:text-brand-400 font-semibold inline-flex items-center gap-0.5">
              Graph API Explorer <ExternalLink size={10} />
            </a>{' '}
            con permisos <code className="font-mono">ads_read</code> y <code className="font-mono">ads_management</code>.
          </li>
        </ul>
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-2">
          El token se guarda en una cookie HttpOnly del servidor (no accesible por JavaScript).
        </p>
      </div>
    </div>
  );
}

// ========================================================================
// Tabla de campañas
// ========================================================================
function CampaignsTable({ data, currency }) {
  const campaigns = data?.campaigns || [];
  const totals = data?.totals || null;

  if (campaigns.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
        <TrendingUp size={28} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin campañas en este período</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Probá con otro período o verificá que la cuenta tenga campañas activas.
        </p>
      </div>
    );
  }

  const ctrTone = (v) => (v >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : v >= 0.8 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400');
  const roasTone = (v) => (v >= 2 ? 'text-emerald-600 dark:text-emerald-400' : v >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400');

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 text-[10px] uppercase tracking-wider">
              <th className="text-left font-bold px-3 py-2.5 sticky left-0 bg-gray-50 dark:bg-gray-900/50">Campaña</th>
              <th className="text-left font-bold px-2 py-2.5">Estado</th>
              <th className="text-right font-bold px-2 py-2.5">Gasto</th>
              <th className="text-right font-bold px-2 py-2.5">Impr.</th>
              <th className="text-right font-bold px-2 py-2.5">CTR</th>
              <th className="text-right font-bold px-2 py-2.5">CPM</th>
              <th className="text-right font-bold px-2 py-2.5">Compras</th>
              <th className="text-right font-bold px-2 py-2.5">ROAS</th>
              <th className="text-right font-bold px-2 py-2.5">CPA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {campaigns.map(c => {
              const i = c.insights || {};
              const fbUrl = `https://business.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${c.id}`;
              return (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition">
                  <td className="px-3 py-2.5 sticky left-0 bg-white dark:bg-gray-800 max-w-[260px]">
                    <div className="flex items-center gap-1.5">
                      <a href={fbUrl} target="_blank" rel="noreferrer"
                        className="font-semibold text-gray-900 dark:text-gray-100 truncate hover:text-brand-600 dark:hover:text-brand-400"
                        title={c.name}>
                        {c.name || '(sin nombre)'}
                      </a>
                      <ExternalLink size={10} className="text-gray-400 shrink-0" />
                    </div>
                    {c.objective && (
                      <p className="text-[9px] text-gray-400 truncate">{c.objective}</p>
                    )}
                  </td>
                  <td className="px-2 py-2.5"><StatusBadge status={c.effectiveStatus || c.status} /></td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fmtMoney(i.spend, currency)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtNum(i.impressions)}</td>
                  <td className={`px-2 py-2.5 text-right tabular-nums font-semibold ${ctrTone(i.ctr || 0)}`}>{(i.ctr || 0).toFixed(2)}%</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMoney(i.cpm, currency)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{i.purchases || 0}</td>
                  <td className={`px-2 py-2.5 text-right tabular-nums font-semibold ${roasTone(i.roas || 0)}`}>{(i.roas || 0).toFixed(2)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{i.cpa ? fmtMoney(i.cpa, currency) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="bg-gray-50 dark:bg-gray-900/50 font-bold text-gray-900 dark:text-gray-100 border-t-2 border-gray-200 dark:border-gray-700">
                <td className="px-3 py-2.5 sticky left-0 bg-gray-50 dark:bg-gray-900/50">Total ({campaigns.length})</td>
                <td className="px-2 py-2.5" />
                <td className="px-2 py-2.5 text-right tabular-nums">{fmtMoney(totals.spend, currency)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmtNum(totals.impressions)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{(totals.ctr || 0).toFixed(2)}%</td>
                <td className="px-2 py-2.5 text-right tabular-nums">—</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{totals.purchases || 0}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{(totals.roas || 0).toFixed(2)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{totals.cpa ? fmtMoney(totals.cpa, currency) : '—'}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ========================================================================
// Componente principal
// ========================================================================
export default function CampanasTracker({ addToast }) {
  const [conn, setConn] = useState({ loading: true, connected: false, user: null });

  // Cuentas + selección
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(() => {
    try { return localStorage.getItem(LS_ACCOUNT) || ''; } catch { return ''; }
  });
  const [manualId, setManualId] = useState('');
  const [useManual, setUseManual] = useState(false);

  const [preset, setPreset] = useState(() => {
    try { return localStorage.getItem(LS_PRESET) || 'last_7d'; } catch { return 'last_7d'; }
  });

  // Campañas
  const [campaignsData, setCampaignsData] = useState(null);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState(null);

  // Moneda de la cuenta seleccionada (para formatear montos).
  const currentAccountObj = accounts.find(a => a.id === selectedAccount) || null;
  const currency = currentAccountObj?.currency || null;

  const checkConnection = useCallback(async () => {
    try {
      const r = await fetch('/api/meta/me');
      const d = await r.json();
      setConn({ loading: false, connected: !!d.connected, user: d.user || null });
    } catch {
      setConn({ loading: false, connected: false, user: null });
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const r = await fetch('/api/meta/ad-accounts');
      const d = await r.json();
      if (r.ok && Array.isArray(d.accounts)) {
        setAccounts(d.accounts);
        // Si no hay cuenta elegida y hay alguna, no auto-seleccionamos
        // (dejamos que el user elija) salvo que la guardada exista.
      } else if (!r.ok) {
        addToast?.({ type: 'error', message: d.error || 'No pude listar las cuentas.' });
      }
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setAccountsLoading(false);
    }
  }, [addToast]);

  const loadCampaigns = useCallback(async (accountId, datePreset) => {
    if (!accountId) return;
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const url = `/api/meta/campaigns-insights?account_id=${encodeURIComponent(accountId)}&date_preset=${encodeURIComponent(datePreset)}`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setCampaignsData(d);
    } catch (err) {
      setCampaignsError(err.message);
      setCampaignsData(null);
    } finally {
      setCampaignsLoading(false);
    }
  }, []);

  // Mount: chequear conexión.
  useEffect(() => { checkConnection(); }, [checkConnection]);

  // Cuando se confirma conexión, traer cuentas.
  useEffect(() => {
    if (conn.connected) loadAccounts();
  }, [conn.connected, loadAccounts]);

  // Persistir selección + período.
  useEffect(() => {
    try {
      if (selectedAccount) localStorage.setItem(LS_ACCOUNT, selectedAccount);
    } catch {}
  }, [selectedAccount]);
  useEffect(() => {
    try { localStorage.setItem(LS_PRESET, preset); } catch {}
  }, [preset]);

  // Auto-cargar campañas cuando hay cuenta + período.
  useEffect(() => {
    if (conn.connected && selectedAccount) loadCampaigns(selectedAccount, preset);
  }, [conn.connected, selectedAccount, preset, loadCampaigns]);

  const handleDisconnect = async () => {
    if (!window.confirm('¿Desconectar la cuenta de Meta? Vas a tener que volver a pegar un token.')) return;
    try {
      await fetch('/api/meta/disconnect', { method: 'POST' });
    } finally {
      setConn({ loading: false, connected: false, user: null });
      setAccounts([]);
      setCampaignsData(null);
      setSelectedAccount('');
    }
  };

  const applyManualId = () => {
    const id = manualId.trim();
    if (!id) return;
    const normalized = id.startsWith('act_') ? id : `act_${id.replace(/\D/g, '')}`;
    setSelectedAccount(normalized);
  };

  // ---- Header ----
  const header = (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-400 flex items-center justify-center text-white shadow-sm shrink-0">
        <TrendingUp size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Campañas</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Conectá una cuenta publicitaria y trackeá sus campañas con métricas reales.
        </p>
      </div>
    </div>
  );

  if (conn.loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-5">
        {header}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Verificando conexión con Meta…</span>
        </div>
      </div>
    );
  }

  if (!conn.connected) {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        {header}
        <ConnectTokenForm onConnected={() => checkConnection()} addToast={addToast} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {header}

      {/* Barra de conexión */}
      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs text-emerald-800 dark:text-emerald-200">
          Conectado como <span className="font-semibold">{conn.user?.name || conn.user?.id}</span>
        </span>
        <button
          onClick={handleDisconnect}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:hover:bg-red-900/20 transition"
        >
          <LogOut size={12} /> Desconectar
        </button>
      </div>

      {/* Controles: cuenta + período */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        {!useManual ? (
          <div className="relative flex-1 min-w-[220px]">
            <select
              value={selectedAccount}
              onChange={e => setSelectedAccount(e.target.value)}
              className="w-full pl-3 pr-8 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md appearance-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">{accountsLoading ? 'Cargando cuentas…' : '— Elegí una cuenta publicitaria —'}</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.accountId} {a.currency ? `(${a.currency})` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        ) : (
          <div className="flex-1 min-w-[220px] flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={manualId}
                onChange={e => setManualId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyManualId(); }}
                placeholder="act_1234567890 o 1234567890"
                className="w-full pl-3 pr-2 py-2 text-xs font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button onClick={applyManualId}
              className="px-3 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md transition">
              Cargar
            </button>
          </div>
        )}

        <button
          onClick={() => setUseManual(v => !v)}
          className="px-2.5 py-2 text-[11px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition"
          title="Cambiar entre dropdown y entrada manual del ID de cuenta"
        >
          {useManual ? 'Elegir de la lista' : 'Ingresar ID manual'}
        </button>

        <select
          value={preset}
          onChange={e => setPreset(e.target.value)}
          className="px-2.5 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        <button
          onClick={() => selectedAccount && loadCampaigns(selectedAccount, preset)}
          disabled={!selectedAccount || campaignsLoading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50"
          title="Refrescar"
        >
          <RefreshCw size={13} className={campaignsLoading ? 'animate-spin' : ''} /> Refrescar
        </button>
      </div>

      {/* Resultado */}
      {!selectedAccount ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
          <Search size={26} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Elegí una cuenta para empezar</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {accounts.length === 0 && !accountsLoading
              ? 'El token no listó cuentas en «me/adaccounts». Probá «Ingresar ID manual» con el act_ de la cuenta compartida.'
              : 'Seleccioná una cuenta del dropdown y elegí el período.'}
          </p>
        </div>
      ) : campaignsError ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">No pude cargar las campañas</p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-0.5 break-words">{campaignsError}</p>
          </div>
        </div>
      ) : campaignsLoading && !campaignsData ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Cargando campañas…</span>
        </div>
      ) : (
        <CampaignsTable data={campaignsData} currency={currency} />
      )}
    </div>
  );
}
