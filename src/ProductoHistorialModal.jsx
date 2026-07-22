// Historial de actividad de UN producto — timeline unificado de todo lo
// que se le hizo, con fecha y hora. Responde al pain del user: "pensé que
// este producto se hizo hace poco y al parecer no".
//
// NO agrega infra de logging nueva: agrega y ordena fuentes que YA existen:
//   📦 Creación del producto (producto.createdAt)
//   ➕ Alta de competidores (competidor.createdAt)
//   ▶️ Corridas del pipeline (runHistory: pasos, stats, costo)
//   🔍 Scrapes por competidor (competidor.adsHistory: total/nuevos por corrida)
//   💸 Operaciones con costo (costsStore local + marketing_costs cloud del cron)
//   💡 Ideas generadas (bandeja, agrupadas por día)
//   🎨 Creativos generados (marketing_creativos cloud, agrupados por día)
//
// Todo se mergea en un timeline descendente agrupado por día.

import React, { useEffect, useMemo, useState } from 'react';
import { X, History, Loader2 } from 'lucide-react';
import { logsForProducto } from './costsStore.js';
import { loadIdeas } from './bandejaStore.js';
import { supabase } from './supabase.js';

const RUN_HISTORY_KEY = 'adslab-marketing-run-history-v1';

const FILTROS = [
  { key: 'todo', label: 'Todo' },
  { key: 'pipeline', label: '▶️ Pipeline' },
  { key: 'scrape', label: '🔍 Scrapes' },
  { key: 'ia', label: '🧠 IA' },
  { key: 'contenido', label: '💡 Contenido' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / (24 * 3600 * 1000));
  if (d === 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  const m = Math.floor(d / 30);
  if (m < 12) return `hace ${m} mes${m !== 1 ? 'es' : ''}`;
  return `hace ${Math.floor(m / 12)} año${Math.floor(m / 12) !== 1 ? 's' : ''}`;
}

function fmtHora(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires',
    });
  } catch { return ''; }
}

function dayKeyOf(iso) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso));
  } catch { return '????-??-??'; }
}

function fmtDia(dayKey) {
  try {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    const ayer = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() - 24 * 3600 * 1000));
    if (dayKey === hoy) return 'Hoy';
    if (dayKey === ayer) return 'Ayer';
    return new Date(`${dayKey}T12:00:00`).toLocaleDateString('es-AR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch { return dayKey; }
}

// Construye la lista de eventos desde todas las fuentes locales.
// Cada evento: { ts, icon, titulo, detalle?, tipo, amount? }
function buildEventosLocales(producto) {
  const eventos = [];
  const pid = String(producto?.id || '');

  // 1. Creación del producto.
  if (producto?.createdAt) {
    eventos.push({
      ts: producto.createdAt, icon: '📦', tipo: 'pipeline',
      titulo: 'Producto creado',
      detalle: producto.landingUrl || null,
    });
  }

  // 2. Competidores agregados + sus scrapes históricos.
  for (const c of (producto?.competidores || [])) {
    if (c.createdAt) {
      eventos.push({
        ts: c.createdAt, icon: '➕', tipo: 'scrape',
        titulo: `Competidor agregado: ${c.nombre || c.id}`,
      });
    }
    for (const h of (Array.isArray(c.adsHistory) ? c.adsHistory : [])) {
      if (!h?.ts) continue;
      eventos.push({
        ts: h.ts, icon: '🔍', tipo: 'scrape',
        titulo: `Scrape de ${c.nombre || c.id}`,
        detalle: `${h.total ?? '?'} ads · ${h.newAds ?? 0} nuevos · ${h.winners ?? 0} ganadores`,
      });
    }
  }

  // 3. Corridas del pipeline.
  try {
    const runs = JSON.parse(localStorage.getItem(RUN_HISTORY_KEY) || '[]');
    for (const r of runs) {
      if (String(r.productoId || '') !== pid || !r.startedAt) continue;
      const st = r.stats || {};
      const partes = [];
      if (st.ideasInsertadas > 0) partes.push(`${st.ideasInsertadas} ideas`);
      if (st.winnersAnalyzed > 0) partes.push(`${st.winnersAnalyzed} winners analizados`);
      if (st.competidoresOk != null) partes.push(`${st.competidoresOk}/${st.competidoresCount || '?'} comps`);
      eventos.push({
        ts: r.startedAt, icon: '▶️', tipo: 'pipeline',
        titulo: 'Pipeline corrido',
        detalle: partes.join(' · ') || null,
        amount: r.cost?.total || 0,
      });
    }
  } catch {}

  // 4. Operaciones con costo (local). El descripcion dice exactamente qué
  //    fue ('deep-analyze · Comp · ad', 'crear-creativo-referencial · ...').
  //    Excluimos apify-ingest/inspiracion para no duplicar los scrapes del
  //    punto 2 (misma operación vista desde otra fuente).
  for (const l of logsForProducto(pid)) {
    if (!l.ts) continue;
    if (/^(apify-ingest|inspiracion(?!-global))/i.test(l.descripcion || '')) continue;
    eventos.push({
      ts: l.ts, icon: '🧠', tipo: 'ia',
      titulo: l.descripcion || l.kind || 'Operación',
      amount: l.amount || 0,
    });
  }

  // 5. Ideas generadas — agrupadas por día para no inundar el timeline.
  try {
    const ideas = loadIdeas().filter(i => String(i.productoId || '') === pid && i.createdAt);
    const porDia = new Map();
    for (const i of ideas) {
      const k = dayKeyOf(i.createdAt);
      const prev = porDia.get(k) || { count: 0, ts: i.createdAt };
      porDia.set(k, { count: prev.count + 1, ts: prev.ts > i.createdAt ? prev.ts : i.createdAt });
    }
    for (const [, v] of porDia) {
      eventos.push({
        ts: v.ts, icon: '💡', tipo: 'contenido',
        titulo: `${v.count} idea${v.count !== 1 ? 's' : ''} generada${v.count !== 1 ? 's' : ''} en la Bandeja`,
      });
    }
  } catch {}

  return eventos;
}

