// Módulo "Bocetos Senydrop".
//
// Flujo: asignás un cliente, pegás una o más URLs de productos (o una URL de
// colección con muchos productos), la IA los scrapea y los deja en una lista
// de PENDIENTES. Ahí revisás cada uno (nombre, SKU, imagen, variantes) y
// aprobás / descartás. Los aprobados van a la lista de guardados y se pueden
// exportar como JSON para migrar al repo real de senydrop.com.
//
// Persistencia:
//   - viora-bocetos-v1           : array de bocetos APROBADOS
//   - viora-bocetos-clientes-v1  : array de clientes
//   - viora-bocetos-last-cliente : id del último cliente usado
//
// Estética: paleta Senydrop (amarillo #FFD33D) con inputs blancos + shadow-sm
// + bordes redondeados más marcados para que se sienta la ergonomía.

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Plus, Trash2, Download, Upload, Edit2, Package, Image as ImageIcon,
  Save, X, Check, Sparkles, Link as LinkIcon, Loader2, ChevronDown, UserPlus,
  List as ListIcon, LayoutGrid, ExternalLink, AlertTriangle, RefreshCw,
} from 'lucide-react';

const STORAGE_KEY_BOCETOS = 'viora-bocetos-v1';
const STORAGE_KEY_CLIENTES = 'viora-bocetos-clientes-v1';
const STORAGE_KEY_LAST_CLIENTE = 'viora-bocetos-last-cliente';
const MAX_IMG_BYTES = 1024 * 1024;

// Clientes de ejemplo para arrancar con algo cargado. Si el user ya tiene
// clientes guardados no los pisa.
const CLIENTES_SEED = [
  { id: 1, nombre: 'Agustin Samara' },
  { id: 2, nombre: 'Andi Caminos' },
  { id: 3, nombre: 'Valentin Aguiar' },
];

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error('localStorage fail:', e); }
}

