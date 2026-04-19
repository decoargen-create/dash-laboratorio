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
  Inbox, Search, Filter, ExternalLink, Trash2,
  ChevronDown, Check, Circle, CircleDot, Archive, Edit3,
} from 'lucide-react';
import {
  loadIdeas, updateIdea, removeIdea, TIPO_META, ESTADO_META,
} from './bandejaStore.js';

export default function BandejaSection({ addToast }) {
  const [ideas, setIdeas] = useState(() => loadIdeas());
  const [expandedId, setExpandedId] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('all');
  const [filtroEstado, setFiltroEstado] = useState('active'); // 'all' | 'active' (pendiente + en_uso) | 'pendiente' | 'en_uso' | 'usada' | 'archivada'
  const [query, setQuery] = useState('');
  const [editandoNotasId, setEditandoNotasId] = useState(null);
  const [notasDraft, setNotasDraft] = useState('');

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
    if (estado === 'usada') patch.usedAt = new Date().toISOString();
    const list = updateIdea(id, patch);
    setIdeas(list);
    addToast?.({ type: 'success', message: `Idea → ${ESTADO_META[estado].label}` });
  };

  const handleRemove = (id) => {
    if (!window.confirm('¿Borrar esta idea? No se puede deshacer.')) return;
    setIdeas(removeIdea(id));
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
}) {
  const tipo = TIPO_META[idea.tipo] || TIPO_META.desde_cero;
  const estado = ESTADO_META[idea.estado] || ESTADO_META.pendiente;
  const usada = idea.estado === 'usada' || idea.estado === 'archivada';

  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-xl overflow-hidden shadow-sm transition ${
      usada
        ? 'border-gray-200 dark:border-gray-700 opacity-70'
        : 'border-gray-200 dark:border-gray-700 hover:border-fuchsia-300 dark:hover:border-fuchsia-700'
    }`}>
      {/* Header siempre visible */}
      <div className="px-4 py-3 flex items-start gap-3">
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
