import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ArrowRight, Droplet, Beaker, FlaskConical, Pipette, Clock, FileText, Truck, Moon, Sun, MessageCircle, Sparkles } from 'lucide-react';
import { VioraLogo, VioraMark } from './logo.jsx';

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

// Cuenta animada de 0 → target con easeOutCubic. Inicia recién cuando
// el elemento entra al viewport (para que el efecto se vea al scrollear).
function useAnimatedNumber(target, duration = 1200) {
  const [value, setValue] = useState(0);
  const [ref, visible] = useInView({ threshold: 0.3 });
  useEffect(() => {
    if (!visible) return;
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, target, duration]);
  return [ref, value];
}

// Posición global del cursor (clamped a viewport). Usado por el blob del hero
// que sigue suavemente al mouse.
function useMousePosition() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    let raf = 0;
    const onMove = (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPos({ x: e.clientX, y: e.clientY }));
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  return pos;
}

// Botón con efecto magnético: al acercar el cursor, el botón se atrae
// suavemente hacia él. Da un feel premium muy sutil.
function MagneticButton({ children, className = '', strength = 0.25, ...props }) {
  const ref = useRef(null);
  const [t, setT] = useState({ x: 0, y: 0 });
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    setT({ x: (e.clientX - cx) * strength, y: (e.clientY - cy) * strength });
  };
  const onLeave = () => setT({ x: 0, y: 0 });
  return (
    <a
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transform: `translate(${t.x}px, ${t.y}px)` }}
      className={`transition-transform duration-200 ease-out ${className}`}
      {...props}
    >
      {children}
    </a>
  );
}

