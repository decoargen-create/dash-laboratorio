// =========================================================================
// PUBLICADOR — módulo propio (mk-publicar)
//
// La "cola de listos": todas las tarjetas de Producción en estado APROBADO,
// agrupadas por producto, con sus videos contados y el preset del producto a
// la vista. Un click publica todos los videos del producto con la campaña
// base (el modal de siempre); al salir OK, las tarjetas pasan solas a
// Publicado. Nace de sacar el publicador de adentro de cada tarjeta: acá se
// ve TODO lo publicable junto, sin navegar el tablero.
// =========================================================================
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Rocket, Film, CheckCircle2, Clock, Settings2, ChevronRight, PackageOpen, History, ExternalLink, Loader2, RefreshCw, TrendingUp, ChevronDown } from 'lucide-react';
import { leerPresetPublicar } from './PublicarCampanaModal.jsx';
import PublicarArmador from './PublicarArmador.jsx';
import PublicarCampana from './PublicarCampana.jsx';
import { authHeaders, useMetaConnections, useMetaAdAccounts } from './MetaConnect.jsx';
import {
  listAllAssignments, subscribeProduccion, updateAssignment, weekLabel,
} from './produccionStore.js';

// ── Historial de publicaciones (lo escribe el server en cada intento) ──
const CHIP_ESTADO = {
  ACTIVE:  { label: 'ACTIVA',    cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  PAUSED:  { label: 'EN PAUSA',  cls: 'text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30' },
  DELETED: { label: 'DESHECHA',  cls: 'text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/30' },
  ERROR:   { label: 'FALLÓ',     cls: 'text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/30' },
};
const linkAdsManager = (accountId, campaignId) => {
  const act = String(accountId || '').replace(/^act_/, '');
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${campaignId}`;
};

function HistorialTab({ addToast }) {
  const [filas, setFilas] = useState(null); // null = cargando
  const cargar = useCallback(async () => {
    setFilas(null);
    try {
      const r = await fetch('/api/meta/publicaciones', { headers: await authHeaders(false) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setFilas(d.publicaciones || []);
    } catch (e) {
      setFilas([]);
      addToast?.({ type: 'error', message: `Historial: ${e.message}` });
    }
  }, [addToast]);
  useEffect(() => { cargar(); }, [cargar]);

  if (filas === null) return <p className="text-sm text-gray-400 inline-flex items-center gap-2 py-8"><Loader2 size={14} className="animate-spin" /> Cargando historial…</p>;
  if (filas.length === 0) return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-gray-500 dark:text-gray-400">
      <History size={30} className="mx-auto mb-3 opacity-60" />
      <p className="font-semibold">Todavía no hay publicaciones registradas.</p>
      <p className="text-sm mt-1">Cada intento del publicador (exitoso o no) queda acá, con su resultado y el link a Meta.</p>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={cargar} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>
      {filas.map(p => {
        const chip = CHIP_ESTADO[p.estado] || CHIP_ESTADO.ERROR;
        const fecha = new Date(p.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return (
          <details key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-4 py-2.5 group">
            <summary className="flex items-center gap-3 cursor-pointer list-none">
              <span className={`shrink-0 text-[10px] font-bold border rounded-full px-2 py-0.5 ${chip.cls}`}>{chip.label}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{p.campaign_name || '(sin nombre)'}</p>
                <p className="text-[11px] text-gray-400">{fecha} hs{p.producto ? ` · ${p.producto}` : ''} · {p.ads_ok}/{p.ads_total} ads</p>
              </div>
              {p.campaign_id && p.estado !== 'DELETED' && (
                <a href={linkAdsManager(p.account_id, p.campaign_id)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 dark:text-brand-400 hover:underline">
                  <ExternalLink size={11} /> Ads Manager
                </a>
              )}
            </summary>
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/60">
              {p.error && <p className="text-xs text-rose-600 dark:text-rose-400 mb-1.5">{p.error}</p>}
              <pre className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">{(p.log || []).join('\n') || 'Sin detalle.'}</pre>
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ── ESCALAR — el wizard de recetas desde ads EXISTENTES (post ids) ─────────
// Es OTRA cosa que publicar creativos nuevos: acá agarrás tus ads ganadores
// (por su número de publicación) y armás campañas de escalado con las recetas
// del equipo (CBO Deep Pocket / Cost Cap / ABO Bid Cap / ABO Cost Cap).
// Es el wizard que vivía en Métricas → "Publicar campaña", movido acá.
function EscalarTab({ addToast }) {
  const { connections } = useMetaConnections();
  const { accounts, loading } = useMetaAdAccounts(connections);
  const [accountId, setAccountId] = useState(() => {
    try { return localStorage.getItem('adslab-testeos-account') || ''; } catch { return ''; }
  });
  const account = useMemo(() => accounts.find(a => a.id === accountId) || accounts[0] || null, [accounts, accountId]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 shrink-0">Cuenta publicitaria</span>
        <div className="relative flex-1 min-w-[220px]">
          <select value={account?.id || ''} onChange={e => setAccountId(e.target.value)}
            className="w-full pl-3 pr-8 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">{loading ? 'Cargando cuentas…' : '— Elegí una cuenta —'}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name || a.id}{a.currency ? ` (${a.currency})` : ''}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        <span className="text-[11px] text-gray-400">Escalado desde ads existentes: pegás los números de publicación de tus ganadores y elegís la receta.</span>
      </div>
      {account ? (
        <PublicarCampana accountId={account.id} connId={account.connId} currency={account.currency || ''} addToast={addToast} />
      ) : (
        <p className="text-sm text-gray-400 py-6 text-center">Elegí una cuenta publicitaria para armar la campaña de escalado.</p>
      )}
    </div>
  );
}

// Videos publicables de una tarjeta: archivos con origen real (Drive o
// storage). Los aprobados van primero — son los que el modal pre-tilda.
function videosDe(a) {
  return (a.archivos || []).filter(f => f && (f.driveId || f.storagePath));
}

export default function PublicarSection({ addToast }) {
  const [, setTick] = useState(0);
  const [tab, setTab] = useState('cola'); // 'cola' | 'escalar' | 'historial'
  useEffect(() => subscribeProduccion(() => setTick(t => t + 1)), []);

  const asignaciones = listAllAssignments();

  // Cola: tarjetas aprobadas (listas y no publicadas aún) agrupadas por
  // producto. "En camino": revisión, para ver qué viene atrás.
  const { grupos, enRevision } = useMemo(() => {
    const porProducto = new Map();
    let rev = 0;
    for (const a of asignaciones) {
      if (a.estado === 'revision') { rev++; continue; }
      if (a.estado !== 'aprobado') continue;
      if (videosDe(a).length === 0) continue;
      const key = (a.productoNombre || 'Sin producto').trim() || 'Sin producto';
      if (!porProducto.has(key)) porProducto.set(key, []);
      porProducto.get(key).push(a);
    }
    const gs = [...porProducto.entries()]
      .map(([producto, tarjetas]) => ({ producto, tarjetas }))
      .sort((x, y) => x.producto.localeCompare(y.producto, 'es'));
    return { grupos: gs, enRevision: rev };
  }, [asignaciones]);

  // La cola ES el armador (pedido del user): primero elegís el PRODUCTO, y
  // abajo quedan sus tarjetas (desglosables, video por video) y la galería de
  // estáticos en miniatura — mezclás y publicás desde la misma pantalla.
  const [productoSel, setProductoSel] = useState('');
  const productoActivo = grupos.some(g => g.producto === productoSel) ? productoSel : (grupos[0]?.producto || '');
  // Tarjetas del producto elegido: aprobadas Y publicadas (para repescar).
  const tarjetasDe = useCallback((producto) => asignaciones.filter(a =>
    (a.productoNombre || 'Sin producto').trim() === producto &&
    ['aprobado', 'publicado'].includes(a.estado) && videosDe(a).length > 0), [asignaciones]);

  // Publicación OK → las tarjetas cuyos videos salieron pasan a Publicado.
  const alPublicar = useCallback((cardIds) => {
    const ids = (cardIds || []).filter(Boolean);
    let n = 0;
    for (const id of ids) {
      const t = asignaciones.find(a => a.id === id);
      if (t && t.estado === 'aprobado') { updateAssignment(id, { estado: 'publicado' }); n++; }
    }
    if (n > 0) addToast?.({ type: 'success', message: `${n} tarjeta${n === 1 ? '' : 's'} marcada${n === 1 ? '' : 's'} como Publicada 🚀` });
  }, [asignaciones, addToast]);

  const totalVideos = grupos.reduce((n, g) => n + g.tarjetas.reduce((m, t) => m + videosDe(t).length, 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Rocket size={22} className="text-brand-600" /> Publicador
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Todo lo aprobado por Producción, listo para salir a Meta. Al publicar OK, las tarjetas pasan solas a <b>Publicado</b>.
          </p>
        </div>
        {enRevision > 0 && tab === 'cola' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1">
            <Clock size={12} /> {enRevision} tarjeta{enRevision === 1 ? '' : 's'} en revisión viniendo atrás
          </span>
        )}
      </div>

      <div className="flex gap-1.5">
        {/* Pestañas chicas tipo filtro (prototipo 1-C elegido por el user). */}
        {[['cola', 'Publicar', Rocket], ['escalar', 'Escalar', TrendingUp], ['historial', 'Historial', History]].map(([k, label, Icono]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-bold rounded-lg transition ${tab === k
              ? 'bg-brand-600 text-white'
              : 'text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            <Icono size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'escalar' ? <EscalarTab addToast={addToast} />
        : tab === 'historial' ? <HistorialTab addToast={addToast} /> : grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-gray-500 dark:text-gray-400">
          <PackageOpen size={34} className="mx-auto mb-3 opacity-60" />
          <p className="font-semibold">No hay tarjetas aprobadas sin publicar.</p>
          <p className="text-sm mt-1">Aprobá contenido en <b>Producción</b> y aparece acá, agrupado por producto y listo para un click.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 1) Elegí el PRODUCTO — chips con su cola de videos */}
          <div className="flex items-center gap-2 flex-wrap">
            {grupos.map(g => {
              const nVid = g.tarjetas.reduce((m, t) => m + videosDe(t).length, 0);
              const preset = leerPresetPublicar(g.producto);
              const on = g.producto === productoActivo;
              return (
                <button key={g.producto} onClick={() => setProductoSel(g.producto)}
                  title={preset?.adId ? 'Campaña base configurada ✓' : 'Sin campaña base todavía — se configura adentro'}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${on
                    ? 'bg-brand-600/15 text-brand-700 dark:text-brand-300 border-brand-500/60 font-bold'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-brand-400'}`}>
                  {g.producto}
                  <span className={`text-[9.5px] font-bold px-1 py-px rounded-full ${on ? 'bg-brand-500/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300'}`}>{nVid}</span>
                  {preset?.adId && <CheckCircle2 size={11} className="text-emerald-500" />}
                </button>
              );
            })}
            <span className="ml-auto text-xs text-gray-400">{totalVideos} video{totalVideos === 1 ? '' : 's'} en cola</span>
          </div>

          {/* 2) El armador del producto elegido, acá mismo: tarjetas
                desglosables + galería de estáticos + armado a la derecha. */}
          {productoActivo && (
            <PublicarArmador
              key={productoActivo}
              embedded
              producto={productoActivo}
              tarjetas={tarjetasDe(productoActivo)}
              addToast={addToast}
              onPublicadas={alPublicar}
              onVolver={() => {}}
            />
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 text-right">{totalVideos} video{totalVideos === 1 ? '' : 's'} en cola en total</p>
        </div>
      )}

    </div>
  );
}
