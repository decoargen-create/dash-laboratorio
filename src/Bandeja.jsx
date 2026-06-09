// Sección Bandeja de ideas.
//
// Lista continua de ideas/renovaciones generadas por el pipeline. Cada vez
// que se hace un deep-analyze de un ad ganador, se agrega una idea tipo
// "replica" acá (sin duplicar si ya existe). Más adelante (Fase 3) el
// generador va a empujar iteraciones, diferenciaciones y desde-cero.
//
// UX:
//   - Resumen arriba: contadores por estado (pendientes / en uso / usadas)
//   - Filtros: tipo + estado + búsqueda por texto
//   - Lista de cards, las pendientes arriba, las usadas al final
//   - Click en una card expande los detalles (hook, copy, guion, notas)
//   - Checkbox rápido para marcar "en uso" o "usada"

import React, { useState, useEffect, useRef } from 'react';
import {
  Inbox, Search, Filter, ExternalLink, Trash2, Download, Package,
  ChevronDown, Check, Circle, CircleDot, Archive, Edit3, CheckSquare, Square, ChevronRight,
  Plus, Pencil, GripVertical, Loader2, RefreshCw, Sparkles,
} from 'lucide-react';
import {
  loadIdeas, updateIdea, removeIdea, TIPO_META, ESTADO_META, VARIABLE_META, ANGULO_META, CAMPAÑA_META,
} from './bandejaStore.js';
import { exportBriefDocx } from './exportDocx.js';
import { logCostsFromResponse } from './costsStore.js';
import CreativoPanel from './CreativoPanel.jsx';
import { getProductoImagen, getAccentColor } from './productoImagen.js';
import { saveReferencial } from './galeriaReferenciales.js';
import { supabase } from './supabase.js';
import { bulkGenerateFromIdeas } from './bandejaBulkGenerate.js';
import { parseJsonOrThrow } from './apiHelpers.js';
import { deleteCreativo } from './creativosStorage.js';
import { enqueueGenerate as enqueueGenerarCreativo } from './creativoGeneratorStore.js';
import { startExecution, updateExecution, finishExecution } from './executionsStore.js';

const PRODUCTOS_KEY = 'adslab-marketing-productos-v1';
const ACTIVE_PRODUCT_KEY = 'adslab-marketing-bandeja-active-product';
const SIN_PRODUCTO_ID = '__sin_producto__';

