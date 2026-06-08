import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  ArrowRight, Moon, Sun, Sparkles, Zap, Image as ImageIcon, BarChart3,
  Target, Bot, Layers, Search, Wand2, Eye, Send,
} from 'lucide-react';
import { AdsLabLogo, AdsLabMark } from './logo.jsx';

// Hook minimal para hacer fade-in cuando el elemento entra al viewport.
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
  const Tag = props.href ? 'a' : 'button';
  return (
    <Tag
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transform: `translate(${t.x}px, ${t.y}px)` }}
      className={`transition-transform duration-200 ease-out ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}

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

// ---- inner components ----

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
      <p className="mt-2 text-xs uppercase tracking-widest font-semibold text-violet-700 dark:text-violet-300">{label}</p>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{detail}</p>
    </div>
  );
}

function Marquee() {
  const items = [
    'gpt-image-2', 'Claude Sonnet', 'Meta Ad Library', 'Apify',
    'Strategist v3', 'Texto en español', 'Multi-marca', 'Bulk generation',
    'Rebrand automático', 'Galería persistida',
  ];
  const stream = [...items, ...items];
  return (
    <div className="relative py-6 border-y border-violet-100/60 dark:border-gray-800/60 overflow-hidden bg-gradient-to-r from-violet-50/50 via-purple-50/30 to-violet-50/50 dark:from-gray-900/50 dark:via-gray-800/30 dark:to-gray-900/50">
      <div className="flex gap-12 marquee-track whitespace-nowrap">
        {stream.map((it, i) => (
          <span
            key={i}
            className="text-sm uppercase tracking-[0.25em] font-semibold text-gray-600 dark:text-gray-400 inline-flex items-center gap-3 shrink-0"
          >
            <Sparkles size={12} className="text-violet-600 dark:text-violet-400" />
            {it}
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-violet-50/95 to-transparent dark:from-gray-950/95" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-violet-50/95 to-transparent dark:from-gray-950/95" />
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="group h-full p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-violet-100 to-purple-200 dark:from-violet-900/40 dark:to-purple-800/40 text-violet-800 dark:text-violet-300 mb-3 group-hover:scale-110 transition-transform">
        <Icon size={18} />
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1.5">{title}</h3>
      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{description}</p>
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
    <div className="min-h-screen bg-gradient-to-b from-violet-50 via-white to-violet-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-gray-900 dark:text-gray-100 scroll-smooth">
      {/* Blob ambient que sigue al cursor */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-[1] w-[420px] h-[420px] rounded-full bg-gradient-to-br from-purple-300/20 via-violet-300/20 to-pink-300/10 dark:from-purple-500/10 dark:via-violet-500/10 dark:to-pink-500/5 blur-3xl mix-blend-multiply dark:mix-blend-screen transition-transform duration-700 ease-out"
        style={{ transform: `translate(${mouse.x - 210}px, ${mouse.y - 210}px)` }}
      />
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-white/60 dark:bg-gray-950/60 border-b border-violet-100/50 dark:border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AdsLabMark size={32} />
            <span className="text-sm font-semibold tracking-widest uppercase text-gray-700 dark:text-gray-200">AdsLab</span>
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
            <button
              onClick={onAccess}
              className="inline-flex items-center gap-1 px-4 py-1.5 text-xs font-semibold rounded-full bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 transition shadow-lg shadow-violet-500/30"
            >
              Acceder <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-40 pb-20 px-6 relative overflow-hidden">
        <div aria-hidden="true" className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-violet-200/30 to-purple-200/20 dark:from-violet-500/10 dark:to-purple-500/10 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-40 -left-32 w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-purple-200/40 to-violet-100/20 dark:from-purple-500/10 dark:to-violet-500/5 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute top-32 left-[8%] float-y opacity-50">
          <Sparkles size={28} className="text-violet-500/60 dark:text-violet-400/40" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute top-44 right-[12%] float-y-slow opacity-60">
          <Zap size={20} className="text-purple-500/50 dark:text-purple-400/40" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-24 left-[15%] float-y-slow opacity-50">
          <Sparkles size={16} className="text-violet-600/50 dark:text-violet-400/30" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-32 right-[18%] float-y opacity-40">
          <Zap size={22} className="text-purple-600/50 dark:text-purple-400/30" />
        </div>

        <div
          className="max-w-4xl mx-auto text-center relative"
          style={{ transform: `translateY(${-parallax}px)` }}
        >
          <FadeIn>
            <div className="flex justify-center mb-8">
              <AdsLabLogo size="xl" variant={darkMode ? 'light' : 'default'} />
            </div>
          </FadeIn>
          <FadeIn delay={120}>
            <h1 className="text-3xl md:text-5xl font-light text-gray-900 dark:text-gray-100 leading-tight max-w-3xl mx-auto mb-5">
              Creativos para Meta Ads,
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent font-semibold"> generados con IA </span>
              en minutos.
            </h1>
            <p className="text-base md:text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Scrapeá los ads ganadores de tu competencia, replicá la fórmula validada
              con tu producto, y exportá una grilla lista para Meta. Sin diseñadores, sin Photoshop.
            </p>
          </FadeIn>
          <FadeIn delay={240}>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
              <MagneticButton
                onClick={onAccess}
                className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold text-sm shadow-lg shadow-violet-500/30 hover:shadow-2xl hover:shadow-violet-500/40 cursor-pointer"
              >
                <Sparkles size={16} />
                Empezar ahora
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </MagneticButton>
              <MagneticButton
                href="#features"
                strength={0.18}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold text-sm hover:border-violet-600 dark:hover:border-violet-400"
              >
                Cómo funciona
              </MagneticButton>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* KPIs del producto */}
      <section id="highlights" className="pb-16 px-6 relative z-[2]">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          <FadeIn delay={0}>
            <TiltCard>
              <DataCard
                kpi={70}
                unit="segundos"
                label="Por creativo"
                detail="gpt-image-2 + Sonnet 4.6 Strategist trabajando en paralelo. Listo para Meta."
              />
            </TiltCard>
          </FadeIn>
          <FadeIn delay={120}>
            <TiltCard>
              <DataCard
                kpi={6}
                unit="variaciones"
                label="Por ad ganador"
                detail="Desde réplica fiel hasta escenas inventadas que mantienen el ángulo validado."
              />
            </TiltCard>
          </FadeIn>
          <FadeIn delay={240}>
            <TiltCard>
              <DataCard
                kpi="$0.18"
                unit="USD"
                label="Costo por imagen"
                detail="High quality 1024×1024. Pagás solo el modelo, sin markup."
              />
            </TiltCard>
          </FadeIn>
        </div>
      </section>

      <Marquee />

      {/* Features — qué hace AdsLab */}
      <section id="features" className="py-20 px-6 border-t border-violet-100/50 dark:border-gray-800/50">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-xs tracking-[0.3em] uppercase text-violet-700 dark:text-violet-300 mb-3 text-center">Producto</p>
            <h2 className="text-3xl md:text-4xl font-light text-center mb-3 text-gray-900 dark:text-gray-100">
              Todo el workflow del media buyer en una sola app
            </h2>
            <p className="text-center text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-12">
              Inspiración, generación y bandeja de ideas. Conectado directo con Meta Ad Library para que
              no copies a ciegas — copiá fórmulas que tu competencia YA validó con su plata.
            </p>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FadeIn delay={0}><TiltCard max={8}><FeatureCard
              icon={Search}
              title="Inspiración"
              description="Scrapeo de ads activos de tu competencia. Score automático de ganadores por días + variantes."
            /></TiltCard></FadeIn>
            <FadeIn delay={100}><TiltCard max={8}><FeatureCard
              icon={Wand2}
              title="Generación"
              description="Replicá la fórmula del ganador con TU producto y TU marca. Texto en español sin garabatos."
            /></TiltCard></FadeIn>
            <FadeIn delay={200}><TiltCard max={8}><FeatureCard
              icon={Bot}
              title="Bandeja de ideas"
              description="Briefs autogenerados con Claude. Multi-select y bulk para mandar 10 ideas a generar en background."
            /></TiltCard></FadeIn>
            <FadeIn delay={300}><TiltCard max={8}><FeatureCard
              icon={ImageIcon}
              title="Galería"
              description="Repositorio de creativos con archive, bulk download ZIP, filtros por estado/variante/origen."
            /></TiltCard></FadeIn>
          </div>
        </div>
      </section>

      {/* Cómo funciona — 4 pasos */}
      <section className="py-20 px-6 border-t border-violet-100/50 dark:border-gray-800/50">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <p className="text-xs tracking-[0.3em] uppercase text-violet-700 dark:text-violet-300 mb-3 text-center">Proceso</p>
            <h2 className="text-3xl md:text-4xl font-light text-center mb-12 text-gray-900 dark:text-gray-100">
              De idea a creativo en 4 pasos
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { n: '01', icon: Layers,  t: 'Setup', d: 'Cargá tu producto, descripción, research y color de marca. Una sola vez.' },
              { n: '02', icon: Target,  t: 'Competencia', d: 'Sumá los competidores que querés trackear. AdsLab scrapea sus ads activos.' },
              { n: '03', icon: Eye,     t: 'Inspiración', d: 'Mirás el Top 10 de ads ganadores rankeados por días corriendo + variantes activas.' },
              { n: '04', icon: Send,    t: 'Generar', d: 'Click "Crear creativo". Sonnet planifica, gpt-image-2 ejecuta. Listo para Meta.' },
            ].map((step, i) => {
              const Icon = step.icon;
              return (
                <FadeIn key={step.n} delay={i * 100}>
                  <div className="relative h-full p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold tracking-widest text-violet-600 dark:text-violet-400">{step.n}</span>
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

      {/* Lo que recibís — sobrio */}
      <section className="py-16 px-6 border-t border-violet-100/50 dark:border-gray-800/50">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <h2 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-gray-100 mb-6">
              Por qué AdsLab y no usar gpt-image-2 a pelo
            </h2>
            <ul className="space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-violet-500 shrink-0" />
                <span><strong>Estrategia primero, imagen después</strong> — Sonnet 4.6 actúa como media buyer: lee el ad ganador, extrae ángulo + hook + avatar, ADAPTA badges/claims a tu producto, y planifica N variaciones distintas de la misma fórmula validada.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-violet-500 shrink-0" />
                <span><strong>Replica visual + estrategia + texto en simultáneo</strong> — el modelo recibe la imagen del ganador como ref + tu producto + el plan completo. Sale composición fiel con tu producto al medio y texto en español rioplatense.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-violet-500 shrink-0" />
                <span><strong>Galería persistida + multi-PC</strong> — todo se guarda en Supabase. Entrá desde otra PC y seguís donde dejaste.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-violet-500 shrink-0" />
                <span><strong>Bulk + background</strong> — mandás 10 ideas de la Bandeja, te vas a hacer otra cosa y volvés con todo listo en la galería. Concurrency tuneada para no congestionar tu cuenta de OpenAI.</span>
              </li>
            </ul>
          </FadeIn>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-20 px-6 border-t border-violet-100/50 dark:border-gray-800/50">
        <FadeIn>
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-gray-100 leading-tight">
              Probalo con tu próxima campaña
            </h2>
            <p className="mt-3 text-gray-600 dark:text-gray-400">
              Creá tu cuenta, cargá tu primer producto y generá la primera grilla en menos de 10 minutos.
              Pagás solo lo que consumís en OpenAI / Anthropic / Apify.
            </p>
            <MagneticButton
              onClick={onAccess}
              className="mt-8 inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold text-sm shadow-lg shadow-violet-500/30 hover:shadow-2xl cursor-pointer"
            >
              <Sparkles size={16} />
              Crear cuenta
              <ArrowRight size={16} />
            </MagneticButton>
          </div>
        </FadeIn>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-violet-100/50 dark:border-gray-800/50">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <AdsLabMark size={28} />
            <span className="font-semibold text-gray-700 dark:text-gray-200">AdsLab</span>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-6">
            <span className="text-xs">© {new Date().getFullYear()} AdsLab — Tool para Meta Ads</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
