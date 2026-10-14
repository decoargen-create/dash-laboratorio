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
import { Rocket, Film, CheckCircle2, Clock, Settings2, ChevronRight, PackageOpen, History, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { leerPresetPublicar } from './PublicarCampanaModal.jsx';
import PublicarArmador from './PublicarArmador.jsx';
import { authHeaders } from './MetaConnect.jsx';
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

// Videos publicables de una tarjeta: archivos con origen real (Drive o
// storage). Los aprobados van primero — son los que el modal pre-tilda.
function videosDe(a) {
  return (a.archivos || []).filter(f => f && (f.driveId || f.storagePath));
}

export default function PublicarSection({ addToast }) {
  const [, setTick] = useState(0);
  const [tab, setTab] = useState('cola'); // 'cola' | 'historial'
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

  // Selección de tarjetas por grupo (default: todas tildadas).
  const [desmarcadas, setDesmarcadas] = useState(() => new Set());
  const toggleTarjeta = (id) => setDesmarcadas(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  // ARMADOR a pantalla completa (estilo Meta uploader): se entra por producto
  // con TODAS sus tarjetas con videos (aprobadas y publicadas, para repescar),
  // y adentro se eligen videos sueltos + estáticos y se reparte en campañas.
  const [armando, setArmando] = useState(null); // { producto, tarjetas }
  const abrirArmador = useCallback((grupo) => {
    const delProducto = asignaciones.filter(a =>
      (a.productoNombre || 'Sin producto').trim() === grupo.producto &&
      ['aprobado', 'publicado'].includes(a.estado) && videosDe(a).length > 0);
    setArmando({ producto: grupo.producto, tarjetas: delProducto });
  }, [asignaciones]);

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

  // Pantalla completa del armador (reemplaza la cola mientras está abierto).
  if (armando) {
    return (
      <PublicarArmador
        producto={armando.producto}
        tarjetas={armando.tarjetas}
        addToast={addToast}
        onPublicadas={alPublicar}
        onVolver={() => setArmando(null)}
      />
    );
  }

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
        {[['cola', 'Cola de listos', Rocket], ['historial', 'Historial', History]].map(([k, label, Icono]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-lg transition ${tab === k
              ? 'bg-brand-600 text-white'
              : 'text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            <Icono size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'historial' ? <HistorialTab addToast={addToast} /> : grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-gray-500 dark:text-gray-400">
          <PackageOpen size={34} className="mx-auto mb-3 opacity-60" />
          <p className="font-semibold">No hay tarjetas aprobadas sin publicar.</p>
          <p className="text-sm mt-1">Aprobá contenido en <b>Producción</b> y aparece acá, agrupado por producto y listo para un click.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map(g => {
            const preset = leerPresetPublicar(g.producto);
            const elegidas = g.tarjetas.filter(t => !desmarcadas.has(t.id));
            const nVideos = elegidas.reduce((m, t) => m + videosDe(t).length, 0);
            return (
              <div key={g.producto} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base font-extrabold text-gray-900 dark:text-white truncate">{g.producto}</span>
                    {preset?.adId ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
                        <CheckCircle2 size={11} /> Campaña base lista
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-500/10 border border-gray-400/30 rounded-full px-2 py-0.5">
                        <Settings2 size={11} /> Sin preset — la elegís al publicar
                      </span>
                    )}
                  </div>
                  <button onClick={() => abrirArmador(g)}
                    title="Abre el armador: elegís videos sueltos de cualquier tarjeta, sumás estáticos y repartís en una o varias campañas."
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">
                    <Rocket size={13} /> Armar publicación ({nVideos} video{nVideos === 1 ? '' : 's'}) <ChevronRight size={12} />
                  </button>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {g.tarjetas.map(t => {
                    const vids = videosDe(t);
                    const aprob = vids.filter(f => f.aprobado).length;
                    const incluida = !desmarcadas.has(t.id);
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                        <input type="checkbox" checked={incluida} onChange={() => toggleTarjeta(t.id)}
                          className="w-4 h-4 accent-brand-600 cursor-pointer shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-semibold truncate ${incluida ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                            {t.persona || 'Sin editor'} · {weekLabel(t.weekKey) || t.weekKey || ''}
                          </p>
                          {t.nota && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.nota}</p>}
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0">
                          <Film size={12} /> {vids.length} video{vids.length === 1 ? '' : 's'}
                          {aprob > 0 && aprob < vids.length && <span className="text-emerald-600 dark:text-emerald-400">({aprob} aprob.)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <p className="text-xs text-gray-400 dark:text-gray-500 text-right">{totalVideos} video{totalVideos === 1 ? '' : 's'} en cola en total</p>
        </div>
      )}

    </div>
  );
}