// Card con efecto tilt 3D: al pasar el mouse, la card rota levemente
// según la posición relativa del cursor. Disabled en touch devices.
function TiltCard({ children, className = '', max = 6 }) {
  const ref = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setTilt({ rx: (0.5 - py) * max, ry: (px - 0.5) * max });
  };
  const onLeave = () => setTilt({ rx: 0, ry: 0 });
  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transform: `perspective(800px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`, transformStyle: 'preserve-3d' }}
      className={`transition-transform duration-200 ease-out ${className}`}
    >
      {children}
    </div>
  );
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
  const mouse = useMousePosition();

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 via-white to-rose-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-gray-900 dark:text-gray-100 scroll-smooth">
      {/* Blob ambient que sigue al cursor — fixed sobre todo el viewport.
          Usa pointer-events:none para no interferir con clicks. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-[1] w-[420px] h-[420px] rounded-full bg-gradient-to-br from-amber-300/20 via-rose-300/20 to-pink-300/10 dark:from-amber-500/10 dark:via-rose-500/10 dark:to-pink-500/5 blur-3xl mix-blend-multiply dark:mix-blend-screen transition-transform duration-700 ease-out"
        style={{ transform: `translate(${mouse.x - 210}px, ${mouse.y - 210}px)` }}
      />
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

      {/* Hero — más sobrio, menos vende-humo */}
      <section className="pt-40 pb-20 px-6 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-amber-200/30 to-rose-200/20 dark:from-amber-500/10 dark:to-rose-500/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-40 -left-32 w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-rose-200/40 to-amber-100/20 dark:from-rose-500/10 dark:to-amber-500/5 blur-3xl"
        />
        {/* Elementos decorativos flotantes — drops y sparkles ambient */}
        <div aria-hidden="true" className="pointer-events-none absolute top-32 left-[8%] float-y opacity-50">
          <Droplet size={28} className="text-amber-500/60 dark:text-amber-400/40" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute top-44 right-[12%] float-y-slow opacity-60">
          <Sparkles size={20} className="text-rose-500/50 dark:text-rose-400/40" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-24 left-[15%] float-y-slow opacity-50">
          <Sparkles size={16} className="text-amber-600/50 dark:text-amber-400/30" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-32 right-[18%] float-y opacity-40">
          <Droplet size={22} className="text-rose-600/50 dark:text-rose-400/30" />
        </div>

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
            <p className="text-base md:text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Laboratorio cosmético argentino. Producimos cremas, sérums, aceites
              y goteros bajo marca propia, con tiradas chicas y plazos cortos.
            </p>
          </FadeIn>
          <FadeIn delay={240}>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
              <MagneticButton
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-semibold text-sm shadow-lg hover:shadow-2xl"
              >
                <MessageCircle size={16} />
                Pedir cotización
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </MagneticButton>
              <MagneticButton
                href="#productos"
                strength={0.18}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold text-sm hover:border-gray-900 dark:hover:border-gray-300"
              >
                Qué fabricamos
              </MagneticButton>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Datos clave — números concretos, animados al hacer scroll */}
      <section id="highlights" className="pb-16 px-6 relative z-[2]">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          <FadeIn delay={0}>
            <TiltCard>
              <DataCard
                kpi={100}
                unit="unidades"
                label="Mínimo de producción"
                detail="Por producto y por lote. Sirve para validar una marca o repetir clásicos."
              />
            </TiltCard>
          </FadeIn>
          <FadeIn delay={120}>
            <TiltCard>
              <DataCard
                kpi="5–9"
                unit="días hábiles"
                label="Despacho"
                detail="Desde la aprobación de la cotización hasta la entrega del lote."
              />
            </TiltCard>
          </FadeIn>
          <FadeIn delay={240}>
            <TiltCard>
              <DataCard
                kpi={24}
                kpiPrefix="<"
                unit="horas"
                label="Cotización"
                detail="Te respondemos con costos detallados al día siguiente hábil."
              />
            </TiltCard>
          </FadeIn>
        </div>
      </section>

      {/* Marquee con keywords del laboratorio — barra que se mueve infinita */}
      <Marquee />


      {/* Productos — qué fabricamos */}
      <section id="productos" className="py-20 px-6 border-t border-rose-100/50 dark:border-gray-800/50">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-xs tracking-[0.3em] uppercase text-amber-700 dark:text-amber-300 mb-3 text-center">Catálogo</p>
            <h2 className="text-3xl md:text-4xl font-light text-center mb-3 text-gray-900 dark:text-gray-100">
              Qué fabricamos
            </h2>
            <p className="text-center text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-12">
              Trabajamos con cuatro líneas. Cada producto se desarrolla bajo tu fórmula,
              o adaptamos una de nuestras bases.
            </p>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FadeIn delay={0}><TiltCard max={8}><ProductCard
              icon={Beaker}
              title="Cremas"
              description="Faciales y corporales. Hidratantes, nutritivas, anti-edad, exfoliantes."
            /></TiltCard></FadeIn>
            <FadeIn delay={100}><TiltCard max={8}><ProductCard
              icon={Pipette}
              title="Sérums"
              description="Activos concentrados: vitamina C, ácido hialurónico, niacinamida, retinol."
            /></TiltCard></FadeIn>
            <FadeIn delay={200}><TiltCard max={8}><ProductCard
              icon={Droplet}
              title="Aceites"
              description="Capilares, faciales y corporales. Bases con activos vegetales."
            /></TiltCard></FadeIn>
            <FadeIn delay={300}><TiltCard max={8}><ProductCard
              icon={FlaskConical}
              title="Goteros"
              description="Tinturas, esencias y formulaciones líquidas en envase con cuentagotas."
            /></TiltCard></FadeIn>
          </div>
        </div>
      </section>

      {/* Cómo funciona — 4 pasos sobrios */}
      <section className="py-20 px-6 border-t border-rose-100/50 dark:border-gray-800/50">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <p className="text-xs tracking-[0.3em] uppercase text-amber-700 dark:text-amber-300 mb-3 text-center">Proceso</p>
            <h2 className="text-3xl md:text-4xl font-light text-center mb-12 text-gray-900 dark:text-gray-100">
              Cómo trabajamos
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              {
                n: '01',
                icon: MessageCircle,
                t: 'Contacto',
                d: 'Nos contás qué producto querés desarrollar y la cantidad estimada.',
              },
              {
                n: '02',
                icon: FileText,
                t: 'Cotización',
                d: 'En menos de 24 hs te enviamos los costos desglosados por contenido, envase y etiqueta.',
              },
              {
                n: '03',
                icon: FlaskConical,
                t: 'Producción',
                d: 'Una vez confirmado el pago, el lote entra al laboratorio.',
              },
              {
                n: '04',
                icon: Truck,
                t: 'Despacho',
                d: 'Entregamos el lote en 5 a 9 días hábiles desde la aprobación.',
              },
            ].map((step, i) => {
              const Icon = step.icon;
              return (
              <FadeIn key={step.n} delay={i * 100}>
                <div className="relative h-full p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold tracking-widest text-amber-600 dark:text-amber-400">{step.n}</span>
                    <Icon size={16} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{step.t}</h3>
                  <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{step.d}</p>
                </div>
              </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* Detalle técnico — sobrio y honesto */}
      <section className="py-16 px-6 border-t border-rose-100/50 dark:border-gray-800/50">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <h2 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-gray-100 mb-6">
              Lo que vas a recibir
            </h2>
            <ul className="space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                <span>Cotización detallada con los costos de contenido, envase y etiqueta por separado.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                <span>Lote completo terminado: producto envasado, etiquetado y listo para vender.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                <span>Seguimiento del estado de la orden por WhatsApp en cada etapa.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                <span>Posibilidad de adaptar fórmulas existentes o trabajar con la tuya propia.</span>
              </li>
            </ul>
          </FadeIn>
        </div>
      </section>

      {/* CTA final — directo */}
      <section className="py-20 px-6 border-t border-rose-100/50 dark:border-gray-800/50">
        <FadeIn>
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-gray-100 leading-tight">
              ¿Tenés un producto en mente?
            </h2>
            <p className="mt-3 text-gray-600 dark:text-gray-400">
              Escribinos al WhatsApp con el detalle (qué producto, cantidad estimada, envase) y te respondemos con la cotización en menos de 24 hs hábiles.
            </p>
            <MagneticButton
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-8 inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-gradient-to-r from-amber-600 to-amber-700 text-white font-semibold text-sm shadow-lg hover:shadow-2xl"
            >
              <MessageCircle size={16} />
              {WHATSAPP_DISPLAY}
            </MagneticButton>
          </div>
        </FadeIn>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-rose-100/50 dark:border-gray-800/50">
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

    </div>
  );
}

