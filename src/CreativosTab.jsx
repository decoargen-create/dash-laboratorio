// Tab "Creativos" del workspace de un producto.
// Migración del módulo Creativos de Marketing.jsx — corre el endpoint
// /api/marketing/creatives action="hooks" y muestra el diagnóstico +
// hooks por ángulo + observaciones estratégicas.
//
// Vive embebido dentro del workspace de producto en Arranque.jsx.
//
// Props:
//   producto: el producto activo (con docs, competidores, etc.)
//   onUpdateProducto: callback para guardar resultados en el producto
//   addToast: para feedback al user

import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

export default function CreativosTab({ producto, onUpdateProducto, addToast }) {
  // Config del generador (defaults razonables para Argentina/cosmética)
  const [hooksTono, setHooksTono] = useState(
    producto?.creativos?.fase1?.config?.tono || 'argentino coloquial, directo'
  );
  const [hooksObjetivo, setHooksObjetivo] = useState(
    producto?.creativos?.fase1?.config?.objetivo || 'Mix'
  );
  const [hooksRestricciones, setHooksRestricciones] = useState(
    producto?.creativos?.fase1?.config?.restricciones || 'sin palabras gatillo, sin vulgaridad'
  );
  const [hooksRunning, setHooksRunning] = useState(false);

  const creativos = producto?.creativos || null;
  const yaTieneHooks = !!creativos?.fase1?.hooks?.length;

  const generarHooks = async () => {
    // Implementación en Parte 8.5.2 — por ahora placeholder.
    addToast?.({ type: 'info', message: 'Generador de hooks: lógica viene en próxima parte (8.5.2)' });
  };

  return (
    <div className="space-y-5">
      {/* Config + botón generar */}
      <div className="bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-purple-600 dark:text-purple-400" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Fase 1 — Hooks + diagnóstico</h3>
          <span className="ml-auto text-[10px] text-gray-500 dark:text-gray-400">Generador de creativos Meta Ads</span>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">
          Genera 15-25 hooks categorizados por ángulo (sarcasmo, insight, POV, autoridad, testimonio), basándose en el research + avatar + offer brief del producto + competidores + aprendizajes.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Tono</label>
            <input
              type="text"
              value={hooksTono}
              onChange={e => setHooksTono(e.target.value)}
              placeholder="argentino coloquial, directo"
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Objetivo</label>
            <select
              value={hooksObjetivo}
              onChange={e => setHooksObjetivo(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="TOFU">TOFU (prospecting)</option>
              <option value="MOFU">MOFU (consideración)</option>
              <option value="BOFU">BOFU (conversión)</option>
              <option value="Retargeting">Retargeting</option>
              <option value="Mix">Mix</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Restricciones</label>
            <input
              type="text"
              value={hooksRestricciones}
              onChange={e => setHooksRestricciones(e.target.value)}
              placeholder="sin palabras gatillo, sin vulgaridad"
              className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>
        <button
          onClick={generarHooks}
          disabled={hooksRunning}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-purple-600 to-violet-500 rounded-lg hover:from-purple-700 hover:to-violet-600 shadow-sm transition disabled:opacity-40"
        >
          {hooksRunning
            ? <><Loader2 size={14} className="animate-spin" /> Generando…</>
            : <><Sparkles size={14} /> {yaTieneHooks ? 'Regenerar hooks' : 'Generar hooks'}</>
          }
        </button>
        {creativos?.fase1?.generatedAt && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">
            Última generación: {new Date(creativos.fase1.generatedAt).toLocaleString('es-AR')}
          </p>
        )}
      </div>

      {/* Placeholder del display de hooks (viene en Parte 8.5.3) */}
      {!yaTieneHooks && !hooksRunning && (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Sin hooks generados todavía</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            Click en "Generar hooks" arriba — tarda ~60-90 segundos.
          </p>
        </div>
      )}

      {yaTieneHooks && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center text-xs text-gray-500 dark:text-gray-400 italic">
          {creativos.fase1.hooks.length} hooks ya generados — display detallado viene en Parte 8.5.3.
        </div>
      )}
    </div>
  );
}