export default function ProductoHistorialModal({ producto, onClose }) {
  const [filtro, setFiltro] = useState('todo');
  const [eventosCloud, setEventosCloud] = useState([]);
  const [cargandoCloud, setCargandoCloud] = useState(true);

  // Fuentes cloud: creativos generados + costos del cron.
  useEffect(() => {
    if (!producto?.id || !supabase) { setCargandoCloud(false); return; }
    let cancelled = false;
    const pid = String(producto.id);
    Promise.all([
      supabase.from('marketing_creativos')
        .select('created_at')
        .eq('producto_id', pid)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('marketing_costs')
        .select('created_at, descripcion, amount')
        .eq('producto_id', pid)
        .order('created_at', { ascending: false })
        .limit(500),
    ]).then(([creativosRes, costsRes]) => {
      if (cancelled) return;
      const evs = [];
      // Creativos agrupados por día.
      if (!creativosRes.error && Array.isArray(creativosRes.data)) {
        const porDia = new Map();
        for (const r of creativosRes.data) {
          if (!r.created_at) continue;
          const k = dayKeyOf(r.created_at);
          const prev = porDia.get(k) || { count: 0, ts: r.created_at };
          porDia.set(k, { count: prev.count + 1, ts: prev.ts > r.created_at ? prev.ts : r.created_at });
        }
        for (const [, v] of porDia) {
          evs.push({
            ts: v.ts, icon: '🎨', tipo: 'contenido',
            titulo: `${v.count} creativo${v.count !== 1 ? 's' : ''} generado${v.count !== 1 ? 's' : ''}`,
          });
        }
      }
      // Costos del cron (cuando existió) — cada scrape automático.
      if (!costsRes.error && Array.isArray(costsRes.data)) {
        for (const r of costsRes.data) {
          if (!r.created_at) continue;
          evs.push({
            ts: r.created_at, icon: '🤖', tipo: 'scrape',
            titulo: r.descripcion || 'Operación automática',
            amount: Number(r.amount) || 0,
          });
        }
      }
      setEventosCloud(evs);
      setCargandoCloud(false);
    }).catch(() => { if (!cancelled) setCargandoCloud(false); });
    return () => { cancelled = true; };
  }, [producto?.id]);

  const { grupos, totalEventos } = useMemo(() => {
    const all = [...buildEventosLocales(producto), ...eventosCloud]
      .filter(e => filtro === 'todo' || e.tipo === filtro)
      .sort((a, b) => new Date(b.ts) - new Date(a.ts));
    // Agrupar por día.
    const porDia = [];
    let currentKey = null;
    for (const e of all) {
      const k = dayKeyOf(e.ts);
      if (k !== currentKey) {
        porDia.push({ day: k, items: [] });
        currentKey = k;
      }
      porDia[porDia.length - 1].items.push(e);
    }
    return { grupos: porDia.slice(0, 60), totalEventos: all.length };
  }, [producto, eventosCloud, filtro]);

  if (!producto) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose} role="dialog">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-lg glass-card border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — con la respuesta directa a "¿cuándo se hizo esto?" */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <History size={16} className="text-brand-500" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">Historial de {producto.nombre}</h3>
              {producto.createdAt && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Creado el {new Date(producto.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}
                  {' '}· <span className="font-semibold text-brand-600 dark:text-brand-400">{timeAgo(producto.createdAt)}</span>
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
              <X size={16} />
            </button>
          </div>
          {/* Filtros */}
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {FILTROS.map(f => (
              <button key={f.key} onClick={() => setFiltro(f.key)}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded transition ${
                  filtro === f.key
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}>
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-gray-400 tabular-nums">
              {cargandoCloud ? <Loader2 size={10} className="inline animate-spin" /> : `${totalEventos} eventos`}
            </span>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          {grupos.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-8">
              Sin actividad registrada{filtro !== 'todo' ? ' para este filtro' : ''}.
            </p>
          ) : (
            <div className="space-y-4">
              {grupos.map(g => (
                <div key={g.day}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5 capitalize sticky top-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm py-0.5">
                    {fmtDia(g.day)}
                  </p>
                  <div className="space-y-1 border-l-2 border-gray-200 dark:border-gray-700 pl-3 ml-1">
                    {g.items.map((e, i) => (
                      <div key={`${e.ts}-${i}`} className="flex items-start gap-2 py-0.5">
                        <span className="text-sm leading-tight shrink-0">{e.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-gray-800 dark:text-gray-200 leading-snug truncate" title={e.titulo}>
                            {e.titulo}
                          </p>
                          {e.detalle && (
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{e.detalle}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] text-gray-400 tabular-nums">{fmtHora(e.ts)}</p>
                          {e.amount > 0 && (
                            <p className="text-[10px] font-bold text-brand-600 dark:text-brand-400 tabular-nums">
                              ${e.amount < 0.01 ? e.amount.toFixed(4) : e.amount.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
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
