// Plan y facturación — esqueleto del sistema de suscripciones.
//
// Muestra el plan actual de la cuenta + créditos IA del mes, y el catálogo de
// planes (los límites vienen del server, /api/billing — única fuente de
// verdad). Todavía NO hay checkout: el CTA junta la intención y el admin de
// plataforma activa el plan a mano desde el panel de abajo (solo él lo ve).

import React, { useCallback, useEffect, useState } from 'react';
import {
  CreditCard, Loader2, Check, Sparkles, RefreshCw, Users, Film,
  TrendingUp, ShieldCheck, Plus,
} from 'lucide-react';
import { authHeaders } from './MetaConnect.jsx';

const fmtFecha = (iso) => iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : null;

async function billing(action, body = {}) {
  const r = await fetch('/api/billing', {
    method: 'POST', headers: await authHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

// Qué incluye cada plan para las cards (features en palabras del artifact de
// monetización; los NÚMEROS salen del server para no duplicar).
const FEATURES = {
  starter: (l) => [`${l.cuentas} cuenta publicitaria · hasta US$${(l.spendUsd / 1000).toFixed(0)}K/mes de inversión`, 'Métricas + Hoy-optimizar + Embudo', `${l.creditos} créditos IA por mes`, `${l.usuarios} usuario`],
  pro: (l) => [`${l.cuentas} cuentas · hasta US$${(l.spendUsd / 1000).toFixed(0)}K/mes de inversión`, 'Winners automáticos + Publicador', 'Producción con editores + Discord', `${l.creditos} créditos IA · ${l.usuarios} usuarios`],
  agencia: (l) => [`${l.cuentas} cuentas · hasta US$${(l.spendUsd / 1000).toFixed(0)}K/mes de inversión`, 'Multi-cliente + equipo ilimitado', `${l.creditos} créditos IA por mes`, 'Marca blanca'],
};

export default function PlanSection({ addToast }) {
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try { setEstado(await billing('estado')); }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const quiero = (plan) => {
    addToast?.({ type: 'info', message: `¡Anotado! El cobro automático está en camino — mientras tanto escribinos y te activamos ${plan} hoy mismo.` });
  };

  if (cargando) return <div className="max-w-4xl mx-auto p-10 flex justify-center"><Loader2 className="animate-spin text-brand-500" /></div>;
  if (error) return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-300">
        No pude traer tu plan: {error}
        <button onClick={cargar} className="ml-3 font-bold underline">Reintentar</button>
      </div>
    </div>
  );

  const { plan, limites, creditos, periodoFin, esAdminPlataforma, planes, pack } = estado;
  const pctUsados = creditos.incluidos > 0 ? Math.min(100, (creditos.usados / creditos.incluidos) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
          <CreditCard size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Plan y facturación</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Tu plan, tus créditos IA del mes y las opciones para crecer.</p>
        </div>
        <button onClick={cargar} title="Actualizar" className="ml-auto p-1.5 rounded text-gray-400 hover:text-brand-500"><RefreshCw size={14} /></button>
      </div>

      {/* Plan actual + créditos */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-brand-400/40 bg-brand-500/5 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><ShieldCheck size={13} className="text-brand-500" /> Tu plan</div>
          <div className="text-2xl font-black text-gray-900 dark:text-gray-100 mt-1">{limites.nombre}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {limites.precioUsd > 0 ? `US$ ${limites.precioUsd}/mes` : plan === 'fundador' ? 'Cuenta fundadora — todo incluido' : 'Gratis mientras probás'}
            {periodoFin ? ` · se renueva el ${fmtFecha(periodoFin)}` : ''}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Sparkles size={13} className="text-amber-500" /> Créditos IA este mes</div>
          <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-gray-100 mt-1">
            {plan === 'fundador' ? '∞' : creditos.restantes}
            {plan !== 'fundador' && <span className="text-sm font-bold text-gray-400"> / {creditos.incluidos}{creditos.extra > 0 ? ` +${creditos.extra} extra` : ''}</span>}
          </div>
          {plan !== 'fundador' && (
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mt-2">
              <div className={`h-full rounded-full ${pctUsados > 85 ? 'bg-amber-500' : 'bg-gradient-to-r from-brand-500 to-brand-400'}`} style={{ width: `${100 - pctUsados}%` }} />
            </div>
          )}
          <div className="text-[10px] text-gray-400 mt-1.5">1 crédito = 1 estático generado o 1 análisis IA. Se renuevan con el plan (no acumulan).</div>
        </div>
      </div>

      {/* Catálogo de planes */}
      <div className="grid sm:grid-cols-3 gap-3">
        {['starter', 'pro', 'agencia'].map(id => {
          const p = planes[id];
          const esActual = plan === id;
          const destacado = id === 'pro';
          return (
            <div key={id} className={`rounded-2xl border p-4 flex flex-col gap-2.5 bg-white dark:bg-gray-900 ${
              destacado ? 'border-brand-500 ring-1 ring-brand-500 shadow-lg shadow-brand-500/10' : 'border-gray-200 dark:border-gray-700/70'}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-gray-900 dark:text-gray-100">{p.nombre}</span>
                {destacado && <span className="text-[9px] font-black uppercase bg-brand-500 text-white rounded-full px-2 py-0.5">Recomendado</span>}
              </div>
              <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-gray-100">US$ {p.precioUsd}<span className="text-xs font-bold text-gray-400"> /mes</span></div>
              <ul className="space-y-1.5 text-[11.5px] text-gray-500 dark:text-gray-400 flex-1">
                {(FEATURES[id]?.(p) || []).map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5"><Check size={12} className="text-emerald-500 shrink-0 mt-0.5" /> {f}</li>
                ))}
              </ul>
              {esActual ? (
                <div className="text-center text-[11px] font-bold text-emerald-500 py-2">✓ Tu plan actual</div>
              ) : (
                <button onClick={() => quiero(p.nombre)}
                  className={`w-full py-2 rounded-xl text-xs font-extrabold transition ${
                    destacado ? 'bg-brand-600 hover:bg-brand-700 text-white' : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-brand-400'}`}>
                  Quiero este plan
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Pack de créditos */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 p-4 flex items-center gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0"><Sparkles size={17} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">Pack de {pack.creditos} créditos — US$ {pack.precioUsd}</div>
          <div className="text-[11px] text-gray-400">Si se te acaban los del mes. Valen hasta la próxima renovación.</div>
        </div>
        <button onClick={() => quiero(`un pack de ${pack.creditos} créditos`)}
          className="px-3 py-2 rounded-xl text-xs font-extrabold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-brand-400 transition">
          Comprar pack
        </button>
      </div>

      <p className="text-[10.5px] text-gray-400">
        El cobro automático (MercadoPago / Stripe) está en construcción — por ahora los planes se activan a mano, al toque.
      </p>

      {esAdminPlataforma && <PanelAdmin addToast={addToast} onCambio={cargar} planes={planes} />}
    </div>
  );
}

// Panel del admin de plataforma: asignar planes y packs a mano (hasta que
// exista el checkout) y ver todas las suscripciones.
function PanelAdmin({ addToast, onCambio, planes }) {
  const [lista, setLista] = useState(null);
  const [email, setEmail] = useState('');
  const [planSel, setPlanSel] = useState('pro');
  const [busy, setBusy] = useState(false);

  const cargarLista = useCallback(async () => {
    try { const d = await billing('admin-list'); setLista(d.suscripciones || []); } catch { setLista([]); }
  }, []);
  useEffect(() => { cargarLista(); }, [cargarLista]);

  const correr = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); addToast?.({ type: 'success', message: okMsg }); setEmail(''); cargarLista(); onCambio?.(); }
    catch (e) { addToast?.({ type: 'error', message: e.message }); }
    finally { setBusy(false); }
  };

  const inp = 'px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-gray-900 dark:text-gray-100';

  return (
    <div className="rounded-2xl border border-dashed border-brand-400/50 p-4 space-y-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-brand-500 flex items-center gap-1.5"><Users size={13} /> Admin de plataforma — activar planes a mano</div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inp} flex-1 min-w-[220px]`} placeholder="email de la cuenta" value={email} onChange={e => setEmail(e.target.value)} />
        <select className={inp} value={planSel} onChange={e => setPlanSel(e.target.value)}>
          {Object.entries(planes).map(([id, p]) => <option key={id} value={id}>{p.nombre}{p.precioUsd ? ` · US$${p.precioUsd}` : ''}</option>)}
        </select>
        <button disabled={busy || !email} onClick={() => correr(() => billing('admin-set-plan', { email, plan: planSel }), `Plan ${planSel} activado para ${email}`)}
          className="px-3 py-2 rounded-lg text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition">
          {busy ? <Loader2 size={13} className="animate-spin" /> : 'Activar plan'}
        </button>
        <button disabled={busy || !email} onClick={() => correr(() => billing('admin-pack', { email, packs: 1 }), `+100 créditos para ${email}`)}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-extrabold border border-amber-400/60 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 transition">
          <Plus size={12} /> Pack 100
        </button>
      </div>
      {lista === null ? (
        <div className="text-xs text-gray-400">Cargando suscripciones…</div>
      ) : lista.length === 0 ? (
        <div className="text-xs text-gray-400">Todavía no hay suscripciones asignadas — todos están en Prueba.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] font-bold uppercase text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-1.5 pr-3">Cuenta</th><th className="text-left py-1.5 pr-3">Plan</th>
              <th className="text-left py-1.5 pr-3">Estado</th><th className="text-right py-1.5 pr-3">Créditos usados</th>
              <th className="text-right py-1.5">Renueva</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {lista.map(s => (
                <tr key={s.user_id}>
                  <td className="py-1.5 pr-3 font-semibold text-gray-800 dark:text-gray-100">{s.email}</td>
                  <td className="py-1.5 pr-3 capitalize">{s.plan}</td>
                  <td className="py-1.5 pr-3">{s.estado}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.creditos_usados}{s.creditos_extra > 0 ? ` (+${s.creditos_extra})` : ''}</td>
                  <td className="py-1.5 text-right">{fmtFecha(s.periodo_fin) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
