// Switch global ARS / USD para todos los montos de la plataforma.
// Click en el símbolo → alterna la moneda. Click en el engranaje → edita el
// tipo de cambio (ARS por USD) que se usa para convertir.

import React, { useEffect, useState, useRef } from 'react';
import { Check, X, Settings2 } from 'lucide-react';
import { getCurrency, toggleCurrency, getRate, setRate, subscribeMoney } from './moneyStore.js';

export default function CurrencyToggle() {
  const [, force] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef(null);

  useEffect(() => subscribeMoney(() => force(x => x + 1)), []);
  useEffect(() => {
    if (!editing) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setEditing(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editing]);

  const cur = getCurrency();
  const rate = getRate();

  const openEdit = () => { setDraft(String(rate)); setEditing(true); };
  const save = () => { const v = Number(draft); if (v > 0) setRate(v); setEditing(false); };

  return (
    <div ref={ref} className="relative hidden md:flex items-center">
      <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <button
          onClick={toggleCurrency}
          title={`Mostrando en ${cur === 'USD' ? 'dólares' : 'pesos'} (tipo de cambio $${rate}). Click para cambiar a ${cur === 'USD' ? 'pesos' : 'dólares'}.`}
          className="px-2.5 py-1.5 text-[11px] font-bold tabular-nums text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
        >
          {cur === 'USD' ? 'US$' : 'AR$'}
        </button>
        <button
          onClick={openEdit}
          title="Editar tipo de cambio"
          className="px-1.5 py-1.5 border-l border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
        >
          <Settings2 size={12} />
        </button>
      </div>

      {editing && (
        <div className="absolute top-full right-0 mt-2 z-50 w-60 bg-white dark:bg-gray-900 border-2 border-brand-300 dark:border-brand-700 rounded-xl shadow-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-900 dark:text-gray-100">Tipo de cambio</p>
            <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={12} /></button>
          </div>
          <label className="block text-[10px] font-bold uppercase text-gray-600 dark:text-gray-300 mb-1">Pesos por dólar (ARS / USD)</label>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">$</span>
            <input
              type="number" step="1" min="1" value={draft} autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              placeholder="1400"
              className="flex-1 px-2 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button onClick={save} className="p-1.5 text-white bg-brand-600 hover:bg-brand-700 rounded transition" title="Guardar"><Check size={12} /></button>
          </div>
          <p className="mt-2 text-[9px] text-gray-500 dark:text-gray-400 italic">
            Se usa para convertir los costos (en USD) y el saldo que cargó cada persona (en pesos) a la moneda que elijas.
          </p>
        </div>
      )}
    </div>
  );
}
