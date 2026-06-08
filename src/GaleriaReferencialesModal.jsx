// Modal galería — repositorio de creativos referenciales generados.
//
// Features:
// - 3 vistas (grid / lista / tabla) persistidas en localStorage
// - Multi-select numerado (1, 2, 3...) con orden de selección
// - Bulk download como ZIP (jszip)
// - Status tracking: items descargados quedan marcados con badge + fecha
//   → cuando seleccionás de nuevo te avisa cuáles ya bajaste antes
// - Filtro "Solo no descargados" para no perder de vista lo nuevo
// - Lightbox comparativo ref vs variación con panel debug skeleton+prompt

import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Download, Trash2, Images, ChevronDown, ChevronUp, ExternalLink,
  LayoutGrid, Rows3, Table2, Plus, Check, FileArchive, EyeOff, Eye,
} from 'lucide-react';
import JSZip from 'jszip';
import { getReferencialesByProducto, deleteReferencial, patchReferenciales } from './galeriaReferenciales.js';

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return ''; }
}

// Convierte base64 a Blob para JSZip / download.
function base64ToBlob(b64, mimeType = 'image/png') {
  const byteChars = atob(b64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().slice(0, 40);
}

// Capitalize: primera letra mayúscula, resto lowercase.
function capit(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Toma la primera palabra "limpia" (sin marcas raras) de un nombre.
function firstWord(s) {
  const m = String(s || '').match(/[A-Za-zÁ-Úá-úÑñ0-9]+/);
  return m ? m[0] : '';
}

// Construye filename según el patrón pedido: "Producto 9-6 Estatico Brand.png"
// Producto = primera palabra del producto, capitalizada
// 9-6     = día-mes del createdAt
// Formato = "Estatico" (1:1) | "Story" (vertical) | etc.
// Brand   = primera palabra del sourceBrand, capitalizada
// Si hay variantStyle=rebrand se sufija " Rebrand"
function buildFileName(it, productoNombre) {
  const prod = capit(firstWord(productoNombre)) || 'Creativo';
  const d = it.createdAt ? new Date(it.createdAt) : new Date();
  const dateStr = `${d.getDate()}-${d.getMonth() + 1}`;
  const formato = it.size === '1024x1536' ? 'Story'
    : it.size === '1536x1024' ? 'Landscape'
    : 'Estatico';
  const brand = capit(firstWord(it.sourceBrand)) || 'Ref';
  const rebrand = it.variantStyle === 'rebrand' ? ' Rebrand' : '';
  // Numeral de variante para evitar colisiones cuando hay 2+ de la misma combinación.
  const variantSuffix = it.variantIndex != null ? ` v${it.variantIndex + 1}` : '';
  return `${prod} ${dateStr} ${formato} ${brand}${rebrand}${variantSuffix}.png`;
}

export default function GaleriaReferencialesModal({ productoId, productoNombre, onClose }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  // Vista: 'grid' | 'list' | 'table'. Persistida.
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('viora-galeria-view') || 'grid'; }
    catch { return 'grid'; }
  });
  const setMode = (m) => {
    setViewMode(m);
    try { localStorage.setItem('viora-galeria-view', m); } catch {}
  };
  // Multi-select. Set preserva orden de inserción.
  const [seleccionados, setSeleccionados] = useState(new Set());
  const selectedOrder = useMemo(() => {
    const m = new Map();
    let i = 0;
    for (const id of seleccionados) m.set(id, ++i);
    return m;
  }, [seleccionados]);
  // Filtro: ocultar los ya descargados (default off).
  const [soloNoDescargados, setSoloNoDescargados] = useState(false);
  const [zipping, setZipping] = useState(false);

  const refresh = () => {
    setCargando(true);
    getReferencialesByProducto(productoId)
      .then(setItems)
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    refresh();
    const onSaved = (e) => {
      const detailId = e?.detail?.productoId;
      // Si el evento es del mismo producto O no trae productoId (patch global), refresh.
      if (!detailId || String(detailId) === String(productoId)) refresh();
    };
    window.addEventListener('viora:referencial-saved', onSaved);
    return () => window.removeEventListener('viora:referencial-saved', onSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (selected) setSelected(null); else onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, onClose]);

  const toggleSeleccion = (id) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const limpiarSeleccion = () => setSeleccionados(new Set());
  const seleccionarTodos = () => setSeleccionados(new Set(visibleItems.map(i => i.id)));

  const handleDelete = async (id) => {
    if (!window.confirm('¿Borrar este creativo referencial?')) return;
    await deleteReferencial(id);
    setSelected(null);
    setSeleccionados(prev => { const n = new Set(prev); n.delete(id); return n; });
    refresh();
  };

  // Bulk download como ZIP. Marca todos los descargados con timestamp.
  const handleBulkDownload = async () => {
    if (seleccionados.size === 0) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const seleccionadosArr = items.filter(it => seleccionados.has(it.id));
      const yaDescargados = seleccionadosArr.filter(it => it.descargada).length;
      if (yaDescargados > 0) {
        const cont = window.confirm(
          `Atención: ${yaDescargados} de los ${seleccionadosArr.length} seleccionados ya los descargaste antes. ¿Querés descargarlos otra vez?`
        );
        if (!cont) {
          setZipping(false);
          return;
        }
      }
      // Trackear nombres usados para evitar colisiones (ej. mismo producto +
      // fecha + brand → agregar _2, _3, etc).
      const usedNames = new Set();
      seleccionadosArr.forEach((it) => {
        let name = buildFileName(it, productoNombre);
        let dedup = 1;
        const base = name.replace(/\.png$/, '');
        while (usedNames.has(name)) {
          name = `${base} (${++dedup}).png`;
        }
        usedNames.add(name);
        zip.file(name, base64ToBlob(it.imageBase64, it.mimeType || 'image/png'));
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const zipName = `creativos-${slugify(productoNombre)}-${ts}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      // Marcar todos como descargados con timestamp.
      await patchReferenciales(
        seleccionadosArr.map(it => it.id),
        { descargada: true, descargadaAt: new Date().toISOString() }
      );
      limpiarSeleccion();
      refresh();
    } catch (err) {
      console.error('ZIP error:', err);
      alert(`Error armando ZIP: ${err.message}`);
    } finally {
      setZipping(false);
    }
  };

  // Descarga individual + marca como descargada.
  const handleSingleDownload = async (it) => {
    try {
      const blob = base64ToBlob(it.imageBase64, it.mimeType || 'image/png');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildFileName(it, productoNombre);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await patchReferenciales([it.id], { descargada: true, descargadaAt: new Date().toISOString() });
      refresh();
    } catch (err) {
      alert(`Error descargando: ${err.message}`);
    }
  };

  // Marca/desmarca manualmente como descargada (sin descargar).
  const toggleDescargadaFlag = async (id, currentValue) => {
    await patchReferenciales([id], currentValue
      ? { descargada: false, descargadaAt: null }
      : { descargada: true, descargadaAt: new Date().toISOString() }
    );
    refresh();
  };

  const visibleItems = items.filter(it => !soloNoDescargados || !it.descargada);
  const yaDescargadosCount = items.filter(it => it.descargada).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <Images size={18} className="text-brand-500 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">Repositorio de creativos</h3>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                {productoNombre} · {items.length} creativo{items.length !== 1 ? 's' : ''}
                {yaDescargadosCount > 0 && ` · ${yaDescargadosCount} ya descargado${yaDescargadosCount !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Filtro: solo no descargados */}
            <button
              onClick={() => setSoloNoDescargados(s => !s)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold rounded-md transition ${
                soloNoDescargados
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              title="Filtrar para ver solo los que no descargaste"
            >
              {soloNoDescargados ? <Eye size={11} /> : <EyeOff size={11} />}
              {soloNoDescargados ? 'Solo no descargados' : 'Todos'}
            </button>
            {/* Vista toggle */}
            <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-md p-0.5">
              {[
                { v: 'grid',  Icon: LayoutGrid, label: 'Grid'   },
                { v: 'list',  Icon: Rows3,      label: 'Lista'  },
                { v: 'table', Icon: Table2,     label: 'Tabla'  },
              ].map(({ v, Icon, label }) => (
                <button key={v}
                  onClick={() => setMode(v)}
                  className={`p-1.5 rounded transition ${viewMode === v
                    ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-300 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100'}`}
                  title={`Ver como ${label}`}
                >
                  <Icon size={12} />
                </button>
              ))}
            </div>
            <button onClick={onClose}
              className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 max-h-[75vh] overflow-y-auto">
          {cargando ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-12">Cargando…</p>
          ) : items.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              <Images size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Sin referenciales todavía</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Elegí ads en Inspiración y dale "Crear creativo" — los generados aparecen acá.
              </p>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              <Check size={32} className="mx-auto text-emerald-400 mb-2" />
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">¡Todo descargado!</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Apagá el filtro "Solo no descargados" para ver todo el repositorio.
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <GalleryGridView items={visibleItems} seleccionados={seleccionados} selectedOrder={selectedOrder}
              onToggleSelect={toggleSeleccion} onOpen={setSelected} />
          ) : viewMode === 'list' ? (
            <GalleryListView items={visibleItems} seleccionados={seleccionados} selectedOrder={selectedOrder}
              onToggleSelect={toggleSeleccion} onOpen={setSelected}
              onDownload={handleSingleDownload} onToggleDescargada={toggleDescargadaFlag} onDelete={handleDelete} />
          ) : (
            <GalleryTableView items={visibleItems} seleccionados={seleccionados} selectedOrder={selectedOrder}
              onToggleSelect={toggleSeleccion} onOpen={setSelected}
              onDownload={handleSingleDownload} onToggleDescargada={toggleDescargadaFlag} onDelete={handleDelete} />
          )}
        </div>
      </div>

      {/* Barra flotante de bulk action — visible cuando hay seleccionados */}
      {seleccionados.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[55] bg-white dark:bg-gray-800 border-2 border-brand-300 dark:border-brand-700 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 max-w-[calc(100vw-3rem)]">
          <div className="text-xs">
            <span className="font-bold text-gray-900 dark:text-gray-100">{seleccionados.size}</span>
            <span className="text-gray-500 dark:text-gray-400"> seleccionado{seleccionados.size !== 1 ? 's' : ''}</span>
          </div>
          <button onClick={limpiarSeleccion}
            className="text-[11px] text-gray-500 hover:text-red-500 transition">
            Limpiar
          </button>
          <button onClick={seleccionarTodos}
            className="text-[11px] text-brand-600 hover:text-brand-700 transition">
            Seleccionar todos los visibles
          </button>
          <button
            onClick={handleBulkDownload}
            disabled={zipping}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-700 hover:to-brand-600 transition disabled:opacity-60"
          >
            {zipping ? <span className="animate-spin">⏳</span> : <FileArchive size={13} />}
            {zipping ? 'Armando ZIP…' : `Descargar ZIP (${seleccionados.size})`}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {selected && (
        <Lightbox
          item={selected}
          onClose={() => { setSelected(null); setShowDebug(false); }}
          showDebug={showDebug}
          setShowDebug={setShowDebug}
          onDownload={() => handleSingleDownload(selected)}
          onDelete={() => handleDelete(selected.id)}
          onToggleDescargada={() => toggleDescargadaFlag(selected.id, !!selected.descargada)}
        />
      )}
    </div>
  );
}

// Componente reusable: thumb que al hover muestra preview grande de la
// variación + del ad original side-by-side. Aparece flotando al lado del
// thumb (right por default; flip a left si está cerca del borde derecho).
function HoverPreview({ item, children, className = '' }) {
  return (
    <div className={`group/preview relative ${className}`}>
      {children}
      <div className="hidden group-hover/preview:flex absolute left-full top-0 ml-2 z-[70] gap-2 pointer-events-none">
        {/* Inspiración original */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl border-2 border-gray-200 dark:border-gray-700 p-1.5 w-72">
          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1 text-center">
            ANTES — {item.sourceBrand || 'inspiración'}
          </p>
          {item.sourceImageUrl ? (
            <img src={item.sourceImageUrl} alt="" className="w-full max-h-72 object-contain bg-gray-50 dark:bg-gray-800 rounded"
              onError={e => { e.target.style.opacity = '0.3'; }} />
          ) : (
            <div className="w-full h-40 bg-gray-50 dark:bg-gray-800 rounded flex items-center justify-center text-[10px] text-gray-400 italic">
              Sin ref guardada
            </div>
          )}
        </div>
        {/* Variación generada */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl border-2 border-brand-300 dark:border-brand-700 p-1.5 w-72">
          <p className="text-[9px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400 mb-1 text-center">
            DESPUÉS {item.variantStyle === 'rebrand' && '· REBRAND'}
          </p>
          <img src={`data:${item.mimeType || 'image/png'};base64,${item.imageBase64}`} alt=""
            className="w-full max-h-72 object-contain bg-white rounded" />
        </div>
      </div>
    </div>
  );
}

// VISTA 1 — Grid: thumbs cuadrados con número de selección + badge si ya descargado.
function GalleryGridView({ items, seleccionados, selectedOrder, onToggleSelect, onOpen }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {items.map(it => {
        const isSel = seleccionados.has(it.id);
        const selIdx = selectedOrder.get(it.id);
        return (
          <HoverPreview key={it.id} item={it} className="group">
            <button
              onClick={() => onOpen(it)}
              className={`block w-full aspect-square rounded-lg overflow-hidden border-2 transition ${
                isSel
                  ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-900'
                  : it.descargada
                    ? 'border-emerald-200 dark:border-emerald-800 hover:border-emerald-400'
                    : 'border-gray-200 dark:border-gray-700 hover:border-brand-400'
              }`}
            >
              <img
                src={`data:${it.mimeType || 'image/png'};base64,${it.imageBase64}`}
                alt=""
                className="w-full h-full object-cover"
              />
            </button>
            {/* Selector numerado — siempre visible */}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(it.id); }}
              className={`absolute top-2 left-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-md transition-all ${
                isSel
                  ? 'bg-brand-600 text-white scale-110 ring-2 ring-white dark:ring-gray-900'
                  : 'bg-white/90 dark:bg-gray-900/90 text-gray-400 hover:bg-brand-50 hover:text-brand-600 hover:scale-110 opacity-70 group-hover:opacity-100'
              }`}
              title={isSel ? `Seleccionado #${selIdx}` : 'Click para seleccionar'}
            >
              {isSel ? selIdx : <Plus size={14} />}
            </button>
            {/* Badge "descargada" */}
            {it.descargada && (
              <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold text-white bg-emerald-500 rounded-md shadow-md"
                title={`Descargado ${fmtDate(it.descargadaAt)}`}
              >
                <Check size={10} /> ✓
              </div>
            )}
            {/* Footer con brand + variant */}
            <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent text-white pointer-events-none">
              <p className="text-[9px] font-semibold truncate">
                {it.sourceBrand && <span>Ref: {it.sourceBrand}</span>}
                {it.variantStyle === 'rebrand' && <span className="ml-1 px-1 bg-brand-500 rounded text-[8px]">REBRAND</span>}
              </p>
            </div>
          </HoverPreview>
        );
      })}
    </div>
  );
}

// VISTA 2 — Lista: rows con thumb + info + acciones inline.
function GalleryListView({ items, seleccionados, selectedOrder, onToggleSelect, onOpen, onDownload, onToggleDescargada, onDelete }) {
  return (
    <div className="space-y-1.5">
      {items.map(it => {
        const isSel = seleccionados.has(it.id);
        const selIdx = selectedOrder.get(it.id);
        return (
          <div key={it.id}
            className={`flex items-center gap-2.5 p-2 rounded-md border transition ${
              isSel
                ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700'
            }`}
          >
            <button onClick={() => onToggleSelect(it.id)}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition shrink-0 ${
                isSel ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-brand-50 hover:text-brand-600'
              }`}
              title={isSel ? `#${selIdx}` : 'Seleccionar'}
            >
              {isSel ? selIdx : <Plus size={12} />}
            </button>
            <HoverPreview item={it} className="shrink-0">
              <button onClick={() => onOpen(it)}>
                <img
                  src={`data:${it.mimeType || 'image/png'};base64,${it.imageBase64}`}
                  alt=""
                  className="w-14 h-14 rounded object-cover border border-gray-200 dark:border-gray-700 hover:scale-110 transition"
                />
              </button>
            </HoverPreview>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-bold text-gray-900 dark:text-gray-100 truncate">
                  {it.sourceBrand || 'Sin marca'}
                </span>
                {it.variantStyle === 'rebrand' && (
                  <span className="px-1 py-0.5 text-[8px] font-bold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded">
                    REBRAND
                  </span>
                )}
                {it.descargada && (
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded"
                    title={`Descargado ${fmtDate(it.descargadaAt)}`}
                  >
                    <Check size={9} /> Descargado
                  </span>
                )}
              </div>
              <p className="text-[10px] text-gray-600 dark:text-gray-400 truncate mt-0.5">
                {it.sourceHeadline || <span className="italic">(sin headline)</span>}
              </p>
              <div className="flex items-center gap-2 text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">
                <span>{fmtDate(it.createdAt)}</span>
                {it.size && <span>· {it.size}</span>}
                {it.quality && <span>· {it.quality}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => onDownload(it)}
                className="p-1.5 text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 hover:bg-brand-100 dark:hover:bg-brand-900/50 rounded transition"
                title="Descargar PNG">
                <Download size={12} />
              </button>
              <button onClick={() => onToggleDescargada(it.id, !!it.descargada)}
                className={`p-1.5 rounded transition ${
                  it.descargada
                    ? 'text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title={it.descargada ? 'Marcar como NO descargado' : 'Marcar como descargado'}>
                <Check size={12} />
              </button>
              <button onClick={() => onDelete(it.id)}
                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
                title="Borrar">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// VISTA 3 — Tabla.
function GalleryTableView({ items, seleccionados, selectedOrder, onToggleSelect, onOpen, onDownload, onToggleDescargada, onDelete }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2 pr-2 font-bold w-8"></th>
            <th className="text-left py-2 px-2 font-bold w-14">Preview</th>
            <th className="text-left py-2 px-2 font-bold">Inspiración</th>
            <th className="text-left py-2 px-2 font-bold">Variante</th>
            <th className="text-left py-2 px-2 font-bold">Tamaño</th>
            <th className="text-left py-2 px-2 font-bold">Estado</th>
            <th className="text-left py-2 px-2 font-bold">Generado</th>
            <th className="text-right py-2 pl-2 font-bold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {items.map(it => {
            const isSel = seleccionados.has(it.id);
            const selIdx = selectedOrder.get(it.id);
            return (
              <tr key={it.id} className={isSel ? 'bg-brand-50/50 dark:bg-brand-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}>
                <td className="py-2 pr-2">
                  <button onClick={() => onToggleSelect(it.id)}
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isSel ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-brand-50 hover:text-brand-600'
                    }`}
                  >
                    {isSel ? selIdx : <Plus size={10} />}
                  </button>
                </td>
                <td className="py-2 px-2">
                  <HoverPreview item={it} className="inline-block">
                    <button onClick={() => onOpen(it)}>
                      <img
                        src={`data:${it.mimeType || 'image/png'};base64,${it.imageBase64}`}
                        alt=""
                        className="w-10 h-10 rounded object-cover border border-gray-200 dark:border-gray-700 hover:scale-110 transition"
                      />
                    </button>
                  </HoverPreview>
                </td>
                <td className="py-2 px-2 text-gray-700 dark:text-gray-200 truncate max-w-[180px]">{it.sourceBrand || '—'}</td>
                <td className="py-2 px-2">
                  {it.variantStyle === 'rebrand'
                    ? <span className="px-1 py-0.5 text-[9px] font-bold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded">REBRAND</span>
                    : <span className="text-gray-500 dark:text-gray-400 text-[10px]">Reference</span>}
                </td>
                <td className="py-2 px-2 text-gray-500 dark:text-gray-400 text-[10px]">{it.size || '—'}</td>
                <td className="py-2 px-2">
                  {it.descargada
                    ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold" title={fmtDate(it.descargadaAt)}>
                        <Check size={10} /> Descargado
                      </span>
                    : <span className="text-gray-400 dark:text-gray-500 text-[10px]">Pendiente</span>}
                </td>
                <td className="py-2 px-2 text-gray-500 dark:text-gray-400 text-[10px]">{fmtDate(it.createdAt)}</td>
                <td className="py-2 pl-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => onDownload(it)}
                      className="p-1 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded" title="Descargar">
                      <Download size={11} />
                    </button>
                    <button onClick={() => onToggleDescargada(it.id, !!it.descargada)}
                      className={`p-1 rounded ${it.descargada ? 'text-emerald-600' : 'text-gray-400'} hover:bg-gray-100 dark:hover:bg-gray-700`}
                      title={it.descargada ? 'Marcar pendiente' : 'Marcar descargado'}>
                      <Check size={11} />
                    </button>
                    <button onClick={() => onDelete(it.id)}
                      className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" title="Borrar">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Lightbox separado para mantener este archivo manejable.
function Lightbox({ item, onClose, showDebug, setShowDebug, onDownload, onDelete, onToggleDescargada }) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/90 flex items-start justify-center p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div className="relative w-full max-w-5xl bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-2xl my-auto"
        onClick={e => e.stopPropagation()}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-gray-200 dark:bg-gray-700">
          <div className="bg-white dark:bg-gray-900 p-3 flex flex-col">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Inspiración original {item.sourceBrand ? `· ${item.sourceBrand}` : ''}
            </p>
            {item.sourceImageUrl ? (
              <img src={item.sourceImageUrl} alt="referencia"
                className="w-full object-contain bg-gray-50 dark:bg-gray-800 rounded"
                style={{ maxHeight: '60vh' }}
                onError={(e) => { e.target.style.opacity = '0.3'; }} />
            ) : (
              <div className="flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded text-[10px] text-gray-400 italic" style={{ minHeight: '40vh' }}>
                Sin imagen de referencia guardada
              </div>
            )}
            {item.sourceHeadline && (
              <p className="text-[10px] text-gray-600 dark:text-gray-300 mt-2 line-clamp-2 italic">"{item.sourceHeadline}"</p>
            )}
          </div>
          <div className="bg-white dark:bg-gray-900 p-3 flex flex-col">
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400 mb-2 flex items-center gap-2">
              Variación generada {item.variantIndex != null ? `#${item.variantIndex + 1}` : ''}
              {item.variantStyle === 'rebrand' && (
                <span className="px-1.5 py-0.5 text-[9px] bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded">REBRAND</span>
              )}
              {item.descargada && (
                <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded" title={fmtDate(item.descargadaAt)}>
                  <Check size={9} /> Descargado
                </span>
              )}
            </p>
            <img src={`data:${item.mimeType || 'image/png'};base64,${item.imageBase64}`}
              alt="" className="w-full object-contain bg-white rounded" style={{ maxHeight: '60vh' }} />
            <div className="flex items-center gap-2 mt-2 text-[9px] text-gray-500 dark:text-gray-400">
              {item.size && <span>{item.size}</span>}
              {item.quality && <span>· quality {item.quality}</span>}
              {item.sizeFallback && <span className="text-amber-600 dark:text-amber-400">· fallback de tamaño</span>}
            </div>
          </div>
        </div>

        {(item.skeleton || item.prompt) && (
          <div className="border-t border-gray-200 dark:border-gray-700">
            <button onClick={() => setShowDebug(s => !s)}
              className="w-full px-4 py-2 flex items-center justify-between text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              <span>Cómo se generó (skeleton + prompt)</span>
              {showDebug ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showDebug && (
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-[10px]">
                <div>
                  <p className="font-bold text-gray-700 dark:text-gray-200 mb-1">Skeleton extraído por Vision</p>
                  <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-auto max-h-60 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {item.skeleton ? JSON.stringify(item.skeleton, null, 2) : '(sin skeleton)'}
                  </pre>
                </div>
                <div>
                  <p className="font-bold text-gray-700 dark:text-gray-200 mb-1">Prompt enviado a gpt-image-2</p>
                  <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-auto max-h-60 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {item.prompt || '(sin prompt guardado)'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            {item.createdAt && <span>{fmtDate(item.createdAt)}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={onDownload}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">
              <Download size={13} /> Descargar
            </button>
            <button onClick={onToggleDescargada}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition ${
                item.descargada
                  ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100'
                  : 'text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300'
              }`}>
              <Check size={13} /> {item.descargada ? 'Marcar pendiente' : 'Marcar descargado'}
            </button>
            <button onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-lg transition">
              <Trash2 size={13} /> Borrar
            </button>
            <button onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition">
              <X size={13} /> Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
