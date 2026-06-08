// Tab Copiloto — chat contextual sobre el producto activo.
//
// El copiloto conoce el research, avatar, competencia e ideas del producto
// (se los manda al endpoint /api/marketing/copilot). Sirve para pensar
// hooks, ángulos, estrategia de funnel y pedir feedback sin navegar entre
// pantallas. El historial se persiste por producto en localStorage.

import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { loadIdeas } from './bandejaStore.js';
import { logCostsFromResponse } from './costsStore.js';

const CHAT_KEY_PREFIX = 'viora-marketing-copilot-';
const CHAT_CAP = 40; // mensajes guardados por producto

// Preguntas sugeridas para arrancar la conversación.
const SUGERENCIAS = [
  'Dame 5 hooks nuevos para campaña fría',
  '¿Qué ángulo está saturado en mi competencia?',
  '¿Qué le falta a mi oferta para convertir mejor?',
  'Armame un guión de video de 15s para retargeting',
];

export default function CopilotoTab({ producto, addToast }) {
  const chatKey = producto?.id ? `${CHAT_KEY_PREFIX}${producto.id}` : null;

  const [messages, setMessages] = useState(() => {
    if (!chatKey) return [];
    try {
      const raw = localStorage.getItem(chatKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  // Recargar el historial al cambiar de producto.
  useEffect(() => {
    if (!chatKey) { setMessages([]); return; }
    try {
      const raw = localStorage.getItem(chatKey);
      setMessages(raw ? JSON.parse(raw) : []);
    } catch { setMessages([]); }
  }, [chatKey]);

  // Persistir el historial (cap a los últimos CHAT_CAP mensajes).
  useEffect(() => {
    if (!chatKey) return;
    try { localStorage.setItem(chatKey, JSON.stringify(messages.slice(-CHAT_CAP))); } catch {}
  }, [messages, chatKey]);

  // Auto-scroll al último mensaje.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Arma el contexto del producto que se manda al copiloto.
  const buildContext = () => {
    const docs = producto?.docs || {};
    const comps = producto?.competidores || [];
    const competidoresResumen = comps.length
      ? comps.map(c => `- ${c.nombre}: ${c.adsTotal || c.ads?.length || 0} ads activos, ${c.winnersCount || 0} ganadores`).join('\n')
      : '';
    const ideas = loadIdeas().filter(i => String(i.productoId || '') === String(producto?.id || ''));
    let ideasResumen = '';
    if (ideas.length) {
      const porEstado = ideas.reduce((acc, i) => {
        acc[i.estado || 'pendiente'] = (acc[i.estado || 'pendiente'] || 0) + 1;
        return acc;
      }, {});
      const resumenEstados = Object.entries(porEstado).map(([k, v]) => `${v} ${k}`).join(', ');
      // Detalle de las ideas accionables (pendientes + en uso) — antes el
      // copiloto solo veía un conteo y respondía a ciegas si le pedías
      // opinar sobre un hook/ángulo concreto de la bandeja.
      const accionables = ideas
        .filter(i => !i.estado || i.estado === 'pendiente' || i.estado === 'en_uso')
        .slice(0, 35);
      const detalle = accionables.map((i, idx) => {
        const campos = [`#${idx + 1} [${i.tipo}/${i.formato || '?'}]`];
        if (i.hook) campos.push(`hook: "${String(i.hook).slice(0, 160)}"`);
        if (i.anguloCategoria) campos.push(`ángulo ${i.anguloCategoria}`);
        if (typeof i.scoreValue === 'number') campos.push(`score ${i.scoreValue}/10`);
        if (i.tipoCampaña) campos.push(i.tipoCampaña);
        if (i.origen?.competidorNombre) campos.push(`de ${i.origen.competidorNombre}`);
        return campos.join(' · ');
      }).join('\n');
      ideasResumen = `${ideas.length} ideas en la bandeja (${resumenEstados}).\n\nIdeas accionables (pendientes / en uso) — podés opinar sobre estas:\n${detalle}`;
    }
    return {
      nombre: producto?.nombre,
      descripcion: producto?.descripcion,
      stage: producto?.stage,
      research: docs.research || producto?.research,
      avatar: docs.avatar || producto?.avatar,
      offerBrief: docs.offerBrief || producto?.offerBrief,
      beliefs: docs.beliefs || producto?.beliefs,
      competidoresResumen,
      ideasResumen,
    };
  };

  const enviar = async (texto) => {
    const text = (texto ?? input).trim();
    if (!text || loading) return;
    const conMensaje = [...messages, { role: 'user', content: text }];
    setMessages(conMensaje);
    setInput('');
    setLoading(true);
    try {
      const resp = await fetch('/api/marketing/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conMensaje, productoContext: buildContext() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      logCostsFromResponse(data, `copilot · ${producto?.nombre || ''}`);
      setMessages([...conMensaje, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      addToast?.({ type: 'error', message: `Copiloto: ${err.message}` });
      // Dejamos el mensaje del user en pantalla para que pueda reintentar.
      setMessages(conMensaje);
    } finally {
      setLoading(false);
    }
  };

  const limpiar = () => {
    if (!window.confirm('¿Borrar toda la conversación del copiloto para este producto?')) return;
    setMessages([]);
  };

  const tieneResearch = !!(producto?.docs?.research || producto?.research);

  return (
    <div className="flex flex-col h-[600px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-400 flex items-center justify-center text-white shrink-0">
          <Sparkles size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Copiloto de Marketing</h3>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Conoce el research, la competencia y las ideas de {producto?.nombre || 'este producto'}.
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={limpiar}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition shrink-0"
            title="Borrar conversación">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 dark:from-brand-900/40 dark:to-brand-800/40 flex items-center justify-center">
              <Sparkles size={22} className="text-brand-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Preguntale lo que quieras</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-sm">
                {tieneResearch
                  ? 'El copiloto ya tiene el research y el análisis cargados. Probá con una de estas:'
                  : 'Todavía no corriste el pipeline — el copiloto va a responder con criterio general hasta que haya research.'}
              </p>
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-sm">
              {SUGERENCIAS.map((s, i) => (
                <button key={i} onClick={() => enviar(s)}
                  className="text-left px-3 py-2 text-[11px] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs whitespace-pre-wrap break-words ${
              m.role === 'user'
                ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white rounded-br-sm'
                : 'bg-gray-100 dark:bg-gray-900/50 text-gray-800 dark:text-gray-200 rounded-bl-sm'
            }`}>
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-xl rounded-bl-sm bg-gray-100 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 text-xs inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Pensando…
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
            }}
            placeholder="Escribí tu pregunta… (Enter para enviar, Shift+Enter salto de línea)"
            rows={2}
            disabled={loading}
            className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          />
          <button
            onClick={() => enviar()}
            disabled={loading || !input.trim()}
            className="inline-flex items-center justify-center w-10 h-10 shrink-0 text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-700 hover:to-brand-600 transition disabled:opacity-40"
            title="Enviar"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
