// HOME del ecosistema (AdsLab OS) — la primera pantalla al entrar.
//
// Tres bloques, en este orden:
//   1. PRIMEROS PASOS — checklist de onboarding que se tacha sola (conectar
//      Meta, crear el primer producto, Drive, avisos, equipo). Desaparece
//      cuando está todo hecho.
//   2. DASHBOARD DE HOY — el pulso general (inversión, compras, ROAS, mal
//      invertido) + desglose POR PRODUCTO en cards clickeables. Responde
//      "¿cómo venimos hoy?" y "¿qué producto tira el número?" en un scroll.
//   3. INTEGRACIONES — todos los conectores en un lugar: Meta, Google Drive,
//      Discord, y espacio para los que vengan.
//
// La data de Meta sale de /api/meta/manager-table (level=campaign, hoy) por
// cada cuenta usada por los productos; las campañas se matchean a producto
// por nombre (la misma heurística del resto de la app).

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Rocket, CheckCircle2, Circle, Plug, RefreshCw, ArrowRight, Gauge,
  Package, Film, HardDrive, Bell, Users, TrendingUp, AlertTriangle, Loader2,
} from 'lucide-react';
import { supabase } from './supabase.js';
import { MetaConnectButton } from './MetaConnect.jsx';
import { entregasNuevas } from './produccionStore.js';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';

function readProductos() {
  try { return JSON.parse(localStorage.getItem(PRODUCTOS_KEY) || '[]'); } catch { return []; }
}
async function authHeaders() {
  const base = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const t = session?.access_token;
    return t ? { ...base, Authorization: `Bearer ${t}` } : base;
  } catch { return base; }
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const fmtAr = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-AR')}`;

// ── Dashboard de HOY (general + por producto) ────────────────────────────────
function useHoy(productos) {
  const [estado, setEstado] = useState({ cargando: false, error: null, totals: null, porProducto: [], sinMatch: 0 });

  const cuentas = useMemo(() => {
    const m = new Map();
    for (const p of productos) {
      const acc = p.metaAccount;
      if (acc?.id && !m.has(acc.id)) m.set(acc.id, { id: acc.id, connId: acc.connId || null });
    }
    return [...m.values()];
  }, [productos]);

  const cargar = useCallback(async () => {
    if (!cuentas.length) { setEstado(s => ({ ...s, totals: null, porProducto: [] })); return; }
    setEstado(s => ({ ...s, cargando: true, error: null }));
    try {
      const headers = await authHeaders();
      const porCuenta = await Promise.all(cuentas.map(async (c) => {
        const qs = new URLSearchParams({ account_id: c.id, level: 'campaign', date_preset: 'today' });
        if (c.connId && c.connId !== '__cookie__') qs.set('connection_id', c.connId);
        const r = await fetch(`/api/meta/manager-table?${qs}`, { headers });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
        return d.rows || [];
      }));
      const rows = porCuenta.flat();
      // Matcheo campaña → producto por nombre (inclusión normalizada).
      const prods = productos
        .filter(p => (p.nombre || p.name || '').trim())
        .map(p => ({
          id: p.id,
          nombre: p.nombre || p.name,
          n: norm(p.nombre || p.name),
          breakEven: Number(p.breakEven || p.cortes?.roasMinimo) || 1.6,
          spend: 0, compras: 0, revenue: 0, campanas: 0, malo: 0,
        }))
        .filter(p => p.n.length >= 3);
      let sinMatch = 0;
      const tot = { spend: 0, compras: 0, revenue: 0, malo: 0 };
      for (const r of rows) {
        const cn = norm(r.name);
        tot.spend += r.spend; tot.compras += r.compras; tot.revenue += r.revenue;
        const p = prods.find(x => cn.includes(x.n));
        const be = p?.breakEven || 1.6;
        const esMalo = r.spend > 0 && r.roas < be;
        if (esMalo) tot.malo += r.spend;
        if (!p) { if (r.spend > 0) sinMatch++; continue; }
        p.spend += r.spend; p.compras += r.compras; p.revenue += r.revenue;
        p.campanas++; if (esMalo) p.malo += r.spend;
      }
      tot.roas = tot.spend > 0 ? tot.revenue / tot.spend : 0;
      const porProducto = prods
        .filter(p => p.spend > 0 || p.compras > 0)
        .map(p => ({ ...p, roas: p.spend > 0 ? p.revenue / p.spend : 0 }))
        .sort((a, b) => b.spend - a.spend);
      setEstado({ cargando: false, error: null, totals: tot, porProducto, sinMatch });
    } catch (e) {
      setEstado(s => ({ ...s, cargando: false, error: e.message }));
    }
  }, [cuentas, productos]);

  useEffect(() => { cargar(); }, [cargar]);
  return { ...estado, recargar: cargar, hayCuentas: cuentas.length > 0 };
}

