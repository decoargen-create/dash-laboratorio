import React, { useState, useEffect, useMemo, useRef } from 'react';

// =============================================================================
// CONSULTORÍA — Acta de reunión
// -----------------------------------------------------------------------------
// El consultor pega la transcripción cruda de una reunión y la IA devuelve un
// acta accionable (resumen, diagnóstico, tareas, plan de acción) lista para
// reenviarle al cliente, exportable a PDF vía window.print().
//
// La llamada a Claude pasa SÍ o SÍ por /api/acta (server-side): la API key
// nunca viaja al cliente.
//
// Estética editorial / papel de trabajo, deliberadamente distinta del resto
// del panel (Tailwind). Todo el estilo vive scopeado acá adentro vía un
// <style> inyectado una vez, para no pisar el tema global ni el dark mode.
// =============================================================================

// Paleta (papel de trabajo cálido).
const C = {
  cream: '#F6F2E9',
  card: '#FFFDF8',
  border: '#D9D2C2',
  ink: '#1C1B17',
  inkSoft: '#5C574C',
  forest: '#2F4A3A',
  terracota: '#C4533A',
  mostaza: '#B7791F',
  verde: '#3E6B4F',
};

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;600&family=Spline+Sans:wght@400;500;600;700&display=swap';

// CSS scopeado bajo .consultoria-root + reglas de impresión globales.
// La técnica de impresión: ocultamos TODO el body por visibility y sólo
// dejamos visible #acta-print (el documento). Así el sidebar y el header del
// panel desaparecen del PDF sin tener que tocarlos.
const STYLE = `
.consultoria-root {
  --c-cream: ${C.cream}; --c-card: ${C.card}; --c-border: ${C.border};
  --c-ink: ${C.ink}; --c-ink-soft: ${C.inkSoft}; --c-forest: ${C.forest};
  --c-terracota: ${C.terracota}; --c-mostaza: ${C.mostaza}; --c-verde: ${C.verde};
  background: var(--c-cream);
  color: var(--c-ink);
  font-family: 'Spline Sans', system-ui, -apple-system, sans-serif;
  border-radius: 18px;
  border: 1px solid var(--c-border);
  padding: clamp(20px, 4vw, 44px);
  max-width: 920px;
  margin: 0 auto;
  line-height: 1.55;
}
.consultoria-root *, .consultoria-root *::before, .consultoria-root *::after { box-sizing: border-box; }
.cs-serif { font-family: 'Fraunces', Georgia, serif; }
.cs-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.cs-kicker {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--c-forest); font-weight: 600;
}

/* ---- Panel de carga ---- */
.cs-card {
  background: var(--c-card); border: 1px solid var(--c-border);
  border-radius: 16px; padding: clamp(18px, 3vw, 28px);
  box-shadow: 0 1px 2px rgba(28,27,23,.04), 0 8px 24px -16px rgba(28,27,23,.18);
}
.cs-row { display: flex; gap: 16px; }
@media (max-width: 640px) { .cs-row { flex-direction: column; } }
.cs-field { flex: 1; min-width: 0; }
.cs-label {
  display: block; font-size: 12px; font-weight: 600; color: var(--c-ink-soft);
  margin-bottom: 6px; letter-spacing: .01em;
}
.cs-input, .cs-textarea {
  width: 100%; background: #fff; border: 1px solid var(--c-border);
  border-radius: 11px; padding: 11px 13px; font-size: 15px; color: var(--c-ink);
  font-family: inherit; outline: none; transition: border-color .15s, box-shadow .15s;
}
.cs-textarea { resize: vertical; min-height: 220px; line-height: 1.5; }
.cs-input:focus, .cs-textarea:focus {
  border-color: var(--c-forest); box-shadow: 0 0 0 3px rgba(47,74,58,.12);
}
.cs-meta { font-size: 12px; color: var(--c-ink-soft); }

.cs-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
  border-radius: 11px; padding: 11px 20px; border: 1px solid transparent;
  transition: transform .08s, background .15s, opacity .15s; user-select: none;
}
.cs-btn:active { transform: translateY(1px); }
.cs-btn:disabled { opacity: .55; cursor: not-allowed; }
.cs-btn-primary { background: var(--c-forest); color: #fff; }
.cs-btn-primary:hover:not(:disabled) { background: #26402F; }
.cs-btn-ghost { background: transparent; color: var(--c-ink); border-color: var(--c-border); }
.cs-btn-ghost:hover:not(:disabled) { background: rgba(28,27,23,.04); }

.cs-error {
  background: #FBEAE5; border: 1px solid #E8B9AC; color: #8A2D17;
  border-radius: 11px; padding: 12px 14px; font-size: 14px;
}

.cs-spin { animation: cs-spin 0.7s linear infinite; }
@keyframes cs-spin { to { transform: rotate(360deg); } }

.cs-appear { animation: cs-appear .4s cubic-bezier(.22,1,.36,1); }
@keyframes cs-appear { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

/* ---- Documento (acta) ---- */
.cs-doc-head { border-bottom: 2px solid var(--c-ink); padding-bottom: 16px; margin-bottom: 8px; }
.cs-doc-title { font-size: clamp(26px, 4vw, 38px); font-weight: 600; line-height: 1.08; margin: 6px 0 4px; }
.cs-section { margin-top: 30px; }
.cs-section-title {
  font-family: 'Fraunces', Georgia, serif; font-size: 20px; font-weight: 600;
  color: var(--c-forest); margin-bottom: 12px;
}
.cs-chip {
  display: inline-block; background: rgba(47,74,58,.08); color: var(--c-forest);
  border: 1px solid rgba(47,74,58,.18); border-radius: 999px;
  padding: 5px 12px; font-size: 13px; font-weight: 500; margin: 0 6px 6px 0;
}
.cs-diag {
  border-left: 3px solid var(--c-forest); padding: 2px 0 2px 16px; margin-bottom: 16px;
  break-inside: avoid;
}
.cs-diag-title { font-weight: 700; font-size: 15px; }
.cs-diag-detail { color: var(--c-ink-soft); font-size: 14.5px; margin-top: 2px; }

.cs-task {
  display: flex; gap: 12px; align-items: flex-start; padding: 14px 0;
  border-bottom: 1px solid var(--c-border); break-inside: avoid;
}
.cs-task:last-child { border-bottom: none; }
.cs-pill {
  flex-shrink: 0; font-family: 'JetBrains Mono', monospace; font-size: 10.5px;
  font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  padding: 4px 9px; border-radius: 7px; color: #fff; margin-top: 1px;
}
.cs-task-body { flex: 1; min-width: 0; }
.cs-task-text { font-size: 15px; font-weight: 500; }
.cs-task-meta {
  font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--c-ink-soft);
  margin-top: 4px;
}
.cs-step { display: flex; gap: 16px; padding: 12px 0; break-inside: avoid; }
.cs-step-num {
  font-family: 'Fraunces', serif; font-size: 28px; font-weight: 600;
  color: var(--c-terracota); line-height: 1; flex-shrink: 0; width: 44px;
}
.cs-step-title { font-weight: 700; font-size: 15.5px; }
.cs-step-detail { color: var(--c-ink-soft); font-size: 14.5px; margin-top: 2px; }

.cs-notes {
  background: #FBF3D6; border: 1px solid #E8D9A0; border-radius: 12px;
  padding: 16px 18px; box-shadow: 0 6px 16px -12px rgba(120,90,0,.4);
}
.cs-notes li { margin-bottom: 6px; }

@media print {
  body * { visibility: hidden !important; }
  #acta-print, #acta-print * { visibility: visible !important; }
  #acta-print {
    position: absolute; left: 0; top: 0; width: 100%;
    background: #fff !important; border: none !important; box-shadow: none !important;
    border-radius: 0 !important; padding: 0 !important; margin: 0 !important;
  }
  .no-print, .no-print * { display: none !important; visibility: hidden !important; }
  @page { margin: 16mm 14mm; }
  html, body { background: #fff !important; }
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  .cs-diag, .cs-task, .cs-step { break-inside: avoid; }
}
`;

