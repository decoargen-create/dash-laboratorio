import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Sparkles, Loader2, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';

// Widget flotante de chatbot que habla con Claude vía /api/chat.
// - `mode`: 'panel' | 'landing' → cambia el tono y el contexto del system prompt.
// - `context`: snapshot de datos para enriquecer las respuestas (en modo panel).
// - `onExecuteTool`: opcional. Si se pasa, habilita tool-use: cuando Claude
//    responde con un pedido de tool, el widget ejecuta la función con (name, input)
//    y reenvía el resultado al backend para que Claude continúe la conversación.
// - Streaming vía SSE: los tokens aparecen en tiempo real sin spinners.
// - Maneja errores de red y falta de API key con mensajes claros.
export default function ChatbotWidget({ mode = 'panel', context = null, accent = 'rose', onExecuteTool = null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => ([
    {
      role: 'assistant',
      content: mode === 'landing'
        ? '¡Hola! Soy el asistente de Laboratorio Viora. Preguntame sobre tiempos, mínimos o cómo empezar a producir tu marca.'
        : onExecuteTool
          ? '¡Hola! Además de contestar preguntas sobre tus datos, puedo ejecutar acciones: crear clientes, productos, órdenes, cambiar estados, registrar cobros o marcar incidencias. Pedímelo con naturalidad.'
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
    : onExecuteTool
      ? [
          '¿Cuántas órdenes pendientes tengo?',
          'Creá una orden de 100 unidades de Crema Hidratante para Martina',
          'Marcá la orden #5 como despachada',
        ]
      : [
          '¿Cuántas órdenes pendientes tengo?',
          '¿Cuál fue el profit del período?',
          '¿Cómo creo un nuevo cliente?',
        ];

  // Hace una request al backend con el array de messages actual. Stremea
  // texto y al final, si vino un tool_use_request, ejecuta las tools y
  // se llama a sí misma recursivamente con los tool_result adjuntos.
  // Limite de profundidad = 5 para cortar loops accidentales.
  const callBackend = async (currentMessages, depth = 0) => {
    if (depth > 5) {
      setError('El asistente entró en un loop de tools, corté la conversación.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Empujamos un mensaje vacío del asistente que se va llenando con chunks.
    // Si después llega tool_use, ese mensaje va a contener también blocks de tool_use.
    let assistantIdx = -1;
    setMessages(m => {
      const copy = [...m, { role: 'assistant', content: '' }];
      assistantIdx = copy.length - 1;
      return copy;
    });

    let assistantText = '';
    let toolUseRequest = null; // { assistantContent, toolUses }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
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
              assistantText += parsed.text;
              setMessages(m => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') {
                  copy[copy.length - 1] = { ...last, content: assistantText };
                }
                return copy;
              });
            } else if (parsed.type === 'tool_use_request') {
              // Guardamos para procesar después de cerrar el stream.
              toolUseRequest = parsed;
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
        // Sacamos el mensaje del asistente vacío si no hubo texto
        setMessages(m => {
          if (!assistantText && m.length > 0 && m[m.length - 1].role === 'assistant' && !m[m.length - 1].content) {
            return m.slice(0, -1);
          }
          return m;
        });
      }
      setStreaming(false);
      abortRef.current = null;
      return;
    }

    // Si hay tool_use pendientes y tenemos ejecutor → procesamos y seguimos.
    if (toolUseRequest && typeof onExecuteTool === 'function' && Array.isArray(toolUseRequest.toolUses) && toolUseRequest.toolUses.length > 0) {
      // Reemplazamos el mensaje vacío del asistente por uno con tool_use blocks
      // + texto previo (que viene en assistantContent).
      const assistantFullContent = toolUseRequest.assistantContent;

      // Ejecutamos cada tool y juntamos los resultados.
      const toolResults = [];
      const executed = [];
      for (const t of toolUseRequest.toolUses) {
        let result;
        try {
          result = onExecuteTool(t.name, t.input);
        } catch (err) {
          result = { ok: false, error: err?.message || 'Error al ejecutar' };
        }
        executed.push({ id: t.id, name: t.name, input: t.input, result });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: JSON.stringify(result ?? { ok: false, error: 'Sin resultado' }),
          is_error: result && result.ok === false,
        });
      }

      // Construimos los dos mensajes que tienen que ir en la próxima request:
      // 1) assistant con el content completo (texto + tool_use blocks)
      // 2) user con los tool_result blocks
      const assistantMsg = {
        role: 'assistant',
        content: assistantFullContent,
        // Metadata de UI para rendering (no se manda al backend)
        _toolUses: executed,
      };
      const userToolMsg = {
        role: 'user',
        content: toolResults,
        _toolResults: executed,
      };

      // Pisamos el mensaje asistente vacío por el que tiene tool_use, y
      // agregamos el user con los tool_result. Computamos nextMessages de
      // forma determinística a partir de `currentMessages` (lo que le pasamos
      // al backend en esta iteración) para no depender de timings de setState.
      const nextMessages = [...currentMessages, assistantMsg, userToolMsg];
      setMessages(nextMessages);

      await callBackend(nextMessages, depth + 1);
      return;
    }

    // Sin tool_use → terminó la conversación, dejamos el texto final.
    setStreaming(false);
    abortRef.current = null;
  };

  const send = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;

    setError('');
    const userMsg = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setStreaming(true);

    await callBackend(nextMessages, 0);
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
                En línea · powered by Claude{onExecuteTool ? ' · con acciones' : ''}
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
              <MessageBubble
                key={i}
                message={m}
                streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
              />
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

// Extrae el texto visible de un mensaje cuyo content puede ser string o array
// de blocks (text, tool_use, tool_result). Ignora tool_use/tool_result:
// esos se renderizan aparte como tarjetas.
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function MessageBubble({ message, streaming }) {
  const { role, _toolUses, _toolResults } = message;
  const text = extractText(message.content);
  const isUser = role === 'user';

  // Mensaje de user que sólo contiene tool_result (no lo mostramos como bubble
  // porque ya lo vamos a mostrar como tarjeta debajo del assistant).
  const isOnlyToolResult = isUser && Array.isArray(message.content) && message.content.every(b => b.type === 'tool_result');
  if (isOnlyToolResult) return null;

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-1.5 animate-fade-in-up`}>
      {(text || streaming) && (
        <div
          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
            isUser
              ? 'bg-gradient-to-br from-pink-600 to-rose-500 text-white rounded-br-sm shadow-md'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
          }`}
        >
          {text || (streaming && <TypingDots />)}
          {streaming && text && <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-current align-middle animate-pulse" />}
        </div>
      )}
      {/* Tarjetas con tools ejecutadas (si el assistant llamó tools) */}
      {Array.isArray(_toolUses) && _toolUses.length > 0 && (
        <div className="max-w-[95%] space-y-1.5">
          {_toolUses.map(t => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCard({ tool }) {
  const ok = tool.result?.ok !== false;
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  const colorClass = ok
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-200'
    : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200';

  const summary = ok
    ? summarizeToolResult(tool.name, tool.input, tool.result)
    : (tool.result?.error || 'Error al ejecutar');

  return (
    <div className={`rounded-xl border px-2.5 py-1.5 text-[11px] flex items-start gap-2 ${colorClass}`}>
      <Zap size={12} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 font-semibold">
          <Icon size={11} />
          <span>{tool.name}</span>
        </div>
        <div className="opacity-80 break-words">{summary}</div>
      </div>
    </div>
  );
}

// Resume para el usuario lo que hizo cada tool. No pretende ser exhaustivo,
// apunta a ser legible en una línea.
function summarizeToolResult(name, input, result) {
  switch (name) {
    case 'crear_cliente':
      return `Cliente creado: ${result?.cliente?.nombre || input?.nombre} (#${result?.cliente?.id ?? '?'})`;
    case 'crear_producto':
      return `Producto creado: ${result?.producto?.nombre || input?.nombre} ($${result?.producto?.precioVenta ?? '?'})`;
    case 'crear_orden':
      return `Orden #${result?.orden?.id ?? '?'}: ${result?.orden?.cantidad ?? input?.cantidad}u de ${result?.orden?.producto || ''} para ${result?.orden?.cliente || ''}`;
    case 'cambiar_estado_orden':
      return `Orden #${input?.orderId} → ${input?.estado}`;
    case 'marcar_incidencia':
      return input?.tieneIncidencia
        ? `Incidencia marcada en #${input?.orderId}${input?.incidenciaDetalle ? `: ${input.incidenciaDetalle}` : ''}`
        : `Incidencia resuelta en #${input?.orderId}`;
    case 'registrar_cobro':
      return `Cobro ${input?.rubro} en #${input?.orderId} → ${input?.estado}${input?.monto != null ? ` ($${input.monto})` : ''}`;
    default:
      return JSON.stringify(input);
  }
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
