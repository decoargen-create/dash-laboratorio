// Contador que cuenta de 0 → value al montar (o cuando value cambia).
// Usa requestAnimationFrame con curva easeOut para que la animación
// arranque rápido y desacelere al llegar.
//
// Uso:
//   <AnimatedCounter value={24} />               → "24" (cuenta en ~700ms)
//   <AnimatedCounter value={500} duration={1200} />
//   <AnimatedCounter value={3.4} decimals={1} />
//   <AnimatedCounter value={1234} format={(n) => n.toLocaleString('es-AR')} />

import React, { useEffect, useRef, useState } from 'react';

export default function AnimatedCounter({
  value,
  duration = 700,
  decimals = 0,
  format,
  className = '',
}) {
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(target);
  const startRef = useRef(target);
  const rafRef = useRef(null);

  useEffect(() => {
    // Si el usuario tiene reduce-motion, mostrar el valor final directo.
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDisplay(target);
      return;
    }
    const from = startRef.current;
    const to = target;
    if (from === to) return;
    const t0 = performance.now();
    const tick = (now) => {
      const elapsed = now - t0;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic — arranca rápido, desacelera.
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (to - from) * eased;
      setDisplay(val);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else startRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  const rendered = format
    ? format(display)
    : decimals > 0
      ? display.toFixed(decimals)
      : Math.round(display).toLocaleString('es-AR');

  return <span className={`tabular-nums ${className}`}>{rendered}</span>;
}
