// Panel mínimo de generación del creativo estático con gpt-image-2.
// Un botón → llama al endpoint → muestra la imagen → descargar / regenerar.
// Sin canvas overlay, sin QA, sin auto-mejora, sin bulk — gpt-image-2
// maneja el texto multilingüe bien por sí solo.

import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { saveCreativo, getCreativo, deleteCreativo } from './creativosStorage.js';
import { logCostsFromResponse } from './costsStore.js';

export default function CreativoPanel({ idea }) {
  const [creativo, setCreativo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState('medium');

  // Al montar, miramos si ya hay creativo guardado en IndexedDB.
  useEffect(() => {
    let alive = true;
    getCreativo(idea.id).then(c => { if (alive) setCreativo(c); });
    return () => { alive = false; };
  }, [idea.id]);

  const handleGenerate = async () => {
    setError('');
    setLoading(true);
    try {
      const resp = await fetch('/api/marketing/generate-creative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quality,
          idea: {
            promptGeneradorImagen: idea.promptGeneradorImagen,
            descripcionImagen: idea.descripcionImagen,
            textoEnImagen: idea.textoEnImagen,
            hook: idea.hook,
            titulo: idea.titulo,
            formato: idea.formato,
            estiloVisual: idea.estiloVisual,
            copyPostMeta: idea.copyPostMeta || idea.copy,
          },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      logCostsFromResponse(data, `generate-creative · gpt-image-2 · ${(idea.titulo || idea.hook || '').slice(0, 50)}`);

      const nuevo = {
        imageBase64: data.imageBase64,
        mimeType: data.mimeType || 'image/png',
        formato: data.formato || idea.formato || 'static',
        size: data.size,
        quality: data.quality,
        model: data.model,
        generatedAt: data.generatedAt,
      };
      await saveCreativo(idea.id, nuevo);
      setCreativo(nuevo);
    } catch (err) {
      setError(err.message || 'Error generando el creativo');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    await deleteCreativo(idea.id);
    setCreativo(null);
    await handleGenerate();
  };

  const dataUrl = creativo
    ? `data:${creativo.mimeType || 'image/png'};base64,${creativo.imageBase64}`
    : null;

  return (
    <div className="bg-brand-50 dark:bg-brand-900/20 rounded-md border border-brand-200 dark:border-brand-800">
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase tracking-wider">
          🎨 Creativo estático
        </p>
        {creativo && (
          <span className="text-[9px] text-brand-500 dark:text-brand-400 font-mono">
            {creativo.model} · {creativo.quality} · {creativo.size}
          </span>
        )}
      </div>

      <div className="px-3 pb-3">
        {dataUrl && (
          <div className="space-y-2">
            <img
              src={dataUrl}
              alt={idea.titulo || 'Creativo generado'}
              className="w-full rounded-lg border border-brand-200 dark:border-brand-800 bg-white"
            />
            <div className="flex flex-wrap gap-1.5">
              <a
                href={dataUrl}
                download={`creativo-${(idea.titulo || 'idea').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase()}.png`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-white bg-brand-600 rounded hover:bg-brand-700 transition"
              >
                <Download size={11} /> Descargar PNG
              </a>
              <button
                onClick={handleRegenerate}
                disabled={loading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 transition disabled:opacity-50"
              >
                {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Regenerar
              </button>
            </div>
          </div>
        )}

        {loading && !dataUrl && (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-brand-700 dark:text-brand-300">
            <Loader2 size={14} className="animate-spin" />
            Generando con gpt-image-2… puede tardar 30-60s.
          </div>
        )}

        {!loading && !dataUrl && (
          <div className="space-y-2">
            <p className="text-[11px] text-brand-700 dark:text-brand-300">
              Generá la imagen final del ad a partir del brief. gpt-image-2 (nuevo) renderiza el texto en español sin garabatos.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={quality}
                onChange={e => setQuality(e.target.value)}
                className="px-2 py-1 text-[10px] bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                title="Calidad — más calidad = más costo"
              >
                <option value="low">Calidad baja (~$0.03)</option>
                <option value="medium">Calidad media (~$0.07)</option>
                <option value="high">Calidad alta (~$0.18)</option>
              </select>
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-white bg-gradient-to-br from-brand-600 to-brand-700 rounded hover:from-brand-700 hover:to-brand-800 transition"
              >
                <Sparkles size={12} /> Generar creativo
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-2 text-[10px] text-red-600 dark:text-red-400 flex items-start gap-1">
            <AlertCircle size={11} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  );
}
