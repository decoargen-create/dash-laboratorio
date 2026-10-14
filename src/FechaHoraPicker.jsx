// Selector de fecha/hora para programar publicaciones — la variante "C" que
// eligió el user entre los prototipos: los próximos días como tarjetitas
// siempre a la vista + la hora con − / + de a 30 minutos. Nada de popovers ni
// del picker nativo del navegador.
//
// Contrato: el mismo del <input type="datetime-local"> que reemplaza — value
// es 'YYYY-MM-DDTHH:mm' y '' significa "al publicar" (sin programar), así los
// consumidores (Escalar y el Armador) no cambian nada de su lógica.

import React from 'react';
import { Minus, Plus, Rocket } from 'lucide-react';

const pad = (n) => String(n).padStart(2, '0');
const keyDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export default function FechaHoraPicker({ value = '', onChange, dias = 10, disabled = false }) {
  const hoy = new Date();
  const lista = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
    lista.push(d);
  }
  const [diaSel, horaSel] = value ? value.split('T') : [null, null];
  // Hora por defecto al elegir un día: 05:00 (pedido del user — las campañas
  // programadas arrancan a la madrugada para aprovechar el día completo).
  const mins = horaSel ? (+horaSel.slice(0, 2)) * 60 + (+horaSel.slice(3, 5) || 0) : 5 * 60;

  const elegirDia = (d) => onChange(`${keyDe(d)}T${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
  const moverHora = (delta) => {
    if (!diaSel) return;
    const m = Math.min(23 * 60 + 30, Math.max(0, mins + delta));
    onChange(`${diaSel}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  };

  const etiqueta = (d, i) => (i === 0 ? 'hoy' : i === 1 ? 'mañana' : DOW[d.getDay()]);
  const tile = 'min-w-[56px] shrink-0 rounded-xl border px-1 py-2 text-center transition disabled:opacity-50';
  const off = 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:border-brand-400';
  const on = 'bg-brand-600 border-brand-600 text-white shadow-sm';

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {/* "Ahora" = sin programar: sale apenas se publica (o queda pausada). */}
        <button type="button" disabled={disabled} onClick={() => onChange('')}
          title="Sin programar: arranca al publicar (o queda pausada si elegiste crear pausada)"
          className={`${tile} ${!value ? on : off}`}>
          <div className={`text-[9px] font-bold uppercase ${!value ? 'text-brand-100' : 'text-gray-400'}`}>ahora</div>
          <div className="pt-0.5 flex justify-center"><Rocket size={15} /></div>
        </button>
        {lista.map((d, i) => {
          const sel = diaSel === keyDe(d);
          return (
            <button key={keyDe(d)} type="button" disabled={disabled} onClick={() => elegirDia(d)}
              className={`${tile} ${sel ? on : off}`}>
              <div className={`text-[9px] font-bold uppercase truncate ${sel ? 'text-brand-100' : 'text-gray-400'}`}>{etiqueta(d, i)}</div>
              <div className="text-[15px] font-extrabold leading-tight tabular-nums">{d.getDate()}</div>
            </button>
          );
        })}
      </div>
      {value && (
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="inline-flex items-center rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden">
            <button type="button" disabled={disabled} onClick={() => moverHora(-30)}
              className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition disabled:opacity-50">
              <Minus size={14} />
            </button>
            <span className="min-w-[64px] text-center text-[16px] font-extrabold tabular-nums text-gray-900 dark:text-gray-100">
              {pad(Math.floor(mins / 60))}:{pad(mins % 60)}
            </span>
            <button type="button" disabled={disabled} onClick={() => moverHora(30)}
              className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition disabled:opacity-50">
              <Plus size={14} />
            </button>
          </div>
          <span className="text-[10px] text-gray-400">de a 30 min · hora Argentina</span>
        </div>
      )}
    </div>
  );
}
