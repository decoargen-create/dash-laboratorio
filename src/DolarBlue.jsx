// Pill del dólar BLUE (venta) en el header. La plataforma lo trae sola de
// dolarapi.com (cache 30 min) — pedido del user: "el tipo de cambio arriba
// deberías traerlo vos directamente, el dólar blue venta".
//
// Click → lo adopta como tipo de cambio global (moneyStore.setRate), así el
// AR$/US$ de toda la app queda alineado al blue del día sin tipearlo a mano.

import React, { useEffect, useState } from 'react';
import { fetchDolarBlue, subscribeDolarBlue, getDolarBlueCached } from './dolarStore.js';
import { setRate, getRate, subscribeMoney } from './moneyStore.js';

const fmt = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-AR')}`;

export default function DolarBlue() {
  const [blue, setBlue] = useState(() => getDolarBlueCached());
  const [, force] = useState(0);

  useEffect(() => {
    fetchDolarBlue().catch(() => {});
    // Refresco periódico (la cache del store ya evita pegarle de más a la API).
    const t = setInterval(() => { fetchDolarBlue().catch(() => {}); }, 31 * 60 * 1000);
    const un = subscribeDolarBlue(setBlue);
    return () => { clearInterval(t); un(); };
  }, []);
  useEffect(() => subscribeMoney(() => force(x => x + 1)), []);

  if (!blue?.venta) return null;
  const venta = Math.round(blue.venta);
  const enUso = Math.abs(getRate() - venta) < 1;
  const hora = blue.fetchedAt
    ? new Date(blue.fetchedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <button
      onClick={() => setRate(venta)}
      title={`Dólar blue — compra ${fmt(blue.compra)} · venta ${fmt(venta)}${hora ? ` (actualizado ${hora})` : ''}. ${
        enUso ? 'Es el tipo de cambio en uso.' : 'Click: usarlo como tipo de cambio de la app.'}`}
      className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold tabular-nums transition ${
        enUso
          ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
          : 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      <span className="opacity-70 font-semibold">Blue</span>
      <span>{fmt(venta)}</span>
    </button>
  );
}
