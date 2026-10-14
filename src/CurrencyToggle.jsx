// Switch global ARS / USD para todos los montos de la plataforma.
// Click en el símbolo → alterna la moneda. El tipo de cambio ya no se edita a
// mano acá: lo trae la pill del dólar BLUE del header (click en ella lo
// adopta), así que este editor salió (pedido del user 14/10).

import React, { useEffect, useState } from 'react';
import { toggleCurrency, getCurrency, getRate, subscribeMoney } from './moneyStore.js';

export default function CurrencyToggle() {
  const [, force] = useState(0);
  useEffect(() => subscribeMoney(() => force(x => x + 1)), []);

  const cur = getCurrency();
  const rate = getRate();

  return (
    <div className="relative hidden md:flex items-center">
      <button
        onClick={toggleCurrency}
        title={`Mostrando en ${cur === 'USD' ? 'dólares' : 'pesos'} (tipo de cambio $${rate} — lo seteás tocando la pill del dólar Blue). Click para cambiar a ${cur === 'USD' ? 'pesos' : 'dólares'}.`}
        className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 text-[11px] font-bold tabular-nums text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
      >
        {cur === 'USD' ? 'US$' : 'AR$'}
      </button>
    </div>
  );
}
