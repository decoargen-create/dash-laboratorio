// Testeos — el tablero de KPIs de la cuenta publicitaria.
//
// Tres preguntas, tres pestañas:
//   Hoy      → qué pausar ahora y cuánta plata salva hacerlo.
//   Semanas  → cómo rindió cada tanda de testeos (eficiencia por cohorte).
//   Prospect → qué anuncios siguen trayendo gente nueva.
//   Reglas   → la nomenclatura y los umbrales de ESTA tienda.
//
// Todo el cálculo vive en testeosCore.js (puro y testeado). Acá solo se pide
// la data cruda una vez y se dibuja: mover un umbral en Reglas recalcula el
// tablero entero sin volver a pegarle a Meta.
//
// Cada número trae su fórmula: el botón "i" abre qué cuenta se hizo y con qué
// datos. La idea es poder auditar una métrica en vez de creerle.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, RefreshCw, AlertCircle, ChevronDown, ChevronRight, Plug, X,
  FlaskConical, Radar, Gauge, SlidersHorizontal, ExternalLink, Clock,
} from 'lucide-react';
import {
  useMetaConnections, useMetaAdAccounts, authHeaders, openMetaConnect,
} from './MetaConnect.jsx';
import {
  CFG_DEFAULT, cfgPara, cohortesSemanales, rondaDeOptimizacion, esProspectador,
  productoDeCampana, linkMeta, FORMULAS,
  fusionarConFotos, cohortesParaCongelar, fotoDeCohorte,
} from './testeosCore.js';
import { cargarCfg, guardarCfg, cargarFotos, guardarFotos, leerCfgLocal } from './testeosStore.js';

const LS_ACCOUNT = 'adslab-testeos-account';
const LS_PRESET = 'adslab-testeos-preset';

const PRESETS = [
  { value: 'last_30d', label: 'Últimos 30 días' },
  { value: 'last_90d', label: 'Últimos 90 días' },
  { value: 'this_month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes pasado' },
  { value: 'maximum', label: 'Histórico' },
];

function readProductos() {
  try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]'); }
  catch { return []; }
}

// ── formato ──
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString('es-AR');
const fmtR = (n) => (Number(n) || 0).toFixed(2);
const fmtP = (n, d = 0) => `${(Number(n) || 0).toFixed(d)}%`;
function fmtM(n, cur) {
  if (n == null) return '—';
  const v = Math.round(Number(n) || 0);
  const s = v >= 10000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}K` : v.toLocaleString('es-AR');
  return cur ? `${s} ${cur}` : `$${s}`;
}
const fmts = (cur) => ({ money: (v) => fmtM(v, cur), num: (v, d = 0) => (d ? Number(v || 0).toFixed(d) : fmtN(v)), pct: fmtP });

// ========================================================================
// Botón "i" + modal de fórmula
// ========================================================================
function Why({ k, datos, cfg, currency, onOpen }) {
  const f = FORMULAS[k];
  if (!f) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen({ k, datos, cfg, currency }); }}
      title="Cómo se calcula"
      className="w-[15px] h-[15px] shrink-0 rounded-full border border-gray-300 dark:border-gray-600 text-[9px] font-bold text-gray-400 hover:text-brand-500 hover:border-brand-500 transition inline-grid place-items-center"
    >i</button>
  );
}

function FormulaModal({ open, onClose }) {
  if (!open) return null;
  const f = FORMULAS[open.k];
  const ff = fmts(open.currency);
  let calculo = null;
  try { calculo = f.calculo ? f.calculo(open.datos || {}, ff, open.cfg || CFG_DEFAULT) : null; } catch { calculo = null; }
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex-1">{f.label}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-3">
            <p className="text-[9.5px] font-bold uppercase tracking-[.09em] text-gray-400 mb-1">Fórmula</p>
            <p className="font-mono text-[13px] text-brand-600 dark:text-brand-300 break-words">{f.formula}</p>
          </div>
          {calculo && (
            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-3">
              <p className="text-[9.5px] font-bold uppercase tracking-[.09em] text-gray-400 mb-1">Con tus números</p>
              <p className="font-mono text-[13px] text-gray-900 dark:text-gray-100 break-words">{calculo}</p>
            </div>
          )}
          {f.nota && <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{f.nota}</p>}
        </div>
      </div>
    </div>
  );
}

// ── piezas chicas ──
function Kpi({ label, value, sub, tone = '', children }) {
  const tones = { ok: 'text-emerald-600 dark:text-emerald-400', bad: 'text-red-600 dark:text-red-400', warn: 'text-amber-600 dark:text-amber-400' };
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[9.5px] font-bold uppercase tracking-[.09em] text-gray-400 truncate">{label}</p>
        {children}
      </div>
      <p className={`text-[22px] font-bold tabular-nums leading-tight mt-1 ${tones[tone] || 'text-gray-900 dark:text-gray-100'}`}>{value}</p>
      {sub && <p className="text-[10.5px] text-gray-500 dark:text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

function Pill({ tone, children }) {
  const t = {
    ok: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    bad: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    warn: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    mute: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  }[tone] || 'bg-gray-100 dark:bg-gray-700 text-gray-600';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${t}`}>{children}</span>;
}

