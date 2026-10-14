// Selector de fechas estilo Meta Ads Manager: botón "📅 Últimos 7 días ▾" que
// abre un popover con los presets a la izquierda (radios) y un calendario
// DOBLE (dos meses) a la derecha, donde también se puede clickear un rango a
// mano. "Actualizar" aplica. Reemplaza al <select> nativo de la ventana de
// tiempo en Métricas.
//
// Valor: el preset elegido ('last_7d', 'maximum', …) o un rango personalizado
// codificado como "custom_YYYY-MM-DD_YYYY-MM-DD" — los endpoints de /api/meta
// lo entienden y lo convierten en time_range de Graph.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const corto = (d) => `${d.getDate()} ${MES[d.getMonth()]}`;
const mismoDia = (a, b) => a && b && a.toDateString() === b.toDateString();

// Rango de fechas que implica cada preset (para pintar el calendario).
function rangoDePreset(value) {
  const hoy = new Date();
  const atras = (n) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return d; };
  switch (value) {
    case 'today': return [hoy, hoy];
    case 'yesterday': return [atras(1), atras(1)];
    case 'last_7d': return [atras(6), hoy];
    case 'last_14d': return [atras(13), hoy];
    case 'last_30d': return [atras(29), hoy];
    case 'last_90d': return [atras(89), hoy];
    case 'this_month': return [new Date(hoy.getFullYear(), hoy.getMonth(), 1), hoy];
    case 'last_month': {
      const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      return [ini, new Date(hoy.getFullYear(), hoy.getMonth(), 0)];
    }
    default: return null; // maximum / desconocido: sin pintado
  }
}

export function etiquetaDeValor(value, opciones = []) {
  const m = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(value || '');
  if (m) {
    const a = new Date(`${m[1]}T12:00:00`), b = new Date(`${m[2]}T12:00:00`);
    return mismoDia(a, b) ? `${corto(a)} ${a.getFullYear()}` : `${corto(a)} – ${corto(b)} ${b.getFullYear()}`;
  }
  return opciones.find(o => o.value === value)?.label || value || 'Período';
}

