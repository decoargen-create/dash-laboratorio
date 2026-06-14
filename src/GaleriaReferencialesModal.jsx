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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X, Download, Trash2, Images, ChevronDown, ChevronUp, ExternalLink,
  LayoutGrid, Rows3, Table2, Plus, Check, FileArchive, EyeOff, Eye,
  Archive, ArchiveRestore, Trophy, Sparkles, Search,
} from 'lucide-react';
import JSZip from 'jszip';
import {
  getReferencialesByProducto, deleteReferencial, patchReferenciales,
  archiveReferencial, countReferencialesByProducto,
  markAsWinner, unmarkWinner, refreshSignedUrls,
} from './galeriaReferenciales.js';
import WinnerForm from './WinnerForm.jsx';
import WinnersReport from './WinnersReport.jsx';
import { iterateFromWinner, generateFromWinner } from './winnerIterate.js';
import { BarChart3 } from 'lucide-react';
import { SkeletonGrid } from './Skeleton.jsx';
import EmptyState from './EmptyState.jsx';

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

// Hook: convierte los items en URLs renderizables.
// - Items IDB legacy (con imageBase64) → blob URL (revoca al unmount).
// - Items cloud (con imageUrl del bucket) → la URL directa.
// Usar blob URLs en vez de `data:image/png;base64,...` evita que Chrome
// decodifique cada PNG en RAM como pixel buffer separado. Con 50+ imágenes
// 2048x2048 quality=high (5-15MB cada una), las data URIs hacen crashear
// el renderer (Chrome "Código de error 5" — out of memory). Blob URLs
// dejan los bytes en un solo Blob compartido y el browser los decodifica
// on-demand cuando el <img> es visible.
function useBlobUrls(items) {
  return useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (it?.imageBase64) {
        try {
          const blob = base64ToBlob(it.imageBase64, it.mimeType || 'image/png');
          map.set(it.id, URL.createObjectURL(blob));
        } catch {
          // base64 corrupto — caer al imageUrl del cloud si existe.
          if (it.imageUrl) map.set(it.id, it.imageUrl);
        }
      } else if (it?.imageUrl) {
        // Item cloud — usar la URL pública del bucket directo.
        map.set(it.id, it.imageUrl);
      }
    }
    return map;
  }, [items]);
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

// Props:
//   embedded=true → renderiza como sección full-width sin backdrop ni modal
//   chrome. Usado cuando vive dentro de un tab del workspace.
//   embedded=false (default) → modal sobre backdrop con onClose.
// ---- inner components moved before export (TDZ fix Vite/Rollup) ----

function HoverPreview({ item, imgSrc, children, className = '' }) {
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
          <img src={imgSrc} alt=""
            className="w-full max-h-72 object-contain bg-white rounded" />
        </div>
      </div>
    </div>
  );
}

// VISTA 1 — Grid: thumbs cuadrados con número de selección + badge si ya descargado.

