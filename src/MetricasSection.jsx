// Métricas — el tablero de la cuenta publicitaria.
//
// Antes esto eran dos secciones separadas (Métricas para el embudo, Testeos
// para las cohortes) y era un ida y vuelta absurdo: las dos preguntaban por
// la misma cuenta y el mismo período, pero cada una tenía su propio selector
// y podían quedar mirando recortes distintos. Ahora es una sola sección con
// un solo selector de cuenta, período y producto, y cinco pestañas:
//
//   Hoy       → qué pausar ahora y cuánta plata salva hacerlo.
//   Embudo    → dónde se cae la gente entre la impresión y la compra.
//   Semanas   → cómo rindió cada tanda de testeos (eficiencia por cohorte).
//   Prospect  → qué anuncios siguen trayendo gente nueva.
//   Reglas    → la nomenclatura y los umbrales de ESTA tienda.
//
// Cada pestaña pega a su endpoint, pero solo cuando se abre: el embudo
// (/api/meta/funnel-insights) no se pide hasta que alguien entra a esa
// pestaña, así abrir Métricas sigue costando una sola llamada.
//
// Todo el cálculo de testeos vive en testeosCore.js (puro y testeado). Acá
// solo se pide la data cruda y se dibuja: mover un umbral en Reglas recalcula
// el tablero entero sin volver a pegarle a Meta.
//
// Cada número trae su fórmula: el botón "i" abre qué cuenta se hizo y con qué
// datos. La idea es poder auditar una métrica en vez de creerle.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Loader2, RefreshCw, AlertCircle, ChevronDown, ChevronRight, Plug, X,
  FlaskConical, Radar, Gauge, SlidersHorizontal, ExternalLink, Clock, Filter,
  Pause, Play, AlertTriangle, Trophy, Film, BookmarkPlus, Check, Pencil, CalendarDays, Rocket, Table2,
} from 'lucide-react';
import {
  useMetaConnections, useMetaAdAccounts, authHeaders, openMetaConnect,
} from './MetaConnect.jsx';
import {
  CFG_DEFAULT, CONDICIONES_PAUSA, cfgPara, cohortesSemanales, rondaDeOptimizacion, esProspectador,
  promediosDelDia, ETAPAS, oportunidadDeEscala, mesDeSemana, etiquetaMes, semanaDelMes, veredicto,
  productoDeCampana, linkMeta, FORMULAS,
  fusionarConFotos, cohortesParaCongelar, fotoDeCohorte,
} from './testeosCore.js';
import { cargarCfg, guardarCfg, cargarFotos, guardarFotos, leerCfgLocal } from './testeosStore.js';
import { alertDialog } from './dialogs.jsx';
import { supabase } from './supabase.js';
import MenuFecha from './MenuFecha.jsx';
import PublicarCampana from './PublicarCampana.jsx';
import CampanasTracker from './CampanasTracker.jsx';
import { referenciasApi } from './referenciasApi.js';
import { fetchMeta, leerCacheMeta, pathTestingInsights, pathAdsWithInsights, recordarConnId } from './metricasCache.js';
import { VistaEmbudo } from './EmbudoVista.jsx';
import { cambiarEstado, cambiarPresupuesto, inverso, estadoVisible, entregaDe } from './testeosAcciones.js';
import { deriveFunnelRates } from '../api/meta/_funnel.js';

// Las claves siguen diciendo "testeos" a propósito: renombrarlas le borraría
// la cuenta y el período elegidos a quien ya venía usando el tablero.
const LS_ACCOUNT = 'adslab-testeos-account';
const LS_PRESET = 'adslab-testeos-preset';          // ventana de las cohortes
const LS_PRESET_MIGRADO = 'adslab-testeos-preset-v2';
const LS_PRESET_EMBUDO = 'adslab-metricas-preset';  // ventana del embudo
const LS_PRESET_PROSP = 'adslab-metricas-preset-prosp';     // ventana de Prospectadores
const LS_PRESET_WINNERS = 'adslab-metricas-preset-winners'; // ventana de Winners

// El período NO es uno solo para toda la sección, y esto costó entenderlo:
//
//   · Hoy mira siempre el día de hoy — el endpoint pide `today` aparte, sin
//     importar qué diga ningún selector.
//   · Prospectadores mira una ventana fija (la de las reglas, 7 días).
//   · El embudo se mira en ventanas cortas: ¿cómo viene hoy?
//   · Las cohortes necesitan una ventana LARGA: con "hoy" la tabla de semanas
//     queda vacía, porque las campañas del 11/8 no gastaron nada hoy.
//
// Antes había un solo selector global. Elegir "Hoy" ahí no cambiaba nada en la
// pestaña Hoy (que ya era de hoy) y en cambio vaciaba las semanas. Ahora cada
// pestaña manda sobre su propia ventana y las que no tienen nada que elegir
// muestran cuál usan, en vez de un desplegable que no hace nada.
const PRESETS_EMBUDO = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'last_7d', label: 'Últimos 7 días' },
  { value: 'last_14d', label: 'Últimos 14 días' },
  { value: 'last_30d', label: 'Últimos 30 días' },
  { value: 'this_month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes pasado' },
];
const PRESETS_COHORTES = [
  { value: 'last_30d', label: 'Últimos 30 días' },
  { value: 'last_90d', label: 'Últimos 90 días' },
  { value: 'this_month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes pasado' },
  { value: 'maximum', label: 'Histórico' },
];
// Prospectadores y Winners tienen SU propio calendario (pedido del user:
// "que me deje usar el calendario más libremente"): cada pestaña elige su
// ventana sin tocar la de las otras.
const PRESETS_PROSP = [
  { value: 'last_7d', label: 'Últimos 7 días' },
  { value: 'last_14d', label: 'Últimos 14 días' },
  { value: 'last_30d', label: 'Últimos 30 días' },
];
const PRESETS_WINNERS = [
  { value: 'last_7d', label: 'Últimos 7 días' },
  { value: 'last_14d', label: 'Últimos 14 días' },
  { value: 'last_30d', label: 'Últimos 30 días' },
  { value: 'last_90d', label: 'Últimos 90 días' },
];
// Etiqueta humana de una ventana (preset o rango custom del calendario).
function etiquetaVentana(valor, presets) {
  const p = presets.find(x => x.value === valor);
  if (p) return p.label.toLowerCase();
  const c = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(String(valor || ''));
  if (!c) return valor || '';
  const f = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}`; };
  return `${f(c[1])} → ${f(c[2])}`;
}

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
      title="¿Qué es esto? Tocá para ver la explicación y la cuenta hecha con tus números"
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
function Kpi({ label, value, sub, tone = '', children, title }) {
  const tones = { ok: 'text-emerald-600 dark:text-emerald-400', bad: 'text-red-600 dark:text-red-400', warn: 'text-amber-600 dark:text-amber-400' };
  return (
    <div title={title} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[9.5px] font-bold uppercase tracking-[.09em] text-gray-400 truncate">{label}</p>
        {children}
      </div>
      <p className={`text-[22px] font-bold tabular-nums leading-tight mt-1 ${tones[tone] || 'text-gray-900 dark:text-gray-100'}`}>{value}</p>
      {sub && <p className="text-[10.5px] text-gray-500 dark:text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

// Tooltip estándar de ROAS: la métrica que más decide, explicada para
// cualquiera (pedido del user: que la plataforma la use cualquier persona).
const TIP_ROAS = 'ROAS: cuánto vendiste por cada $1 que pusiste en anuncios. 2,00 = por cada $1 volvieron $2. Verde = arriba de tu mínimo; rojo = abajo.';
const TIP_CPA = 'Cuánto gastaste en anuncios para conseguir cada compra.';
const TIP_ENTREGA = 'Si Meta lo está mostrando ahora. Puede estar prendido y no mostrarse (en revisión o rechazado).';

function Pill({ tone, children, title }) {
  const t = {
    ok: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    bad: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    warn: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    mute: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    // Verde fuerte: oportunidad de escala (subir presupuesto).
    up: 'bg-emerald-500 text-white dark:bg-emerald-500 dark:text-white shadow-sm',
  }[tone] || 'bg-gray-100 dark:bg-gray-700 text-gray-600';
  return <span title={title} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${t}`}>{children}</span>;
}

// Columna Presupuesto: muestra el diario y, como en Meta, DOBLE CLICK para
// editarlo ahí mismo (Enter guarda, Esc cancela). Solo entidades con
// presupuesto diario propio — en ABO vive en el conjunto y acá se muestra
// solo el % consumido.
function PresupuestoCell({ a, p, cfg, currency, nivel, override, onGuardar }) {
  const [editando, setEditando] = useState(false);
  const [draft, setDraft] = useState('');
  const [guardando, setGuardando] = useState(false);
  const monto = override ?? (a.dailyBudget != null ? Number(a.dailyBudget) : null);
  const editable = nivel === 'campaigns' && monto != null && typeof onGuardar === 'function';

  const abrir = () => {
    if (!editable) return;
    setDraft(String(Math.round(monto)));
    setEditando(true);
  };
  const guardar = async () => {
    // "45.000" (puntos de miles) o "45000,50" → número.
    const v = Number(String(draft).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0 || Math.round(v) === Math.round(monto)) { setEditando(false); return; }
    setGuardando(true);
    const ok = await onGuardar({ id: a.id, level: 'campaign', dailyBudget: v });
    setGuardando(false);
    if (ok) setEditando(false);
  };

  if (editando) {
    return (
      <span className="inline-flex items-center gap-1">
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }}
          onBlur={() => { if (!guardando) setEditando(false); }}
          className="w-24 px-1.5 py-0.5 text-[11.5px] text-right tabular-nums bg-white dark:bg-gray-900 border border-brand-400 rounded focus:outline-none focus:ring-1 focus:ring-brand-500" />
        {guardando
          ? <Loader2 size={11} className="animate-spin text-gray-400" />
          : <button onMouseDown={e => { e.preventDefault(); guardar(); }}
              className="text-emerald-600 dark:text-emerald-400 text-[12px] font-bold" title="Guardar (Enter)">✓</button>}
      </span>
    );
  }

  return (
    <span className={editable ? 'cursor-pointer' : ''} onDoubleClick={abrir}
      title={editable ? 'Doble click para cambiar el presupuesto diario — como en Meta' : undefined}>
      {monto != null ? (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200 text-[11.5px]">
            {fmtM(monto, currency)} <span className="text-[9px] text-gray-400 font-normal">/ día</span>
            {editable && <Pencil size={9} className="inline ml-1 text-gray-400 opacity-50" />}
          </span>
          {p.consumidoPct != null && (
            <span className="inline-flex items-center gap-1">
              <span className="tabular-nums text-[9.5px] text-gray-400">{fmtP(p.consumidoPct)}</span>
              <Bar pct={p.consumidoPct} tone={p.consumidoPct >= cfg.consumoAltoPct ? 'warn' : undefined} />
            </span>
          )}
        </span>
      ) : p.consumidoPct != null ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="tabular-nums text-[10.5px] text-gray-500">{fmtP(p.consumidoPct)}</span>
          <Bar pct={p.consumidoPct} tone={p.consumidoPct >= cfg.consumoAltoPct ? 'warn' : undefined} />
        </span>
      ) : <span className="text-gray-400">—</span>}
    </span>
  );
}

