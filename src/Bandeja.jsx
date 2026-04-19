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
  Inbox, Search, Filter, ExternalLink, Trash2, Download,
  ChevronDown, Check, Circle, CircleDot, Archive, Edit3, CheckSquare, Square,
} from 'lucide-react';
import {
  loadIdeas, updateIdea, removeIdea, TIPO_META, ESTADO_META, VARIABLE_META,
} from './bandejaStore.js';

export default function BandejaSection({ addToast }) {
  const [ideas, setIdeas] = useState(() => loadIdeas());
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
  const exportSelected = () => {
    const chosen = ideas.filter(i => selected.has(i.id));
    if (chosen.length === 0) return;

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
        lines.push(`### ${idx + 1}. ${idea.titulo}`);
        if (idea.origen?.competidorNombre) lines.push(`**Origen:** ${idea.origen.competidorNombre}${idea.origen.daysRunning ? ` · ${idea.origen.daysRunning}d corriendo` : ''}`);
        if (idea.origen?.razonamiento) lines.push(`**Razonamiento:** ${idea.origen.razonamiento}`);
        if (idea.formato) lines.push(`**Formato:** ${idea.formato}`);
        if (idea.variableDeTesteo && VARIABLE_META[idea.variableDeTesteo]) {
          lines.push(`**Variable a testear:** ${VARIABLE_META[idea.variableDeTesteo].emoji} ${VARIABLE_META[idea.variableDeTesteo].label} — ${VARIABLE_META[idea.variableDeTesteo].descripcion}`);
        }
        if (idea.testHipotesis) lines.push(`**Hipótesis:** ${idea.testHipotesis}`);
        lines.push(``);
        if (idea.angulo) { lines.push(`**Ángulo:** ${idea.angulo}`); lines.push(``); }
        if (idea.hook) { lines.push(`**Hook:**  \n> ${idea.hook.replace(/\n/g, '\n> ')}`); lines.push(``); }
        if (idea.painPoint) { lines.push(`**Pain point:** ${idea.painPoint}`); lines.push(``); }
        if (idea.copy) { lines.push(`**Copy sugerido:**`); lines.push(idea.copy); lines.push(``); }
        if (idea.guion) { lines.push(`**Guión / transcripción:**`); lines.push('```'); lines.push(idea.guion); lines.push('```'); lines.push(``); }
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
    addToast?.({ type: 'success', message: `Brief con ${chosen.length} ideas descargado` });
  };

  const guardarNotas = (id) => {
    setIdeas(updateIdea(id, { notas: notasDraft }));
    setEditandoNotasId(null);
    setNotasDraft('');
  };

  // Filtrar
  const filtered = ideas.filter(i => {
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

  // Counters por estado (sobre TODO el set, no el filtrado)
  const counts = ideas.reduce((acc, i) => {
    acc[i.estado] = (acc[i.estado] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-500 flex items-center justify-center text-white shadow-sm">
            <Inbox size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Bandeja de ideas</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Lista continua de renovaciones — se va llenando con cada análisis.</p>
          </div>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-300">
              {selected.size} seleccionada{selected.size > 1 ? 's' : ''}
            </span>
            <button onClick={() => setSelected(new Set())}
              className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition">
              Limpiar
            </button>
            <button onClick={exportSelected}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-fuchsia-500 to-pink-500 rounded-lg hover:from-fuchsia-600 hover:to-pink-600 shadow-sm transition">
              <Download size={12} /> Exportar brief .md
            </button>
          </div>
        )}
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CounterCard label="Pendientes" value={counts.pendiente || 0} color="gray" accent />
        <CounterCard label="En uso" value={counts.en_uso || 0} color="amber" />
        <CounterCard label="Usadas" value={counts.usada || 0} color="emerald" />
        <CounterCard label="Archivadas" value={counts.archivada || 0} color="gray" />
      </div>

      {/* Filtros */}
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
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md">
          <option value="active">Activas (pend + en uso)</option>
          <option value="all">Todas</option>
          <option value="pendiente">Pendientes</option>
          <option value="en_uso">En uso</option>
          <option value="usada">Usadas</option>
          <option value="archivada">Archivadas</option>
        </select>
      </div>

      {/* Lista */}
      {sorted.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {ideas.length === 0 ? 'Sin ideas todavía' : 'Ninguna idea coincide con el filtro'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {ideas.length === 0
              ? 'Andá a "Arranque" y corré el pipeline — las ideas se van a poblar acá.'
              : 'Ajustá los filtros de arriba o limpiá la búsqueda.'
            }
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Toolbar de selección masiva */}
          <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
            <button
              onClick={() => toggleSelectAllFiltered(sorted.map(i => i.id))}
              className="inline-flex items-center gap-1 hover:text-fuchsia-600 transition"
            >
              {sorted.every(i => selected.has(i.id))
                ? <><CheckSquare size={12} /> Deseleccionar todas las visibles</>
                : <><Square size={12} /> Seleccionar todas las visibles ({sorted.length})</>
              }
            </button>
          </div>
          {sorted.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              expanded={expandedId === idea.id}
              onToggle={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
              onEstado={(estado) => setEstado(idea.id, estado)}
              onRemove={() => handleRemove(idea.id)}
              editandoNotas={editandoNotasId === idea.id}
              onEditNotas={() => { setEditandoNotasId(idea.id); setNotasDraft(idea.notas || ''); }}
              notasDraft={notasDraft}
              setNotasDraft={setNotasDraft}
              onSaveNotas={() => guardarNotas(idea.id)}
              onCancelNotas={() => { setEditandoNotasId(null); setNotasDraft(''); }}
              isSelected={selected.has(idea.id)}
              onToggleSelect={() => toggleSelect(idea.id)}
              onFetchPerformance={() => fetchPerformance(idea)}
            />
          ))}
        </div>
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
            {idea.variableDeTesteo && VARIABLE_META[idea.variableDeTesteo] && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded"
                title={`Variable a testear: ${VARIABLE_META[idea.variableDeTesteo].descripcion}`}>
                {VARIABLE_META[idea.variableDeTesteo].emoji} testea: {VARIABLE_META[idea.variableDeTesteo].label}
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

          {idea.angulo && (
            <Field label="📐 Ángulo" text={idea.angulo} />
          )}
          {idea.hook && (
            <Field label="🎯 Hook" text={idea.hook} highlight />
          )}
          {idea.painPoint && (
            <Field label="💥 Pain point" text={idea.painPoint} />
          )}
          {idea.copy && (
            <Field label="📝 Copy patterns" text={idea.copy} />
          )}
          {idea.guion && (
            <details className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
              <summary className="cursor-pointer px-3 py-2 text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                🎬 Guión / transcripción
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