function GalleryGridView({ items, blobUrls, seleccionados, selectedOrder, onToggleSelect, onOpen, onArchive, onToggleWinner }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {items.map(it => {
        const isSel = seleccionados.has(it.id);
        const selIdx = selectedOrder.get(it.id);
        const imgSrc = blobUrls.get(it.id) || '';
        return (
          // Sin HoverPreview en grid: la imagen ya se ve grande, el preview
          // flotante tapaba thumbnails vecinos y resultaba molesto. Se mantiene
          // en list/table view donde los thumbs son chicos.
          <div key={it.id}
            // content-visibility skipea rendering fuera del viewport →
            // mismo que en InspiracionSection. Crítico para galerías de
            // 500+ creativos donde cada thumb cargado se come ~3MB de RAM.
            style={{ contentVisibility: 'auto', containIntrinsicSize: '0 200px' }}
            className="group relative">
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
                src={imgSrc}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </button>
            {/* Selector numerado — siempre visible */}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(it.id, e); }}
              className={`absolute top-2 left-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-md transition-all ${
                isSel
                  ? 'bg-brand-600 text-white scale-110 ring-2 ring-white dark:ring-gray-900'
                  : 'bg-white/90 dark:bg-gray-900/90 text-gray-400 hover:bg-brand-50 hover:text-brand-600 hover:scale-110 opacity-70 group-hover:opacity-100'
              }`}
              title={isSel ? `Seleccionado #${selIdx}` : 'Click para seleccionar'}
            >
              {isSel ? selIdx : <Plus size={14} />}
            </button>
            {/* Badge "descargada" — esquina superior derecha, debajo de winner+archive */}
            {it.descargada && (
              <div className={`absolute ${onToggleWinner && onArchive ? 'top-[4.5rem]' : onArchive || onToggleWinner ? 'top-10' : 'top-2'} right-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold text-white bg-emerald-500 rounded-md shadow-md`}
                title={`Descargado ${fmtDate(it.descargadaAt)}`}
              >
                <Check size={10} /> ✓
              </div>
            )}
            {/* Trofeo: si ya es winner, siempre visible (amber sólido). Si no lo es,
                aparece en hover para marcarlo desde la card sin entrar al lightbox. */}
            {onToggleWinner && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleWinner(it); }}
                className={`absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all ${
                  it.winner
                    ? 'bg-amber-500 text-white opacity-100'
                    : 'bg-white/90 dark:bg-gray-900/90 text-gray-500 hover:text-amber-600 hover:bg-amber-50 opacity-0 group-hover:opacity-100 hover:scale-110'
                }`}
                title={it.winner ? 'Es winner — click para quitar' : 'Marcar como winner (publicado y rinde)'}
              >
                <Trophy size={12} />
              </button>
            )}
            {/* Botón archivar / restaurar — solo visible al hover, top-right.
                Click rápido para sacar de la vista sin tener que entrar al
                lightbox. */}
            {onArchive && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onArchive(it.id, !!it.archivado); }}
                className={`absolute ${onToggleWinner ? 'top-10' : 'top-2'} right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all ${
                  it.archivado
                    ? 'bg-amber-500 text-white opacity-100'
                    : 'bg-white/90 dark:bg-gray-900/90 text-gray-500 hover:text-amber-600 hover:bg-amber-50 opacity-0 group-hover:opacity-100 hover:scale-110'
                }`}
                title={it.archivado ? 'Restaurar' : 'Archivar (lo saca de la vista, no se borra)'}
              >
                {it.archivado ? <ArchiveRestore size={12} /> : <Archive size={12} />}
              </button>
            )}
            {/* Footer con brand + variant */}
            <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent text-white pointer-events-none">
              <p className="text-[9px] font-semibold truncate">
                {it.sourceBrand && <span>Ref: {it.sourceBrand}</span>}
                {it.variantStyle === 'rebrand' && <span className="ml-1 px-1 bg-brand-500 rounded text-[8px]">REBRAND</span>}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// VISTA 2 — Lista: rows con thumb + info + acciones inline.

