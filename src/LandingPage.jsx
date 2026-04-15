import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Package2, Clock, Sparkles, Moon, Sun, MessageCircle } from 'lucide-react';
import { VioraLogo, VioraMark } from './logo.jsx';
import ChatbotWidget from './ChatbotWidget.jsx';

const WHATSAPP_NUMBER = '5492236877663';
const WHATSAPP_DISPLAY = '+54 9 2236 87-7663';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

// Hook minimal para hacer fade-in cuando el elemento entra al viewport.
// Devuelve un ref y un boolean "isVisible". La transición la maneja Tailwind.
function useInView(options = { threshold: 0.15 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.unobserve(node);
      }
    }, options);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, visible];
}

// Wrapper que aplica el fade-in al scroll a sus hijos.
function FadeIn({ children, delay = 0, className = '', as: Tag = 'div' }) {
  const [ref, visible] = useInView();
  return (
    <Tag
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
    >
      {children}
    </Tag>
  );
}

// Parallax suave del bloque del hero: se traduce levemente hacia arriba al scrollear.
function useParallax() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setOffset(Math.min(80, window.scrollY * 0.25));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return offset;
}

export default function LandingPage({ onAccess }) {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('dash-dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('dash-dark-mode', String(darkMode));
  }, [darkMode]);

  const parallax = useParallax();

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 via-white to-rose-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-gray-900 dark:text-gray-100">
      {/* Nav sutil arriba */}
      <nav className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-white/60 dark:bg-gray-950/60 border-b border-rose-100/50 dark:border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VioraMark size={32} />
            <span className="text-sm font-semibold tracking-widest uppercase text-gray-700 dark:text-gray-200">Viora</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title={darkMode ? 'Modo claro' : 'Modo oscuro'}
              aria-label="Cambiar tema"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-amber-700/30 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition"
            >
              <MessageCircle size={14} /> WhatsApp
            </a>
            <button
              onClick={onAccess}
              className="inline-flex items-center gap-1 px-4 py-1.5 text-xs font-semibold rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90 transition"
            >
              Acceder <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-40 pb-24 px-6 relative overflow-hidden">
        {/* Decoración dorada sutil de fondo */}
        <div
          aria-hidden="true"
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-amber-200/30 to-rose-200/20 dark:from-amber-500/10 dark:to-rose-500/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-40 -left-32 w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-rose-200/40 to-amber-100/20 dark:from-rose-500/10 dark:to-amber-500/5 blur-3xl"
        />

        <div
          className="max-w-4xl mx-auto text-center relative"
          style={{ transform: `translateY(${-parallax}px)` }}
        >
          <FadeIn>
            <div className="flex justify-center mb-8">
              <VioraLogo size="xl" variant={darkMode ? 'light' : 'default'} />
            </div>
          </FadeIn>
          <FadeIn delay={120}>
            <p className="text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Laboratorio cosmético para marcas que quieren producir
              <span className="text-amber-700 dark:text-amber-300 font-medium"> bien, a tiempo y sin sorpresas</span>.
            </p>
          </FadeIn>
          <FadeIn delay={240}>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-semibold text-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
              >
                <MessageCircle size={16} />
                Contactar por WhatsApp
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </a>
              <a
                href="#highlights"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold text-sm hover:border-gray-900 dark:hover:border-gray-300 hover:-translate-y-0.5 transition-all duration-300"
              >
                Ver cómo trabajamos
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Highlights */}
      <section id="highlights" className="py-20 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <FadeIn delay={0}>
            <HighlightCard
              icon={Package2}
              title="Mínimo 100 unidades"
              body="Arrancá con tiradas chicas. Ideal para probar una línea, un aroma nuevo o una marca propia sin riesgo."
            />
          </FadeIn>
          <FadeIn delay={120}>
            <HighlightCard
              icon={Clock}
              title="Entrega en 7 a 10 días"
              body="Desde que aprobás la cotización hasta que despachamos. Sin listas de espera ni fechas eternas."
            />
          </FadeIn>
          <FadeIn delay={240}>
            <HighlightCard
              icon={Sparkles}
              title="Costos accesibles"
              body="Precios pensados para que el número cierre desde la primera producción. Cotizamos todo al detalle."
            />
          </FadeIn>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="py-20 px-6 border-t border-rose-100/50 dark:border-gray-800/50">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <p className="text-xs tracking-[0.3em] uppercase text-amber-700 dark:text-amber-300 mb-3 text-center">Flujo</p>
            <h2 className="text-3xl md:text-4xl font-light text-center mb-14" style={{ fontFamily: "'Allura', 'Brush Script MT', cursive" }}>
              De tu idea al despacho
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { n: '01', t: 'Contacto', d: 'Nos escribís contándonos qué producto querés producir.' },
              { n: '02', t: 'Cotización', d: 'Pasamos el detalle de costos por contenido, envase y etiqueta.' },
              { n: '03', t: 'Producción', d: 'Una vez abonado, el lote entra al laboratorio.' },
              { n: '04', t: 'Despacho', d: 'Te entregamos las unidades listas en 7 a 10 días.' },
            ].map((step, i) => (
              <FadeIn key={step.n} delay={i * 120}>
                <div className="relative p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                  <span className="text-xs font-bold tracking-widest text-amber-600 dark:text-amber-400">{step.n}</span>
                  <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{step.t}</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{step.d}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-24 px-6">
        <FadeIn>
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl md:text-5xl font-light text-gray-900 dark:text-gray-100 leading-tight">
              ¿Tenés una idea en la cabeza?
            </h2>
            <p className="mt-4 text-gray-600 dark:text-gray-400 text-lg">
              Mandanos un mensaje y te cotizamos en el día.
            </p>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-amber-600 to-amber-700 text-white font-semibold hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-300"
            >
              <MessageCircle size={18} />
              Escribinos al WhatsApp
            </a>
          </div>
        </FadeIn>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-rose-100/50 dark:border-gray-800/50">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <VioraMark size={28} />
            <span className="font-semibold text-gray-700 dark:text-gray-200">Laboratorio Viora</span>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-6">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-amber-700 dark:hover:text-amber-300 transition"
            >
              <MessageCircle size={14} />
              {WHATSAPP_DISPLAY}
            </a>
            <span className="text-xs">© {new Date().getFullYear()} Laboratorio Viora</span>
          </div>
        </div>
      </footer>

      {/* Chatbot comercial: responde sobre plazos, mínimos, proceso */}
      <ChatbotWidget mode="landing" accent="amber" />
    </div>
  );
}

function HighlightCard({ icon: Icon, title, body }) {
  return (
    <div className="group h-full p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-gradient-to-br from-amber-200/40 to-rose-200/20 dark:from-amber-500/10 dark:to-rose-500/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
      />
      <div className="relative">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-800/40 text-amber-800 dark:text-amber-300 mb-4">
          <Icon size={20} />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
