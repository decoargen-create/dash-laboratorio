// Sidebar persistente con sugerencias proactivas leídas del state local.
// Es un botón flotante bottom-right que al click abre un panel lateral con
// las 3-5 cosas más útiles a hacer AHORA en tu producto activo (o globales).
//
// Filosofía: heurísticas baratas, sin tokens de Claude. Detecta:
//   • Winners marcados sin iterar hace >7d
//   • Ideas chatas (≤2 ánzuelos cargados) en pendiente
//   • Comps con master switch ON sin scrape reciente
//   • Productos sin research / sin foto / sin ofertas
//   • Tu cuenta Meta no conectada al producto activo
//
// El sidebar NO actúa: solo te lleva al lugar correcto del producto.
// Es un "copilot navegacional" — más útil que esperar que Claude haga
// todo, y mucho más barato.

import React, { useEffect, useState } from 'react';
import { Sparkles, X, ArrowRight, ChevronRight } from 'lucide-react';
import { loadIdeas } from './bandejaStore.js';

const IDEA_FIELDS = ['hook', 'painPoint', 'angulo', 'descripcionImagen', 'copy', 'creenciaApalancada', 'variableDeTesteo', 'formato'];

function countAnzuelos(idea) {
  let n = 0;
  for (const f of IDEA_FIELDS) {
    const v = idea?.[f];
    if (typeof v === 'string' ? v.trim().length > 0 : !!v) n++;
  }
  return n;
}

// Lee todo el state local + devuelve la lista de sugerencias priorizadas.
// Cada sugerencia tiene: { id, priority, title, sub, action: { label, section, productoId? } }
function detectSuggestions() {
  const out = [];
  let productos = [];
  try {
    productos = JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]');
  } catch { return []; }
  let allIdeas = [];
  try { allIdeas = loadIdeas(); } catch {}

  for (const p of productos) {
    // 1. Producto sin research → setup incompleto.
    if (!p.docs?.research) {
      out.push({
        id: `no-research-${p.id}`,
        priority: 1,
        title: `${p.nombre || 'Producto'} no tiene research`,
        sub: 'Sin research el generador improvisa. Corré el pipeline para crearlo.',
        action: { label: 'Abrir producto', section: 'mk-arranque', productoId: String(p.id) },
      });
    }
    // 2. Comps con master switch ON sin scrape reciente >7d.
    const compsActivosViejos = (p.competidores || []).filter(c => {
      if (c.smartScrapeEnabled === false) return false;
      const ts = c.lastAdsCheck ? new Date(c.lastAdsCheck).getTime() : 0;
      return ts === 0 || (Date.now() - ts) > 7 * 24 * 3600 * 1000;
    });
    if (compsActivosViejos.length > 0) {
      out.push({
        id: `stale-comps-${p.id}`,
        priority: 2,
        title: `${compsActivosViejos.length} comp${compsActivosViejos.length !== 1 ? 's' : ''} de ${p.nombre} sin scrapear hace >7d`,
        sub: 'El cron diario debería pegarles. Si llevan tiempo así, scrapeá manual.',
        action: { label: 'Ver competencia', section: 'mk-inspiracion', productoId: String(p.id) },
      });
    }
    // 3. Sin cuenta Meta conectada.
    if (!p.metaAccount) {
      out.push({
        id: `no-meta-${p.id}`,
        priority: 3,
        title: `${p.nombre || 'Producto'} sin Meta conectada`,
        sub: 'Conectá Meta para traer las campañas reales del producto.',
        action: { label: 'Configurar Meta', section: 'mk-campanas', productoId: String(p.id) },
      });
    }
  }

  // 4. Ideas chatas (≤2 ánzuelos) en estado pendiente — desperdicio de tokens
  //    si las generás como están.
  const ideasChatasPorProducto = new Map();
  for (const i of allIdeas) {
    if (i.estado !== 'pendiente') continue;
    if (countAnzuelos(i) > 2) continue;
    const pid = String(i.productoId || 'global');
    ideasChatasPorProducto.set(pid, (ideasChatasPorProducto.get(pid) || 0) + 1);
  }
  for (const [pid, count] of ideasChatasPorProducto) {
    if (count < 3) continue;
    const prod = productos.find(p => String(p.id) === pid);
    out.push({
      id: `ideas-chatas-${pid}`,
      priority: 4,
      title: `${count} ideas chatas en ${prod?.nombre || 'la Bandeja'}`,
      sub: '≤2 frentes cargados — generarlas así produce creativos flojos. Editalas o archivalas.',
      action: { label: 'Ir a Bandeja', section: 'mk-bandeja', productoId: pid !== 'global' ? pid : null },
    });
  }

  // Ordenar por priority asc + limit 6.
  return out.sort((a, b) => a.priority - b.priority).slice(0, 6);
}

export default function ClaudeProactivoSidebar({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState(() => detectSuggestions());

  // Re-detect al abrir + cada 2min en background.
  useEffect(() => {
    const id = setInterval(() => setSuggestions(detectSuggestions()), 120000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (open) setSuggestions(detectSuggestions());
  }, [open]);

  // El badge solo se ve si hay sugerencias.
  const hasSuggestions = suggestions.length > 0;

  return (
    <>
      {/* Botón flotante bottom-right (encima del ExecutionsTray, debajo del
          BulkProgress bar). Posición offset right=6 bottom=24 (para no chocar
          con tray bottom-right). */}
      <button
        onClick={() => setOpen(true)}
        className={`fixed bottom-24 right-6 z-40 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-full text-xs font-bold shadow-lg transition-all duration-200 hover:scale-105 ${
          hasSuggestions
            ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white hover:shadow-brand-glow animate-fade-in-up'
            : 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700'
        }`}
        title="Sugerencias del copiloto"
        aria-label="Abrir copiloto"
      >
        <Sparkles size={14} className={hasSuggestions ? 'animate-pulse' : ''} />
        <span className="hidden sm:inline">Copiloto</span>
        {hasSuggestions && (
          <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] rounded-full bg-white/25">
            {suggestions.length}
          </span>
        )}
      </button>

      {/* Panel lateral */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fade-in" />
          <div
            className="relative w-full max-w-sm h-full glass-card border-l border-gray-200 dark:border-gray-700 shadow-2xl animate-slide-in-right flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Sparkles size={16} className="text-brand-500" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex-1">Copiloto</h3>
              <button onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 px-4 pt-3 pb-1">
              {suggestions.length > 0
                ? `${suggestions.length} cosa${suggestions.length !== 1 ? 's' : ''} para revisar:`
                : 'Todo en orden en tu workspace. Bien ahí.'}
            </p>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {suggestions.length === 0 ? (
                <div className="mt-8 text-center">
                  <div className="text-4xl mb-2">✨</div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Sin sugerencias urgentes. Volvé a chequear más tarde.
                  </p>
                </div>
              ) : (
                suggestions.map(s => (
                  <button key={s.id}
                    onClick={() => {
                      onNavigate?.(s.action.section, s.action.productoId);
                      setOpen(false);
                    }}
                    className="w-full text-left p-3 bg-white/60 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-md transition group"
                  >
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        s.priority <= 2 ? 'bg-red-500' : s.priority === 3 ? 'bg-amber-500' : 'bg-brand-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{s.title}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{s.sub}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-1 text-[10px] font-semibold text-brand-600 dark:text-brand-400 group-hover:text-brand-700 dark:group-hover:text-brand-300">
                      {s.action.label} <ChevronRight size={11} className="transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