function GalleryListView({ items, blobUrls, seleccionados, selectedOrder, onToggleSelect, onOpen, onDownload, onToggleDescargada, onArchive, onDelete, onToggleWinner }) {
  return (
    <div className="space-y-1.5">
      {items.map(it => {
        const isSel = seleccionados.has(it.id);
        const selIdx = selectedOrder.get(it.id);
        const imgSrc = blobUrls.get(it.id) || '';
        return (
          <div key={it.id}
            className={`flex items-center gap-2.5 p-2 rounded-md border transition ${
              isSel
                ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700'
            }`}
          >
            <button onClick={(e) => onToggleSelect(it.id, e)}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition shrink-0 ${
                isSel ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-brand-50 hover:text-brand-600'
              }`}
              title={isSel ? `#${selIdx}` : 'Seleccionar'}
            >
              {isSel ? selIdx : <Plus size={12} />}
            </button>
            <HoverPreview item={it} imgSrc={imgSrc} className="shrink-0">
              <button onClick={() => onOpen(it)}>
                <img
                  src={imgSrc}
                  alt=""
                  loading="lazy"
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
                {it.winner && (
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded"
                    title={`Winner ${fmtDate(it.winnerAt)}`}
                  >
                    <Trophy size={9} /> WINNER
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
              {onToggleWinner && (
                <button onClick={() => onToggleWinner(it)}
                  className={`p-1.5 rounded transition ${
                    it.winner
                      ? 'text-amber-700 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200'
                      : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                  }`}
                  title={it.winner ? 'Es winner — click para quitar' : 'Marcar como winner'}>
                  <Trophy size={12} />
                </button>
              )}
              <button onClick={() => onArchive(it.id, !!it.archivado)}
                className={`p-1.5 rounded transition ${
                  it.archivado
                    ? 'text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title={it.archivado ? 'Restaurar' : 'Archivar'}>
                {it.archivado ? <ArchiveRestore size={12} /> : <Archive size={12} />}
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

function GalleryTableView({ items, blobUrls, seleccionados, selectedOrder, onToggleSelect, onOpen, onDownload, onToggleDescargada, onArchive, onDelete, onToggleWinner }) {
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
            const imgSrc = blobUrls.get(it.id) || '';
            return (
              <tr key={it.id} className={isSel ? 'bg-brand-50/50 dark:bg-brand-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}>
                <td className="py-2 pr-2">
                  <button onClick={(e) => onToggleSelect(it.id, e)}
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isSel ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-brand-50 hover:text-brand-600'
                    }`}
                  >
                    {isSel ? selIdx : <Plus size={10} />}
                  </button>
                </td>
                <td className="py-2 px-2">
                  <HoverPreview item={it} imgSrc={imgSrc} className="inline-block">
                    <button onClick={() => onOpen(it)}>
                      <img
                        src={imgSrc}
                        alt=""
                        loading="lazy"
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
                    {onToggleWinner && (
                      <button onClick={() => onToggleWinner(it)}
                        className={`p-1 rounded ${it.winner ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/40' : 'text-gray-400 hover:text-amber-600'} hover:bg-amber-50 dark:hover:bg-amber-900/30`}
                        title={it.winner ? 'Es winner — click para quitar' : 'Marcar como winner'}>
                        <Trophy size={11} />
                      </button>
                    )}
                    <button onClick={() => onArchive(it.id, !!it.archivado)}
                      className={`p-1 rounded ${it.archivado ? 'text-amber-600' : 'text-gray-400'} hover:bg-gray-100 dark:hover:bg-gray-700`}
                      title={it.archivado ? 'Restaurar' : 'Archivar'}>
                      {it.archivado ? <ArchiveRestore size={11} /> : <Archive size={11} />}
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

function Lightbox({ item, imgSrc, onClose, showDebug, setShowDebug, onDownload, onDelete, onToggleDescargada, onArchive, onToggleWinner, onIterateWinner, iterating = false }) {
  const metrics = item.winnerMetrics || {};
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
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400 mb-2 flex items-center gap-2 flex-wrap">
              Variación generada {item.variantIndex != null ? `#${item.variantIndex + 1}` : ''}
              {item.variantStyle === 'rebrand' && (
                <span className="px-1.5 py-0.5 text-[9px] bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded">REBRAND</span>
              )}
              {item.winner && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded" title={`Winner marcado ${fmtDate(item.winnerAt)}`}>
                  <Trophy size={9} /> WINNER
                </span>
              )}
              {item.descargada && (
                <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded" title={fmtDate(item.descargadaAt)}>
                  <Check size={9} /> Descargado
                </span>
              )}
            </p>
            <img src={imgSrc}
              alt="" className="w-full object-contain bg-white rounded" style={{ maxHeight: '60vh' }} />
            <div className="flex items-center gap-2 mt-2 text-[9px] text-gray-500 dark:text-gray-400">
              {item.size && <span>{item.size}</span>}
              {item.quality && <span>· quality {item.quality}</span>}
              {item.sizeFallback && <span className="text-amber-600 dark:text-amber-400">· fallback de tamaño</span>}
            </div>
          </div>
        </div>

        {/* Métricas del winner — solo si está marcado */}
        {item.winner && (
          <div className="border-t border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/15 px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                <Trophy size={12} /> Por qué este es un winner
              </p>
              {metrics.ad_id && (
                <span className="text-[10px] text-amber-700 dark:text-amber-300 font-mono">
                  Ad: {metrics.ad_id}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-2">
              {metrics.ctr != null && <MetricBox label="CTR" value={`${metrics.ctr}%`} />}
              {metrics.roas != null && <MetricBox label="ROAS" value={metrics.roas} />}
              {metrics.cpa != null && <MetricBox label="CPA" value={`$${metrics.cpa}`} />}
              {metrics.thumb_stop != null && <MetricBox label="Thumb-stop" value={`${metrics.thumb_stop}%`} />}
              {metrics.impressions != null && <MetricBox label="Impres." value={Number(metrics.impressions).toLocaleString('es-AR')} />}
              {metrics.purchases != null && <MetricBox label="Compras" value={metrics.purchases} />}
            </div>
            {Array.isArray(metrics.que_funciono) && metrics.que_funciono.length > 0 && (
              <p className="text-[10px] text-amber-800 dark:text-amber-200 mb-1">
                <span className="font-bold">Funcionó:</span> {metrics.que_funciono.join(' · ')}
              </p>
            )}
            {metrics.notas && (
              <p className="text-[11px] text-amber-900 dark:text-amber-100 italic">"{metrics.notas}"</p>
            )}
          </div>
        )}

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
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button onClick={onDownload}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">
              <Download size={13} /> Descargar
            </button>
            <button onClick={onToggleWinner}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition ${
                item.winner
                  ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200'
                  : 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 border border-amber-300 dark:border-amber-800'
              }`}>
              <Trophy size={13} /> {item.winner ? 'Quitar winner' : 'Marcar winner'}
            </button>
            {item.winner && onIterateWinner && (
              <button onClick={onIterateWinner}
                disabled={iterating}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed">
                {iterating
                  ? <><span className="animate-spin">⏳</span> Generando…</>
                  : <><Sparkles size={13} /> Generar variación desde winner</>}
              </button>
            )}
            <button onClick={onToggleDescargada}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition ${
                item.descargada
                  ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100'
                  : 'text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300'
              }`}>
              <Check size={13} /> {item.descargada ? 'Pendiente' : 'Descargado'}
            </button>
            <button onClick={onArchive}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition ${
                item.archivado
                  ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100'
                  : 'text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300'
              }`}>
              {item.archivado ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              {item.archivado ? 'Restaurar' : 'Archivar'}
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


// Box compacto de métrica usado en la vista expandida del winner.
function MetricBox({ label, value }) {
  return (
    <div className="bg-white/70 dark:bg-black/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
      <p className="text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{label}</p>
      <p className="text-xs font-bold tabular-nums text-amber-900 dark:text-amber-100">{value}</p>
    </div>
  );
}

// Tab button para el panel principal (Todos / Winners / Archivados).
function TabButton({ active, onClick, icon, label, count, highlight = false, accent }) {
  const accentClass = accent === 'amber'
    ? (active
        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
        : highlight
          ? 'text-amber-700 dark:text-amber-300 border-transparent hover:bg-amber-50 dark:hover:bg-amber-900/20'
          : 'text-gray-600 dark:text-gray-300 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800')
    : (active
        ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-700'
        : 'text-gray-600 dark:text-gray-300 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800');
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-t-md border-b-2 transition ${accentClass}`}>
      {icon}
      {label}
      {count > 0 && (
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
          active
            ? 'bg-white/60 dark:bg-black/30'
            : 'bg-gray-100 dark:bg-gray-700'
        }`}>{count}</span>
      )}
    </button>
  );
}

export default function GaleriaReferencialesModal({ productoId, productoNombre, producto, onClose, embedded = false }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ total: 0, active: 0, archived: 0, downloaded: 0, winners: 0 });
  const [verArchivados, setVerArchivados] = useState(false);
  // Panel principal: 'todos' | 'winners' | 'archivados'. Es el filtro top-level.
  const [panel, setPanel] = useState('todos');
  // Form de marcar como winner — guardamos el creativo a marcar.
  const [winnerFormItem, setWinnerFormItem] = useState(null);
  const [selected, setSelected] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  // Vista: 'grid' | 'list' | 'table'. Persistida.
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('adslab-galeria-view') || 'grid'; }
    catch { return 'grid'; }
  });
  const setMode = (m) => {
    setViewMode(m);
    try { localStorage.setItem('adslab-galeria-view', m); } catch {}
  };
  // Multi-select. Set preserva orden de inserción.
  const [seleccionados, setSeleccionados] = useState(new Set());
  // Último ID clickeado — usado para shift+click range selection
  // (estilo Finder/Gmail: click en A, shift+click en F → selecciona A-F).
  const lastClickedRef = useRef(null);
  const selectedOrder = useMemo(() => {
    const m = new Map();
    let i = 0;
    for (const id of seleccionados) m.set(id, ++i);
    return m;
  }, [seleccionados]);
  // Filtros: estado / variante / origen — formato dropdown.
  const [filtroEstado, setFiltroEstado] = useState('all');     // 'all' | 'pending' | 'downloaded'
  const [filtroVariante, setFiltroVariante] = useState('all'); // 'all' | 'reference' | 'rebrand' | 'tight' | 'medium' | 'loose'
  const [filtroOrigen, setFiltroOrigen] = useState('all');     // 'all' | 'inspiracion' | 'bandeja-idea'
  // Búsqueda libre por texto — matchea sourceBrand, sourceHeadline, variantStyle.
  const [searchQuery, setSearchQuery] = useState('');
  const [zipping, setZipping] = useState(false);
  // Iteración de winner en curso — bloquea el botón y muestra progreso.
  const [iteratingId, setIteratingId] = useState(null);
  const [iterateProgress, setIterateProgress] = useState(null);

  // ⚠️ visibleItems TIENE que estar acá arriba (antes del useEffect de
  // keyboard nav que lo usa en su dep array). Estaba abajo en línea 935
  // y producía TDZ "Cannot access 'N' before initialization" en prod.
  const visibleItems = items.filter(it => {
    if (panel === 'winners' && !it.winner) return false;
    if (panel === 'archivados' && !it.archivado) return false;
    if (panel === 'todos' && it.archivado) return false;
    // En Winners NO aplicamos el filtro de descargados: un winner casi siempre
    // ya está descargado/publicado, y esconderlos vaciaba la pestaña ("Todo
    // descargado" pese a tener winners marcados).
    if (panel !== 'winners') {
      if (filtroEstado === 'pending' && it.descargada) return false;
      if (filtroEstado === 'downloaded' && !it.descargada) return false;
    }
    if (filtroVariante !== 'all' && it.variantStyle !== filtroVariante) return false;
    if (filtroOrigen === 'inspiracion' && it.sourceType === 'bandeja-idea') return false;
    if (filtroOrigen === 'bandeja-idea' && it.sourceType !== 'bandeja-idea') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const haystack = [it.sourceBrand, it.sourceHeadline, it.variantStyle, it.prompt]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const refresh = () => {
    setCargando(true);
    // Cuando el panel es "archivados", incluimos archivados en la query
    // — sino los filtraríamos del array y no aparecerían en el panel.
    // 'reportes' incluye archivados también porque los winners pueden estar
    // archivados (winner + archivado = "ganador histórico ya no en uso").
    const includeArchived = panel === 'archivados' || panel === 'reportes' || panel === 'winners' || verArchivados;
    Promise.all([
      getReferencialesByProducto(productoId, { includeArchived }),
      countReferencialesByProducto(productoId),
    ])
      .then(([its, cs]) => { setItems(its); setCounts(cs); })
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
  }, [productoId, verArchivados, panel]);

  // Blob URLs por item — se revoca el set anterior al regenerar.
  // SIN esto, cada <img src="data:..."> hacía Chrome decodificar PNG 2K en
  // RAM (5-15MB cada uno) y crashear el renderer con 50+ creativos.
  const blobUrls = useBlobUrls(items);
  useEffect(() => {
    return () => {
      for (const url of blobUrls.values()) {
        try { URL.revokeObjectURL(url); } catch {}
      }
    };
  }, [blobUrls]);

  useEffect(() => {
    // Esc: si hay lightbox abierto cierra eso, si no cierra el modal.
    // En modo embedded NO hay modal a cerrar (onClose no se pasa) → ignorar.
    // ← / → / j / k: navegar prev/next entre los visibleItems con el
    //                lightbox abierto. Replica el patrón de Lightroom/Photos.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (selected) setSelected(null);
        else onClose?.();
        return;
      }
      if (!selected) return;
      const isArrowOrJK = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'j' || e.key === 'k';
      if (!isArrowOrJK) return;
      const idx = visibleItems.findIndex(it => it.id === selected.id);
      if (idx === -1) return;
      const dir = (e.key === 'ArrowRight' || e.key === 'j') ? 1 : -1;
      const nextIdx = (idx + dir + visibleItems.length) % visibleItems.length;
      setSelected(visibleItems[nextIdx]);
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, onClose, visibleItems]);

  const toggleSeleccion = (id, e) => {
    // Shift+click: rango desde el último clickeado hasta este id (inclusive).
    // Si no hay último, o el ID es el mismo, toggle normal.
    if (e?.shiftKey && lastClickedRef.current && lastClickedRef.current !== id) {
      const ids = visibleItems.map(it => it.id);
      const fromIdx = ids.indexOf(lastClickedRef.current);
      const toIdx = ids.indexOf(id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const rango = ids.slice(start, end + 1);
        setSeleccionados(prev => {
          const next = new Set(prev);
          for (const rid of rango) next.add(rid);
          return next;
        });
        lastClickedRef.current = id;
        return;
      }
    }
    // Toggle normal — click sin shift.
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastClickedRef.current = id;
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

  // Baja los bytes de una URL pública y valida que sea una imagen real.
  // Sin esto: si Supabase Storage devuelve 403 (URL expirada/RLS) o el host
  // del CDN responde con HTML/JSON de error, fetch().blob() igual devuelve
  // ese cuerpo y el .png queda corrupto en el ZIP (~90 bytes). El user veía
  // "No se pudo abrir el archivo" en Vista Previa.
  const fetchImageBlob = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText || ''}`.trim());
    }
    const blob = await resp.blob();
    // Validá content-type Y tamaño. content-type puede venir vacío en algunos
    // CDNs aunque sea imagen válida → fallback a chequeo de tamaño mínimo
    // (las imágenes generadas son siempre >5KB; un error JSON es <2KB).
    const ct = blob.type || '';
    if (ct && !ct.startsWith('image/')) {
      throw new Error(`Respuesta no es imagen (content-type: ${ct})`);
    }
    if (blob.size < 2048) {
      throw new Error(`Bytes insuficientes (${blob.size} B)`);
    }
    return blob;
  };

  // Bulk download como ZIP. Marca todos los descargados con timestamp.
  const handleBulkDownload = async () => {
    if (seleccionados.size === 0) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      let seleccionadosArr = items.filter(it => seleccionados.has(it.id));
      // Re-firmamos signed URLs (TTL 5min) antes de bajar bytes. Las URLs
      // viejas del load inicial pueden tener >1h y dar 403 acá. Items sin
      // storagePath (IDB legacy) se devuelven igual.
      seleccionadosArr = await refreshSignedUrls(seleccionadosArr);
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
      // Items que efectivamente entraron al ZIP — solo estos los marcamos
      // como descargados al final. Los fallados quedan disponibles para
      // reintentar sin ensuciar el filtro "no descargados".
      const okItems = [];
      const failed = []; // { name, error }
      await Promise.all(seleccionadosArr.map(async (it) => {
        let name = buildFileName(it, productoNombre);
        let dedup = 1;
        const base = name.replace(/\.png$/, '');
        while (usedNames.has(name)) {
          name = `${base} (${++dedup}).png`;
        }
        usedNames.add(name);
        try {
          let blob;
          if (it.imageBase64) {
            blob = base64ToBlob(it.imageBase64, it.mimeType || 'image/png');
          } else if (it.imageUrl) {
            blob = await fetchImageBlob(it.imageUrl);
          } else {
            throw new Error('Sin imageBase64 ni imageUrl');
          }
          zip.file(name, blob);
          okItems.push(it);
        } catch (err) {
          failed.push({ name, error: err.message });
        }
      }));
      if (okItems.length === 0) {
        alert(`No se pudo bajar ninguno de los ${seleccionadosArr.length} creativos. Errores:\n\n${failed.slice(0, 5).map(f => `· ${f.name}: ${f.error}`).join('\n')}`);
        setZipping(false);
        return;
      }
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
      // Marcar solo los OK como descargados.
      await patchReferenciales(
        okItems.map(it => it.id),
        { descargada: true, descargadaAt: new Date().toISOString() }
      );
      if (failed.length > 0) {
        alert(`ZIP listo con ${okItems.length} creativos. ${failed.length} no se pudieron bajar (URLs caídas o sin permisos) — quedaron sin marcar como descargados para reintentar:\n\n${failed.slice(0, 5).map(f => `· ${f.name}: ${f.error}`).join('\n')}${failed.length > 5 ? `\n…y ${failed.length - 5} más` : ''}`);
      }
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
      // Cloud items no tienen imageBase64 — usar imageUrl directo. Para
      // marcar como "descargada" igual hace falta el fetch (no podemos
      // forzar el navegador a descargar sin tener los bytes).
      let blob;
      if (it.imageBase64) {
        blob = base64ToBlob(it.imageBase64, it.mimeType || 'image/png');
      } else if (it.imageUrl || it.storagePath) {
        // Re-firmar antes de bajar (mismo motivo que en el bulk).
        const [refreshed] = await refreshSignedUrls([it]);
        if (!refreshed?.imageUrl) throw new Error('No se pudo refrescar la URL del creativo');
        blob = await fetchImageBlob(refreshed.imageUrl);
      } else {
        throw new Error('Sin imageBase64 ni imageUrl — no hay bytes para descargar');
      }
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

  // Archivar / restaurar — soft-hide. El item queda en IDB pero por default
  // no se carga en la galería ni se decodifica a memoria.
  const handleArchive = async (id, currentValue) => {
    await archiveReferencial(id, !currentValue);
    // Si estamos archivando algo y el lightbox lo tiene abierto, cerralo.
    if (!currentValue && selected?.id === id) setSelected(null);
    refresh();
  };

  // Winner — abrir form si va a marcar, des-marcar directo si quitar.
  const handleToggleWinner = (item) => {
    if (item.winner) {
      // Des-marcar directo (sin form). Si querían editar las métricas, hay
      // un botón aparte "Editar métricas" en el lightbox.
      if (!window.confirm('¿Sacar el flag de winner de este creativo? Las métricas guardadas se pierden.')) return;
      unmarkWinner(item.id).then(() => refresh());
      return;
    }
    setWinnerFormItem(item);
  };

  const handleConfirmWinner = async (metrics) => {
    if (!winnerFormItem) return;
    await markAsWinner(winnerFormItem.id, metrics);
    setWinnerFormItem(null);
    refresh();
  };

  // Iterar desde un winner — genera DIRECTO una variación nueva usando el
  // winner como referencia visual (mismo pipeline que Inspiración, no
  // pasa por Bandeja). La idea es que el ganador es el insumo, no la
  // hipótesis a editar.
  const handleIterateWinner = async (item) => {
    if (!producto) {
      alert('Falta el contexto del producto para iterar.');
      return;
    }
    if (iteratingId) return; // ya hay una iteración corriendo
    setIteratingId(item.id);
    setIterateProgress({ current: 0, total: 1, brand: item.sourceBrand });
    try {
      const { count } = await generateFromWinner(item, producto, {
        n: 1,
        quality: 'high',
        size: item.size || '1024x1024',
        onProgress: (p) => setIterateProgress({ ...p, brand: item.sourceBrand }),
      });
      // El backend ya disparó viora:referencial-saved en cada save al cloud;
      // por las dudas refresh local también.
      refresh();
      alert(`✓ ${count} variación nueva del winner generada y guardada al repositorio.`);
    } catch (err) {
      alert(`Error iterando: ${err.message}`);
    } finally {
      setIteratingId(null);
      setIterateProgress(null);
    }
  };

  // Bulk archive: archiva todos los seleccionados a la vez. Útil cuando
  // armaste una grilla de 4 variaciones y solo querés guardar las 2 que
  // sirven para usar en Meta.
  const handleBulkArchive = async () => {
    if (seleccionados.size === 0) return;
    const cant = seleccionados.size;
    if (!window.confirm(`¿Archivar ${cant} creativo${cant !== 1 ? 's' : ''} seleccionado${cant !== 1 ? 's' : ''}? Quedan ocultos pero no se borran — los podés restaurar con el toggle "Ver archivados".`)) return;
    await patchReferenciales(
      Array.from(seleccionados),
      { archivado: true, archivadoAt: new Date().toISOString() }
    );
    limpiarSeleccion();
    refresh();
  };
  // Bulk: marcar los seleccionados como winner (sin form de métricas — quick
  // mark). Aparecen en la pestaña Winners y en la galería global de winners.
  const handleBulkWinner = async () => {
    if (seleccionados.size === 0) return;
    const cant = seleccionados.size;
    if (!window.confirm(`¿Marcar ${cant} creativo${cant !== 1 ? 's' : ''} como winner? Aparecen en la pestaña Winners y en la galería global.`)) return;
    await patchReferenciales(
      Array.from(seleccionados),
      { winner: true, winnerAt: new Date().toISOString() }
    );
    limpiarSeleccion();
    refresh();
  };
  // visibleItems se declara arriba (línea 673) — TDZ fix para el useEffect
  // de keyboard nav del lightbox.
  const anyFilterActive = filtroEstado !== 'all' || filtroVariante !== 'all' || filtroOrigen !== 'all';
  const yaDescargadosCount = items.filter(it => it.descargada).length;

  // Contenido principal — se renderiza dentro del modal o embebido.
  const innerContent = (
    <>
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <Images size={18} className="text-brand-500 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">Repositorio de creativos</h3>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                {productoNombre} · {counts.active} activo{counts.active !== 1 ? 's' : ''}
                {counts.downloaded > 0 && ` · ${counts.downloaded} descargado${counts.downloaded !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Búsqueda libre — matchea brand, headline, variante, prompt. */}
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar por marca, headline…"
                className="pl-6 pr-2 py-1.5 text-[10px] font-medium bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 w-40"
                title="Búsqueda libre"
              />
            </div>
            {/* Filtros estilo dropdown (linear-style). Compactos. */}
            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
              className="px-2 py-1.5 text-[10px] font-bold bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
              title="Filtrar por estado"
            >
              <option value="all">Estado: todos</option>
              <option value="pending">Pendientes</option>
              <option value="downloaded">Descargados</option>
            </select>
            <select
              value={filtroVariante}
              onChange={e => setFiltroVariante(e.target.value)}
              className="px-2 py-1.5 text-[10px] font-bold bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
              title="Filtrar por tipo de variante"
            >
              <option value="all">Variante: todas</option>
              <option value="reference">Reference (fiel)</option>
              <option value="rebrand">Rebrand (paleta marca)</option>
              <option value="tight">Tight (réplica)</option>
              <option value="medium">Medium (mismo concepto)</option>
              <option value="loose">Loose (inventada)</option>
            </select>
            <select
              value={filtroOrigen}
              onChange={e => setFiltroOrigen(e.target.value)}
              className="px-2 py-1.5 text-[10px] font-bold bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
              title="Filtrar por origen"
            >
              <option value="all">Origen: todos</option>
              <option value="inspiracion">Inspiración (competencia)</option>
              <option value="bandeja-idea">Idea de Bandeja</option>
            </select>
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

        {/* Tabs panel: Todos / Winners / Archivados */}
        <div className="px-5 pt-3 pb-0 border-b border-gray-200 dark:border-gray-700 flex items-center gap-1">
          <TabButton
            active={panel === 'todos'}
            onClick={() => setPanel('todos')}
            icon={<Images size={12} />}
            label="Todos"
            count={counts.active}
          />
          <TabButton
            active={panel === 'winners'}
            onClick={() => setPanel('winners')}
            icon={<Trophy size={12} />}
            label="Winners"
            count={counts.winners}
            highlight={counts.winners > 0}
            accent="amber"
          />
          <TabButton
            active={panel === 'archivados'}
            onClick={() => setPanel('archivados')}
            icon={<Archive size={12} />}
            label="Archivados"
            count={counts.archived}
          />
          <TabButton
            active={panel === 'reportes'}
            onClick={() => setPanel('reportes')}
            icon={<BarChart3 size={12} />}
            label="Reportes"
            count={counts.winners}
            accent="amber"
          />
        </div>

        {/* Body */}
        <div className="p-5 max-h-[75vh] overflow-y-auto">
          {panel === 'reportes' ? (
            <WinnersReport
              winners={items.filter(it => it.winner)}
              productoNombre={productoNombre}
              productoImagen={producto?.imagen || producto?.imagenUrl || null}
            />
          ) : cargando ? (
            <SkeletonGrid count={8} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Images}
              title="Sin referenciales todavía"
              description='Elegí ads en Inspiración y dale "Crear creativo" — los generados aparecen acá.'
            />
          ) : visibleItems.length === 0 ? (
            // Empty state context-aware. Antes siempre decía "Todo descargado"
            // → en la pestaña Winners sin winners marcados era confuso (el user
            // no entendía que el problema era que NO HAY winners).
            panel === 'winners' ? (
              <EmptyState
                icon={Trophy}
                title="Sin winners marcados"
                description='Marcá un creativo como winner clickeando la copa 🏆 en su card. Los winners marcados aparecen acá.'
              />
            ) : panel === 'archivados' ? (
              <EmptyState
                icon={Archive}
                title="Sin archivados"
                description='Archivá un creativo desde su menú para que aparezca acá.'
              />
            ) : (
              <EmptyState
                icon={Check}
                title="¡Todo descargado!"
                description='Apagá el filtro "Solo no descargados" para ver todo el repositorio.'
                secondaryAction={{ label: 'Mostrar todo', onClick: () => { setFiltroEstado('all'); setFiltroVariante('all'); setFiltroOrigen('all'); } }}
              />
            )
          ) : viewMode === 'grid' ? (
            <GalleryGridView items={visibleItems} blobUrls={blobUrls} seleccionados={seleccionados} selectedOrder={selectedOrder}
              onToggleSelect={toggleSeleccion} onOpen={setSelected} onArchive={handleArchive} onToggleWinner={handleToggleWinner} />
          ) : viewMode === 'list' ? (
            <GalleryListView items={visibleItems} blobUrls={blobUrls} seleccionados={seleccionados} selectedOrder={selectedOrder}
              onToggleSelect={toggleSeleccion} onOpen={setSelected}
              onDownload={handleSingleDownload} onToggleDescargada={toggleDescargadaFlag} onArchive={handleArchive} onDelete={handleDelete} onToggleWinner={handleToggleWinner} />
          ) : (
            <GalleryTableView items={visibleItems} blobUrls={blobUrls} seleccionados={seleccionados} selectedOrder={selectedOrder}
              onToggleSelect={toggleSeleccion} onOpen={setSelected}
              onDownload={handleSingleDownload} onToggleDescargada={toggleDescargadaFlag} onArchive={handleArchive} onDelete={handleDelete} onToggleWinner={handleToggleWinner} />
          )}
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
            className="text-[11px] text-brand-600 hover:text-brand-700 transition"
            title="Atajos: click = uno · shift+click = rango desde el anterior · este botón = todos los visibles">
            Seleccionar todos los visibles
          </button>
          <span className="text-[9px] text-gray-400 dark:text-gray-500 italic hidden md:inline">
            tip: shift+click selecciona un rango
          </span>
          <button
            onClick={handleBulkWinner}
            disabled={zipping}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-yellow-500 rounded-lg hover:from-amber-600 hover:to-yellow-600 transition disabled:opacity-60"
            title="Marcar los seleccionados como winner (aparecen en la pestaña Winners y en la galería global)"
          >
            <Trophy size={12} /> Marcar winner ({seleccionados.size})
          </button>
          <button
            onClick={handleBulkArchive}
            disabled={zipping}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition disabled:opacity-60"
            title="Archivar los seleccionados (no se borran, quedan ocultos)"
          >
            <Archive size={12} /> Archivar ({seleccionados.size})
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

      {/* Toast de progreso del iterate — visible aun si cerrás el lightbox */}
      {iteratingId && iterateProgress && (
        <div className="fixed top-4 right-4 z-[80] bg-gradient-to-br from-purple-600 to-pink-600 text-white rounded-lg shadow-2xl px-4 py-3 flex items-center gap-3 max-w-sm">
          <Sparkles size={16} className="animate-pulse" />
          <div className="text-xs">
            <p className="font-bold">Generando desde winner{iterateProgress.brand ? ` · ${iterateProgress.brand}` : ''}</p>
            <p className="text-white/80 text-[10px]">{iterateProgress.current}/{iterateProgress.total} · suele tardar 60-90s</p>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {selected && (
        <Lightbox
          item={selected}
          imgSrc={blobUrls.get(selected.id) || ''}
          onClose={() => { setSelected(null); setShowDebug(false); }}
          showDebug={showDebug}
          setShowDebug={setShowDebug}
          onDownload={() => handleSingleDownload(selected)}
          onDelete={() => handleDelete(selected.id)}
          onToggleDescargada={() => toggleDescargadaFlag(selected.id, !!selected.descargada)}
          onArchive={() => handleArchive(selected.id, !!selected.archivado)}
          onToggleWinner={() => handleToggleWinner(selected)}
          onIterateWinner={() => handleIterateWinner(selected)}
          iterating={iteratingId === selected.id}
        />
      )}

      {/* Winner form */}
      {winnerFormItem && (
        <WinnerForm
          creativo={winnerFormItem}
          onConfirm={handleConfirmWinner}
          onCancel={() => setWinnerFormItem(null)}
        />
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="w-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {innerContent}
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {innerContent}
      </div>
    </div>
  );
}

// Componente reusable: thumb que al hover muestra preview grande de la
// variación + del ad original side-by-side. Aparece flotando al lado del
// thumb (right por default; flip a left si está cerca del borde derecho).