function KPI({ label, value, tone = 'default', sub }) {
  const tones = {
    default: 'text-gray-900 dark:text-gray-100',
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400',
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-xl font-extrabold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Integraciones ────────────────────────────────────────────────────────────
function useIntegraciones({ addToast }) {
  const [meta, setMeta] = useState({ cargando: true, conexiones: [] });
  const [drive, setDrive] = useState({ cargando: true, connected: false, working: false, email: null });
  const [discord, setDiscord] = useState({ cargando: true, configurado: false });

  const cargarMeta = useCallback(async () => {
    try {
      const r = await fetch('/api/meta/connections', { headers: await authHeaders() });
      const d = await r.json().catch(() => ({}));
      setMeta({ cargando: false, conexiones: d.connections || [] });
    } catch { setMeta({ cargando: false, conexiones: [] }); }
  }, []);
  const cargarDrive = useCallback(async () => {
    try {
      const r = await fetch('/api/produccion/google-oauth?action=status', { headers: await authHeaders() });
      const d = await r.json().catch(() => ({}));
      setDrive({ cargando: false, connected: !!d.connected, working: !!d.working, email: d.email || null });
    } catch { setDrive({ cargando: false, connected: false, working: false, email: null }); }
  }, []);
  const cargarDiscord = useCallback(async () => {
    try {
      if (!supabase) { setDiscord({ cargando: false, configurado: false }); return; }
      const { data } = await supabase.from('produccion_notif_config').select('config').maybeSingle();
      const ev = data?.config?.eventos || data?.config?.estados || {};
      const tiene = Object.values(ev).some(e => /discord(app)?\.com\/api\/webhooks/i.test(String(e?.webhook || '')));
      setDiscord({ cargando: false, configurado: tiene });
    } catch { setDiscord({ cargando: false, configurado: false }); }
  }, []);

  useEffect(() => { cargarMeta(); cargarDrive(); cargarDiscord(); }, [cargarMeta, cargarDrive, cargarDiscord]);

  // Conexión de Drive: popup con el OAuth de Google; al cerrar, re-chequeamos.
  const conectarDrive = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const t = session?.access_token;
      if (!t) { addToast?.({ type: 'error', message: 'Volvé a iniciar sesión para conectar Drive.' }); return; }
      const win = window.open(`/api/produccion/google-oauth?action=start&token=${encodeURIComponent(t)}`,
        'drive-oauth', 'width=520,height=680');
      const timer = setInterval(() => {
        if (!win || win.closed) { clearInterval(timer); cargarDrive(); }
      }, 1200);
    } catch (e) { addToast?.({ type: 'error', message: e.message }); }
  }, [addToast, cargarDrive]);

  return { meta, drive, discord, conectarDrive, recargarMeta: cargarMeta };
}

function EstadoPill({ ok, warn, textoOk, textoWarn, textoNo }) {
  const [cls, txt] = ok
    ? ['bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', textoOk]
    : warn
      ? ['bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30', textoWarn]
      : ['bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/20', textoNo];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>{txt}</span>;
}

function CardIntegracion({ icon: Icon, nombre, desc, estado, accion }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{nombre}</div>
          <div className="text-[11px] text-gray-400 truncate">{desc}</div>
        </div>
        {estado}
      </div>
      {accion}
    </div>
  );
}

