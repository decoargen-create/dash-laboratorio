// Hub de proyectos: vista de cards donde el admin ve todos sus proyectos
// (Senydrop, etc.) y puede crear nuevos. Cada proyecto tiene su propio
// namespace de datos en localStorage.
//
// Al entrar a un proyecto, carga el módulo ProductosSection (ex BocetosSection)
// pasándole el projectId para que use las keys correctas.

import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Trash2, FolderOpen, Package, ArrowLeft, Palette,
  Settings, ExternalLink, ChevronRight,
} from 'lucide-react';
import ProductosSection from './Bocetos.jsx';

const STORAGE_KEY_PROJECTS = 'viora-projects-v1';

const PROJECT_COLORS = [
  { id: 'yellow', bg: 'bg-[#FFD33D]', text: 'text-gray-900', border: 'border-[#f5c518]', light: 'bg-[#FFFBEA]' },
  { id: 'blue', bg: 'bg-blue-500', text: 'text-white', border: 'border-blue-600', light: 'bg-blue-50' },
  { id: 'emerald', bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-600', light: 'bg-emerald-50' },
  { id: 'pink', bg: 'bg-pink-500', text: 'text-white', border: 'border-pink-600', light: 'bg-pink-50' },
  { id: 'purple', bg: 'bg-purple-500', text: 'text-white', border: 'border-purple-600', light: 'bg-purple-50' },
  { id: 'orange', bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-600', light: 'bg-orange-50' },
  { id: 'slate', bg: 'bg-slate-700', text: 'text-white', border: 'border-slate-800', light: 'bg-slate-50' },
];

const DEFAULT_PROJECT = {
  id: 'senydrop',
  nombre: 'Senydrop',
  color: 'yellow',
  createdAt: new Date().toISOString(),
};

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROJECTS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch { return null; }
}

function saveProjects(projects) {
  try { localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects)); }
  catch (e) { console.error('saveProjects fail:', e); }
}

// Migración automática: si el user tiene datos de Senydrop en las keys
// viejas (viora-bocetos-v1, etc.) y NO tiene proyectos creados, los
// movemos al namespace del proyecto default 'senydrop'.
function migrateOldDataIfNeeded() {
  const oldKeys = {
    'viora-bocetos-v1': 'viora-proj-senydrop-productos',
    'viora-bocetos-clientes-v1': 'viora-proj-senydrop-clientes',
    'viora-bocetos-last-cliente': 'viora-proj-senydrop-last-cliente',
    'viora-bocetos-ai-config-v1': 'viora-proj-senydrop-ai-config',
  };
  let migrated = false;
  for (const [oldKey, newKey] of Object.entries(oldKeys)) {
    try {
      const data = localStorage.getItem(oldKey);
      if (data && !localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, data);
        migrated = true;
      }
    } catch {}
  }
  return migrated;
}

