// Efectos visuales del flujo de aprobación en Producción (elegidos por el
// user en el playground de prototipos): confeti + sello "APROBADO" para el
// festejo de aprobar todos, chispas para el ✓ individual. Los keyframes CSS
// viven en index.css (fx-pop, fx-flash, fx-shake, fx-pulse-amber, fx-swapin,
// fx-latido, fx-stamp, fx-spark).
//
// Respetan prefers-reduced-motion: con animaciones reducidas, nada de esto
// corre (el estado igual cambia — los efectos son puro feedback).

import confetti from 'canvas-confetti';

export const motionOk = () => {
  try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return true; }
};

// Chispas verdes que salen del botón ✓ al aprobar un video.
export function sparksAt(el) {
  if (!motionOk() || !el) return;
  for (let i = 0; i < 7; i++) {
    const s = document.createElement('span');
    s.className = 'fx-spark';
    const a = Math.random() * Math.PI * 2;
    const d = 13 + Math.random() * 13;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    el.appendChild(s);
    setTimeout(() => s.remove(), 600);
  }
}

// Re-dispara una animación CSS aunque la clase ya estuviera puesta.
export function rearm(el, cls, ms = 800) {
  if (!motionOk() || !el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => { try { el.classList.remove(cls); } catch {} }, ms);
}

// Confeti centrado en un elemento (tres ráfagas, colores de la marca).
export function confettiAt(el) {
  if (!motionOk()) return;
  try {
    const r = el?.getBoundingClientRect?.();
    const x = r ? (r.left + r.width / 2) / window.innerWidth : 0.5;
    const y = r ? Math.min(0.95, (r.top + r.height * 0.6) / window.innerHeight) : 0.6;
    const COLORS = ['#34d399', '#c93bee', '#8b5cf6', '#fbbf24'];
    confetti({ particleCount: 90, spread: 78, origin: { x, y }, colors: COLORS, zIndex: 9999 });
    setTimeout(() => confetti({ particleCount: 45, angle: 60, spread: 55, origin: { x: Math.max(0, x - 0.18), y }, colors: COLORS, zIndex: 9999 }), 160);
    setTimeout(() => confetti({ particleCount: 45, angle: 120, spread: 55, origin: { x: Math.min(1, x + 0.18), y }, colors: COLORS, zIndex: 9999 }), 300);
  } catch {}
}

// Sello "✓ APROBADO" estampado sobre un contenedor (que debe ser
// position:relative). Se limpia solo.
export function stampAprobado(el) {
  if (!motionOk() || !el) return;
  const st = document.createElement('div');
  st.className = 'fx-stamp';
  st.innerHTML = '<span>✓ APROBADO</span>';
  el.appendChild(st);
  setTimeout(() => st.remove(), 1700);
}

// Vuelo FLIP de una tarjeta del tablero al cambiar de columna (dopamina ✨).
// First: medimos dónde está la tarjeta. mutate() cambia el estado (React la
// re-monta en la otra columna). Last: la medimos de nuevo. Invert+Play: la
// arrancamos visualmente desde donde estaba y la dejamos viajar con CSS.
// Doble requestAnimationFrame: el primero espera el commit de React, el
// segundo garantiza que el transform inicial se pintó antes de animar.
export function flipMove(cardId, mutate) {
  const sel = `[data-prodcard-id="${cardId}"]`;
  const el = document.querySelector(sel);
  const first = el?.getBoundingClientRect();
  mutate();
  if (!motionOk() || !first) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const nel = document.querySelector(sel);
    if (!nel) return;
    const last = nel.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    nel.style.transition = 'none';
    nel.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`;
    nel.style.zIndex = '50';
    nel.style.boxShadow = '0 18px 40px rgba(52,211,153,.35)';
    requestAnimationFrame(() => {
      nel.style.transition = 'transform .65s cubic-bezier(.3,.9,.3,1), box-shadow .65s ease';
      nel.style.transform = '';
      nel.style.boxShadow = '';
      setTimeout(() => { nel.style.transition = ''; nel.style.zIndex = ''; }, 720);
    });
  }));
}
