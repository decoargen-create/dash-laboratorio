// Panel para generar los creativos de TODAS las ideas de una vez, y la
// barra de progreso flotante que muestra el avance (sigue visible aunque
// cambies de pestaña dentro del workspace).

import React, { useState, useEffect } from 'react';
import { Images, Loader2, X } from 'lucide-react';
import { loadIdeas } from './bandejaStore.js';
import { getAllCreativoIds } from './creativosStorage.js';
import { getProductoImagen } from './productoImagen.js';

export default function GeneradorCreativosMasivo({ producto, bulkRunning, onGenerar }) {
  const [conCreativo, setConCreativo] = useState(new Set());
  const [quality, setQuality] = useState('medium');
  const [estiloEscena, setEstiloEscena] = useState('producto');

  // Refrescamos qué ideas ya tienen creativo cuando termina un bulk.
  useEffect(() => {
    if (!bulkRunning) getAllCreativoIds().then(setConCreativo).catch(() => {});
  }, [bulkRunning, producto?.id]);

  const ideas = loadIdeas().filter(i =>
    String(i.productoId || '') === String(producto?.id || '') && i.estado !== 'archivada'
  );
  const sinCreativo = ideas.filter(i => !conCreativo.has(String(i.id)));
  const tieneFoto = !!getProductoImagen(producto?.id);
  const costoEstim = (sinCreativo.length * 0.06).toFixed(2);

  const handleClick = () => {
    if (sinCreativo.length === 0 || bulkRunning) return;
    if (!window.confirm(
      `Vas a generar ${sinCreativo.length} creativos (calidad ${quality}). Costo estimado ~$${costoEstim} en OpenAI. ¿Seguir?`
    )) return;
    onGenerar(sinCreativo, { quality, estiloEscena });
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shrink-0">
          <Images size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Generar creativos en masa</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {sinCreativo.length > 0
              ? `${sinCreativo.length} ideas sin creativo — generá la imagen de todas de una.`
              : 'Todas las ideas ya tienen su creativo. 🎉'}
          </p>
        </div>
      </div>

      {!tieneFoto && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
          ⚠ Cargá la foto del producto en Setup para poder generar estáticos.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={estiloEscena}
          onChange={e => setEstiloEscena(e.target.value)}
          disabled={bulkRunning}
          className="px-2 py-1.5 text-[11px] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        >
          <option value="producto">🧴 Producto (estudio)</option>
          <option value="lifestyle">🏡 Lifestyle (persona)</option>
          <option value="ugc">📱 UGC</option>
          <option value="comparacion">⚖️ Comparación</option>
        </select>
        <select
          value={quality}
          onChange={e => setQuality(e.target.value)}
          disabled={bulkRunning}
          className="px-2 py-1.5 text-[11px] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        >
          <option value="low">Calidad baja</option>
          <option value="medium">Calidad media</option>
          <option value="high">Calidad alta</option>
        </select>
        <button
          onClick={handleClick}
          disabled={bulkRunning || sinCreativo.length === 0 || !tieneFoto}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-br from-brand-600 to-brand-500 rounded-lg hover:from-brand-700 hover:to-brand-600 shadow-sm transition disabled:opacity-50"
        >
          {bulkRunning
            ? <><Loader2 size={13} className="animate-spin" /> Generando…</>
            : <><Images size={13} /> Generar {sinCreativo.length > 0 ? sinCreativo.length : ''} creativos</>}
        </button>
      </div>
    </div>
  );
}

// Barra de progreso flotante — fija abajo a la derecha, visible mientras
// corre la generación masiva aunque cambies de pestaña.
export function BulkProgressBar({ state, onCancel }) {
  if (!state) return null;
  const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-3.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin text-brand-500" /> Generando creativos
        </p>
        <button onClick={onCancel} title="Cancelar"
          className="p-1 text-gray-400 hover:text-red-500 rounded transition">
          <X size={14} />
        </button>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-brand-500 to-brand-600 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] tabular-nums">
        <span className="text-gray-600 dark:text-gray-300 font-bold">{state.done} / {state.total}</span>
        <span className="text-gray-500 dark:text-gray-400">
          <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ {state.ok}</span>
          {state.fail > 0 && <span className="text-red-500 font-bold"> · ✗ {state.fail}</span>}
        </span>
      </div>
      {state.actual && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-1">{state.actual}</p>
      )}
    </div>
  );
}
