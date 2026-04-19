// Módulo de Costos del Stack (Marketing → Gastos).
// Dashboard interno para monitorear los servicios/APIs que consume el
// sistema + su costo fijo/variable mensual. Todo persiste en localStorage.
//
// Tipo de gasto:
//   - fijo: costo mensual constante (ej: Vercel Pro $20)
//   - variable: costo variable según uso (ej: Apify, Whisper)
//   - trial: gratis o en prueba (no cuenta en el total)

import React, { useState, useEffect } from 'react';
import {
  DollarSign, Plus, Trash2, Edit2, Check, X, ExternalLink,
  Server, Bot, Target, Zap, Package, AlertTriangle,
} from 'lucide-react';

const STORAGE_KEY = 'viora-stack-costs-v1';
const USD_ARS = 1500; // tipo de cambio aproximado para mostrar conversión

// Servicios precargados la primera vez que entrás.
const SEED_SERVICES = [
  {
    id: 1, nombre: 'Vercel', categoria: 'hosting', tipo: 'fijo',
    montoFijo: 20, url: 'https://vercel.com/account/billing',
    notas: 'Plan Pro. Incluye serverless functions con maxDuration 300s.',
  },
  {
    id: 2, nombre: 'Anthropic Claude', categoria: 'ia', tipo: 'variable',
    estimadoMensual: 30, url: 'https://console.anthropic.com/settings/usage',
    notas: 'Research docs, análisis de creativos, agentes. Con prompt caching activo.',
  },
  {
    id: 3, nombre: 'OpenAI Whisper', categoria: 'ia', tipo: 'variable',
    estimadoMensual: 10, url: 'https://platform.openai.com/usage',
    notas: '$0.006/min de transcripción. Para videos de competencia.',
  },
  {
    id: 4, nombre: 'Apify (Ad Library scraping)', categoria: 'scraping', tipo: 'variable',
    estimadoMensual: 25, url: 'https://console.apify.com/billing',
    notas: '$5.80/1000 ads en plan free. Escalar a Starter ($49/mo) si superás 4k ads/mes.',
  },
  {
    id: 5, nombre: 'Meta Ads (publicidad)', categoria: 'ads', tipo: 'variable',
    estimadoMensual: 0, url: 'https://adsmanager.facebook.com',
    notas: 'Tu inversión en paid ads. Actualizá con el spend real del mes.',
  },
];

const CATEGORIAS = {
  hosting: { label: 'Hosting', icon: Server, color: 'text-slate-600 bg-slate-100 dark:bg-slate-900/40 dark:text-slate-300' },
  ia:      { label: 'IA / APIs', icon: Bot, color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/40 dark:text-purple-300' },
  scraping:{ label: 'Scraping', icon: Target, color: 'text-orange-600 bg-orange-100 dark:bg-orange-900/40 dark:text-orange-300' },
  ads:     { label: 'Publicidad', icon: Zap, color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300' },
  otros:   { label: 'Otros', icon: Package, color: 'text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-300' },
};

const TIPOS = {
  fijo:     { label: 'Fijo', color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
  variable: { label: 'Variable', color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  trial:    { label: 'Trial', color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' },
};

function loadServices() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED_SERVICES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : SEED_SERVICES;
  } catch { return SEED_SERVICES; }
}

function saveServices(services) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(services)); } catch {}
}

// Devuelve el costo mensual efectivo de un servicio (USD).
// - fijo: montoFijo
// - variable: gastoVariable del mes si se cargó real (>0), sino estimadoMensual
// - trial: 0
function costoMensual(svc) {
  if (svc.tipo === 'trial') return 0;
  if (svc.tipo === 'fijo') return Number(svc.montoFijo || 0);
  const gv = Number(svc.gastoVariable || 0);
  if (gv > 0) return gv;
  return Number(svc.estimadoMensual || 0);
}

