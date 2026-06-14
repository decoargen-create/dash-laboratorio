// Sección global de "Colecciones" (boards): grupos cross-producto de ads
// favoritos que el user guarda desde Inspiración/Top 10.
//
// Vista doble:
//   - Lista de boards (cards con conteo + descripción)
//   - Detalle de un board: grid de ads guardados con link a FB + descripción

import React, { useState, useEffect, useRef } from 'react';
import {
  Bookmark, Plus, Loader2, Trash2, ChevronLeft, ExternalLink, X, Pencil,
  Image as ImageIcon, AlertCircle,
} from 'lucide-react';
import {
  listBoards, createBoard, updateBoard, deleteBoard,
  listBoardItems, removeItemFromBoard,
} from './marketingBoardsApi.js';
import { getCachedAdImageUrl } from './adImagesStore.js';

// Tailwind purga clases dinámicas — usamos map estático así sobreviven al build.
function colorClass(color) {
  const map = {
    amber: 'text-amber-500',
    emerald: 'text-emerald-500',
    brand: 'text-brand-500',
    violet: 'text-violet-500',
    blue: 'text-blue-500',
    red: 'text-red-500',
    gray: 'text-gray-500',
  };
  return map[color] || map.amber;
}

export default function BoardsSection({ addToast }) {
  const [boards, setBoards] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const bs = await listBoards();
      setBoards(bs);
    } catch (err) {
      setError(err.message || 'Error cargando colecciones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Si el user guarda un ad en un board desde Inspiración, el listado
  // (que vive en otra sección) debería verlo. Escuchamos el event y refetch.
  useEffect(() => {
    const onChange = () => reload();
    window.addEventListener('viora:boards-changed', onChange);
    return () => window.removeEventListener('viora:boards-changed', onChange);
  }, []);

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createBoard({ nombre: name, descripcion: draftDesc.trim() || undefined });
      addToast?.({ type: 'success', message: `Colección "${name}" creada` });
      setDraftName(''); setDraftDesc(''); setShowCreate(false);
      await reload();
    } catch (err) {
      addToast?.({ type: 'error', message: err.message || 'Error al crear' });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (board) => {
    if (!confirm(`¿Borrar "${board.nombre}"? Se pierden ${board.itemCount || 0} items guardados.`)) return;
    try {
      await deleteBoard(board.id);
      addToast?.({ type: 'success', message: `Colección borrada` });
      await reload();
    } catch (err) {
      addToast?.({ type: 'error', message: err.message || 'Error al borrar' });
    }
  };

  if (activeBoardId) {
    const board = boards?.find(b => b.id === activeBoardId);
    return (
      <BoardDetail
        board={board}
        onBack={() => { setActiveBoardId(null); reload(); }}
        addToast={addToast}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Bookmark size={20} className="text-amber-500" />
            Colecciones
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Guardá ads de cualquier producto en colecciones cross-funcionales.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(s => !s)}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded-lg hover:from-amber-600 hover:to-brand-600 transition"
        >
          <Plus size={14} /> Nueva colección
        </button>
      </div>

      {showCreate && (
        <div className="bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Nueva colección</p>
            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 transition">
              <X size={16} />
            </button>
          </div>
          <input
            type="text" value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder="Nombre — ej: Hooks que funcionan, Ofertas BFCM…"
            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <input
            type="text" value={draftDesc}
            onChange={e => setDraftDesc(e.target.value)}
            placeholder="Descripción (opcional)"
            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded">
              Cancelar
            </button>
            <button onClick={handleCreate} disabled={!draftName.trim() || creating}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded disabled:opacity-50">
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Crear
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
          <Loader2 size={14} className="animate-spin" /> Cargando…
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {!loading && boards && boards.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
          <Bookmark size={32} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">No tenés colecciones todavía</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Creá una y empezá a guardar ads desde Inspiración.
          </p>
        </div>
      )}

      {boards && boards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {boards.map(b => (
            <div key={b.id}
              onClick={() => setActiveBoardId(b.id)}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-amber-400 hover:shadow-md transition cursor-pointer group"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <Bookmark size={16} className={`${colorClass(b.color)} shrink-0 mt-0.5`} />
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(b); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"
                  title="Borrar colección"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{b.nombre}</p>
              {b.descripcion && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">{b.descripcion}</p>
              )}
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                {b.itemCount || 0} ads · actualizada {new Date(b.updated_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BoardDetail({ board: initialBoard, onBack, addToast }) {
  // Mantenemos una copia local del board para que las ediciones se reflejen
  // sin esperar al refetch del parent (issue #1 del audit).
  const [board, setBoard] = useState(initialBoard);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(initialBoard?.nombre || '');
  const [editDesc, setEditDesc] = useState(initialBoard?.descripcion || '');
  useEffect(() => { setBoard(initialBoard); }, [initialBoard?.id]);

  const reload = async () => {
    if (!board) return;
    setLoading(true); setError(null);
    try {
      const its = await listBoardItems(board.id);
      setItems(its);
    } catch (err) {
      setError(err.message || 'Error cargando items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [board?.id]);

  const handleRemove = async (adId) => {
    if (!confirm('¿Quitar este ad de la colección?')) return;
    try {
      await removeItemFromBoard(board.id, adId);
      setItems(prev => (prev || []).filter(it => it.ad_id !== adId));
      addToast?.({ type: 'success', message: 'Quitado de la colección' });
    } catch (err) {
      addToast?.({ type: 'error', message: err.message || 'Error al quitar' });
    }
  };

  const handleSaveEdit = async () => {
    const name = editName.trim();
    if (!name) return;
    const desc = editDesc.trim();
    try {
      const updated = await updateBoard(board.id, { nombre: name, descripcion: desc });
      // Mergeamos local para que el header refleje el cambio al instante.
      setBoard(prev => ({ ...prev, ...(updated || {}), nombre: name, descripcion: desc }));
      addToast?.({ type: 'success', message: 'Colección actualizada' });
      setEditing(false);
    } catch (err) {
      addToast?.({ type: 'error', message: err.message || 'Error al guardar' });
    }
  };

  if (!board) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500">Colección no encontrada.</p>
        <button onClick={onBack} className="mt-2 text-sm text-amber-600 hover:underline">Volver</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack}
          className="inline-flex items-center gap-1 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-amber-600 transition">
          <ChevronLeft size={14} /> Volver
        </button>
        <button onClick={() => setEditing(e => !e)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600">
          <Pencil size={12} /> Editar
        </button>
      </div>

      <div className="bg-gradient-to-br from-amber-50 to-brand-50 dark:from-amber-950/30 dark:to-brand-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
        {!editing ? (
          <>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Bookmark size={18} className="text-amber-500" />
              {board.nombre}
            </h2>
            {board.descripcion && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{board.descripcion}</p>}
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
              {items?.length || 0} ads · creada {new Date(board.created_at).toLocaleDateString()}
            </p>
          </>
        ) : (
          <div className="space-y-2">
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
            <input type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)}
              placeholder="Descripción"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setEditing(false); setEditName(board.nombre); setEditDesc(board.descripcion || ''); }}
                className="px-3 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded">
                Cancelar
              </button>
              <button onClick={handleSaveEdit}
                className="px-3 py-1 text-xs font-bold text-white bg-gradient-to-br from-amber-500 to-brand-500 rounded">
                Guardar
              </button>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
          <Loader2 size={14} className="animate-spin" /> Cargando ads…
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {!loading && items && items.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
          <ImageIcon size={32} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Colección vacía</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Guardá ads desde Inspiración con el botón Bookmark.
          </p>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {items.map(it => (
            <BoardItemCard key={it.ad_id} item={it} onRemove={() => handleRemove(it.ad_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// Card individual de un ad guardado — IntersectionObserver para el cache de
// IDB (mismo patrón que AdThumb). Las URLs de Meta expiran en ~24h; el cache
// local sobrevive eso. content-visibility skipea render off-screen.
function BoardItemCard({ item, onRemove }) {
  const ad = item.ad;
  const cdnThumb = ad?.image_url;
  const fbUrl = ad?.snapshot_url;
  const [cachedUrl, setCachedUrl] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!item.ad_id || !containerRef.current) return;
    let active = true;
    const fetchCached = () => {
      getCachedAdImageUrl(item.ad_id).then(url => { if (active) setCachedUrl(url); });
    };
    if (typeof IntersectionObserver === 'undefined') { fetchCached(); return; }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { fetchCached(); io.disconnect(); break; }
      }
    }, { rootMargin: '200px' });
    io.observe(containerRef.current);
    return () => { active = false; io.disconnect(); };
  }, [item.ad_id]);

  const thumb = cachedUrl || cdnThumb;
  return (
    <div ref={containerRef}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 220px' }}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden group relative">
      <div className="aspect-square bg-gray-100 dark:bg-gray-900 relative">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async"
            onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon size={20} className="text-gray-300" />
          </div>
        )}
        <button
          onClick={onRemove}
          className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 max-md:opacity-100 hover:bg-red-600 transition"
          title="Quitar de la colección"
        >
          <Trash2 size={11} />
        </button>
        {cachedUrl && (
          <div className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-emerald-400/80" title="Imagen cacheada localmente" />
        )}
      </div>
      <div className="p-2 space-y-1">
        <p className="text-[10px] font-semibold text-gray-700 dark:text-gray-200 truncate">
          {ad?.page_name || '—'}
        </p>
        {ad?.body && (
          <p className="text-[9px] text-gray-500 dark:text-gray-400 line-clamp-2">{ad.body}</p>
        )}
        <div className="flex items-center gap-2 text-[9px] text-gray-400">
          {ad?.days_running > 0 && <span>{ad.days_running}d</span>}
          {ad?.is_winner && <span className="text-amber-500 font-bold">🏆</span>}
          {fbUrl && (
            <a href={fbUrl} target="_blank" rel="noreferrer"
              className="ml-auto inline-flex items-center gap-0.5 text-amber-600 hover:underline">
              FB <ExternalLink size={8} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
