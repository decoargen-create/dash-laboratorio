import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Sparkles, Loader2 } from 'lucide-react';

// Widget flotante de chatbot que habla con Claude vía /api/chat.
// - `mode`: 'panel' | 'landing' → cambia el tono y el contexto del system prompt.
// - `context`: snapshot de datos para enriquecer las respuestas (en modo panel).
// - Streaming vía SSE: los tokens aparecen en tiempo real sin spinners.
// - Maneja errores de red y falta de API key con mensajes claros.
export default function ChatbotWidget({ mode = 'panel', context = null, accent = 'rose' }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => ([
    {
      role: 'assistant',
      content: mode === 'landing'
        ? '¡Hola! Soy el asistente de Laboratorio Viora. Preguntame sobre tiempos, mínimos o cómo empezar a producir tu marca.'
        : '¡Hola! Soy tu asistente. Preguntame lo que necesites sobre las órdenes, clientes, productos o cómo usar el panel.',
    },
  ]));
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Auto-scroll al final cuando llegan mensajes nuevos
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Focus al input al abrir
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const suggestedPrompts = mode === 'landing'
    ? [
        '¿Cuánto demora un pedido?',
        '¿Cuál es el mínimo de unidades?',
        '¿Qué productos puedo fabricar?',
      ]
    : [
        '¿Cuántas órdenes pendientes tengo?',
        '¿Cuál fue el profit del período?',
        '¿Cómo creo un nuevo cliente?',
      ];

  const send = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;

    setError('');
    const userMsg = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setStreaming(true);

    // Mensaje del asistente vacío que se va llenando con los chunks
    setMessages(m => [...m, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          mode,
          context,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === 'chunk') {
              assistantContent += parsed.text;
              setMessages(m => {
                const copy = [...m];
                copy[copy.length - 1] = { role: 'assistant', content: assistantContent };
                return copy;
              });
            } else if (parsed.type === 'error') {
              throw new Error(parsed.error);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'No pude conectar con el asistente.');
        // Sacamos el mensaje del asistente vacío
        setMessages(m => m.filter((_, i) => !(i === m.length - 1 && m[i].role === 'assistant' && !m[i].content)));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const buttonGradient = accent === 'rose'
    ? 'from-pink-600 to-rose-500'
    : 'from-amber-500 to-amber-700';

  return (
    <>
      {/* Botón flotante (siempre visible) */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`fixed bottom-6 right-6 z-[90] group w-14 h-14 rounded-full bg-gradient-to-br ${buttonGradient} text-white shadow-2xl hover:shadow-pink-500/50 hover:scale-110 transition-all duration-300 flex items-center justify-center`}
        aria-label={open ? 'Cerrar chat' : 'Abrir chat'}
        title="Asistente Viora"
      >
        <span className={`absolute inset-0 rounded-full bg-gradient-to-br ${buttonGradient} opacity-75 animate-pulse-ring`} aria-hidden="true" />
        <span className="relative">
          {open ? <X size={22} /> : <MessageSquare size={22} />}
        </span>
      </button>

      {/* Panel del chat */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-[90] w-[min(calc(100vw-3rem),420px)] h-[min(calc(100vh-8rem),640px)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden animate-scale-in"
          style={{ transformOrigin: 'bottom right' }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-pink-50 to-rose-50 dark:from-gray-800 dark:to-gray-900 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 flex items-center justify-center shrink-0 shadow">
              <Sparkles size={16} className="text-[#4a0f22]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Asistente Viora</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                En línea · powered by Claude
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>

          {/* Mensajes */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((m, i) => (
              <MessageBubble key={i} role={m.role} content={m.content} streaming={streaming && i === messages.length - 1 && m.role === 'assistant'} />
            ))}
            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
                {error}
              </div>
            )}
          </div>

          {/* Sugerencias cuando no hay nada escrito */}
          {messages.length <= 1 && !streaming && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {suggestedPrompts.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="px-2.5 py-1 text-[11px] rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-pink-400 dark:hover:border-pink-500 hover:text-pink-700 dark:hover:text-pink-300 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-gray-100 dark:border-gray-800">
            <div className="relative flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Escribí tu pregunta…"
                rows={1}
                className="flex-1 resize-none px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 max-h-32"
                disabled={streaming}
              />
              {streaming ? (
                <button
                  onClick={stop}
                  className="shrink-0 p-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                  title="Detener respuesta"
                >
                  <Loader2 size={16} className="animate-spin" />
                </button>
              ) : (
                <button
                  onClick={() => send()}
                  disabled={!input.trim()}
                  className={`shrink-0 p-2 rounded-xl bg-gradient-to-br ${buttonGradient} text-white shadow hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95`}
                  title="Enviar (Enter)"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">Enter para enviar · Shift+Enter para nueva línea</p>
          </div>
        </div>
      )}
    </>
  );
}

function MessageBubble({ role, content, streaming }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? 'bg-gradient-to-br from-pink-600 to-rose-500 text-white rounded-br-sm shadow-md'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
        }`}
      >
        {content || (streaming && <TypingDots />)}
        {streaming && content && <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-current align-middle animate-pulse" />}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '120ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '240ms' }} />
    </span>
  );
}
