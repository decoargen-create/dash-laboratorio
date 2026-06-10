// Campañas — tracker de cuentas publicitarias de Meta (multi-conexión).
//
// Objetivo: conectar CUALQUIER cuenta publicitaria (propia o de otra persona)
// y trackear sus campañas con métricas, sin depender del flujo OAuth (que
// requiere una app de Meta Developer con App Review).
//
// Modelo de datos:
//   - Con Supabase configurado → cada conexión (un token por cuenta/cliente)
//     se guarda en la tabla meta_connections (token CIFRADO, server-side). Se
//     pueden tener VARIAS conexiones a la vez y switchear entre ellas.
//   - Sin Supabase → fallback a una sola conexión guardada en cookie HttpOnly.
//
// El token NUNCA llega al browser: el backend lo guarda y lo usa para hablar
// con Graph API. El front solo maneja connection_id + el JWT de Supabase.
//
// Flujo:
//   1. Sin conexiones → form para pegar un Access Token (+ etiqueta).
//   2. Con conexiones → selector de conexión + "Nueva" + "Eliminar".
//   3. Por conexión: selector de cuenta (dropdown de cuentas accesibles +
//      entrada manual de un act_XXXX) + selector de período + tabla de
//      campañas con gasto, CTR, CPM, ROAS, compras, CPA y estado.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, Check, Loader2, Trash2, AlertCircle, RefreshCw, ExternalLink,
  TrendingUp, KeyRound, ChevronDown, Search, Plus, X,
} from 'lucide-react';
import { supabase } from './supabase.js';

const TOKEN_HELP_URL = 'https://developers.facebook.com/tools/explorer/';
const LS_PRESET = 'adslab-campanas-date-preset';
const LS_ACCT_PREFIX = 'adslab-campanas-acct-';

// Con Supabase configurado usamos conexiones persistidas en DB (multi-cuenta).
const DB_MODE = !!supabase;

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

