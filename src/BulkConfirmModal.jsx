// Modal de confirmación del bulk-gen — reemplaza el window.confirm pelado del
// navegador. Diseño "Panel" (elegido por el user entre 3 prototipos): tiles
// con los números grandes, el gasto en ARS como protagonista con el desglose
// al costado (imágenes / estrategia / planes cacheados), tiempo estimado y el
// aviso ámbar de categoría cruzada solo cuando aplica.
//
// Contrato: recibe `data` (armado en handleBulkCrear) y `onClose(ok)` — true
// si el user confirmó, false si canceló (botón, ✕, Esc o clic afuera). Nada
// se dispara sin tocar "Generar".

import React, { useEffect, useState } from 'react';
import { X, Clock, Sparkles, Zap, CloudUpload, TriangleAlert } from 'lucide-react';
import { fetchDolarCripto, subscribeDolar, usdToArsString, getDolarCriptoCached } from './dolarStore.js';

const fmtDur = (secs) => (secs < 90 ? `~${Math.round(secs)}s` : `~${Math.round(secs / 60)} min`);

export default function BulkConfirmModal({ data, onClose }) {
  const [dolar, setDolar] = useState(() => getDolarCriptoCached());
  useEffect(() => {
    fetchDolarCripto().catch(() => {});
    return subscribeDolar(setDolar);
  }, []);

  // Esc cancela — mismo gesto que cerrar cualquier modal de la app.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!data) return null;
  const {
    productoNombre, nAds, nVar, total, sizeLabel, quality,
    costoEstimado, costoImagenes, costoPorImagen, costoVision, visionAds, cachedAds,
    etaSecs, pool, mismCount,
  } = data;

  const ars = dolar?.venta ? usdToArsString(costoEstimado, dolar) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => onClose(false)}
    >
      <div
        className="relative w-full max-w-[380px] bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden text-[13px]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onClose(false)}
          className="absolute top-3 right-3 z-10 p-1 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200 transition"
          title="Cancelar"
        >
          <X size={16} />
        </button>

        {/* Banner */}
        <div className="px-5 pt-4 pb-3.5 bg-gradient-to-br from-brand-500/20 to-purple-500/10 border-b border-gray-100 dark:border-gray-700">
          <div className="text-[10px] font-extrabold tracking-[.12em] text-brand-600 dark:text-brand-400 uppercase truncate">
            Bulk · {productoNombre}
          </div>
          <h3 className="mt-0.5 text-base font-extrabold text-gray-900 dark:text-white flex items-center gap-1.5">
            <Sparkles size={15} className="text-brand-500" /> Generar creativos
          </h3>
        </div>

        {/* Tiles */}
        <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-2 px-5 pt-3.5">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 py-2.5 text-center">
            <div className="text-xl font-extrabold tabular-nums text-gray-900 dark:text-white">{nAds}</div>
            <div className="text-[9.5px] font-bold tracking-[.08em] text-gray-400 dark:text-gray-500">ADS</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 py-2.5 text-center">
            <div className="text-xl font-extrabold tabular-nums text-gray-900 dark:text-white">×{nVar}</div>
            <div className="text-[9.5px] font-bold tracking-[.08em] text-gray-400 dark:text-gray-500">VARIANTES</div>
          </div>
          <div className="rounded-xl border border-brand-400/60 dark:border-brand-600/60 bg-brand-50 dark:bg-brand-900/30 py-2.5 text-center">
            <div className="text-xl font-extrabold tabular-nums text-brand-600 dark:text-brand-300">{total}</div>
            <div className="text-[9.5px] font-bold tracking-[.08em] text-brand-400 dark:text-brand-500">IMÁGENES</div>
          </div>
        </div>

        {/* Costo */}
        <div className="flex items-center justify-between mx-5 mt-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 px-3.5 py-3">
          <div>
            <div className="text-[10px] font-bold tracking-[.08em] text-gray-400 dark:text-gray-500">GASTO ESTIMADO</div>
            <div className="mt-0.5 text-[21px] leading-none font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
              {ars || `US$ ${costoEstimado.toFixed(2)}`}
            </div>
            <div className="mt-1 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
              {ars ? `US$ ${costoEstimado.toFixed(2)} · dólar $${Math.round(dolar.venta).toLocaleString('es-AR')}` : 'cargando dólar cripto…'}
            </div>
          </div>
          <div className="text-right text-[11px] leading-relaxed tabular-nums text-gray-500 dark:text-gray-400">
            {total} img × ${costoPorImagen.toFixed(2)} <b className="text-gray-800 dark:text-gray-200">US$ {costoImagenes.toFixed(2)}</b><br />
            estrategia × {visionAds} <b className="text-gray-800 dark:text-gray-200">US$ {costoVision.toFixed(2)}</b>
            {cachedAds > 0 && (<><br />{cachedAds} plan{cachedAds !== 1 ? 'es' : ''} cacheado{cachedAds !== 1 ? 's' : ''} <b className="text-emerald-600 dark:text-emerald-400">gratis</b></>)}
          </div>
        </div>

        {/* Tiempo */}
        <div className="flex items-center gap-2.5 mx-5 mt-3 text-[11.5px] text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1 shrink-0">
            <Clock size={12} /> <b className="text-gray-800 dark:text-gray-200 tabular-nums">{fmtDur(etaSecs)}</b>
          </span>
          <div className="flex-1 h-[5px] rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-brand-500 to-purple-500" />
          </div>
          <span className="flex items-center gap-1 shrink-0">
            <Zap size={12} /> <b className="text-gray-800 dark:text-gray-200 tabular-nums">{pool} ad{pool !== 1 ? 's' : ''}</b> a la vez
          </span>
        </div>

        {/* Aviso de categoría cruzada — solo cuando aplica */}
        {mismCount > 0 && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11.5px] leading-snug text-amber-600 dark:text-amber-400">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            <span>
              {mismCount} de los {nAds} ads parece{mismCount !== 1 ? 'n' : ''} de otra categoría que "{productoNombre}" — el creativo se re-ancla igual, pero la inspiración visual puede salir rara.
            </span>
          </div>
        )}

        <p className="px-5 pt-2.5 pb-1 text-[10.5px] leading-relaxed text-gray-400 dark:text-gray-500">
          {sizeLabel} · {quality} · <CloudUpload size={11} className="inline -mt-0.5" /> Dejá la pestaña abierta: lo que ya salió se guarda solo en el cloud, pero los ads que no arrancaron no se disparan si cerrás.
        </p>

        <div className="flex gap-2.5 px-5 pt-2 pb-4">
          <button
            onClick={() => onClose(false)}
            className="flex-1 rounded-xl py-2.5 text-[13px] font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition"
          >
            Cancelar
          </button>
          <button
            onClick={() => onClose(true)}
            className="flex-1 rounded-xl py-2.5 text-[13px] font-bold text-white bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 shadow-lg shadow-brand-600/30 transition flex items-center justify-center gap-1.5"
          >
            <Sparkles size={13} /> Generar {total} imágenes
          </button>
        </div>
      </div>
    </div>
  );
}
