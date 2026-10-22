// Área creativa → Equipo creativo: el lugar único para manejar a los editores.
//
//   Resumen  — lo que era el Inicio de AdsLab (primeros pasos, pulso de hoy,
//              publicables y pagos del mes).
//   Tablero  — el tablero estilo Trello de Producción (asignar y mover).
//   Editores — qué tiene cada editor: por hacer, en revisión, aprobado,
//              publicado, y lo que se le debe del mes.
//   Pagos    — publicación y pagos del mes por persona.
//
// Producción sigue existiendo como sección (links viejos y avisos de Discord
// apuntan ahí): abre esta misma pantalla en la pestaña Tablero.

import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Columns3, Users, Wallet, Film, ChevronRight } from 'lucide-react';
import HomeOS from './HomeOS.jsx';
import ProduccionSection, { CardDetailModal } from './ProduccionSection.jsx';
import CreativaDashboard from './CreativaDashboard.jsx';
import { listAllAssignments, subscribeProduccion, monthKeyOf, monthLabel, monthlySummary, weekLabel } from './produccionStore.js';
import { columnaEfectiva } from './produccionCalc.js';
import { fmtMoney, toUSD, subscribeMoney } from './moneyStore.js';

const TAB_KEY = 'adslab-equipo-creativo-tab';
const TABS = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'tablero', label: 'Tablero', icon: Columns3 },
  { id: 'editores', label: 'Editores', icon: Users },
  { id: 'pagos', label: 'Pagos', icon: Wallet },
];

const COLS = [
  { id: 'porhacer', label: 'Por hacer', cls: 'text-gray-300 bg-gray-700/50' },
  { id: 'revision', label: 'En revisión', cls: 'text-amber-300 bg-amber-500/15' },
  { id: 'aprobado', label: 'Aprobado', cls: 'text-emerald-300 bg-emerald-500/15' },
  { id: 'publicado', label: 'Publicado', cls: 'text-brand-300 bg-brand-500/15' },
];

const AV = ['from-brand-500 to-brand-700', 'from-emerald-400 to-emerald-600', 'from-sky-400 to-sky-600', 'from-amber-400 to-amber-600', 'from-rose-400 to-rose-600', 'from-teal-400 to-teal-600'];
function avColor(name) {
  let h = 0; const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
}