// Card de KPI: número grande + unidad chica + label + detalle.
// Si kpi es un número, se anima de 0 al valor cuando entra al viewport.
// Si es string (ej. "5–9"), se muestra tal cual.
function DataCard({ kpi, kpiPrefix = '', unit, label, detail }) {
  const isNumeric = typeof kpi === 'number';
  const [ref, value] = useAnimatedNumber(isNumeric ? kpi : 0);
  const display = isNumeric ? Math.round(value).toString() : kpi;
  return (
    <div ref={ref} className="h-full p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-xl transition-all duration-300">
      <div className="flex items-baseline gap-1.5">
        {kpiPrefix && <span className="text-2xl md:text-3xl font-light text-gray-700 dark:text-gray-300">{kpiPrefix}</span>}
        <span className="text-4xl md:text-5xl font-light text-gray-900 dark:text-gray-100 tracking-tight tabular-nums">{display}</span>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{unit}</span>
      </div>
      <p className="mt-2 text-xs uppercase tracking-widest font-semibold text-amber-700 dark:text-amber-300">{label}</p>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{detail}</p>
    </div>
  );
}

// Marquee: barra horizontal con keywords/productos del lab que se desplazan
// infinitamente. Genera sensación de continuidad y vida visual sin ser
// chillón. Pause on hover para legibilidad.
function Marquee() {
  const items = [
    'Cremas', 'Sérums', 'Aceites', 'Goteros', 'Marca propia',
    'Tiradas chicas', 'Fórmulas a medida', 'Cosmética artesanal',
    'Mínimo 100 unidades', 'Despacho 5–9 días',
  ];
  // duplicamos para loop continuo sin "salto"
  const stream = [...items, ...items];
  return (
    <div className="relative py-6 border-y border-rose-100/60 dark:border-gray-800/60 overflow-hidden bg-gradient-to-r from-rose-50/50 via-amber-50/30 to-rose-50/50 dark:from-gray-900/50 dark:via-gray-800/30 dark:to-gray-900/50">
      <div className="flex gap-12 marquee-track whitespace-nowrap">
        {stream.map((it, i) => (
          <span
            key={i}
            className="text-sm uppercase tracking-[0.25em] font-semibold text-gray-600 dark:text-gray-400 inline-flex items-center gap-3 shrink-0"
          >
            <Sparkles size={12} className="text-amber-600 dark:text-amber-400" />
            {it}
          </span>
        ))}
      </div>
      {/* Fade en los bordes para que el loop se sienta natural */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-rose-50/95 to-transparent dark:from-gray-950/95" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-rose-50/95 to-transparent dark:from-gray-950/95" />
    </div>
  );
}

// Card de producto: ícono pequeño + título + descripción técnica corta.
function ProductCard({ icon: Icon, title, description }) {
  return (
    <div className="group h-full p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-800/40 text-amber-800 dark:text-amber-300 mb-3 group-hover:scale-110 transition-transform">
        <Icon size={18} />
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1.5">{title}</h3>
      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}
