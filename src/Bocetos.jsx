// Módulo "Bocetos Senydrop".
//
// Este módulo vive DENTRO del panel del Laboratorio Viora pero es para otro
// proyecto (senydrop.com). La idea es armar bocetos de productos (nombre +
// imagen + SKU) y después exportarlos como JSON para migrarlos al repo real
// de Senydrop.
//
// Persistencia: localStorage bajo la key `viora-bocetos-v1`.
// Export: botón que descarga un JSON con todos los bocetos (incluyendo las
// imágenes como data URLs base64).
//
// Estética: intenta replicar el look&feel de Senydrop (amarillo #F5C518,
// fondo gris claro, cards blancas con bordes sutiles) para que el admin
// sienta que está maquetando directamente sobre senydrop.com.

import React, { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Download, Upload, Edit2, Package, Image as ImageIcon, Save, X, Check } from 'lucide-react';

const STORAGE_KEY = 'viora-bocetos-v1';
const MAX_IMG_BYTES = 1024 * 1024; // 1MB — localStorage tiene ~5MB total.

function loadBocetos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveBocetos(bocetos) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bocetos)); }
  catch (e) { console.error('No se pudo guardar bocetos:', e); }
}

// Convierte un File a data URL base64. Rechaza archivos grandes porque
// localStorage tiene ~5MB y si metemos imágenes de 5MB cada una rompe todo.
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Sin archivo'));
    if (file.size > MAX_IMG_BYTES) {
      return reject(new Error(`La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)}MB. Máximo 1MB — comprimila o redimensionala.`));
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Error leyendo imagen'));
    reader.readAsDataURL(file);
  });
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BocetosSection({ addToast }) {
  const [bocetos, setBocetos] = useState(() => loadBocetos());
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ nombre: '', sku: '', imagen: '' });
  const fileInputRef = useRef(null);
  const importInputRef = useRef(null);

  useEffect(() => { saveBocetos(bocetos); }, [bocetos]);

  const resetForm = () => {
    setForm({ nombre: '', sku: '', imagen: '' });
    setEditingId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataURL(file);
      setForm(prev => ({ ...prev, imagen: dataUrl }));
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
      e.target.value = '';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const nombre = form.nombre.trim();
    const sku = form.sku.trim();
    if (!nombre || !sku) {
      addToast?.({ type: 'error', message: 'Nombre y SKU son obligatorios' });
      return;
    }
    if (editingId) {
      setBocetos(prev => prev.map(b => b.id === editingId ? { ...b, nombre, sku, imagen: form.imagen, updatedAt: new Date().toISOString() } : b));
      addToast?.({ type: 'success', message: `Boceto "${nombre}" actualizado` });
    } else {
      const newBoceto = {
        id: Date.now(),
        nombre, sku,
        imagen: form.imagen,
        createdAt: new Date().toISOString(),
      };
      setBocetos(prev => [newBoceto, ...prev]);
      addToast?.({ type: 'success', message: `Boceto "${nombre}" guardado` });
    }
    resetForm();
  };

  const handleEdit = (boceto) => {
    setEditingId(boceto.id);
    setForm({ nombre: boceto.nombre, sku: boceto.sku, imagen: boceto.imagen || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (boceto) => {
    if (!window.confirm(`¿Borrar el boceto "${boceto.nombre}"?`)) return;
    setBocetos(prev => prev.filter(b => b.id !== boceto.id));
    if (editingId === boceto.id) resetForm();
    addToast?.({ type: 'success', message: 'Boceto eliminado' });
  };

  const handleExportAll = () => {
    if (bocetos.length === 0) {
      addToast?.({ type: 'error', message: 'No hay bocetos para exportar' });
      return;
    }
    const stamp = new Date().toISOString().split('T')[0];
    downloadJSON({ version: 1, source: 'laboratorio-viora.bocetos', exportedAt: new Date().toISOString(), bocetos }, `bocetos-senydrop-${stamp}.json`);
    addToast?.({ type: 'success', message: `${bocetos.length} boceto(s) exportados` });
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : parsed.bocetos;
      if (!Array.isArray(items)) throw new Error('Formato inválido');
      setBocetos(prev => [...items, ...prev]);
      addToast?.({ type: 'success', message: `${items.length} boceto(s) importados` });
    } catch (err) {
      addToast?.({ type: 'error', message: `Error importando: ${err.message}` });
    }
    e.target.value = '';
  };

  return (
    <div className="-m-4 md:-m-8 min-h-full bg-[#fafaf7]">
      {/* Header estilo Senydrop */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#FFD33D] flex items-center justify-center shadow-sm">
            <Package size={20} className="text-gray-900" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Bocetos Senydrop</h1>
            <p className="text-xs text-gray-500">Maquetá productos y exportalos como JSON para migrarlos a senydrop.com</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={importInputRef} type="file" accept="application/json" onChange={handleImport} className="hidden" />
          <button
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            <Upload size={16} /> Importar
          </button>
          <button
            onClick={handleExportAll}
            disabled={bocetos.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-gray-900 bg-[#FFD33D] rounded-lg hover:bg-[#f5c518] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} /> Exportar JSON ({bocetos.length})
          </button>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6 max-w-7xl mx-auto">
        {/* Columna izquierda: formulario */}
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-900 flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">ⓘ</span>
            <span>Los campos con asterisco (<span className="text-[#d97706]">*</span>) son obligatorios.</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
              <h2 className="text-base font-bold text-gray-900">Nombre y SKU</h2>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Nombre <span className="text-[#d97706]">*</span>
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: Bolso portatrajes rojo"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] transition"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  SKU Senydrop <span className="text-[#d97706]">*</span>
                </label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="BARRA-PORTAT-ROJ"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] transition"
                  required
                />
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-5 mt-4">
              <h2 className="text-base font-bold text-gray-900 mb-4">Foto</h2>
              {form.imagen ? (
                <div className="relative inline-block group">
                  <img src={form.imagen} alt="Preview" className="max-h-56 rounded-md border border-gray-200" />
                  <button
                    type="button"
                    onClick={() => { setForm({ ...form, imagen: '' }); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white shadow border border-gray-200 hover:bg-red-50 hover:border-red-200 text-gray-700 hover:text-red-600 flex items-center justify-center transition"
                    aria-label="Quitar foto"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-900 bg-white border border-[#FFD33D] rounded-md hover:bg-[#FFFBEA] transition"
                >
                  <Upload size={16} /> Subir foto
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              <p className="text-xs text-gray-500 mt-2">Máximo 1MB. PNG, JPG o WebP.</p>
            </div>

            <div className="mt-6 flex items-center gap-3 justify-end">
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  <X size={16} /> Cancelar edición
                </button>
              )}
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-6 py-2 text-sm font-bold text-gray-900 bg-[#FFD33D] rounded-lg hover:bg-[#f5c518] transition"
              >
                {editingId ? <><Check size={16} /> Guardar cambios</> : <><Save size={16} /> Guardar boceto</>}
              </button>
            </div>
          </form>
        </div>

        {/* Columna derecha: listado */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Bocetos guardados ({bocetos.length})</h2>
          </div>
          {bocetos.length === 0 ? (
            <div className="bg-white rounded-lg border-2 border-dashed border-gray-200 p-12 text-center">
              <ImageIcon size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Todavía no tenés bocetos. Cargá el primero desde el formulario.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {bocetos.map(b => (
                <div key={b.id} className={`bg-white rounded-lg border p-4 flex gap-3 transition ${editingId === b.id ? 'border-[#FFD33D] shadow-md ring-2 ring-[#FFD33D]/30' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="shrink-0 w-20 h-20 rounded-md bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center">
                    {b.imagen ? (
                      <img src={b.imagen} alt={b.nombre} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={24} className="text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 truncate">{b.nombre}</p>
                    <p className="text-xs text-gray-500 font-mono truncate mt-0.5">{b.sku}</p>
                    <div className="flex items-center gap-1 mt-2">
                      <button
                        onClick={() => handleEdit(b)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded transition"
                      >
                        <Edit2 size={12} /> Editar
                      </button>
                      <button
                        onClick={() => handleDelete(b)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition"
                      >
                        <Trash2 size={12} /> Borrar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
