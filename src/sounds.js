// Sonidos breves para feedback de acciones largas (generación de creativos,
// bulk completo). Generados con Web Audio API en lugar de archivos para
// evitar precaches y latencia de carga.
//
// Respetan preferencia del user via localStorage 'adslab-sonidos-enabled'
// (default true). Toggle disponible en /Setup → Preferencias o donde se
// agregue el switch.

const PREF_KEY = 'adslab-sonidos-enabled';

export function soundsEnabled() {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v == null ? true : v === '1';
  } catch { return true; }
}

export function setSoundsEnabled(enabled) {
  try { localStorage.setItem(PREF_KEY, enabled ? '1' : '0'); } catch {}
}

// Chime ascendente — 2 tonos suaves. Para "creativo listo".
export function playDoneChime() {
  if (!soundsEnabled()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const playTone = (freq, startAt, duration = 0.25) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + startAt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
      o.start(ctx.currentTime + startAt);
      o.stop(ctx.currentTime + startAt + duration + 0.05);
    };
    playTone(880, 0);     // A5
    playTone(1318, 0.12); // E6 — quinta arriba, sonido "feliz"
    // Auto-cerramos el AudioContext para no dejar audio nodes vivos
    setTimeout(() => { try { ctx.close(); } catch {} }, 600);
  } catch {}
}

// Chime más triunfal (3 notas) — para bulk completo o cuando termina N>=4.
export function playBulkDoneChime() {
  if (!soundsEnabled()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const playTone = (freq, startAt, duration = 0.22) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
      g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + startAt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
      o.start(ctx.currentTime + startAt);
      o.stop(ctx.currentTime + startAt + duration + 0.05);
    };
    playTone(659,  0);     // E5
    playTone(880,  0.13);  // A5
    playTone(1318, 0.26);  // E6
    setTimeout(() => { try { ctx.close(); } catch {} }, 900);
  } catch {}
}

// Sonido sutil de error — para cuando una variación falla pero el resto
// sigue. Tono descendente más bajo en volumen.
export function playErrorTone() {
  if (!soundsEnabled()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(440, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.3);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.4);
    setTimeout(() => { try { ctx.close(); } catch {} }, 500);
  } catch {}
}
