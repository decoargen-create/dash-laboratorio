// Producción — tablero kanban del equipo creativo (estilo Trello).
//
// Cada tarjeta = 1 producto, con su persona (label de color), su brief a mano
// (consignas + guiones + links de Drive) y los creativos subidos. Las columnas
// son los estados: Por hacer → En revisión → Aprobado → Publicado. Arrastrás la
// tarjeta para cambiarle el estado. "Aprobado/Publicado" es lo que cuenta para
// el pago (que se ve en Área creativa → Resumen).
//
// Local por ahora. El login del equipo es Fase 2.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Film, Plus, X, Trash2, ChevronDown, UploadCloud, Loader2, CheckCircle2,
  AlertTriangle, ExternalLink, FileText, GripVertical, Users, History, Search, ArrowLeftRight,
  Bell, BellRing, Inbox, Eye, RefreshCw, Calendar, Filter, FolderOpen, Download, Star, Settings,
} from 'lucide-react';
import {
  ESTADOS, ESTADO_LABELS, VIDEOS_POR_PRODUCTO, weekKeyOf, weekLabel, weekRange, allWeekKeys,
  listAssignments, addAssignment, updateAssignment, removeAssignment,
  assignCreator, subscribeProduccion, esCompleto, bonusObjetivo, bonusDe, inversionPorProducto,
  getRole, entregasNuevas, ultimaSubidaTs, personasEnTarjetas, resumenVideosPorProducto,
  resyncDesdeNube, vaciarTodo, setMaterialLinkProducto, probarDiscord,
  loadNotifConfig, saveNotifConfig, toggleWinner, winnersDeProducto, pagoProductoDe,
} from './produccionStore.js';
import { CreativosSection, subirParaTarjeta, VIDEO_ACCEPT, probeDrive } from './produccionUpload.jsx';
import { numerarDuplicados, columnaEfectiva } from './produccionCalc.js';
import { registrarColoresPersonas, personaColor, CHIP_CLS } from './produccionColors.js';
import TarjetaProduccion, { CAPS_ADMIN } from './produccionCard.jsx';
import { listTeam, createMember, removeMember } from './produccionTeam.js';
import { driveStatus, connectDrive, disconnectDrive } from './produccionDrive.js';
import TeamModal from './TeamModal.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

const EQUIPO_DEFAULT = ['Fran', 'Wanda', 'Flor'];

const fmtArs = (n) => '$' + new Intl.NumberFormat('es-AR').format(Math.round(n || 0));

// Fecha de creación de la tarjeta en corto: "17/8" (agrega el año si no es el
// actual). Devuelve null si no hay fecha válida.
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

