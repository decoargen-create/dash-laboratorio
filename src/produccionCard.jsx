// Tarjeta del tablero de Producción — COMPARTIDA entre el admin (ProduccionSection)
// y el editor (CreatorWorkspace), así se ven idénticas en las dos vistas. Lo que
// cambia entre roles se controla con `caps` (capabilities):
//
//   reassign  → tocar el badge de persona abre el menú de reasignar.
//   manage    → botones de eliminar / mover de columna (mover libre).
//   approve   → botón "Aprobar" en revisión.
//   publish   → botón "Publicar" en aprobado.
//   draggable → la tarjeta se arrastra entre columnas.
//   newBadge  → puntito "🆕 nuevo" (entregas que el admin no miró).
//
// El editor recibe todo en false (CAPS_EDITOR): ve la MISMA tarjeta pero sin poder
// reasignar, borrar, aprobar/publicar ni mover libremente. Igual puede subir
// creativos (el botón "Subir" está siempre) y abrir la carpeta de Drive. El pase
// "Por hacer → En revisión" lo hace solo la subida al completar los videos.

import React, { useEffect, useRef, useState } from 'react';
import {
  GripVertical, AlertTriangle, Calendar, Film, FileText, FolderOpen, Trash2,
  ChevronDown, Loader2, UploadCloud, CheckCircle2,
} from 'lucide-react';
import {
  updateAssignment, assignCreator, removeAssignment, personasEnTarjetas,
  VIDEOS_POR_PRODUCTO, ESTADO_LABELS, ESTADOS,
} from './produccionStore.js';
import { subirParaTarjeta, VIDEO_ACCEPT } from './produccionUpload.jsx';
import { personaColor, CHIP_CLS, CARD_TINT, CARD_STRIPE } from './produccionColors.js';
import ConfirmDialog from './ConfirmDialog.jsx';

// Capacidades por rol.
export const CAPS_ADMIN = { reassign: true, manage: true, approve: true, publish: true, draggable: true, newBadge: true };
export const CAPS_EDITOR = { reassign: false, manage: false, approve: false, publish: false, draggable: false, newBadge: false };

const ESTADO_DOT = {
  porhacer: 'bg-slate-400', revision: 'bg-amber-400', aprobado: 'bg-emerald-500',
  publicado: 'bg-violet-500', archivado: 'bg-gray-400',
};

// ── Fechas / velocidades (idénticas a las del tablero admin) ────────────────
// Fecha de creación en corto: "17/8" (agrega el año si no es el actual). null si
// no hay fecha válida.
function fmtFechaCorta(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const mismoAnio = d.getFullYear() === new Date().getFullYear();
  try {
    return d.toLocaleDateString('es-AR', mismoAnio
      ? { day: 'numeric', month: 'numeric' }
      : { day: 'numeric', month: 'numeric', year: '2-digit' });
  } catch { return null; }
}
// Fecha + hora completa para el tooltip ("18/08/2026 14:05").
function fmtFechaLarga(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  try {
    return new Date(t).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
// Tiempo restante (mm:ss / h m) y velocidad (MB/s) de la barra de subida.
function fmtEta(sec) {
  if (sec == null || !isFinite(sec)) return '';
  const s = Math.max(0, Math.round(sec));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSpeed(bps) {
  if (!bps || bps <= 0) return '';
  const mb = bps / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bps / 1024))} KB/s`;
}

// Badge de persona (avatar con inicial + nombre), tintado con su color.
export const PersonaBadge = ({ persona, num }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2 py-0.5 ${CHIP_CLS[personaColor(persona)]}`}>
    <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[11px] font-black uppercase">
      {(persona || '?').charAt(0)}
    </span>
    <span className="text-[12px] font-extrabold">{persona || 'Sin asignar'}</span>
    {num ? <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-black/25 text-[10px] font-black leading-none" title={`Tarjeta ${num} de esta persona`}>{num}</span> : null}
  </span>
);