function loadClientes() {
  const cli = loadJSON(STORAGE_KEY_CLIENTES, null);
  if (Array.isArray(cli) && cli.length > 0) return cli;
  return CLIENTES_SEED;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Sin archivo'));
    if (file.size > MAX_IMG_BYTES) {
      return reject(new Error(`La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)}MB. Máximo 1MB.`));
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

// Iniciales de un cliente para mostrar en el SKU preview.
function iniciales(nombre) {
  const parts = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'XX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function BocetosSection({ addToast }) {
  const [bocetos, setBocetos] = useState(() => loadJSON(STORAGE_KEY_BOCETOS, []));
  const [clientes, setClientes] = useState(() => loadClientes());
  const [clienteId, setClienteId] = useState(() => {
    const saved = loadJSON(STORAGE_KEY_LAST_CLIENTE, null);
    return saved ?? loadClientes()[0]?.id ?? null;
  });

  const [mode, setMode] = useState('batch'); // 'batch' | 'collection'
  const [urlsText, setUrlsText] = useState('');
  const [collectionUrl, setCollectionUrl] = useState('');
  const [scraping, setScraping] = useState(false);

  // Pendientes: scrapeados pero sin aprobar. NO se persisten en localStorage
  // (son efímeros — si recargás se pierden, idea que aprobes o descartes
  // antes de cerrar). Si hace falta persistir avisame.
  const [pending, setPending] = useState([]);

  // Layout del pending review.
  const [layout, setLayout] = useState('list'); // 'list' | 'grid'

  // Form de nuevo cliente inline.
  const [newClienteName, setNewClienteName] = useState('');
  const [showNewCliente, setShowNewCliente] = useState(false);

  const importInputRef = useRef(null);

  useEffect(() => { saveJSON(STORAGE_KEY_BOCETOS, bocetos); }, [bocetos]);
  useEffect(() => { saveJSON(STORAGE_KEY_CLIENTES, clientes); }, [clientes]);
  useEffect(() => { if (clienteId != null) saveJSON(STORAGE_KEY_LAST_CLIENTE, clienteId); }, [clienteId]);

  const clienteSeleccionado = useMemo(
    () => clientes.find(c => c.id === clienteId) || null,
    [clientes, clienteId]
  );

  // ---------- Cliente CRUD ----------

  const handleAddCliente = () => {
    const nombre = newClienteName.trim();
    if (!nombre) return;
    const nuevo = { id: Date.now(), nombre };
    setClientes(prev => [...prev, nuevo]);
    setClienteId(nuevo.id);
    setNewClienteName('');
    setShowNewCliente(false);
    addToast?.({ type: 'success', message: `Cliente "${nombre}" agregado` });
  };

  const handleDeleteCliente = (id) => {
    const cli = clientes.find(c => c.id === id);
    if (!cli) return;
    if (!window.confirm(`¿Borrar el cliente "${cli.nombre}"? Los bocetos no se borran, pero pierden la referencia.`)) return;
    setClientes(prev => prev.filter(c => c.id !== id));
    if (clienteId === id) {
      setClienteId(clientes.find(c => c.id !== id)?.id ?? null);
    }
  };

  // ---------- Scrape ----------

  const handleScrape = async () => {
    if (!clienteSeleccionado) { addToast?.({ type: 'error', message: 'Elegí un cliente primero' }); return; }
    let payload;
    if (mode === 'batch') {
      const urls = urlsText.split('\n').map(s => s.trim()).filter(Boolean);
      if (urls.length === 0) { addToast?.({ type: 'error', message: 'Pegá al menos una URL' }); return; }
      payload = { urls, clienteNombre: clienteSeleccionado.nombre };
    } else {
      const col = collectionUrl.trim();
      if (!col) { addToast?.({ type: 'error', message: 'Pegá el link de la colección' }); return; }
      payload = { collectionUrl: col, clienteNombre: clienteSeleccionado.nombre };
    }

    setScraping(true);
    try {
      const resp = await fetch('/api/scrape-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const prods = Array.isArray(data.productos) ? data.productos : [];
      if (prods.length === 0) throw new Error('No se trajo ningún producto');
      // Cada pendiente tiene un id temporal y se enriquece con cliente.
      const nuevos = prods.map(p => ({
        _tempId: Date.now() + Math.random(),
        _status: 'pending',
        clienteId: clienteSeleccionado.id,
        clienteNombre: clienteSeleccionado.nombre,
        nombre: p.nombre || '',
        sku: p.sku || '',
        imagen: p.imagen || '',
        url: p.url || '',
        variantes: Array.isArray(p.variantes) ? p.variantes : [],
      }));
      setPending(prev => [...nuevos, ...prev]);
      const errs = Array.isArray(data.errores) ? data.errores.length : 0;
      const msg = `Llegaron ${nuevos.length} producto(s)` + (errs > 0 ? ` · ${errs} fallaron` : '');
      addToast?.({ type: 'success', message: msg });
      if (mode === 'batch') setUrlsText('');
      else setCollectionUrl('');
    } catch (err) {
      addToast?.({ type: 'error', message: err.message || 'Error scrapeando' });
    } finally {
      setScraping(false);
    }
  };

  // ---------- Pending review ----------

  const updatePending = (tempId, patch) => {
    setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, ...patch } : p));
  };

  const removePending = (tempId) => {
    setPending(prev => prev.filter(p => p._tempId !== tempId));
  };

  const handleApprove = (p) => {
    if (!p.nombre.trim() || !p.sku.trim()) {
      addToast?.({ type: 'error', message: 'Nombre y SKU son obligatorios para aprobar' });
      return;
    }
    const boceto = {
      id: Date.now(),
      nombre: p.nombre.trim(),
      sku: p.sku.trim(),
      imagen: p.imagen || '',
      clienteId: p.clienteId,
      cliente: p.clienteNombre,
      url: p.url || '',
      variantes: p.variantes || [],
      createdAt: new Date().toISOString(),
    };
    setBocetos(prev => [boceto, ...prev]);
    removePending(p._tempId);
    addToast?.({ type: 'success', message: `"${boceto.nombre}" aprobado` });
  };

  const handleApproveAll = () => {
    const validos = pending.filter(p => p.nombre.trim() && p.sku.trim());
    if (validos.length === 0) {
      addToast?.({ type: 'error', message: 'Ningún pendiente tiene nombre y SKU completos' });
      return;
    }
    const nuevos = validos.map(p => ({
      id: Date.now() + Math.random(),
      nombre: p.nombre.trim(),
      sku: p.sku.trim(),
      imagen: p.imagen || '',
      clienteId: p.clienteId,
      cliente: p.clienteNombre,
      url: p.url || '',
      variantes: p.variantes || [],
      createdAt: new Date().toISOString(),
    }));
    const validIds = new Set(validos.map(p => p._tempId));
    setBocetos(prev => [...nuevos, ...prev]);
    setPending(prev => prev.filter(p => !validIds.has(p._tempId)));
    addToast?.({ type: 'success', message: `${nuevos.length} boceto(s) aprobados` });
  };

  const handleReplaceImage = async (tempId, file) => {
    try {
      const dataUrl = await fileToDataURL(file);
      updatePending(tempId, { imagen: dataUrl });
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    }
  };

  // ---------- Guardados CRUD ----------

  const handleDeleteSaved = (id) => {
    const b = bocetos.find(x => x.id === id);
    if (!b) return;
    if (!window.confirm(`¿Borrar "${b.nombre}"?`)) return;
    setBocetos(prev => prev.filter(x => x.id !== id));
  };

  // ---------- Export / Import ----------

  const handleExportAll = () => {
    if (bocetos.length === 0) { addToast?.({ type: 'error', message: 'No hay bocetos para exportar' }); return; }
    const stamp = new Date().toISOString().split('T')[0];
    downloadJSON({
      version: 2,
      source: 'laboratorio-viora.bocetos',
      exportedAt: new Date().toISOString(),
      clientes,
      bocetos,
    }, `bocetos-senydrop-${stamp}.json`);
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
      if (Array.isArray(parsed.clientes)) {
        // Mergeamos clientes sin duplicar por nombre.
        setClientes(prev => {
          const existentes = new Set(prev.map(c => c.nombre.toLowerCase()));
          const nuevos = parsed.clientes.filter(c => c.nombre && !existentes.has(c.nombre.toLowerCase()));
          return [...prev, ...nuevos];
        });
      }
      addToast?.({ type: 'success', message: `${items.length} boceto(s) importados` });
    } catch (err) {
      addToast?.({ type: 'error', message: `Error importando: ${err.message}` });
    }
    e.target.value = '';
  };

  // ---------- Render ----------

  const sigBadge = clienteSeleccionado ? iniciales(clienteSeleccionado.nombre) : '—';

  return (
    <div className="-m-4 md:-m-8 min-h-full bg-[#fafaf7]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#FFD33D] flex items-center justify-center shadow-sm">
            <Package size={20} className="text-gray-900" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Bocetos Senydrop</h1>
            <p className="text-xs text-gray-500">Importá productos de Tiendanube/Shopify y armá el catálogo que llevás a senydrop.com</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={importInputRef} type="file" accept="application/json" onChange={handleImport} className="hidden" />
          <button
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition"
          >
            <Upload size={16} /> Importar
          </button>
          <button
            onClick={handleExportAll}
            disabled={bocetos.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-gray-900 bg-[#FFD33D] rounded-lg hover:bg-[#f5c518] shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} /> Exportar ({bocetos.length})
          </button>
        </div>
      </div>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Panel de scraping */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={18} className="text-[#d97706]" />
            <h2 className="text-base font-bold text-gray-900">Importar productos con IA</h2>
          </div>

          {/* Cliente */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Cliente <span className="text-[#d97706]">*</span>
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <select
                  value={clienteId ?? ''}
                  onChange={(e) => setClienteId(Number(e.target.value))}
                  className="w-full pl-3 pr-9 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] shadow-sm transition"
                >
                  {clientes.length === 0 && <option value="">— sin clientes —</option>}
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              <div className="px-3 py-2.5 bg-gray-900 text-[#FFD33D] rounded-lg text-sm font-mono font-bold tracking-wider w-16 text-center shadow-sm">
                {sigBadge}
              </div>
              <button
                type="button"
                onClick={() => setShowNewCliente(v => !v)}
                className="inline-flex items-center gap-1 px-3 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition"
                title="Agregar cliente nuevo"
              >
                <UserPlus size={16} />
              </button>
              {clienteSeleccionado && (
                <button
                  type="button"
                  onClick={() => handleDeleteCliente(clienteSeleccionado.id)}
                  className="inline-flex items-center gap-1 px-3 py-2.5 text-sm text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 shadow-sm transition"
                  title="Borrar cliente"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {showNewCliente && (
              <div className="mt-2 flex gap-2 p-3 bg-[#FFFBEA] border border-[#FFD33D] rounded-lg animate-fade-in">
                <input
                  type="text"
                  value={newClienteName}
                  onChange={(e) => setNewClienteName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCliente(); } }}
                  placeholder="Nombre del cliente (ej: Juan Pérez)"
                  className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] shadow-sm"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleAddCliente}
                  disabled={!newClienteName.trim()}
                  className="px-4 py-2 text-sm font-bold text-gray-900 bg-[#FFD33D] rounded-md hover:bg-[#f5c518] disabled:opacity-40 transition"
                >
                  Agregar
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewCliente(false); setNewClienteName(''); }}
                  className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Modo: batch vs colección */}
          <div className="mb-4">
            <div className="inline-flex p-1 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setMode('batch')}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition ${mode === 'batch' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                URLs sueltas
              </button>
              <button
                type="button"
                onClick={() => setMode('collection')}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition ${mode === 'collection' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Página completa
              </button>
            </div>
          </div>

          {mode === 'batch' ? (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Links de productos (uno por línea)</label>
              <textarea
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                rows={5}
                placeholder={'https://tienda.com.ar/productos/bolso-rojo\nhttps://tienda.com.ar/productos/mopa-microfibra\nhttps://tienda.com.ar/productos/protector-patas'}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] shadow-sm resize-y transition"
              />
              <p className="text-xs text-gray-500 mt-1">Pegá todos los links que quieras. La IA los procesa en paralelo (máx 25 por vez).</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Link de la colección / listado</label>
              <div className="relative">
                <LinkIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="url"
                  value={collectionUrl}
                  onChange={(e) => setCollectionUrl(e.target.value)}
                  placeholder="https://tienda.com.ar/productos (o /collections/todos)"
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] shadow-sm transition"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">La IA detecta automáticamente los links a productos individuales en la página y los scrapea todos.</p>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleScrape}
              disabled={scraping || !clienteSeleccionado || (mode === 'batch' ? !urlsText.trim() : !collectionUrl.trim())}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-gray-900 bg-[#FFD33D] rounded-lg hover:bg-[#f5c518] shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {scraping ? (
                <><Loader2 size={16} className="animate-spin" /> Procesando…</>
              ) : (
                <><Sparkles size={16} /> Traer productos</>
              )}
            </button>
          </div>
        </div>

        {/* Pending review */}
        {pending.length > 0 && (
          <div className="bg-white rounded-xl border-2 border-[#FFD33D] shadow-sm">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#FFD33D] flex items-center justify-center">
                  <span className="text-sm font-bold text-gray-900">{pending.length}</span>
                </div>
                <h2 className="text-base font-bold text-gray-900">Pendientes de aprobación</h2>
                <span className="text-xs text-gray-500">Revisá cada uno antes de guardar</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex p-1 bg-gray-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setLayout('list')}
                    className={`p-1.5 rounded-md transition ${layout === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                    title="Listado"
                  >
                    <ListIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayout('grid')}
                    className={`p-1.5 rounded-md transition ${layout === 'grid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                    title="Cards"
                  >
                    <LayoutGrid size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setPending([])}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition"
                >
                  <X size={12} /> Descartar todos
                </button>
                <button
                  type="button"
                  onClick={handleApproveAll}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-gray-900 bg-[#FFD33D] rounded-md hover:bg-[#f5c518] transition"
                >
                  <Check size={12} /> Aprobar todos
                </button>
              </div>
            </div>

            <div className={layout === 'list' ? 'divide-y divide-gray-100' : 'p-4 grid grid-cols-1 md:grid-cols-2 gap-3'}>
              {pending.map(p => (
                <PendingItem
                  key={p._tempId}
                  item={p}
                  layout={layout}
                  onChange={(patch) => updatePending(p._tempId, patch)}
                  onApprove={() => handleApprove(p)}
                  onDiscard={() => removePending(p._tempId)}
                  onReplaceImage={(file) => handleReplaceImage(p._tempId, file)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Guardados */}
        <div>
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
            Bocetos aprobados ({bocetos.length})
          </h2>
          {bocetos.length === 0 ? (
            <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
              <ImageIcon size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Todavía no hay bocetos aprobados.</p>
              <p className="text-xs text-gray-400 mt-1">Importá productos arriba y aprobalos cuando revises los datos.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {bocetos.map(b => (
                <div key={b.id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex gap-3 hover:border-gray-300 transition">
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
                    <div className="flex items-center gap-2 mt-1">
                      {b.cliente && <p className="text-[11px] text-[#d97706] truncate">{b.cliente}</p>}
                      {Array.isArray(b.variantes) && b.variantes.length > 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-700 rounded">
                          {b.variantes.length} var.
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-2">
                      {b.url && (
                        <a href={b.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-[#d97706] hover:bg-[#FFFBEA] rounded transition" title={b.url}>
                          <ExternalLink size={12} /> Ver
                        </a>
                      )}
                      <button onClick={() => handleDeleteSaved(b.id)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition">
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

// ---------- Pending item (inline editor) ----------

function PendingItem({ item, layout, onChange, onApprove, onDiscard, onReplaceImage }) {
  const fileRef = useRef(null);
  const missing = !item.nombre.trim() || !item.sku.trim();

  const content = (
    <div className="flex gap-4">
      {/* Imagen */}
      <div className="shrink-0">
        <div className="w-24 h-24 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center relative group">
          {item.imagen ? (
            <img src={item.imagen} alt={item.nombre} className="w-full h-full object-cover" />
          ) : (
            <ImageIcon size={28} className="text-gray-300" />
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="absolute inset-0 bg-black/50 text-white text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1"
          >
            <RefreshCw size={12} /> Cambiar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReplaceImage(f);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>
      </div>

      {/* Campos */}
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Nombre</label>
          <input
            type="text"
            value={item.nombre}
            onChange={(e) => onChange({ nombre: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] shadow-sm transition"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">SKU</label>
          <input
            type="text"
            value={item.sku}
            onChange={(e) => onChange({ sku: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-900 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#FFD33D] focus:border-[#FFD33D] shadow-sm transition"
          />
        </div>
        {/* Variantes */}
        {item.variantes && item.variantes.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Variantes ({item.variantes.length})</label>
            <div className="flex flex-wrap gap-1">
              {item.variantes.map((v, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-[11px]">
                  <span className="text-gray-400">{v.tipo}:</span> {v.valor}
                  <button
                    onClick={() => onChange({ variantes: item.variantes.filter((_, i) => i !== idx) })}
                    className="hover:text-red-600"
                    aria-label="Quitar variante"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {missing && (
          <div className="flex items-center gap-1 text-[11px] text-amber-700">
            <AlertTriangle size={12} /> Nombre y SKU son obligatorios
          </div>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#d97706] transition">
            <ExternalLink size={11} /> Ver original
          </a>
        )}
      </div>

      {/* Acciones */}
      <div className="shrink-0 flex flex-col gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={missing}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-gray-900 bg-[#FFD33D] rounded-md hover:bg-[#f5c518] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={12} /> Aprobar
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
        >
          <X size={12} /> Descartar
        </button>
      </div>
    </div>
  );

  return (
    <div className={layout === 'list' ? 'p-4 hover:bg-gray-50 transition' : 'p-4 rounded-lg border border-gray-200 hover:border-gray-300 transition'}>
      {content}
    </div>
  );
}
