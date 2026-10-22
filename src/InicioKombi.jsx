import React, { useMemo, useState } from 'react';
import { Paperclip, Mic, ArrowUp, Bell } from 'lucide-react';
import PulpoKombi from './PulpoKombi.jsx';

// Inicio con la cara de Kombialo: Kombi saluda y te pregunta qué querés saber
// del negocio. Por ahora es visual (prototipo E): las respuestas de Kombi
// viven en Kombialo; el resumen operativo de AdsLab está en Área creativa →
// Seguimiento.
function saludoHora() {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

const SUGERENCIAS = ['Ventas del mes', '¿Rinde la pauta?', 'Lo más vendido', 'Carritos'];

export default function InicioKombi({ nombre, addToast }) {
  const [texto, setTexto] = useState('');
  const productos = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]').length; } catch { return 0; }
  }, []);
  const preguntar = (q) => {
    if (!String(q || '').trim()) return;
    addToast?.({ type: 'info', message: 'Kombi va a responder acá cuando se unan las dos plataformas.' });
    setTexto('');
  };
  const primerNombre = nombre ? String(nombre).split(/[\s@]/)[0] : '';

  return (
    <div className="min-h-[calc(100vh-120px)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[560px] flex flex-col items-center text-center gap-3 animate-fade-in-up">
        <PulpoKombi size={104} />
        <h1 className="text-[26px] md:text-[30px] font-extrabold tracking-tight text-gray-100 mt-2">
          {saludoHora()}{primerNombre ? `, ${primerNombre.charAt(0).toUpperCase()}${primerNombre.slice(1)}` : ''}
        </h1>
        <p className="text-base text-gray-300">¿Qué querés saber de tu negocio?</p>

        <div className="w-full flex justify-end -mb-1">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-400">
            <Bell size={13} /> Avisos de Kombi
          </span>
        </div>
        <form className="w-full" onSubmit={e => { e.preventDefault(); preguntar(texto); }}>
          <div className="flex items-center gap-2 rounded-[24px] border border-[rgba(130,180,255,0.22)] bg-[#10101b] pl-5 pr-2 py-2 focus-within:border-brand-500/60 transition-colors">
            <input value={texto} onChange={e => setTexto(e.target.value)}
              placeholder="Preguntá lo que necesites…" aria-label="Preguntale a Kombi"
              className="flex-1 min-w-0 bg-transparent text-base text-gray-100 placeholder:text-gray-500 focus:outline-none" />
            <button type="button" className="p-2 text-gray-400 hover:text-gray-200" aria-label="Adjuntar"><Paperclip size={18} /></button>
            <button type="button" className="p-2 text-gray-400 hover:text-gray-200" aria-label="Dictar"><Mic size={18} /></button>
            <button type="submit" aria-label="Enviar"
              className={`w-10 h-10 rounded-full grid place-items-center text-white transition ${texto.trim() ? 'bg-gradient-to-br from-brand-500 to-brand-700' : 'bg-brand-700/40'}`}>
              <ArrowUp size={18} />
            </button>
          </div>
        </form>

        <div className="flex flex-wrap justify-center gap-2 mt-1">
          {SUGERENCIAS.map(s => (
            <button key={s} onClick={() => preguntar(s)}
              className="px-4 py-2 rounded-full border border-[rgba(130,180,255,0.22)] text-[13px] font-semibold text-gray-200 hover:bg-brand-500/10 transition">
              {s}
            </button>
          ))}
        </div>

        <p className="text-[13px] text-gray-500 mt-4">
          Panel de anuncios · {productos} producto{productos === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  );
}