export default function TarjetaProduccion({ a, num, personas = [], team = [], onOpen, addToast, caps = CAPS_ADMIN }) {
  const [menu, setMenu] = useState(false);
  const [menuQ, setMenuQ] = useState('');
  const [moveMenu, setMoveMenu] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [prog, setProg] = useState(null); // { i, total } mientras sube
  const fileRef = useRef(null);

  // Los menús desplegables se cierran con Esc o click en cualquier otro lado
  // (los clicks internos no llegan acá: los wrappers hacen stopPropagation).
  useEffect(() => {
    if (!menu && !moveMenu) return;
    const cerrar = () => { setMenu(false); setMoveMenu(false); setMenuQ(''); };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', cerrar);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', cerrar); };
  }, [menu, moveMenu]);

  const subidos = a.archivos?.length || 0;
  const aprob = Math.min(a.videosAprobados || 0, subidos);
  const folderLink = (a.archivos || []).find(f => f.folderLink)?.folderLink;
  // Tinte sutil con el color de la persona (barra izquierda + degradé tenue).
  const _pcol = personaColor(a.persona);
  const tintCls = CARD_TINT[_pcol] || '';
  const stripeCls = CARD_STRIPE[_pcol] || '';

  // "nuevo": la tarjeta tuvo ACTIVIDAD en las últimas 24 h — o se subió un
  // creativo, o cambió de estado (se movió de columna). Se apaga solo pasadas
  // las 24 h (se recalcula en cada render con Date.now()). La creación de la
  // tarjeta no cuenta (es tipo 'creacion', no un cambio de estado).
  const tieneNuevo = caps.newBadge && (() => {
    try {
      const now = Date.now();
      const DENTRO_24H = (t) => Number.isFinite(t) && t > 0 && (now - t) < 24 * 3600 * 1000;
      // 1) Creativo subido hace < 24 h (ts de archivo = "ms-sufijo").
      const subidoReciente = (a.archivos || []).some(f =>
        DENTRO_24H(parseInt(String(f?.ts || '').split('-')[0], 10)));
      if (subidoReciente) return true;
      // 2) Cambió de estado hace < 24 h (evento de historial tipo 'estado', ts ISO).
      const ultimoCambioEstado = (a.historial || [])
        .reduce((max, e) => (e?.tipo === 'estado' && e?.ts) ? Math.max(max, Date.parse(e.ts) || 0) : max, 0);
      return DENTRO_24H(ultimoCambioEstado);
    } catch { return false; }
  })();

  // ¿Trabada? +24h desde que entró a "En revisión" → borde ámbar (urgencia).
  const trabada = (() => {
    if (a.estado !== 'revision') return false;
    const revEv = [...(a.historial || [])].reverse().find(e => e.tipo === 'estado' && e.to === 'revision');
    const t = revEv?.ts ? Date.parse(revEv.ts) : (a.updatedAt ? Date.parse(a.updatedAt) : NaN);
    return !Number.isNaN(t) && (Date.now() - t) > 24 * 3600 * 1000;
  })();

  const onPick = async (fileList) => {
    setProg({ i: 0, total: 0, pct: 0, bps: 0, eta: null });
    try {
      await subirParaTarjeta(a, fileList, { addToast, onProgress: (p) => setProg(p) });
    } finally {
      // Pase lo que pase (incluso si subirParaTarjeta lanza), liberamos la barra;
      // sino la tarjeta queda no-arrastrable (draggable={!prog}) hasta recargar.
      setProg(null);
    }
  };

  const aprobarTodos = (e) => {
    e.stopPropagation();
    updateAssignment(a.id, { videosAprobados: subidos, estado: 'aprobado' });
    addToast?.({ type: 'success', message: `🎉 ¡${a.productoNombre} aprobado! (${subidos}/${subidos}) — listo para despegar` });
  };
  const publicar = (e) => {
    e.stopPropagation();
    updateAssignment(a.id, { estado: 'publicado' });
    addToast?.({ type: 'success', message: `🚀 ${a.productoNombre} publicado — ¡a volar!` });
  };

  const dragProps = (caps.draggable && !prog)
    ? { draggable: true, onDragStart: e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/prod-id', a.id); } }
    : {};

  return (
    <div {...dragProps}
      onClick={() => onOpen?.()}
      className={`group relative bg-white dark:bg-gray-800 border rounded-xl p-2.5 shadow-sm hover:shadow-lg hover:shadow-pink-500/10 hover:-translate-y-0.5 transition cursor-pointer ${tintCls} ${(menu || moveMenu) ? 'z-30' : ''} ${trabada ? 'border-amber-400/80 dark:border-amber-500/60 hover:border-amber-500' : 'border-gray-200 dark:border-gray-700 hover:border-pink-300 dark:hover:border-pink-700/70'}`}>
      {/* Barra lateral con el color de la persona (identificación rápida). */}
      {stripeCls && <span className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${stripeCls}`} aria-hidden="true" />}
      {/* Badge "nuevo": actividad de las últimas 24 h. Sobresale del borde de la
          tarjeta (con ring del color de fondo para que se despegue) y se ve
          completo — la columna tiene padding-top para que no lo recorte. */}
      {tieneNuevo && (
        <span className="absolute -top-2.5 -right-1 z-20 text-[10px] font-extrabold uppercase tracking-wide text-white bg-rose-500 rounded-full px-2 py-0.5 shadow-md ring-2 ring-gray-50 dark:ring-gray-800"
          title="Actividad en las últimas 24 h">nuevo</span>
      )}
      {/* Título grande + persona a la derecha (como el mock del Estudio) */}
      <div className="flex items-start gap-1.5">
        {caps.draggable
          ? <GripVertical size={14} className="text-gray-300 dark:text-gray-600 mt-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition cursor-grab active:cursor-grabbing" />
          : <span className="w-3.5 flex-shrink-0" aria-hidden="true" />}
        <span className="text-sm font-extrabold tracking-tight text-gray-900 dark:text-white leading-snug flex-1 min-w-0 line-clamp-2 break-words" title={a.productoNombre}>{a.productoNombre || 'Producto'}</span>
        {caps.reassign ? (
          <div className="relative shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {/* Aviso compacto: etiqueta sin cuenta → nadie la ve en su tablero */}
            {a.persona && !a.creatorId && (
              <span className="text-amber-500 cursor-help" title="Sin cuenta asignada: ningún creativo la ve en su tablero. Tocá el nombre y elegí una cuenta del equipo.">
                <AlertTriangle size={13} />
              </span>
            )}
            <span onClick={() => setMenu(v => !v)} className="cursor-pointer">
              <PersonaBadge persona={a.persona} num={num} />
            </span>
            {menu && (
              <div className="absolute right-0 top-8 z-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[140px]"
                onClick={e => e.stopPropagation()}>
                {(() => {
                  // Lista UNIFICADA (cuentas + personas de texto reales), igual que el
                  // selector del detalle: sin fantasmas de 0 tarjetas y con badge.
                  const accountNames = new Set(team.map(m => (m.display_name || m.email || '').trim().toLowerCase()).filter(Boolean));
                  const counts = {};
                  try { for (const pp of personasEnTarjetas()) counts[pp.persona.trim().toLowerCase()] = pp.tarjetas; } catch {}
                  const curPer = (a.persona || '').trim().toLowerCase();
                  const items = [
                    ...team.map(m => ({ key: `a:${m.id}`, name: m.display_name || m.email, creatorId: m.id, hasAccess: true })),
                    ...personas.filter(p => { const k = (p || '').trim().toLowerCase(); return k && !accountNames.has(k) && ((counts[k] || 0) > 0 || k === curPer); })
                      .map(p => ({ key: `p:${p}`, name: p, creatorId: null, hasAccess: false })),
                  ];
                  const q = menuQ.trim().toLowerCase();
                  const filtered = q ? items.filter(it => it.name.toLowerCase().includes(q)) : items;
                  return (
                    <>
                      {items.length > 6 && (
                        <input autoFocus value={menuQ} onChange={e => setMenuQ(e.target.value)} placeholder="Buscar…"
                          className="mb-0.5 px-2 py-1 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-brand-500" />
                      )}
                      {filtered.map(it => {
                        const sel = it.creatorId ? a.creatorId === it.creatorId : (!a.creatorId && (a.persona || '').trim().toLowerCase() === it.name.trim().toLowerCase());
                        return (
                          <button key={it.key} onClick={() => { assignCreator(a.id, { creatorId: it.creatorId, persona: it.name }); setMenu(false); setMenuQ(''); }}
                            className={`flex items-center gap-1.5 text-left text-xs font-semibold px-2 py-1 rounded hover:bg-brand-50 dark:hover:bg-brand-900/30 whitespace-nowrap ${sel ? 'text-brand-600 dark:text-brand-300' : 'text-gray-700 dark:text-gray-200'}`}>
                            <span className="flex-1">{sel ? '✓ ' : ''}{it.name}</span>
                            {it.hasAccess
                              ? <span className="text-[9px] text-emerald-500">🔑</span>
                              : <span className="text-[9px] text-amber-500">sin acceso</span>}
                          </button>
                        );
                      })}
                      {items.length === 0 && (
                        <div className="text-[10px] text-gray-400 px-2 py-1">Creá cuentas en "Equipo".</div>
                      )}
                    </>
                  );
                })()}
                {(a.persona || a.creatorId) && (
                  <button onClick={() => { assignCreator(a.id, { creatorId: null, persona: '' }); setMenu(false); }}
                    className="text-left text-xs px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 border-t border-gray-100 dark:border-gray-700 mt-0.5">Sin asignar</button>
                )}
              </div>
            )}
          </div>
        ) : (
          <span className="shrink-0"><PersonaBadge persona={a.persona} num={num} /></span>
        )}
      </div>

      {/* Meta: creada · subidos · aprobados ✓ · brief · trabada · botón de mover */}
      <div className="mt-2 pl-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {fmtFechaCorta(a.createdAt) && (
          <span className="inline-flex items-center gap-1" title={`Tarjeta creada el ${fmtFechaLarga(a.createdAt)}`}>
            <Calendar size={12} className="text-gray-400" />{fmtFechaCorta(a.createdAt)}
          </span>
        )}
        <span className="inline-flex items-center gap-1" title={`${subidos} de ${VIDEOS_POR_PRODUCTO} videos subidos`}>
          <Film size={12} className="text-emerald-500" /><b className="text-gray-700 dark:text-gray-200">{subidos}</b>/{VIDEOS_POR_PRODUCTO} videos
        </span>
        {subidos > 0 && (
          <span className={`inline-flex items-center gap-1 tabular-nums ${aprob >= subidos ? 'text-emerald-500' : 'text-gray-400'}`}
            title={`${aprob} de ${subidos} videos subidos están aprobados`}>
            <CheckCircle2 size={12} />
            <b>{aprob}/{subidos}</b> aprob.
          </span>
        )}
        {a.brief?.trim() && <FileText size={12} className="text-gray-400" title="Tiene brief" />}
        {(() => {
          const nCorr = (a.archivos || []).filter(f => f.correccion?.texto).length;
          if (!nCorr && !(a.nota || '').trim()) return null;
          return (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400"
              title={nCorr ? `${nCorr} video${nCorr === 1 ? '' : 's'} con corrección pedida` : 'Se pidió corregir esta tarjeta'}>
              <AlertTriangle size={11} /> Corregir{nCorr ? ` · ${nCorr}` : ''}
            </span>
          );
        })()}
        {(a.materialLink || '').trim() && (
          <a href={a.materialLink.trim()} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            title="Abrir la carpeta de material del producto en Drive"
            className="inline-flex items-center text-pink-500 hover:text-pink-600">
            <FolderOpen size={12} />
          </a>
        )}
        {trabada && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400" title="Hace más de 24h que está en revisión">🐢 +24h</span>}
        {/* Eliminar directo + mover de columna (punto de color + chevron) — solo admin */}
        {caps.manage && (
          <div className="relative ml-auto flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
            <button onClick={() => setConfirmDel(true)} title="Eliminar tarjeta"
              className="p-1 rounded-md text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
              <Trash2 size={12} />
            </button>
            <button onClick={() => setMoveMenu(v => !v)} title={`${ESTADO_LABELS[a.estado]} — mover a…`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition">
              <span className={`w-1.5 h-1.5 rounded-full ${ESTADO_DOT[a.estado] || ESTADO_DOT.porhacer}`} />
              <ChevronDown size={10} />
            </button>
            {moveMenu && (
              <div className="absolute right-0 top-6 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[130px]">
                <span className="text-[9.5px] font-bold uppercase text-gray-400 px-2 pt-1">Mover a</span>
                {ESTADOS.filter(e => e !== 'archivado' || a.estado === 'publicado' || a.estado === 'aprobado').map(e => (
                  <button key={e} onClick={() => { updateAssignment(a.id, { estado: e }); setMoveMenu(false); }}
                    className={`text-left text-xs font-semibold px-2 py-1 rounded whitespace-nowrap ${a.estado === e ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                    {a.estado === e ? '✓ ' : ''}{ESTADO_LABELS[e]}
                  </button>
                ))}
                {/* Eliminar directo desde la tarjeta (con confirmación propia) */}
                <button onClick={() => { setMoveMenu(false); setConfirmDel(true); }}
                  className="text-left text-xs font-semibold px-2 py-1 rounded whitespace-nowrap text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 border-t border-gray-100 dark:border-gray-700 mt-0.5 inline-flex items-center gap-1">
                  <Trash2 size={11} /> Eliminar tarjeta
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {subidos > 0 && (
        <div className="mt-1.5 pl-5">
          <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((aprob / subidos) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Acciones CONTEXTUALES según columna — menos ruido con muchas tarjetas:
          Por hacer → Subir · Revisión → Subir (+ Aprobar admin) · Aprobado →
          Publicar (admin) · Publicado → solo Drive. */}
      <div className="mt-2.5 pl-5">
        {prog ? (
          <div className="min-w-0">
            <div className="flex items-center justify-between text-[11px] font-bold text-brand-600 dark:text-brand-400 mb-1">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Loader2 size={11} className="animate-spin" />
                {Math.round((prog.pct || 0) * 100)}%{prog.total > 1 ? ` · ${prog.i + 1}/${prog.total}` : ''}
              </span>
              <span className="text-gray-400 dark:text-gray-500 font-semibold tabular-nums">
                {prog.eta != null ? `faltan ${fmtEta(prog.eta)}` : 'subiendo…'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all"
                style={{ width: `${Math.round((prog.pct || 0) * 100)}%` }} />
            </div>
            <div className="flex items-center justify-between text-[9px] text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums">
              <span>Subiendo a Drive</span>
              <span>{prog.bps ? fmtSpeed(prog.bps) : ''}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-stretch gap-1.5">
            {(a.estado === 'porhacer' || a.estado === 'revision') && (
              <button onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-extrabold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-lg transition shadow-sm">
                <UploadCloud size={13} /> Subir
              </button>
            )}
            {folderLink && (
              <a href={folderLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-extrabold text-gray-500 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:border-pink-400 hover:text-pink-600 dark:hover:text-pink-300 rounded-lg transition">
                ▶ Drive
              </a>
            )}
            {caps.approve && a.estado === 'revision' && subidos > 0 && (
              <button onClick={aprobarTodos}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-extrabold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-lg transition">
                <CheckCircle2 size={13} /> Aprobar
              </button>
            )}
            {caps.publish && a.estado === 'aprobado' && (
              <button onClick={publicar}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-extrabold text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 rounded-lg transition shadow-sm">
                🚀 Publicar
              </button>
            )}
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept={VIDEO_ACCEPT} multiple hidden
        onClick={e => e.stopPropagation()}
        onChange={e => { const fl = Array.from(e.target.files || []); e.target.value = ''; onPick(fl); }} />

      {/* Confirmación propia de eliminar (el span evita que el click burbujee
          a la tarjeta y abra el detalle) */}
      {confirmDel && (
        <span onClick={e => e.stopPropagation()}>
          <ConfirmDialog
            open
            title={`¿Eliminar la tarjeta de ${a.productoNombre}?`}
            message="Se pierde su historial y su lista de videos. Los archivos ya subidos a Drive/AdsLab no se borran."
            confirmLabel="Eliminar tarjeta" tone="danger"
            onConfirm={() => { setConfirmDel(false); removeAssignment(a.id); addToast?.({ type: 'success', message: `Tarjeta de ${a.productoNombre} eliminada.` }); }}
            onClose={() => setConfirmDel(false)}
          />
        </span>
      )}
    </div>
  );
}