function loadProductos() {
  try {
    const raw = localStorage.getItem(PRODUCTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// Construye un prompt listo para pegar en gpt-image-2. NO es un mero brief
// del diseñador — está armado como lo escribiría un media buyer experto en
// Meta Ads de DTC: optimizado para scroll-stop, jerarquía visual, safe zones,
// claims defendibles. El user puede copiar este prompt y pegarlo en cualquier
// generador o el endpoint de la app lo usa como base.
function buildPromptGptImage2Es(idea) {
  const partes = [];

  // 1. CONTEXTO + ESTÁNDARES META ADS
  partes.push(`# CREATIVO ESTÁTICO PARA META ADS — DTC PREMIUM ARGENTINA

Sos un media buyer profesional de Meta Ads especializado en estáticos de DTC en LATAM. Generá una imagen que:
- Pasa el test SCROLL-STOP de 0.5s: jerarquía clara, foco único, texto BOLD legible al pulgar.
- Respeta safe zones de Meta: 5% margen interior libre, texto importante en zona segura (no en los bordes que recortan los placements).
- Photorealista. NO ilustración. NO mockups planos. NO renders 3D obvios.
- NO caras gringas, NO sonrisas plásticas. Si hay personas, tono mediterráneo/latino, expresión natural.
- Render de texto: ESPAÑOL exacto, BOLD sans-serif moderno, alto contraste con el fondo. Cero garabato.`);

  // 2. CONCEPTO + ÁNGULO
  if (idea.hook || idea.angulo) {
    partes.push(`## CONCEPTO CENTRAL
${idea.hook ? `Hook: "${idea.hook}"` : ''}${idea.angulo ? `\nÁngulo estratégico: ${idea.angulo}` : ''}${idea.painPoint ? `\nPain point que apalanca: ${idea.painPoint}` : ''}${idea.creenciaApalancada ? `\nCreencia apalancada: ${idea.creenciaApalancada}` : ''}`);
  }

  // 3. BRIEF VISUAL
  if (idea.descripcionImagen || idea.escenarioNarrativo || idea.estiloVisual) {
    partes.push(`## BRIEF VISUAL
${idea.descripcionImagen ? `Composición: ${idea.descripcionImagen}` : ''}${idea.escenarioNarrativo ? `\nEscenario: ${idea.escenarioNarrativo}` : ''}${idea.estiloVisual ? `\nEstilo: ${idea.estiloVisual}` : ''}`);
  }

  // 4. PRODUCTO
  if (idea.productoNombre) {
    partes.push(`## PRODUCTO
${idea.productoNombre} (envase real pixel-fiel — si tenés foto del producto, respetar shape/color/label EXACTOS. Cero modificación del label).`);
  }

  // 5. TEXTO EN IMAGEN (si aplica)
  if (idea.textoEnImagen) {
    partes.push(`## OVERLAYS DE TEXTO (renderizar EXACTO como abajo, NO traducir, BOLD sans-serif, máximo contraste)
${idea.textoEnImagen}`);
  }

  // 6. AUDIENCIA + TONO
  if (idea.publicoSugerido) {
    partes.push(`## AUDIENCIA TARGET
${idea.publicoSugerido}`);
  }

  // 7. ESTÁNDARES TÉCNICOS
  partes.push(`## REGLAS TÉCNICAS
- Ratio: 1:1 (feed) por default, 4:5 para máxima conversión, 9:16 para Stories.
- Resolución: 2048×2048 mínimo.
- Producto ocupa 30-50% del frame (test scroll: focal point único).
- Texto importante: top 1/3 o bottom 1/3, NUNCA en zona de avatar / CTA del placement.
- Color contrast mínimo 4.5:1 entre texto y fondo (legibilidad mobile).
- NO inventes precios, % off, badges regulatorios (FDA, ANMAT) si no se declararon explícitamente.
- NO inventes texto sobre el envase del producto.`);

  partes.push(`## CHECKLIST FINAL (autocrítica antes de generar)
□ ¿Hay UN foco visual único o está cluttered?
□ ¿El hook es legible en 0.5s o necesita lectura cuidadosa?
□ ¿El texto está dentro de safe zones (no en los bordes)?
□ ¿La paleta vende confianza Y atención (no solo bonita)?
□ ¿El producto se reconoce inmediatamente?`);

  return partes.filter(Boolean).join('\n\n');
}

// a texto corrido) tienen `guion`/`guionAdaptado` guardado como objeto
// estructurado { duracionSegundos, tono, ganchoVisual, beats, ... }.
// Renderizar ese objeto crudo crashea React (error #31: objects are not
// valid as a child). Esto lo aplana a texto legible.
function guionToText(g) {
  if (!g) return '';
  if (typeof g === 'string') return g;
  if (typeof g === 'object') {
    const lines = [];
    if (g.duracionSegundos) lines.push(`Duración: ${g.duracionSegundos}s`);
    if (g.tono) lines.push(`Tono: ${g.tono}`);
    if (g.ganchoVisual) lines.push(`Gancho visual: ${g.ganchoVisual}`);
    if (Array.isArray(g.beats)) {
      g.beats.forEach((b, i) => {
        if (typeof b === 'string') {
          lines.push(`${i + 1}. ${b}`);
        } else if (b && typeof b === 'object') {
          const partes = [b.timecode || b.tiempo, b.visual || b.escena, b.vo || b.voiceover || b.texto || b.locucion]
            .filter(Boolean);
          lines.push(`${i + 1}. ${partes.join(' — ')}`);
        }
      });
    }
    if (g.musicaSugerida) lines.push(`Música: ${g.musicaSugerida}`);
    if (g.notasParaEditor) lines.push(`Notas para el editor: ${g.notasParaEditor}`);
    return lines.join('\n');
  }
  return String(g);
}

// Props:
//   addToast: callback de toasts
//   forcedProductoId: cuando viene seteado (ej: embebida en Arranque tabs),
//     fuerza el producto activo y skipea el selector inicial.
//   embedded: cuando true, oculta el header con breadcrumb (porque el padre
//     ya tiene su propio header de producto).
// =========================================================
// Componentes internos definidos ANTES del export — fix TDZ
// para Vite/Rollup en builds minificados.
// =========================================================

function CounterCard({ label, value, color, accent = false }) {
  const colors = {
    gray: 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100',
    amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200',
  };
  return (
    <div className={`p-3 rounded-xl border ${colors[color]} ${accent ? 'ring-2 ring-brand-200 dark:ring-brand-900/40' : ''}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}


function IdeaCard({
  idea, expanded, onToggle, onEstado, onRemove,
  editandoNotas, onEditNotas, notasDraft, setNotasDraft, onSaveNotas, onCancelNotas,
  editandoGuion, onEditGuion, guionDraft, setGuionDraft, onSaveGuion, onCancelGuion,
  isSelected, onToggleSelect, onFetchPerformance, addToast,
}) {
  const tipo = TIPO_META[idea.tipo] || TIPO_META.desde_cero;
  const estado = ESTADO_META[idea.estado] || ESTADO_META.pendiente;
  const usada = idea.estado === 'usada' || idea.estado === 'archivada';

  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-xl overflow-hidden shadow-sm transition ${
      isSelected
        ? 'border-brand-400 dark:border-brand-600 ring-2 ring-brand-200 dark:ring-brand-900/40'
        : usada
          ? 'border-gray-200 dark:border-gray-700 opacity-70'
          : 'border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700'
    }`}>
      {/* Header siempre visible */}
      <div className="px-4 py-3 flex items-start gap-3">
        {/* Checkbox para multi-select export */}
        <button onClick={onToggleSelect}
          className="mt-1 shrink-0 text-gray-400 hover:text-brand-600 transition"
          title={isSelected ? 'Deseleccionar' : 'Seleccionar para exportar'}>
          {isSelected ? <CheckSquare size={16} className="text-brand-600" /> : <Square size={16} />}
        </button>

        {/* Thumbnail */}
        {idea.origen?.imageUrl ? (
          <img src={idea.origen.imageUrl} alt=""
            className="w-14 h-14 rounded-lg object-cover bg-gray-100 dark:bg-gray-700 shrink-0 border border-gray-200 dark:border-gray-700"
            onError={e => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-brand-200 to-brand-300 dark:from-brand-900/40 dark:to-brand-800/40 flex items-center justify-center shrink-0">
            <span className="text-2xl">{tipo.emoji}</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border ${tipo.color}`}>
              {tipo.emoji} {tipo.label}
            </span>
            <span className={`text-[10px] font-semibold ${estado.color}`}>
              {estado.icon} {estado.label}
            </span>
            {idea.origen?.competidorNombre && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                · de {idea.origen.competidorNombre}
                {idea.origen.daysRunning ? ` · ${idea.origen.daysRunning}d corriendo` : ''}
              </span>
            )}
            {idea.tipo === 'iteracion' && idea.origen?.adNombre && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                · itera: <span className="font-semibold text-gray-700 dark:text-gray-300">{idea.origen.adNombre}</span>
              </span>
            )}
            {idea.anguloCategoria && ANGULO_META[idea.anguloCategoria] && (
              <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded ${ANGULO_META[idea.anguloCategoria].color}`}
                title={`Ángulo estratégico ${idea.anguloCategoria}: ${ANGULO_META[idea.anguloCategoria].label}`}>
                {ANGULO_META[idea.anguloCategoria].emoji} {idea.anguloCategoria}
              </span>
            )}
            {idea.tipoCampaña && CAMPAÑA_META[idea.tipoCampaña] && (
              <span className={`inline-flex items-center text-[9px] font-semibold ${CAMPAÑA_META[idea.tipoCampaña].color}`}
                title={CAMPAÑA_META[idea.tipoCampaña].label}>
                {CAMPAÑA_META[idea.tipoCampaña].emoji} {idea.tipoCampaña}
              </span>
            )}
            {idea.variableDeTesteo && VARIABLE_META[idea.variableDeTesteo] && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded"
                title={`Variable a testear: ${VARIABLE_META[idea.variableDeTesteo].descripcion}`}>
                {VARIABLE_META[idea.variableDeTesteo].emoji} testea: {VARIABLE_META[idea.variableDeTesteo].label}
              </span>
            )}
            {idea.metaRiesgo?.tieneRiesgo && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded"
                title={`Palabras gatillo de Meta: ${(idea.metaRiesgo.palabras || []).join(', ')}${idea.metaRiesgo.sugerencia ? ' · ' + idea.metaRiesgo.sugerencia : ''}`}>
                ⚠ Meta
              </span>
            )}
            {idea.hookDuplicado && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded"
                title="Este hook arranca igual que otra idea — considerá reescribirlo para diversificar arquetipos">
                ⚠ hook similar
              </span>
            )}
            {/* Score del hook (1-10) — Haiku puntúa cada hook después de
                generarlo. Las <6 quedan marcadas como flojas: el user las
                puede archivar de un click. Las >=8 son las "fuertes". */}
            {typeof idea.scoreValue === 'number' && (
              <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded ${
                idea.lowScore
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                  : idea.scoreValue >= 8
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
                title={idea.scoreReason ? `Score ${idea.scoreValue}/10 — ${idea.scoreReason}` : `Score ${idea.scoreValue}/10`}>
                {idea.lowScore ? '🟥' : idea.scoreValue >= 8 ? '🟩' : '⬜'} {idea.scoreValue}/10
              </span>
            )}
            {/* Creencia apalancada — qué creencia del prospect instala/derriba
                esta pieza. Útil para chequear que la bandeja cubra todas las
                creencias sin sobre-representar una sola. */}
            {idea.creenciaApalancada && (
              <span className="inline-flex items-center max-w-[260px] truncate px-1.5 py-0.5 text-[9px] font-semibold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded"
                title={`Creencia que apalanca: ${idea.creenciaApalancada}`}>
                💭 {idea.creenciaApalancada}
              </span>
            )}
            {idea.formato && (
              <span className="text-[10px] text-gray-400 ml-auto">
                {idea.formato === 'video' ? '🎬' : idea.formato === 'static' ? '🖼️' : '📑'} {idea.formato}
              </span>
            )}
          </div>

          {idea.hook ? (
            <>
              <p className={`text-sm font-bold leading-snug ${usada ? 'text-gray-500 dark:text-gray-400 line-through' : 'text-gray-900 dark:text-gray-100'}`}>
                "{idea.hook}"
              </p>
              {idea.titulo && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 uppercase tracking-wider">
                  Concepto: {idea.titulo}
                </p>
              )}
            </>
          ) : (
            <p className={`text-sm font-semibold ${usada ? 'text-gray-500 dark:text-gray-400 line-through' : 'text-gray-900 dark:text-gray-100'}`}>
              {idea.titulo}
            </p>
          )}
          {idea.angulo && !expanded && (
            <p className="text-[11px] text-gray-600 dark:text-gray-400 line-clamp-2 mt-0.5">
              {idea.angulo}
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <button onClick={onToggle}
            className="p-1.5 text-gray-500 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded transition"
            title={expanded ? 'Cerrar' : 'Ver detalle'}>
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Detalle expandido — 2 columnas: izquierda = output creativo, derecha = estrategia + contexto */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-4 py-3">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* COLUMNA IZQUIERDA — output creativo (3/5 del espacio) */}
            <div className="lg:col-span-3 space-y-3">
              {idea.hook && (
                <Field label="🎯 Hook" text={idea.hook} highlight />
              )}

              {/* Para video → brief con guion para mandar a producción.
                  Para imagen/carrusel → IdeaImageGenerator (gpt-image-2 +
                  cloud save automático). Antes acá también se renderizaba
                  CreativoPanel (legacy IDB-only) — duplicaba la UI con dos
                  paneles de generación stackeados. Eliminado para que el
                  user vea un solo generador. */}
              {idea.formato === 'video' ? (
                <VideoBriefPanel key={idea.id} idea={idea} />
              ) : (idea.hook || idea.descripcionImagen) ? (
                <IdeaImageGenerator idea={idea} addToast={addToast} />
              ) : null}

              {(() => { const guionTextoIdea = guionToText(idea.guion); return (guionTextoIdea || editandoGuion) && !/^n\/?a/i.test(guionTextoIdea.trim()) && (
                <div className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between px-3 py-2">
                    <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                      🎬 Guión {idea.formato === 'video' ? '(porteño)' : '(porteño)'}
                    </p>
                    {!editandoGuion && onEditGuion && (
                      <button onClick={onEditGuion}
                        className="inline-flex items-center gap-1 text-[10px] text-brand-600 hover:text-brand-700 transition">
                        <Edit3 size={10} /> Editar
                      </button>
                    )}
                  </div>
                  {editandoGuion ? (
                    <div className="px-3 pb-3 space-y-1.5">
                      <textarea value={guionDraft} onChange={e => setGuionDraft(e.target.value)}
                        rows={8}
                        placeholder="Guión en porteño — editá beats, VO, acotaciones visuales…"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-brand-500" />
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={onCancelGuion}
                          className="px-2.5 py-1 text-[10px] font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 transition">
                          Cancelar
                        </button>
                        <button onClick={onSaveGuion}
                          className="px-2.5 py-1 text-[10px] font-bold text-white bg-brand-600 rounded hover:bg-brand-700 transition">
                          Guardar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="px-3 pb-3 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{guionTextoIdea}</p>
                  )}
                </div>
              ); })()}
            </div>

            {/* COLUMNA DERECHA — contexto estratégico + metadata (2/5 del espacio) */}
            <div className="lg:col-span-2 space-y-3">
              {/* Visible siempre: ángulo + pain point (los dos datos
                  estratégicos clave) + riesgo Meta si aplica. */}
              {idea.angulo && <Field label="📐 Ángulo" text={idea.angulo} />}
              {idea.painPoint && <Field label="💥 Pain point" text={idea.painPoint} />}

              {idea.metaRiesgo?.tieneRiesgo && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                  <p className="text-[10px] font-bold text-red-800 dark:text-red-300 uppercase tracking-wider mb-1">
                    ⚠ Riesgo Meta
                  </p>
                  {idea.metaRiesgo.palabras?.length > 0 && (
                    <p className="text-[10px] text-red-700 dark:text-red-400 mb-1">
                      Palabras: <strong>{idea.metaRiesgo.palabras.join(', ')}</strong>
                    </p>
                  )}
                  {idea.metaRiesgo.sugerencia && (
                    <p className="text-xs text-red-900 dark:text-red-200">{idea.metaRiesgo.sugerencia}</p>
                  )}
                </div>
              )}

              {/* Detalles estratégicos colapsados — agrupa todo el contexto
                  secundario (escenario, razonamiento, hipótesis, estilo,
                  público) en UN solo bloque expandible. Antes esto eran 5
                  cards sueltas que saturaban el ticket. */}
              {(idea.origen?.razonamiento || idea.origen?.razonIteracion || idea.escenarioNarrativo || idea.testHipotesis || idea.estiloVisual || idea.publicoSugerido) && (
                <details className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
                  <summary className="cursor-pointer px-3 py-2 text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-gray-700/30 rounded-md">
                    💭 Detalles estratégicos
                  </summary>
                  <div className="px-3 pb-3 pt-1 space-y-2.5">
                    {idea.tipo === 'iteracion' && idea.origen?.razonIteracion && (
                      <div>
                        <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-0.5">🔄 Por qué iterar</p>
                        <p className="text-[11px] text-gray-700 dark:text-gray-300">
                          <span className="font-semibold">Ad base:</span> {idea.origen.adNombre || '(sin nombre)'}
                        </p>
                        <p className="text-[11px] text-gray-700 dark:text-gray-300 mt-0.5">{idea.origen.razonIteracion}</p>
                      </div>
                    )}
                    {idea.tipo !== 'iteracion' && idea.origen?.razonamiento && (
                      <div>
                        <p className="text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase tracking-wider mb-0.5">💡 Por qué esta idea</p>
                        <p className="text-[11px] text-gray-700 dark:text-gray-300">{idea.origen.razonamiento}</p>
                      </div>
                    )}
                    {idea.escenarioNarrativo && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-0.5">📖 Escenario narrativo</p>
                        <p className="text-[11px] text-gray-700 dark:text-gray-300">{idea.escenarioNarrativo}</p>
                      </div>
                    )}
                    {idea.testHipotesis && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-0.5">🔬 Hipótesis a validar</p>
                        {VARIABLE_META[idea.variableDeTesteo] && (
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                            Variable: <strong>{VARIABLE_META[idea.variableDeTesteo].emoji} {VARIABLE_META[idea.variableDeTesteo].label}</strong>
                          </p>
                        )}
                        <p className="text-[11px] text-gray-700 dark:text-gray-300">{idea.testHipotesis}</p>
                      </div>
                    )}
                    {idea.estiloVisual && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-0.5">🎨 Estilo visual</p>
                        <p className="text-[11px] text-gray-700 dark:text-gray-300">{idea.estiloVisual}</p>
                      </div>
                    )}
                    {idea.publicoSugerido && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-0.5">🎯 Público sugerido</p>
                        <p className="text-[11px] text-gray-700 dark:text-gray-300">{idea.publicoSugerido}</p>
                      </div>
                    )}
                  </div>
                </details>
              )}

              {idea.launchedAsAdId && (
                <div className="p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-md">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-bold text-brand-800 dark:text-brand-300 uppercase tracking-wider">
                      🚀 Performance
                    </p>
                    <button onClick={onFetchPerformance}
                      className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1">
                      <Download size={10} /> Métricas
                    </button>
                  </div>
                  <p className="text-[10px] text-brand-700 dark:text-brand-400 mb-1 font-mono truncate">
                    Ad: {idea.launchedAsAdName || idea.launchedAsAdId}
                  </p>
                  {idea.performance ? (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <PerformanceStat label="CTR" val={idea.performance.recent?.ctr} fmt={v => `${v.toFixed(2)}%`} />
                      <PerformanceStat label="ROAS" val={idea.performance.recent?.roas} fmt={v => v.toFixed(2)}
                        semaforo={v => v >= 2 ? 'good' : v >= 1 ? 'mid' : 'bad'} />
                      <PerformanceStat label="CPA" val={idea.performance.recent?.cpa} fmt={v => `$${v.toFixed(2)}`} />
                      <PerformanceStat label="Thumb-stop" val={idea.performance.recent?.thumbStopRate} fmt={v => `${v.toFixed(1)}%`} />
                      <PerformanceStat label="Impressions" val={idea.performance.recent?.impressions} fmt={v => v.toLocaleString('es-AR')} />
                      <PerformanceStat label="Compras" val={idea.performance.recent?.purchases} fmt={v => v.toLocaleString('es-AR')} />
                    </div>
                  ) : (
                    <p className="text-[10px] text-brand-700 dark:text-brand-300 italic">
                      Click "Métricas" para ver cómo rinde.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sección inferior full-width: notas + acciones */}
          <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3">

          {/* Notas */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">📓 Notas</p>
              {!editandoNotas && (
                <button onClick={onEditNotas}
                  className="inline-flex items-center gap-1 text-[10px] text-brand-600 hover:text-brand-700 transition">
                  <Edit3 size={10} /> Editar
                </button>
              )}
            </div>
            {editandoNotas ? (
              <div className="space-y-1.5">
                <textarea value={notasDraft} onChange={e => setNotasDraft(e.target.value)}
                  rows={3} placeholder="Quién la va a producir, fecha, brief, etc."
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-brand-500" />
                <div className="flex gap-1.5 justify-end">
                  <button onClick={onCancelNotas}
                    className="px-2.5 py-1 text-[10px] font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 transition">
                    Cancelar
                  </button>
                  <button onClick={onSaveNotas}
                    className="px-2.5 py-1 text-[10px] font-bold text-white bg-brand-600 rounded hover:bg-brand-700 transition">
                    Guardar
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
                {idea.notas || <span className="italic text-gray-400">Sin notas todavía.</span>}
              </p>
            )}
          </div>

          {/* Acciones — estado + links */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-200 dark:border-gray-700">
            <EstadoButton active={idea.estado === 'pendiente'} onClick={() => onEstado('pendiente')} icon={<Circle size={10} />} label="Pendiente" />
            <EstadoButton active={idea.estado === 'en_uso'} onClick={() => onEstado('en_uso')} icon={<CircleDot size={10} />} label="En uso" color="amber" />
            <EstadoButton active={idea.estado === 'usada'} onClick={() => onEstado('usada')} icon={<Check size={10} />} label="Usada" color="emerald" />
            <EstadoButton active={idea.estado === 'archivada'} onClick={() => onEstado('archivada')} icon={<Archive size={10} />} label="Archivar" />

            <div className="ml-auto flex items-center gap-2">
              {idea.origen?.adSnapshotUrl && (
                <a href={idea.origen.adSnapshotUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-brand-600 hover:underline">
                  <ExternalLink size={10} /> Ver ad original
                </a>
              )}
              <button onClick={onRemove}
                className="p-1 text-gray-400 hover:text-red-600 transition" title="Borrar idea">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}


function Field({ label, text, highlight = false }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xs leading-relaxed ${
        highlight
          ? 'bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-md px-3 py-2 text-brand-900 dark:text-brand-200'
          : 'text-gray-700 dark:text-gray-300'
      }`}>{text}</p>
    </div>
  );
}


function PerformanceStat({ label, val, fmt, semaforo }) {
  const v = Number(val);
  if (val == null || isNaN(v)) {
    return (
      <div className="text-[10px]">
        <p className="text-brand-600 dark:text-brand-400 font-semibold">{label}</p>
        <p className="text-gray-400 font-mono">—</p>
      </div>
    );
  }
  const tone = semaforo ? semaforo(v) : null;
  const toneClass = tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' :
                    tone === 'mid' ? 'text-amber-600 dark:text-amber-400' :
                    tone === 'bad' ? 'text-red-600 dark:text-red-400' :
                    'text-brand-900 dark:text-brand-200';
  return (
    <div className="text-[10px]">
      <p className="text-brand-600 dark:text-brand-400 font-semibold">{label}</p>
      <p className={`font-mono font-bold ${toneClass}`}>{fmt(v)}</p>
    </div>
  );
}


function EstadoButton({ active, onClick, icon, label, color }) {
  const colors = {
    amber: active ? 'bg-amber-500 text-white' : 'bg-white dark:bg-gray-700 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
    emerald: active ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-gray-700 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
    default: active ? 'bg-gray-700 dark:bg-gray-200 text-white dark:text-gray-900' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600',
  };
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded transition ${colors[color || 'default']} hover:opacity-90`}>
      {icon} {label}
    </button>
  );
}

// Vista inicial de Bandeja: grid de productos para elegir uno.
// Cada card muestra contadores por estado + total. Al final, si hay ideas
// sin productoId (legacy, de antes del multi-producto), se muestra un bucket
// "Sin producto asignado" para no perderlas de vista.

function ProductoSelectorView({ productos, ideas, onSelect }) {
  // Contamos ideas por producto + un bucket "sin producto" para legacy.
  const countsByProducto = new Map();
  const countsSin = { pendiente: 0, en_uso: 0, usada: 0, archivada: 0, total: 0 };
  for (const i of ideas) {
    const key = i.productoId ? String(i.productoId) : SIN_PRODUCTO_ID;
    if (key === SIN_PRODUCTO_ID) {
      countsSin[i.estado] = (countsSin[i.estado] || 0) + 1;
      countsSin.total++;
      continue;
    }
    if (!countsByProducto.has(key)) {
      countsByProducto.set(key, { pendiente: 0, en_uso: 0, usada: 0, archivada: 0, total: 0 });
    }
    const c = countsByProducto.get(key);
    c[i.estado] = (c[i.estado] || 0) + 1;
    c.total++;
  }

  const tieneAlgo = productos.length > 0 || countsSin.total > 0;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shadow-sm">
          <Inbox size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Bandeja de ideas</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Elegí un producto para ver su bandeja — cada uno es independiente.</p>
        </div>
      </div>

      {!tieneAlgo ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
          <Package size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin productos ni ideas todavía</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Andá a "Arranque", creá un producto y corré el pipeline — las ideas van a aparecer acá agrupadas por producto.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {productos.map(p => {
            const c = countsByProducto.get(String(p.id)) || { pendiente: 0, en_uso: 0, usada: 0, archivada: 0, total: 0 };
            return (
              <ProductoBandejaCard
                key={p.id}
                producto={p}
                counts={c}
                onClick={() => onSelect(String(p.id))}
              />
            );
          })}
          {countsSin.total > 0 && (
            <ProductoBandejaCard
              producto={{ id: SIN_PRODUCTO_ID, nombre: 'Sin producto asignado', legacy: true }}
              counts={countsSin}
              onClick={() => onSelect(SIN_PRODUCTO_ID)}
            />
          )}
        </div>
      )}
    </div>
  );
}


function ProductoBandejaCard({ producto, counts, onClick }) {
  const { pendiente = 0, en_uso = 0, usada = 0, archivada = 0, total } = counts;
  const inicial = producto.nombre?.charAt(0)?.toUpperCase() || '?';
  return (
    <button
      onClick={onClick}
      className="text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-md transition group"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition ${
          producto.legacy
            ? 'bg-gradient-to-br from-gray-400 to-gray-500'
            : 'bg-gradient-to-br from-brand-500 to-brand-600'
        }`}>
          {producto.legacy ? '?' : inicial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{producto.nombre}</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            {total} idea{total !== 1 ? 's' : ''} total{total !== 1 ? 'es' : ''}
          </p>
        </div>
        <ChevronRight size={16} className="text-gray-400 group-hover:text-brand-500 transition shrink-0" />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <MiniStat label="Pendientes" value={pendiente} accent />
        <MiniStat label="En uso" value={en_uso} color="amber" />
        <MiniStat label="Usadas" value={usada} color="emerald" />
        <MiniStat label="Archivadas" value={archivada} color="gray" />
      </div>
    </button>
  );
}


function MiniStat({ label, value, color = 'gray', accent = false }) {
  const colors = {
    gray: 'bg-gray-50 dark:bg-gray-900/40 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700',
    amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
  };
  return (
    <div className={`px-2 py-1.5 rounded-md border ${colors[color]} ${accent ? 'ring-1 ring-brand-300 dark:ring-brand-700' : ''}`}>
      <p className="text-[9px] font-bold uppercase tracking-wider opacity-60 leading-none">{label}</p>
      <p className="text-base font-bold tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

// Columna del kanban — header con color + count, cuerpo scrolleable con cards.
// Actúa como drop target: al soltar una card encima, llama onDropIdea con el id
// de la idea, que la mueve a este estado.

function KanbanColumn({ estado, titulo, color, accent = false, isCustom = false, ideas, selected, onToggleSelect, onCardClick, onDropIdea, onRename, onDelete }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const palette = {
    gray: {
      header: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-700',
      body: 'bg-gray-50/50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700',
      dragOver: 'ring-2 ring-gray-400 dark:ring-gray-500',
    },
    amber: {
      header: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-800',
      body: 'bg-amber-50/30 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/50',
      dragOver: 'ring-2 ring-amber-400 dark:ring-amber-500',
    },
    emerald: {
      header: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800',
      body: 'bg-emerald-50/30 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/50',
      dragOver: 'ring-2 ring-emerald-400 dark:ring-emerald-500',
    },
    slate: {
      header: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700',
      body: 'bg-slate-50/30 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800',
      dragOver: 'ring-2 ring-slate-400 dark:ring-slate-500',
    },
    violet: {
      header: 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-800',
      body: 'bg-brand-50/30 dark:bg-brand-900/10 border-brand-200 dark:border-brand-900/50',
      dragOver: 'ring-2 ring-brand-400 dark:ring-brand-500',
    },
    rose: {
      header: 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-800',
      body: 'bg-brand-50/30 dark:bg-brand-900/10 border-brand-200 dark:border-brand-900/50',
      dragOver: 'ring-2 ring-brand-400 dark:ring-brand-500',
    },
    sky: {
      header: 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-800',
      body: 'bg-brand-50/30 dark:bg-brand-900/10 border-brand-200 dark:border-brand-900/50',
      dragOver: 'ring-2 ring-brand-400 dark:ring-brand-500',
    },
    lime: {
      header: 'bg-lime-100 dark:bg-lime-900/40 text-lime-800 dark:text-lime-200 border-lime-300 dark:border-lime-800',
      body: 'bg-lime-50/30 dark:bg-lime-900/10 border-lime-200 dark:border-lime-900/50',
      dragOver: 'ring-2 ring-lime-400 dark:ring-lime-500',
    },
    orange: {
      header: 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-800',
      body: 'bg-brand-50/30 dark:bg-brand-900/10 border-brand-200 dark:border-brand-900/50',
      dragOver: 'ring-2 ring-brand-400 dark:ring-brand-500',
    },
    teal: {
      header: 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-800',
      body: 'bg-brand-50/30 dark:bg-brand-900/10 border-brand-200 dark:border-brand-900/50',
      dragOver: 'ring-2 ring-brand-400 dark:ring-brand-500',
    },
    indigo: {
      header: 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-800',
      body: 'bg-brand-50/30 dark:bg-brand-900/10 border-brand-200 dark:border-brand-900/50',
      dragOver: 'ring-2 ring-brand-400 dark:ring-brand-500',
    },
    pink: {
      header: 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-800',
      body: 'bg-brand-50/30 dark:bg-brand-900/10 border-brand-200 dark:border-brand-900/50',
      dragOver: 'ring-2 ring-brand-400 dark:ring-brand-500',
    },
  };
  const c = palette[color] || palette.gray;

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  };
  const handleDragLeave = (e) => {
    // Evitar flickers cuando el cursor pasa sobre hijos — solo des-highlight si
    // salió del contenedor realmente.
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const ideaId = e.dataTransfer.getData('text/idea-id');
    const fromEstado = e.dataTransfer.getData('text/idea-estado');
    if (!ideaId || fromEstado === estado) return;
    onDropIdea?.(ideaId);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`rounded-xl border flex flex-col transition ${c.body} ${accent ? 'ring-2 ring-brand-200 dark:ring-brand-900/40' : ''} ${isDragOver ? c.dragOver : ''}`}
    >
      <div className={`px-3 py-2 border-b flex items-center justify-between gap-1 ${c.header} rounded-t-xl`}>
        <p className="text-[11px] font-bold uppercase tracking-wider truncate">{titulo}</p>
        <div className="flex items-center gap-1 shrink-0">
          {onRename && (
            <button onClick={onRename} className="p-0.5 opacity-60 hover:opacity-100 hover:text-brand-600 transition" title="Renombrar">
              <Pencil size={11} />
            </button>
          )}
          {isCustom && onDelete && (
            <button onClick={onDelete} className="p-0.5 opacity-60 hover:opacity-100 hover:text-red-600 transition" title="Eliminar columna">
              <Trash2 size={11} />
            </button>
          )}
          <span className="text-xs font-bold tabular-nums">{ideas.length}</span>
        </div>
      </div>
      <div className="p-2 space-y-2 min-h-[120px] max-h-[70vh] overflow-y-auto">
        {ideas.length === 0 ? (
          <p className={`text-[10px] italic text-center py-6 transition ${
            isDragOver ? 'text-gray-700 dark:text-gray-300 font-semibold' : 'text-gray-400 dark:text-gray-600'
          }`}>
            {isDragOver ? 'Soltá acá' : 'Sin ideas'}
          </p>
        ) : (
          ideas.map(idea => (
            <KanbanCard
              key={idea.id}
              idea={idea}
              isSelected={selected?.has(idea.id)}
             
              onToggleSelect={onToggleSelect ? () => onToggleSelect(idea.id) : null}
              onClick={() => onCardClick(idea.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Etiquetas de formato para las cards del kanban.
const FORMATO_META = {
  video:    { emoji: '🎬', label: 'Video' },
  static:   { emoji: '🖼️', label: 'Imagen' },
  carrusel: { emoji: '📑', label: 'Carrusel' },
  mixto:    { emoji: '🎞️', label: 'Mixto' },
};

// Fecha corta y legible para las cards (ej: "22 may"; agrega el año si la
// idea es de otro año distinto al actual).

function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = '2-digit';
  return d.toLocaleDateString('es-AR', opts);
}

// Card del kanban — pensada para leerse de un vistazo SIN abrir el ticket:
// hook grande, tipo + formato + score etiquetados, ángulo, creencia, origen,
// fecha de creación y si la pieza/guión ya están producidos. El detalle
// completo se ve al clickear (abre el modal). Arrastrable entre columnas.

function KanbanCard({ idea, isSelected = false, onToggleSelect, onClick }) {
  const tipo = TIPO_META[idea.tipo] || TIPO_META.desde_cero;
  const angulo = idea.anguloCategoria ? ANGULO_META[idea.anguloCategoria] : null;
  const fmt = FORMATO_META[idea.formato] || null;
  const esVideo = idea.formato === 'video';
  // "Pieza lista" = el output final ya producido. Para video es el guión
  // adaptado. Las imágenes las produce un diseñador externo, no las
  // marcamos como "listas" desde la app.
  const piezaLista = esVideo && !!idea.guionAdaptado;
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/idea-id', idea.id);
    e.dataTransfer.setData('text/idea-estado', idea.estado || '');
    setIsDragging(true);
  };
  const handleDragEnd = () => setIsDragging(false);
  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    onToggleSelect?.();
  };

  // Origen — de dónde salió la idea. Réplica = competidor; iteración = ad
  // propio; el resto = generada por IA.
  let origenIcon = '✨', origenText = 'Generada por IA';
  if (idea.origen?.tipo === 'competidor' && idea.origen?.competidorNombre) {
    origenIcon = '🏢';
    origenText = idea.origen.competidorNombre;
  } else if (idea.tipo === 'iteracion' && idea.origen?.adNombre) {
    origenIcon = '🔁';
    origenText = `itera: ${idea.origen.adNombre}`;
  }

  const tieneScore = typeof idea.scoreValue === 'number';

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`relative bg-white dark:bg-gray-800 border rounded-lg p-2.5 hover:shadow-md transition group cursor-grab active:cursor-grabbing ${
        isSelected
          ? 'border-brand-400 dark:border-brand-600 ring-2 ring-brand-200 dark:ring-brand-900/40'
          : 'border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      {onToggleSelect && (
        <button
          onClick={handleCheckboxClick}
          className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-brand-500 transition opacity-0 group-hover:opacity-100 data-[checked=true]:opacity-100 z-10"
          data-checked={isSelected}
          title={isSelected ? 'Deseleccionar' : 'Seleccionar para exportar'}
        >
          {isSelected ? <CheckSquare size={12} className="text-brand-600" /> : <Square size={12} className="text-gray-400" />}
        </button>
      )}

      {/* Fila 1: badges de clasificación (tipo · formato · score) */}
      <div className="flex items-center gap-1 flex-wrap pr-6">
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded border ${tipo.color}`}>
          {tipo.emoji} {tipo.label}
        </span>
        {fmt && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            {fmt.emoji} {fmt.label}
          </span>
        )}
        {tieneScore && (
          <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded ${
            idea.lowScore
              ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
              : idea.scoreValue >= 8
                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
          }`}
            title={idea.scoreReason ? `Score del hook ${idea.scoreValue}/10 — ${idea.scoreReason}` : `Score del hook ${idea.scoreValue}/10`}>
            ★ {idea.scoreValue}/10
          </span>
        )}
      </div>

      {/* Fila 2: thumbnail + hook (lo principal, legible de un vistazo) */}
      <div className="flex items-start gap-2.5 mt-2">
        {idea.origen?.imageUrl ? (
          <img
            src={idea.origen.imageUrl} alt=""
            className="w-12 h-12 rounded-md object-cover bg-gray-100 dark:bg-gray-700 shrink-0 border border-gray-200 dark:border-gray-700"
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-12 h-12 rounded-md bg-gradient-to-br from-brand-200 to-brand-300 dark:from-brand-900/40 dark:to-brand-800/40 flex items-center justify-center shrink-0">
            <span className="text-xl">{tipo.emoji}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-gray-900 dark:text-gray-100 leading-snug line-clamp-3">
            {idea.hook ? `“${idea.hook}”` : (idea.titulo || 'Sin hook')}
          </p>
          {idea.hook && idea.titulo && (
            <p className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mt-1 truncate">
              {idea.titulo}
            </p>
          )}
        </div>
      </div>

      {/* Fila 3: badges secundarios (ángulo · creencia · alertas) */}
      {(angulo || idea.creenciaApalancada || idea.metaRiesgo?.tieneRiesgo || idea.hookDuplicado) && (
        <div className="flex items-center gap-1 flex-wrap mt-2">
          {angulo && (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded ${angulo.color}`}
              title={`Ángulo estratégico ${idea.anguloCategoria}: ${angulo.label}`}>
              {angulo.emoji} {angulo.label}
            </span>
          )}
          {idea.creenciaApalancada && (
            <span className="inline-flex items-center max-w-[180px] truncate px-1.5 py-0.5 text-[9px] font-semibold rounded bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300"
              title={`Creencia que apalanca: ${idea.creenciaApalancada}`}>
              💭 {idea.creenciaApalancada}
            </span>
          )}
          {idea.metaRiesgo?.tieneRiesgo && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
              title={`Palabras gatillo de Meta: ${(idea.metaRiesgo.palabras || []).join(', ')}`}>
              ⚠ Meta
            </span>
          )}
          {idea.hookDuplicado && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
              title="Este hook arranca igual que otra idea — considerá reescribirlo">
              ⚠ hook similar
            </span>
          )}
        </div>
      )}

      {/* Fila 4: footer — origen · fecha · estado de producción */}
      <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-gray-100 dark:border-gray-700/60">
        <span className="text-[9px] text-gray-500 dark:text-gray-400 truncate min-w-0" title={origenText}>
          {origenIcon} {origenText}
          {idea.origen?.daysRunning ? ` · ${idea.origen.daysRunning}d` : ''}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {piezaLista && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm"
              title={esVideo ? 'Guión de video ya generado' : 'Creativo ya producido — abrí la idea para verlo'}>
              {esVideo ? '🎬' : '🎨'} {esVideo ? 'Guión' : 'Creativo'}
            </span>
          )}
          <span className="text-[9px] text-gray-400 dark:text-gray-500 whitespace-nowrap" title={`Creada el ${idea.createdAt ? new Date(idea.createdAt).toLocaleString('es-AR') : '—'}`}>
            📅 {fechaCorta(idea.createdAt)}
          </span>
        </span>
      </div>
    </div>
  );
}

// Modal simple que muestra el detalle completo de una idea.
// En Parte 2b.4 se pule: tabs, mejor layout, keyboard shortcuts.
// Por ahora reutiliza el IdeaCard expandido envuelto en un overlay.

function IdeaDetailModal({ idea, onClose, ...cardProps }) {
  // Cerrar con ESC.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 bg-black/50 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 w-8 h-8 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 shadow-md flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-red-600 transition"
          title="Cerrar (ESC)"
        >
          ✕
        </button>
        <IdeaCard
          idea={idea}
          expanded={true}
          onToggle={onClose}
          {...cardProps}
        />
      </div>
    </div>
  );
}

// Panel de las ideas tipo VIDEO. El video va a producción humana. Al abrir
// la idea, el guión adaptado al producto del user se genera SOLO (sin
// botón) — es texto corrido en rioplatense, listo para pasarle al editor.
// Genera imágenes directamente desde una idea de la Bandeja. Reusa el mismo
// pipeline de la galería (saveReferencial → mismo lightbox y tracking).
// El user puede elegir N variantes — la primera es interpretación literal del
// brief, las siguientes van divergiendo (medium → loose).

function IdeaImageGenerator({ idea, addToast }) {
  const promptEs = buildPromptGptImage2Es(idea);
  const [n, setN] = useState(2);
  // Default 1024x1024 — antes era 2048x2048 que regularmente time-outea
  // en Vercel a quality high (150-250s vs limit 300s). InspiracionSection
  // ya hace este mismo default; Bandeja se desincronizó.
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState('high');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [lastBatch, setLastBatch] = useState(null); // { count, t, durMs }

  const handleGenerar = async () => {
    setError('');
    const productos = loadProductos();
    const producto = productos.find(p => String(p.id) === String(idea.productoId));
    if (!producto) {
      setError('No encontré el producto de esta idea — recargá la página.');
      return;
    }
    const prodImg = await getProductoImagen(producto.id);
    if (!prodImg) {
      setError('Cargá la foto del producto en Setup (Arranque) antes de generar.');
      return;
    }
    const costoPorImg = quality === 'low' ? 0.03 : quality === 'medium' ? 0.07 : 0.18;
    const estimatedCost = n * costoPorImg;
    const execId = startExecution({
      label: `Generando ${n} imágenes desde idea`,
      sublabel: idea.hook || idea.titulo || idea.descripcionImagen?.slice(0, 60) || '',
      kind: 'creative-from-idea',
      estimatedMs: 90000,
      estimatedCost,
    });
    setRunning(true);
    const t0 = Date.now();
    try {
      updateExecution(execId, { stage: `Generando ${n} variante${n !== 1 ? 's' : ''}…` });
      // Auth token para background save server-side. Sin esto el endpoint
      // skipea el cloud save y si el user cierra la pestaña pierde el creativo.
      let authToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        authToken = session?.access_token || '';
      } catch {}
      const resp = await fetch('/api/marketing/crear-imagen-desde-idea', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          idea: {
            id: idea.id,
            hook: idea.hook,
            titulo: idea.titulo,
            angulo: idea.angulo,
            painPoint: idea.painPoint,
            escenarioNarrativo: idea.escenarioNarrativo,
            descripcionImagen: idea.descripcionImagen,
            estiloVisual: idea.estiloVisual,
            publicoSugerido: idea.publicoSugerido,
            creenciaApalancada: idea.creenciaApalancada,
            textoEnImagen: idea.textoEnImagen,
            formato: idea.formato,
          },
          producto: {
            id: producto.id,  // CRÍTICO — sin esto el cloud save skipea
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            research: producto.docs?.research,
            ofertasReales: producto.ofertasReales || '',
            offerBrief: producto.ofertasReales || producto.docs?.offerBrief || '',
          },
          productoImagen: prodImg,
          accentColor: getAccentColor(producto.id) || '',
          n, size, quality,
        }),
      });
      const data = await parseJsonOrThrow(resp, 'crear-imagen-desde-idea');
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const costo = logCostsFromResponse(data, `crear-imagen-desde-idea · ${idea.hook?.slice(0, 40) || 'idea'}`);

      // Si el backend ya guardó al cloud (cloudCreativos), solo refrescamos
      // la galería. Si no, fallback IDB local + toast warning.
      const ahora = Date.now();
      const imagenes = data.imagenes || [];
      const variantStyles = data.variantStyles || [];
      const prompts = data.prompts || [];
      const cloudOk = Array.isArray(data.cloudCreativos) && data.cloudCreativos.length > 0;

      if (cloudOk) {
        try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail: { productoId: String(producto.id), cloud: true } })); } catch {}
      } else {
        if (data.cloudSaveError) {
          console.warn('[crear-imagen-desde-idea] cloudSaveError:', data.cloudSaveError);
          addToast?.({
            type: 'warning',
            message: `Cloud save no funcionó (${data.cloudSaveError}). Guardando local — NO cierres la pestaña.`,
          });
        }
        for (let i = 0; i < imagenes.length; i++) {
          const promptUsed = prompts[i]?.prompt || data.prompts?.[i]?.prompt || '';
          await saveReferencial({
            id: `idea_${ahora}_${idea.id}_${i}`,
            productoId: String(producto.id),
            sourceType: 'bandeja-idea',
            sourceIdeaId: idea.id,
            sourceBrand: 'Idea propia',
            sourceHeadline: idea.hook || idea.titulo || '',
            variantIndex: i,
            variantStyle: variantStyles[i] || 'tight',
            imageBase64: imagenes[i],
            mimeType: data.mimeType || 'image/png',
            prompt: promptUsed,
            model: data.model,
            size: data.size,
            sizeFallback: !!data.sizeFallback,
            quality: data.quality || quality,
            createdAt: new Date(ahora + i).toISOString(),
          });
        }
      }
      const imageCount = cloudOk ? data.cloudCreativos.length : imagenes.length;
      const durMs = Date.now() - t0;
      setLastBatch({ count: imageCount, t: ahora, durMs });
      finishExecution(execId, {
        ok: true,
        message: `${imageCount} imagen${imageCount !== 1 ? 'es' : ''} en galería`,
        cost: costo?.total,
      });
    } catch (err) {
      setError(err.message || 'Error generando imagen');
      finishExecution(execId, { ok: false, message: err.message || 'Error' });
    } finally {
      setRunning(false);
    }
  };

  const costoPorImg = quality === 'low' ? 0.03 : quality === 'medium' ? 0.07 : 0.18;

  return (
    <div className="bg-brand-50 dark:bg-brand-900/20 rounded-md border border-brand-200 dark:border-brand-800">
      <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-brand-200 dark:border-brand-800">
        <p className="text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase tracking-wider mr-1">
          🤖 Generar imagen con gpt-image-2
        </p>
        {/* Selector compacto de N */}
        <div className="flex items-center gap-0.5">
          {[1, 2, 4, 6].map(opt => (
            <button key={opt}
              onClick={() => setN(opt)}
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition ${
                n === opt
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-gray-600 dark:bg-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >{opt}v</button>
          ))}
        </div>
        {/* Selector compacto de ratio */}
        <div className="flex items-center gap-0.5">
          {[
            { v: '2048x2048', label: '1:1' },
            { v: '1024x1536', label: 'Story' },
          ].map(opt => (
            <button key={opt.v}
              onClick={() => setSize(opt.v)}
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition ${
                size === opt.v
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-gray-600 dark:bg-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >{opt.label}</button>
          ))}
        </div>
        {/* Quality */}
        <div className="flex items-center gap-0.5">
          {['low', 'medium', 'high'].map(opt => (
            <button key={opt}
              onClick={() => setQuality(opt)}
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition uppercase ${
                quality === opt
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-gray-600 dark:bg-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
              title={`$${{ low: 0.03, medium: 0.07, high: 0.18 }[opt]} por imagen`}
            >{opt.charAt(0).toUpperCase()}</button>
          ))}
        </div>
        <span className="text-[9px] text-gray-500 dark:text-gray-400 ml-1 tabular-nums">
          ~${(n * costoPorImg).toFixed(2)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => navigator.clipboard?.writeText(promptEs)}
            className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline"
            title="Copiar prompt al portapapeles"
          >
            📋 Copiar
          </button>
          <button
            onClick={handleGenerar}
            disabled={running}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded hover:from-brand-700 hover:to-brand-600 transition disabled:opacity-50 shadow-sm"
          >
            {running
              ? <><Loader2 size={10} className="animate-spin" /> Generando…</>
              : <><Sparkles size={10} /> Generar</>
            }
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-[10px] font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-t border-red-200 dark:border-red-800">
          ⚠ {error}
        </div>
      )}

      {lastBatch && !error && (
        <div className="px-3 py-2 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-t border-emerald-200 dark:border-emerald-800">
          ✓ {lastBatch.count} imagen{lastBatch.count !== 1 ? 'es' : ''} en {Math.floor(lastBatch.durMs / 1000)}s — buscalas en la <strong>Galería</strong>.
        </div>
      )}

      <details className="border-t border-brand-200 dark:border-brand-800">
        <summary className="px-3 py-1.5 text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase tracking-wider cursor-pointer hover:bg-brand-100/40 dark:hover:bg-brand-900/30">
          Ver el prompt base que va a usar
        </summary>
        <pre className="px-3 pb-3 text-xs text-brand-900 dark:text-brand-200 whitespace-pre-wrap break-words font-sans">{promptEs}</pre>
      </details>
    </div>
  );
}


function VideoBriefPanel({ idea }) {
  const [guion, setGuion] = useState(guionToText(idea.guionAdaptado));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // mountedRef: evita setState sobre componente desmontado (la llamada
  // tarda 15-40s; si el user cambia de idea en el medio, el panel se
  // desmonta). autoGenRef: evita que el auto-generar dispare dos veces
  // (React StrictMode monta el efecto dos veces en dev).
  const mountedRef = useRef(true);
  const autoGenRef = useRef(false);

  const generar = async () => {
    const prod = loadProductos().find(p => String(p.id) === String(idea.productoId));
    if (!prod) {
      setError('No encontré el producto de esta idea — recargá la página.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/marketing/adapt-guion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: {
            titulo: idea.titulo,
            hook: idea.hook,
            angulo: idea.angulo,
            painPoint: idea.painPoint,
            copy: idea.copyPostMeta || idea.copy,
            guionReferencia: guionToText(idea.guion),
            formato: idea.formato,
          },
          producto: {
            nombre: prod.nombre,
            descripcion: prod.descripcion,
            research: prod.docs?.research || prod.research,
            avatar: prod.docs?.avatar || prod.avatar,
            stage: prod.stage,
          },
          competidorRef: idea.origen?.competidorNombre,
        }),
      });
      const data = await parseJsonOrThrow(resp, 'adapt-guion');
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      logCostsFromResponse(data, `adapt-guion · ${(idea.titulo || '').slice(0, 50)}`);
      // updateIdea persiste igual aunque el panel se haya desmontado — el
      // guión queda guardado en la idea. Solo el setState es condicional.
      // Si data.guion es vacío lo tratamos como error (sino re-disparaba
      // en cada reapertura porque el useEffect chequea !idea.guionAdaptado
      // que es true para empty string también).
      const guionTexto = data.guion || '';
      if (guionTexto) {
        updateIdea(idea.id, { guionAdaptado: guionTexto, guionAdaptadoError: false });
        if (mountedRef.current) setGuion(guionTexto);
      } else {
        updateIdea(idea.id, { guionAdaptadoError: true });
        if (mountedRef.current) setError('El servidor devolvió un guión vacío. Reintentá.');
      }
    } catch (err) {
      // Persistimos que falló — así reabrir la idea NO vuelve a auto-generar
      // (cada llamada a adapt-guion cuesta plata). El user puede reintentar
      // manualmente con el botón.
      updateIdea(idea.id, { guionAdaptadoError: true });
      if (mountedRef.current) setError(err.message || 'Error adaptando el guión');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  // Auto-generar al abrir la idea, si todavía no tiene guión adaptado NI
  // falló antes. Sin botón — el guión aparece solo. El componente se monta
  // con key={idea.id}, así que esto corre una vez por idea. Si una corrida
  // previa falló, NO re-dispara solo (evita cobrar en cada reapertura) —
  // queda el botón "Reintentar".
  useEffect(() => {
    mountedRef.current = true;
    if (!idea.guionAdaptado && !idea.guionAdaptadoError && !autoGenRef.current) {
      autoGenRef.current = true;
      generar();
    }
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copiar = () => {
    if (!guion) return;
    try {
      navigator.clipboard?.writeText(guion);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="bg-brand-50 dark:bg-brand-900/20 rounded-md border border-brand-200 dark:border-brand-800">
      <div className="px-3 py-2">
        <p className="text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase tracking-wider">
          🎬 Guión de video — para tus editores
        </p>
      </div>

      <div className="px-3 pb-3 space-y-2">
        {loading && !guion && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-brand-700 dark:text-brand-300">
            <Loader2 size={14} className="animate-spin" /> Generando el guión adaptado a tu producto…
          </div>
        )}

        {guion && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-brand-700 dark:text-brand-300">✓ Guión adaptado a tu marca</p>
            <div className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed bg-white dark:bg-gray-800/60 rounded-md px-3 py-2 border border-brand-100 dark:border-brand-900/40">
              {guion}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={copiar}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-white bg-brand-600 rounded hover:bg-brand-700 transition">
                {copied ? <Check size={11} /> : <Download size={11} />} {copied ? 'Copiado' : 'Copiar guión'}
              </button>
              <button onClick={generar} disabled={loading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 transition disabled:opacity-50">
                {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Regenerar
              </button>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-red-600 dark:text-red-400">⚠ {error}</p>
            <button onClick={generar}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 transition">
              <RefreshCw size={11} /> Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


export default function BandejaSection({ addToast, forcedProductoId, embedded = false }) {
  const [ideas, setIdeas] = useState(() => loadIdeas());
  const [productos, setProductos] = useState(() => loadProductos());
  const [activeProductoIdRaw, setActiveProductoIdRaw] = useState(() => {
    try { return localStorage.getItem(ACTIVE_PRODUCT_KEY) || null; } catch { return null; }
  });
  // Si viene forzado por el padre (embebida), siempre pisamos el state local.
  const activeProductoId = forcedProductoId != null ? forcedProductoId : activeProductoIdRaw;
  const setActiveProductoId = forcedProductoId != null
    ? () => { /* no-op cuando viene forzado */ }
    : setActiveProductoIdRaw;
  useEffect(() => {
    try {
      if (activeProductoId) localStorage.setItem(ACTIVE_PRODUCT_KEY, activeProductoId);
      else localStorage.removeItem(ACTIVE_PRODUCT_KEY);
    } catch {}
  }, [activeProductoId]);

  // Columnas custom del kanban por producto — Trello-like.
  // Las 4 columnas base (pendiente, en_uso, usada, archivada) siempre existen.
  // El user puede agregar columnas extra Y renombrar las base (persistidas).
  const customColsKey = activeProductoId ? `adslab-kanban-cols-${activeProductoId}` : null;
  const baseTitlesKey = activeProductoId ? `adslab-kanban-base-titles-${activeProductoId}` : null;
  const DEFAULT_BASE_TITLES = { pendiente: 'Pendientes', en_uso: 'En uso', usada: 'Usadas', archivada: 'Archivadas' };
  const [customColumns, setCustomColumns] = useState(() => {
    if (!customColsKey) return [];
    try { const r = localStorage.getItem(customColsKey); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  const [baseTitles, setBaseTitles] = useState(() => {
    if (!baseTitlesKey) return DEFAULT_BASE_TITLES;
    try { const r = localStorage.getItem(baseTitlesKey); return r ? { ...DEFAULT_BASE_TITLES, ...JSON.parse(r) } : DEFAULT_BASE_TITLES; } catch { return DEFAULT_BASE_TITLES; }
  });
  useEffect(() => {
    if (customColsKey) try { localStorage.setItem(customColsKey, JSON.stringify(customColumns)); } catch {}
  }, [customColumns, customColsKey]);
  useEffect(() => {
    if (baseTitlesKey) try { localStorage.setItem(baseTitlesKey, JSON.stringify(baseTitles)); } catch {}
  }, [baseTitles, baseTitlesKey]);
  // Reset both when switching product.
  useEffect(() => {
    if (!customColsKey) { setCustomColumns([]); setBaseTitles(DEFAULT_BASE_TITLES); return; }
    try { const r = localStorage.getItem(customColsKey); setCustomColumns(r ? JSON.parse(r) : []); } catch { setCustomColumns([]); }
    try { const r = localStorage.getItem(baseTitlesKey); setBaseTitles(r ? { ...DEFAULT_BASE_TITLES, ...JSON.parse(r) } : DEFAULT_BASE_TITLES); } catch { setBaseTitles(DEFAULT_BASE_TITLES); }
  }, [customColsKey, baseTitlesKey]);

  const renameBaseColumn = (key) => {
    const currentName = baseTitles[key] || DEFAULT_BASE_TITLES[key];
    const name = window.prompt(`Nuevo nombre para "${currentName}":`, currentName);
    if (!name?.trim()) return;
    setBaseTitles(prev => ({ ...prev, [key]: name.trim() }));
  };

  const addCustomColumn = () => {
    const name = window.prompt('Nombre de la nueva columna:');
    if (!name?.trim()) return;
    const COLORS = ['violet', 'rose', 'sky', 'lime', 'orange', 'teal', 'indigo', 'pink'];
    const color = COLORS[customColumns.length % COLORS.length];
    setCustomColumns(prev => [...prev, { id: `col-${Date.now()}`, name: name.trim(), color }]);
  };
  const renameCustomColumn = (colId) => {
    const col = customColumns.find(c => c.id === colId);
    if (!col) return;
    const name = window.prompt('Nuevo nombre:', col.name);
    if (!name?.trim()) return;
    setCustomColumns(prev => prev.map(c => c.id === colId ? { ...c, name: name.trim() } : c));
  };
  const removeCustomColumn = (colId) => {
    if (!window.confirm('¿Eliminar esta columna? Las ideas que estén en ella vuelven a "Pendientes".')) return;
    // Mover ideas de esa columna a pendiente.
    const affectedIds = ideas.filter(i => i.customColumnId === colId).map(i => i.id);
    for (const id of affectedIds) {
      updateIdea(id, { customColumnId: null, estado: 'pendiente' });
    }
    setCustomColumns(prev => prev.filter(c => c.id !== colId));
    setIdeas(loadIdeas());
  };
  const moveToCustomColumn = (ideaId, colId) => {
    const list = updateIdea(ideaId, { customColumnId: colId });
    setIdeas(list);
    addToast?.({ type: 'success', message: `Idea movida` });
  };
  const moveToBaseColumn = (ideaId, estado) => {
    const patch = { customColumnId: null, estado };
    if (estado === 'usada') {
      patch.usedAt = new Date().toISOString();
      // Antes acá había un window.prompt() pidiendo el ad ID — bloqueaba
      // el flow de drag (mobile no lo muestra, desktop molesta tras un
      // drag). Ahora el user lo puede agregar después en el detail modal.
    }
    const list = updateIdea(ideaId, patch);
    setIdeas(list);
    addToast?.({ type: 'success', message: `Idea → ${ESTADO_META[estado]?.label || estado}` });
  };
  const [expandedId, setExpandedId] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('all');
  const [filtroEstado, setFiltroEstado] = useState('active'); // 'all' | 'active' (pendiente + en_uso) | 'pendiente' | 'en_uso' | 'usada' | 'archivada'
  // Filtro por formato: 'all' | 'imagen' (static+carrusel) | 'video'.
  // Sirve para separar lo que producís vos (imagen) de lo que mandás a
  // producción de video.
  const [filtroFormato, setFiltroFormato] = useState('all');
  // Orden de las cards dentro de cada columna del kanban.
  const [orden, setOrden] = useState('recientes'); // recientes | antiguas | score | angulo
  const [query, setQuery] = useState('');
  // Set de ids de ideas que ya tienen un creativo producido (IndexedDB).
  const [editandoNotasId, setEditandoNotasId] = useState(null);
  const [notasDraft, setNotasDraft] = useState('');
  const [editandoGuionId, setEditandoGuionId] = useState(null);
  const [guionDraft, setGuionDraft] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  // Opciones de generación bulk — N variantes por idea + quality. El user
  // setea esto antes de apretar "Generar". Persisten entre selecciones.
  const [bulkN, setBulkN] = useState(2);
  const [bulkQuality, setBulkQuality] = useState('high');
  // Size fijo en 1024 para bulk — antes se mandaba undefined al endpoint
  // y dependía del default del server. Mejor explícito + acorde al límite
  // de 300s de Vercel.
  const bulkSize = '1024x1024';
  const [bulkRunning, setBulkRunning] = useState(false);

  // Re-sincronizar cuando otras secciones agregan o MODIFICAN ideas (event
  // storage no es ideal para same-tab — usamos un polling liviano cada 3s).
  // Comparamos un signature de id+estado+score+columna: si solo mirábamos
  // la longitud, los cambios de estado/score (ej. el scoring del pipeline
  // marcando lowScore) nunca se reflejaban hasta recargar.
  useEffect(() => {
    const sig = (list) => list.map(i => `${i.id}:${i.estado || ''}:${i.lowScore ? 1 : 0}:${i.scoreValue || ''}:${i.customColumnId || ''}`).join('|');
    const interval = setInterval(() => {
      const fresh = loadIdeas();
      setIdeas(prev => (sig(prev) !== sig(fresh) ? fresh : prev));
      const freshProds = loadProductos();
      setProductos(prev => (prev.length !== freshProds.length ? freshProds : prev));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const setEstado = (id, estado) => {
    const patch = { estado };
    if (estado === 'usada') {
      patch.usedAt = new Date().toISOString();
      // Si el user marca "usada", le pedimos el adId con el que la lanzó.
      // Es opcional — si lo deja vacío, no pasa nada, solo no habilita el
      // pull de performance.
      const adIdRaw = window.prompt(
        '¿Con qué ad ID de Meta la lanzaste?\n\n(Opcional — pegá el ID para cerrar el loop y traer performance real después. Ej: "120211234567890". Dejá vacío para saltear.)',
        ''
      );
      const adId = (adIdRaw || '').trim();
      if (adId) patch.launchedAsAdId = adId;
    }
    const list = updateIdea(id, patch);
    setIdeas(list);
    addToast?.({ type: 'success', message: `Idea → ${ESTADO_META[estado].label}` });
  };

  // Trae la performance real del ad lanzado (last_14d + lifetime) y la
  // guarda en la idea. Cierra el loop: hipótesis vs resultado.
  const fetchPerformance = async (idea) => {
    if (!idea.launchedAsAdId) return;
    try {
      const r = await fetch(`/api/meta/ad-performance?ad_id=${encodeURIComponent(idea.launchedAsAdId)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const list = updateIdea(idea.id, {
        launchedAsAdName: d.ad?.name || idea.launchedAsAdName || '',
        performance: {
          recent: d.recent,
          lifetime: d.lifetime,
          fetchedAt: d.fetchedAt,
        },
      });
      setIdeas(list);
      addToast?.({ type: 'success', message: 'Performance actualizada' });
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude traer métricas: ${err.message}` });
    }
  };

  const handleRemove = async (id) => {
    if (!window.confirm('¿Borrar esta idea? No se puede deshacer.')) return;
    setIdeas(removeIdea(id));
    // Borramos también el creativo de IndexedDB — sino quedaba huérfano
    // ocupando espacio para siempre (cada imagen pesa ~1-2 MB).
    try { await deleteCreativo(id); } catch (err) { console.warn('[Bandeja] deleteCreativo falló:', err.message); }
    setSelected(prev => {
      const next = new Set(prev); next.delete(id); return next;
    });
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = (ids) => {
    setSelected(prev => {
      const allSelected = ids.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  // Exporta las ideas seleccionadas como Markdown descargable. Lo suficiente
  // para pegarlo en Docs/Notion/Word y entregárselo al diseñador/editor.
  const exportAll = (ideasAExportar, formato = 'md') => {
    if (!ideasAExportar || ideasAExportar.length === 0) {
      addToast?.({ type: 'error', message: 'No hay ideas para exportar' });
      return;
    }
    if (formato === 'docx') {
      exportDocxFlow(ideasAExportar);
    } else {
      buildBriefMdAndDownload(ideasAExportar);
      addToast?.({ type: 'success', message: `Brief con ${ideasAExportar.length} ideas descargado (.md)` });
    }
  };

  const exportSelected = (formato = 'md') => {
    const chosen = ideas.filter(i => selected.has(i.id));
    if (chosen.length === 0) return;
    if (formato === 'docx') {
      exportDocxFlow(chosen);
    } else {
      buildBriefMdAndDownload(chosen);
      addToast?.({ type: 'success', message: `Brief con ${chosen.length} ideas descargado (.md)` });
    }
  };

  const exportDocxFlow = async (lista) => {
    try {
      await exportBriefDocx(lista, productoActivo?.legacy ? null : productoActivo);
      addToast?.({ type: 'success', message: `Brief .docx con ${lista.length} ideas descargado` });
    } catch (err) {
      addToast?.({ type: 'error', message: `Error al generar .docx: ${err.message}` });
    }
  };

  // Arma el markdown del brief a partir de una lista de ideas y lo descarga.
  const buildBriefMdAndDownload = (chosen) => {
    const today = new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' });
    const byTipo = chosen.reduce((acc, i) => {
      (acc[i.tipo] = acc[i.tipo] || []).push(i);
      return acc;
    }, {});

    const lines = [];
    lines.push(`# Brief de creativos — ${today}`);
    lines.push(``);
    lines.push(`${chosen.length} idea${chosen.length > 1 ? 's' : ''} seleccionada${chosen.length > 1 ? 's' : ''} de la Bandeja.`);
    lines.push(``);

    const ordenTipos = ['replica', 'iteracion', 'diferenciacion', 'desde_cero'];
    for (const tipo of ordenTipos) {
      const group = byTipo[tipo];
      if (!group || group.length === 0) continue;
      const meta = TIPO_META[tipo] || TIPO_META.desde_cero;
      lines.push(`## ${meta.emoji} ${meta.label} (${group.length})`);
      lines.push(`_${meta.descripcion}_`);
      lines.push(``);
      group.forEach((idea, idx) => {
        lines.push(`## PIEZA #${idx + 1} — ${idea.titulo}`);
        const formatoLabel = { video: 'Video', static: 'Static', carrusel: 'Carrusel' }[idea.formato] || idea.formato;
        lines.push(`**${formatoLabel}${idea.estiloVisual ? ` · Estilo: ${idea.estiloVisual}` : ''}**`);
        lines.push(``);
        if (idea.origen?.competidorNombre) lines.push(`**Origen:** ${idea.origen.competidorNombre}${idea.origen.daysRunning ? ` · ${idea.origen.daysRunning}d corriendo` : ''}`);
        if (idea.origen?.razonamiento) lines.push(`**Razonamiento:** ${idea.origen.razonamiento}`);
        if (idea.variableDeTesteo && VARIABLE_META[idea.variableDeTesteo]) {
          lines.push(`**Variable a testear:** ${VARIABLE_META[idea.variableDeTesteo].emoji} ${VARIABLE_META[idea.variableDeTesteo].label}`);
        }
        if (idea.testHipotesis) lines.push(`**Hipótesis:** ${idea.testHipotesis}`);
        lines.push(``);

        // 📖 Escenario narrativo
        if (idea.escenarioNarrativo) {
          lines.push(`### 📖 Escenario (contexto narrativo)`);
          lines.push(idea.escenarioNarrativo);
          lines.push(``);
        }

        // 🎯 Hook + 📐 Ángulo + 💥 Pain point
        if (idea.hook) {
          lines.push(`### 🎯 Hook`);
          lines.push(`> ${idea.hook.replace(/\n/g, '\n> ')}`);
          lines.push(``);
        }
        if (idea.angulo) { lines.push(`**Ángulo:** ${idea.angulo}`); lines.push(``); }
        if (idea.painPoint) { lines.push(`**Pain point:** ${idea.painPoint}`); lines.push(``); }

        // 🖼 Descripción de imagen
        if (idea.descripcionImagen) {
          lines.push(`### 🖼 Descripción de la imagen`);
          lines.push(idea.descripcionImagen);
          lines.push(``);
        }

        // 🤖 Prompt en inglés para generadores de IA
        if (idea.promptGeneradorImagen) {
          lines.push(`### 🤖 Prompt para Nano Banana / Midjourney (inglés)`);
          lines.push('```');
          lines.push(idea.promptGeneradorImagen);
          lines.push('```');
          lines.push(``);
        }

        // ✍️ Texto dentro de la imagen
        if (idea.textoEnImagen) {
          lines.push(`### ✍️ Texto que va DENTRO de la imagen`);
          lines.push('```');
          lines.push(idea.textoEnImagen);
          lines.push('```');
          lines.push(``);
        }

        // 📱 Copy del post en Meta
        if (idea.copyPostMeta || idea.copy) {
          lines.push(`### 📱 Copy del post en Meta (va ARRIBA del creativo, NO en la imagen)`);
          lines.push(idea.copyPostMeta || idea.copy);
          lines.push(``);
        }

        // 🎬 Guión (solo si es video). Preferimos el guión adaptado al
        // producto si existe; si no, el de referencia.
        const guionTxt = guionToText(idea.guionAdaptado) || guionToText(idea.guion);
        if (guionTxt && !/^n\/?a/i.test(guionTxt.trim())) {
          lines.push(`### 🎬 Guión`);
          lines.push('```');
          lines.push(guionTxt);
          lines.push('```');
          lines.push(``);
        }

        // 🎯 Público sugerido
        if (idea.publicoSugerido) {
          lines.push(`### 🎯 Público sugerido`);
          lines.push(idea.publicoSugerido);
          lines.push(``);
        }

        if (idea.notas) { lines.push(`**Notas:** ${idea.notas}`); lines.push(``); }
        if (idea.origen?.adSnapshotUrl) { lines.push(`[Ver ad original en Ad Library](${idea.origen.adSnapshotUrl})`); lines.push(``); }
        lines.push(`---`);
        lines.push(``);
      });
    }

    const md = lines.join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `brief-creativos-${stamp}.md`;
    a.click();
    // Revoke con delay — en Safari el click defers el download a un
    // microtask, revocar sync abortaba la descarga. Mismo patrón que
    // GaleriaReferencialesModal.jsx.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const guardarNotas = (id) => {
    setIdeas(updateIdea(id, { notas: notasDraft }));
    setEditandoNotasId(null);
    setNotasDraft('');
  };

  const guardarGuion = (id) => {
    setIdeas(updateIdea(id, { guion: guionDraft }));
    setEditandoGuionId(null);
    setGuionDraft('');
  };

  // Pre-filtro por producto activo — nunca mezclamos ideas entre productos.
  // Si activeProductoId === SIN_PRODUCTO_ID, mostramos solo ideas sin productoId
  // (legacy, de antes de que guardáramos el productoId en cada idea).
  const ideasDelProducto = activeProductoId
    ? ideas.filter(i => {
        if (activeProductoId === SIN_PRODUCTO_ID) return !i.productoId;
        return String(i.productoId || '') === String(activeProductoId);
      })
    : ideas;

  // Filtrar
  const filtered = ideasDelProducto.filter(i => {
    if (filtroTipo !== 'all' && i.tipo !== filtroTipo) return false;
    if (filtroEstado === 'active' && !['pendiente', 'en_uso'].includes(i.estado)) return false;
    if (filtroEstado !== 'all' && filtroEstado !== 'active' && i.estado !== filtroEstado) return false;
    if (filtroFormato === 'video' && i.formato !== 'video') return false;
    if (filtroFormato === 'imagen' && i.formato === 'video') return false;
    if (query) {
      const q = query.toLowerCase();
      const hay = `${i.titulo} ${i.angulo} ${i.hook} ${i.origen?.competidorNombre || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Comparador para ordenar las cards dentro de cada columna del kanban.
  // El user lo elige con el selector de orden — score y ángulo ayudan a
  // priorizar producción (atacar primero los hooks fuertes / agrupar por
  // ángulo para no saturar un mismo arquetipo).
  const fechaDesc = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '');
  const comparator = (() => {
    switch (orden) {
      case 'antiguas':
        return (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '');
      case 'score':
        // Score desc — los hooks sin puntuar caen al final.
        return (a, b) => {
          const sa = typeof a.scoreValue === 'number' ? a.scoreValue : -1;
          const sb = typeof b.scoreValue === 'number' ? b.scoreValue : -1;
          return sb !== sa ? sb - sa : fechaDesc(a, b);
        };
      case 'angulo':
        // Agrupa por ángulo estratégico (A-J); sin ángulo al final.
        return (a, b) => {
          const aa = a.anguloCategoria || 'zzz';
          const ab = b.anguloCategoria || 'zzz';
          return aa !== ab ? aa.localeCompare(ab) : fechaDesc(a, b);
        };
      default: // recientes
        return fechaDesc;
    }
  })();

  const productoActivo = activeProductoId === SIN_PRODUCTO_ID
    ? { id: SIN_PRODUCTO_ID, nombre: 'Sin producto asignado' }
    : productos.find(p => String(p.id) === String(activeProductoId)) || null;

  // ====================================================================
  // VISTA 1: SELECTOR DE PRODUCTOS (sin producto activo)
  // ====================================================================
  if (!activeProductoId) {
    return <ProductoSelectorView
      productos={productos}
      ideas={ideas}
      onSelect={setActiveProductoId}
    />;
  }

  // Agrupar ideas: primero sacar las que están en columnas custom,
  // el resto va a sus columnas base por estado.
  const byEstado = { pendiente: [], en_uso: [], usada: [], archivada: [] };
  const byCustomCol = {};
  for (const cc of customColumns) byCustomCol[cc.id] = [];
  for (const i of filtered) {
    if (i.customColumnId && byCustomCol[i.customColumnId]) {
      byCustomCol[i.customColumnId].push(i);
    } else {
      const e = i.estado in byEstado ? i.estado : 'pendiente';
      byEstado[e].push(i);
    }
  }
  const sortCol = (arr) => arr.sort(comparator);
  for (const e of Object.keys(byEstado)) sortCol(byEstado[e]);
  for (const cc of Object.keys(byCustomCol)) sortCol(byCustomCol[cc]);

  const ideaDetalle = expandedId ? ideas.find(i => i.id === expandedId) : null;

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header con breadcrumb de producto — se oculta cuando estamos
          embebidos en otro padre que ya tiene su propio header. */}
      {!embedded && (
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => setActiveProductoId(null)}
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition shrink-0"
            title="Volver al selector de productos"
          >
            <ChevronRight size={16} className="rotate-180" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Inbox size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              <button onClick={() => setActiveProductoId(null)} className="hover:text-brand-500 transition">Bandeja</button> / {productoActivo?.nombre || 'Producto'}
            </p>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
              {productoActivo?.nombre || 'Bandeja de ideas'}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {selected.size} seleccionada{selected.size > 1 ? 's' : ''}
              </span>
              <button onClick={() => setSelected(new Set())}
                className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition">
                Limpiar
              </button>
              {/* Selector de N variantes por idea — el user setea cuántas
                  imágenes quiere por cada idea seleccionada. Total = N × selected. */}
              <div className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded">
                <span className="text-[10px] text-gray-500 dark:text-gray-400 px-1">var:</span>
                {[1, 2, 4].map(opt => (
                  <button key={opt}
                    onClick={() => setBulkN(opt)}
                    disabled={bulkRunning}
                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition ${
                      bulkN === opt
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >{opt}</button>
                ))}
              </div>
              {/* Quality: medium ahorra 4x respecto de high con calidad razonable */}
              <div className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded">
                {['medium', 'high'].map(opt => (
                  <button key={opt}
                    onClick={() => setBulkQuality(opt)}
                    disabled={bulkRunning}
                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition ${
                      bulkQuality === opt
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >{opt}</button>
                ))}
              </div>
              <button
                disabled={bulkRunning}
                onClick={async () => {
                  // Filtrar las ideas válidas (con contenido + no video).
                  const valid = [];
                  for (const id of selected) {
                    const idea = ideas.find(i => i.id === id);
                    if (!idea) continue;
                    if (!(idea.hook || idea.titulo || idea.descripcionImagen)) continue;
                    if (idea.formato === 'video') continue;
                    valid.push(idea);
                  }
                  if (valid.length === 0) {
                    addToast?.({ type: 'error', message: 'Las seleccionadas no tienen contenido para generar (o son videos).' });
                    return;
                  }
                  // Necesitamos el producto activo + su foto. Buscamos en el array
                  // de productos cargado por loadProductos.
                  const producto = productos.find(p => String(p.id) === String(activeProductoId));
                  if (!producto) {
                    addToast?.({ type: 'error', message: 'Seleccioná un producto activo antes de generar.' });
                    return;
                  }
                  setBulkRunning(true);
                  try {
                    const result = await bulkGenerateFromIdeas({
                      ideas: valid,
                      producto,
                      n: bulkN,
                      quality: bulkQuality,
                      size: bulkSize,
                      addToast,
                    });
                    if (result.ok > 0) setSelected(new Set());
                  } finally {
                    setBulkRunning(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Genera N variantes de cada idea seleccionada. Se guardan automáticamente en Galería."
              >
                <Sparkles size={12} />
                {bulkRunning
                  ? 'Generando…'
                  : `Generar ${selected.size * bulkN} ${selected.size * bulkN === 1 ? 'imagen' : 'imágenes'}`
                }
              </button>
              <button onClick={() => exportSelected('docx')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-600 hover:to-brand-700 shadow-sm transition">
                <Download size={12} /> Exportar {selected.size} .docx
              </button>
              <button onClick={() => exportSelected('md')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/20 transition">
                .md
              </button>
            </>
          )}
          {selected.size === 0 && filtered.length > 0 && (
            <>
              <button
                onClick={() => setSelected(new Set(filtered.map(i => i.id)))}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/20 transition"
              >
                <CheckSquare size={12} /> Seleccionar todas ({filtered.length})
              </button>
              <button
                onClick={() => exportAll(filtered, 'docx')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-600 hover:to-brand-700 shadow-sm transition"
                title={`Exportar todas las ${filtered.length} ideas visibles como .docx`}
              >
                <Download size={12} /> Exportar todas .docx ({filtered.length})
              </button>
              <button
                onClick={() => exportAll(filtered, 'md')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-700 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/20 transition"
                title={`Exportar todas las ${filtered.length} ideas visibles como .md`}
              >
                .md
              </button>
            </>
          )}
        </div>
      </div>
      )}

      {/* Filtros (solo tipo + búsqueda — estado lo filtran las columnas) */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por título, ángulo, competidor…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
          className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md">
          <option value="all">Todos los tipos</option>
          {Object.entries(TIPO_META).map(([k, t]) => (
            <option key={k} value={k}>{t.emoji} {t.label}</option>
          ))}
        </select>
        {/* Orden de las cards dentro de cada columna */}
        <select value={orden} onChange={e => setOrden(e.target.value)}
          className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md"
          title="Ordenar las ideas dentro de cada columna">
          <option value="recientes">↓ Más recientes</option>
          <option value="antiguas">↑ Más antiguas</option>
          <option value="score">★ Mejor score</option>
          <option value="angulo">📐 Por ángulo</option>
        </select>
        {/* Filtro de formato — separa lo que producís vos (imagen) de lo
            que mandás a producción de video. */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-900 rounded-md p-0.5">
          {[
            { id: 'all', label: 'Todo' },
            { id: 'imagen', label: '🖼️ Imagen' },
            { id: 'video', label: '🎬 Video' },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltroFormato(f.id)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded transition ${
                filtroFormato === f.id
                  ? 'bg-white dark:bg-gray-700 text-brand-700 dark:text-brand-300 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban — 4 columnas, una por estado. Click en card → abre modal de detalle. */}
      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {ideasDelProducto.length === 0 ? 'Sin ideas para este producto todavía' : 'Ninguna idea coincide con el filtro'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {ideasDelProducto.length === 0
              ? 'Corré el pipeline desde "Arranque" — las ideas aparecen acá en "Pendientes".'
              : 'Ajustá el buscador o el filtro de tipo.'
            }
          </p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2" style={{ minHeight: '200px' }}>
          <div className="min-w-[300px] max-w-[360px] flex-shrink-0 flex-1">
            <KanbanColumn estado="pendiente" titulo={baseTitles.pendiente} color="gray" accent
              ideas={byEstado.pendiente} selected={selected} onToggleSelect={toggleSelect}
              onCardClick={(id) => setExpandedId(id)} onDropIdea={(id) => moveToBaseColumn(id, 'pendiente')}
              onRename={() => renameBaseColumn('pendiente')} />
          </div>
          <div className="min-w-[300px] max-w-[360px] flex-shrink-0 flex-1">
            <KanbanColumn estado="en_uso" titulo={baseTitles.en_uso} color="amber"
              ideas={byEstado.en_uso} selected={selected} onToggleSelect={toggleSelect}
              onCardClick={(id) => setExpandedId(id)} onDropIdea={(id) => moveToBaseColumn(id, 'en_uso')}
              onRename={() => renameBaseColumn('en_uso')} />
          </div>
          <div className="min-w-[300px] max-w-[360px] flex-shrink-0 flex-1">
            <KanbanColumn estado="usada" titulo={baseTitles.usada} color="emerald"
              ideas={byEstado.usada} selected={selected} onToggleSelect={toggleSelect}
              onCardClick={(id) => setExpandedId(id)} onDropIdea={(id) => moveToBaseColumn(id, 'usada')}
              onRename={() => renameBaseColumn('usada')} />
          </div>
          <div className="min-w-[300px] max-w-[360px] flex-shrink-0 flex-1">
            <KanbanColumn estado="archivada" titulo={baseTitles.archivada} color="slate"
              ideas={byEstado.archivada} selected={selected} onToggleSelect={toggleSelect}
              onCardClick={(id) => setExpandedId(id)} onDropIdea={(id) => moveToBaseColumn(id, 'archivada')}
              onRename={() => renameBaseColumn('archivada')} />
          </div>
          {customColumns.map(cc => (
            <div key={cc.id} className="min-w-[300px] max-w-[360px] flex-shrink-0 flex-1">
              <KanbanColumn
                estado={cc.id} titulo={cc.name} color={cc.color || 'violet'} isCustom
                ideas={byCustomCol[cc.id] || []} selected={selected} onToggleSelect={toggleSelect}
                onCardClick={(id) => setExpandedId(id)}
                onDropIdea={(id) => moveToCustomColumn(id, cc.id)}
                onRename={() => renameCustomColumn(cc.id)}
                onDelete={() => removeCustomColumn(cc.id)}
              />
            </div>
          ))}
          <div className="min-w-[80px] flex-shrink-0 flex items-start pt-2">
            <button
              onClick={addCustomColumn}
              className="w-full px-3 py-4 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-brand-400 hover:text-brand-500 transition flex flex-col items-center gap-1"
              title="Agregar columna"
            >
              <Plus size={20} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Columna</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal de detalle — placeholder para Parte 2b.4.
          Por ahora, envolvemos el IdeaCard expandido en un overlay fullscreen. */}
      {ideaDetalle && (
        <IdeaDetailModal
          idea={ideaDetalle}
          onClose={() => setExpandedId(null)}
          onEstado={(estado) => setEstado(ideaDetalle.id, estado)}
          onRemove={() => { handleRemove(ideaDetalle.id); setExpandedId(null); }}
          editandoNotas={editandoNotasId === ideaDetalle.id}
          onEditNotas={() => { setEditandoNotasId(ideaDetalle.id); setNotasDraft(ideaDetalle.notas || ''); }}
          notasDraft={notasDraft}
          setNotasDraft={setNotasDraft}
          onSaveNotas={() => guardarNotas(ideaDetalle.id)}
          onCancelNotas={() => { setEditandoNotasId(null); setNotasDraft(''); }}
          editandoGuion={editandoGuionId === ideaDetalle.id}
          onEditGuion={() => { setEditandoGuionId(ideaDetalle.id); setGuionDraft(guionToText(ideaDetalle.guion)); }}
          guionDraft={guionDraft}
          setGuionDraft={setGuionDraft}
          onSaveGuion={() => guardarGuion(ideaDetalle.id)}
          onCancelGuion={() => { setEditandoGuionId(null); setGuionDraft(''); }}
          isSelected={selected.has(ideaDetalle.id)}
          onToggleSelect={() => toggleSelect(ideaDetalle.id)}
          onFetchPerformance={() => fetchPerformance(ideaDetalle)}
          addToast={addToast}
        />
      )}
    </div>
  );
}