function Bar({ pct, tone }) {
  const c = { ok: 'bg-emerald-500', bad: 'bg-red-500', warn: 'bg-amber-500' }[tone] || 'bg-brand-500';
  return (
    <span className="inline-block w-14 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden align-middle">
      <span className={`block h-full rounded-full ${c}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

const MetaLink = ({ nivel, ids, accountId, desde, hasta, children, solid }) => (
  <a href={linkMeta({ accountId, nivel, ids, desde, hasta })} target="_blank" rel="noreferrer"
    onClick={e => e.stopPropagation()}
    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-bold whitespace-nowrap transition ${
      solid ? 'bg-[#1877F2] text-white hover:bg-[#0f6ae0]'
        : 'border border-[#1877F2]/40 text-[#1877F2] dark:text-[#93BBFB] hover:bg-[#1877F2]/10'}`}>
    {children} <ExternalLink size={9} />
  </a>
);

// ========================================================================
// Pestaña: HOY (ronda de optimización)
// ========================================================================
function VistaHoy({ ads, cfg, currency, accountId, onWhy, nivel, setNivel }) {
  const [abierto, setAbierto] = useState(null);
  const r = useMemo(() => rondaDeOptimizacion(ads, { cfg }), [ads, cfg]);
  const esCampana = nivel === 'campaigns';

  const selectorNivel = (
    <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
      {[{ id: 'campaigns', l: 'Campañas' }, { id: 'ads', l: 'Anuncios' }].map(o => (
        <button key={o.id} onClick={() => setNivel(o.id)}
          className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition ${
            nivel === o.id ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );

  if (ads.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{selectorNivel}</div>
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
          <Clock size={24} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Todavía no hay entrega hoy</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Meta no devolvió {esCampana ? 'ninguna campaña' : 'ningún anuncio'} con datos de hoy en esta cuenta.
          </p>
        </div>
      </div>
    );
  }

  const filas = r.evaluados.slice().sort((a, b) =>
    (b.pausa.candidato - a.pausa.candidato) || ((b.pausa.plataEnRiesgo || 0) - (a.pausa.plataEnRiesgo || 0)));

  return (
    <div className="space-y-3">
      {r.temprano && (
        <div className="flex gap-2.5 items-start p-3 rounded-xl text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
          <Clock size={15} className="shrink-0 mt-0.5" />
          <span>Son las <b>{r.hora}:00</b> en Argentina. El día publicitario todavía no maduró — a esta hora casi todo parece un desastre. La ronda se mira a partir de las {cfg.horaMinimaPausar}:00.</span>
        </div>
      )}

      {!esCampana && r.plataRedirigible > 0 && (
        <div className="flex gap-2.5 items-start p-3 rounded-xl text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>
            Estás mirando <b>anuncios</b>, pero varios están dentro de campañas con presupuesto CBO: pausar uno ahí
            no ahorra plata, la campaña gasta lo mismo repartido entre los que quedan. Sirve para redirigir hacia los
            que venden. Si lo que querés es <b>bajar el gasto</b>, mirá el nivel <b>Campañas</b>.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
        <Kpi label="Plata en juego" value={fmtM(r.plataEnJuego, currency)} tone="bad"
          sub={r.plataRedirigible > 0 && r.ahorroPotencial > 0
            ? `${fmtM(r.ahorroPotencial, currency)} se ahorra · ${fmtM(r.plataRedirigible, currency)} se redirige`
            : r.plataRedirigible > 0
              ? `se redirige a los otros anuncios (presupuesto de campaña)`
              : `${r.aPausar.length} anuncio${r.aPausar.length === 1 ? '' : 's'} para pausar`}>
          <Why k="plataEnRiesgo" cfg={cfg} currency={currency} onOpen={onWhy}
            datos={r.aPausar[0]?.pausa ? { ...r.aPausar[0].pausa, gastoHoy: r.aPausar[0].insights.spend } : {}} />
        </Kpi>
        <Kpi label="Gastado hoy" value={fmtM(r.promedios.spend, currency)}
          sub={`${ads.length} anuncios con entrega`} />
        <Kpi label="ROAS del día" value={fmtR(r.promedios.roas)}
          tone={r.promedios.roas >= (cfg.roasMaxPausar || 1) ? 'ok' : 'bad'}
          sub={`${fmtM(r.promedios.revenue, currency)} facturado`}>
          <Why k="roas" datos={r.promedios} cfg={cfg} currency={currency} onOpen={onWhy} />
        </Kpi>
        <Kpi label="Costo por carrito" value={fmtM(r.promedios.costoPorATC, currency)} sub="promedio de la cuenta">
          <Why k="promedioCuenta" datos={r.promedios} cfg={cfg} currency={currency} onOpen={onWhy} />
        </Kpi>
        <Kpi label="Costo por pago" value={fmtM(r.promedios.costoPorCheckout, currency)}
          sub={`umbral ${fmtM((r.promedios.costoPorCheckout || 0) * (1 + cfg.sobrePromedioPct / 100), currency)}`}>
          <Why k="costoPorCheckout" datos={r.promedios} cfg={cfg} currency={currency} onOpen={onWhy} />
        </Kpi>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
          <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Ronda de optimización</h3>
          <Why k="pausar" cfg={cfg} currency={currency} onOpen={onWhy} datos={{}} />
          <span className="text-[10.5px] text-gray-400">ordenado por la plata que está en juego</span>
          <span className="ml-auto flex items-center gap-2">
            {selectorNivel}
            {r.aPausar.length > 0 && (
              <MetaLink nivel={nivel} ids={r.aPausar.map(a => a.id)} accountId={accountId} solid>
                Abrir {r.aPausar.length} en Meta
              </MetaLink>
            )}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-400 text-[9.5px] uppercase tracking-wider">
                <th className="text-left font-bold px-3.5 py-2">{esCampana ? 'Campaña' : 'Anuncio'}</th>
                <th className="text-left font-bold px-2 py-2">Veredicto</th>
                <th className="text-right font-bold px-2 py-2">Gasto</th>
                <th className="text-right font-bold px-2 py-2">ROAS</th>
                <th className="text-right font-bold px-2 py-2">Carrito</th>
                <th className="text-right font-bold px-2 py-2">Pago</th>
                <th className="text-right font-bold px-2 py-2">Presup.</th>
                <th className="text-right font-bold px-2 py-2">En juego</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {filas.map(a => {
                const p = a.pausa, i = a.insights;
                const open = abierto === a.id;
                const tone = p.accion === 'pausar' ? 'bad' : p.accion === 'dejar-correr' ? 'warn'
                  : i.spend < cfg.pisoGastoPausar ? 'mute' : 'ok';
                const label = p.accion === 'pausar' ? 'Pausar' : p.accion === 'dejar-correr' ? 'Dejalo correr'
                  : i.spend < cfg.pisoGastoPausar ? 'Sin datos aún' : 'Va bien';
                return (
                  <React.Fragment key={a.id}>
                    <tr onClick={() => setAbierto(open ? null : a.id)}
                      className={`cursor-pointer transition ${open ? 'bg-gray-50 dark:bg-gray-900/40' : 'hover:bg-gray-50 dark:hover:bg-gray-900/30'}`}>
                      <td className="px-3.5 py-2 max-w-[260px]">
                        <div className="flex items-center gap-2">
                          {open ? <ChevronDown size={13} className="text-brand-500 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                          <span className="min-w-0">
                            <span className="block font-semibold text-gray-900 dark:text-gray-100 truncate">{a.name}</span>
                            {!esCampana && <span className="block text-[10px] text-gray-400 truncate">{a.campaignName}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2"><Pill tone={tone}>{label}</Pill></td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">{fmtM(i.spend, currency)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums font-semibold ${i.roas >= p.cortes?.roasMaxPausar ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmtR(i.roas)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.costoATC != null ? fmtM(p.costoATC, currency) : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.costoCheckout != null ? fmtM(p.costoCheckout, currency) : '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {p.consumidoPct != null ? (
                          <><span className="tabular-nums text-[10.5px] text-gray-500 mr-1.5">{fmtP(p.consumidoPct)}</span>
                            <Bar pct={p.consumidoPct} tone={p.consumidoPct >= cfg.consumoAltoPct ? 'warn' : undefined} /></>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums font-bold ${p.accion === 'pausar' ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                        {p.restante != null ? fmtM(p.restante, currency) : '—'}
                        {p.restante != null && p.accion === 'pausar' && (
                          <span className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide"
                            title={p.efecto === 'redirige'
                              ? 'El presupuesto es de la campaña: pausarlo no ahorra, manda esa plata a los otros anuncios.'
                              : 'El presupuesto es propio: pausarlo lo ahorra.'}>
                            {p.efecto === 'redirige' ? 'se redirige' : 'se ahorra'}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right"><MetaLink nivel={nivel} ids={[a.id]} accountId={accountId}>Meta</MetaLink></td>
                    </tr>
                    {open && (
                      <tr><td colSpan={9} className="bg-gray-50/60 dark:bg-gray-900/40 px-3.5 py-3">
                        <div className="pl-5 space-y-1.5">
                          {p.condiciones.map((c, n) => (
                            <div key={n} className="flex items-start gap-2 text-[11.5px]">
                              <span className={`w-[15px] h-[15px] rounded-full grid place-items-center text-[9px] font-bold shrink-0 mt-px ${
                                c.ok ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-400'}`}>
                                {c.ok ? '✓' : '·'}
                              </span>
                              <span className="text-gray-600 dark:text-gray-300">{c.texto}</span>
                            </div>
                          ))}
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 border-l-2 border-gray-200 dark:border-gray-700 pl-2.5 mt-2 flex items-center gap-1.5 flex-wrap">
                            {p.motivoAccion || 'No cumple las cuatro condiciones: no es candidato.'}
                            {p.compartido && <span className="text-gray-400">· presupuesto compartido a nivel {p.nivelPresupuesto || 'campaña'}</span>}
                            <Why k="plataEnRiesgo" cfg={cfg} currency={currency} onOpen={onWhy} datos={{ ...p, gastoHoy: i.spend }} />
                          </p>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ========================================================================
// Pestaña: SEMANAS (cohortes de testeo)
// ========================================================================
function VistaSemanas({ campaigns, cfg, productos, productoId, currency, accountId, onWhy, fotos }) {
  const [abierto, setAbierto] = useState(null);
  const filas = useMemo(() => {
    const { filas: vivas } = cohortesSemanales(campaigns, { cfg, productos, productoId });
    return fusionarConFotos(vivas, fotos || {});
  }, [campaigns, cfg, productos, productoId, fotos]);

  if (filas.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
        <FlaskConical size={24} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ninguna campaña entra como testeo</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Revisá las palabras de la nomenclatura en <b>Reglas</b>: ahí se ve campaña por campaña por qué entró o quedó afuera.
        </p>
      </div>
    );
  }

  const finDe = (lunes) => {
    const [y, m, d] = lunes.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 6));
    return dt.toISOString().slice(0, 10);
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
        <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Testeos por semana</h3>
        <Why k="cohorte" cfg={cfg} currency={currency} onOpen={onWhy} datos={{ name: filas[0]?.items[0]?.name, fecha: filas[0]?.items[0]?.fecha, semana: filas[0]?.semana }} />
        <span className="text-[10.5px] text-gray-400">lunes a domingo, según la fecha del nombre</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-400 text-[9.5px] uppercase tracking-wider">
              <th className="text-left font-bold px-3.5 py-2">Cohorte</th>
              <th className="text-left font-bold px-2 py-2">Eficiencia</th>
              <th className="text-right font-bold px-2 py-2">Ganó</th>
              <th className="text-right font-bold px-2 py-2">Perdió</th>
              <th className="text-right font-bold px-2 py-2">Sin datos</th>
              <th className="text-right font-bold px-2 py-2">Gasto</th>
              <th className="text-right font-bold px-2 py-2">Facturado</th>
              <th className="text-right font-bold px-2 py-2">ROAS</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {filas.map(f => {
              const open = abierto === f.semana;
              const tone = f.eficiencia >= 50 ? 'ok' : f.eficiencia >= 30 ? 'warn' : 'bad';
              return (
                <React.Fragment key={f.semana || 'sin'}>
                  <tr onClick={() => setAbierto(open ? null : f.semana)}
                    className={`cursor-pointer transition ${open ? 'bg-gray-50 dark:bg-gray-900/40' : 'hover:bg-gray-50 dark:hover:bg-gray-900/30'}`}>
                    <td className="px-3.5 py-2">
                      <div className="flex items-center gap-2">
                        {open ? <ChevronDown size={13} className="text-brand-500 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                        <span>
                          <span className="flex items-center gap-1.5">
                            <span className="font-semibold text-gray-900 dark:text-gray-100">Semana {f.etiqueta}</span>
                            {f.cerrada
                              ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                                  title="Número congelado: la semana ya pasó los días de atribución de Meta.">CERRADA</span>
                              : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                  title="Todavía sumando compras: Meta atribuye hasta 7 días después del click.">EN VIVO</span>}
                            <Why k="foto" cfg={cfg} currency={currency} onOpen={onWhy} datos={f} />
                          </span>
                          <span className="block text-[10px] text-gray-400">
                            {f.lanzadas} testeo{f.lanzadas === 1 ? '' : 's'} · {f.activas} sigue{f.activas === 1 ? '' : 'n'} prendida{f.activas === 1 ? '' : 's'}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className={`tabular-nums font-bold mr-1.5 ${tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{fmtP(f.eficiencia)}</span>
                      <Bar pct={f.eficiencia} tone={tone} />
                    </td>
                    <td className="px-2 py-2 text-right"><Pill tone="ok">{f.ganadoras}</Pill></td>
                    <td className="px-2 py-2 text-right"><Pill tone="bad">{f.perdedoras}</Pill></td>
                    <td className="px-2 py-2 text-right"><Pill tone="mute">{f.sinDatos}</Pill></td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtM(f.totales.spend, currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtM(f.totales.revenue, currency)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums font-bold ${f.totales.roas >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmtR(f.totales.roas)}</td>
                    <td className="px-2 py-2 text-right">
                      <MetaLink nivel="campaigns" accountId={accountId}
                        ids={f.idsGanadoras.length ? f.idsGanadoras : f.idsTodas}
                        desde={f.semana} hasta={f.semana ? finDe(f.semana) : null}>
                        {f.idsGanadoras.length ? `Ver ${f.idsGanadoras.length} ganadora${f.idsGanadoras.length === 1 ? '' : 's'}` : 'Ver en Meta'}
                      </MetaLink>
                    </td>
                  </tr>
                  {open && (
                    <tr><td colSpan={9} className="bg-gray-50/60 dark:bg-gray-900/40 px-3.5 py-3">
                      <div className="pl-5 space-y-1.5">
                        {f.items.map(c => (
                          <div key={c.id} className="flex items-center gap-2 text-[11.5px] flex-wrap">
                            <span className="font-semibold text-gray-900 dark:text-gray-100">{c.name}</span>
                            <span className="text-gray-500 dark:text-gray-400">· {c.veredicto.motivo}</span>
                            {c.producto && <span className="text-gray-400">· {c.producto.nombre}</span>}
                            <Pill tone={c.veredicto.estado === 'ganador' ? 'ok' : c.veredicto.estado === 'perdedor' ? 'bad' : 'mute'}>
                              {c.veredicto.estado === 'ganador' ? 'Ganadora' : c.veredicto.estado === 'perdedor' ? 'Perdedora' : 'Sin datos'}
                            </Pill>
                            <span className="tabular-nums text-gray-500 ml-auto">{fmtM(c.insights?.spend, currency)}</span>
                            <MetaLink nivel="campaigns" ids={[c.id]} accountId={accountId}>Meta</MetaLink>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3.5 py-2 border-t border-gray-100 dark:border-gray-700/60 flex items-center gap-3 flex-wrap text-[10.5px] text-gray-400">
        <span className="flex items-center gap-1">Eficiencia <Why k="eficiencia" cfg={cfg} currency={currency} onOpen={onWhy} datos={filas[0]} /></span>
        <span className="flex items-center gap-1">Ganadora <Why k="ganador" cfg={cfg} currency={currency} onOpen={onWhy} datos={filas[0]?.items[0]?.insights || {}} /></span>
        <span className="flex items-center gap-1">Sin datos <Why k="sinDatos" cfg={cfg} currency={currency} onOpen={onWhy} datos={filas[0]?.items[0]?.insights || {}} /></span>
        <span className="flex items-center gap-1">Qué entra <Why k="testeo" cfg={cfg} currency={currency} onOpen={onWhy} datos={filas[0]?.items[0] || {}} /></span>
      </div>
    </div>
  );
}

// ========================================================================
// Pestaña: PROSPECTADORES
// ========================================================================
function VistaProspectadores({ ads, cfg, currency, accountId, onWhy }) {
  const [abierto, setAbierto] = useState(null);
  const lista = useMemo(() => ads
    .map(a => ({ ...a, ...esProspectador(a.insights, cfg) }))
    .sort((a, b) => (b.es - a.es) || (b.insights.reach - a.insights.reach)), [ads, cfg]);
  const si = lista.filter(a => a.es);

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
        <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Prospectadores</h3>
        <Why k="prospectador" cfg={cfg} currency={currency} onOpen={onWhy} datos={{}} />
        <span className="text-[10.5px] text-gray-400 flex items-center gap-1">
          últimos 7 días · frecuencia <Why k="frecuencia" cfg={cfg} currency={currency} onOpen={onWhy} datos={lista[0]?.insights || {}} />
        </span>
        {si.length > 0 && (
          <span className="ml-auto"><MetaLink nivel="ads" ids={si.map(a => a.id)} accountId={accountId} solid>Abrir {si.length} en Meta</MetaLink></span>
        )}
      </div>
      {si.length === 0 && lista.length > 0 && (
        <div className="mx-3.5 mt-3 p-3 rounded-xl text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
          Ningún anuncio califica como prospectador con las reglas actuales. Suele significar que la cuenta está viviendo de audiencias ya trabajadas.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-400 text-[9.5px] uppercase tracking-wider">
              <th className="text-left font-bold px-3.5 py-2">Anuncio</th>
              <th className="text-left font-bold px-2 py-2">Veredicto</th>
              <th className="text-right font-bold px-2 py-2">Frecuencia</th>
              <th className="text-right font-bold px-2 py-2">Alcance</th>
              <th className="text-right font-bold px-2 py-2">Compras</th>
              <th className="text-right font-bold px-2 py-2">ROAS</th>
              <th className="text-right font-bold px-2 py-2">Gasto 7d</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {lista.slice(0, 60).map(a => {
              const i = a.insights, open = abierto === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr onClick={() => setAbierto(open ? null : a.id)}
                    className={`cursor-pointer transition ${open ? 'bg-gray-50 dark:bg-gray-900/40' : 'hover:bg-gray-50 dark:hover:bg-gray-900/30'}`}>
                    <td className="px-3.5 py-2 max-w-[260px]">
                      <div className="flex items-center gap-2">
                        {open ? <ChevronDown size={13} className="text-brand-500 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                        <span className="min-w-0">
                          <span className="block font-semibold text-gray-900 dark:text-gray-100 truncate">{a.name}</span>
                          <span className="block text-[10px] text-gray-400 truncate">{a.campaignName}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2">{a.es ? <Pill tone="ok">Prospectador</Pill> : <Pill tone="mute">No</Pill>}</td>
                    <td className={`px-2 py-2 text-right tabular-nums font-semibold ${i.frequency > 0 && i.frequency <= cfg.maxFrecuenciaProsp ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{fmtR(i.frequency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtN(i.reach)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{i.purchases}</td>
                    <td className={`px-2 py-2 text-right tabular-nums font-semibold ${i.roas >= cfg.minRoasProsp ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`}>{fmtR(i.roas)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtM(i.spend, currency)}</td>
                    <td className="px-2 py-2 text-right"><MetaLink nivel="ads" ids={[a.id]} accountId={accountId}>Meta</MetaLink></td>
                  </tr>
                  {open && (
                    <tr><td colSpan={8} className="bg-gray-50/60 dark:bg-gray-900/40 px-3.5 py-3">
                      <div className="pl-5 space-y-1.5">
                        {a.checks.map((c, n) => (
                          <div key={n} className="flex items-start gap-2 text-[11.5px]">
                            <span className={`w-[15px] h-[15px] rounded-full grid place-items-center text-[9px] font-bold shrink-0 mt-px ${
                              c.ok ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-400'}`}>
                              {c.ok ? '✓' : '✗'}
                            </span>
                            <span className="text-gray-600 dark:text-gray-300">{c.texto}</span>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ========================================================================
// Pestaña: REGLAS de la tienda
// ========================================================================
function VistaReglas({ campaigns, cfg, setCfg, productos, currency, onWhy, origen }) {
  const { enriquecidas } = useMemo(() => cohortesSemanales(campaigns, { cfg, productos }), [campaigns, cfg, productos]);
  const grupos = { testeo: [], excluida: [], 'sin-fecha': [], otra: [] };
  enriquecidas.forEach(c => { (grupos[c.tipo] || grupos.otra).push(c); });

  const set = (k) => (e) => {
    const v = e.target.value;
    setCfg(c => ({ ...c, [k]: v === '' ? null : (isNaN(Number(v)) ? v : Number(v)) }));
  };
  const setLista = (k) => (e) => setCfg(c => ({ ...c, [k]: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }));
  const setProd = (pid, campo) => (e) => {
    const v = e.target.value;
    const valor = campo === 'alias'
      ? v.split(',').map(x => x.trim()).filter(Boolean)
      : (v === '' ? null : Number(v));
    setCfg(c => ({ ...c, porProducto: { ...(c.porProducto || {}), [pid]: { ...(c.porProducto?.[pid] || {}), [campo]: valor } } }));
  };

  // Cuántas campañas engancha cada producto con las reglas de ahora. Es la
  // devolución inmediata de si el alias que acabás de escribir sirve.
  const conteoPorProducto = useMemo(() => {
    const m = {};
    for (const c of enriquecidas) {
      const id = c.producto?.id;
      if (!id) { m.__sin = (m.__sin || 0) + 1; continue; }
      m[id] = (m[id] || 0) + 1;
    }
    return m;
  }, [enriquecidas]);

  const Campo = ({ label, help, children }) => (
    <label className="grid gap-1">
      <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-gray-400">{label}</span>
      {children}
      {help && <span className="text-[10px] text-gray-400 leading-snug">{help}</span>}
    </label>
  );
  const inputCls = "w-full px-2.5 py-1.5 text-xs font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="space-y-3">
      <div className="flex gap-2.5 items-start p-3 rounded-xl text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
        <SlidersHorizontal size={15} className="shrink-0 mt-0.5" />
        <span>Esto se guarda <b>por cuenta publicitaria</b> y en la nube, así te sigue entre dispositivos: otra tienda carga su nomenclatura y sus ROAS de equilibrio y el mismo tablero le sirve. Cambiá cualquier valor y mirá las otras pestañas — se recalcula al instante.</span>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60">
          <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Nomenclatura</h3>
          {origen === 'local' && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
              title="Todavía no se pudo guardar en la nube: por ahora vive solo en este navegador.">SOLO EN ESTE NAVEGADOR</span>
          )}
          <Why k="testeo" cfg={cfg} currency={currency} onOpen={onWhy} datos={grupos.testeo[0] || {}} />
          <span className="text-[10.5px] text-gray-400">qué campañas entran como testeo</span>
        </div>
        <div className="grid md:grid-cols-2 gap-3 p-3.5">
          <Campo label="Palabras de testeo" help="Si el nombre contiene alguna, es testeo.">
            <input className={inputCls} value={(cfg.palabrasTesteo || []).join(', ')} onChange={setLista('palabrasTesteo')} />
          </Campo>
          <Campo label="Palabras a excluir" help="Las de escala. Ganan sobre las anteriores.">
            <input className={inputCls} value={(cfg.palabrasExcluir || []).join(', ')} onChange={setLista('palabrasExcluir')} />
          </Campo>
        </div>
        <div className="grid md:grid-cols-2 gap-3 px-3.5 pb-3.5">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[.08em] text-gray-400 mb-1.5">Entran como testeo ({grupos.testeo.length})</p>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {grupos.testeo.length === 0 && <p className="text-[11px] text-gray-400">Ninguna</p>}
              {grupos.testeo.map(c => (
                <div key={c.id} className="flex items-center gap-2 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-mono truncate max-w-[220px]">{c.name}</span>
                  <span className="text-gray-400 truncate">{c.tipoMotivo}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[.08em] text-gray-400 mb-1.5">
              Quedan afuera ({grupos.excluida.length + grupos['sin-fecha'].length + grupos.otra.length})
            </p>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {[...grupos.excluida, ...grupos['sin-fecha'], ...grupos.otra].map(c => (
                <div key={c.id} className="flex items-center gap-2 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono truncate max-w-[220px]">{c.name}</span>
                  <span className="text-gray-400 truncate">{c.tipoMotivo}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60">
          <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">ROAS de equilibrio por producto</h3>
          <Why k="breakeven" cfg={cfg} currency={currency} onOpen={onWhy} datos={{ roasBreakevenManual: cfg.porProducto?.[productos[0]?.id]?.roasBreakeven }} />
          <span className="text-[10.5px] text-gray-400">el que anotás vos para cada producto</span>
        </div>
        <div className="grid md:grid-cols-3 gap-3 p-3.5">
          {productos.length === 0 && <p className="text-[11px] text-gray-400">No hay productos cargados en AdsLab todavía.</p>}
          {productos.map(p => {
            const ef = cfgPara(cfg, p.id);
            return (
              <Campo key={p.id} label={p.nombre}
                help={`Ganador desde ${fmtR(ef.minRoasGanador)} · pausar por debajo de ${fmtR(ef.roasMaxPausar)}`}>
                <input className={inputCls} type="number" step="0.05" placeholder="ej. 1.90"
                  value={cfg.porProducto?.[p.id]?.roasBreakeven ?? ''} onChange={setProd(p.id, 'roasBreakeven')} />
              </Campo>
            );
          })}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
          <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Cómo se reconoce cada producto</h3>
          <Why k="producto" cfg={cfg} currency={currency} onOpen={onWhy}
            datos={{ name: enriquecidas[0]?.name, producto: enriquecidas[0]?.producto }} />
          <span className="text-[10.5px] text-gray-400">
            palabras que, si aparecen en el nombre de la campaña, la asignan a ese producto
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-3 p-3.5">
          {productos.map(p => {
            const n = conteoPorProducto[p.id] || 0;
            return (
              <Campo key={p.id} label={p.nombre}
                help={n > 0
                  ? `${n} campaña${n === 1 ? '' : 's'} asignada${n === 1 ? '' : 's'} con las reglas de ahora`
                  : 'Ninguna campaña engancha todavía — probá con una abreviatura'}>
                <input className={inputCls} type="text" placeholder="ej. aceit, oil"
                  value={(cfg.porProducto?.[p.id]?.alias || []).join(', ')} onChange={setProd(p.id, 'alias')} />
              </Campo>
            );
          })}
        </div>
        {conteoPorProducto.__sin > 0 && (
          <p className="px-3.5 pb-3.5 text-[11px] text-amber-600 dark:text-amber-400">
            {conteoPorProducto.__sin} campaña{conteoPorProducto.__sin === 1 ? '' : 's'} sin producto reconocido.
            Aparecen igual en los totales, pero no se pueden filtrar por producto hasta que les cargues una palabra acá.
          </p>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60">
          <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Umbrales</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-3 p-3.5">
          <Campo label="Compras mínimas (ganador)"><input className={inputCls} type="number" value={cfg.minComprasGanador} onChange={set('minComprasGanador')} /></Campo>
          <Campo label="ROAS mínimo (ganador)" help="Se ignora si el producto tiene equilibrio cargado."><input className={inputCls} type="number" step="0.1" value={cfg.minRoasGanador ?? ''} onChange={set('minRoasGanador')} /></Campo>
          <Campo label="Impresiones mínimas" help="Debajo de esto: «sin datos», no «perdedora»."><input className={inputCls} type="number" value={cfg.minImpresiones} onChange={set('minImpresiones')} /></Campo>
          <Campo label={`Piso de gasto para pausar (${currency || 'moneda de la cuenta'})`} help="Debajo de esto no tuvo chance."><input className={inputCls} type="number" value={cfg.pisoGastoPausar} onChange={set('pisoGastoPausar')} /></Campo>
          <Campo label="% por encima del promedio" help="Cuánto peor que la cuenta para ser candidato."><input className={inputCls} type="number" value={cfg.sobrePromedioPct} onChange={set('sobrePromedioPct')} /></Campo>
          <Campo label="Hora de corte" help="Antes de esta hora avisa que el día no maduró."><input className={inputCls} type="number" value={cfg.horaMinimaPausar} onChange={set('horaMinimaPausar')} /></Campo>
          <Campo label="Frecuencia máxima (prospectador)"><input className={inputCls} type="number" step="0.05" value={cfg.maxFrecuenciaProsp} onChange={set('maxFrecuenciaProsp')} /></Campo>
          <Campo label="ROAS mínimo (prospectador)"><input className={inputCls} type="number" step="0.1" value={cfg.minRoasProsp} onChange={set('minRoasProsp')} /></Campo>
          <Campo label="Alcance mínimo (prospectador)"><input className={inputCls} type="number" value={cfg.minAlcanceProsp} onChange={set('minAlcanceProsp')} /></Campo>
        </div>
      </div>
    </div>
  );
}

// ========================================================================
// Sección
// ========================================================================
export default function TesteosSection({ addToast }) {
  const { connections, loading: connLoading } = useMetaConnections();
  const { accounts, loading: acctLoading } = useMetaAdAccounts(connections);
  const [productos] = useState(() => readProductos());

  const [accountId, setAccountId] = useState(() => { try { return localStorage.getItem(LS_ACCOUNT) || ''; } catch { return ''; } });
  const [preset, setPreset] = useState(() => { try { return localStorage.getItem(LS_PRESET) || 'last_90d'; } catch { return 'last_90d'; } });
  const [productoId, setProductoId] = useState('');
  const [tab, setTab] = useState('hoy');
  // En estas cuentas los testeos son CBO: el presupuesto vive en la campaña,
  // así que el nivel donde la decisión de pausar realmente ahorra plata es
  // campaña. Por eso arranca ahí.
  const [nivelHoy, setNivelHoy] = useState('campaigns');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [why, setWhy] = useState(null);
  const [cfgRaw, setCfgRaw] = useState(CFG_DEFAULT);
  const [origenCfg, setOrigenCfg] = useState(null);   // 'nube' | 'local' | 'nuevo'
  const [fotos, setFotos] = useState({});

  const account = accounts.find(a => a.id === accountId) || null;
  const currency = account?.currency || null;
  const cfg = useMemo(() => cfgPara(cfgRaw, productoId || null), [cfgRaw, productoId]);

  // Cuenta guardada; si ya no está accesible, caemos a la primera.
  useEffect(() => {
    if (accounts.length === 0) return;
    if (!accounts.some(a => a.id === accountId)) setAccountId(accounts[0].id);
  }, [accounts, accountId]);
  useEffect(() => { try { if (accountId) localStorage.setItem(LS_ACCOUNT, accountId); } catch {} }, [accountId]);
  useEffect(() => { try { localStorage.setItem(LS_PRESET, preset); } catch {} }, [preset]);

  // Las reglas son POR CUENTA y viven en Supabase. Se pinta primero la caché
  // local (instantáneo) y después manda lo que diga la nube.
  useEffect(() => {
    if (!accountId) return;
    let vivo = true;
    const local = leerCfgLocal(accountId);
    setCfgRaw(local ? { ...CFG_DEFAULT, ...local } : CFG_DEFAULT);
    cargarCfg(accountId).then(({ cfg: c, origen }) => {
      if (!vivo) return;
      if (c) setCfgRaw({ ...CFG_DEFAULT, ...c });
      setOrigenCfg(origen);
    });
    cargarFotos(accountId, productoId || '').then(f => { if (vivo) setFotos(f); });
    return () => { vivo = false; };
  }, [accountId, productoId]);

  // Guardado de reglas con debounce: mover un umbral no dispara un upsert por
  // cada tecla.
  useEffect(() => {
    if (!accountId || cfgRaw === CFG_DEFAULT) return;
    const t = setTimeout(() => { guardarCfg(accountId, cfgRaw); }, 700);
    return () => clearTimeout(t);
  }, [cfgRaw, accountId]);

  const load = useCallback(async (acct, datePreset) => {
    if (!acct) return;
    setLoading(true); setError(null);
    try {
      let url = `/api/meta/testing-insights?account_id=${encodeURIComponent(acct.id)}&date_preset=${encodeURIComponent(datePreset)}`;
      if (acct.connId && acct.connId !== '__cookie__') url += `&connection_id=${encodeURIComponent(acct.connId)}`;
      const r = await fetch(url, { headers: await authHeaders(false) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setData(d);
    } catch (e) {
      setError(e.message); setData(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (account) load(account, preset); }, [account, preset, load]);

  // Filtro por producto sobre los anuncios (las campañas las filtra el core).
  // Solo los productos que REALMENTE tienen campañas en esta cuenta. Mostrar
  // todos los de AdsLab llenaba la barra de chips que no filtran nada (y que
  // al tocarlos dejaban el tablero vacío). De paso, el número al lado dice
  // cuántas campañas engancha cada uno: es la devolución de si el alias sirve.
  const productosEnCuenta = useMemo(() => {
    const cuenta = new Map();
    for (const c of (data?.campaigns || [])) {
      const p = productoDeCampana(c.name, productos, cfgRaw);
      if (p) cuenta.set(p.id, (cuenta.get(p.id) || 0) + 1);
    }
    return productos
      .filter(p => cuenta.has(p.id))
      .map(p => ({ ...p, campanas: cuenta.get(p.id) }))
      .sort((a, b) => b.campanas - a.campanas);
  }, [data, productos, cfgRaw]);

  // Si el producto elegido deja de tener campañas (cambiaste de cuenta o de
  // período), volvemos a "Todos" en vez de mostrar un tablero vacío.
  useEffect(() => {
    if (productoId && !productosEnCuenta.some(p => p.id === productoId)) setProductoId('');
  }, [productosEnCuenta, productoId]);

  const itemsHoy = useMemo(() => {
    const base = nivelHoy === 'campaigns' ? (data?.campaignsToday || []) : (data?.adsToday || []);
    return base.filter(a => !productoId || productoDeCampana(a.campaignName || a.name, productos, cfgRaw)?.id === productoId);
  }, [data, nivelHoy, productoId, productos, cfgRaw]);
  const ads7d = useMemo(() => (data?.ads7d || [])
    .filter(a => !productoId || productoDeCampana(a.campaignName, productos, cfgRaw)?.id === productoId), [data, productoId, productos, cfgRaw]);

  // Congelar las semanas que ya maduraron. Se hace solo, una vez por semana y
  // por cuenta: a partir de ahí ese número deja de moverse aunque Meta siga
  // atribuyendo compras viejas.
  useEffect(() => {
    if (!accountId || !data?.campaigns?.length) return;
    const { filas } = cohortesSemanales(data.campaigns, { cfg: cfgRaw, productos, productoId: productoId || null });
    const pendientes = cohortesParaCongelar(filas, { cfg, snapshots: fotos });
    if (pendientes.length === 0) return;
    const conFoto = pendientes.map(f => ({ semana: f.semana, foto: fotoDeCohorte(f) }));
    guardarFotos(accountId, conFoto, cfgRaw, productoId || '').then(r => {
      if (!r.guardadas) return;
      setFotos(prev => {
        const next = { ...prev };
        for (const f of conFoto) next[f.semana] = { datos: f.foto, cerrada_at: new Date().toISOString() };
        return next;
      });
    });
  }, [accountId, data, cfgRaw, cfg, productos, productoId, fotos]);

  const header = (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-400 flex items-center justify-center text-white shadow-sm shrink-0">
        <FlaskConical size={19} />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Testeos</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Qué pausar hoy, cómo rindió cada tanda de testeos y quién sigue trayendo gente nueva.
        </p>
      </div>
    </div>
  );

  if (!connLoading && connections.length === 0) {
    return (
      <div className="max-w-6xl mx-auto space-y-5">
        {header}
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
          <Plug size={26} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Conectá tu cuenta publicitaria</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">Los KPIs salen directo de Meta.</p>
          <button onClick={openMetaConnect}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#1877F2] rounded-lg hover:bg-[#0f6ae0] transition">
            <Plug size={14} /> Conectar cuenta publicitaria
          </button>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: 'hoy', label: 'Hoy — qué pausar', icon: Gauge },
    { id: 'semanas', label: 'Testeos por semana', icon: FlaskConical },
    { id: 'prosp', label: 'Prospectadores', icon: Radar },
    { id: 'reglas', label: 'Reglas de la tienda', icon: SlidersHorizontal },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {header}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[210px]">
          <select value={accountId} onChange={e => setAccountId(e.target.value)}
            className="w-full pl-3 pr-8 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">{acctLoading ? 'Cargando cuentas…' : '— Elegí una cuenta —'}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.accountId}{a.currency ? ` (${a.currency})` : ''}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        <select value={preset} onChange={e => setPreset(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
          {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {productosEnCuenta.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setProductoId('')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition ${!productoId ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300' : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500'}`}>
              Todos
            </button>
            {productosEnCuenta.map(p => (
              <button key={p.id} onClick={() => setProductoId(p.id)}
                title={`${p.campanas} campaña${p.campanas === 1 ? '' : 's'} de ${p.nombre} en esta cuenta`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full border transition max-w-[170px] ${productoId === p.id ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300' : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500'}`}>
                <span className="truncate">{p.nombre}</span>
                <span className="tabular-nums opacity-60">{p.campanas}</span>
              </button>
            ))}
          </div>
        )}
        {data && productosEnCuenta.length === 0 && productos.length > 0 && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            Ningún producto reconocido en esta cuenta — cargá sus palabras en <b>Reglas</b>.
          </span>
        )}
        <button onClick={() => account && load(account, preset)} disabled={!account || loading}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refrescar
        </button>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition ${
                tab === t.id ? 'text-gray-900 dark:text-gray-100 border-brand-500' : 'text-gray-500 border-transparent hover:text-gray-700 dark:hover:text-gray-200'}`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
          <AlertCircle size={17} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">No pude traer los datos</p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-0.5 break-words">{error}</p>
          </div>
        </div>
      ) : loading && !data ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 flex items-center gap-3">
          <Loader2 size={17} className="animate-spin text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Trayendo campañas, anuncios de hoy y de los últimos 7 días…</span>
        </div>
      ) : !data ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Elegí una cuenta para empezar</p>
        </div>
      ) : (
        <>
          {tab === 'hoy' && <VistaHoy ads={itemsHoy} cfg={cfg} currency={currency} accountId={accountId} onWhy={setWhy} nivel={nivelHoy} setNivel={setNivelHoy} />}
          {tab === 'semanas' && <VistaSemanas campaigns={data.campaigns} cfg={cfgRaw} productos={productos} productoId={productoId || null} currency={currency} accountId={accountId} onWhy={setWhy} fotos={fotos} />}
          {tab === 'prosp' && <VistaProspectadores ads={ads7d} cfg={cfg} currency={currency} accountId={accountId} onWhy={setWhy} />}
          {tab === 'reglas' && <VistaReglas campaigns={data.campaigns} cfg={cfgRaw} setCfg={setCfgRaw} productos={productos} currency={currency} onWhy={setWhy} origen={origenCfg} />}
        </>
      )}

      <FormulaModal open={why} onClose={() => setWhy(null)} />
    </div>
  );
}