// Pestaña "Campañas y anuncios": la tabla clásica del Ads Manager por niveles
// (Campañas / Conjuntos / Anuncios) con la ventana elegida arriba, buscador,
// orden por columna, toggles reales, presupuesto editable con doble click y
// fila de totales al pie. Cachea por (cuenta, nivel, ventana) y refresca atrás.
function VistaManager({ accountId, connId, currency, preset, presupuestos, onPresupuesto }) {
  const [nivel, setNivel] = useState('campaign');
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [orden, setOrden] = useState({ k: 'spend', dir: 1 });
  const [estados, setEstados] = useState({});
  const [busy, setBusy] = useState({});
  const cacheRef = useRef({});

  useEffect(() => {
    if (!accountId) return;
    const key = `${accountId}|${nivel}|${preset}`;
    let muerto = false;
    setErr(null);
    if (cacheRef.current[key]) setData(cacheRef.current[key]);
    else setData(null);
    setCargando(true);
    (async () => {
      try {
        const qs = new URLSearchParams({ account_id: accountId, level: nivel, date_preset: preset });
        if (connId && connId !== '__cookie__') qs.set('connection_id', connId);
        const r = await fetch(`/api/meta/manager-table?${qs}`, { headers: await authHeaders(false) });
        const d = await r.json().catch(() => ({}));
        if (muerto) return;
        if (!r.ok || d.error) setErr(d.error || `Error ${r.status}`);
        else { cacheRef.current[key] = d; setData(d); }
      } catch (e) { if (!muerto) setErr(e.message); }
      finally { if (!muerto) setCargando(false); }
    })();
    return () => { muerto = true; };
  }, [accountId, connId, nivel, preset]);

  const estadoDe = (r) => estados[r.id] || r.effectiveStatus;
  const togglear = async (row) => {
    const nuevo = estadoDe(row) === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setBusy(prev => ({ ...prev, [row.id]: true }));
    const r = await cambiarEstado({ accountId, connId, level: nivel, ids: [row.id], status: nuevo });
    setBusy(prev => { const n = { ...prev }; delete n[row.id]; return n; });
    if (r.ok) setEstados(prev => ({ ...prev, [row.id]: nuevo }));
  };

  const clickOrden = (k) => setOrden(o => o.k === k ? { k, dir: -o.dir } : { k, dir: 1 });
  const flecha = (k) => orden.k === k ? (orden.dir === 1 ? ' ↓' : ' ↑') : '';
  const thSort = (k, label, title) => (
    <th key={k} onClick={() => clickOrden(k)} title={title || label}
      className="text-right font-bold px-2 py-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition whitespace-nowrap">
      {label}{flecha(k)}
    </th>
  );

  const filas = (data?.rows || [])
    .filter(r => !q || r.name.toLowerCase().includes(q) || (r.sub || '').toLowerCase().includes(q))
    .sort((a, b) => orden.dir * ((Number(b[orden.k]) || 0) - (Number(a[orden.k]) || 0)));
  const t = data?.totals;

  const NIVELES_UI = [
    { id: 'campaign', label: 'Campañas' },
    { id: 'adset', label: 'Conjuntos' },
    { id: 'ad', label: 'Anuncios' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
        <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
          {NIVELES_UI.map(n => (
            <button key={n.id} onClick={() => setNivel(n.id)}
              className={`px-3 py-1 text-[11.5px] font-bold rounded-md transition ${
                nivel === n.id ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {n.label}{data && nivel === n.id ? ` · ${filas.length}` : ''}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[160px] max-w-[280px]">
          <input value={q} onChange={e => setQ(e.target.value.trim().toLowerCase())} placeholder="Buscar por nombre…"
            className="w-full px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-[#1877F2]" />
        </div>
        {cargando && <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400"><Loader2 size={11} className="animate-spin" /> Actualizando…</span>}
        <span className="ml-auto text-[10.5px] text-gray-400">click en las columnas para ordenar</span>
      </div>

      {err ? (
        <div className="p-6 text-sm text-red-600 dark:text-red-400 flex items-center gap-2"><AlertCircle size={15} /> {err}</div>
      ) : !data ? (
        <div className="p-4 space-y-2">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-10 rounded-lg bg-gray-100 dark:bg-gray-900 animate-pulse" style={{ animationDelay: `${i * 120}ms` }} />)}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[860px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-400 text-[9.5px] uppercase tracking-wider">
                <th className="px-3 py-2 w-10" />
                <th className="text-left font-bold px-2 py-2">Nombre</th>
                <th className="text-left font-bold px-2 py-2" title={TIP_ENTREGA}>Entrega</th>
                <th className="text-right font-bold px-2 py-2" title="Plata por día. Hacé doble click sobre el número para cambiarlo.">Presupuesto</th>
                {thSort('compras', 'Compras')}
                {thSort('cpa', 'Costo por compra', TIP_CPA)}
                {thSort('spend', 'Importe gastado')}
                {thSort('revenue', 'Valor de conversión')}
                {thSort('roas', 'ROAS (compras)', TIP_ROAS)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {filas.length === 0 && (
                <tr><td colSpan={9} className="px-3.5 py-6 text-center text-xs text-gray-400">
                  Sin {nivel === 'campaign' ? 'campañas' : nivel === 'adset' ? 'conjuntos' : 'anuncios'} con datos en este período{q ? ' (con ese nombre)' : ''}.
                </td></tr>
              )}
              {filas.map(r => (
                <tr key={r.id} className={`hover:bg-gray-50 dark:hover:bg-gray-900/30 ${estadoDe(r) === 'PAUSED' ? 'opacity-55' : ''}`}>
                  <td className="px-3 py-2">
                    <SwitchEstado estado={estadoDe(r)} trabajando={!!busy[r.id]} onCambiar={() => togglear(r)} />
                  </td>
                  <td className="px-2 py-2 max-w-[300px]">
                    <span className="block font-semibold text-gray-900 dark:text-gray-100 truncate" title={r.name}>{r.name}</span>
                    {r.sub && <span className="block text-[10px] text-gray-400 truncate" title={r.sub}>{r.sub}</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${estadoDe(r) === 'ACTIVE' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${estadoDe(r) === 'ACTIVE' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      {estadoDe(r) === 'ACTIVE' ? 'Activo' : 'Desactivado'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {nivel !== 'ad' && r.dailyBudget != null ? (
                      <PresupuestoCell a={{ id: r.id, dailyBudget: r.dailyBudget }} p={{}} cfg={{}} currency={currency}
                        nivel="campaigns" override={presupuestos?.[r.id]}
                        onGuardar={onPresupuesto ? ({ id, dailyBudget }) => onPresupuesto({ id, level: nivel === 'adset' ? 'adset' : 'campaign', dailyBudget }) : null} />
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-700 dark:text-gray-200">{r.compras || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.cpa != null ? fmtM(r.cpa, currency) : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtM(r.spend, currency)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.revenue ? fmtM(r.revenue, currency) : '—'}</td>
                  <td className={`px-2 py-2 text-right tabular-nums font-bold ${r.roas >= (cfgGlobalRoas() || 1.5) ? 'text-emerald-600 dark:text-emerald-400' : r.spend > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{fmtR(r.roas)}</td>
                </tr>
              ))}
            </tbody>
            {t && filas.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-t-2 border-gray-200 dark:border-gray-700 font-bold">
                  <td className="px-3 py-2.5" />
                  <td className="px-2 py-2.5 text-[11px] text-gray-500" colSpan={3}>Resultados de {filas.length} {nivel === 'campaign' ? 'campañas' : nivel === 'adset' ? 'conjuntos' : 'anuncios'}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{t.compras}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{t.cpa != null ? fmtM(t.cpa, currency) : '—'}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtM(t.spend, currency)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtM(t.revenue, currency)}</td>
                  <td className={`px-2 py-2.5 text-right tabular-nums ${t.roas >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmtR(t.roas)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
// El corte de color del ROAS en la tabla Manager: el general de Reglas si está
// en localStorage, sino 1.5 (el default del veredicto de ganador).
function cfgGlobalRoas() {
  try { return Number(leerCfgLocal()?.roasMaxPausar) || null; } catch { return null; }
}

// Desglose de UNA campaña al expandirla: sus conjuntos y los anuncios de cada
// uno con los números de hoy — los niveles del Ads Manager sin salir de la
// fila. El presupuesto de un conjunto (ABO) también se edita con doble click.
function DesgloseCampana({ campaignId, accountId, connId, currency, presupuestos, onPresupuesto }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  // Prender/apagar conjuntos y anuncios desde el desglose: en una ABO la
  // optimización se hace acá, no apagando la campaña entera.
  const [estados, setEstados] = useState({});
  const [busy, setBusy] = useState({});
  // Acordeón: los CONJUNTOS se ven siempre con sus métricas; los anuncios de
  // cada uno se abren con el caret (si hay un solo conjunto, arranca abierto).
  const [abiertos, setAbiertos] = useState({});
  const toggle = async (item, level) => {
    const actual = estados[item.id] || item.effectiveStatus;
    const nuevo = actual === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setBusy(prev => ({ ...prev, [item.id]: true }));
    const r = await cambiarEstado({ accountId, connId, level, ids: [item.id], status: nuevo });
    setBusy(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    if (r.ok) setEstados(prev => ({ ...prev, [item.id]: nuevo }));
  };
  const estadoDe = (item) => estados[item.id] || item.effectiveStatus;
  useEffect(() => {
    let muerto = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ account_id: accountId, campaign_id: campaignId, preset: 'today' });
        if (connId && connId !== '__cookie__') qs.set('connection_id', connId);
        const r = await fetch(`/api/meta/campaign-breakdown?${qs}`, { headers: await authHeaders(false) });
        const d = await r.json().catch(() => ({}));
        if (muerto) return;
        if (!r.ok || d.error) setErr(d.error || `Error ${r.status}`);
        else {
          setData(d.adsets || []);
          // Siempre agrupado al abrir (pedido del user): los anuncios se ven
          // recién al desplegar su conjunto.
          setAbiertos({});
        }
      } catch (e) { if (!muerto) setErr(e.message); }
    })();
    return () => { muerto = true; };
  }, [campaignId, accountId, connId]);

  const Dot = ({ on }) => (
    <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold ${on ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? 'bg-emerald-500' : 'bg-gray-400'}`} />
      {on ? 'Activo' : 'Desact.'}
    </span>
  );
  const Num = ({ v, money = true, bold = false }) => (
    <td className={`px-2 py-1.5 text-right tabular-nums ${bold ? 'font-semibold text-gray-700 dark:text-gray-200' : 'text-gray-600 dark:text-gray-300'}`}>
      {v == null ? '—' : money ? fmtM(v, currency) : v}
    </td>
  );

  if (err) return <p className="text-[11px] text-red-500 mt-2.5">Desglose: {err}</p>;
  if (!data) return (
    <p className="text-[11px] text-gray-400 mt-2.5 flex items-center gap-1.5">
      <Loader2 size={11} className="animate-spin" /> Trayendo conjuntos y anuncios…
    </p>
  );
  if (!data.length) return <p className="text-[11px] text-gray-400 mt-2.5">La campaña no tiene conjuntos.</p>;

  // La misma regla que la tabla de arriba: sin gasto HOY no se muestra —
  // las copias apagadas de la automatización solo ensuciaban el desglose.
  const visibles = data.filter(s => Number(s.spend) > 0);
  const ocultos = (data.length - visibles.length) +
    visibles.reduce((n, s) => n + s.ads.filter(a => !(Number(a.spend) > 0)).length, 0);
  if (!visibles.length) {
    return <p className="text-[11px] text-gray-400 mt-2.5">Ningún conjunto con gasto hoy — {data.length} sin entrega quedaron ocultos.</p>;
  }

  return (
    <div className="mt-3 border-t border-gray-200 dark:border-gray-700/60 pt-2">
      <p className="text-[9.5px] font-bold uppercase tracking-[.08em] text-gray-400 mb-1">
        Desglose · conjuntos y anuncios (hoy)
        {ocultos > 0 && <span className="normal-case tracking-normal font-semibold"> — {ocultos} sin gasto no se muestran</span>}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px] min-w-[720px]">
          <thead>
            <tr className="text-gray-400 text-[9px] uppercase tracking-wider">
              <th className="px-2 py-1 w-9" />
              <th className="text-left font-bold px-2 py-1">Conjunto / anuncio</th>
              <th className="text-left font-bold px-2 py-1">Entrega</th>
              <th className="text-right font-bold px-2 py-1">Presupuesto</th>
              <th className="text-right font-bold px-2 py-1">Compras</th>
              <th className="text-right font-bold px-2 py-1">Gastado</th>
              <th className="text-right font-bold px-2 py-1" title={TIP_ROAS}>ROAS</th>
              <th className="text-right font-bold px-2 py-1">Costo carrito</th>
              <th className="text-right font-bold px-2 py-1">Costo pago</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {visibles.map(s => (
              <React.Fragment key={s.id}>
                <tr className="bg-gray-50/80 dark:bg-gray-900/30">
                  <td className="px-2 py-1.5">
                    <SwitchEstado estado={estadoDe(s)} trabajando={!!busy[s.id]} onCambiar={() => toggle(s, 'adset')} />
                  </td>
                  <td className="px-2 py-1.5 font-semibold text-gray-900 dark:text-gray-100">
                    <button onClick={() => setAbiertos(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                      className="inline-flex items-center gap-1.5 font-semibold text-left hover:text-brand-600 dark:hover:text-brand-300 transition"
                      title={abiertos[s.id] ? 'Ocultar los anuncios' : 'Ver los anuncios de este conjunto'}>
                      {abiertos[s.id] ? <ChevronDown size={12} className="text-brand-500 shrink-0" /> : <ChevronRight size={12} className="text-gray-400 shrink-0" />}
                      ▦ {s.name}
                      <span className="text-[10px] font-semibold text-gray-400">· {s.ads.filter(x => Number(x.spend) > 0).length} anuncio{s.ads.filter(x => Number(x.spend) > 0).length === 1 ? '' : 's'}</span>
                    </button>
                  </td>
                  <td className="px-2 py-1.5"><Dot on={estadoDe(s) === 'ACTIVE'} /></td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {s.dailyBudget != null ? (
                      <PresupuestoCell
                        a={{ id: s.id, dailyBudget: s.dailyBudget }} p={{}} cfg={{}} currency={currency}
                        nivel="campaigns" override={presupuestos?.[s.id]}
                        onGuardar={onPresupuesto ? ({ id, dailyBudget }) => onPresupuesto({ id, level: 'adset', dailyBudget }) : null} />
                    ) : <span className="text-gray-400" title="El presupuesto vive en la campaña (CBO)">— CBO</span>}
                  </td>
                  <Num v={s.compras} money={false} bold />
                  <Num v={s.spend} bold />
                  <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${s.roas >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : s.spend > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{fmtR(s.roas)}</td>
                  <Num v={s.costoATC} />
                  <Num v={s.costoCheckout} />
                </tr>
                {abiertos[s.id] && s.ads.filter(x => Number(x.spend) > 0).map(ad => (
                  <tr key={ad.id}>
                    <td className="px-2 py-1.5 pl-5">
                      <SwitchEstado estado={estadoDe(ad)} trabajando={!!busy[ad.id]} onCambiar={() => toggle(ad, 'ad')} />
                    </td>
                    <td className="px-2 py-1.5 pl-4 text-gray-700 dark:text-gray-300 max-w-[300px] truncate" title={ad.name}>▶ {ad.name}</td>
                    <td className="px-2 py-1.5"><Dot on={estadoDe(ad) === 'ACTIVE'} /></td>
                    <td className="px-2 py-1.5 text-right text-gray-400">—</td>
                    <Num v={ad.compras} money={false} />
                    <Num v={ad.spend} />
                    <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${ad.roas >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : ad.spend > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{fmtR(ad.roas)}</td>
                    <Num v={ad.costoATC} />
                    <Num v={ad.costoCheckout} />
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Loader moderno del tablero: barra de progreso con etapas + esqueleto del
// layout real (KPIs y filas con shimmer). El progreso es una curva asintótica
// (nunca llega a 100 hasta que los datos aparecen y el componente se va) —
// reemplaza al spinner con texto plano. La precarga del login (App.jsx) suele
// evitar que esto se vea; aparece solo en la primera carga fría de una cuenta.
function CargandoMetricas() {
  const PASOS = [
    'Conectando con Meta…',
    'Trayendo las campañas del período…',
    'Anuncios de hoy…',
    'Performance de los últimos 7 días…',
    'Cruzando con tus reglas y armando el tablero…',
  ];
  const [p, setP] = useState(4);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setP(Math.min(93, Math.round(100 * (1 - Math.exp(-s / 3.4)))));
    }, 150);
    return () => clearInterval(id);
  }, []);
  const paso = PASOS[Math.min(PASOS.length - 1, Math.floor((p / 94) * PASOS.length))];
  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1877F2] animate-ping" />
            {paso}
          </span>
          <span className="text-[11px] tabular-nums font-bold text-gray-400">{p}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-900 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 via-[#1877F2] to-brand-400 transition-[width] duration-300 ease-out"
            style={{ width: `${p}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" style={{ animationDelay: `${i * 140}ms` }} />
        ))}
      </div>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-9 rounded-lg bg-gray-100 dark:bg-gray-900 animate-pulse" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  );
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
// Prender / pausar
// ========================================================================

// El interruptor de una fila, igual que en el Administrador de anuncios: a la
// izquierda del nombre, y lo que se ve es el ESTADO, no la acción. Activo a
// la derecha y en azul de Meta (#1877F2); desactivado a la izquierda y gris.
//
// Cuando no sabemos el estado (Meta no lo devolvió) se dibuja un hueco del
// mismo ancho en vez del switch: si no, las filas de esa tanda quedan
// corridas media pulgada respecto de las demás.
function SwitchEstado({ estado, trabajando, onCambiar }) {
  if (!estado) return <span className="inline-block w-[30px] shrink-0" aria-hidden="true" />;
  const prendido = estado === 'ACTIVE';
  return (
    <button
      role="switch" aria-checked={prendido}
      onClick={e => { e.stopPropagation(); onCambiar(prendido ? 'PAUSED' : 'ACTIVE'); }}
      disabled={trabajando}
      title={prendido ? 'Desactivar en Meta' : 'Activar en Meta'}
      className={`relative inline-flex items-center w-[30px] h-[17px] shrink-0 rounded-full transition-colors disabled:cursor-wait focus:outline-none focus:ring-2 focus:ring-[#1877F2] focus:ring-offset-1 dark:focus:ring-offset-gray-800 ${
        trabajando ? 'bg-gray-300 dark:bg-gray-600'
          : prendido ? 'bg-[#1877F2] hover:bg-[#0f6ae0]' : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500'}`}>
      <span className={`absolute top-[2px] w-[13px] h-[13px] rounded-full bg-white shadow-sm transition-all grid place-items-center ${
        prendido ? 'left-[15px]' : 'left-[2px]'}`}>
        {trabajando && <Loader2 size={9} className="animate-spin text-gray-500" />}
      </span>
    </button>
  );
}

// La columna "Entrega" del Ads Manager. El interruptor dice si vos la
// prendiste; esto dice si Meta la está entregando, que no es lo mismo: en
// revisión, rechazada o colgada de una campaña apagada, el switch está en
// verde y no se gasta un peso.
function Entrega({ item, cambios }) {
  const e = entregaDe(item, cambios);
  if (!e) return null;
  const punto = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', mute: 'bg-gray-400' }[e.tono] || 'bg-gray-400';
  const texto = { ok: 'text-emerald-600 dark:text-emerald-400', warn: 'text-amber-600 dark:text-amber-400', bad: 'text-red-600 dark:text-red-400', mute: 'text-gray-500 dark:text-gray-400' }[e.tono] || '';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap ${texto}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${punto}`} /> {e.label}
    </span>
  );
}

// Confirmación para la tanda. Una fila sola se pausa de una — es reversible y
// el toast trae "Deshacer" —, pero apagar seis campañas de un click merece ver
// antes cuáles son: es la diferencia entre optimizar y apagar la cuenta.
function ConfirmarTanda({ abierto, items, currency, onCancelar, onConfirmar }) {
  if (!abierto) return null;
  const plata = items.reduce((t, a) => t + (a.pausa?.efecto === 'ahorro' ? (a.pausa?.restante || 0) : 0), 0);
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancelar}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-4 py-3.5 border-b border-gray-100 dark:border-gray-700">
          <span className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 grid place-items-center shrink-0">
            <AlertTriangle size={16} />
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Desactivar {items.length} en Meta</h4>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Se desactivan en Meta, ahora. Podés volver a activarlas desde acá mismo.</p>
          </div>
        </div>
        <ul className="max-h-56 overflow-y-auto px-4 py-2.5 space-y-1">
          {items.map(a => (
            <li key={a.id} className="flex items-center gap-2 text-[11.5px]">
              <span className="w-1 h-1 rounded-full bg-red-400 shrink-0" />
              <span className="truncate text-gray-700 dark:text-gray-300" title={a.name}>{a.name}</span>
              <span className="ml-auto tabular-nums text-gray-400 shrink-0">{fmtM(a.insights?.spend, currency)}</span>
            </li>
          ))}
        </ul>
        {plata > 0 && (
          <p className="px-4 pb-1 text-[11px] text-gray-500 dark:text-gray-400">
            Deja de gastarse <b className="text-gray-700 dark:text-gray-200">{fmtM(plata, currency)}</b> de presupuesto propio.
            Lo que está dentro de una campaña CBO se redirige, no se ahorra.
          </p>
        )}
        <div className="flex gap-2 justify-end px-4 py-3 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onCancelar}
            className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition">
            Cancelar
          </button>
          <button onClick={onConfirmar}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition">
            <Pause size={12} /> Desactivar {items.length}
          </button>
        </div>
      </div>
    </div>
  );
}

// Los criterios de la ronda, editables sin salir de la pestaña.
//
// Estaban solo en "Reglas de la tienda", que es donde se configura la cuenta
// entera. Pero el momento en que uno se pregunta "¿por qué me marcó ESTA?" es
// mirando la tabla, no dos pestañas más allá: tener que irse y volver hacía
// que en la práctica nadie tocara los umbrales.
//
// Escribe en el mismo perfil que Reglas — se guarda por cuenta y en la nube.
function Criterios({ cfg, cfgRaw, setCfg, productos, productoId, currency, abierto, onToggle }) {
  const num = (k, valor) => setCfg(c => ({ ...c, [k]: valor === '' ? null : Number(valor) }));
  const activas = Array.isArray(cfgRaw?.condicionesPausar) && cfgRaw.condicionesPausar.length
    ? cfgRaw.condicionesPausar : CFG_DEFAULT.condicionesPausar;
  const alternar = (clave) => setCfg(c => {
    const actuales = Array.isArray(c.condicionesPausar) && c.condicionesPausar.length
      ? c.condicionesPausar : CFG_DEFAULT.condicionesPausar;
    return { ...c, condicionesPausar: actuales.includes(clave)
      ? actuales.filter(x => x !== clave) : [...actuales, clave] };
  });
  const setBk = (pid, valor) => setCfg(c => ({
    ...c,
    porProducto: { ...(c.porProducto || {}), [pid]: { ...(c.porProducto?.[pid] || {}), roasBreakeven: valor === '' ? null : Number(valor) } },
  }));

  const input = "w-full px-2 py-1 text-xs font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1877F2]";
  const Campo = ({ label, sufijo, children }) => (
    <label className="grid gap-1">
      <span className="text-[9px] font-bold uppercase tracking-[.08em] text-gray-400">{label}</span>
      <span className="flex items-center gap-1.5">{children}{sufijo && <span className="text-[10px] text-gray-400 shrink-0">{sufijo}</span>}</span>
    </label>
  );

  // Un resumen de una línea para cuando está cerrado: se lee sin abrir nada.
  const resumen = `ROAS < ${fmtR(cfg.roasMaxPausar)} te pone en la mira · confirma: carrito o pago ${cfg.sobrePromedioPct}% sobre el promedio (7 días) · gastó ≥ ${fmtM(cfg.pisoGastoPausar, currency)}${cfg.maxComprasPausar != null ? ` · hasta ${cfg.maxComprasPausar} compras` : ''}`;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-900/40 transition">
        <SlidersHorizontal size={13} className="text-gray-400 shrink-0" />
        <span className="text-[12px] font-bold text-gray-900 dark:text-gray-100 shrink-0">Criterios para desactivar</span>
        <span className="text-[10.5px] text-gray-400 truncate">{resumen}</span>
        {abierto ? <ChevronDown size={13} className="ml-auto text-gray-400 shrink-0" /> : <ChevronRight size={13} className="ml-auto text-gray-400 shrink-0" />}
      </button>

      {abierto && (
        <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-gray-100 dark:border-gray-700/60">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Una campaña se marca para desactivar cuando cumple <b>todas</b> las condiciones encendidas. Se guarda por cuenta y en la nube — es el mismo perfil que <b>Reglas de la tienda</b>.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <Campo label="Importe gastado mínimo" sufijo={currency || ''}>
              <input type="number" className={input} value={cfgRaw?.pisoGastoPausar ?? ''} onChange={e => num('pisoGastoPausar', e.target.value)} />
            </Campo>
            <Campo label="ROAS de corte">
              <input type="number" step="0.1" className={input} value={cfgRaw?.roasMaxPausar ?? ''} onChange={e => num('roasMaxPausar', e.target.value)} />
            </Campo>
            <Campo label="Sobre el promedio" sufijo="%">
              <input type="number" className={input} value={cfgRaw?.sobrePromedioPct ?? ''} onChange={e => num('sobrePromedioPct', e.target.value)} />
            </Campo>
            <Campo label="Compras como máximo">
              <input type="number" className={input} placeholder="sin tope" value={cfgRaw?.maxComprasPausar ?? ''} onChange={e => num('maxComprasPausar', e.target.value)} />
            </Campo>
          </div>

          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.08em] text-gray-400 mb-1.5">Qué condiciones cuentan</p>
            <div className="flex flex-wrap gap-1.5">
              {CONDICIONES_PAUSA.map(c => {
                const on = activas.includes(c.clave);
                return (
                  <button key={c.clave} onClick={() => alternar(c.clave)} title={c.ayuda}
                    className={`px-2 py-1 text-[10.5px] font-semibold rounded-full border transition ${
                      on ? 'bg-[#1877F2]/10 border-[#1877F2]/40 text-[#1877F2] dark:text-[#93BBFB]'
                         : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-400 line-through'}`}>
                    {c.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              Una condición apagada se sigue viendo en el detalle de cada fila, pero no decide. Útil si el pixel no reporta un evento: si no llega ningún «pago iniciado», esa condición da siempre en rojo y marca todo.
            </p>
          </div>

          {productos.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.08em] text-gray-400 mb-1.5">ROAS de equilibrio por producto</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {productos.map(p => {
                  const suyo = cfgPara(cfgRaw, p.id);
                  const propio = cfgRaw?.porProducto?.[p.id]?.roasBreakeven;
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                      <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate flex-1" title={p.nombre}>{p.nombre}</span>
                      <input type="number" step="0.1" placeholder={fmtR(cfg.roasMaxPausar)}
                        className="w-14 px-1.5 py-0.5 text-[11px] font-mono text-right bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                        value={propio ?? ''} onChange={e => setBk(p.id, e.target.value)} />
                      {propio == null && suyo.roasBreakeven == null && (
                        <span className="text-[9px] text-gray-400 shrink-0" title="Sin breakeven propio usa el ROAS de corte general">gral.</span>
                      )}
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Cada campaña se juzga con el ROAS de equilibrio de <b>su</b> producto. El que quede vacío usa el corte general.
                {productoId && <> Estás filtrando por un producto, pero esto vale para todos.</>}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ========================================================================
// Pestaña: HOY (ronda de optimización)
// ========================================================================
export function VistaHoy({ ads, cfg, cfgRaw, setCfg, productos, productosVisibles, productoId, currency, accountId, connId, onWhy, nivel, setNivel, cambios, trabajando, onEstado, onRecalcular, promediosRef, historico, presupuestos, onPresupuesto }) {
  const [abierto, setAbierto] = useState(null);
  const [confirmando, setConfirmando] = useState(null);
  const [verCriterios, setVerCriterios] = useState(false);
  // Orden de la tabla, clickeando el encabezado. Por defecto mayor Importe
  // gastado: los que más gastan son los que más mueven el ROAS promedio de
  // la cuenta — lo primero es ver si esos tiran para arriba o para abajo.
  const [orden, setOrden] = useState({ k: 'spend', dir: 1 }); // dir 1 = mayor primero

  // Cada fila se juzga con el perfil de SU producto: el ROAS de equilibrio del
  // cepillo no es el de la crema. Antes toda la ronda usaba un corte global y
  // el breakeven por producto solo pesaba si además filtrabas por ese producto.
  const cfgDeItem = useMemo(() => {
    if (!cfgRaw || !productos?.length) return null;
    const cache = new Map();
    return (item) => {
      const nombre = item?.campaignName || item?.name;
      if (!cache.has(nombre)) {
        const p = productoDeCampana(nombre, productos, cfgRaw);
        cache.set(nombre, p ? cfgPara(cfgRaw, p.id) : null);
      }
      return cache.get(nombre);
    };
  }, [cfgRaw, productos]);

  const r = useMemo(() => rondaDeOptimizacion(ads, { cfg, cfgDeItem, promediosRef }), [ads, cfg, cfgDeItem, promediosRef]);
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
        <Criterios cfg={cfg} cfgRaw={cfgRaw} setCfg={setCfg} productos={productosVisibles}
          productoId={productoId} currency={currency}
          abierto={verCriterios} onToggle={() => setVerCriterios(v => !v)} />
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

  // Sin gasto en el día no hay nada que juzgar NI mostrar: una campaña
  // apagada o sin entrega con $0 solo agrega ruido a la tabla.
  const conGasto = r.evaluados.filter(a => Number(a.insights?.spend || 0) > 0);
  const ocultas = r.evaluados.length - conGasto.length;
  const vOrd = (a) => orden.k === 'roas' ? (Number(a.insights?.roas) || 0) : Number(a.insights?.spend || 0);
  const filas = conGasto.slice().sort((a, b) => orden.dir * (vOrd(b) - vOrd(a)));
  const clickOrden = (k) => setOrden(o => o.k === k ? { k, dir: -o.dir } : { k, dir: 1 });
  const flechaOrden = (k) => orden.k === k ? (orden.dir === 1 ? ' ↓' : ' ↑') : '';

  // Los candidatos que TODAVÍA están prendidos. El botón de tanda se ofrece
  // sobre estos: incluir las que ya pausaste haría que el contador mienta y
  // que confirmar un "Pausar 6" pause 2.
  const pausables = r.aPausar.filter(a => estadoVisible(a, cambios) === 'ACTIVE');
  // Cuántas siguen prendidas HOY (con gasto): el "cuántas tengo corriendo" de
  // un vistazo, al nivel que se esté mirando (campañas o anuncios).
  const prendidas = conGasto.filter(a => estadoVisible(a, cambios) === 'ACTIVE').length;

  // Termómetro del día: qué % de la inversión de HOY se fue a lo que está
  // para pausar. No es lo mismo pausar 69K gastando 765K (9%, un día normal)
  // que gastando 150K (46%, la cuenta viene mal y hay que achicar). Umbral:
  // sano < 15%, atención 15–30%, alarma > 30%.
  const gastoMalo = r.aPausar.reduce((s, a) => s + Number(a.insights?.spend || 0), 0);
  const pctMalo = r.promedios.spend > 0 ? (gastoMalo / r.promedios.spend) * 100 : 0;
  const tonoMalo = pctMalo >= 30 ? 'bad' : pctMalo >= 15 ? 'warn' : 'ok';

  // Cuántas filas de esta vista cambiaron de estado en esta sesión. Los KPIs de
  // arriba se calcularon con los datos que trajo Meta ANTES de esos cambios,
  // así que hay que decirlo en vez de mostrar una plata en juego que ya no es.
  const tocadas = filas.filter(a => cambios?.[a.id]).length;

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

      <Criterios cfg={cfg} cfgRaw={cfgRaw} setCfg={setCfg} productos={productosVisibles}
        productoId={productoId} currency={currency}
        abierto={verCriterios} onToggle={() => setVerCriterios(v => !v)} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Prendidas" value={String(prendidas)} tone="ok"
          sub={esCampana ? 'campañas activas con gasto hoy' : 'anuncios activos con gasto hoy'} />
        <Kpi label="Para apagar" value={String(pausables.length)} tone={pausables.length > 0 ? 'bad' : 'ok'}
          sub={pausables.length > 0
            ? (esCampana ? 'cumplen los criterios y siguen prendidas' : 'cumplen los criterios y siguen prendidos')
            : 'nada cumple los criterios de pausa'} />
        <Kpi label="Plata que podés frenar hoy" title="Lo que esos anuncios iban a gastar de acá a la noche si no los apagás." value={fmtM(r.plataEnJuego, currency)} tone="bad"
          sub={r.plataRedirigible > 0 && r.ahorroPotencial > 0
            ? `${fmtM(r.ahorroPotencial, currency)} se ahorra · ${fmtM(r.plataRedirigible, currency)} se redirige`
            : r.plataRedirigible > 0
              ? `se redirige a los otros anuncios (presupuesto de campaña)`
              : `${r.aPausar.length} anuncio${r.aPausar.length === 1 ? '' : 's'} para pausar`}>
          <Why k="plataEnRiesgo" cfg={cfg} currency={currency} onOpen={onWhy}
            datos={r.aPausar[0]?.pausa ? { ...r.aPausar[0].pausa, gastoHoy: r.aPausar[0].insights.spend } : {}} />
        </Kpi>
        <Kpi label="Mal invertido hoy" value={fmtP(pctMalo)} tone={tonoMalo}
          sub={r.aPausar.length
            ? `${fmtM(gastoMalo, currency)} del gasto de hoy fue a lo marcado para apagar (sano: menos de 15%)`
            : 'nada para apagar — el gasto está sano'} />
        <Kpi label="Gastado hoy" value={fmtM(r.promedios.spend, currency)}
          sub={`${ads.length} anuncios con gasto hoy`} />
        <Kpi label="ROAS del día" value={fmtR(r.promedios.roas)}
          tone={r.promedios.roas >= (cfg.roasMaxPausar || 1) ? 'ok' : 'bad'}
          sub={`${fmtM(r.promedios.revenue, currency)} facturado`}>
          <Why k="roas" datos={r.promedios} cfg={cfg} currency={currency} onOpen={onWhy} />
        </Kpi>
        <Kpi label="Costo por carrito" value={fmtM(r.referencia.costoPorATC, currency)}
          sub={r.usaReferencia ? 'promedio cuenta · últimos 7 días' : 'promedio de la cuenta (hoy)'}>
          <Why k="promedioCuenta" datos={r.referencia} cfg={cfg} currency={currency} onOpen={onWhy} />
        </Kpi>
        <Kpi label="Costo por pago" value={fmtM(r.referencia.costoPorCheckout, currency)}
          sub={`umbral ${fmtM((r.referencia.costoPorCheckout || 0) * (1 + cfg.sobrePromedioPct / 100), currency)}`}>
          <Why k="costoPorCheckout" datos={r.referencia} cfg={cfg} currency={currency} onOpen={onWhy} />
        </Kpi>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
          <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Ronda de optimización</h3>
          <Why k="pausar" cfg={cfg} currency={currency} onOpen={onWhy} datos={{}} />
          <span className="text-[10.5px] text-gray-400">ordenado por importe gastado — click en las columnas para cambiar</span>
          <span className="ml-auto flex items-center gap-2">
            {selectorNivel}
            {pausables.length > 0 && (
              <button onClick={() => setConfirmando(pausables)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-bold whitespace-nowrap text-white bg-red-600 hover:bg-red-700 transition">
                <Pause size={9} /> Desactivar {pausables.length}
              </button>
            )}
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
                <th className="text-left font-bold px-2 py-2" title={TIP_ENTREGA}>Entrega</th>
                <th className="text-left font-bold px-2 py-2" title="Lo que te recomendamos hacer con cada uno.">Veredicto</th>
                <th className="text-right font-bold px-2 py-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition"
                  title="Lo que Meta llama «Importe gastado» — click para ordenar por mayor/menor"
                  onClick={() => clickOrden('spend')}>Importe gastado{flechaOrden('spend')}</th>
                <th className="text-right font-bold px-2 py-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition"
                  title="Lo que Meta llama «ROAS de compras» — click para ordenar por mayor/menor"
                  onClick={() => clickOrden('roas')}>ROAS de compras{flechaOrden('roas')}</th>
                <th className="text-right font-bold px-2 py-2" title="Costo por agregar al carrito">Costo p/ carrito</th>
                <th className="text-right font-bold px-2 py-2" title="Costo por pago iniciado">Costo p/ pago</th>
                <th className="text-right font-bold px-2 py-2" title="Plata por día. Hacé doble click sobre el número para cambiarlo.">Presupuesto</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {filas.length === 0 && (
                <tr><td colSpan={9} className="px-3.5 py-6 text-center text-xs text-gray-400">
                  Ninguna {esCampana ? 'campaña' : 'anuncio'} con gasto hoy{ocultas > 0 ? ` — ${ocultas} sin entrega quedaron ocultas` : ''}.
                </td></tr>
              )}
              {filas.map(a => {
                const p = a.pausa, i = a.insights;
                const open = abierto === a.id;
                // Oportunidad de escala: solo tiene sentido en lo que NO es
                // candidato a pausar y viene con gasto hoy. La estabilidad se
                // mide contra el acumulado del mismo item en los últimos días.
                const opp = (!p.accion && i.spend > 0)
                  ? oportunidadDeEscala(i, historico?.get?.(a.id), a.cfgUsada || cfg)
                  : { es: false };
                // Sin gasto hoy (o debajo del piso) no hay nada que juzgar:
                // "Sin datos aún", neutro — ni "va bien" ni "dejalo correr".
                const sinDatos = i.spend <= 0 || i.spend < (cfg.pisoGastoPausar || 0);
                const tone = p.accion === 'pausar' ? 'bad' : (p.accion === 'dejar-correr' || p.accion === 'testeo') ? 'warn'
                  : opp.es ? 'up'
                  : sinDatos ? 'mute' : 'ok';
                const label = p.accion === 'pausar' ? 'Pausar' : p.accion === 'dejar-correr' ? 'Dejalo correr' : p.accion === 'testeo' ? '🧪 Testeo'
                  : opp.es ? '📈 Subir presupuesto'
                  : sinDatos ? 'Sin datos aún' : 'Va bien';
                // Tooltip del veredicto: qué significa y qué hacer (para que
                // lo entienda cualquiera, no solo quien armó las reglas).
                const tipVeredicto = p.accion === 'pausar' ? 'Vende poco y le cuesta caro llegar al carrito. Conviene apagarlo.'
                  : p.accion === 'testeo' ? `Viene mal, pero es nueva (${p.edadDias < 1 ? 'unas horas' : Math.floor(p.edadDias) + ' día(s)'}): es un testeo madurando. Se marca para pausar recién a los ${(a.cfgUsada || cfg).diasMinPausar ?? 2} días — destildalo en los criterios si querés que salte igual.`
                  : p.accion === 'dejar-correr' ? 'Hoy vende poco, pero la gente llega al carrito a buen precio. Esperá; la venta puede llegar más tarde.'
                  : opp.es ? 'Viene vendiendo bien hoy y toda la semana. Probá darle más plata.'
                  : sinDatos ? 'Gastó muy poco todavía para juzgarlo.'
                  : 'Rinde por encima de tu mínimo. No hace falta tocar nada.';
                // Franja + fondo por veredicto: rojo suave = apagar, ámbar =
                // seguir de cerca, verde = va bien, verde fuerte = escalar.
                // Formal, tipo planilla: sin fondos tintados por fila — el color
                // queda en la franja izquierda y en la pastilla del veredicto.
                const tinte = '';
                const franja = tone === 'bad' ? 'border-l-[3px] border-l-red-400/80'
                  : tone === 'warn' ? 'border-l-[3px] border-l-amber-400/80'
                  : tone === 'up' ? 'border-l-[3px] border-l-emerald-500'
                  : tone === 'ok' ? 'border-l-[3px] border-l-emerald-500/35'
                  : 'border-l-[3px] border-l-transparent';
                return (
                  <React.Fragment key={a.id}>
                    <tr onClick={() => setAbierto(open ? null : a.id)}
                      className={`cursor-pointer transition ${tinte} ${open ? 'bg-gray-50 dark:bg-gray-900/40' : 'hover:bg-gray-50 dark:hover:bg-gray-900/30'} ${
                        estadoVisible(a, cambios) === 'PAUSED' ? 'opacity-55' : ''}`}>
                      <td className={`px-3.5 py-2 max-w-[280px] ${franja}`}>
                        <div className="flex items-center gap-2">
                          <SwitchEstado
                            estado={estadoVisible(a, cambios)}
                            trabajando={!!trabajando?.[a.id]}
                            onCambiar={(status) => onEstado({ items: [a], status })}
                          />
                          {open ? <ChevronDown size={13} className="text-brand-500 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{a.name}</span>
                              {esCampana && a.dailyBudget == null && a.lifetimeBudget == null && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[8.5px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300"
                                  title="ABO: el presupuesto vive en los conjuntos. Expandí la fila para optimizar conjunto por conjunto (prender/apagar y presupuesto).">
                                  ABO · por conjunto
                                </span>
                              )}
                            </span>
                            {!esCampana && <span className="block text-[10px] text-gray-400 truncate">{a.campaignName}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2"><Entrega item={a} cambios={cambios} /></td>
                      <td className="px-2 py-2"><Pill tone={tone} title={tipVeredicto}>{label}</Pill></td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                        {fmtM(i.spend, currency)}
                        {r.promedios.spend > 0 && i.spend > 0 && (
                          <span className="block text-[9px] font-semibold text-gray-400"
                            title="Qué parte de la inversión de hoy se lleva — a mayor peso, más mueve el ROAS promedio de la cuenta.">
                            {fmtP(i.spend / r.promedios.spend * 100)} del total
                          </span>
                        )}
                      </td>
                      {/* Verde/rojo contra el ROAS de equilibrio de SU producto (antes
                          comparaba contra p.cortes, que no existe → siempre rojo). */}
                      <td className={`px-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap ${i.roas >= (a.cfgUsada?.roasMaxPausar ?? cfg.roasMaxPausar) ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {fmtR(i.roas)}
                        {i.spend > 0 && r.promedios.roas > 0 && (
                          i.roas >= r.promedios.roas
                            ? <span className="ml-1 text-emerald-500" title={`Te SUBE el ROAS promedio de la cuenta (hoy: ${fmtR(r.promedios.roas)})`}>▲</span>
                            : <span className="ml-1 text-red-500" title={`Te BAJA el ROAS promedio de la cuenta (hoy: ${fmtR(r.promedios.roas)})`}>▼</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.costoATC != null ? fmtM(p.costoATC, currency) : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.costoCheckout != null ? fmtM(p.costoCheckout, currency) : '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <PresupuestoCell a={a} p={p} cfg={cfg} currency={currency} nivel={nivel}
                          override={presupuestos?.[a.id]} onGuardar={onPresupuesto} />
                      </td>
                      <td className="px-2 py-2 text-right"><MetaLink nivel={nivel} ids={[a.id]} accountId={accountId}>Meta</MetaLink></td>
                    </tr>
                    {open && (
                      <tr><td colSpan={9} className="bg-gray-50/60 dark:bg-gray-900/40 px-3.5 py-3">
                        <div className="pl-5 space-y-1.5">
                          {/* Al expandir una CAMPAÑA va directo el desglose por conjuntos
                              (pedido de Lucas: sin el checklist técnico de criterios — el
                              porqué del veredicto queda en una línea y en el ⓘ). */}
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5 flex-wrap">
                            {p.motivoAccion || (opp.es ? opp.motivo : 'No está en la mira: gastó poco o el ROAS está sobre el corte.')}
                            <Why k="plataEnRiesgo" cfg={cfg} currency={currency} onOpen={onWhy} datos={{ ...p, gastoHoy: i.spend }} />
                          </p>
                          {esCampana ? (
                            <DesgloseCampana campaignId={a.id} accountId={accountId} connId={connId} currency={currency}
                              presupuestos={presupuestos} onPresupuesto={onPresupuesto} />
                          ) : (
                            p.condiciones.map((c, n) => (
                              <div key={n} className={`flex items-start gap-2 text-[11.5px] ${c.cuenta === false ? 'opacity-45' : ''}`}>
                                <span className={`w-[15px] h-[15px] rounded-full grid place-items-center text-[9px] font-bold shrink-0 mt-px ${
                                  c.cuenta === false ? 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                                    : c.ok ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-400'}`}>
                                  {c.cuenta === false ? '–' : c.ok ? '✓' : '·'}
                                </span>
                                <span className="text-gray-600 dark:text-gray-300">
                                  {c.texto}
                                  {c.cuenta === false && <span className="text-gray-400"> · apagada en los criterios</span>}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {ocultas > 0 && filas.length > 0 && (
          <p className="px-3.5 py-2 border-t border-gray-100 dark:border-gray-700/60 text-[10.5px] text-gray-400">
            {ocultas} {esCampana ? (ocultas === 1 ? 'campaña' : 'campañas') : (ocultas === 1 ? 'anuncio' : 'anuncios')} con $0 de gasto hoy (sin entrega) no se muestran.
          </p>
        )}
        {tocadas > 0 && (
          <div className="flex items-center gap-2 flex-wrap px-3.5 py-2 border-t border-gray-100 dark:border-gray-700/60 text-[11px] bg-amber-50/70 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200">
            <AlertTriangle size={12} className="shrink-0" />
            <span>Cambiaste {tocadas} {tocadas === 1 ? 'de estado' : 'de estado'}. Los números de arriba son los que trajo Meta antes de eso.</span>
            <button onClick={onRecalcular}
              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition">
              <RefreshCw size={10} /> Recalcular
            </button>
          </div>
        )}
      </div>

      <ConfirmarTanda
        abierto={!!confirmando} items={confirmando || []} currency={currency}
        onCancelar={() => setConfirmando(null)}
        onConfirmar={() => { onEstado({ items: confirmando, status: 'PAUSED' }); setConfirmando(null); }}
      />
    </div>
  );
}

// ========================================================================
// Pestaña: SEMANAS (cohortes de testeo)
// ========================================================================
function VistaSemanas({ campaigns, cfg, productos, productoId, currency, accountId, connId, preset = 'last_30d', onWhy, fotos }) {
  const [abierto, setAbierto] = useState(null);
  // Mix VIDEO vs IMAGEN por campaña (lazy, cache-first): qué % de cada semana
  // fue video y qué % imagen, y cuál rindió mejor. Pedido del user.
  const [mix, setMix] = useState(null); // null = cargando | {campaignId: {video, imagen}}
  useEffect(() => {
    if (!accountId) { setMix({}); return; }
    let vivo = true;
    const path = `semanas-mix?account_id=${encodeURIComponent(accountId)}&date_preset=${encodeURIComponent(preset)}`;
    const cacheado = leerCacheMeta(path);
    if (cacheado) setMix(cacheado.data.porCampana || {});
    (async () => {
      try {
        const d = await fetchMeta(path, { connId });
        if (vivo) setMix(d.porCampana || {});
      } catch { if (vivo && !cacheado) setMix({}); }
    })();
    return () => { vivo = false; };
  }, [accountId, connId, preset]);

  // Agrega el mix de una semana sumando sus campañas.
  const mixDe = (f) => {
    if (!mix) return null;
    const acc = { video: { ads: 0, spend: 0, compras: 0, revenue: 0 }, imagen: { ads: 0, spend: 0, compras: 0, revenue: 0 } };
    let hubo = false;
    for (const id of (f.idsTodas || [])) {
      const m = mix[id];
      if (!m) continue;
      hubo = true;
      for (const t of ['video', 'imagen']) {
        acc[t].ads += m[t].ads; acc[t].spend += m[t].spend; acc[t].compras += m[t].compras; acc[t].revenue += m[t].revenue;
      }
    }
    if (!hubo) return null;
    const total = acc.video.spend + acc.imagen.spend;
    return {
      ...acc,
      pctVideo: total > 0 ? (acc.video.spend / total) * 100 : 0,
      roasV: acc.video.spend > 0 ? acc.video.revenue / acc.video.spend : 0,
      roasI: acc.imagen.spend > 0 ? acc.imagen.revenue / acc.imagen.spend : 0,
    };
  };
  // Etapa: la eficiencia semanal se mide sobre los TESTEOS (renovaciones).
  // Las preescalas (deep pocket, mayor roas, cost cap, bid cap, only pocket)
  // y escalas se pueden mirar aparte con los chips, pero no mezclan.
  const [etapa, setEtapa] = useState('testeo');
  const filas = useMemo(() => {
    const { filas: vivas } = cohortesSemanales(campaigns, { cfg, productos, productoId, etapa });
    // Las fotos congeladas se sacaron sobre los testeos — para las otras
    // etapas se muestra siempre el número en vivo.
    return etapa === 'testeo' ? fusionarConFotos(vivas, fotos || {}) : vivas;
  }, [campaigns, cfg, productos, productoId, fotos, etapa]);

  const chipsEtapa = (
    <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 ml-auto">
      {ETAPAS.map(e => (
        <button key={e.id} onClick={() => { setEtapa(e.id); setAbierto(null); }}
          title={e.id === 'testeo' ? 'Renovaciones: video / imagen / orgánico / testeo'
            : e.id === 'preescala' ? 'Deep pocket · mayor ROAS · cost cap · bid cap · only pocket'
            : e.id === 'escala' ? 'Campañas de escala' : 'Testeos + preescalas + escalas'}
          className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition ${
            etapa === e.id ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          {e.emoji ? `${e.emoji} ` : ''}{e.label}
        </button>
      ))}
    </div>
  );

  if (filas.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
        <div className="flex justify-center mb-3">{chipsEtapa}</div>
        <FlaskConical size={24} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {etapa === 'testeo' ? 'Ninguna campaña entra como testeo' : `No hay campañas de ${etapa === 'preescala' ? 'preescala' : etapa === 'escala' ? 'escala' : 'ninguna etapa'} con fecha`}
        </p>
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
        <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
          {etapa === 'testeo' ? 'Testeos' : etapa === 'preescala' ? 'Preescalas' : etapa === 'escala' ? 'Escalas' : 'Campañas'} por semana
        </h3>
        <Why k="cohorte" cfg={cfg} currency={currency} onOpen={onWhy} datos={{ name: filas[0]?.items[0]?.name, fecha: filas[0]?.items[0]?.fecha, semana: filas[0]?.semana }} />
        <span className="text-[10.5px] text-gray-400">lunes a domingo, según la fecha del nombre</span>
        {chipsEtapa}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-400 text-[9.5px] uppercase tracking-wider">
              <th className="text-left font-bold px-3.5 py-2" title="Las campañas agrupadas por la semana en que arrancaron.">Semana</th>
              <th className="text-left font-bold px-2 py-2" title="De las campañas nuevas que ya se pueden juzgar, qué % salió ganadora.">Eficiencia</th>
              <th className="text-right font-bold px-2 py-2">Ganó</th>
              <th className="text-right font-bold px-2 py-2">Perdió</th>
              <th className="text-right font-bold px-2 py-2">Sin datos</th>
              <th className="text-right font-bold px-2 py-2">Gasto</th>
              <th className="text-right font-bold px-2 py-2">Facturado</th>
              <th className="text-right font-bold px-2 py-2" title={TIP_ROAS}>ROAS</th>
              <th className="text-left font-bold px-2 py-2" title="Qué % del gasto de la semana fue a anuncios de VIDEO y qué % a IMAGEN, y el ROAS de cada tipo. En verde, el que rindió mejor.">🎥 / 🖼</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {filas.map((f, idx) => {
              const open = abierto === f.semana;
              const tone = f.eficiencia >= 50 ? 'ok' : f.eficiencia >= 30 ? 'warn' : 'bad';
              // Separador de MES: las filas ya vienen ordenadas de la más
              // nueva a la más vieja, así que las semanas del mismo mes son
              // contiguas — un header cada vez que cambia el mes del lunes.
              const mes = mesDeSemana(f.semana);
              const mesAnterior = idx > 0 ? mesDeSemana(filas[idx - 1].semana) : undefined;
              const nuevoMes = idx === 0 || mes !== mesAnterior;
              const nroSemana = semanaDelMes(f.semana);
              return (
                <React.Fragment key={f.semana || 'sin'}>
                  {nuevoMes && (
                    <tr className="bg-gray-50/80 dark:bg-gray-900/60">
                      <td colSpan={10} className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {etiquetaMes(mes)}
                      </td>
                    </tr>
                  )}
                  <tr onClick={() => setAbierto(open ? null : f.semana)}
                    className={`cursor-pointer transition ${open ? 'bg-gray-50 dark:bg-gray-900/40' : 'hover:bg-gray-50 dark:hover:bg-gray-900/30'}`}>
                    <td className="px-3.5 py-2">
                      <div className="flex items-center gap-2">
                        {open ? <ChevronDown size={13} className="text-brand-500 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                        <span>
                          <span className="flex items-center gap-1.5">
                            <span className="font-semibold text-gray-900 dark:text-gray-100">
                              {nroSemana ? `Semana ${nroSemana}` : 'Sin fecha en el nombre'}
                            </span>
                            <span className="text-[10px] text-gray-400 font-normal">{f.semana ? f.etiqueta : ''}</span>
                            {f.cerrada
                              ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                                  title="Número congelado: la semana ya pasó los días de atribución de Meta.">CERRADA</span>
                              : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                  title="Todavía sumando compras: Meta atribuye hasta 7 días después del click.">EN VIVO</span>}
                            <Why k="foto" cfg={cfg} currency={currency} onOpen={onWhy} datos={f} />
                          </span>
                          <span className="block text-[10px] text-gray-400">
                            {f.lanzadas} {etapa === 'testeo' ? 'testeo' : 'campaña'}{f.lanzadas === 1 ? '' : 's'} · {f.activas} sigue{f.activas === 1 ? '' : 'n'} prendida{f.activas === 1 ? '' : 's'}{f.programadas > 0 && <> · {f.programadas} programada{f.programadas === 1 ? '' : 's'}</>}
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
                    <td className="px-2 py-2 whitespace-nowrap">
                      {(() => {
                        const m = mixDe(f);
                        if (!m) return <span className="text-gray-400 text-[10px]">{mix === null ? '…' : '—'}</span>;
                        const soloUno = m.video.spend <= 0 || m.imagen.spend <= 0;
                        const ganaVideo = m.roasV >= m.roasI;
                        return (
                          <span className="inline-flex flex-col leading-tight text-[10.5px] tabular-nums"
                            title={`Video: ${m.video.ads} ads · ${fmtM(m.video.spend, currency)} · ${m.video.compras} compras · ROAS ${fmtR(m.roasV)}\nImagen: ${m.imagen.ads} ads · ${fmtM(m.imagen.spend, currency)} · ${m.imagen.compras} compras · ROAS ${fmtR(m.roasI)}`}>
                            <span className={soloUno || ganaVideo ? (m.video.spend > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-gray-400') : 'text-gray-500 dark:text-gray-400'}>
                              🎥 {Math.round(m.pctVideo)}%{m.video.spend > 0 ? ` · ${fmtR(m.roasV)}` : ''}
                            </span>
                            <span className={soloUno || !ganaVideo ? (m.imagen.spend > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-gray-400') : 'text-gray-500 dark:text-gray-400'}>
                              🖼 {Math.round(100 - m.pctVideo)}%{m.imagen.spend > 0 ? ` · ${fmtR(m.roasI)}` : ''}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <MetaLink nivel="campaigns" accountId={accountId}
                        ids={f.idsGanadoras.length ? f.idsGanadoras : f.idsTodas}
                        desde={f.semana} hasta={f.semana ? finDe(f.semana) : null}>
                        {f.idsGanadoras.length ? `Ver ${f.idsGanadoras.length} ganadora${f.idsGanadoras.length === 1 ? '' : 's'}` : 'Ver en Meta'}
                      </MetaLink>
                    </td>
                  </tr>
                  {open && (
                    <tr><td colSpan={10} className="bg-gray-50/60 dark:bg-gray-900/40 px-3.5 py-3">
                      <div className="pl-5 overflow-x-auto">
                        <table className="w-full text-xs min-w-[780px]">
                          <thead>
                            <tr className="text-gray-400 text-[9.5px] uppercase tracking-wider">
                              <th className="text-left font-bold px-2 py-1.5">Campaña</th>
                              <th className="text-left font-bold px-2 py-1.5">Entrega</th>
                              <th className="text-left font-bold px-2 py-1.5">Veredicto</th>
                              <th className="text-right font-bold px-2 py-1.5">Compras</th>
                              <th className="text-right font-bold px-2 py-1.5">Importe gastado</th>
                              <th className="text-right font-bold px-2 py-1.5">ROAS de compras</th>
                              <th className="text-right font-bold px-2 py-1.5">CPA</th>
                              <th className="text-right font-bold px-2 py-1.5">Costo p/ carrito</th>
                              <th className="text-right font-bold px-2 py-1.5">Costo p/ pago</th>
                              <th className="px-2 py-1.5" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                            {f.items.map(c => {
                              // Las mismas métricas y el mismo formato que la tabla de
                              // "Hoy — qué pausar", filtradas a las campañas de ESTA semana.
                              const i = c.insights || {};
                              const gasto = Number(i.spend || 0);
                              const compras = Number(i.purchases || 0);
                              const roasC = gasto > 0 ? Number(i.revenue || 0) / gasto : 0;
                              const atc = Number(i.addToCart || 0);
                              const chk = Number(i.initiateCheckout || 0);
                              // "Sin datos" seco confunde cuando la campaña ni arrancó
                              // (programada) o arrancó hace horas (recién lanzada):
                              // se aclara con la Fecha de inicio real de Meta.
                              const sinVeredicto = c.veredicto.estado !== 'ganador' && c.veredicto.estado !== 'perdedor';
                              const inicio = c.startTime ? new Date(c.startTime) : null;
                              const inicioOk = inicio && !Number.isNaN(inicio.getTime());
                              const programada = !!(inicioOk && inicio.getTime() > Date.now());
                              const recienLanzada = !!(sinVeredicto && !programada && inicioOk && (Date.now() - inicio.getTime()) < 48 * 60 * 60 * 1000);
                              const inicioStr = inicioOk ? `${inicio.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })} a las ${inicio.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : '';
                              const motivo = programada
                                ? `arranca el ${inicioStr} — todavía no corre`
                                : recienLanzada
                                  ? `lanzada el ${inicioStr} · ${c.veredicto.motivo}`
                                  : c.veredicto.motivo;
                              return (
                                <tr key={c.id}>
                                  <td className="px-2 py-2">
                                    <span className="font-semibold text-gray-900 dark:text-gray-100">{c.name}</span>
                                    {etapa === 'todas' && c.etapa && (
                                      <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                        c.etapa === 'preescala' ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                                          : c.etapa === 'escala' ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
                                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                                        {c.etapa === 'preescala' ? '🚀 preescala' : c.etapa === 'escala' ? '📈 escala' : '🧪 testeo'}
                                      </span>
                                    )}
                                    <span className="block text-[10px] text-gray-400">{motivo}{c.producto ? ` · ${c.producto.nombre}` : ''}</span>
                                  </td>
                                  <td className="px-2 py-2 whitespace-nowrap">
                                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${c.activa ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.activa ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                      {c.activa ? 'Activa' : 'Desactivada'}
                                    </span>
                                  </td>
                                  <td className="px-2 py-2">
                                    {programada ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300"
                                        title={`Fecha de inicio en Meta: ${inicioStr}. Hasta entonces no se juzga.`}>
                                        ⏰ Programada
                                      </span>
                                    ) : recienLanzada ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300"
                                        title={`Arrancó el ${inicioStr}. Se juzga cuando pase el mínimo de impresiones y gasto.`}>
                                        🚀 Recién lanzada
                                      </span>
                                    ) : (
                                      <Pill tone={c.veredicto.estado === 'ganador' ? 'ok' : c.veredicto.estado === 'perdedor' ? 'bad' : 'mute'}>
                                        {c.veredicto.estado === 'ganador' ? 'Ganadora' : c.veredicto.estado === 'perdedor' ? 'Perdedora' : 'Sin datos'}
                                      </Pill>
                                    )}
                                  </td>
                                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-700 dark:text-gray-200">{compras}</td>
                                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtM(gasto, currency)}</td>
                                  <td className={`px-2 py-2 text-right tabular-nums font-bold ${roasC >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : gasto > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{fmtR(roasC)}</td>
                                  <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{compras > 0 ? fmtM(gasto / compras, currency) : '—'}</td>
                                  <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{atc > 0 ? fmtM(gasto / atc, currency) : '—'}</td>
                                  <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{chk > 0 ? fmtM(gasto / chk, currency) : '—'}</td>
                                  <td className="px-2 py-2 text-right"><MetaLink nivel="campaigns" ids={[c.id]} accountId={accountId}>Meta</MetaLink></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
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
// Pestaña: WINNERS — galería multimedia de los creativos ganadores
// ========================================================================
// Los ads que hoy son GANADORES según las reglas de la tienda (compras +
// ROAS del producto, ventana de 14 días de ads-with-insights), con su
// creativo real traído de Meta: miniatura, el mp4 para verlo acá mismo, y
// un click que lo guarda en Referencias (mp4 persistido + análisis IA de
// hook/ángulo/estructura) para que el editor lo replique desde su tarjeta.
function VistaWinners({ account, accountId, cfg, cfgRaw, productos, productoId, currency, addToast, preset = 'last_14d' }) {
  const [adsRaw, setAdsRaw] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [player, setPlayer] = useState(null);     // { ad, source?, cargando }
  const [guardando, setGuardando] = useState({}); // adId → true
  const [guardados, setGuardados] = useState({}); // adId → referencia
  const [analisisModal, setAnalisisModal] = useState(null); // referencia con analisis
  const fuentes = useRef(new Map());              // adId → { source, lengthSec } (vencen, no persistir)
  // Desglose AUTOMÁTICO: lo ya procesado se levanta de marketing_referencias
  // (dedup por shortcode = meta_<adId>) y lo que falta se procesa solo, de a
  // uno, apenas carga la galería. Nada se desglosa dos veces.
  const [refsListas, setRefsListas] = useState(false);
  const guardadosRef = useRef({});
  const [auto, setAuto] = useState({ done: 0, total: 0, corriendo: false });
  const autoCorrido = useRef(false);
  // Default LISTA (formato tabla, como Campañas y anuncios — pedido del user).
  // Key v2: el default viejo era la galería y quedó persistido en todos lados.
  const [vista, setVista] = useState(() => {
    try { return localStorage.getItem('adslab-winners-view-v2') || 'lista'; } catch { return 'lista'; }
  });
  const cambiarVista = (v) => { setVista(v); try { localStorage.setItem('adslab-winners-view-v2', v); } catch {} };

  const metaGet = useCallback(async (path) => {
    let u = `/api/meta/${path}`;
    if (account?.connId && account.connId !== '__cookie__') {
      u += `${u.includes('?') ? '&' : '?'}connection_id=${encodeURIComponent(account.connId)}`;
    }
    const r = await fetch(u, { headers: await authHeaders(false) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }, [account]);

  // Cache-first (igual que el tablero principal): lo último guardado abre al
  // instante y el refresh corre atrás. La precarga del login ya deja esto listo.
  useEffect(() => {
    if (!accountId) return;
    let vivo = true;
    // La ventana elegida en el calendario VIAJA al server (antes se ignoraba
    // y la pestaña miraba siempre 14 días, eligieras lo que eligieras).
    const path = pathAdsWithInsights(accountId, preset);
    const cacheado = leerCacheMeta(path);
    if (cacheado) { setAdsRaw(cacheado.data.ads || []); setCargando(false); }
    else setCargando(true);
    setError(null);
    (async () => {
      try {
        const d = await fetchMeta(path, { connId: account?.connId });
        if (vivo) setAdsRaw(d.ads || []);
      } catch (e) {
        if (vivo && !cacheado) { setError(e.message); setAdsRaw(null); }
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [accountId, account, preset]);

  // Lo ya desglosado en sesiones anteriores: se hidrata desde la biblioteca
  // de Referencias así los winners procesados aparecen con su análisis al
  // instante, sin repetir Whisper/Claude (eso ya se pagó una vez).
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const d = await referenciasApi('');
        if (!vivo) return;
        const porShortcode = {};
        for (const r of d.referencias || []) {
          if (r.shortcode && r.shortcode.startsWith('meta_')) porShortcode[r.shortcode.slice(5)] = r;
        }
        guardadosRef.current = porShortcode;
        setGuardados(prev => ({ ...porShortcode, ...prev }));
      } catch { /* sin la tabla o sin red: la galería sirve igual */ }
      if (vivo) setRefsListas(true);
    })();
    return () => { vivo = false; };
  }, []);

  // Ganadores con las reglas de SU producto (mismo criterio que las cohortes).
  const winners = useMemo(() => (adsRaw || [])
    .map(ad => {
      const producto = productoDeCampana(ad.campaign?.name || ad.name, productos, cfgRaw);
      let cfgProd = cfg;
      try { if (producto && cfgRaw) cfgProd = cfgPara(cfgRaw, producto.id); } catch {}
      return { ...ad, producto, v: veredicto(ad.insights, cfgProd) };
    })
    .filter(a => a.v?.estado === 'ganador')
    .filter(a => !productoId || a.producto?.id === productoId)
    .sort((x, y) => (y.insights?.roas || 0) - (x.insights?.roas || 0)), [adsRaw, productos, cfgRaw, cfg, productoId]);

  // El mp4 del creativo: la URL del CDN de Meta vence, se pide al momento.
  // En muchas cuentas Meta NO expone el source con el permiso del token
  // ((#10)) — ahí se cae a la VISTA PREVIA oficial del ad (/previews), que
  // reproduce el creativo real en un iframe y funciona con ads_read.
  const fuenteDe = useCallback(async (ad) => {
    if (!ad.creative?.videoId) return null;
    if (fuentes.current.has(ad.id)) return fuentes.current.get(ad.id);
    const d = await metaGet(`video-source?video_id=${encodeURIComponent(ad.creative.videoId)}&account_id=${encodeURIComponent(accountId)}`);
    fuentes.current.set(ad.id, d);
    return d;
  }, [metaGet, accountId]);

  const previews = useRef(new Map()); // adId → iframeSrc (vence a las 24 h)
  const previewDe = useCallback(async (ad) => {
    if (previews.current.has(ad.id)) return previews.current.get(ad.id);
    const d = await metaGet(`ad-preview?ad_id=${encodeURIComponent(ad.id)}`);
    previews.current.set(ad.id, d.iframeSrc);
    return d.iframeSrc;
  }, [metaGet]);

  const ver = async (ad) => {
    setPlayer({ ad, cargando: true });
    try {
      if (ad.creative?.videoId) {
        try {
          const f = await fuenteDe(ad);
          if (f?.source) {
            setPlayer(prev => (prev?.ad?.id === ad.id ? { ad, source: f.source, cargando: false } : prev));
            return;
          }
        } catch { /* sin mp4 → probamos la vista previa */ }
      }
      const iframeSrc = await previewDe(ad);
      setPlayer(prev => (prev?.ad?.id === ad.id ? { ad, iframeSrc, cargando: false } : prev));
    } catch (e) {
      addToast?.({ type: 'error', message: `No pude traer la vista previa: ${e.message}` });
      setPlayer(prev => (prev?.ad?.id === ad.id ? { ad, cargando: false } : prev));
    }
  };

  // Procesa UN winner: persiste mp4 + miniatura en Referencias y corre el
  // análisis IA (hook / ángulo / estructura). Con `abrirModal` (click manual)
  // muestra el resultado; el modo automático trabaja en silencio. De ahí en
  // más vale todo el circuito: guion adaptado y envío a tarjetas.
  const procesar = async (ad, { abrirModal = false } = {}) => {
    // Ya desglosado en otra sesión → directo al resultado, sin gastar nada.
    const previo = guardadosRef.current[ad.id];
    if (previo?.analisis) {
      setGuardados(prev => ({ ...prev, [ad.id]: previo }));
      if (abrirModal) setAnalisisModal(previo);
      return previo;
    }
    setGuardando(prev => ({ ...prev, [ad.id]: true }));
    try {
      let fuente = null;
      if (ad.creative?.videoId) {
        try { fuente = await fuenteDe(ad); }
        catch (e) { if (abrirModal) addToast?.({ type: 'warning', message: `Sin mp4 (${e.message}) — guardo la miniatura igual.` }); }
      }
      const data = await referenciasApi('?action=add-external', {
        method: 'POST',
        body: {
          refId: ad.id,
          videoUrl: fuente?.source || '',
          thumbUrl: ad.creative?.thumbnailUrl || ad.creative?.imageUrl || '',
          caption: ad.creative?.body || ad.creative?.title || '',
          owner: ad.campaign?.name || ad.name,
          url: linkMeta({ accountId, nivel: 'ads', ids: [ad.id] }),
          duration: fuente?.lengthSec || null,
          platform: 'meta',
          productoId: ad.producto?.id ?? null,
        },
      });
      if (data.videoWarn && abrirModal) addToast?.({ type: 'warning', message: data.videoWarn });
      let ref = data.referencia;
      if (!ref.analisis) {
        const anal = await referenciasApi('?action=analyze', { method: 'POST', body: { id: ref.id } });
        ref = anal.referencia;
      }
      guardadosRef.current[ad.id] = ref;
      setGuardados(prev => ({ ...prev, [ad.id]: ref }));
      if (abrirModal) setAnalisisModal(ref);
      return ref;
    } catch (e) {
      if (abrirModal) addToast?.({ type: 'error', message: `No se pudo desglosar el winner: ${e.message}` });
      throw e;
    } finally {
      setGuardando(prev => ({ ...prev, [ad.id]: false }));
    }
  };

  // Cola automática: cuando la galería y la biblioteca están cargadas, lo
  // que falte desglosar se procesa solo, de a uno (controla costo y rate
  // limits). Corre una vez por visita a la pestaña; lo procesado persiste,
  // así la próxima vez no hay nada que hacer.
  useEffect(() => {
    if (!refsListas || autoCorrido.current || winners.length === 0) return;
    autoCorrido.current = true;
    const pendientes = winners.filter(ad => !guardadosRef.current[ad.id]?.analisis);
    if (pendientes.length === 0) return;
    let cancelado = false;
    setAuto({ done: 0, total: pendientes.length, corriendo: true });
    (async () => {
      let hechos = 0;
      for (const ad of pendientes) {
        if (cancelado) return;
        try { await procesar(ad); } catch { /* seguimos con el próximo */ }
        hechos++;
        if (!cancelado) setAuto({ done: hechos, total: pendientes.length, corriendo: true });
      }
      if (!cancelado) {
        setAuto(a => ({ ...a, corriendo: false }));
        addToast?.({ type: 'success', message: `${hechos} winner${hechos === 1 ? '' : 's'} desglosado${hechos === 1 ? '' : 's'} y guardado${hechos === 1 ? '' : 's'} en Referencias ✓` });
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsListas, winners]);

  if (cargando) {
    return <div className="flex items-center justify-center py-14 text-gray-400"><Loader2 size={18} className="animate-spin mr-2" /> Buscando tus winners en Meta…</div>;
  }
  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
        <AlertCircle size={17} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-900 dark:text-red-200">No pude traer los creativos</p>
          <p className="text-xs text-red-700 dark:text-red-300 mt-0.5 break-words">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Trophy size={15} className="text-amber-500" />
        <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Winners · {etiquetaVentana(preset, PRESETS_WINNERS)}</h3>
        <span className="text-[10.5px] text-gray-400">
          ganador = las reglas de su producto (compras + ROAS) · el desglose IA corre solo y queda guardado en Referencias
        </span>
        {auto.corriendo && (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[10.5px] font-bold"
            title="Transcribiendo y analizando cada winner nuevo con IA. Lo procesado queda guardado — no se repite.">
            <Loader2 size={11} className="animate-spin" /> Desglosando {auto.done}/{auto.total}…
          </span>
        )}
        <div className="ml-auto inline-flex gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
          {[{ id: 'grid', l: 'Galería' }, { id: 'lista', l: 'Lista' }].map(o => (
            <button key={o.id} onClick={() => cambiarVista(o.id)}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition ${
                vista === o.id ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {winners.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
          <Trophy size={24} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ningún ad califica como winner en {etiquetaVentana(preset, PRESETS_WINNERS)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">El corte es el de <b>Reglas</b> (compras mínimas + ROAS del producto). Probá una ventana más larga con el calendario de arriba.</p>
        </div>
      ) : vista === 'lista' ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-400 text-[9.5px] uppercase tracking-wider">
                  <th className="text-left font-bold px-3.5 py-2">Creativo</th>
                  <th className="text-left font-bold px-2 py-2">Campaña · producto</th>
                  <th className="text-right font-bold px-2 py-2" title={TIP_ROAS}>ROAS</th>
                  <th className="text-right font-bold px-2 py-2">Compras</th>
                  <th className="text-right font-bold px-2 py-2">Gasto</th>
                  <th className="text-right font-bold px-2 py-2">Facturado</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                {winners.map(ad => {
                  const ref = guardados[ad.id];
                  const i = ad.insights || {};
                  return (
                    <tr key={ad.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition">
                      <td className="px-3.5 py-2">
                        <button onClick={() => ver(ad)} className="flex items-center gap-2.5 text-left group">
                          <span className="relative w-9 h-14 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0">
                            {(ad.creative?.thumbnailUrl || ad.creative?.imageUrl) && (
                              <img src={ad.creative.thumbnailUrl || ad.creative.imageUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                            )}
                            <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 group-hover:opacity-100 transition">
                              <Play size={12} className="text-white" fill="currentColor" />
                            </span>
                          </span>
                          <span className="min-w-0 font-semibold text-gray-900 dark:text-gray-100 truncate max-w-[220px]" title={ad.name}>{ad.name}</span>
                        </button>
                      </td>
                      <td className="px-2 py-2 text-gray-500 dark:text-gray-400 max-w-[220px]">
                        <span className="block truncate" title={ad.campaign?.name}>{ad.campaign?.name}</span>
                        {ad.producto && <span className="block text-[10px] text-gray-400 truncate">{ad.producto.nombre}</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtR(i.roas)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{i.purchases || 0}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtM(i.spend, currency)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtM(i.revenue, currency)}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button onClick={() => procesar(ad, { abrirModal: true })} disabled={!!guardando[ad.id]}
                            className={`inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-bold rounded-md transition disabled:opacity-50 ${ref ? 'text-emerald-600 dark:text-emerald-400' : 'text-white bg-amber-500 hover:bg-amber-600'}`}>
                            {guardando[ad.id] ? <Loader2 size={11} className="animate-spin" /> : ref ? <Check size={11} /> : <BookmarkPlus size={11} />}
                            {ref ? 'Guardado' : 'Desglosar'}
                          </button>
                          {ref?.analisis && (
                            <button onClick={() => setAnalisisModal(ref)} className="text-[10.5px] font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Análisis</button>
                          )}
                          <MetaLink nivel="ads" ids={[ad.id]} accountId={accountId}>Meta</MetaLink>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {winners.map(ad => {
            const ref = guardados[ad.id];
            const i = ad.insights || {};
            return (
              <div key={ad.id} className="rounded-xl border border-amber-200/70 dark:border-amber-900/40 bg-white dark:bg-gray-900 overflow-hidden flex flex-col">
                <button onClick={() => ver(ad)} className="relative aspect-[9/16] max-h-72 w-full bg-gray-100 dark:bg-gray-800 group overflow-hidden">
                  {(ad.creative?.thumbnailUrl || ad.creative?.imageUrl) ? (
                    <img src={ad.creative.thumbnailUrl || ad.creative.imageUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600"><Film size={30} /></div>
                  )}
                  <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold shadow"><Trophy size={10} /> ROAS {fmtR(i.roas)}</span>
                  {ad.creative?.videoId && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-80 group-hover:opacity-100 transition">
                      <span className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <Play size={18} className="text-gray-900 ml-0.5" fill="currentColor" />
                      </span>
                    </div>
                  )}
                </button>
                <div className="p-3 flex-1 flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate" title={ad.name}>{ad.name}</span>
                  <span className="text-[10px] text-gray-400 truncate" title={ad.campaign?.name}>{ad.campaign?.name}{ad.producto ? ` · ${ad.producto.nombre}` : ''}</span>
                  <span className="text-[10.5px] text-gray-500 dark:text-gray-400 tabular-nums">
                    {i.purchases || 0} compras · {fmtM(i.spend, currency)} · {fmtM(i.revenue, currency)} fact.
                  </span>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    <button onClick={() => procesar(ad, { abrirModal: true })} disabled={!!guardando[ad.id]}
                      title="Guarda el mp4 en Referencias y lo analiza con IA (hook, ángulo, estructura). Después: guion adaptado y envío a tarjeta desde Marketing → Referencias."
                      className={`inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold rounded-lg transition disabled:opacity-50 ${ref ? 'text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-white bg-amber-500 hover:bg-amber-600'}`}>
                      {guardando[ad.id] ? <Loader2 size={12} className="animate-spin" /> : ref ? <Check size={12} /> : <BookmarkPlus size={12} />}
                      {guardando[ad.id] ? 'Guardando…' : ref ? 'En Referencias' : 'Desglosar + guardar'}
                    </button>
                    {ref?.analisis && (
                      <button onClick={() => setAnalisisModal(ref)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                        Ver análisis
                      </button>
                    )}
                    <MetaLink nivel="ads" ids={[ad.id]} accountId={accountId}>Meta</MetaLink>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reproductor */}
      {player && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setPlayer(null)}>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPlayer(null)} className="absolute -top-9 right-0 text-white/80 hover:text-white"><X size={22} /></button>
            {player.cargando ? (
              <div className="w-[340px] h-[560px] rounded-xl bg-gray-900 flex items-center justify-center text-gray-400"><Loader2 size={20} className="animate-spin mr-2" /> Trayendo la vista previa…</div>
            ) : player.source ? (
              <video src={player.source} controls autoPlay playsInline className="max-h-[82vh] max-w-[92vw] rounded-xl bg-black shadow-2xl" />
            ) : player.iframeSrc ? (
              // Vista previa oficial del ad (la misma que Ads Manager): video,
              // caption y CTA reales. Se usa cuando Meta no entrega el mp4.
              <iframe src={player.iframeSrc} title={`Preview ${player.ad.name}`}
                className="w-[360px] max-w-[92vw] h-[640px] max-h-[82vh] rounded-xl bg-white shadow-2xl border-0"
                allow="autoplay; encrypted-media" scrolling="no" />
            ) : (player.ad.creative?.imageUrl || player.ad.creative?.thumbnailUrl) ? (
              <img src={player.ad.creative.imageUrl || player.ad.creative.thumbnailUrl} alt="" className="max-h-[82vh] max-w-[92vw] rounded-xl shadow-2xl" />
            ) : (
              <div className="w-[320px] p-6 rounded-xl bg-gray-900 text-sm text-gray-300">Meta no devolvió el creativo de este ad.</div>
            )}
            <div className="mt-2 text-center text-xs text-white/70 max-w-[92vw] truncate">{player.ad.name}</div>
          </div>
        </div>
      )}

      {/* Análisis IA del winner guardado */}
      {analisisModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={() => setAnalisisModal(null)}>
          <div className="w-full max-w-xl my-8 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
              <Trophy size={15} className="text-amber-500" />
              <h3 className="flex-1 text-sm font-bold text-gray-900 dark:text-gray-100 truncate">Por qué funciona · {analisisModal.owner_username || 'winner'}</h3>
              <button onClick={() => setAnalisisModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto text-sm text-gray-700 dark:text-gray-200">
              {analisisModal.analisis ? (
                <>
                  {analisisModal.analisis.angle && <p><span className="font-bold">Ángulo:</span> {analisisModal.analisis.angle}</p>}
                  {(analisisModal.analisis.hooks || []).length > 0 && (
                    <div><span className="font-bold">Hooks:</span>
                      <ul className="mt-1 space-y-1">{analisisModal.analisis.hooks.map((h, n) => <li key={n} className="flex gap-2"><span className="text-amber-500 font-bold shrink-0">🪝</span>{h}</li>)}</ul>
                    </div>
                  )}
                  {analisisModal.analisis.estructura && <p><span className="font-bold">Estructura:</span> {analisisModal.analisis.estructura}</p>}
                  {(analisisModal.analisis.triggers || []).length > 0 && <p><span className="font-bold">Triggers:</span> {analisisModal.analisis.triggers.join(' · ')}</p>}
                  {analisisModal.analisis.visual && <p><span className="font-bold">Visual:</span> {analisisModal.analisis.visual}</p>}
                  {analisisModal.analisis.why_it_works && <p><span className="font-bold">Por qué funciona:</span> {analisisModal.analisis.why_it_works}</p>}
                </>
              ) : <p className="text-gray-400">Sin análisis todavía.</p>}
              <p className="text-[11px] text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-3">
                Quedó guardado en <b>Marketing → Referencias</b>: desde ahí generás el guion adaptado y lo mandás a una tarjeta de Producción para el editor.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================================================================
// Pestaña: PROSPECTADORES
// ========================================================================
function VistaProspectadores({ ads, cfg, currency, accountId, connId, preset = 'last_7d', onWhy, cambios, trabajando, onEstado, ventanaLabel = 'últimos 7 días' }) {
  const [abierto, setAbierto] = useState(null);

  // Gasto promedio por anuncio de la ventana (solo ads con gasto): contra esto
  // se mide el "gasto representativo" — frecuencia baja con dos mangos no es
  // prospección, es falta de data.
  const gastoPromedio = useMemo(() => {
    const conGasto = ads.filter(a => Number(a.insights?.spend || 0) > 0);
    if (conGasto.length === 0) return 0;
    return conGasto.reduce((s, a) => s + Number(a.insights.spend || 0), 0) / conGasto.length;
  }, [ads]);

  // PRE-candidatos: pasan todos los cortes de la ventana (gasto representativo,
  // frecuencia, ROAS, compras, alcance). El resto NI SE MUESTRA (pedido del
  // user): esta pestaña es "quién está prospectando", no la lista completa.
  const preCandidatos = useMemo(() => ads
    .map(a => ({ ...a, ...esProspectador(a.insights, cfg, { gastoPromedio }) }))
    .filter(a => a.es)
    .sort((a, b) => (b.insights.spend - a.insights.spend)), [ads, cfg, gastoPromedio]);
  const descartados = ads.length - preCandidatos.length;

  // VERIFICACIÓN INTRADIARIA: la frecuencia de la ventana puede dar baja "de
  // promedio" aunque algún día se haya ido arriba. Pedimos el desglose diario
  // de los pre-candidatos y exigimos que el PEOR día siga bajo el límite.
  const [diario, setDiario] = useState(null); // null = cargando | {adId: {freqMax, dias}}
  useEffect(() => {
    const ids = preCandidatos.map(a => a.id).filter(Boolean);
    if (!accountId || ids.length === 0) { setDiario({}); return; }
    let vivo = true;
    setDiario(null);
    (async () => {
      try {
        let u = `/api/meta/prosp-daily?account_id=${encodeURIComponent(accountId)}&ids=${ids.slice(0, 50).join(',')}&date_preset=${encodeURIComponent(preset)}`;
        if (connId && connId !== '__cookie__') u += `&connection_id=${encodeURIComponent(connId)}`;
        const r = await fetch(u, { headers: await authHeaders(false) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
        if (vivo) setDiario(d.porAd || {});
      } catch {
        // Si el desglose falla (rate limit), mostramos los pre-candidatos con
        // la marca "sin verificar" en vez de esconder todo.
        if (vivo) setDiario({});
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, connId, preset, preCandidatos.map(a => a.id).join(',')]);

  const lista = useMemo(() => preCandidatos.map(a => {
    const d = diario?.[a.id];
    const freqMax = d?.freqMax || 0;
    const verificado = diario !== null && d != null && d.dias > 0;
    // Confirmado: el peor día se mantuvo bajo el límite intradiario.
    const okDiario = !verificado || freqMax <= (cfg.maxFrecuenciaProsp || 1.10);
    return { ...a, freqMax, verificado, okDiario };
  }).filter(a => a.okDiario), [preCandidatos, diario, cfg]);
  const caidosPorDia = preCandidatos.length - lista.length;
  const si = lista;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
        <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Prospectadores</h3>
        <Why k="prospectador" cfg={cfg} currency={currency} onOpen={onWhy} datos={{}} />
        <span className="text-[10.5px] text-gray-400 flex items-center gap-1">
          {ventanaLabel} · solo candidatos reales {diario === null && preCandidatos.length > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-500"><Loader2 size={10} className="animate-spin" /> verificando frecuencia diaria…</span>
          )}
        </span>
        {si.length > 0 && (
          <span className="ml-auto"><MetaLink nivel="ads" ids={si.map(a => a.id)} accountId={accountId} solid>Abrir {si.length} en Meta</MetaLink></span>
        )}
      </div>
      {si.length === 0 && (
        <div className="mx-3.5 my-3 p-3 rounded-xl text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
          Ningún anuncio califica como prospectador en esta ventana: nada combina gasto representativo, ventas, ROAS sobre tu mínimo y frecuencia baja sostenida. La cuenta está viviendo de públicos ya trabajados — te conviene probar creativos nuevos.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-400 text-[9.5px] uppercase tracking-wider">
              <th className="text-left font-bold px-3.5 py-2">Anuncio</th>
              <th className="text-left font-bold px-2 py-2" title={TIP_ENTREGA}>Entrega</th>
              <th className="text-right font-bold px-2 py-2" title="Cuántas veces vio el anuncio cada persona en toda la ventana. Cerca de 1 = casi todos son gente nueva.">Frecuencia</th>
              <th className="text-right font-bold px-2 py-2" title="El PEOR día de la ventana: la frecuencia tiene que mantenerse baja también día a día, no solo de promedio.">Frec. diaria máx</th>
              <th className="text-right font-bold px-2 py-2" title="Cuántas personas distintas lo vieron.">Alcance</th>
              <th className="text-right font-bold px-2 py-2">Compras</th>
              <th className="text-right font-bold px-2 py-2" title={`${TIP_ROAS} (lo que Meta llama «ROAS de compras»)`}>ROAS de compras</th>
              <th className="text-right font-bold px-2 py-2" title={`Importe gastado en la ventana elegida (${ventanaLabel})`}>Importe gastado</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {lista.slice(0, 60).map(a => {
              const i = a.insights, open = abierto === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr onClick={() => setAbierto(open ? null : a.id)}
                    className={`cursor-pointer transition ${open ? 'bg-gray-50 dark:bg-gray-900/40' : 'hover:bg-gray-50 dark:hover:bg-gray-900/30'} ${
                      estadoVisible(a, cambios) === 'PAUSED' ? 'opacity-55' : ''}`}>
                    <td className="px-3.5 py-2 max-w-[280px]">
                      <div className="flex items-center gap-2">
                        <SwitchEstado
                          estado={estadoVisible(a, cambios)}
                          trabajando={!!trabajando?.[a.id]}
                          onCambiar={(status) => onEstado?.({ items: [a], status })}
                        />
                        {open ? <ChevronDown size={13} className="text-brand-500 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                        <span className="min-w-0">
                          <span className="block font-semibold text-gray-900 dark:text-gray-100 truncate">{a.name}</span>
                          <span className="block text-[10px] text-gray-400 truncate">{a.campaignName}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2"><Entrega item={a} cambios={cambios} /></td>
                    <td className={`px-2 py-2 text-right tabular-nums font-semibold ${i.frequency > 0 && i.frequency <= cfg.maxFrecuenciaProsp ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{fmtR(i.frequency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {a.verificado
                        ? <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtR(a.freqMax)}</span>
                        : <span className="text-gray-400" title="No se pudo verificar el desglose diario (Meta no respondió) — el dato de la ventana igual pasa el corte.">—</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtN(i.reach)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{i.purchases}</td>
                    <td className={`px-2 py-2 text-right tabular-nums font-semibold ${i.roas >= cfg.minRoasProsp ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`}>{fmtR(i.roas)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtM(i.spend, currency)}</td>
                    <td className="px-2 py-2 text-right"><MetaLink nivel="ads" ids={[a.id]} accountId={accountId}>Meta</MetaLink></td>
                  </tr>
                  {open && (
                    <tr><td colSpan={9} className="bg-gray-50/60 dark:bg-gray-900/40 px-3.5 py-3">
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
                        {a.verificado && (
                          <div className="flex items-start gap-2 text-[11.5px]">
                            <span className="w-[15px] h-[15px] rounded-full grid place-items-center text-[9px] font-bold shrink-0 mt-px bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400">✓</span>
                            <span className="text-gray-600 dark:text-gray-300">frecuencia diaria máxima {fmtR(a.freqMax)} ≤ {cfg.maxFrecuenciaProsp} (se mantuvo baja todos los días)</span>
                          </div>
                        )}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {(descartados > 0 || caidosPorDia > 0) && (
        <p className="px-3.5 py-2 text-[10.5px] text-gray-400 border-t border-gray-100 dark:border-gray-700/60">
          {descartados > 0 && `${descartados} anuncio${descartados === 1 ? '' : 's'} de la ventana no califica${descartados === 1 ? '' : 'n'} y no se muestra${descartados === 1 ? '' : 'n'} (poco gasto, pocas ventas, ROAS bajo o frecuencia alta).`}
          {caidosPorDia > 0 && ` ${caidosPorDia} más quedó${caidosPorDia === 1 ? '' : 'aron'} afuera por frecuencia diaria alta (de promedio daba, pero algún día se fue arriba).`}
        </p>
      )}
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
          {productos.length === 0 && <p className="text-[11px] text-gray-400">No hay productos cargados en Kombialo todavía.</p>}
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
          <Campo label="Respetar testeos" help="Campañas más nuevas que los días de abajo no se marcan para pausar: se avisan como testeo.">
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200 py-1.5">
              <input type="checkbox" checked={cfg.respetarTesteos ?? true}
                onChange={e => setCfg(c => ({ ...c, respetarTesteos: e.target.checked }))} />
              Dejar correr los testeos nuevos
            </label>
          </Campo>
          <Campo label="Días mínimos para pausar" help="Edad de la campaña desde la que ya se puede marcar para pausar."><input className={inputCls} type="number" min="0" value={cfg.diasMinPausar ?? 2} onChange={set('diasMinPausar')} disabled={!(cfg.respetarTesteos ?? true)} /></Campo>
          <Campo label="Frecuencia máxima (prospectador)"><input className={inputCls} type="number" step="0.05" value={cfg.maxFrecuenciaProsp} onChange={set('maxFrecuenciaProsp')} /></Campo>
          <Campo label="ROAS mínimo (prospectador)"><input className={inputCls} type="number" step="0.1" value={cfg.minRoasProsp} onChange={set('minRoasProsp')} /></Campo>
          <Campo label="Alcance mínimo (prospectador)"><input className={inputCls} type="number" value={cfg.minAlcanceProsp} onChange={set('minAlcanceProsp')} /></Campo>
          <Campo label="Gasto mínimo (prospectador)" help="El anuncio tiene que gastar al menos este % del gasto promedio por anuncio de la ventana. Frecuencia baja con muy poco gasto no es prospección, es falta de data. 0 = apagado.">
            <div className="flex items-center gap-1.5">
              <input className={inputCls} type="number" min="0" max="100" step="5" value={cfg.pctGastoProsp ?? 60} onChange={set('pctGastoProsp')} />
              <span className="text-[11px] text-gray-400 shrink-0">% del promedio</span>
            </div>
          </Campo>
        </div>
      </div>
    </div>
  );
}

// ========================================================================
// Sección
// ========================================================================
export default function MetricasSection({ addToast }) {
  const { connections, loading: connLoading } = useMetaConnections();
  const { accounts, loading: acctLoading } = useMetaAdAccounts(connections);
  const [productos] = useState(() => readProductos());

  const [accountId, setAccountId] = useState(() => { try { return localStorage.getItem(LS_ACCOUNT) || ''; } catch { return ''; } });
  const [preset, setPreset] = useState(() => {
    try {
      const v = localStorage.getItem(LS_PRESET);
      // El default pasó de 90 a 30 días. Como el valor se persiste en cada
      // render, todo el que ya abrió el tablero tiene 'last_90d' guardado y no
      // hay forma de distinguir "lo elegí" de "me lo dejó el default viejo".
      // Se corrige una sola vez, marcando que ya se hizo: si después elegís 90
      // a propósito, se respeta.
      if (v === 'last_90d' && !localStorage.getItem(LS_PRESET_MIGRADO)) {
        localStorage.setItem(LS_PRESET_MIGRADO, '1');
        return 'last_30d';
      }
      localStorage.setItem(LS_PRESET_MIGRADO, '1');
      return PRESETS_COHORTES.some(p => p.value === v) ? v : 'last_30d';
    } catch { return 'last_30d'; }
  });
  // El embudo arranca en HOY: es la pregunta que uno se hace varias veces al
  // día ("¿cómo viene el día?"), no una ventana histórica.
  const [presetEmbudo, setPresetEmbudo] = useState(() => {
    try {
      const v = localStorage.getItem(LS_PRESET_EMBUDO);
      return PRESETS_EMBUDO.some(p => p.value === v) ? v : 'today';
    } catch { return 'today'; }
  });
  // Ventanas propias de Prospectadores y Winners (calendario libre por pestaña).
  const [presetProsp, setPresetProsp] = useState(() => {
    try { return localStorage.getItem(LS_PRESET_PROSP) || 'last_7d'; } catch { return 'last_7d'; }
  });
  const [presetWinners, setPresetWinners] = useState(() => {
    try { return localStorage.getItem(LS_PRESET_WINNERS) || 'last_14d'; } catch { return 'last_14d'; }
  });
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
  // El embudo es otra llamada a Meta. Se pide recién cuando se abre la
  // pestaña, y se vuelve a pedir si cambió la cuenta o el período.
  // Lo que prendimos o pausamos en esta sesión: id → 'ACTIVE' | 'PAUSED'.
  // Manda por encima de lo que dijo Meta cuando se cargó el tablero, así el
  // botón cambia de lado al instante en vez de esperar una recarga entera
  // (varios segundos) para ver el efecto de un click.
  const [cambios, setCambios] = useState({});
  const [trabajando, setTrabajando] = useState({});
  const [embudo, setEmbudo] = useState(null);
  const [embudoCargando, setEmbudoCargando] = useState(false);
  const [embudoError, setEmbudoError] = useState(null);
  // Sube de a uno con "Refrescar": sin esto el botón recargaba las campañas y
  // dejaba el embudo con los números de hace un rato.
  const [recargaEmbudo, setRecargaEmbudo] = useState(0);

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
  useEffect(() => { try { localStorage.setItem(LS_PRESET_EMBUDO, presetEmbudo); } catch {} }, [presetEmbudo]);
  useEffect(() => { try { localStorage.setItem(LS_PRESET_PROSP, presetProsp); } catch {} }, [presetProsp]);
  useEffect(() => { try { localStorage.setItem(LS_PRESET_WINNERS, presetWinners); } catch {} }, [presetWinners]);

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

  // Cambiar de cuenta tira los cambios locales: son de otro tablero.
  useEffect(() => { setCambios({}); }, [accountId]);

  // Prende o pausa en Meta. Es la única acción de Kombialo que le cambia algo a
  // la cuenta publicitaria, así que hace tres cosas que las lecturas no
  // necesitan: marca las filas como "en curso" para que no se pueda clickear
  // dos veces, aplica solo lo que Meta confirmó (si de 5 salieron 3, se
  // repintan 3) y deja el deshacer a mano en el toast.
  const aplicarRef = useRef(null);
  // Presupuesto editable (doble click, como en Meta): escribe el diario nuevo
  // en Meta y recuerda el valor aplicado para repintar la celda sin recargar.
  const [presupuestos, setPresupuestos] = useState({});
  const cambiarPresupuestoRow = useCallback(async ({ id, level, dailyBudget }) => {
    const r = await cambiarPresupuesto({ accountId, connId: account?.connId, level, id, dailyBudget });
    if (r.ok) {
      setPresupuestos(prev => ({ ...prev, [id]: r.nuevo }));
      addToast?.({ type: 'success', message: `Presupuesto de "${r.name}": ${fmtM(r.anterior, currency)} → ${fmtM(r.nuevo, currency)} por día` });
    } else {
      addToast?.({ type: 'error', message: `Presupuesto: ${r.error}` });
    }
    return r.ok;
  }, [accountId, account, addToast, currency]);

  // ⭐ Winners automáticos: el server analiza los ads de ESTA cuenta (ventana
  // 7 días) y marca las estrellas en Producción — solo productos con data en
  // Meta; los demás siguen manuales. La cuenta elegida se aprende y el cron
  // diario de las 09:00 la incluye a partir de ahí.
  const [winnersAutoBusy, setWinnersAutoBusy] = useState(false);
  const correrWinnersAuto = useCallback(async () => {
    if (!accountId || winnersAutoBusy) return;
    setWinnersAutoBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const t = session?.access_token;
      const r = await fetch('/api/produccion/auto-winners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ accountId: String(accountId).replace(/^act_/, '') }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || `Error ${r.status}`);
      if (d.skipped) {
        await alertDialog({ title: '⭐ Winners automáticos', message: `No corrió: ${d.skipped}${d.hint ? `\n${d.hint}` : ''}` });
        return;
      }
      const lineas = [];
      if (d.marcados?.length) {
        for (const m of d.marcados) {
          lineas.push(`⭐ ${m.producto}`);
          for (const n of m.nuevos) lineas.push(`   • ${n.name} — ${n.compras} compras · ROAS ${n.roas}${n.warn ? ' ⚠️ revisar (bajo el break-even)' : ''}`);
        }
      } else {
        lineas.push(`Sin winners nuevos con el criterio actual (≥${d.criterio?.minCompras ?? 6} compras y ROAS ≥${d.criterio?.minRoas ?? 2.5}, o top de su tanda con ≥${d.criterio?.topMin ?? 3}).`);
      }
      if (d.enriquecidos) lineas.push('', `🔗 ${d.enriquecidos} winners ya marcados ahora tienen su link a Drive.`);
      if (d.sinData?.length) lineas.push('', `Sin data en Meta — siguen manuales: ${d.sinData.join(', ')}`);
      lineas.push('', `${d.adsAnalizados} ads analizados · ${d.tarjetasConData} tarjetas con data. Esto también corre solo todos los días a las 09:00.`);
      await alertDialog({ title: '⭐ Winners automáticos', message: lineas.join('\n') });
      const total = (d.marcados || []).reduce((s, m) => s + m.nuevos.length, 0);
      if (total) addToast?.({ type: 'success', message: `⭐ ${total} winner${total === 1 ? '' : 's'} marcado${total === 1 ? '' : 's'} en Producción` });
    } catch (e) {
      addToast?.({ type: 'error', message: `Winners auto: ${e.message}` });
    } finally { setWinnersAutoBusy(false); }
  }, [accountId, winnersAutoBusy, addToast]);

  const aplicarEstado = useCallback(async ({ level, items, status, esDeshacer = false }) => {
    const lista = (items || []).filter(Boolean);
    if (!lista.length || !accountId) return;
    const ids = lista.map(i => i.id);

    setTrabajando(prev => { const n = { ...prev }; for (const id of ids) n[id] = true; return n; });
    const r = await cambiarEstado({ accountId, connId: account?.connId, level, ids, status });
    setTrabajando(prev => { const n = { ...prev }; for (const id of ids) delete n[id]; return n; });

    const salieron = new Set(r.resultados.filter(x => x.ok).map(x => x.id));
    setCambios(prev => {
      const n = { ...prev };
      for (const id of salieron) n[id] = status;
      return n;
    });

    // El deshacer se ofrece solo sobre lo que efectivamente cambió, y no se
    // ofrece sobre un deshacer (si no, es un interruptor infinito en un toast).
    const revertibles = lista.filter(i => salieron.has(i.id));
    addToast?.({
      type: r.resumen.tono,
      message: r.resumen.mensaje,
      duration: r.ok ? 7000 : 10000,
      accion: !esDeshacer && revertibles.length ? {
        label: 'Deshacer',
        onClick: () => aplicarRef.current?.({ level, items: revertibles, status: inverso(status), esDeshacer: true }),
      } : null,
    });
  }, [accountId, account, addToast]);
  useEffect(() => { aplicarRef.current = aplicarEstado; }, [aplicarEstado]);

  // Cache-first: si hay un payload guardado de esta (cuenta, ventana) se
  // muestra AL INSTANTE y el fetch fresco corre en segundo plano (el chip
  // "Actualizando…" avisa). La precarga del login (App.jsx) suele dejar esto
  // ya calentito, así que entrar a la sección no muestra spinner casi nunca.
  const [actualizando, setActualizando] = useState(false);
  const load = useCallback(async (acct, datePreset, prospP) => {
    if (!acct) return;
    const path = pathTestingInsights(acct.id, datePreset, prospP);
    const cacheado = leerCacheMeta(path);
    if (cacheado) {
      setData(cacheado.data); setLoading(false); setActualizando(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const d = await fetchMeta(path, { connId: acct.connId });
      setData(d);
    } catch (e) {
      // Con cache a la vista, un refresh fallido no tira abajo el tablero.
      if (!cacheado) { setError(e.message); setData(null); }
    } finally { setLoading(false); setActualizando(false); }
  }, []);

  useEffect(() => { if (account) load(account, preset, presetProsp); }, [account, preset, presetProsp, load]);
  // La precarga del próximo login necesita saber con qué conexión pedir.
  useEffect(() => { if (account) recordarConnId(account.connId); }, [account]);

  // Embudo, perezoso: solo si estás parado en su pestaña.
  useEffect(() => {
    if (tab !== 'embudo' || !account) return;
    let vivo = true;
    setEmbudoCargando(true); setEmbudoError(null);
    (async () => {
      try {
        let url = `/api/meta/funnel-insights?account_id=${encodeURIComponent(account.id)}&date_preset=${encodeURIComponent(presetEmbudo)}`;
        if (account.connId && account.connId !== '__cookie__') url += `&connection_id=${encodeURIComponent(account.connId)}`;
        const r = await fetch(url, { headers: await authHeaders(false) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
        if (vivo) setEmbudo(d);
      } catch (e) {
        if (vivo) { setEmbudoError(e.message); setEmbudo(null); }
      } finally {
        if (vivo) setEmbudoCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [tab, account, presetEmbudo, recargaEmbudo]);

  // Filtro por producto sobre los anuncios (las campañas las filtra el core).
  // Solo los productos que REALMENTE tienen campañas en esta cuenta. Mostrar
  // todos los de Kombialo llenaba la barra de chips que no filtran nada (y que
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
  // Prospectadores usa SU ventana (data.adsProsp); si el server todavía no la
  // manda (deploy viejo en caché), cae a los 7 días de siempre.
  const ads7d = useMemo(() => (data?.adsProsp || data?.ads7d || [])
    .filter(a => !productoId || productoDeCampana(a.campaignName, productos, cfgRaw)?.id === productoId), [data, productoId, productos, cfgRaw]);
  // Promedio de la CUENTA ENTERA en los últimos 7 días (sin filtro de
  // producto): es la referencia de "caro" para el segundo filtro de la ronda
  // — caro comparado con el resto de la cuenta, no con el día en curso.
  const promedios7d = useMemo(() => promediosDelDia(data?.ads7d || []), [data]);
  // Acumulado de los últimos 7 días POR ITEM (anuncio y campaña): es la
  // ventana de estabilidad para marcar "subir presupuesto" — el ROAS de hoy
  // tiene que venir sostenido, no ser un pico de una mañana.
  const historico7d = useMemo(() => {
    const m = new Map();
    const porCampana = new Map();
    for (const a of (data?.ads7d || [])) {
      const ins = a.insights || {};
      m.set(a.id, ins);
      const k = a.campaignId;
      if (!k) continue;
      const acc = porCampana.get(k) || { spend: 0, revenue: 0 };
      acc.spend += Number(ins.spend || 0);
      acc.revenue += Number(ins.revenue || 0);
      porCampana.set(k, acc);
    }
    for (const [k, acc] of porCampana) {
      m.set(k, { ...acc, roas: acc.spend > 0 ? acc.revenue / acc.spend : 0 });
    }
    return m;
  }, [data]);

  // El embudo también respeta el filtro por producto — ese es medio el punto
  // de haber unificado las dos secciones. Como los totales que manda el
  // endpoint son de la cuenta entera, al filtrar hay que volver a sumar; se
  // usa deriveFunnelRates, la MISMA función del backend, así el número de la
  // pestaña no puede divergir del que calcula el servidor.
  const campanasEmbudo = useMemo(() => {
    const vacio = { totals: null, campaigns: [], total: 0 };
    if (!embudo) return vacio;
    if (!productoId) return { totals: embudo.totals || null, campaigns: embudo.campaigns || [], total: embudo.total || 0 };
    const campaigns = (embudo.campaigns || [])
      .filter(c => productoDeCampana(c.name, productos, cfgRaw)?.id === productoId);
    if (campaigns.length === 0) return vacio;
    const base = {
      spend: 0, impressions: 0, linkClicks: 0, landingPageViews: 0,
      addToCart: 0, initiateCheckout: 0, purchases: 0, revenue: 0,
    };
    for (const c of campaigns) {
      for (const k of Object.keys(base)) base[k] += Number(c.funnel?.[k] || 0);
    }
    return { totals: { ...base, ...deriveFunnelRates(base) }, campaigns, total: campaigns.length };
  }, [embudo, productoId, productos, cfgRaw]);

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
        <Gauge size={19} />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Métricas</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Qué pausar hoy, dónde se cae la gente, cómo rindió cada tanda de testeos y quién sigue trayendo gente nueva.
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

  // Qué ventana de tiempo corresponde a la pestaña abierta. Las que no eligen
  // nada lo dicen en vez de mostrar un desplegable que no hace nada.
  const ventana = tab === 'hoy'
    ? { fija: true, label: 'Hoy', motivo: '"Hoy" optimiza el día en curso: sus recomendaciones de pausar/subir son de hoy, por eso el calendario no aplica acá.' }
    : tab === 'prosp'
      ? { fija: false, valor: presetProsp, set: setPresetProsp, opciones: PRESETS_PROSP }
      : tab === 'winners'
        ? { fija: false, valor: presetWinners, set: setPresetWinners, opciones: PRESETS_WINNERS }
        : tab === 'embudo'
          ? { fija: false, valor: presetEmbudo, set: setPresetEmbudo, opciones: PRESETS_EMBUDO }
          : { fija: false, valor: preset, set: setPreset, opciones: PRESETS_COHORTES };

  const TABS = [
    { id: 'hoy', label: 'Hoy — optimizar', icon: Gauge, desc: 'Qué anuncios conviene apagar o potenciar hoy.' },
    { id: 'manager', label: 'Campañas y anuncios', icon: Table2, desc: 'La misma tabla de Meta: prendé, apagá y cambiá presupuestos.' },
    { id: 'embudo', label: 'Embudo de compra', icon: Filter, desc: 'En qué paso se te va la gente antes de comprar.' },
    { id: 'semanas', label: 'Testeos por semana', icon: FlaskConical, desc: 'Cuántas de las campañas nuevas de cada semana salieron ganadoras.' },
    { id: 'prosp', label: 'Prospectadores', icon: Radar, desc: 'Anuncios que le venden a gente que nunca te había visto.' },
    { id: 'winners', label: 'Winners', icon: Trophy, desc: 'Tus anuncios ganadores, con el video y por qué funcionan.' },
    // "Publicar campaña" salió de acá (solo en dev): es el PUBLICADOR, entrada
    // propia del menú (Área creativa), que junta videos de tarjetas y estáticos.
    { id: 'reglas', label: 'Reglas de la tienda', icon: SlidersHorizontal, desc: 'Tus números de corte: desde cuánto algo es ganador o hay que apagarlo.' },
    // Meta Ads salió del menú lateral (pedido del user): el tracker de cuentas
    // y conexiones vive acá como pestaña.
    { id: 'cuentas', label: 'Cuentas de Meta', icon: Plug, desc: 'Conectá y administrá tus cuentas publicitarias (tokens y conexiones).' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {header}

      {/* La barra de cuenta/calendario no aplica en "Cuentas de Meta": el
          tracker tiene sus propios selectores. */}
      {tab !== 'cuentas' && (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[210px]">
          <select value={accountId} onChange={e => setAccountId(e.target.value)}
            className="w-full pl-3 pr-8 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">{acctLoading ? 'Cargando cuentas…' : '— Elegí una cuenta —'}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.accountId}{a.currency ? ` (${a.currency})` : ''}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        {ventana.fija ? (
          /* Calendario DESHABILITADO en las pestañas donde no aplica (pedido
             del user): nada de saltos de pestaña — el tooltip explica por qué. */
          <span
            title={ventana.motivo || 'Esta pestaña mira siempre esta ventana.'}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed select-none">
            <CalendarDays size={12} className="opacity-50" /> {ventana.label}
            <span className="font-normal opacity-70">
              · {new Date().toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </span>
        ) : (
          <MenuFecha value={ventana.valor} onChange={ventana.set} opciones={ventana.opciones} />
        )}
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
        <button onClick={correrWinnersAuto} disabled={!accountId || winnersAutoBusy}
          title="Analiza los ads de esta cuenta (ventana de 7 días) y marca ⭐ automáticamente en Producción los videos ganadores — solo productos con data en Meta; el resto sigue manual."
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition disabled:opacity-50">
          {winnersAutoBusy ? <Loader2 size={12} className="animate-spin" /> : <Trophy size={12} />} Marcar ganadores en Producción
        </button>
        <button onClick={() => { if (!account) return; load(account, preset, presetProsp); setRecargaEmbudo(n => n + 1); }} disabled={!account || loading}
          title="Volver a pedirle los datos a Meta ahora mismo"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refrescar
        </button>
      </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} title={t.desc}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition ${
                tab === t.id ? 'text-gray-900 dark:text-gray-100 border-brand-500' : 'text-gray-500 border-transparent hover:text-gray-700 dark:hover:text-gray-200'}`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
        {actualizando && (
          <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-2 text-[10.5px] text-gray-400 whitespace-nowrap" title="Mostrando lo último guardado mientras se refresca contra Meta.">
            <Loader2 size={11} className="animate-spin" /> Actualizando…
          </span>
        )}
      </div>

      {tab === 'cuentas' ? (
        /* Tracker de cuentas (ex "Meta Ads" del menú): anda sin cuenta elegida
           arriba, así que va antes de los gates de error/carga/data. */
        <CampanasTracker addToast={addToast} />
      ) : error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
          <AlertCircle size={17} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">No pude traer los datos</p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-0.5 break-words">{error}</p>
            <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1.5">Tocá <b>Refrescar</b> arriba a la derecha. Si sigue fallando, reconectá tu cuenta de Meta (puede haber vencido el permiso).</p>
          </div>
        </div>
      ) : loading && !data ? (
        <CargandoMetricas />
      ) : !data ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Elegí tu cuenta publicitaria en el menú de arriba ↑</p>
        </div>
      ) : (
        <>
          {tab === 'hoy' && <VistaHoy
            ads={itemsHoy} cfg={cfg} cfgRaw={cfgRaw} setCfg={setCfgRaw}
            productos={productos} productosVisibles={productosEnCuenta} productoId={productoId}
            currency={currency} accountId={accountId} onWhy={setWhy}
            nivel={nivelHoy} setNivel={setNivelHoy}
            cambios={cambios} trabajando={trabajando}
            onEstado={({ items, status }) => aplicarEstado({ level: nivelHoy === 'campaigns' ? 'campaign' : 'ad', items, status })}
            onRecalcular={() => account && load(account, preset, presetProsp)}
            promediosRef={promedios7d} historico={historico7d}
            presupuestos={presupuestos} onPresupuesto={cambiarPresupuestoRow}
            connId={account?.connId}
          />}
          {tab === 'embudo' && (
            embudoError ? (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
                <AlertCircle size={17} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-900 dark:text-red-200">No pude cargar el embudo</p>
                  <p className="text-xs text-red-700 dark:text-red-300 mt-0.5 break-words">{embudoError}</p>
                </div>
              </div>
            ) : embudoCargando && !embudo ? (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 flex items-center gap-3">
                <Loader2 size={17} className="animate-spin text-gray-400" />
                <span className="text-sm text-gray-500 dark:text-gray-400">Armando el embudo…</span>
              </div>
            ) : (
              <VistaEmbudo totals={campanasEmbudo.totals} campaigns={campanasEmbudo.campaigns} total={campanasEmbudo.total} currency={currency} />
            )
          )}
          {tab === 'semanas' && <VistaSemanas campaigns={data.campaigns} cfg={cfgRaw} productos={productos} productoId={productoId || null} currency={currency} accountId={accountId} connId={account?.connId} preset={preset} onWhy={setWhy} fotos={fotos} />}
          {tab === 'prosp' && <VistaProspectadores
            ads={ads7d} cfg={cfg} currency={currency} accountId={accountId} connId={account?.connId}
            preset={presetProsp} onWhy={setWhy}
            cambios={cambios} trabajando={trabajando}
            ventanaLabel={etiquetaVentana(presetProsp, PRESETS_PROSP)}
            onEstado={({ items, status }) => aplicarEstado({ level: 'ad', items, status })}
          />}
          {tab === 'winners' && <VistaWinners
            account={account} accountId={accountId} cfg={cfg} cfgRaw={cfgRaw}
            productos={productos} productoId={productoId || null} currency={currency} addToast={addToast}
            preset={presetWinners}
          />}
          {tab === 'manager' && <VistaManager accountId={accountId} connId={account?.connId} currency={currency} preset={preset}
            presupuestos={presupuestos} onPresupuesto={cambiarPresupuestoRow} />}
          {tab === 'reglas' && <VistaReglas campaigns={data.campaigns} cfg={cfgRaw} setCfg={setCfgRaw} productos={productos} currency={currency} onWhy={setWhy} origen={origenCfg} />}
        </>
      )}

      <FormulaModal open={why} onClose={() => setWhy(null)} />
    </div>
  );
}