// "hace X" corto para timestamps de subida.
function fmtHace(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'recién';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} día${d === 1 ? '' : 's'}`;
  try { return new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }); }
  catch { return ''; }
}

const VISTAS_KEY = 'adslab-produccion-entregas-vistas-v1';
function getVistasTs() {
  try { const n = parseInt(localStorage.getItem(VISTAS_KEY), 10); return Number.isFinite(n) ? n : 0; }
  catch { return 0; }
}
function setVistasTs(ts) {
  try { localStorage.setItem(VISTAS_KEY, String(ts)); } catch {}
}

// Aviso del admin: entregas (videos que subió el equipo) que TODAVÍA NO MIRÓ.
// En vez de revisar tarjeta por tarjeta buscando qué cambió, ve de una lo nuevo,
// con "Ver" (abre la tarjeta para mirar/descargar de Drive o AdsLab) y "Marcar
// visto". Cuando llega algo nuevo con la app abierta dispara un toast, y una
// notificación del navegador si el admin activó los avisos (🔔). El "visto" es
// una marca local por dispositivo (localStorage) — no toca la nube.
function NovedadesPanel({ onOpen, addToast }) {
  const [open, setOpen] = useState(true);
  const [vistas, setVistas] = useState(() => getVistasTs());
  const [notifOn, setNotifOn] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const prevMaxTs = useRef(null);

  const nuevas = entregasNuevas(vistas);
  const totalNuevos = nuevas.reduce((s, e) => s + e.nuevos, 0);
  const maxTs = nuevas.length ? nuevas[0].lastTs : 0;

  // Aviso al llegar algo nuevo (toast + notificación del navegador). El primer
  // render fija la línea de base sin avisar: solo avisamos por lo que entra
  // DESPUÉS de abrir la sección, no por el backlog ya existente.
  useEffect(() => {
    if (prevMaxTs.current === null) { prevMaxTs.current = maxTs; return; }
    if (maxTs > prevMaxTs.current && totalNuevos > 0) {
      addToast?.({ type: 'info', message: `🆕 ${totalNuevos} entrega${totalNuevos === 1 ? '' : 's'} nueva${totalNuevos === 1 ? '' : 's'} del equipo` });
      if (notifOn && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('AdsLab — entregas nuevas', {
            body: `${totalNuevos} video${totalNuevos === 1 ? '' : 's'} nuevo${totalNuevos === 1 ? '' : 's'} del equipo. Entrá a Producción para verlos.`,
            tag: 'adslab-entregas',
          });
        } catch { /* notificación bloqueada */ }
      }
    }
    prevMaxTs.current = maxTs;
  }, [maxTs, totalNuevos, notifOn, addToast]);

  const marcarTodoVisto = () => {
    const ts = Math.max(ultimaSubidaTs(), maxTs, Date.now() - 1);
    setVistasTs(ts); setVistas(ts); prevMaxTs.current = ts;
  };

  const activarAvisos = async () => {
    if (typeof Notification === 'undefined') {
      addToast?.({ type: 'warning', message: 'Este navegador no soporta notificaciones.' }); return;
    }
    if (Notification.permission === 'granted') { setNotifOn(true); return; }
    if (Notification.permission === 'denied') {
      addToast?.({ type: 'warning', message: 'Los avisos están bloqueados en el navegador. Habilitalos desde el candado 🔒 de la barra de direcciones.' });
      return;
    }
    try {
      const p = await Notification.requestPermission();
      if (p === 'granted') { setNotifOn(true); addToast?.({ type: 'success', message: '🔔 Avisos activados — te notifico cuando el equipo suba creativos.' }); }
      else addToast?.({ type: 'warning', message: 'No diste permiso para los avisos.' });
    } catch { /* usuario canceló */ }
  };

  // Estado en reposo: nada nuevo. Barra fina para que se sepa que existe + toggle
  // de avisos. Sin ruido cuando no hay novedades.
  if (totalNuevos === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-500 dark:text-gray-400">
        <Inbox size={14} className="text-gray-400" />
        <span>Sin entregas nuevas por ahora. Cuando el equipo suba creativos, aparecen acá.</span>
        {!notifOn && (
          <button onClick={activarAvisos}
            className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-600 dark:text-brand-300 hover:underline">
            <Bell size={12} /> Activar avisos
          </button>
        )}
        {notifOn && (
          <span className="ml-auto inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
            <BellRing size={12} /> Avisos activados
          </span>
        )}
      </div>
    );
  }

  const visibles = nuevas.slice(0, 30);
  const resto = nuevas.length - visibles.length;

  return (
    <div className="bg-gradient-to-r from-brand-50 to-white dark:from-brand-900/25 dark:to-gray-800 border border-brand-200 dark:border-brand-800/60 rounded-xl overflow-hidden shadow-sm">
      <div className="w-full px-4 py-2.5 flex items-center gap-2.5">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
          <span className="relative">
            <BellRing size={18} className="text-brand-600 dark:text-brand-300" />
            <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">{totalNuevos > 99 ? '99+' : totalNuevos}</span>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {totalNuevos} entrega{totalNuevos === 1 ? '' : 's'} nueva{totalNuevos === 1 ? '' : 's'} del equipo
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              en {nuevas.length} tarjeta{nuevas.length === 1 ? '' : 's'} · lo más reciente {fmtHace(maxTs)}
            </p>
          </div>
          <ChevronDown size={16} className={`text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={marcarTodoVisto}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition"
          title="Ocultar todo lo de abajo (marca local, no borra nada)">
          <CheckCircle2 size={12} /> Marcar visto
        </button>
      </div>
      {open && (
        <div className="border-t border-brand-100 dark:border-brand-800/40 divide-y divide-gray-100 dark:divide-gray-800 bg-white/60 dark:bg-gray-800/40">
          {visibles.map(e => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{e.productoNombre}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                  {e.persona ? `${e.persona} · ` : ''}{ESTADO_LABELS[e.estado] || e.estado} · {weekLabel(e.weekKey)}
                </p>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-bold text-[10px]">
                +{e.nuevos} video{e.nuevos === 1 ? '' : 's'}
              </span>
              <span className="shrink-0 text-[10px] text-gray-400 tabular-nums w-16 text-right">{fmtHace(e.lastTs)}</span>
              <button onClick={() => onOpen?.(e.weekKey, e.id)}
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition">
                <Eye size={12} /> Ver
              </button>
            </div>
          ))}
          {resto > 0 && (
            <p className="px-4 py-1.5 text-[10px] text-gray-400 dark:text-gray-500">y {resto} tarjeta{resto === 1 ? '' : 's'} más con entregas nuevas…</p>
          )}
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900/40">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-1">Abrí una tarjeta para mirar o descargar los videos (Drive o AdsLab).</span>
            {!notifOn ? (
              <button onClick={activarAvisos} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 dark:text-brand-300 hover:underline">
                <Bell size={12} /> Activar avisos
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <BellRing size={12} /> Avisos activados
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Panel colapsable: cuánto se INVIRTIÓ (pago al equipo) en cada producto,
// acumulado de todas las semanas. Se actualiza solo cada vez que una tarjeta
// pasa a aprobado/publicado (el padre re-renderiza al cambiar el store).
function InversionPanel() {
  const [open, setOpen] = useState(false);
  const rows = inversionPorProducto();
  if (rows.length === 0) return null;
  const totalInvertido = rows.reduce((s, r) => s + r.invertido, 0);
  const totalCompletados = rows.reduce((s, r) => s + r.completados, 0);
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
        <span className="text-base">💰</span>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Inversión por producto</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {rows.length} producto{rows.length !== 1 ? 's' : ''} · {totalCompletados} entregado{totalCompletados !== 1 ? 's' : ''} · total <b className="text-emerald-600 dark:text-emerald-400">{fmtArs(totalInvertido)}</b>
          </p>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700/60 divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(r => (
            <div key={r.key} className="flex items-center gap-3 px-4 py-2 text-xs">
              <span className="flex-1 min-w-0 truncate font-semibold text-gray-800 dark:text-gray-100">{r.productoNombre}</span>
              <span className="w-32 text-right text-gray-500 dark:text-gray-400 tabular-nums">
                {r.completados} entregado{r.completados !== 1 ? 's' : ''}{r.enProceso > 0 ? ` · ${r.enProceso} en curso` : ''}
              </span>
              <span className="w-24 text-right font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtArs(r.invertido)}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-4 py-2 text-xs bg-gray-50 dark:bg-gray-900/40">
            <span className="flex-1 font-bold text-gray-900 dark:text-gray-100">Total</span>
            <span className="w-32 text-right text-gray-500 dark:text-gray-400 tabular-nums">{totalCompletados} entregado{totalCompletados !== 1 ? 's' : ''}</span>
            <span className="w-24 text-right font-bold font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">{fmtArs(totalInvertido)}</span>
          </div>
          <p className="px-4 py-1.5 text-[10px] text-gray-400 dark:text-gray-500">
            Acumulado de todas las semanas · lo que se le paga al equipo por cada producto entregado (aprobado/publicado). El bonus por objetivo va aparte, por persona.
          </p>
        </div>
      )}
    </div>
  );
}

// Escape cierra el modal (detalle de uso: el user espera Esc en cualquier popup).
function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

const COLS = [
  { key: 'porhacer', emoji: '🎬', dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400', hdr: 'bg-slate-200/60 dark:bg-slate-700/30', empty: '🎬 Agregá productos y ¡acción!' },
  { key: 'revision', emoji: '👀', dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', hdr: 'bg-amber-100/70 dark:bg-amber-900/20', empty: '👀 Nada en revisión — todo al día' },
  { key: 'aprobado', emoji: '✅', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', hdr: 'bg-emerald-100/70 dark:bg-emerald-900/20', empty: '✅ Acá caen los aprobados' },
  { key: 'publicado', emoji: '🚀', dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', hdr: 'bg-violet-100/70 dark:bg-violet-900/20', empty: '🚀 Listos para despegar' },
  { key: 'archivado', emoji: '📦', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-gray-400', hdr: 'bg-gray-200/60 dark:bg-gray-700/40', empty: '📦 Nada archivado' },
];

// Colores por persona + tinte de tarjeta viven ahora en produccionColors.js
// (compartidos con el tablero del editor). personaColor/CHIP_CLS/registrarColores
// se importan arriba.
const PersonaChip = ({ persona, onClick, small }) => (
  <button onClick={onClick}
    className={`inline-flex items-center rounded font-bold uppercase tracking-wide ${small ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'} ${CHIP_CLS[personaColor(persona)]} ${onClick ? 'hover:opacity-80 transition' : ''}`}>
    {persona || 'Sin asignar'}
  </button>
);

// Dropdown de filtro MULTI-selección (varios productos / varias personas).
// selected = array de valores elegidos; onToggle(val) agrega/saca uno.
function MultiFiltro({ label, options, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const n = selected.length;
  const active = n > 0;
  const resumen = n === 0 ? `Todos los ${label}`
    : n === 1 ? (options.find(o => o.value === selected[0])?.label || selected[0])
    : `${n} ${label}`;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 text-xs font-semibold border rounded-lg transition ${active ? 'border-brand-400 text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800'}`}>
        <span className="truncate max-w-[150px]">{resumen}</span>
        <ChevronDown size={13} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-56 max-h-64 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1">
          {options.length === 0 && <div className="px-2 py-1.5 text-xs text-gray-400">Nada para filtrar</div>}
          {options.map(o => {
            const on = selected.includes(o.value);
            return (
              <button key={o.value} onClick={() => onToggle(o.value)}
                className={`w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${on ? 'text-brand-600 dark:text-brand-300 font-bold' : 'text-gray-700 dark:text-gray-200'}`}>
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[9px] ${on ? 'bg-brand-500 border-brand-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>{on ? '✓' : ''}</span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
          {n > 0 && (
            <button onClick={onClear} className="w-full text-left text-[11px] font-bold text-gray-400 hover:text-brand-600 px-2 py-1.5 border-t border-gray-100 dark:border-gray-800 mt-0.5">Limpiar</button>
          )}
        </div>
      )}
    </div>
  );
}

// Resumen de la semana: cuántas tarjetas tiene cada persona + progreso hacia el
// objetivo (productos aprobados) con el bonus semanal.
// Formatea una duración en ms → "6 h" / "1.5 d".
function fmtDur(ms) {
  if (ms == null) return '—';
  const h = ms / 3600000;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

// Panel VERTICAL por persona: una fila por creativo con asignados, por hacer,
// en revisión y objetivo (aprobados/asignados) + su ritmo (tiempo prom).
// Las clases grid-cols van LITERALES (Tailwind no genera clases interpoladas).
// Estado del bono de UNA persona según sus completados y SU config de pago
// (no todos tienen bono): { tiene } ya lo alcanzó · { faltan:n } tiene esquema
// pero todavía no llega · { sin } no tiene bono configurado (no se muestra).
function bonoInfo(persona, completados) {
  if (bonusDe(persona, completados) > 0) return { tiene: true };
  if (bonusDe(persona, completados + 50) <= 0) return { sin: true };
  for (let c = completados + 1; c <= completados + 50; c++) {
    if (bonusDe(persona, c) > 0) return { faltan: c - completados };
  }
  return { sin: true };
}

function ResumenSemana({ asigs, filtroSinAsignar = false, onToggleSinAsignar, onPickPersona, activePersonas = [] }) {
  const { rows, sinAsignar, total, totals } = useMemo(() => {
    const now = Date.now();
    const by = {};
    let sin = 0;
    asigs.forEach(a => {
      const p = (a.persona || '').trim();
      if (!p) { sin++; return; }
      if (!by[p]) by[p] = { persona: p, asignados: 0, porhacer: 0, revision: 0, completos: 0, tiempos: [], trabadas: 0 };
      const s = by[p];
      s.asignados++;
      if (a.estado === 'porhacer') s.porhacer++;
      else if (a.estado === 'revision') s.revision++;
      if (esCompleto(a.estado)) s.completos++;
      const hist = a.historial || [];
      const creadaTs = a.createdAt ? Date.parse(a.createdAt)
        : (hist.find(e => e.tipo === 'creacion')?.ts ? Date.parse(hist.find(e => e.tipo === 'creacion').ts) : NaN);
      const aprobEv = [...hist].reverse().find(e => e.tipo === 'estado' && e.to === 'aprobado');
      if (!Number.isNaN(creadaTs) && aprobEv?.ts) { const d = Date.parse(aprobEv.ts) - creadaTs; if (d > 0) s.tiempos.push(d); }
      if (a.estado === 'revision') {
        const revEv = [...hist].reverse().find(e => e.tipo === 'estado' && e.to === 'revision');
        const t = revEv?.ts ? Date.parse(revEv.ts) : (a.updatedAt ? Date.parse(a.updatedAt) : NaN);
        if (!Number.isNaN(t) && (now - t) > 24 * 3600 * 1000) s.trabadas++;
      }
    });
    const rows = Object.values(by).map(s => ({
      ...s,
      avg: s.tiempos.length ? s.tiempos.reduce((x, y) => x + y, 0) / s.tiempos.length : null,
      bono: bonoInfo(s.persona, s.completos),
    })).sort((a, b) => b.asignados - a.asignados);
    // Totales del equipo (el "resumen de los 3 juntos" arriba de las tarjetas).
    const totals = {
      asignados: asigs.length,
      porhacer: asigs.filter(a => a.estado === 'porhacer').length,
      revision: asigs.filter(a => a.estado === 'revision').length,
      aprobados: asigs.filter(a => esCompleto(a.estado)).length,
    };
    // Orden: quien más aprobó primero (ranking suave, motiva sin medallas).
    rows.sort((a, b) => b.completos - a.completos || b.asignados - a.asignados);
    return { rows, sinAsignar: sin, total: asigs.length, totals };
  }, [asigs]);

  // Plegable (se acuerda de tu preferencia entre sesiones).
  const [plegado, setPlegado] = useState(() => {
    try { return localStorage.getItem('adslab-prod-resumen-plegado') === '1'; } catch { return false; }
  });
  const togglePlegado = () => setPlegado(v => {
    const n = !v;
    try { localStorage.setItem('adslab-prod-resumen-plegado', n ? '1' : '0'); } catch {}
    return n;
  });

  if (total === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* Resumen del EQUIPO (todos juntos) */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mr-auto">Semana del equipo</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Los contadores por estado (asignados/por hacer/revisión/aprobados) se
              sacaron: ya están en las columnas del tablero. Acá queda el detalle
              por persona (abajo) + el filtro "sin asignar". */}
          {sinAsignar > 0 && (
            <button onClick={onToggleSinAsignar}
              title={filtroSinAsignar ? 'Quitar el filtro' : 'Ver solo las tarjetas sin asignar'}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${filtroSinAsignar ? 'bg-amber-500 text-white ring-2 ring-amber-300 dark:ring-amber-700' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60'}`}>
              <AlertTriangle size={10} /> {sinAsignar} sin asignar
            </button>
          )}
        </div>
        <button onClick={togglePlegado} title={plegado ? 'Mostrar el detalle por persona' : 'Plegar'}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <ChevronDown size={14} className={`transition-transform ${plegado ? '-rotate-90' : ''}`} />
        </button>
      </div>

      {/* Tarjeta por persona — piel "Estudio creativo": degradé de marca, anillo
          grande con gradiente, celdas de estado, MVP 👑 al que más aprobó. */}
      {!plegado && (rows.length === 0 ? (
        <p className="text-xs text-gray-400 px-4 py-3">Asigná tarjetas a cada uno para ver su avance.</p>
      ) : (
        <div className="flex gap-3 p-3 overflow-x-auto">
          {rows.map((s, idx) => {
            const pct = s.asignados ? Math.round((s.completos / s.asignados) * 100) : 0;
            const esMVP = idx === 0 && s.completos > 0;
            const copyPct = pct >= 100 ? 'objetivo cumplido ✨'
              : pct >= 80 ? `¡a un paso! (${pct}%)`
              : pct === 0 ? 'arrancando la semana'
              : `${pct}% del objetivo`;
            return (
              <div key={s.persona} role="button" tabIndex={0}
                onClick={() => onPickPersona?.(s.persona)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickPersona?.(s.persona); } }}
                title={activePersonas.includes(s.persona) ? `Quitar el filtro de ${s.persona}` : `Ver solo las tarjetas de ${s.persona}`}
                className={`relative min-w-[218px] max-w-[270px] flex-1 rounded-2xl border bg-gradient-to-br from-pink-500/10 via-violet-500/5 to-transparent p-3 flex flex-col gap-2.5 transition cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-pink-900/10 ${activePersonas.includes(s.persona) ? 'border-brand-400 ring-2 ring-brand-300 dark:ring-brand-700' : 'border-pink-200/50 dark:border-white/10'}`}>
                {esMVP && (
                  <span className="absolute -top-2 right-3 text-[10px] font-black uppercase tracking-wide bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 rounded-full px-2 py-0.5 shadow" title="La persona con más aprobados de la semana">
                    👑 MVP
                  </span>
                )}
                <div className="flex items-center gap-3">
                  {/* Anillo grande con gradiente de marca */}
                  <div className="w-14 h-14 rounded-full grid place-items-center shrink-0"
                    style={{ background: `conic-gradient(#ec4899, #f43f5e ${pct}%, rgba(127,140,170,.25) 0)` }}
                    title={`${pct}% de su objetivo aprobado`}>
                    <div className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 grid place-items-center text-[13px] font-extrabold tabular-nums text-gray-800 dark:text-gray-100">
                      {s.completos}/{s.asignados}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <span className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-0.5 text-xs font-bold ${CHIP_CLS[personaColor(s.persona)]}`}>
                      <span className="w-4 h-4 rounded-full bg-black/20 flex items-center justify-center text-[10px] font-black">{s.persona.charAt(0).toUpperCase()}</span>
                      {s.persona}
                    </span>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{copyPct}</div>
                  </div>
                </div>

                {/* Estados como celdas (número grande + micro-etiqueta) */}
                <div className="flex gap-1.5 text-center">
                  {[
                    ['por hacer', s.porhacer, 'bg-slate-200/60 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300'],
                    ['revisión', s.revision, 'bg-amber-100/80 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'],
                    ['aprob.', s.completos, 'bg-emerald-100/80 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'],
                  ].map(([lab, val, cls]) => (
                    <div key={lab} className={`flex-1 rounded-lg py-1 ${cls}`} title={`${val} ${lab}`}>
                      <div className="text-sm font-extrabold tabular-nums leading-none">{val}</div>
                      <div className="text-[9.5px] uppercase tracking-wide opacity-80 mt-0.5">{lab}</div>
                    </div>
                  ))}
                </div>

                {/* Pie: bono (según la config de CADA persona; si no tiene bono
                    configurado, no se muestra) + ritmo */}
                <div className="flex items-center justify-between border-t border-gray-200/60 dark:border-white/10 pt-2 text-[11px]">
                  {s.bono?.tiene
                    ? <span className="font-extrabold text-emerald-600 dark:text-emerald-400">🎯 ¡Bonus!</span>
                    : s.bono?.faltan
                    ? <span className="text-gray-400">{s.bono.faltan} más y hay bonus 🎯</span>
                    : <span />}
                  <span className="flex items-center gap-2 text-gray-400 tabular-nums">
                    {s.avg != null && <span title="Tiempo prom. a aprobado">⏱ {fmtDur(s.avg)}</span>}
                    {s.trabadas > 0 && <span className="text-amber-600 dark:text-amber-400 font-bold" title="Trabadas +24h en revisión">🐢 {s.trabadas}</span>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function readProductos() {
  try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]'); }
  catch { return []; }
}

export default function ProduccionSection({ addToast }) {
  const [, force] = useState(0);
  const [productos] = useState(() => readProductos());
  const [weekKey, setWeekKey] = useState(() => weekKeyOf());
  const [showAdd, setShowAdd] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [confirmResync, setConfirmResync] = useState(false);
  const [confirmVaciar, setConfirmVaciar] = useState(false);
  const [vaciando, setVaciando] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [showBuscar, setShowBuscar] = useState(false);
  const [ajustesOpen, setAjustesOpen] = useState(false);
  const ajustesRef = useRef(null);
  useEffect(() => {
    if (!ajustesOpen) return;
    const onDoc = (e) => { if (ajustesRef.current && !ajustesRef.current.contains(e.target)) setAjustesOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setAjustesOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [ajustesOpen]);
  const [resyncing, setResyncing] = useState(false);
  const [team, setTeam] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  // Filtro rápido: mostrar solo las tarjetas sin repartir (click en el chip
  // "N sin asignar" del resumen).
  const [soloSinAsignar, setSoloSinAsignar] = useState(false);
  // Filtros multi-selección: arrays de productos y personas elegidos (vacío = todos).
  const [filtroProducto, setFiltroProducto] = useState([]);
  const [filtroPersona, setFiltroPersona] = useState([]);
  const toggleEn = (setter) => (val) => setter(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);

  useEffect(() => {
    const un = subscribeProduccion(() => force(x => x + 1));
    return un;
  }, []);

  // Cargamos el equipo (creators) para poder asignar tarjetas a una cuenta.
  // Si la carga FALLA (ej: falta SUPABASE_SERVICE_ROLE_KEY en el server), lo
  // avisamos en vez de tragarlo: antes se veía "No hay cuentas del equipo" sin
  // saber si estaba vacío de verdad o si el endpoint estaba roto.
  const reloadTeam = () => {
    listTeam()
      .then(setTeam)
      .catch(err => addToast?.({ type: 'error', message: `No se pudo cargar el equipo: ${err.message}` }));
  };
  useEffect(reloadTeam, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Aviso si un guardado a la nube falla (antes se perdía en silencio). El store
  // emite el evento; acá lo mostramos como toast, throttled para no spamear.
  useEffect(() => {
    let last = 0;
    const onErr = () => {
      const now = Date.now();
      if (now - last < 8000) return;
      last = now;
      addToast?.({ type: 'error', message: 'No se pudo guardar un cambio en la nube. Revisá la conexión — se reintenta al recargar.' });
    };
    window.addEventListener('viora:produccion-sync-error', onErr);
    return () => window.removeEventListener('viora:produccion-sync-error', onErr);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Link a la carpeta raíz de Drive (para el botón "Drive" del header).
  // Estado de Drive: si funciona (rootLink) + si el OAuth del user está conectado.
  const [drive, setDrive] = useState({ rootLink: null, connected: false, email: null, connecting: false });
  const refreshDrive = () => {
    Promise.all([probeDrive(), driveStatus()]).then(([p, s]) => {
      setDrive(d => ({ ...d, rootLink: (p?.configured && p?.rootLink) || null, connected: !!s?.connected, email: s?.email || p?.email || null }));
    });
  };
  useEffect(refreshDrive, []);
  // Diagnóstico de las credenciales OAuth (leído de /api/diag, público). Sirve
  // para ver EN LA APP por qué falla "Conectar Drive" (secret inválido,
  // cambiado de lugar, con espacios, etc.) sin tener que leer JSON crudo.
  const [driveDiag, setDriveDiag] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/diag').then(r => r.json())
      .then(j => { if (alive) setDriveDiag(j?.checks?.GOOGLE_DRIVE?.oauth || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const onConnectDrive = async () => {
    setDrive(d => ({ ...d, connecting: true }));
    let r;
    try { r = await connectDrive(); } finally { setDrive(d => ({ ...d, connecting: false })); }
    if (r === true) { addToast?.({ type: 'success', message: '✅ Google Drive conectado — ahora los videos van a tu Drive.' }); refreshDrive(); }
    else if (r === 'closed') { addToast?.({ type: 'warning', message: 'Cerraste la ventana antes de terminar.' }); refreshDrive(); }
  };
  const onDisconnectDrive = async () => {
    try { await disconnectDrive(); addToast?.({ type: 'success', message: 'Drive desconectado.' }); refreshDrive(); }
    catch (e) { addToast?.({ type: 'error', message: e.message }); }
  };

  const semanas = useMemo(() => {
    const keys = new Set(allWeekKeys());
    keys.add(weekKeyOf());
    return [...keys].sort().reverse();
  }, [weekKey]); // eslint-disable-line

  const asigs = listAssignments(weekKey);
  const detail = asigs.find(a => a.id === detailId) || null;
  const nAprobSemana = asigs.filter(a => esCompleto(a.estado)).length;

  const personas = useMemo(() => {
    const set = new Set(EQUIPO_DEFAULT);
    allWeekKeys().forEach(wk => listAssignments(wk).forEach(a => { if (a.persona) set.add(a.persona); }));
    productos.forEach(p => { const r = (p.responsable || '').trim(); if (r) set.add(r); });
    return [...set];
  }, [weekKey, productos]); // eslint-disable-line
  // Asigna un color DISTINTO a cada persona (así Wanda y Dai no comparten color).
  // Sumamos las cuentas del equipo para cubrir a todos, no solo a los de esta semana.
  registrarColoresPersonas([...personas, ...team.map(m => m.display_name || m.email)]);

  // Opciones de los filtros del tablero: productos y personas presentes esta
  // semana (así el dropdown solo ofrece lo que existe).
  const productosEnSemana = useMemo(
    () => [...new Set(asigs.map(a => (a.productoNombre || '').trim() || 'Sin nombre'))].sort((x, y) => x.localeCompare(y, 'es')),
    [asigs],
  );
  const personasEnSemana = useMemo(
    () => [...new Set(asigs.map(a => (a.persona || '').trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es')),
    [asigs],
  );

  const asigsBoard = useMemo(() => {
    let list = asigs;
    if (soloSinAsignar) list = list.filter(a => !(a.persona || '').trim() && !a.creatorId);
    // Multi-select: si hay productos elegidos, la tarjeta pasa si su producto
    // está entre ellos (OR). Ídem personas, con '__sin__' = sin asignar.
    if (filtroProducto.length) list = list.filter(a => filtroProducto.includes((a.productoNombre || '').trim() || 'Sin nombre'));
    if (filtroPersona.length) list = list.filter(a => {
      const per = (a.persona || '').trim();
      if (!per && !a.creatorId) return filtroPersona.includes('__sin__');
      return filtroPersona.includes(per);
    });
    return list;
  }, [asigs, soloSinAsignar, filtroProducto, filtroPersona]);
  const byCol = useMemo(() => {
    const m = { porhacer: [], revision: [], aprobado: [], publicado: [], archivado: [] };
    const now = Date.now();
    // columnaEfectiva manda lo publicado hace +48h a "archivado" (auto-archivo).
    for (const a of asigsBoard) (m[columnaEfectiva(a, now)] || m.porhacer).push(a);
    return m;
  }, [asigsBoard]);
  // La columna "Archivado" está oculta por defecto; el toggle la muestra.
  const [mostrarArchivado, setMostrarArchivado] = useState(() => {
    try { return localStorage.getItem('adslab-prod-archivado') === '1'; } catch { return false; }
  });
  const toggleArchivado = () => setMostrarArchivado(v => {
    const n = !v; try { localStorage.setItem('adslab-prod-archivado', n ? '1' : '0'); } catch {}
    return n;
  });
  const colsVisibles = mostrarArchivado ? COLS : COLS.filter(c => c.key !== 'archivado');
  // En mobile el tablero se ve como pestañas por estado (una columna a la vez).
  const [mobileTab, setMobileTab] = useState('porhacer');
  // Si la pestaña activa apunta a una columna oculta (ej: se ocultó Archivado),
  // cae a la primera visible.
  const mobileTabOk = colsVisibles.some(c => c.key === mobileTab) ? mobileTab : (colsVisibles[0]?.key || 'porhacer');
  // Numeración de duplicados: si una persona tiene el mismo producto 2+ veces en
  // la semana, cada tarjeta lleva #1, #2… (igual que en el tablero del editor).
  const numMap = useMemo(() => numerarDuplicados(asigs), [asigs]);

  const onDrop = (e, colKey) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/prod-id');
    if (!id) return;
    // Solo se archiva lo ya publicado/aprobado (sino una tarjeta sin terminar
    // contaría como completa para el pago). El auto-archivo de 48h ya respeta esto.
    if (colKey === 'archivado') {
      const card = asigs.find(a => a.id === id);
      if (card && card.estado !== 'publicado' && card.estado !== 'aprobado') {
        addToast?.({ type: 'warning', message: 'Solo se archiva lo que ya está publicado o aprobado.' });
        return;
      }
    }
    // Regla: no se pasa a "En revisión" hasta subir los N videos.
    if (colKey === 'revision') {
      const card = asigs.find(a => a.id === id);
      const objetivo = card?.videosTotal || VIDEOS_POR_PRODUCTO;
      if (card && (card.archivos?.length || 0) < objetivo) {
        addToast?.({ type: 'warning', message: `Faltan videos: subí los ${objetivo} para pasar a revisión.` });
        return;
      }
    }
    updateAssignment(id, { estado: colKey });
  };

  return (
    <div className="max-w-full space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
          <Film size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Producción</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {asigs.length === 0
              ? 'Armá la semana: agregá productos y repartilos 🎬'
              : <>{asigs.length} en juego · <b className="text-emerald-600 dark:text-emerald-400">{nAprobSemana} aprobado{nAprobSemana === 1 ? '' : 's'}</b> esta semana {nAprobSemana > 0 ? '🔥' : '🎬'}</>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select value={weekKey} onChange={e => setWeekKey(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              {semanas.map(wk => <option key={wk} value={wk}>{weekLabel(wk)}{wk === weekKeyOf() ? ' (esta semana)' : ''}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={() => setShowBuscar(true)}
            title="Buscar videos: por nombre del video, producto, persona o fecha — con link directo a Drive."
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition shadow-sm">
            <Search size={14} /> Buscar videos
          </button>
          {/* Ajustes: todo lo de configuración (equipo, Drive, avisos, sync) en
              un solo menú, para dejar el header con lo mínimo del día a día. */}
          <div className="relative" ref={ajustesRef}>
            <button onClick={() => setAjustesOpen(o => !o)} title="Ajustes: equipo, Drive, avisos y más"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition shadow-sm border ${ajustesOpen ? 'border-brand-400 text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20' : 'text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              <Settings size={14} /> Ajustes
              <ChevronDown size={12} className={`transition ${ajustesOpen ? 'rotate-180' : ''}`} />
            </button>
            {ajustesOpen && (
              <div className="absolute right-0 top-full mt-1 z-40 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-1.5">
                <button onClick={() => { setShowTeam(true); setAjustesOpen(false); }}
                  className="w-full flex items-center gap-2.5 text-left text-sm font-semibold px-2.5 py-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                  <Users size={15} className="text-gray-400" /> Equipo y pagos
                </button>
                <button onClick={() => { setShowNotif(true); setAjustesOpen(false); }}
                  className="w-full flex items-center gap-2.5 text-left text-sm font-semibold px-2.5 py-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                  <Bell size={15} className="text-gray-400" /> Avisos de Discord
                </button>

                <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                {drive.connected ? (
                  <>
                    <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={14} /> Drive conectado{drive.email ? ` · ${drive.email}` : ''}
                    </div>
                    {drive.rootLink && (
                      <a href={drive.rootLink} target="_blank" rel="noopener noreferrer" onClick={() => setAjustesOpen(false)}
                        className="w-full flex items-center gap-2.5 text-left text-sm font-semibold px-2.5 py-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                        <ExternalLink size={15} className="text-gray-400" /> Abrir carpeta de Drive
                      </a>
                    )}
                    <button onClick={() => { onDisconnectDrive(); setAjustesOpen(false); }}
                      className="w-full flex items-center gap-2.5 text-left text-sm font-semibold px-2.5 py-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                      <X size={15} className="text-gray-400" /> Desconectar Drive
                    </button>
                  </>
                ) : (
                  <button onClick={() => { onConnectDrive(); setAjustesOpen(false); }} disabled={drive.connecting}
                    className="w-full flex items-center gap-2.5 text-left text-sm font-semibold px-2.5 py-2 rounded-lg text-pink-600 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition disabled:opacity-60">
                    {drive.connecting ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
                    {drive.connecting ? 'Conectando…' : 'Conectar Drive'}
                  </button>
                )}

                <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                <button onClick={() => { setConfirmResync(true); setAjustesOpen(false); }} disabled={resyncing}
                  className="w-full flex items-center gap-2.5 text-left text-sm font-semibold px-2.5 py-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50">
                  <RefreshCw size={15} className={`text-gray-400 ${resyncing ? 'animate-spin' : ''}`} /> Re-sincronizar
                </button>
                <button onClick={() => { setConfirmVaciar(true); setAjustesOpen(false); }} disabled={vaciando}
                  className="w-full flex items-center gap-2.5 text-left text-sm font-semibold px-2.5 py-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50">
                  <Trash2 size={15} /> Vaciar todo
                </button>
              </div>
            )}
          </div>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg hover:from-brand-600 hover:to-brand-800 transition shadow-sm">
            <Plus size={14} /> Agregar producto
          </button>
        </div>
      </div>

      {/* Diagnóstico de Drive: por qué falla "Conectar Drive" (en español, sin
          leer JSON). Solo cuando NO está conectado y ya tenemos el diag. */}
      {!drive.connected && driveDiag && (() => {
        const id = driveDiag.GOOGLE_OAUTH_CLIENT_ID || {};
        const sec = driveDiag.GOOGLE_OAUTH_CLIENT_SECRET || {};
        let tone = 'info', titulo = '';
        if (!driveDiag.ok) {
          tone = 'error';
          titulo = 'Faltan las credenciales de Google (GOOGLE_OAUTH_CLIENT_ID / SECRET) en Vercel.';
        } else if (driveDiag.autoCorrected) {
          tone = 'warn';
          titulo = 'El CLIENT_ID y el SECRET están cruzados en Vercel, pero la app lo corrige sola — tocá "Conectar Drive", debería andar. (Cuando puedas, ordenalos en Vercel.)';
        } else if (!sec.startsWithGOCSPX) {
          tone = 'error';
          titulo = `El valor en GOOGLE_OAUTH_CLIENT_SECRET NO es un secret válido (no empieza con "GOCSPX-"${sec.looksLikeId ? '; parece ser otro client_id' : ''}). Hay que poner el secret REAL: Google Cloud → tu cliente OAuth → "Restablecer secreto" → copiá el "GOCSPX-…" y pegalo en Vercel → Redeploy.`;
        } else if (id.hasSpaces || sec.hasSpaces) {
          tone = 'warn';
          titulo = `Hay un espacio o un enter pegado en ${sec.hasSpaces ? 'el CLIENT_SECRET' : 'el CLIENT_ID'}. Re-pegá el valor limpio en Vercel.`;
        } else if (!id.endsWithGoogle) {
          tone = 'warn';
          titulo = 'El CLIENT_ID no termina en ".apps.googleusercontent.com" — no parece un client_id válido.';
        } else {
          tone = 'info';
          titulo = 'Las credenciales tienen forma correcta. Si al conectar sigue diciendo "client secret is invalid", el secret NO corresponde a ese client_id: regeneralo en Google Cloud (mismo cliente OAuth) y re-pegá los DOS valores en Vercel.';
        }
        const colors = tone === 'error'
          ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          : tone === 'warn'
          ? 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
          : 'text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
        return (
          <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 border ${colors}`}>
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div>
              <b>Drive no conectado.</b> {titulo}{' '}
              <span className="opacity-70">(diagnóstico automático de las credenciales cargadas en Vercel)</span>
            </div>
          </div>
        );
      })()}

      {/* Resumen de la semana: carga por persona + objetivo. Clic en una persona
          filtra el tablero por ella (toggle). */}
      <ResumenSemana asigs={asigs} filtroSinAsignar={soloSinAsignar}
        onToggleSinAsignar={() => setSoloSinAsignar(v => !v)}
        activePersonas={filtroPersona}
        onPickPersona={(p) => setFiltroPersona(prev => prev.includes(p) ? prev.filter(x => x !== p) : [p])} />

      {/* Aviso de filtro activo */}
      {soloSinAsignar && (
        <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5">
          <AlertTriangle size={12} /> Mostrando solo lo sin asignar
          <button onClick={() => setSoloSinAsignar(false)} className="ml-auto inline-flex items-center gap-1 hover:underline">
            <X size={12} /> quitar filtro
          </button>
        </div>
      )}

      {/* Por producto (esta semana): cuántas TARJETAS faltan entregar (no cuenta
          videos) + plata invertida. La barra mide tarjetas entregadas/total. */}
      {asigs.length > 0 && (() => {
        const resumen = resumenVideosPorProducto(asigs).map(r => {
          const invertido = asigs.reduce((s, a) => {
            const nombre = ((a.productoNombre || '').trim() || 'Sin nombre').toLowerCase();
            return (nombre === r.producto.toLowerCase() && esCompleto(a.estado)) ? s + pagoProductoDe(a.persona) : s;
          }, 0);
          return { ...r, invertido };
        });
        const totalInvertido = resumen.reduce((s, r) => s + r.invertido, 0);
        const totalPend = resumen.reduce((s, r) => s + r.pendientes, 0);
        return (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Film size={15} className="text-emerald-500" />
              <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Por producto · esta semana</span>
              {totalPend > 0 && (
                <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 tabular-nums">· faltan entregar {totalPend}</span>
              )}
              {totalInvertido > 0 && (
                <span className="ml-auto text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">{fmtArs(totalInvertido)}</span>
              )}
            </div>
            <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {resumen.map(r => {
                const pct = r.tarjetas > 0 ? Math.round((r.entregadas / r.tarjetas) * 100) : 0;
                return (
                  <div key={r.producto}>
                    <div className="flex items-center justify-between text-xs mb-1 gap-2">
                      <span className="font-semibold text-gray-800 dark:text-gray-100 truncate min-w-0">
                        {r.producto}
                        <span className="font-normal text-gray-400 dark:text-gray-500"> · {r.tarjetas} tarj</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 tabular-nums">
                        <span className="text-gray-500 dark:text-gray-400">
                          {r.entregadas}/{r.tarjetas} entregadas · {r.pendientes > 0
                            ? <>falta{r.pendientes === 1 ? '' : 'n'} <b className="text-amber-600 dark:text-amber-400">{r.pendientes}</b></>
                            : <b className="text-emerald-500">✓ listo</b>}
                        </span>
                        {r.invertido > 0 && <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{fmtArs(r.invertido)}</span>}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Filtros del tablero: por producto y por persona. Acotan las columnas sin
          tocar los totales de arriba (que son de toda la semana). */}
      {asigs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 dark:text-gray-400">
            <Filter size={13} /> Filtrar
          </span>
          <MultiFiltro label="productos" selected={filtroProducto} onToggle={toggleEn(setFiltroProducto)}
            onClear={() => setFiltroProducto([])}
            options={productosEnSemana.map(p => ({ value: p, label: p }))} />
          <MultiFiltro label="personas" selected={filtroPersona} onToggle={toggleEn(setFiltroPersona)}
            onClear={() => setFiltroPersona([])}
            options={[...personasEnSemana.map(p => ({ value: p, label: p })), { value: '__sin__', label: '— Sin asignar —' }]} />
          {(filtroProducto.length > 0 || filtroPersona.length > 0) && (
            <>
              <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">{asigsBoard.length} tarjeta{asigsBoard.length === 1 ? '' : 's'}</span>
              <button onClick={() => { setFiltroProducto([]); setFiltroPersona([]); }}
                className="inline-flex items-center gap-1 text-xs font-bold text-gray-500 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-300 transition">
                <X size={12} /> limpiar
              </button>
            </>
          )}
          {/* Toggle de la columna Archivado (oculta por defecto). Muestra el
              contador de lo que hay archivado (auto-archivo a las 48h). */}
          <button onClick={toggleArchivado}
            title="Mostrar/ocultar la columna Archivado (lo publicado hace +48h se archiva solo)"
            className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg border transition ${mostrarArchivado ? 'border-gray-400 text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700' : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
            📦 {mostrarArchivado ? 'Ocultar' : 'Archivado'}{(byCol.archivado?.length || 0) > 0 ? ` · ${byCol.archivado.length}` : ''}
          </button>
        </div>
      )}

      {/* Pestañas por estado — SOLO en mobile: se muestra una columna a la vez,
          a lo ancho (más cómodo con el pulgar que el scroll horizontal). En
          desktop se ocultan y vuelve el kanban de columnas. */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
        {colsVisibles.map(col => {
          const on = col.key === mobileTabOk;
          return (
            <button key={col.key} onClick={() => setMobileTab(col.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${on ? `${col.hdr} ${col.text} ring-1 ring-inset ring-black/10 dark:ring-white/10` : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
              <span>{col.emoji}</span>{ESTADO_LABELS[col.key]}
              <span className={`text-[10px] font-mono rounded-full px-1.5 ${on ? 'bg-black/10 dark:bg-white/10' : 'bg-gray-200 dark:bg-gray-700'}`}>{(byCol[col.key] || []).length}</span>
            </button>
          );
        })}
      </div>

      {/* Tablero: en desktop, 4-5 columnas iguales (grid) que se estiran al alto
          del viewport; en mobile se muestra solo la columna de la pestaña activa,
          a lo ancho. */}
      <div className={`flex items-stretch gap-3 pb-2 lg:grid lg:overflow-visible lg:min-h-[calc(100vh-18rem)] ${mostrarArchivado ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {colsVisibles.map(col => {
          const cards = byCol[col.key] || [];
          return (
            <div key={col.key}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(col.key); }}
              onDragLeave={() => setDragOver(d => d === col.key ? null : d)}
              onDrop={e => onDrop(e, col.key)}
              className={`${col.key === mobileTabOk ? 'flex' : 'hidden'} lg:flex flex-col flex-1 lg:min-w-0 rounded-xl p-2.5 transition ${dragOver === col.key ? 'bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-300 dark:ring-brand-700' : 'bg-gray-50 dark:bg-gray-800/40'}`}>
              {/* Cabecera tintada con el color del estado: se reconoce por zona */}
              <div className={`flex items-center gap-2 px-2.5 py-1.5 mb-2 rounded-lg shrink-0 ${col.hdr}`}>
                <span className="text-sm leading-none">{col.emoji}</span>
                <span className={`text-xs font-bold uppercase tracking-wide ${col.text}`}>{ESTADO_LABELS[col.key]}</span>
                <span className="ml-auto text-xs font-mono text-gray-400 tabular-nums">{cards.length}</span>
              </div>
              {/* La lista crece para ocupar la columna; si hay muchas tarjetas,
                  scrollea DENTRO de la columna (no empuja toda la página). */}
              <div className="flex flex-col gap-2 flex-1 min-h-[60px] pt-2 lg:overflow-y-auto">
                {cards.map(a => (
                  <TarjetaProduccion key={a.id} a={a} num={numMap[a.id]} personas={personas} team={team} addToast={addToast}
                    caps={CAPS_ADMIN}
                    onOpen={() => setDetailId(a.id)} />
                ))}
                {cards.length === 0 && (
                  <div className="m-auto text-center text-xs text-gray-300 dark:text-gray-600 py-4 select-none">
                    {col.empty}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <AgregarProductoModal productos={productos} personas={personas} team={team} asigs={asigs} weekKey={weekKey}
          onClose={() => setShowAdd(false)} addToast={addToast} />
      )}
      {detail && (
        <CardDetailModal a={detail} personas={personas} team={team} onClose={() => setDetailId(null)} addToast={addToast} onTeamChange={reloadTeam} />
      )}
      {showTeam && (
        <TeamModal onClose={() => { setShowTeam(false); reloadTeam(); }} addToast={addToast} />
      )}
      {showNotif && (
        <NotifConfigModal team={team} onClose={() => setShowNotif(false)} addToast={addToast} />
      )}
      {showBuscar && (
        <VideoSearchModal onClose={() => setShowBuscar(false)} addToast={addToast} />
      )}
      <ConfirmDialog
        open={confirmResync}
        title="¿Re-sincronizar el tablero?"
        message="Descarta el tablero local y lo vuelve a traer de la nube (la fuente de verdad). Útil si quedó una tarjeta fantasma que nunca sincronizó. Ojo: se pierden cambios locales que todavía no hayan llegado al server."
        confirmLabel="Re-sincronizar" tone="brand"
        onConfirm={async () => {
          setConfirmResync(false); setResyncing(true);
          try { await resyncDesdeNube(); addToast?.({ type: 'success', message: 'Tablero re-sincronizado desde la nube.' }); }
          catch (e) { addToast?.({ type: 'error', message: `No se pudo re-sincronizar: ${e?.message || e}` }); }
          finally { setResyncing(false); }
        }}
        onClose={() => setConfirmResync(false)}
      />
      <ConfirmDialog
        open={confirmVaciar}
        title="⚠️ ¿Vaciar TODO y empezar de cero?"
        message="Borra TODAS las tarjetas, la config de pagos y ELIMINA las cuentas del equipo (los editores tendrán que crearse de nuevo). Solo afecta TU producción. Esta acción no se puede deshacer."
        confirmLabel="Sí, vaciar todo" tone="danger"
        onConfirm={async () => {
          setConfirmVaciar(false); setVaciando(true);
          try {
            // 1) Eliminar las cuentas del equipo (borra los usuarios de auth).
            let cuentas = 0;
            for (const m of team) {
              try { await removeMember(m.id); cuentas++; } catch (e) { console.warn('remove member', m.id, e?.message || e); }
            }
            // 2) Vaciar tarjetas + pagos + config (nube y local, solo lo mío).
            const r = await vaciarTodo();
            reloadTeam();
            if (r.error) addToast?.({ type: 'error', message: `Se limpió local, pero la nube falló: ${r.error}` });
            else addToast?.({ type: 'success', message: `🧹 Todo en cero: ${r.asignaciones} tarjeta${r.asignaciones === 1 ? '' : 's'} y ${cuentas} cuenta${cuentas === 1 ? '' : 's'} eliminadas. A crear de nuevo 🚀` });
          } catch (e) {
            addToast?.({ type: 'error', message: `No se pudo vaciar: ${e?.message || e}` });
          } finally { setVaciando(false); }
        }}
        onClose={() => setConfirmVaciar(false)}
      />
    </div>
  );
}

// ── Agregar productos (crea tarjetas en "Por hacer"). Multi-selección: podés
// tildar varios productos y crearlos todos juntos con una sola vuelta.
function AgregarProductoModal({ productos, personas, team = [], asigs, weekKey, onClose, addToast }) {
  useEscape(onClose);
  const [selected, setSelected] = useState(() => new Set());
  // Multi-persona con MULTIPLICADOR: click en un chip cicla ×1 → ×2 → ×3 → sacar.
  // key = id de cuenta del equipo, o "p:Nombre" para etiquetas sin cuenta.
  const [counts, setCounts] = useState(() => new Map());
  const [q, setQ] = useState('');

  const yaEnSemana = useMemo(() => new Set(asigs.map(a => String(a.productoId))), [asigs]);
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? productos.filter(p => (p.nombre || '').toLowerCase().includes(t)) : productos;
  }, [productos, q]);

  const toggle = (id) => setSelected(prev => {
    const n = new Set(prev);
    const k = String(id);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const cycle = (key) => setCounts(prev => {
    const n = new Map(prev);
    const c = (n.get(key) || 0) + 1;
    if (c > 3) n.delete(key); else n.set(key, c);
    return n;
  });

  // Destinos activos (persona × cantidad). Sin ninguno → tarjetas sin asignar.
  const targets = [...counts.entries()].filter(([, c]) => c > 0);
  const copiasPorProducto = targets.reduce((s, [, c]) => s + c, 0) || 1;
  const totalTarjetas = selected.size * copiasPorProducto;

  const crear = () => {
    const ids = [...selected];
    if (ids.length === 0) { addToast?.({ type: 'warning', message: 'Elegí al menos un producto.' }); return; }
    let n = 0;
    ids.forEach(id => {
      const prod = productos.find(p => String(p.id) === id);
      if (!prod) return;
      if (targets.length === 0) {
        addAssignment({ weekKey, productoId: prod.id, productoNombre: prod.nombre, persona: '', creatorId: null });
        n++;
        return;
      }
      targets.forEach(([key, c]) => {
        const m = team.find(t => t.id === key);
        const per = m ? (m.display_name || m.email) : key.slice(2); // "p:Nombre"
        for (let i = 0; i < c; i++) {
          addAssignment({ weekKey, productoId: prod.id, productoNombre: prod.nombre, persona: per, creatorId: m ? m.id : null });
          n++;
        }
      });
    });
    addToast?.({ type: 'success', message: `🎬 ${n} tarjeta${n === 1 ? '' : 's'} creada${n === 1 ? '' : 's'} para ${weekLabel(weekKey)}` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <Plus size={16} className="text-brand-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Agregar productos a la semana</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">
              Productos {selected.size > 0 && <span className="text-brand-500">· {selected.size} elegido{selected.size === 1 ? '' : 's'}</span>}
            </span>
            {/* Buscador — filtra la lista por nombre */}
            <div className="relative mb-1.5">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar producto…"
                className="w-full pl-8 pr-8 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {q && (
                <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
              )}
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
              {productos.length === 0 && <p className="text-xs text-gray-400 p-3">No hay productos cargados.</p>}
              {productos.length > 0 && filtrados.length === 0 && <p className="text-xs text-gray-400 p-3">Nada coincide con «{q}».</p>}
              {filtrados.map(p => {
                const ya = yaEnSemana.has(String(p.id));
                const sel = selected.has(String(p.id));
                return (
                  <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input type="checkbox" checked={sel} onChange={() => toggle(p.id)} className="w-4 h-4 accent-brand-600" />
                    <span className="flex-1 text-gray-800 dark:text-gray-100 truncate">{p.nombre}</span>
                    {/* Repetir está PERMITIDO: Fran puede hacer Tiva ×2 y Wanda ×3.
                        Solo avisamos que ya tiene tarjetas esta semana. */}
                    {ya && <span className="text-[11px] text-gray-400" title="Ya tiene tarjetas esta semana — podés agregarle más igual">ya está · se puede repetir</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">
              ¿Para quién? <span className="normal-case font-medium text-gray-400">(tocá de nuevo para ×2 / ×3 — podés elegir a varios)</span>
            </span>
            {(() => {
              // Chips con multiplicador: sirven para cuentas del equipo y, si no
              // hay cuentas, para las etiquetas de siempre.
              const opciones = team.length > 0
                ? team.map(m => ({ key: m.id, nombre: m.display_name || m.email }))
                : personas.map(p => ({ key: `p:${p}`, nombre: p }));
              return (
                <div className="flex flex-wrap gap-1.5">
                  {opciones.map(({ key, nombre }) => {
                    const c = counts.get(key) || 0;
                    return (
                      <button key={key} onClick={() => cycle(key)}
                        title={c === 0 ? `Asignarle a ${nombre}` : c < 3 ? `${nombre} ×${c} — tocá para ×${c + 1}` : `${nombre} ×3 — tocá para sacar`}
                        className={`text-xs font-bold px-2.5 py-1 rounded-md transition ${c > 0 ? CHIP_CLS[personaColor(nombre)] : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
                        {nombre}{c > 1 && <span className="ml-1 rounded bg-black/25 px-1 text-[11px] tabular-nums">×{c}</span>}
                      </button>
                    );
                  })}
                  {team.length === 0 && (
                    <p className="w-full text-[10px] text-gray-400 mt-1">Tip: creá cuentas en "Equipo" para que cada uno vea lo suyo.</p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          {/* Resumen del reparto: "2 productos × (Fran ×2 + Wanda ×3)" */}
          {selected.size > 0 && targets.length > 0 && (
            <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {selected.size} producto{selected.size === 1 ? '' : 's'} × ({targets.map(([key, c]) => {
                const m = team.find(t => t.id === key);
                const nombre = m ? (m.display_name || m.email) : key.slice(2);
                return c > 1 ? `${nombre} ×${c}` : nombre;
              }).join(' + ')})
            </span>
          )}
          <button onClick={crear} disabled={selected.size === 0}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus size={15} /> Crear {selected.size > 0 ? `${totalTarjetas} ` : ''}tarjeta{totalTarjetas === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reasignar en bloque: mueve TODAS las tarjetas de la semana de una persona
// (o las sin asignar) a una cuenta del equipo. Para cubrir vacaciones/bajas o
// repartir lo que quedó suelto, sin ir tarjeta por tarjeta.
function ReasignarModal({ asigs, team, weekKey, onClose, addToast }) {
  useEscape(onClose);
  const [from, setFrom] = useState('');
  const [toId, setToId] = useState('');

  // Orígenes: cada persona/cuenta con tarjetas en la semana + "Sin asignar".
  const origenes = useMemo(() => {
    const map = new Map();
    asigs.forEach(a => {
      const per = (a.persona || '').trim();
      const key = a.creatorId || (per ? `p:${per}` : 'sin');
      const label = per || 'Sin asignar';
      if (!map.has(key)) map.set(key, { key, label, n: 0 });
      map.get(key).n++;
    });
    return [...map.values()].sort((x, y) => y.n - x.n);
  }, [asigs]);

  const sel = origenes.find(o => o.key === from);
  const destino = team.find(m => m.id === toId);

  const mover = () => {
    if (!sel || !destino) { addToast?.({ type: 'warning', message: 'Elegí de quién y a quién.' }); return; }
    let n = 0;
    asigs.forEach(a => {
      const per = (a.persona || '').trim();
      const key = a.creatorId || (per ? `p:${per}` : 'sin');
      if (key !== sel.key) return;
      assignCreator(a.id, { creatorId: destino.id, persona: destino.display_name || destino.email });
      n++;
    });
    addToast?.({ type: 'success', message: `💪 ${n} tarjeta${n === 1 ? '' : 's'} de ${weekLabel(weekKey)} → ${destino.display_name || destino.email}` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <ArrowLeftRight size={16} className="text-brand-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Reasignar la semana</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {team.length === 0 ? (
            <p className="text-sm text-gray-400">Primero creá cuentas del equipo (botón "Equipo").</p>
          ) : origenes.length === 0 ? (
            <p className="text-sm text-gray-400">No hay tarjetas en esta semana.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Mover las tarjetas de…</span>
                <select autoFocus value={from} onChange={e => setFrom(e.target.value)}
                  className="px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">Elegí…</option>
                  {origenes.map(o => <option key={o.key} value={o.key}>{o.label} ({o.n})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">…a la cuenta de</span>
                <select value={toId} onChange={e => setToId(e.target.value)}
                  className="px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">Elegí…</option>
                  {team.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                </select>
              </label>
              {sel && destino && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Se mueven <b>{sel.n}</b> tarjeta{sel.n === 1 ? '' : 's'} de <b>{sel.label}</b> a <b>{destino.display_name || destino.email}</b> (va a verlas en su tablero).
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={mover} disabled={!sel || !destino}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
            <ArrowLeftRight size={14} /> Mover{sel ? ` ${sel.n}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Historial de la tarjeta: creación + cada cambio de estado (quién y cuándo).
// Base para medir tiempos de entrega / eficiencia del equipo.
function HistorialTarjeta({ a }) {
  const [abierto, setAbierto] = useState(false);
  const eventos = a.historial || [];
  if (eventos.length === 0) return null;
  const fmt = (ts) => {
    try { return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };
  const label = (ev) => {
    if (ev.tipo === 'creacion') return 'Tarjeta creada';
    if (ev.tipo === 'estado') return `${ESTADO_LABELS[ev.from] || ev.from || '—'} → ${ESTADO_LABELS[ev.to] || ev.to}`;
    if (ev.tipo === 'subida') return `Subió ${ev.n ? `${ev.n} ` : ''}video(s)`;
    return ev.tipo;
  };
  const ultimo = eventos[eventos.length - 1];
  return (
    <div>
      {/* Cabecera desplegable: cerrada muestra solo el último movimiento */}
      <button onClick={() => setAbierto(o => !o)} className="w-full flex items-center gap-1.5 text-left group">
        <History size={13} className="text-gray-400" />
        <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Historial</span>
        <span className="text-[11px] text-gray-400 tabular-nums">({eventos.length})</span>
        {!abierto && ultimo && (
          <span className="text-[11px] text-gray-400 truncate">· último: {label(ultimo)} — {fmt(ultimo.ts)}</span>
        )}
        <ChevronDown size={13} className={`ml-auto shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <ol className="mt-2 space-y-2 border-l border-gray-200 dark:border-gray-700 pl-3.5 ml-1 max-h-44 overflow-y-auto">
          {[...eventos].reverse().map((ev, i) => (
            <li key={i} className="relative text-xs leading-tight">
              <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-brand-400 ring-2 ring-white dark:ring-gray-900" />
              <span className="font-semibold text-gray-700 dark:text-gray-200">{label(ev)}</span>
              <div className="text-gray-400">{ev.byName || 'Alguien'} · {fmt(ev.ts)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Contraseña sugerida para darle acceso a un integrante (se la pasás vos).
function suggestPass() {
  const w = ['creativo', 'video', 'lab', 'equipo', 'reel', 'clip'][Math.floor(Math.random() * 6)];
  return `${w}${Math.floor(1000 + Math.random() * 9000)}`;
}

// Selector UNIFICADO de integrante: funde "persona" (texto) y "cuenta" (login)
// en una sola lista. Elegís a quién asignar; los que no tienen login muestran
// "Dar acceso", que crea la cuenta con el mismo nombre y VINCULA las tarjetas
// que ese nombre ya tenía (setea creator_id en todas). Reemplaza el doble
// control "Asignar a cuenta" + chips de "Persona".
function IntegranteSelector({ a, team = [], personas = [], onTeamChange, addToast }) {
  const [giving, setGiving] = useState(null); // nombre al que le estamos dando acceso
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  // Cuántas tarjetas tiene cada nombre (para el subtítulo de cada fila).
  const cardCounts = useMemo(() => {
    const m = {};
    try { for (const p of personasEnTarjetas()) m[p.persona.trim().toLowerCase()] = p.tarjetas; } catch {}
    return m;
  }, [team]); // recomputa al cambiar el equipo (después de dar acceso)

  // Lista unificada: cuentas (con acceso) + personas de texto que no coincidan
  // con una cuenta ya existente (sin acceso).
  const teamById = new Map(team.map(m => [m.id, m]));
  const accountNames = new Set(team.map(m => (m.display_name || m.email || '').trim().toLowerCase()).filter(Boolean));
  const currentPersonaKey = (a.persona || '').trim().toLowerCase();
  const integrantes = [
    ...team.map(m => {
      const name = m.display_name || m.email;
      return { key: `a:${m.id}`, name, creatorId: m.id, hasAccess: true, email: m.email, cards: cardCounts[(name || '').trim().toLowerCase()] || 0 };
    }),
    ...personas
      // Solo personas de texto que NO tienen cuenta y que son REALES (con
      // tarjetas) o la asignación actual — así no ensuciamos con los nombres por
      // defecto vacíos (Fran/Wanda/Flor…) que ya no se usan.
      .filter(p => {
        const k = (p || '').trim().toLowerCase();
        if (!k || accountNames.has(k)) return false;
        return (cardCounts[k] || 0) > 0 || k === currentPersonaKey;
      })
      .map(p => ({ key: `p:${p}`, name: p, creatorId: null, hasAccess: false, email: null, cards: cardCounts[p.trim().toLowerCase()] || 0 })),
  ].sort((x, y) => (Number(y.hasAccess) - Number(x.hasAccess)) || (y.cards - x.cards) || x.name.localeCompare(y.name, 'es'));

  // Selección actual. Si la cuenta fue borrada (el creatorId ya no está en el
  // equipo), caemos al label de persona; y si la actual no quedó en la lista, la
  // agregamos para que igual se vea seleccionada (nada de selección en blanco).
  const accountVivo = !!(a.creatorId && teamById.has(a.creatorId));
  const currentKey = accountVivo ? `a:${a.creatorId}` : (a.persona ? `p:${a.persona}` : null);
  if (currentKey && !integrantes.some(it => it.key === currentKey)) {
    integrantes.unshift({ key: currentKey, name: a.persona || '(sin nombre)', creatorId: accountVivo ? a.creatorId : null, hasAccess: accountVivo, email: null, cards: cardCounts[currentPersonaKey] || 0 });
  }

  const asignar = (it) => {
    assignCreator(a.id, { creatorId: it.creatorId, persona: it.name });
    if (it.hasAccess) addToast?.({ type: 'success', message: `Tarjeta asignada a ${it.name} — la va a ver en su tablero` });
  };
  const sinAsignar = () => assignCreator(a.id, { creatorId: null, persona: '' });

  const startGive = (it) => { setGiving(it.name); setEmail(''); setPass(suggestPass()); };
  const confirmGive = async () => {
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { addToast?.({ type: 'warning', message: 'Email inválido' }); return; }
    if (pass.length < 6) { addToast?.({ type: 'warning', message: 'La contraseña necesita 6+ caracteres' }); return; }
    setBusy(true);
    try {
      const member = await createMember(em, pass, giving);
      const cid = member?.id;
      // Vinculamos TODAS las tarjetas de ese nombre a la nueva cuenta.
      let n = 0;
      const target = giving.trim().toLowerCase();
      for (const wk of allWeekKeys()) {
        for (const asg of listAssignments(wk)) {
          if ((asg.persona || '').trim().toLowerCase() === target) { assignCreator(asg.id, { creatorId: cid, persona: giving }); n++; }
        }
      }
      // Aseguramos también la tarjeta actual (por si su persona no matcheaba).
      assignCreator(a.id, { creatorId: cid, persona: giving });
      onTeamChange?.();
      addToast?.({ type: 'success', message: `Acceso creado para ${giving}${n > 0 ? ` · ${n} tarjeta${n !== 1 ? 's' : ''} vinculada${n !== 1 ? 's' : ''}` : ''}. Contraseña: ${pass}` });
      setGiving(null);
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Asignar a</span>
      <div className="space-y-1.5">
        {integrantes.map(it => {
          const sel = it.key === currentKey;
          return (
            <div key={it.key}>
              <div
                onClick={() => asignar(it)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition ${
                  sel ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-900/20 ring-1 ring-brand-300 dark:ring-brand-700'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}>
                <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${sel ? 'border-brand-500' : 'border-gray-300 dark:border-gray-500'}`}>
                  {sel && <span className="w-2 h-2 rounded-full bg-brand-500" />}
                </span>
                <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-xs font-bold uppercase shrink-0">
                  {(it.name[0] || '?')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{it.name}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                    {it.hasAccess ? (it.email || 'con login') : `${it.cards} tarjeta${it.cards !== 1 ? 's' : ''}`}
                  </div>
                </div>
                {!it.hasAccess && (
                  <>
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded-full px-2 py-0.5 shrink-0">sin acceso</span>
                    <button onClick={e => { e.stopPropagation(); startGive(it); }}
                      className="text-[10px] font-bold text-brand-600 dark:text-brand-300 border border-brand-300 dark:border-brand-700 rounded-md px-2 py-1 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition shrink-0">
                      Dar acceso
                    </button>
                  </>
                )}
              </div>
              {/* Form inline de "dar acceso" */}
              {giving === it.name && (
                <div className="mt-1.5 ml-6 mr-1 p-3 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-900/10 space-y-2" onClick={e => e.stopPropagation()}>
                  <p className="text-[11px] text-gray-600 dark:text-gray-300">Creale el login a <b>{it.name}</b>. Se le vinculan sus {it.cards} tarjeta{it.cards !== 1 ? 's' : ''}.</p>
                  <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="email@ejemplo.com" autoFocus
                    className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
                  <div className="flex items-center gap-2">
                    <input value={pass} onChange={e => setPass(e.target.value)} placeholder="Contraseña"
                      className="flex-1 px-2.5 py-1.5 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    <button onClick={confirmGive} disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-md transition disabled:opacity-50">
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Crear acceso
                    </button>
                    <button onClick={() => setGiving(null)} className="px-2 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700">Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* Sin asignar */}
        <button onClick={sinAsignar}
          className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
            !currentKey ? 'border-brand-400 text-brand-600 dark:text-brand-300 bg-brand-50/50 dark:bg-brand-900/20' : 'border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-gray-600'
          }`}>
          — Sin asignar —
        </button>
      </div>
    </div>
  );
}

// ── Buscador de videos: barre TODOS los creativos subidos (de todas las semanas)
// y filtra por nombre del video, producto, persona o fecha. Cada resultado trae
// el link directo a Drive (ver / descargar). Sirve para encontrar rápido un
// winner y volver a iterarlo.
function VideoSearchModal({ onClose, addToast }) {
  useEscape(onClose);
  const [query, setQuery] = useState('');
  const [bump, setBump] = useState(0);
  const index = useMemo(() => {
    const recs = [];
    for (const wk of allWeekKeys()) {
      for (const a of listAssignments(wk)) {
        for (const f of (a.archivos || [])) {
          const producto = a.productoNombre || 'Sin producto';
          const persona = a.persona || 'Sin asignar';
          const fecha = weekLabel(a.weekKey);
          recs.push({
            key: `${a.id}:${f.ts}`,
            name: f.name || 'video',
            producto, productoId: a.productoId, persona, fecha,
            estado: a.estado,
            destino: f.destino,
            link: f.link || f.folderLink || null,
            driveId: f.driveId || null,
            sizeMB: f.sizeMB || null,
            ts: parseInt(String(f.ts || '').split('-')[0], 10) || 0,
            hay: `${f.name} ${producto} ${persona} ${fecha}`.toLowerCase(),
          });
        }
      }
    }
    return recs.sort((x, y) => y.ts - x.ts);
  }, []);

  // Claves de winners por producto (para pintar la estrella). Se recalcula al
  // marcar/desmarcar (bump).
  const winnerKeys = useMemo(() => {
    const wkey = (w) => String(w?.driveId || w?.link || w?.name || '').trim().toLowerCase();
    const pkey = (pid, nom) => (pid != null ? String(pid) : (nom || '').trim().toLowerCase());
    const s = new Set();
    for (const wk of allWeekKeys()) for (const a of listAssignments(wk)) {
      for (const w of (a.winners || [])) s.add(`${pkey(a.productoId, a.productoNombre)}::${wkey(w)}`);
    }
    return s;
  }, [bump]);
  const esWin = (r) => winnerKeys.has(`${r.productoId != null ? String(r.productoId) : r.producto.toLowerCase()}::${String(r.driveId || r.link || r.name || '').trim().toLowerCase()}`);
  const onToggleWin = (r) => {
    const quedo = toggleWinner(r, r.productoId, r.producto);
    setBump(n => n + 1);
    addToast?.({ type: quedo ? 'success' : 'info', message: quedo ? `★ Marcado winner de ${r.producto}` : `Quitado de winners de ${r.producto}` });
  };

  const toks = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = toks.length ? index.filter(r => toks.every(t => r.hay.includes(t))) : index;
  const shown = results.slice(0, 80);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl my-6 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <Search size={18} className="text-brand-500" />
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 leading-tight">Buscar videos</h3>
            <p className="text-[11px] text-gray-400">Por nombre del video, producto, persona o fecha — con link a Drive.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-5 pt-4 pb-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Ej: [c9][Ponzio][14-8][broll]  ·  Cepillo  ·  14-8"
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <p className="text-[11px] text-gray-400 mt-2">{results.length} video{results.length === 1 ? '' : 's'}{results.length > 80 ? ' · mostrando 80' : ''}</p>
        </div>

        <div className="max-h-[58vh] overflow-y-auto border-t border-gray-100 dark:border-gray-800">
          {shown.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              {index.length === 0 ? 'Todavía no hay videos subidos.' : 'Ningún video coincide con la búsqueda.'}
            </div>
          ) : shown.map(r => (
            <div key={r.key} className="flex items-center gap-3 px-5 py-2.5 border-t border-gray-100 dark:border-gray-800 first:border-t-0 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition">
              <Film size={15} className={`shrink-0 ${r.destino === 'drive' ? 'text-emerald-500' : 'text-gray-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate" title={r.name}>{r.name}</div>
                <div className="text-[11px] text-gray-400 truncate">{r.producto} · {r.persona} · {r.fecha}{r.sizeMB ? ` · ${r.sizeMB}MB` : ''}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => onToggleWin(r)} title={esWin(r) ? 'Quitar de winners' : 'Marcar como winner'}
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition ${esWin(r) ? 'text-amber-500 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800' : 'text-gray-400 border-gray-300 dark:border-gray-600 hover:text-amber-500 hover:border-amber-300'}`}>
                  <Star size={14} fill={esWin(r) ? 'currentColor' : 'none'} />
                </button>
                {r.destino === 'drive' && r.link ? (
                  <>
                    <a href={r.link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-brand-600 dark:text-brand-300 border border-brand-300 dark:border-brand-700 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/20 transition">
                      <ExternalLink size={12} /> Abrir
                    </a>
                    {r.driveId && (
                      <a href={`https://drive.google.com/uc?export=download&id=${r.driveId}`} target="_blank" rel="noopener noreferrer"
                        title="Descargar el video" aria-label="Descargar"
                        className="inline-flex items-center justify-center w-8 h-8 text-gray-500 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:text-brand-600 hover:border-brand-400 transition">
                        <Download size={13} />
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-1">AdsLab</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Config de avisos de Discord: por cada EVENTO (producto nuevo / revisión /
// aprobado / publicado), si avisa, a qué canal (webhook) y a quién @mencionar.
// Se guarda por dueño en la nube (produccion_notif_config).
const EVENTOS_NOTIF = [
  { key: 'nuevo', label: 'Producto nuevo', emoji: '🆕', hint: 'Al crear una tarjeta/producto' },
  { key: 'revision', label: 'En revisión', emoji: '👀', hint: 'Cuando una tarjeta pasa a revisión' },
  { key: 'aprobado', label: 'Listo para publicar', emoji: '✅', hint: 'Cuando una tarjeta se aprueba' },
  { key: 'publicado', label: 'Publicado', emoji: '🚀', hint: 'Cuando una tarjeta se publica' },
];
const DEFAULT_NOTIF = {
  eventos: {
    nuevo: { on: true, webhook: '', mentions: '' },
    revision: { on: true, webhook: '', mentions: '' },
    aprobado: { on: true, webhook: '', mentions: '' },
    publicado: { on: true, webhook: '', mentions: '' },
  },
};

function NotifConfigModal({ team = [], onClose, addToast }) {
  const [cfg, setCfg] = useState(DEFAULT_NOTIF);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probando, setProbando] = useState(false);
  useEscape(onClose);
  useEffect(() => {
    let alive = true;
    loadNotifConfig().then(c => {
      if (!alive) return;
      const ev = c?.eventos || c?.estados;   // soporta shape viejo
      if (ev) {
        const merged = {};
        for (const e of EVENTOS_NOTIF) merged[e.key] = { ...DEFAULT_NOTIF.eventos[e.key], ...(ev[e.key] || {}) };
        setCfg({ eventos: merged });
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);
  const setEvento = (key, patch) => setCfg(c => ({ eventos: { ...c.eventos, [key]: { ...c.eventos[key], ...patch } } }));
  const guardar = async () => {
    setSaving(true);
    const { error } = await saveNotifConfig(cfg);
    setSaving(false);
    if (error) addToast?.({ type: 'error', message: `No se pudo guardar: ${error}` });
    else { addToast?.({ type: 'success', message: 'Avisos de Discord guardados.' }); onClose(); }
  };
  const probar = async () => {
    setProbando(true);
    const webhooks = [...new Set(EVENTOS_NOTIF.map(e => (cfg.eventos[e.key]?.webhook || '').trim()).filter(Boolean))];
    const r = await probarDiscord(webhooks);
    setProbando(false);
    if (r?.sent > 0) addToast?.({ type: 'success', message: `🔔 Prueba enviada a ${r.sent} canal${r.sent === 1 ? '' : 'es'}. Revisá Discord.` });
    else if (r?.reason === 'no-webhook') addToast?.({ type: 'warning', message: 'Cargá al menos un webhook (o la env var global) para probar.' });
    else addToast?.({ type: 'error', message: `Discord no aceptó la prueba: ${r?.errors?.[0] || r?.error || r?.reason || 'error'}` });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg my-6 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <Bell size={18} className="text-indigo-500" />
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 leading-tight">Avisos de Discord</h3>
            <p className="text-[11px] text-gray-400">Cada evento a su propio canal, con a quién mencionar.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
          ) : (
            <>
              {EVENTOS_NOTIF.map(e => {
                const ev = cfg.eventos[e.key] || { on: true, webhook: '', mentions: '' };
                return (
                  <div key={e.key} className={`rounded-xl border p-3 transition ${ev.on ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-800 opacity-60'}`}>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEvento(e.key, { on: !ev.on })}
                        className={`relative w-9 h-5 rounded-full transition shrink-0 ${ev.on ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${ev.on ? 'left-4' : 'left-0.5'}`} />
                      </button>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-gray-800 dark:text-gray-100 leading-tight">{e.emoji} {e.label}</div>
                        <div className="text-[10px] text-gray-400 leading-tight">{e.hint}</div>
                      </div>
                      <span className="ml-auto text-[11px] text-gray-400 shrink-0">{ev.on ? 'avisa' : 'off'}</span>
                    </div>
                    <input type="url" value={ev.webhook} onChange={x => setEvento(e.key, { webhook: x.target.value })} disabled={!ev.on}
                      placeholder="Webhook del canal (https://discord.com/api/webhooks/…)"
                      className="mt-2 w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" />
                    <input type="text" value={ev.mentions} onChange={x => setEvento(e.key, { mentions: x.target.value })} disabled={!ev.on}
                      placeholder="IDs de Discord a @mencionar (coma). Ej: 123…, 456…"
                      className="mt-1.5 w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" />
                  </div>
                );
              })}
              <details className="text-[11px] text-gray-500 dark:text-gray-400">
                <summary className="cursor-pointer font-semibold">Cómo obtener el webhook de un canal y el ID de una persona</summary>
                <div className="mt-1.5 space-y-1 pl-1">
                  <p><b>Webhook</b>: en Discord, engranaje del canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL. Un canal distinto por evento.</p>
                  <p><b>ID de persona</b>: Ajustes → Avanzado → Modo desarrollador. Después clic derecho sobre la persona → Copiar ID de usuario. Varias, separadas por coma. Para un rol, <b>&amp;</b> antes del ID.</p>
                  <p>Si dejás un webhook vacío, ese evento cae al canal global (si está configurado en Vercel).</p>
                </div>
              </details>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={probar} disabled={probando}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-indigo-600 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition disabled:opacity-50">
            {probando ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />} Probar canales
          </button>
          <button onClick={guardar} disabled={saving || loading}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detalle de la tarjeta (estilo Trello): persona, tipo, estado, brief a mano,
// creativos (subida a Drive), y contador de videos aprobados.
function CardDetailModal({ a, personas, team = [], onClose, addToast, onTeamChange }) {
  const [brief, setBrief] = useState(a.brief || '');
  const [material, setMaterial] = useState(a.materialLink || '');
  const nFiles = a.archivos?.length || 0;

  const saveBrief = () => { if (brief !== (a.brief || '')) updateAssignment(a.id, { brief }); };
  // El link de material es POR PRODUCTO: lo copiamos a todas las tarjetas del
  // mismo producto (así el editor lo ve en cualquiera de ellas).
  const saveMaterial = () => { const v = material.trim(); if (v !== (a.materialLink || '')) setMaterialLinkProducto(a.productoId, a.productoNombre, v); };
  const saveAll = () => { saveBrief(); saveMaterial(); };
  // Diálogos propios (reemplazan window.confirm/prompt): 'eliminar' | 'cambios'.
  const [dlg, setDlg] = useState(null);
  useEscape(() => { if (dlg) return; saveAll(); onClose(); }); // Esc = guardar brief y cerrar (salvo diálogo abierto)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={() => { saveAll(); onClose(); }}>
      <div className="w-full max-w-2xl my-6 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <Film size={18} className="text-brand-500 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{a.productoNombre || 'Producto'}</h3>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <PersonaChip persona={a.persona} />
              <span className="text-[11px] text-gray-400">{ESTADO_LABELS[a.estado]}</span>
            </div>
          </div>
          <button onClick={() => { saveAll(); onClose(); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* La asignación se hace desde la tarjeta del tablero (tocando la
              etiqueta de persona), no acá — para que el detalle sea más corto. */}

          {/* Estado */}
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Estado</span>
            <div className="flex flex-wrap gap-1">
              {ESTADOS.filter(e => e !== 'archivado' || a.estado === 'publicado' || a.estado === 'aprobado').map(e => (
                <button key={e} onClick={() => updateAssignment(a.id, { estado: e })}
                  className={`text-[11px] font-bold px-2 py-1 rounded-md transition ${a.estado === e ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200'}`}>
                  {ESTADO_LABELS[e]}
                </button>
              ))}
            </div>
          </div>

          {/* Cambios pedidos (lo que ve el creativo) */}
          {(a.nota || '').trim() && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300 mb-0.5"><AlertTriangle size={11} /> Cambios pedidos</div>
              <p className="text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">{a.nota}</p>
            </div>
          )}

          {/* Material del producto (Drive) — link a la carpeta con TODO el
              material. Es por PRODUCTO: se guarda en todas las tarjetas del
              mismo producto y el editor lo abre desde su tablero. */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <FolderOpen size={13} className="text-pink-500" />
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Material del producto (Drive)</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="url" value={material} onChange={e => setMaterial(e.target.value)} onBlur={saveMaterial}
                placeholder="https://drive.google.com/… (carpeta con todo el material del producto)"
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500" />
              {material.trim() && (
                <a href={material.trim()} target="_blank" rel="noopener noreferrer" onClick={saveMaterial}
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-pink-600 dark:text-pink-300 border border-pink-300 dark:border-pink-800 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/20 transition">
                  <FolderOpen size={13} /> Abrir
                </a>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">Se aplica a todas las tarjetas de este producto.</p>
          </div>

          {/* Winners del producto — creativos que vendieron, de referencia. Se
              marcan desde "Buscar videos" y aparecen en todas las tarjetas del
              producto (el editor los usa como material). */}
          {(() => {
            const winners = winnersDeProducto(a.productoId, a.productoNombre);
            if (winners.length === 0) return null;
            return (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Star size={13} className="text-amber-500" fill="currentColor" />
                  <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Winners del producto · {winners.length}</span>
                </div>
                <div className="space-y-1.5">
                  {winners.map(w => (
                    <div key={w.driveId || w.link || w.name} className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10 px-2.5 py-1.5">
                      <Star size={12} className="text-amber-500 shrink-0" fill="currentColor" />
                      <span className="flex-1 min-w-0 truncate text-xs font-medium text-gray-800 dark:text-gray-100" title={w.name}>{w.name}</span>
                      {w.fecha && <span className="text-[10px] text-gray-400 shrink-0 hidden sm:block">{w.fecha}</span>}
                      {w.link && (
                        <a href={w.link} target="_blank" rel="noopener noreferrer" title="Abrir en Drive"
                          className="text-brand-500 hover:text-brand-600 shrink-0"><ExternalLink size={13} /></a>
                      )}
                      <button onClick={() => toggleWinner(w, a.productoId, a.productoNombre)} title="Quitar de winners"
                        className="text-gray-300 hover:text-red-500 shrink-0"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Brief a mano */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileText size={13} className="text-gray-400" />
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Brief / guiones</span>
            </div>
            <textarea value={brief} onChange={e => setBrief(e.target.value)} onBlur={saveBrief}
              rows={7} placeholder="Pegá acá las consignas, los guiones de los 9 videos, links de Drive (material / creativos), lo que haga falta…"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y font-mono leading-relaxed" />
          </div>

          {/* Creativos */}
          <CreativosSection a={a} addToast={addToast} />

          {/* Videos aprobados (sobre los subidos) + Aprobar todos */}
          {(() => {
            const subidos = a.archivos?.length || 0;
            const aprob = Math.min(a.videosAprobados || 0, subidos);
            const todo = subidos > 0 && aprob >= subidos;
            return (
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Videos aprobados</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateAssignment(a.id, { videosAprobados: Math.max(0, aprob - 1) })}
                      className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 font-bold leading-none">−</button>
                    <span className="font-mono tabular-nums text-sm w-14 text-center">{aprob}/{subidos}</span>
                    <button onClick={() => updateAssignment(a.id, { videosAprobados: Math.min(subidos, aprob + 1) })}
                      disabled={aprob >= subidos}
                      className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 font-bold leading-none disabled:opacity-40">+</button>
                  </div>
                  {subidos > 0 && (
                    <button
                      onClick={() => { updateAssignment(a.id, { videosAprobados: subidos, estado: 'aprobado' }); addToast?.({ type: 'success', message: `Aprobado (${subidos}/${subidos}) — listo para publicar` }); }}
                      className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition ${todo && !esCompleto(a.estado) ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'}`}>
                      <CheckCircle2 size={14} /> Aprobar todos
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  El total es la cantidad de videos subidos ({subidos}). "Aprobar todos" marca todo aprobado y pasa la tarjeta a <b>Aprobado</b> (lista para publicar).
                </p>
                {esCompleto(a.estado) && <span className="mt-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={13} /> Cuenta para el pago</span>}
              </div>
            );
          })()}

          {/* Historial de la tarjeta (KPIs de tiempos) */}
          <HistorialTarjeta a={a} />
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={() => setDlg('eliminar')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-600 transition">
            <Trash2 size={14} /> Eliminar tarjeta
          </button>
          <button onClick={() => setDlg('cambios')}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition">
            <AlertTriangle size={14} /> Pedir cambios
          </button>
          <button onClick={() => { saveAll(); onClose(); }} className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">Listo</button>
        </div>

        {/* Diálogos propios de la plataforma */}
        <ConfirmDialog
          open={dlg === 'eliminar'}
          title={`¿Eliminar la tarjeta de ${a.productoNombre}?`}
          message="Se pierde su historial y su lista de videos. Los archivos ya subidos a Drive/AdsLab no se borran."
          confirmLabel="Eliminar tarjeta" tone="danger"
          onConfirm={() => { setDlg(null); removeAssignment(a.id); onClose(); }}
          onClose={() => setDlg(null)}
        />
        <ConfirmDialog
          open={dlg === 'cambios'}
          title="Pedir cambios"
          message="La tarjeta vuelve a «Por hacer» y el creativo ve tu nota bien destacada."
          withInput multiline inputLabel="¿Qué hay que corregir?"
          defaultValue={a.nota || ''}
          placeholder="Ej: el video 3 está oscuro — rehacelo con más luz…"
          confirmLabel="Devolver al creativo" tone="warn"
          onConfirm={(nota) => {
            setDlg(null);
            updateAssignment(a.id, { nota: nota || '', estado: 'porhacer' });
            addToast?.({ type: 'success', message: 'Devuelta al creativo para corregir.' });
          }}
          onClose={() => setDlg(null)}
        />
      </div>
    </div>
  );
}
