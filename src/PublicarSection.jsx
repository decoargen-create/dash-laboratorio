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
import { Rocket, Film, CheckCircle2, Clock, Settings2, ChevronRight, PackageOpen } from 'lucide-react';
import PublicarCampanaModal, { leerPresetPublicar } from './PublicarCampanaModal.jsx';
import {
  listAllAssignments, subscribeProduccion, updateAssignment, weekLabel,
} from './produccionStore.js';

// Videos publicables de una tarjeta: archivos con origen real (Drive o
// storage). Los aprobados van primero — son los que el modal pre-tilda.
function videosDe(a) {
  return (a.archivos || []).filter(f => f && (f.driveId || f.storagePath));
}

export default function PublicarSection({ addToast }) {
  const [, setTick] = useState(0);
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

  // Modal: se abre con una tarjeta SINTÉTICA que junta los videos de todas
  // las tarjetas elegidas del producto. El ts se prefija con el id de la
  // tarjeta para que no choquen entre tarjetas (el modal lo usa solo como
  // clave de selección).
  const [publicando, setPublicando] = useState(null); // { producto, cardIds, a }
  const abrirPublicar = useCallback((grupo) => {
    const elegidas = grupo.tarjetas.filter(t => !desmarcadas.has(t.id));
    if (elegidas.length === 0) {
      addToast?.({ type: 'warning', message: 'Tildá al menos una tarjeta del producto.' });
      return;
    }
    const archivos = elegidas.flatMap(t => videosDe(t).map(f => ({ ...f, ts: `${t.id}:${f.ts}` })));
    setPublicando({
      producto: grupo.producto,
      cardIds: elegidas.map(t => t.id),
      a: { id: `cola-${grupo.producto}`, productoNombre: grupo.producto, archivos },
    });
  }, [desmarcadas, addToast]);

  // Publicación OK → las tarjetas incluidas pasan solas a Publicado.
  const alPublicar = useCallback(() => {
    if (!publicando) return;
    for (const id of publicando.cardIds) updateAssignment(id, { estado: 'publicado' });
    addToast?.({ type: 'success', message: `${publicando.cardIds.length} tarjeta${publicando.cardIds.length === 1 ? '' : 's'} marcada${publicando.cardIds.length === 1 ? '' : 's'} como Publicada 🚀` });
  }, [publicando, addToast]);

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
        {enRevision > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1">
            <Clock size={12} /> {enRevision} tarjeta{enRevision === 1 ? '' : 's'} en revisión viniendo atrás
          </span>
        )}
      </div>

      {grupos.length === 0 ? (
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
                  <button onClick={() => abrirPublicar(g)} disabled={nVideos === 0}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-50">
                    <Rocket size={13} /> Publicar {nVideos} video{nVideos === 1 ? '' : 's'} <ChevronRight size={12} />
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

      {publicando && (
        <PublicarCampanaModal
          a={publicando.a}
          addToast={addToast}
          onPublished={alPublicar}
          onClose={() => setPublicando(null)}
        />
      )}
    </div>
  );
}