// Headers con el JWT de Supabase (para que el backend identifique al dueño de
// las conexiones). En modo cookie no hace falta, pero mandarlo no molesta.
async function authHeaders(json = false) {
  let token = '';
  try {
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token || '';
    }
  } catch {}
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

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
function ConnectTokenForm({ onConnect, onCancel, canCancel }) {
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    const t = token.trim();
    if (!t) { setError('Pegá un access token.'); return; }
    setBusy(true); setError(null);
    try {
      await onConnect({ accessToken: t, label: label.trim() });
      setToken(''); setLabel('');
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
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Conectar cuenta publicitaria</h3>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Pegá un Access Token de Meta. Sirve para tu cuenta o la de cualquier persona que te dé acceso.
          </p>
        </div>
        {canCancel && (
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition shrink-0" aria-label="Cancelar">
            <X size={16} />
          </button>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wider">
            Etiqueta <span className="font-normal normal-case text-gray-400">(para reconocerla — ej. "Cliente X")</span>
          </label>
          <input
            type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="Cuenta de…"
            className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wider">
            Access Token
          </label>
          <textarea
            value={token} onChange={e => setToken(e.target.value)}
            placeholder="EAAB..." rows={3} spellCheck={false}
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
          type="submit" disabled={busy}
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
          El token se guarda {DB_MODE ? 'cifrado en el servidor (tabla protegida)' : 'en una cookie HttpOnly del servidor'} — nunca queda accesible desde el navegador.
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
// Panel de una conexión: cuenta + período + tabla
// ========================================================================
function ConnectionPanel({ connection, addToast }) {
  // En modo cookie la conexión sintética usa id '__cookie__' → no manda connection_id.
  const connId = connection.id;
  const usesConnParam = DB_MODE && connId && connId !== '__cookie__';

  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(() => {
    try { return localStorage.getItem(LS_ACCT_PREFIX + connId) || ''; } catch { return ''; }
  });
  const [manualId, setManualId] = useState('');
  const [useManual, setUseManual] = useState(false);
  const [preset, setPreset] = useState(() => {
    try { return localStorage.getItem(LS_PRESET) || 'last_7d'; } catch { return 'last_7d'; }
  });
  const [campaignsData, setCampaignsData] = useState(null);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState(null);

  const currentAccountObj = accounts.find(a => a.id === selectedAccount) || null;
  const currency = currentAccountObj?.currency || null;

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const qs = usesConnParam ? `?connection_id=${encodeURIComponent(connId)}` : '';
      const r = await fetch(`/api/meta/ad-accounts${qs}`, { headers: await authHeaders(false) });
      const d = await r.json();
      if (r.ok && Array.isArray(d.accounts)) setAccounts(d.accounts);
      else if (!r.ok) addToast?.({ type: 'error', message: d.error || 'No pude listar las cuentas.' });
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setAccountsLoading(false);
    }
  }, [connId, usesConnParam, addToast]);

  const loadCampaigns = useCallback(async (accountId, datePreset) => {
    if (!accountId) return;
    setCampaignsLoading(true); setCampaignsError(null);
    try {
      let url = `/api/meta/campaigns-insights?account_id=${encodeURIComponent(accountId)}&date_preset=${encodeURIComponent(datePreset)}`;
      if (usesConnParam) url += `&connection_id=${encodeURIComponent(connId)}`;
      const r = await fetch(url, { headers: await authHeaders(false) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setCampaignsData(d);
    } catch (err) {
      setCampaignsError(err.message); setCampaignsData(null);
    } finally {
      setCampaignsLoading(false);
    }
  }, [connId, usesConnParam]);

  // Al montar / cambiar de conexión: traer cuentas y resetear estado.
  useEffect(() => {
    setCampaignsData(null); setCampaignsError(null);
    try { setSelectedAccount(localStorage.getItem(LS_ACCT_PREFIX + connId) || ''); } catch { setSelectedAccount(''); }
    loadAccounts();
  }, [connId, loadAccounts]);

  // Persistir selección + período.
  useEffect(() => {
    try { if (selectedAccount) localStorage.setItem(LS_ACCT_PREFIX + connId, selectedAccount); } catch {}
  }, [selectedAccount, connId]);
  useEffect(() => {
    try { localStorage.setItem(LS_PRESET, preset); } catch {}
  }, [preset]);

  // Auto-cargar campañas cuando hay cuenta + período.
  useEffect(() => {
    if (selectedAccount) loadCampaigns(selectedAccount, preset);
  }, [selectedAccount, preset, loadCampaigns]);

  const applyManualId = () => {
    const id = manualId.trim();
    if (!id) return;
    const normalized = id.startsWith('act_') ? id : `act_${id.replace(/\D/g, '')}`;
    setSelectedAccount(normalized);
  };

  return (
    <div className="space-y-4">
      {/* Controles: cuenta + período */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        {!useManual ? (
          <div className="relative flex-1 min-w-[220px]">
            <select
              value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
              className="w-full pl-3 pr-8 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md appearance-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">{accountsLoading ? 'Cargando cuentas…' : '— Elegí una cuenta publicitaria —'}</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} · {a.accountId} {a.currency ? `(${a.currency})` : ''}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        ) : (
          <div className="flex-1 min-w-[220px] flex gap-2">
            <input
              type="text" value={manualId} onChange={e => setManualId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyManualId(); }}
              placeholder="act_1234567890 o 1234567890"
              className="flex-1 pl-3 pr-2 py-2 text-xs font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button onClick={applyManualId} className="px-3 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md transition">Cargar</button>
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
          value={preset} onChange={e => setPreset(e.target.value)}
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

// ========================================================================
// Componente principal — maneja la lista de conexiones
// ========================================================================
export default function CampanasTracker({ addToast }) {
  const [boot, setBoot] = useState({ loading: true });
  const [connections, setConnections] = useState([]);
  const [activeConnId, setActiveConnId] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const reload = useCallback(async () => {
    if (DB_MODE) {
      const r = await fetch('/api/meta/connections', { headers: await authHeaders(false) });
      const d = await r.json();
      const conns = (d.connections || []).map(c => ({
        id: c.id, label: c.label, metaUserName: c.meta_user_name,
      }));
      setConnections(conns);
      setActiveConnId(prev => (conns.find(c => c.id === prev) ? prev : (conns[0]?.id || '')));
      setShowAddForm(conns.length === 0);
    } else {
      // Modo cookie: una sola conexión sintética según /api/meta/me.
      const r = await fetch('/api/meta/me');
      const d = await r.json();
      if (d.connected) {
        setConnections([{ id: '__cookie__', label: d.user?.name || 'Cuenta Meta', metaUserName: d.user?.name }]);
        setActiveConnId('__cookie__');
        setShowAddForm(false);
      } else {
        setConnections([]); setActiveConnId(''); setShowAddForm(true);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      try { await reload(); } catch (err) { addToast?.({ type: 'error', message: err.message }); }
      finally { setBoot({ loading: false }); }
    })();
  }, [reload, addToast]);

  const handleConnect = async ({ accessToken, label }) => {
    const r = await fetch('/api/meta/connect-token', {
      method: 'POST',
      headers: await authHeaders(true),
      body: JSON.stringify({ accessToken, label }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'No se pudo conectar.');
    addToast?.({ type: 'success', message: `Conectado a Meta como ${d.user?.name || d.user?.id}` });
    await reload();
    if (d.connection?.id) setActiveConnId(d.connection.id);
    setShowAddForm(false);
  };

  const handleDelete = async (conn) => {
    if (!window.confirm(`¿Eliminar la conexión "${conn.label}"? Vas a tener que volver a pegar el token para usarla.`)) return;
    try {
      if (conn.id === '__cookie__') {
        await fetch('/api/meta/disconnect', { method: 'POST' });
      } else {
        await fetch(`/api/meta/connections?connection_id=${encodeURIComponent(conn.id)}`, {
          method: 'DELETE', headers: await authHeaders(false),
        });
      }
      addToast?.({ type: 'info', message: 'Conexión eliminada.' });
      await reload();
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    }
  };

  const header = (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-400 flex items-center justify-center text-white shadow-sm shrink-0">
        <TrendingUp size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Campañas</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Conectá una o varias cuentas publicitarias y trackeá sus campañas con métricas reales.
        </p>
      </div>
    </div>
  );

  if (boot.loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-5">
        {header}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Cargando conexiones…</span>
        </div>
      </div>
    );
  }

  const activeConn = connections.find(c => c.id === activeConnId) || null;

  // Sin conexiones (o agregando una nueva): mostrar el form.
  if (connections.length === 0 || showAddForm) {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        {header}
        <ConnectTokenForm
          onConnect={handleConnect}
          onCancel={() => setShowAddForm(false)}
          canCancel={connections.length > 0}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {header}

      {/* Selector de conexiones */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          {connections.map(c => {
            const active = c.id === activeConnId;
            return (
              <button
                key={c.id}
                onClick={() => setActiveConnId(c.id)}
                className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                  active
                    ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                }`}
              >
                {active && <Check size={12} />}
                <span className="truncate max-w-[160px]">{c.label}</span>
                <span
                  role="button" tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); handleDelete(c); }}
                  className="ml-0.5 text-gray-400 hover:text-red-500 transition opacity-60 group-hover:opacity-100"
                  title="Eliminar conexión"
                >
                  <Trash2 size={12} />
                </span>
              </button>
            );
          })}
        </div>
        {DB_MODE && (
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-lg hover:from-[#0556BE] hover:to-[#1668D8] transition shrink-0"
          >
            <Plus size={13} /> Nueva conexión
          </button>
        )}
      </div>

      {/* Panel de la conexión activa */}
      {activeConn && <ConnectionPanel key={activeConn.id} connection={activeConn} addToast={addToast} />}
    </div>
  );
}