export default function MenuFecha({ value, onChange, opciones = [] }) {
  const [open, setOpen] = useState(false);
  // De qué lado abre el panel: si el botón está cerca del borde derecho de la
  // pantalla (lo normal, vive al final del toolbar), el panel se ancla a la
  // DERECHA del botón — antes abría hacia la derecha y generaba scroll
  // horizontal en toda la página.
  const [alineaDerecha, setAlineaDerecha] = useState(true);
  const [presetSel, setPresetSel] = useState(value);
  const [selA, setSelA] = useState(null);
  const [selB, setSelB] = useState(null);
  const [fase, setFase] = useState(0); // 0 = el próximo click fija el inicio
  const [calBase, setCalBase] = useState(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d; });
  const ref = useRef(null);

  // Al abrir: sincronizar con el valor vigente y pararse en su rango.
  const abrir = () => {
    const m = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(value || '');
    if (m) {
      const a = new Date(`${m[1]}T12:00:00`), b = new Date(`${m[2]}T12:00:00`);
      setPresetSel('custom'); setSelA(a); setSelB(b);
      setCalBase(new Date(a.getFullYear(), a.getMonth(), 1));
    } else {
      setPresetSel(value);
      const r = rangoDePreset(value);
      setSelA(r?.[0] || null); setSelB(r?.[1] || null);
      const base = r?.[0] || new Date();
      setCalBase(new Date(base.getFullYear(), base.getMonth(), 1));
    }
    setFase(0);
    // ¿Entra el panel abriendo hacia la derecha? Si no, se ancla a la derecha.
    try {
      const rect = ref.current?.getBoundingClientRect();
      const ancho = Math.min(window.innerWidth * 0.92, 560);
      setAlineaDerecha(!!rect && rect.left + ancho > window.innerWidth - 16);
    } catch { setAlineaDerecha(true); }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const fuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [open]);

  const elegirPreset = (v) => {
    setPresetSel(v);
    const r = rangoDePreset(v);
    setSelA(r?.[0] || null); setSelB(r?.[1] || null); setFase(0);
    if (r?.[0]) setCalBase(new Date(r[0].getFullYear(), r[0].getMonth(), 1));
  };

  const clickDia = (f) => {
    if (fase === 0 || (selA && f < selA)) { setSelA(f); setSelB(f); setFase(1); }
    else { setSelB(f); setFase(0); }
    setPresetSel('custom');
  };

  const aplicar = () => {
    if (presetSel === 'custom') {
      if (!selA || !selB) return;
      onChange(`custom_${iso(selA)}_${iso(selB)}`);
    } else {
      onChange(presetSel);
    }
    setOpen(false);
  };

  const Mes = useCallback(({ base }) => {
    const prim = (base.getDay() + 6) % 7; // lunes = 0
    const dias = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const celdas = [];
    for (let i = 0; i < prim; i++) celdas.push(<span key={`v${i}`} />);
    for (let d = 1; d <= dias; d++) {
      const f = new Date(base.getFullYear(), base.getMonth(), d, 12);
      const sel = mismoDia(f, selA) || mismoDia(f, selB);
      const inr = selA && selB && f > selA && f < selB;
      celdas.push(
        <button key={d} onClick={() => clickDia(f)}
          className={`w-[30px] h-7 text-[11px] tabular-nums transition ${
            sel ? 'bg-[#1877F2] text-white font-bold rounded-md'
              : inr ? 'bg-[#1877F2]/15 text-gray-800 dark:text-gray-100'
              : 'text-gray-700 dark:text-gray-200 hover:bg-[#1877F2]/15 rounded-md'}`}>
          {d}
        </button>,
      );
    }
    return (
      <div className="text-center">
        <p className="text-[12px] font-bold text-gray-900 dark:text-gray-100 mb-1.5">
          {MES[base.getMonth()]} {base.getFullYear()}
        </p>
        <div className="grid grid-cols-7 justify-items-center gap-y-0.5" style={{ width: 7 * 30 }}>
          {DOW.map((d, i) => <span key={i} className="text-[9px] font-bold text-gray-400 w-[30px]">{d}</span>)}
          {celdas}
        </div>
      </div>
    );
  }, [selA, selB, fase]);

  const base2 = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 1);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => (open ? setOpen(false) : abrir())}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-[#1877F2]/60 transition text-gray-700 dark:text-gray-200">
        <CalendarDays size={12} className="text-[#1877F2]" />
        {etiquetaDeValor(value, opciones)}
        <span className="text-gray-400 text-[9px]">▾</span>
      </button>

      {open && (
        <div className={`absolute z-40 mt-1.5 ${alineaDerecha ? 'right-0' : 'left-0'} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl flex flex-col sm:flex-row overflow-hidden max-h-[min(75vh,540px)] overflow-y-auto`}
          style={{ width: 'min(92vw, 560px)' }}>
          {/* presets */}
          <div className="sm:w-[180px] shrink-0 sm:border-r border-b sm:border-b-0 border-gray-100 dark:border-gray-700/60 p-2.5 max-h-[220px] sm:max-h-none overflow-y-auto">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-1.5 mb-1">Período</p>
            {opciones.map(o => (
              <button key={o.value} onClick={() => elegirPreset(o.value)}
                className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 text-left">
                <span className={`w-[15px] h-[15px] rounded-full border-2 shrink-0 relative ${
                  presetSel === o.value ? 'border-[#1877F2]' : 'border-gray-300 dark:border-gray-600'}`}>
                  {presetSel === o.value && <span className="absolute inset-[2px] rounded-full bg-[#1877F2]" />}
                </span>
                <span className="text-[12px] text-gray-800 dark:text-gray-100">{o.label}</span>
              </button>
            ))}
            <button onClick={() => setPresetSel('custom')}
              className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 text-left">
              <span className={`w-[15px] h-[15px] rounded-full border-2 shrink-0 relative ${
                presetSel === 'custom' ? 'border-[#1877F2]' : 'border-gray-300 dark:border-gray-600'}`}>
                {presetSel === 'custom' && <span className="absolute inset-[2px] rounded-full bg-[#1877F2]" />}
              </span>
              <span className="text-[12px] text-gray-800 dark:text-gray-100">Personalizado</span>
            </button>
          </div>

          {/* calendario doble */}
          <div className="p-3 min-w-0">
            <div className="flex items-start gap-1">
              <button onClick={() => setCalBase(b => new Date(b.getFullYear(), b.getMonth() - 1, 1))} title="Mes anterior"
                className="p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900/60"><ChevronLeft size={14} /></button>
              <div className="flex-1 flex flex-wrap justify-center gap-4">
                <Mes base={calBase} />
                <div className="hidden md:block"><Mes base={base2} /></div>
              </div>
              <button onClick={() => setCalBase(b => new Date(b.getFullYear(), b.getMonth() + 1, 1))} title="Mes siguiente"
                className="p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900/60"><ChevronRight size={14} /></button>
            </div>
            <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 dark:border-gray-700/60 mt-2.5 pt-2.5">
              <span className="text-[10px] text-gray-400 w-full">Tocá el día de inicio y después el de fin.</span>
              <span className="text-[11px] tabular-nums px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                {selA ? `${corto(selA)} ${selA.getFullYear()}` : '—'}
              </span>
              <span className="text-gray-400 text-[11px]">→</span>
              <span className="text-[11px] tabular-nums px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                {selB ? `${corto(selB)} ${selB.getFullYear()}` : '—'}
              </span>
              <button onClick={aplicar}
                className="ml-auto px-3.5 py-1.5 text-xs font-bold text-white bg-[#1877F2] hover:bg-[#0a5ae0] rounded-lg transition">
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
