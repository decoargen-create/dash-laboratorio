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

import React, { useState, useEffect } from 'react';
import {
  Inbox, Search, Filter, ExternalLink, Trash2, Download, Package,
  ChevronDown, Check, Circle, CircleDot, Archive, Edit3, CheckSquare, Square, ChevronRight,
} from 'lucide-react';
import {
  loadIdeas, updateIdea, removeIdea, TIPO_META, ESTADO_META, VARIABLE_META, ANGULO_META, CAMPAÑA_META,
} from './bandejaStore.js';
import { exportBriefDocx } from './exportDocx.js';

const PRODUCTOS_KEY = 'viora-marketing-productos-v1';
const ACTIVE_PRODUCT_KEY = 'viora-marketing-bandeja-active-product';
const SIN_PRODUCTO_ID = '__sin_producto__';

function loadProductos() {
  try {
    const raw = localStorage.getItem(PRODUCTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function BandejaSection({ addToast }) {
  const [ideas, setIdeas] = useState(() => loadIdeas());
  const [productos, setProductos] = useState(() => loadProductos());
  const [activeProductoId, setActiveProductoId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_PRODUCT_KEY) || null; } catch { return null; }
  });
  useEffect(() => {
    try {
      if (activeProductoId) localStorage.setItem(ACTIVE_PRODUCT_KEY, activeProductoId);
      else localStorage.removeItem(ACTIVE_PRODUCT_KEY);
    } catch {}
  }, [activeProductoId]);
  const [expandedId, setExpandedId] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('all');
  const [filtroEstado, setFiltroEstado] = useState('active'); // 'all' | 'active' (pendiente + en_uso) | 'pendiente' | 'en_uso' | 'usada' | 'archivada'
  const [query, setQuery] = useState('');
  const [editandoNotasId, setEditandoNotasId] = useState(null);
  const [notasDraft, setNotasDraft] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  // Re-sincronizar cuando otras secciones agregan ideas (event storage no es
  // ideal para same-tab — usamos un polling liviano cada 3s mientras la
  // sección está montada). Aceptable para bandeja que no escala a miles.
  useEffect(() => {
    const interval = setInterval(() => {
      const fresh = loadIdeas();
      setIdeas(prev => (prev.length !== fresh.length ? fresh : prev));
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

  const handleRemove = (id) => {
    if (!window.confirm('¿Borrar esta idea? No se puede deshacer.')) return;
    setIdeas(removeIdea(id));
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
        if (idea.copyPostMeta) {
          lines.push(`### 📱 Copy del post en Meta (va ARRIBA del creativo, NO en la imagen)`);
          lines.push(idea.copyPostMeta);
          lines.push(``);
        }

        // 🎬 Guión (solo si es video)
        if (idea.guion && !/^n\/?a/i.test(idea.guion.trim())) {
          lines.push(`### 🎬 Guión${idea.formato === 'video' ? ' (beats + VO)' : ''}`);
          lines.push('```');
          lines.push(idea.guion);
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
    URL.revokeObjectURL(url);
  };

  const guardarNotas = (id) => {
    setIdeas(updateIdea(id, { notas: notasDraft }));
    setEditandoNotasId(null);
    setNotasDraft('');
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
    if (query) {
      const q = query.toLowerCase();
      const hay = `${i.titulo} ${i.angulo} ${i.hook} ${i.origen?.competidorNombre || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Orden: pendientes > en uso > usadas > archivadas, y dentro más recientes primero.
  const orden = { pendiente: 0, en_uso: 1, usada: 2, archivada: 3 };
  const sorted = [...filtered].sort((a, b) => {
    const diff = (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9);
    if (diff !== 0) return diff;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  // Counters por estado (sobre el subset del producto activo — no mezcla).
  const counts = ideasDelProducto.reduce((acc, i) => {
    acc[i.estado] = (acc[i.estado] || 0) + 1;
    return acc;
  }, {});

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

  // Agrupar ideas por estado para el kanban — ya vienen ordenadas.
  const byEstado = { pendiente: [], en_uso: [], usada: [], archivada: [] };
  for (const i of filtered) {
    const e = i.estado in byEstado ? i.estado : 'pendiente';
    byEstado[e].push(i);
  }
  // Dentro de cada columna, más recientes arriba.
  for (const e of Object.keys(byEstado)) {
    byEstado[e].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  const ideaDetalle = expandedId ? ideas.find(i => i.id === expandedId) : null;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header con breadcrumb de producto */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => setActiveProductoId(null)}
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition shrink-0"
            title="Volver al selector de productos"
          >
            <ChevronRight size={16} className="rotate-180" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-500 flex items-center justify-center text-white shadow-sm shrink-0">
            <Inbox size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              <button onClick={() => setActiveProductoId(null)} className="hover:text-fuchsia-500 transition">Bandeja</button> / {productoActivo?.nombre || 'Producto'}
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
              <button onClick={() => exportSelected('docx')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-fuchsia-500 to-pink-500 rounded-lg hover:from-fuchsia-600 hover:to-pink-600 shadow-sm transition">
                <Download size={12} /> Exportar {selected.size} .docx
              </button>
              <button onClick={() => exportSelected('md')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-fuchsia-700 dark:text-fuchsia-300 bg-white dark:bg-gray-800 border border-fuchsia-300 dark:border-fuchsia-700 rounded-lg hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition">
                .md
              </button>
            </>
          )}
          {selected.size === 0 && filtered.length > 0 && (
            <>
              <button
                onClick={() => setSelected(new Set(filtered.map(i => i.id)))}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-fuchsia-700 dark:text-fuchsia-300 bg-white dark:bg-gray-800 border border-fuchsia-300 dark:border-fuchsia-700 rounded-lg hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition"
              >
                <CheckSquare size={12} /> Seleccionar todas ({filtered.length})
              </button>
              <button
                onClick={() => exportAll(filtered, 'docx')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-fuchsia-500 to-pink-500 rounded-lg hover:from-fuchsia-600 hover:to-pink-600 shadow-sm transition"
                title={`Exportar todas las ${filtered.length} ideas visibles como .docx`}
              >
                <Download size={12} /> Exportar todas .docx ({filtered.length})
              </button>
              <button
                onClick={() => exportAll(filtered, 'md')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-fuchsia-700 dark:text-fuchsia-300 bg-white dark:bg-gray-800 border border-fuchsia-300 dark:border-fuchsia-700 rounded-lg hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 transition"
                title={`Exportar todas las ${filtered.length} ideas visibles como .md`}
              >
                .md
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filtros (solo tipo + búsqueda — estado lo filtran las columnas) */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por título, ángulo, competidor…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-fuchsia-500" />
        </div>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
          className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md">
          <option value="all">Todos los tipos</option>
          {Object.entries(TIPO_META).map(([k, t]) => (
            <option key={k} value={k}>{t.emoji} {t.label}</option>
          ))}
        </select>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <KanbanColumn
            estado="pendiente" titulo="Pendientes" color="gray" accent
            ideas={byEstado.pendiente}
            selected={selected}
            onToggleSelect={toggleSelect}
            onCardClick={(id) => setExpandedId(id)}
            onDropIdea={(id) => setEstado(id, 'pendiente')}
          />
          <KanbanColumn
            estado="en_uso" titulo="En uso" color="amber"
            ideas={byEstado.en_uso}
            selected={selected}
            onToggleSelect={toggleSelect}
            onCardClick={(id) => setExpandedId(id)}
            onDropIdea={(id) => setEstado(id, 'en_uso')}
          />
          <KanbanColumn
            estado="usada" titulo="Usadas" color="emerald"
            ideas={byEstado.usada}
            selected={selected}
            onToggleSelect={toggleSelect}
            onCardClick={(id) => setExpandedId(id)}
            onDropIdea={(id) => setEstado(id, 'usada')}
          />
          <KanbanColumn
            estado="archivada" titulo="Archivadas" color="slate"
            ideas={byEstado.archivada}
            selected={selected}
            onToggleSelect={toggleSelect}
            onCardClick={(id) => setExpandedId(id)}
            onDropIdea={(id) => setEstado(id, 'archivada')}
          />
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
          isSelected={selected.has(ideaDetalle.id)}
          onToggleSelect={() => toggleSelect(ideaDetalle.id)}
          onFetchPerformance={() => fetchPerformance(ideaDetalle)}
        />
      )}
    </div>
  );
}

function CounterCard({ label, value, color, accent = false }) {
  const colors = {
    gray: 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100',
    amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200',
  };
  return (
    <div className={`p-3 rounded-xl border ${colors[color]} ${accent ? 'ring-2 ring-fuchsia-200 dark:ring-fuchsia-900/40' : ''}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function IdeaCard({
  idea, expanded, onToggle, onEstado, onRemove,
  editandoNotas, onEditNotas, notasDraft, setNotasDraft, onSaveNotas, onCancelNotas,
  isSelected, onToggleSelect, onFetchPerformance,
}) {
  const tipo = TIPO_META[idea.tipo] || TIPO_META.desde_cero;
  const estado = ESTADO_META[idea.estado] || ESTADO_META.pendiente;
  const usada = idea.estado === 'usada' || idea.estado === 'archivada';

  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-xl overflow-hidden shadow-sm transition ${
      isSelected
        ? 'border-fuchsia-400 dark:border-fuchsia-600 ring-2 ring-fuchsia-200 dark:ring-fuchsia-900/40'
        : usada
          ? 'border-gray-200 dark:border-gray-700 opacity-70'
          : 'border-gray-200 dark:border-gray-700 hover:border-fuchsia-300 dark:hover:border-fuchsia-700'
    }`}>
      {/* Header siempre visible */}
      <div className="px-4 py-3 flex items-start gap-3">
        {/* Checkbox para multi-select export */}
        <button onClick={onToggleSelect}
          className="mt-1 shrink-0 text-gray-400 hover:text-fuchsia-600 transition"
          title={isSelected ? 'Deseleccionar' : 'Seleccionar para exportar'}>
          {isSelected ? <CheckSquare size={16} className="text-fuchsia-600" /> : <Square size={16} />}
        </button>

        {/* Thumbnail */}
        {idea.origen?.imageUrl ? (
          <img src={idea.origen.imageUrl} alt=""
            className="w-14 h-14 rounded-lg object-cover bg-gray-100 dark:bg-gray-700 shrink-0 border border-gray-200 dark:border-gray-700"
            onError={e => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-fuchsia-200 to-pink-200 dark:from-fuchsia-900/40 dark:to-pink-900/40 flex items-center justify-center shrink-0">
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
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded"
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
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded"
                title="Este hook arranca igual que otra idea — considerá reescribirlo para diversificar arquetipos">
                ⚠ hook similar
              </span>
            )}
            {idea.formato && (
              <span className="text-[10px] text-gray-400 ml-auto">
                {idea.formato === 'video' ? '🎬' : idea.formato === 'static' ? '🖼️' : '📑'} {idea.formato}
              </span>
            )}
          </div>

          <p className={`text-sm font-semibold ${usada ? 'text-gray-500 dark:text-gray-400 line-through' : 'text-gray-900 dark:text-gray-100'}`}>
            {idea.titulo}
          </p>
          {idea.angulo && !expanded && (
            <p className="text-[11px] text-gray-600 dark:text-gray-400 line-clamp-2 mt-0.5">
              {idea.angulo}
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <button onClick={onToggle}
            className="p-1.5 text-gray-500 hover:text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 rounded transition"
            title={expanded ? 'Cerrar' : 'Ver detalle'}>
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Detalle expandido */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-4 py-3 space-y-3">
          {/* Razón de iteración — destacado arriba para iteraciones */}
          {idea.tipo === 'iteracion' && idea.origen?.razonIteracion && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
              <p className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider mb-1">
                🔄 ¿Por qué iterar este ad?
              </p>
              <p className="text-xs text-amber-900 dark:text-amber-200">
                <span className="font-semibold">Ad base:</span> {idea.origen.adNombre || '(sin nombre)'}
              </p>
              <p className="text-xs text-amber-900 dark:text-amber-200 mt-1">{idea.origen.razonIteracion}</p>
            </div>
          )}
          {/* Razonamiento general para réplicas/diferenciaciones/desde-cero */}
          {idea.tipo !== 'iteracion' && idea.origen?.razonamiento && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
              <p className="text-[10px] font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider mb-1">
                💡 Por qué esta idea
              </p>
              <p className="text-xs text-blue-900 dark:text-blue-200">{idea.origen.razonamiento}</p>
            </div>
          )}

          {/* Hipótesis a validar — crítico para el loop de aprendizaje */}
          {idea.testHipotesis && (
            <div className="p-3 bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-md">
              <p className="text-[10px] font-bold text-cyan-800 dark:text-cyan-300 uppercase tracking-wider mb-1">
                🔬 Hipótesis a validar
              </p>
              {VARIABLE_META[idea.variableDeTesteo] && (
                <p className="text-[10px] text-cyan-700 dark:text-cyan-400 mb-1">
                  Variable: <strong>{VARIABLE_META[idea.variableDeTesteo].emoji} {VARIABLE_META[idea.variableDeTesteo].label}</strong> · {VARIABLE_META[idea.variableDeTesteo].descripcion}
                </p>
              )}
              <p className="text-xs text-cyan-900 dark:text-cyan-200">{idea.testHipotesis}</p>
            </div>
          )}

          {/* ⚠ Riesgo de alcance Meta — palabras gatillo */}
          {idea.metaRiesgo?.tieneRiesgo && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-[10px] font-bold text-red-800 dark:text-red-300 uppercase tracking-wider mb-1">
                ⚠ Riesgo de alcance en Meta
              </p>
              {idea.metaRiesgo.palabras?.length > 0 && (
                <p className="text-[10px] text-red-700 dark:text-red-400 mb-1">
                  Palabras gatillo detectadas: <strong>{idea.metaRiesgo.palabras.join(', ')}</strong>
                </p>
              )}
              {idea.metaRiesgo.sugerencia && (
                <p className="text-xs text-red-900 dark:text-red-200">{idea.metaRiesgo.sugerencia}</p>
              )}
              <p className="text-[10px] text-red-600 dark:text-red-400 italic mt-1">
                Recomendación: testear primero en campaña chica antes de escalar.
              </p>
            </div>
          )}

          {/* Performance real del ad lanzado — cierra el loop de aprendizaje */}
          {idea.launchedAsAdId && (
            <div className="p-3 bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-200 dark:border-fuchsia-800 rounded-md">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-bold text-fuchsia-800 dark:text-fuchsia-300 uppercase tracking-wider">
                  🚀 Lanzada en Meta
                </p>
                <button onClick={onFetchPerformance}
                  className="text-[10px] font-semibold text-fuchsia-600 dark:text-fuchsia-400 hover:underline inline-flex items-center gap-1">
                  <Download size={10} /> Traer métricas
                </button>
              </div>
              <p className="text-[10px] text-fuchsia-700 dark:text-fuchsia-400 mb-1 font-mono">
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
                  <p className="col-span-2 text-[9px] text-fuchsia-500 dark:text-fuchsia-400 text-right italic">
                    Últimos 14d · actualizado {new Date(idea.performance.fetchedAt).toLocaleString('es-AR')}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-fuchsia-700 dark:text-fuchsia-300 italic">
                  Click "Traer métricas" para ver cómo está funcionando.
                </p>
              )}
            </div>
          )}

          {/* Grid superior: ángulo, hook, formato/estilo */}
          {idea.hook && (
            <Field label="🎯 Hook" text={idea.hook} highlight />
          )}
          {idea.angulo && (
            <Field label="📐 Ángulo" text={idea.angulo} />
          )}
          {idea.painPoint && (
            <Field label="💥 Pain point" text={idea.painPoint} />
          )}
          {idea.estiloVisual && (
            <Field label="🎨 Estilo visual" text={idea.estiloVisual} />
          )}

          {/* 📖 Escenario narrativo — concepto estratégico */}
          {idea.escenarioNarrativo && (
            <Field label="📖 Escenario narrativo" text={idea.escenarioNarrativo} />
          )}

          {/* 🖼 Descripción de imagen en español */}
          {idea.descripcionImagen && (
            <Field label="🖼 Descripción de imagen (para el diseñador)" text={idea.descripcionImagen} />
          )}

          {/* 🤖 Prompt en inglés para Nano Banana / Midjourney */}
          {idea.promptGeneradorImagen && (
            <details open className="bg-indigo-50 dark:bg-indigo-900/20 rounded-md border border-indigo-200 dark:border-indigo-800">
              <summary className="cursor-pointer px-3 py-2 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider flex items-center justify-between">
                <span>🤖 Prompt para Nano Banana / Midjourney (inglés)</span>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    navigator.clipboard?.writeText(idea.promptGeneradorImagen);
                  }}
                  className="text-[10px] font-normal text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  📋 copiar
                </button>
              </summary>
              <p className="px-3 pb-3 text-xs font-mono text-indigo-900 dark:text-indigo-200 whitespace-pre-wrap break-words">{idea.promptGeneradorImagen}</p>
            </details>
          )}

          {/* ✍️ Texto que va DENTRO de la imagen */}
          {idea.textoEnImagen && (
            <div>
              <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1">✍️ Texto dentro de la imagen (layout)</p>
              <pre className="text-[11px] font-mono whitespace-pre-wrap bg-gray-50 dark:bg-gray-800/50 rounded-md px-3 py-2 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700">{idea.textoEnImagen}</pre>
            </div>
          )}

          {/* 📱 Copy del post en Meta (va arriba del creativo en el feed) */}
          {idea.copyPostMeta && (
            <div>
              <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1">📱 Copy del post en Meta (arriba del creativo)</p>
              <div className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800/50 rounded-md px-3 py-2 border border-gray-200 dark:border-gray-700">{idea.copyPostMeta}</div>
            </div>
          )}

          {/* 🎯 Público sugerido */}
          {idea.publicoSugerido && (
            <Field label="🎯 Público sugerido" text={idea.publicoSugerido} />
          )}

          {/* 🎬 Guión (solo si es video o carrusel detallado) */}
          {idea.guion && !/^n\/?a/i.test(idea.guion.trim()) && (
            <details open={idea.formato === 'video'} className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
              <summary className="cursor-pointer px-3 py-2 text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                🎬 Guión {idea.formato === 'video' ? '(beats + VO)' : ''}
              </summary>
              <p className="px-3 pb-3 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{idea.guion}</p>
            </details>
          )}

          {/* Notas */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">📓 Notas</p>
              {!editandoNotas && (
                <button onClick={onEditNotas}
                  className="inline-flex items-center gap-1 text-[10px] text-fuchsia-600 hover:text-fuchsia-700 transition">
                  <Edit3 size={10} /> Editar
                </button>
              )}
            </div>
            {editandoNotas ? (
              <div className="space-y-1.5">
                <textarea value={notasDraft} onChange={e => setNotasDraft(e.target.value)}
                  rows={3} placeholder="Quién la va a producir, fecha, brief, etc."
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-fuchsia-500" />
                <div className="flex gap-1.5 justify-end">
                  <button onClick={onCancelNotas}
                    className="px-2.5 py-1 text-[10px] font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 transition">
                    Cancelar
                  </button>
                  <button onClick={onSaveNotas}
                    className="px-2.5 py-1 text-[10px] font-bold text-white bg-fuchsia-600 rounded hover:bg-fuchsia-700 transition">
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
                  className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline">
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
          ? 'bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-200 dark:border-fuchsia-800 rounded-md px-3 py-2 text-fuchsia-900 dark:text-fuchsia-200'
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
        <p className="text-fuchsia-600 dark:text-fuchsia-400 font-semibold">{label}</p>
        <p className="text-gray-400 font-mono">—</p>
      </div>
    );
  }
  const tone = semaforo ? semaforo(v) : null;
  const toneClass = tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' :
                    tone === 'mid' ? 'text-amber-600 dark:text-amber-400' :
                    tone === 'bad' ? 'text-red-600 dark:text-red-400' :
                    'text-fuchsia-900 dark:text-fuchsia-200';
  return (
    <div className="text-[10px]">
      <p className="text-fuchsia-600 dark:text-fuchsia-400 font-semibold">{label}</p>
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
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-500 flex items-center justify-center text-white shadow-sm">
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
      className="text-left p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:border-fuchsia-300 dark:hover:border-fuchsia-700 hover:shadow-md transition group"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition ${
          producto.legacy
            ? 'bg-gradient-to-br from-gray-400 to-gray-500'
            : 'bg-gradient-to-br from-fuchsia-500 to-pink-500'
        }`}>
          {producto.legacy ? '?' : inicial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{producto.nombre}</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            {total} idea{total !== 1 ? 's' : ''} total{total !== 1 ? 'es' : ''}
          </p>
        </div>
        <ChevronRight size={16} className="text-gray-400 group-hover:text-fuchsia-500 transition shrink-0" />
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
    <div className={`px-2 py-1.5 rounded-md border ${colors[color]} ${accent ? 'ring-1 ring-fuchsia-300 dark:ring-fuchsia-700' : ''}`}>
      <p className="text-[9px] font-bold uppercase tracking-wider opacity-60 leading-none">{label}</p>
      <p className="text-base font-bold tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

// Columna del kanban — header con color + count, cuerpo scrolleable con cards.
// Actúa como drop target: al soltar una card encima, llama onDropIdea con el id
// de la idea, que la mueve a este estado.
function KanbanColumn({ estado, titulo, color, accent = false, ideas, selected, onToggleSelect, onCardClick, onDropIdea }) {
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
      className={`rounded-xl border flex flex-col transition ${c.body} ${accent ? 'ring-2 ring-fuchsia-200 dark:ring-fuchsia-900/40' : ''} ${isDragOver ? c.dragOver : ''}`}
    >
      <div className={`px-3 py-2 border-b flex items-center justify-between ${c.header} rounded-t-xl`}>
        <p className="text-[11px] font-bold uppercase tracking-wider">{titulo}</p>
        <span className="text-xs font-bold tabular-nums">{ideas.length}</span>
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

// Card compacta del kanban — thumb chico + título + 2-3 badges clave.
// Todo el detalle se ve al clickear (abre el modal). También es arrastrable
// entre columnas (drag&drop HTML5 nativo).
function KanbanCard({ idea, isSelected = false, onToggleSelect, onClick }) {
  const tipo = TIPO_META[idea.tipo] || TIPO_META.desde_cero;
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

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`relative bg-white dark:bg-gray-800 border rounded-lg p-2 hover:shadow-sm transition group cursor-grab active:cursor-grabbing ${
        isSelected
          ? 'border-fuchsia-400 dark:border-fuchsia-600 ring-2 ring-fuchsia-200 dark:ring-fuchsia-900/40'
          : 'border-gray-200 dark:border-gray-700 hover:border-fuchsia-300 dark:hover:border-fuchsia-700'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      {onToggleSelect && (
        <button
          onClick={handleCheckboxClick}
          className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-fuchsia-500 transition opacity-0 group-hover:opacity-100 data-[checked=true]:opacity-100"
          data-checked={isSelected}
          title={isSelected ? 'Deseleccionar' : 'Seleccionar para exportar'}
        >
          {isSelected ? <CheckSquare size={12} className="text-fuchsia-600" /> : <Square size={12} className="text-gray-400" />}
        </button>
      )}
      <div className="flex items-start gap-2">
        {idea.origen?.imageUrl ? (
          <img
            src={idea.origen.imageUrl} alt=""
            className="w-10 h-10 rounded object-cover bg-gray-100 dark:bg-gray-700 shrink-0 border border-gray-200 dark:border-gray-700"
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-10 h-10 rounded bg-gradient-to-br from-fuchsia-200 to-pink-200 dark:from-fuchsia-900/40 dark:to-pink-900/40 flex items-center justify-center shrink-0">
            <span className="text-lg">{tipo.emoji}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 leading-tight line-clamp-2">
            {idea.titulo}
          </p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className={`inline-flex items-center px-1 py-0 text-[8px] font-bold rounded border ${tipo.color}`}>
              {tipo.emoji} {tipo.label}
            </span>
            {idea.formato && (
              <span className="text-[9px] text-gray-400">
                {idea.formato === 'video' ? '🎬' : idea.formato === 'static' ? '🖼️' : '📑'}
              </span>
            )}
            {idea.anguloCategoria && ANGULO_META[idea.anguloCategoria] && (
              <span className={`inline-flex items-center px-1 py-0 text-[8px] font-bold rounded ${ANGULO_META[idea.anguloCategoria].color}`}
                title={`Ángulo ${idea.anguloCategoria}`}>
                {ANGULO_META[idea.anguloCategoria].emoji}
              </span>
            )}
            {idea.metaRiesgo?.tieneRiesgo && (
              <span className="text-[9px]" title="Riesgo de alcance en Meta">⚠</span>
            )}
          </div>
          {idea.origen?.competidorNombre && (
            <p className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              de {idea.origen.competidorNombre}
            </p>
          )}
        </div>
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
        className="relative w-full max-w-3xl"
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