export default function GastosStackSection({ addToast }) {
  const [services, setServices] = useState(() => loadServices());
  const [editing, setEditing] = useState(null); // id del servicio en edición
  const [draft, setDraft] = useState({});
  const [showNew, setShowNew] = useState(false);

  useEffect(() => { saveServices(services); }, [services]);

  // Totales
  const totalFijo = services.filter(s => s.tipo === 'fijo').reduce((sum, s) => sum + costoMensual(s), 0);
  const totalVariable = services.filter(s => s.tipo === 'variable').reduce((sum, s) => sum + costoMensual(s), 0);
  const totalMensual = totalFijo + totalVariable;
  const totalAnual = totalMensual * 12;

  // Por categoría (para el resumen)
  const porCategoria = services.reduce((acc, s) => {
    const c = s.categoria || 'otros';
    if (!acc[c]) acc[c] = 0;
    acc[c] += costoMensual(s);
    return acc;
  }, {});

  const startEdit = (svc) => {
    setEditing(svc.id);
    setDraft({ ...svc });
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft({});
  };

  const saveEdit = () => {
    if (!draft.nombre?.trim()) { addToast?.({ type: 'error', message: 'El nombre es obligatorio' }); return; }
    setServices(prev => prev.map(s => s.id === editing ? { ...s, ...draft, updatedAt: new Date().toISOString() } : s));
    cancelEdit();
    addToast?.({ type: 'success', message: 'Servicio actualizado' });
  };

  const handleDelete = (id) => {
    const svc = services.find(s => s.id === id);
    if (!window.confirm(`¿Borrar "${svc?.nombre}"?`)) return;
    setServices(prev => prev.filter(s => s.id !== id));
  };

  const handleAdd = () => {
    if (!draft.nombre?.trim()) { addToast?.({ type: 'error', message: 'El nombre es obligatorio' }); return; }
    const nuevo = {
      id: Date.now(),
      nombre: draft.nombre.trim(),
      categoria: draft.categoria || 'otros',
      tipo: draft.tipo || 'variable',
      montoFijo: Number(draft.montoFijo || 0),
      estimadoMensual: Number(draft.estimadoMensual || 0),
      gastoVariable: Number(draft.gastoVariable || 0),
      url: draft.url || '',
      notas: draft.notas || '',
      createdAt: new Date().toISOString(),
    };
    setServices(prev => [...prev, nuevo]);
    setShowNew(false);
    setDraft({});
    addToast?.({ type: 'success', message: `"${nuevo.nombre}" agregado` });
  };

  const fmtUSD = (n) => `$${(Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtARS = (n) => `~$${Math.round((n || 0) * USD_ARS).toLocaleString('es-AR')} ARS`;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-sm">
            <DollarSign size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Gastos del stack</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Servicios + APIs + suscripciones de la plataforma. Costos en USD.</p>
          </div>
        </div>
        <button
          onClick={() => { setShowNew(!showNew); setDraft({}); }}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg hover:from-emerald-600 hover:to-teal-600 shadow-sm transition"
        >
          <Plus size={16} /> Agregar servicio
        </button>
      </div>

      {/* Resumen de totales */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <ResumenCard label="Fijo mensual" value={fmtUSD(totalFijo)} sub={fmtARS(totalFijo)} color="emerald" />
        <ResumenCard label="Variable mensual" value={fmtUSD(totalVariable)} sub={fmtARS(totalVariable)} color="amber" />
        <ResumenCard label="Total mensual" value={fmtUSD(totalMensual)} sub={fmtARS(totalMensual)} color="purple" bold />
        <ResumenCard label="Total anual" value={fmtUSD(totalAnual)} sub={fmtARS(totalAnual)} color="gray" />
      </div>

      {/* Por categoría */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <h3 className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-3">Desglose por categoría</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {Object.entries(CATEGORIAS).map(([key, cat]) => {
            const Icon = cat.icon;
            const total = porCategoria[key] || 0;
            const pct = totalMensual > 0 ? Math.round((total / totalMensual) * 100) : 0;
            return (
              <div key={key} className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={12} className="text-gray-500" />
                  <span className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">{cat.label}</span>
                </div>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtUSD(total)}</p>
                <p className="text-[10px] text-gray-400">{pct}% del total</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Form de nuevo */}
      {showNew && (
        <div className="bg-white dark:bg-gray-800 border-2 border-emerald-300 dark:border-emerald-700 rounded-xl p-4 animate-fade-in">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">Nuevo servicio</h3>
          <ServiceFields draft={draft} setDraft={setDraft} />
          <div className="flex gap-2 justify-end mt-3">
            <button onClick={() => { setShowNew(false); setDraft({}); }}
              className="px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button onClick={handleAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg hover:from-emerald-600 hover:to-teal-600 transition">
              <Plus size={14} /> Agregar
            </button>
          </div>
        </div>
      )}

      {/* Lista de servicios */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/30 border-b border-gray-200 dark:border-gray-700">
            <tr className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <th className="text-left px-3 py-2 font-bold">Servicio</th>
              <th className="text-left px-3 py-2 font-bold">Categoría</th>
              <th className="text-left px-3 py-2 font-bold">Tipo</th>
              <th className="text-right px-3 py-2 font-bold">Costo mensual</th>
              <th className="text-right px-3 py-2 font-bold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {services.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-gray-500 italic">Sin servicios cargados. Agregá el primero.</td></tr>
            )}
            {services.map(svc => {
              const cat = CATEGORIAS[svc.categoria] || CATEGORIAS.otros;
              const tipo = TIPOS[svc.tipo] || TIPOS.variable;
              const Icon = cat.icon;
              const isEditing = editing === svc.id;
              const costo = costoMensual(svc);

              if (isEditing) {
                return (
                  <tr key={svc.id} className="bg-emerald-50/30 dark:bg-emerald-900/10">
                    <td colSpan={5} className="px-3 py-3">
                      <ServiceFields draft={draft} setDraft={setDraft} />
                      <div className="flex gap-2 justify-end mt-3">
                        <button onClick={cancelEdit}
                          className="px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 transition">
                          <X size={12} className="inline -mt-0.5" /> Cancelar
                        </button>
                        <button onClick={saveEdit}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 transition">
                          <Check size={12} /> Guardar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={svc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${cat.color}`}>
                        <Icon size={13} />
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 dark:text-gray-100">{svc.nombre}</p>
                        {svc.notas && <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[350px]">{svc.notas}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded ${cat.color}`}>
                      {cat.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded ${tipo.color}`}>
                      {tipo.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtUSD(costo)}</p>
                    <p className="text-[10px] text-gray-400 tabular-nums">{fmtARS(costo)}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      {svc.url && (
                        <a href={svc.url} target="_blank" rel="noreferrer" className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Abrir dashboard del servicio">
                          <ExternalLink size={12} />
                        </a>
                      )}
                      <button onClick={() => startEdit(svc)} className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Editar">
                        <Edit2 size={12} />
                      </button>
                      <button onClick={() => handleDelete(svc.id)} className="p-1.5 text-gray-400 hover:text-red-600 transition" title="Eliminar">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tip */}
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-2">
        <AlertTriangle size={14} className="text-blue-600 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-900 dark:text-blue-200">
          <strong>Tip:</strong> actualizá el "gasto variable" de cada servicio al final del mes con el consumo real. Los enlaces ⤴ te llevan directo al dashboard de billing de cada plataforma.
        </p>
      </div>
    </div>
  );
}

// Campos compartidos entre form de nuevo + edit inline.
function ServiceFields({ draft, setDraft }) {
  const u = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Nombre</label>
        <input type="text" value={draft.nombre || ''} onChange={e => u('nombre', e.target.value)}
          placeholder="Ej: Anthropic Claude"
          className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Categoría</label>
        <select value={draft.categoria || 'otros'} onChange={e => u('categoria', e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500">
          {Object.entries(CATEGORIAS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Tipo</label>
        <select value={draft.tipo || 'variable'} onChange={e => u('tipo', e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500">
          {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">URL dashboard (opcional)</label>
        <input type="url" value={draft.url || ''} onChange={e => u('url', e.target.value)}
          placeholder="https://..."
          className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>
      {draft.tipo === 'fijo' ? (
        <div>
          <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Monto fijo mensual (USD)</label>
          <input type="number" step="0.01" min="0" value={draft.montoFijo ?? ''} onChange={e => u('montoFijo', e.target.value)}
            placeholder="20.00"
            className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        </div>
      ) : (
        <>
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Estimado mensual (USD)</label>
            <input type="number" step="0.01" min="0" value={draft.estimadoMensual ?? ''} onChange={e => u('estimadoMensual', e.target.value)}
              placeholder="20.00"
              className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Gasto real del mes (USD)</label>
            <input type="number" step="0.01" min="0" value={draft.gastoVariable ?? ''} onChange={e => u('gastoVariable', e.target.value)}
              placeholder="Si vacío usa el estimado"
              className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase mb-1">Notas</label>
        <input type="text" value={draft.notas || ''} onChange={e => u('notas', e.target.value)}
          placeholder="Plan, límites, observaciones"
          className="w-full px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>
    </div>
  );
}

function ResumenCard({ label, value, sub, color = 'gray', bold = false }) {
  const colors = {
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200',
    amber:   'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200',
    purple:  'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200',
    gray:    'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100',
  };
  return (
    <div className={`p-4 rounded-xl border ${colors[color]} ${bold ? 'ring-2 ring-offset-1 ring-purple-400 dark:ring-offset-gray-900' : ''}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>
    </div>
  );
}