// ── Primeros pasos ───────────────────────────────────────────────────────────
function Paso({ hecho, titulo, detalle, cta, onCta }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
      hecho ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900'
    }`}>
      {hecho
        ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
        : <Circle size={18} className="text-gray-300 dark:text-gray-600 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${hecho ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-gray-100'}`}>{titulo}</div>
        {!hecho && detalle && <div className="text-[11px] text-gray-400">{detalle}</div>}
      </div>
      {!hecho && cta && (
        <button onClick={onCta}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-700 transition">
          {cta} <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}

export default function HomeOS({ onNavigate, addToast }) {
  const [productos, setProductos] = useState(() => readProductos());
  useEffect(() => {
    const refresh = () => setProductos(readProductos());
    window.addEventListener('viora:marketing-pulled', refresh);
    window.addEventListener('viora:marketing-storage-changed', refresh);
    return () => {
      window.removeEventListener('viora:marketing-pulled', refresh);
      window.removeEventListener('viora:marketing-storage-changed', refresh);
    };
  }, []);

  const hoy = useHoy(productos);
  const integ = useIntegraciones({ addToast });

  // Entregas del equipo sin mirar (pulso de Producción).
  const entregas = useMemo(() => {
    try {
      const n = parseInt(localStorage.getItem('adslab-produccion-entregas-vistas-v1'), 10);
      return entregasNuevas(Number.isFinite(n) ? n : 0).reduce((s, e) => s + e.nuevos, 0);
    } catch { return 0; }
  }, []);

  const metaOk = integ.meta.conexiones.length > 0 || productos.some(p => p.metaAccount?.id);
  const pasos = [
    { hecho: metaOk, titulo: 'Conectá tu cuenta de Meta', detalle: 'Para traer campañas, métricas y winners automáticos.', cta: null },
    { hecho: productos.length > 0, titulo: 'Creá tu primer producto', detalle: 'El producto es el centro: estáticos, inspiración y métricas viven adentro.', cta: 'Crear', onCta: () => onNavigate?.('mk-arranque') },
    { hecho: productos.some(p => p.metaAccount?.id), titulo: 'Asignale cuenta y campaña base a un producto', detalle: 'Así Métricas y la Home saben qué campañas son de quién.', cta: 'Ir a Productos', onCta: () => onNavigate?.('mk-arranque') },
    { hecho: integ.drive.working, titulo: 'Conectá Google Drive', detalle: 'Los videos del equipo se suben y ordenan solos en carpetas.', cta: 'Conectar', onCta: integ.conectarDrive },
    { hecho: integ.discord.configurado, titulo: 'Configurá los avisos de Discord', detalle: 'Entregas, aprobaciones y winners avisan solos al canal.', cta: 'Configurar', onCta: () => onNavigate?.('mk-produccion') },
  ];
  const pendientes = pasos.filter(p => !p.hecho).length;
  const cargandoPasos = integ.meta.cargando || integ.drive.cargando || integ.discord.cargando;

  const pctMalo = hoy.totals?.spend > 0 ? (hoy.totals.malo / hoy.totals.spend) * 100 : 0;
  const toneMalo = pctMalo > 30 ? 'bad' : pctMalo > 15 ? 'warn' : 'good';
  const roasTone = (roas, be = 1.6) => (roas >= be * 1.25 ? 'text-emerald-500' : roas >= be ? 'text-amber-500' : 'text-red-500');

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl">
      {/* ── 1. Primeros pasos ─────────────────────────────────────────── */}
      {!cargandoPasos && pendientes > 0 && (
        <section className="rounded-2xl border border-violet-300/40 dark:border-violet-700/40 bg-violet-500/5 p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Rocket size={16} className="text-violet-500" />
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Primeros pasos</h3>
            <span className="text-[11px] font-bold text-violet-600 dark:text-violet-400">{pasos.length - pendientes}/{pasos.length}</span>
          </div>
          <div className="grid gap-2">
            {pasos.map((p, i) => <Paso key={i} {...p} />)}
          </div>
        </section>
      )}

      {/* ── 2. Hoy — el pulso ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Gauge size={16} className="text-violet-500" />
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Hoy en tus cuentas</h3>
          {hoy.hayCuentas && (
            <button onClick={hoy.recargar} disabled={hoy.cargando} title="Actualizar"
              className="p-1 rounded text-gray-400 hover:text-violet-500 disabled:opacity-50">
              {hoy.cargando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
          )}
          <button onClick={() => onNavigate?.('mk-metricas')}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-violet-600 dark:text-violet-400 hover:underline">
            Ver Métricas <ArrowRight size={12} />
          </button>
        </div>

        {!hoy.hayCuentas ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-400">
            Conectá Meta y asignale una cuenta a tus productos para ver acá el pulso del día.
          </div>
        ) : hoy.error ? (
          <div className="rounded-xl border border-red-300/40 bg-red-500/5 p-4 text-sm text-red-500 flex items-center gap-2">
            <AlertTriangle size={15} /> {hoy.error}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <KPI label="Inversión hoy" value={hoy.totals ? fmtAr(hoy.totals.spend) : '—'} />
              <KPI label="Compras" value={hoy.totals ? hoy.totals.compras : '—'} />
              <KPI label="ROAS" value={hoy.totals ? hoy.totals.roas.toFixed(2) : '—'}
                tone={hoy.totals ? (hoy.totals.roas >= 2 ? 'good' : hoy.totals.roas >= 1.6 ? 'warn' : 'bad') : 'default'} />
              <KPI label="Mal invertido" value={hoy.totals ? `${Math.round(pctMalo)}%` : '—'} tone={toneMalo}
                sub={hoy.totals?.malo > 0 ? `${fmtAr(hoy.totals.malo)} bajo el break-even` : 'todo sobre el break-even'} />
            </div>

            {/* Por producto */}
            {hoy.porProducto.length > 0 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {hoy.porProducto.map(p => (
                  <button key={p.id} onClick={() => onNavigate?.('mk-arranque')}
                    className="text-left rounded-xl border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 p-4 hover:border-violet-400 dark:hover:border-violet-600 transition group">
                    <div className="flex items-center gap-2 mb-2">
                      <Package size={14} className="text-violet-500 shrink-0" />
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate flex-1">{p.nombre}</span>
                      <span className={`text-sm font-extrabold tabular-nums ${roasTone(p.roas, p.breakEven)}`}>{p.roas.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-gray-400 tabular-nums">
                      <span>{fmtAr(p.spend)} invertidos</span>
                      <span>{p.compras} compra{p.compras !== 1 ? 's' : ''}</span>
                      <span>{p.campanas} camp.</span>
                    </div>
                    {p.malo > 0 && (
                      <div className="mt-1.5 text-[10px] font-bold text-amber-500">⚠ {fmtAr(p.malo)} bajo el break-even</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {hoy.sinMatch > 0 && (
              <p className="mt-2 text-[11px] text-gray-400">
                {hoy.sinMatch} campaña{hoy.sinMatch !== 1 ? 's' : ''} con gasto no matchea{hoy.sinMatch === 1 ? '' : 'n'} con ningún producto (el nombre de la campaña tiene que incluir el del producto).
              </p>
            )}
          </>
        )}

        {/* Pulso del equipo */}
        {entregas > 0 && (
          <button onClick={() => onNavigate?.('mk-produccion')}
            className="mt-3 w-full flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition">
            <Film size={14} /> <b>{entregas}</b> entrega{entregas !== 1 ? 's' : ''} nueva{entregas !== 1 ? 's' : ''} del equipo sin revisar
            <ArrowRight size={13} className="ml-auto" />
          </button>
        )}
      </section>

      {/* ── 3. Integraciones ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Plug size={16} className="text-violet-500" />
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Integraciones</h3>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <CardIntegracion
            icon={TrendingUp} nombre="Meta Ads"
            desc={integ.meta.conexiones.length ? integ.meta.conexiones.map(c => c.label || c.meta_user_name).filter(Boolean).join(' · ') || 'Conectado' : 'Campañas, métricas y winners automáticos'}
            estado={<EstadoPill ok={integ.meta.conexiones.length > 0} textoOk={`${integ.meta.conexiones.length} conexión${integ.meta.conexiones.length !== 1 ? 'es' : ''}`} textoNo="Sin conectar" />}
            accion={<MetaConnectButton addToast={addToast} />}
          />
          <CardIntegracion
            icon={HardDrive} nombre="Google Drive"
            desc={integ.drive.email || 'Los videos del equipo, ordenados en carpetas solos'}
            estado={<EstadoPill ok={integ.drive.working} warn={integ.drive.connected && !integ.drive.working}
              textoOk="Funcionando" textoWarn="Permiso vencido" textoNo="Sin conectar" />}
            accion={
              <button onClick={integ.conectarDrive}
                className="w-full px-3 py-1.5 rounded-lg text-[12px] font-bold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-violet-400 transition">
                {integ.drive.working ? 'Reconectar' : 'Conectar Drive'}
              </button>
            }
          />
          <CardIntegracion
            icon={Bell} nombre="Discord"
            desc="Avisos de entregas, aprobaciones y winners al canal"
            estado={<EstadoPill ok={integ.discord.configurado} textoOk="Configurado" textoNo="Sin configurar" />}
            accion={
              <button onClick={() => onNavigate?.('mk-produccion')}
                className="w-full px-3 py-1.5 rounded-lg text-[12px] font-bold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-violet-400 transition">
                Configurar avisos
              </button>
            }
          />
          <CardIntegracion
            icon={Users} nombre="Equipo"
            desc="Editores y cuentas por área (Producción, estáticos…)"
            estado={<EstadoPill ok={false} textoNo="Gestionar" />}
            accion={
              <button onClick={() => onNavigate?.('mk-produccion')}
                className="w-full px-3 py-1.5 rounded-lg text-[12px] font-bold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-violet-400 transition">
                Abrir Equipo
              </button>
            }
          />
        </div>
      </section>
    </div>
  );
}