function todayEsAR() {
  try {
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
      .format(new Date());
  } catch {
    return new Date().toLocaleDateString();
  }
}

function prioColor(prioridad) {
  const p = String(prioridad || '').toLowerCase();
  if (p.startsWith('alta')) return C.terracota;
  if (p.startsWith('baja')) return C.verde;
  return C.mostaza; // media / default
}

// Inyecta una sola vez el <link> de Google Fonts y el <style> scopeado.
function useConsultoriaAssets() {
  useEffect(() => {
    if (!document.getElementById('cs-fonts')) {
      const link = document.createElement('link');
      link.id = 'cs-fonts';
      link.rel = 'stylesheet';
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }
    if (!document.getElementById('cs-styles')) {
      const style = document.createElement('style');
      style.id = 'cs-styles';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
  }, []);
}

export default function ConsultoriaSection({ addToast }) {
  useConsultoriaAssets();

  const [client, setClient] = useState('');
  const [date, setDate] = useState(() => todayEsAR());
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(''); // '' | 'full' | 'tareas'
  const resultRef = useRef(null);

  const wordCount = useMemo(
    () => transcript.trim().split(/\s+/).filter(Boolean).length,
    [transcript]
  );

  const notify = (msg, type = 'info') => {
    if (typeof addToast === 'function') addToast({ message: msg, type });
  };

  async function generar() {
    setError('');
    if (wordCount < 20) {
      setError('Pegá una transcripción más completa (al menos ~20 palabras) para armar un acta útil.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/acta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, client, date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
      setResult(data);
      // Scroll suave al resultado.
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (err) {
      setError(err?.message || 'No se pudo generar el acta.');
    } finally {
      setLoading(false);
    }
  }

  // ---- Texto plano para copiar ----
  function actaToText(onlyTasks = false) {
    if (!result) return '';
    const L = [];
    if (!onlyTasks) {
      L.push(`ACTA DE REUNIÓN — ${client || 'Cliente'}`);
      L.push(date || '');
      L.push('');
      if (result.resumen) {
        L.push('RESUMEN');
        L.push(result.resumen);
        L.push('');
      }
      if (result.diagnostico?.length) {
        L.push('LO QUE VIMOS');
        result.diagnostico.forEach(d => L.push(`• ${d.titulo}: ${d.detalle}`));
        L.push('');
      }
    }
    if (result.tareas?.length) {
      L.push('TAREAS Y PENDIENTES');
      result.tareas.forEach((t, i) => {
        L.push(`${i + 1}. [${t.prioridad || 'Media'}] ${t.tarea} — ${t.responsable || 'Cliente'} — ${t.plazo || 'A definir'}`);
      });
      L.push('');
    }
    if (!onlyTasks && result.plan_accion?.length) {
      L.push('PLAN DE ACCIÓN');
      result.plan_accion.forEach((p, i) => {
        L.push(`${String(i + 1).padStart(2, '0')}. ${p.paso} — ${p.detalle}`);
      });
      L.push('');
    }
    return L.join('\n').trim();
  }

  async function copiar(onlyTasks) {
    const text = actaToText(onlyTasks);
    try {
      await navigator.clipboard.writeText(text);
      const kind = onlyTasks ? 'tareas' : 'full';
      setCopied(kind);
      notify('¡Copiado!', 'success');
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setError('No pude copiar al portapapeles.');
    }
  }

  return (
    <div className="consultoria-root">
      {/* ---------- PANEL DE CARGA (no va al PDF) ---------- */}
      <div className="no-print">
        <p className="cs-kicker">mottaecom · consultoría</p>
        <h1 className="cs-serif" style={{ fontSize: 'clamp(24px,4vw,34px)', fontWeight: 600, margin: '6px 0 4px' }}>
          Acta de consultoría
        </h1>
        <p style={{ color: C.inkSoft, fontSize: 15, marginBottom: 22, maxWidth: 600 }}>
          Pegá la transcripción cruda de la reunión y armá un acta accionable, lista para reenviarle al cliente.
        </p>

        <div className="cs-card">
          <div className="cs-row" style={{ marginBottom: 16 }}>
            <div className="cs-field">
              <label className="cs-label" htmlFor="cs-client">Cliente</label>
              <input
                id="cs-client" className="cs-input" type="text"
                placeholder="Nombre del cliente o la marca"
                value={client} onChange={e => setClient(e.target.value)}
              />
            </div>
            <div className="cs-field">
              <label className="cs-label" htmlFor="cs-date">Fecha</label>
              <input
                id="cs-date" className="cs-input" type="text"
                value={date} onChange={e => setDate(e.target.value)}
              />
            </div>
          </div>

          <label className="cs-label" htmlFor="cs-transcript">Transcripción de la reunión</label>
          <textarea
            id="cs-transcript" className="cs-textarea"
            placeholder="Pegá acá la transcripción cruda de la reunión…"
            value={transcript} onChange={e => setTranscript(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
            <span className="cs-meta cs-mono">{wordCount} {wordCount === 1 ? 'palabra' : 'palabras'}</span>
            <button className="cs-btn cs-btn-primary" onClick={generar} disabled={loading}>
              {loading
                ? (<><Spinner /> Armando acta…</>)
                : 'Armar acta'}
            </button>
          </div>

          {error && <div className="cs-error" style={{ marginTop: 14 }}>{error}</div>}
        </div>
      </div>

      {/* ---------- RESULTADO ---------- */}
      {result && (
        <div ref={resultRef} className="cs-appear" style={{ marginTop: 28 }}>
          {/* Barra de acciones — no va al PDF */}
          <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
            <button className="cs-btn cs-btn-primary" onClick={() => window.print()}>
              Descargar PDF
            </button>
            <button className="cs-btn cs-btn-ghost" onClick={() => copiar(false)}>
              {copied === 'full' ? '¡Copiado!' : 'Copiar acta completa'}
            </button>
            <button className="cs-btn cs-btn-ghost" onClick={() => copiar(true)}>
              {copied === 'tareas' ? '¡Copiado!' : 'Copiar solo tareas'}
            </button>
          </div>

          {/* Documento exportable */}
          <div id="acta-print">
            <header className="cs-doc-head">
              <p className="cs-kicker">mottaecom · consultoría</p>
              <h2 className="cs-serif cs-doc-title">Acta de reunión — {client || 'Cliente'}</h2>
              <p className="cs-mono" style={{ fontSize: 13, color: C.inkSoft }}>{date}</p>
            </header>

            {/* Resumen + temas */}
            {(result.resumen || result.temas?.length > 0) && (
              <section className="cs-section">
                <h3 className="cs-section-title">Resumen</h3>
                {result.resumen && <p style={{ fontSize: 15.5 }}>{result.resumen}</p>}
                {result.temas?.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    {result.temas.map((t, i) => <span key={i} className="cs-chip">{t}</span>)}
                  </div>
                )}
              </section>
            )}

            {/* Diagnóstico */}
            {result.diagnostico?.length > 0 && (
              <section className="cs-section">
                <h3 className="cs-section-title">Lo que vimos</h3>
                {result.diagnostico.map((d, i) => (
                  <div key={i} className="cs-diag">
                    <div className="cs-diag-title">{d.titulo}</div>
                    <div className="cs-diag-detail">{d.detalle}</div>
                  </div>
                ))}
              </section>
            )}

            {/* Tareas */}
            {result.tareas?.length > 0 && (
              <section className="cs-section">
                <h3 className="cs-section-title">Tareas y pendientes</h3>
                {result.tareas.map((t, i) => (
                  <div key={i} className="cs-task">
                    <span className="cs-pill" style={{ background: prioColor(t.prioridad) }}>
                      {t.prioridad || 'Media'}
                    </span>
                    <div className="cs-task-body">
                      <div className="cs-task-text">{t.tarea}</div>
                      <div className="cs-task-meta">
                        {(t.responsable || 'Cliente')} · {(t.plazo || 'A definir')}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Plan de acción */}
            {result.plan_accion?.length > 0 && (
              <section className="cs-section">
                <h3 className="cs-section-title">Plan de acción</h3>
                {result.plan_accion.map((p, i) => (
                  <div key={i} className="cs-step">
                    <span className="cs-step-num">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <div className="cs-step-title">{p.paso}</div>
                      <div className="cs-step-detail">{p.detalle}</div>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Notas internas — NO va al PDF del cliente */}
            {result.notas_internas?.length > 0 && (
              <section className="cs-section no-print">
                <h3 className="cs-section-title">Notas internas</h3>
                <div className="cs-notes">
                  <p className="cs-kicker" style={{ marginBottom: 8, color: C.mostaza }}>Privado — no se comparte con el cliente</p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {result.notas_internas.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="cs-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
