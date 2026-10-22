import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, TrendingUp, Target, Wallet } from 'lucide-react';

// Calculadora de precios del ecommerce, adentro de la plataforma (antes era
// un link a calculadoraecom.com). Con precio, costos y comisiones te dice
// cuánto ganás por venta, el ROAS de equilibrio y el CPA máximo; con el ROAS
// que esperás, la ganancia neta después de la pauta. Todo en pesos.
const KEY = 'adslab-calculadora-precios-v1';
const INICIAL = { precio: '29900', costo: '6500', envio: '3500', comision: '6.5', impuestos: '3', otros: '0', roas: '2.5' };

// Acepta "29.900" (punto de miles), "6,5" y "6.5" (decimal): un punto seguido
// de exactamente 3 dígitos al final es de miles; cualquier otro es decimal.
const num = (v) => {
  let t = String(v ?? '').trim().replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};
const pesos = (v) => `$ ${Math.round(v).toLocaleString('es-AR')}`;
const dec = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

function Campo({ id, label, sufijo, value, onChange, ayuda }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-gray-400">{label}</span>
      <span className="flex items-center rounded-[10px] border border-[rgba(130,180,255,0.22)] bg-[#10101b] focus-within:border-brand-500/70 transition-colors">
        {sufijo === '$' && <span className="pl-3 text-gray-500 text-sm">$</span>}
        <input id={id} inputMode="decimal" value={value} onChange={e => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-[15px] text-gray-100 tabular-nums focus:outline-none" />
        {sufijo && sufijo !== '$' && <span className="pr-3 text-gray-500 text-sm">{sufijo}</span>}
      </span>
      {ayuda && <span className="text-[11.5px] text-gray-500">{ayuda}</span>}
    </label>
  );
}

function Resultado({ icon: Icon, label, valor, nota, tono = 'normal' }) {
  const color = tono === 'bien' ? 'text-emerald-400' : tono === 'mal' ? 'text-rose-400' : 'text-gray-100';
  return (
    <div className="rounded-2xl border border-[rgba(160,160,220,0.1)] p-4 transition hover:-translate-y-0.5 hover:border-[rgba(130,180,255,0.22)]"
      style={{ background: 'linear-gradient(180deg, #171726, #12121c)' }}>
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-gray-400"><Icon size={15} /> {label}</div>
      <div className={`mt-2 text-[25px] font-[640] tracking-tight tabular-nums ${color}`}>{valor}</div>
      {nota && <div className="mt-1 text-[11.5px] text-gray-500">{nota}</div>}
    </div>
  );
}

export default function CalculadoraPrecios() {
  const [f, setF] = useState(() => {
    try { return { ...INICIAL, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return INICIAL; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* sin storage */ } }, [f]);
  const set = (k) => (v) => setF(prev => ({ ...prev, [k]: v }));

  const r = useMemo(() => {
    const precio = num(f.precio);
    const comision = precio * num(f.comision) / 100;
    const impuestos = precio * num(f.impuestos) / 100;
    const costos = num(f.costo) + num(f.envio) + num(f.otros) + comision + impuestos;
    const ganancia = precio - costos;                       // antes de la pauta
    const margen = precio > 0 ? ganancia / precio * 100 : 0;
    const roasEq = ganancia > 0 ? precio / ganancia : Infinity;
    const roas = num(f.roas);
    const pautaPorVenta = roas > 0 ? precio / roas : 0;
    const neta = ganancia - pautaPorVenta;
    return { precio, comision, impuestos, costos, ganancia, margen, roasEq, roas, pautaPorVenta, neta };
  }, [f]);

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <span className="w-10 h-10 rounded-[10px] grid place-items-center text-white bg-gradient-to-br from-brand-500 to-brand-700"><Calculator size={20} /></span>
        <div>
          <h2 className="text-[22px] font-extrabold tracking-tight text-gray-100">Calculadora</h2>
          <p className="text-[13px] text-gray-400">Cuánto ganás por venta y hasta cuánto podés pagar de publicidad.</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5">
        <section className="rounded-2xl border border-[rgba(160,160,220,0.1)] p-5 grid sm:grid-cols-2 gap-4 content-start"
          style={{ background: 'linear-gradient(180deg, #171726, #12121c)' }}>
          <Campo id="calc-precio" label="Precio de venta" sufijo="$" value={f.precio} onChange={set('precio')} />
          <Campo id="calc-costo" label="Costo del producto" sufijo="$" value={f.costo} onChange={set('costo')} />
          <Campo id="calc-envio" label="Envío que pagás vos" sufijo="$" value={f.envio} onChange={set('envio')} />
          <Campo id="calc-otros" label="Otros costos por pedido" sufijo="$" value={f.otros} onChange={set('otros')} ayuda="Packaging, fulfillment, regalos" />
          <Campo id="calc-comision" label="Comisión de cobro" sufijo="%" value={f.comision} onChange={set('comision')} ayuda="Mercado Pago, pasarela, plataforma" />
          <Campo id="calc-impuestos" label="Impuestos" sufijo="%" value={f.impuestos} onChange={set('impuestos')} ayuda="IIBB, débitos y créditos" />
          <div className="sm:col-span-2 border-t border-[rgba(160,160,220,0.1)] pt-4">
            <Campo id="calc-roas" label="ROAS que esperás de tus anuncios" sufijo="x" value={f.roas} onChange={set('roas')} ayuda="Ventas ÷ inversión en Meta" />
          </div>
        </section>

        <section className="grid sm:grid-cols-2 gap-3 content-start">
          <Resultado icon={Wallet} label="Ganancia por venta" valor={pesos(r.ganancia)}
            nota={`Margen ${dec(r.margen, 1)} % · antes de la publicidad`} tono={r.ganancia > 0 ? 'normal' : 'mal'} />
          <Resultado icon={Target} label="ROAS de equilibrio" valor={Number.isFinite(r.roasEq) ? dec(r.roasEq) : 'No da'}
            nota="Por debajo de esto, cada venta te hace perder plata" />
          <Resultado icon={TrendingUp} label="CPA máximo" valor={pesos(Math.max(0, r.ganancia))}
            nota="Lo máximo que podés pagar por una venta sin perder" />
          <Resultado icon={Wallet} label={`Ganancia neta con ROAS ${dec(r.roas, 1)}`} valor={pesos(r.neta)}
            nota={`Pagás ${pesos(r.pautaPorVenta)} de publicidad por venta`} tono={r.neta > 0 ? 'bien' : 'mal'} />
          <div className="sm:col-span-2 rounded-2xl border border-[rgba(160,160,220,0.1)] p-4 text-[13px] text-gray-300"
            style={{ background: 'linear-gradient(180deg, #171726, #12121c)' }}>
            <p className="text-[11px] font-extrabold uppercase tracking-[.05em] text-gray-400 mb-2">De dónde sale</p>
            {[['Precio', r.precio], ['Costo del producto', -num(f.costo)], ['Envío', -num(f.envio)], ['Otros', -num(f.otros)], ['Comisión de cobro', -r.comision], ['Impuestos', -r.impuestos]].map(([l, v]) => (
              <div key={l} className="flex justify-between py-1 tabular-nums"><span className="text-gray-400">{l}</span><span>{v < 0 ? `− ${pesos(-v)}` : pesos(v)}</span></div>
            ))}
            <div className="flex justify-between pt-2 mt-1 border-t border-[rgba(160,160,220,0.1)] font-bold tabular-nums"><span>Ganancia por venta</span><span>{pesos(r.ganancia)}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