// Cuenta productos aprobados de un proyecto.
function countProductos(projectId) {
  try {
    const raw = localStorage.getItem(`viora-proj-${projectId}-productos`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch { return 0; }
}

function getColor(colorId) {
  return PROJECT_COLORS.find(c => c.id === colorId) || PROJECT_COLORS[0];
}

export default function ProyectosSection({ addToast }) {
  const [projects, setProjects] = useState(() => {
    migrateOldDataIfNeeded();
    return loadProjects() || [DEFAULT_PROJECT];
  });
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('blue');

  useEffect(() => { saveProjects(projects); }, [projects]);

  const activeProject = useMemo(
    () => projects.find(p => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  const handleCreate = () => {
    const nombre = newName.trim();
    if (!nombre) { addToast?.({ type: 'error', message: 'Poné un nombre' }); return; }
    const id = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 30) + '-' + Date.now().toString(36);
    const nuevo = { id, nombre, color: newColor, createdAt: new Date().toISOString() };
    setProjects(prev => [...prev, nuevo]);
    setNewName('');
    setNewColor('blue');
    setShowNew(false);
    addToast?.({ type: 'success', message: `Proyecto "${nombre}" creado` });
  };

  const handleDelete = (proj) => {
    if (!window.confirm(`¿Borrar el proyecto "${proj.nombre}" y TODOS sus productos? Esta acción no se puede deshacer.`)) return;
    // Limpiamos las keys de localStorage del proyecto.
    const prefix = `viora-proj-${proj.id}-`;
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch {}
    setProjects(prev => prev.filter(p => p.id !== proj.id));
    if (activeProjectId === proj.id) setActiveProjectId(null);
    addToast?.({ type: 'success', message: `Proyecto "${proj.nombre}" eliminado` });
  };

  // Si estamos dentro de un proyecto, render el módulo de Productos con su
  // projectId. El breadcrumb arriba permite volver al hub.
  if (activeProject) {
    const color = getColor(activeProject.color);
    return (
      <div className="-m-4 md:-m-8 min-h-full bg-[#fafaf7]">
        {/* Breadcrumb */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-2">
          <button
            onClick={() => setActiveProjectId(null)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-900 transition"
          >
            <ArrowLeft size={16} /> Proyectos
          </button>
          <ChevronRight size={14} className="text-gray-400" />
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded ${color.bg} flex items-center justify-center`}>
              <Package size={12} className={color.text} />
            </div>
            <span className="text-sm font-bold text-gray-900">{activeProject.nombre}</span>
          </div>
        </div>

        {/* Módulo de productos con el namespace del proyecto */}
        <ProductosSection
          addToast={addToast}
          projectId={activeProject.id}
          projectName={activeProject.nombre}
          projectColor={activeProject.color}
        />
      </div>
    );
  }

  // Hub: listado de proyectos como cards.
  return (
    <div className="-m-4 md:-m-8 min-h-full bg-[#fafaf7]">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Proyectos</h1>
          <p className="text-xs text-gray-500 mt-0.5">Cada proyecto tiene sus propios productos, clientes e IA. Creá uno por marca o tienda.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-gray-900 bg-[#FFD33D] rounded-lg hover:bg-[#f5c518] shadow-sm transition"
        >
          <Plus size={16} /> Nuevo proyecto
        </button>
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        {/* Form nuevo proyecto */}
        {showNew && (
          <div className="bg-white rounded-xl border-2 border-[#FFD33D] shadow-sm p-5 mb-6 animate-fade-in">
            <h3 className="text-base font-bold text-gray-900 mb-4">Crear proyecto</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nombre del proyecto</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
                  placeholder="Ej: Senydrop, Mi Tienda, Casa en Orden..."
                  className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] shadow-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Color</label>
                <div className="flex gap-2">
                  {PROJECT_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setNewColor(c.id)}
                      className={`w-8 h-8 rounded-lg ${c.bg} transition-all ${newColor === c.id ? 'ring-2 ring-offset-2 ring-gray-900 scale-110' : 'hover:scale-105'}`}
                      title={c.id}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => { setShowNew(false); setNewName(''); }}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="px-6 py-2 text-sm font-bold text-gray-900 bg-[#FFD33D] rounded-lg hover:bg-[#f5c518] shadow-sm transition disabled:opacity-40"
                >
                  Crear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grid de proyectos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(proj => {
            const color = getColor(proj.color);
            const count = countProductos(proj.id);
            return (
              <button
                key={proj.id}
                onClick={() => setActiveProjectId(proj.id)}
                className={`group relative text-left bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300 transition-all p-5`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-xl ${color.bg} flex items-center justify-center shadow-sm`}>
                    <Package size={22} className={color.text} />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(proj); }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition"
                    title="Borrar proyecto"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-1">{proj.nombre}</h3>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{count} producto{count !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>Creado {new Date(proj.createdAt).toLocaleDateString('es-AR')}</span>
                </div>
                <div className="absolute bottom-4 right-4 text-gray-400 group-hover:text-gray-600 transition">
                  <ChevronRight size={18} />
                </div>
              </button>
            );
          })}

          {/* Card de "agregar" */}
          {!showNew && (
            <button
              onClick={() => setShowNew(true)}
              className="text-left rounded-xl border-2 border-dashed border-gray-300 hover:border-[#FFD33D] hover:bg-[#FFFBEA] p-5 transition-all flex flex-col items-center justify-center min-h-[160px] gap-2"
            >
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                <Plus size={22} className="text-gray-400" />
              </div>
              <span className="text-sm font-semibold text-gray-500">Nuevo proyecto</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