function Editores({ addToast }) {
  const [, force] = useState(0);
  const [detailId, setDetailId] = useState(null);
  useEffect(() => {
    const un1 = subscribeProduccion(() => force(x => x + 1));
    const un2 = subscribeMoney(() => force(x => x + 1));
    return () => { un1?.(); un2?.(); };
  }, []);

  const mes = monthKeyOf();
  const pagos = new Map(monthlySummary(mes).personas.map(p => [p.persona, p]));

  const nowMs = Date.now();
  const todas = listAllAssignments();
  // Se recalcula en cada render: subscribeProduccion fuerza el render cuando
  // cambia cualquier tarjeta (estado, persona, archivos).
  const editores = (() => {
    const by = new Map();
    for (const a of todas) {
      const col = columnaEfectiva(a, nowMs);
      if (col === 'archivado') continue;
      const persona = (a.persona || '').trim() || 'Sin asignar';
      if (!by.has(persona)) by.set(persona, { persona, cuenta: { porhacer: 0, revision: 0, aprobado: 0, publicado: 0 }, activas: [], videos: 0 });
      const e = by.get(persona);
      if (e.cuenta[col] != null) e.cuenta[col]++;
      e.videos += (a.archivos || []).length;
      if (col === 'porhacer' || col === 'revision') e.activas.push({ ...a, col });
    }
    return [...by.values()]
      .map(e => ({ ...e, activas: e.activas.sort((x, y) => (x.col === y.col ? 0 : x.col === 'revision' ? -1 : 1)) }))
      .sort((x, y) => (x.persona === 'Sin asignar') - (y.persona === 'Sin asignar') || (y.cuenta.porhacer + y.cuenta.revision) - (x.cuenta.porhacer + x.cuenta.revision));
  })();

  const detail = todas.find(a => a.id === detailId) || null;
  const pago = (ars) => fmtMoney(toUSD(ars, 'ARS'));

  if (editores.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-700 p-10 text-center text-gray-400">
        <Users size={30} className="mx-auto mb-3 opacity-60" />
        <p className="font-semibold text-gray-200">Todavía no hay tarjetas asignadas.</p>
        <p className="text-sm mt-1">Asigná trabajo desde la pestaña <b>Tablero</b> y acá ves qué tiene cada editor.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {editores.map(e => {
          const p = pagos.get(e.persona);
          const carga = e.cuenta.porhacer + e.cuenta.revision;
          return (
            <section key={e.persona} className="rounded-2xl border border-[rgba(160,160,220,0.1)] p-4 flex flex-col gap-3"
              style={{ background: 'linear-gradient(180deg, #171726, #12121c)' }}>
              <header className="flex items-center gap-3">
                <span className={`w-10 h-10 rounded-full grid place-items-center text-white font-extrabold bg-gradient-to-br ${avColor(e.persona)}`}>
                  {e.persona.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-gray-100 truncate">{e.persona}</h3>
                  <p className="text-[12px] text-gray-400">{carga} tarjeta{carga === 1 ? '' : 's'} en curso · {e.videos} video{e.videos === 1 ? '' : 's'} subido{e.videos === 1 ? '' : 's'}</p>
                </div>
              </header>

              <div className="grid grid-cols-4 gap-1.5">
                {COLS.map(c => (
                  <div key={c.id} className={`rounded-lg px-2 py-1.5 text-center ${c.cls}`}>
                    <div className="text-[17px] font-bold tabular-nums">{e.cuenta[c.id]}</div>
                    <div className="text-[10px] font-semibold leading-tight">{c.label}</div>
                  </div>
                ))}
              </div>

              {e.activas.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {e.activas.slice(0, 5).map(a => (
                    <li key={a.id}>
                      <button onClick={() => setDetailId(a.id)}
                        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[#1a1a2a] transition">
                        <Film size={14} className="text-gray-500 shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-[13px] text-gray-200">{a.productoNombre || 'Sin producto'}</span>
                        <span className="text-[11px] text-gray-500 shrink-0">{a.weekKey ? weekLabel(a.weekKey) : ''}</span>
                        <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0 ${a.col === 'revision' ? 'text-amber-300 bg-amber-500/15' : 'text-gray-300 bg-gray-700/50'}`}>
                          {a.col === 'revision' ? 'Revisión' : 'Por hacer'}
                        </span>
                        <ChevronRight size={13} className="text-gray-600 shrink-0" />
                      </button>
                    </li>
                  ))}
                  {e.activas.length > 5 && <li className="text-[12px] text-gray-500 px-2.5">y {e.activas.length - 5} más en el Tablero</li>}
                </ul>
              )}

              {p && (
                <div className="mt-auto flex items-center justify-between rounded-lg bg-[#10101b] border border-[rgba(160,160,220,0.08)] px-3 py-2 text-[12.5px]">
                  <span className="text-gray-400">{monthLabel(mes)}</span>
                  <span className="tabular-nums text-gray-200">
                    {pago(p.total)}
                    {p.pendiente > 0
                      ? <span className="ml-2 text-amber-300">· debés {pago(p.pendiente)}</span>
                      : <span className="ml-2 text-emerald-300">· pagado</span>}
                  </span>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {detail && <CardDetailModal a={detail} onClose={() => setDetailId(null)} addToast={addToast} />}
    </>
  );
}

export default function EquipoCreativo({ addToast, onNavigate, nombre, tabInicial }) {
  const [tab, setTab] = useState(() => {
    if (tabInicial) return tabInicial;
    try { const t = localStorage.getItem(TAB_KEY); return TABS.some(x => x.id === t) ? t : 'resumen'; } catch { return 'resumen'; }
  });
  useEffect(() => { if (tabInicial) setTab(tabInicial); }, [tabInicial]);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* sin storage */ } }, [tab]);

  return (
    <div>
      <div className="px-4 md:px-8 pt-4 md:pt-6">
        <div className="flex gap-6 border-b border-[rgba(160,160,220,0.1)] overflow-x-auto">
          {TABS.map(t => {
            const Icono = t.icon;
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 py-3 text-[14px] font-semibold border-b-2 -mb-px whitespace-nowrap transition ${on
                  ? 'text-gray-100 border-brand-500'
                  : 'text-gray-400 border-transparent hover:text-gray-200'}`}>
                <Icono size={16} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {tab === 'resumen' && <HomeOS nombre={nombre} onNavigate={onNavigate} addToast={addToast} />}
      {tab === 'tablero' && <ProduccionSection addToast={addToast} />}
      {tab === 'editores' && <div className="p-4 md:p-8"><Editores addToast={addToast} /></div>}
      {tab === 'pagos' && <div className="p-4 md:p-8"><CreativaDashboard addToast={addToast} /></div>}
    </div>
  );
}
