// Widget de saldo en la top bar — muestra el saldo restante de Anthropic y
// OpenAI según lo que el user cargó. Click → popover para actualizar.
//
// No es real-time (los providers no exponen API pública) — pero auto-decrece
// con cada costo logueado, así que mientras vos uses la app, el número
// refleja lo que te queda.

import React, { useEffect, useState, useRef } from 'react';
import { Wallet, Check, X } from 'lucide-react';
import { getBalance, setBalance, getRemaining, subscribeBalance } from './balanceStore.js';

const PROVIDERS = [
  { key: 'anthropic', label: 'Anthropic',  rechargeUrl: 'https://console.anthropic.com/settings/billing' },
  { key: 'openai',    label: 'OpenAI',     rechargeUrl: 'https://platform.openai.com/settings/organization/billing/overview' },
  { key: 'apify',     label: 'Apify',      rechargeUrl: 'https://console.apify.com/billing/subscription' },
];

function fmtUsd(v) {
  if (v == null) return '—';
  return `$${Number(v).toFixed(2)}`;
}

export default function BalanceBar() {
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(null); // provider key
  const [draft, setDraft] = useState('');
  const popoverRef = useRef(null);

  useEffect(() => subscribeBalance(() => setTick(x => x + 1)), []);

  // Cierra el popover cuando el user clickea afuera.
  useEffect(() => {
    if (!editing) return;
    const onDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setEditing(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editing]);

  const handleEdit = (key) => {
    const current = getBalance(key);
    setDraft(current ? String(current.saldo) : '');
    setEditing(key);
  };

  const handleSave = () => {
    const v = Number(draft);
    if (!isNaN(v) && v >= 0) {
      setBalance(editing, v);
      setEditing(null);
      setTick(x => x + 1);
    }
  };

  return (
    <div className="hidden md:flex items-center gap-1.5 relative">
      {PROVIDERS.map(p => {
        const balance = getBalance(p.key);
        const remaining = getRemaining(p.key);
        const lowSaldo = remaining != null && remaining < 1;
        return (
          <button
            key={p.key}
            onClick={() => handleEdit(p.key)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border transition ${
              !balance
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700'
                : lowSaldo
                  ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50'
                  : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
            }`}
            title={balance
              ? `${p.label}: queda ${fmtUsd(remaining)} (cargaste ${fmtUsd(balance.saldo)} el ${new Date(balance.setAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}). Click para actualizar.`
              : `${p.label}: cargá tu saldo actual para ver lo que te queda`}
          >
            <Wallet size={10} />
            <span className="opacity-70">{p.label.slice(0, 4)}</span>
            <span className="tabular-nums">{balance ? fmtUsd(remaining) : 'set'}</span>
          </button>
        );
      })}

      {/* Popover de edición */}
      {editing && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 z-50 w-72 bg-white dark:bg-gray-900 border-2 border-brand-300 dark:border-brand-700 rounded-xl shadow-2xl p-3"
        >
          {(() => {
            const p = PROVIDERS.find(x => x.key === editing);
            const current = getBalance(editing);
            const remaining = getRemaining(editing);
            return (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{p.label}</p>
                  <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                    <X size={12} />
                  </button>
                </div>
                {current && (
                  <p className="text-[10px] text-gray-600 dark:text-gray-400 mb-2">
                    Saldo cargado: <strong>{fmtUsd(current.saldo)}</strong> el {new Date(current.setAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}<br />
                    Gastado desde entonces: <strong>{fmtUsd(current.saldo - remaining)}</strong><br />
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">Restante estimado: {fmtUsd(remaining)}</span>
                  </p>
                )}
                <label className="block text-[10px] font-bold uppercase text-gray-600 dark:text-gray-300 mb-1">
                  Saldo actual cargado (USD)
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">$</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="20.00"
                    autoFocus
                    className="flex-1 px-2 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                  />
                  <button
                    onClick={handleSave}
                    className="p-1.5 text-white bg-brand-600 hover:bg-brand-700 rounded transition"
                    title="Guardar"
                  >
                    <Check size={12} />
                  </button>
                </div>
                <a
                  href={p.rechargeUrl}
                  target="_blank" rel="noreferrer"
                  className="block mt-2 text-[10px] text-brand-600 dark:text-brand-400 hover:underline"
                >
                  → Recargar en {p.label}
                </a>
                <p className="mt-2 text-[9px] text-gray-500 dark:text-gray-400 italic">
                  Tip: actualizá este número cada vez que recargues crédito en {p.label}. Lo restante se va calculando solo con cada operación.
                </p>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
