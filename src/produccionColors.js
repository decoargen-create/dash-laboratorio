// Colores por persona — compartidos entre el tablero del admin (ProduccionSection)
// y el del editor (CreatorWorkspace), así una misma persona se ve del mismo color
// en las dos vistas y las tarjetas tintan igual en ambas.
//
// Cada persona recibe un color DISTINTO (resolviendo colisiones del hash) mientras
// queden colores libres. Algunos colores están FIJADOS a pedido (COLOR_OVERRIDE) y
// tienen prioridad. registrarColoresPersonas() llena el registro con la lista
// completa; personaColor() lo consulta (con fallback por hash si no se registró).

export const PERSONA_PALETTE = ['amber', 'violet', 'sky', 'emerald', 'rose', 'indigo', 'teal'];

function hashIdx(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % PERSONA_PALETTE.length;
}

// Colores FIJOS por persona (a pedido): tienen prioridad sobre el hash y reservan
// ese color para que nadie más lo use. Clave = nombre en minúsculas.
export const COLOR_OVERRIDE = { dai: 'rose' };

const _colorPersona = {};

export function registrarColoresPersonas(names) {
  const uniq = [...new Set((names || []).map(n => (n || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  const usados = new Set();
  const map = {};
  // 1) Overrides primero: fijan y reservan su color.
  for (const n of uniq) {
    const ov = COLOR_OVERRIDE[n.trim().toLowerCase()];
    if (ov && PERSONA_PALETTE.includes(ov)) { map[n.toLowerCase()] = ov; usados.add(ov); }
  }
  // 2) El resto: por hash, evitando los colores ya usados.
  for (const n of uniq) {
    const k = n.toLowerCase();
    if (map[k]) continue;
    let idx = hashIdx(k), tries = 0;
    while (usados.has(PERSONA_PALETTE[idx]) && tries < PERSONA_PALETTE.length) { idx = (idx + 1) % PERSONA_PALETTE.length; tries++; }
    const color = PERSONA_PALETTE[idx];
    usados.add(color); map[k] = color;
  }
  for (const k in _colorPersona) delete _colorPersona[k];
  Object.assign(_colorPersona, map);
}

export function personaColor(name) {
  if (!name) return 'gray';
  const k = name.trim().toLowerCase();
  return _colorPersona[k] || PERSONA_PALETTE[hashIdx(k)];
}

export const CHIP_CLS = {
  amber: 'bg-amber-400 text-amber-950', violet: 'bg-violet-500 text-white',
  sky: 'bg-sky-500 text-white', emerald: 'bg-emerald-500 text-white',
  rose: 'bg-rose-500 text-white', indigo: 'bg-indigo-500 text-white',
  teal: 'bg-teal-500 text-white',
  gray: 'bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-200',
};

// Tinte SUTIL de la tarjeta con el color de la persona: un degradé muy tenue
// desde la esquina (como background-image, así no pisa el bg-white/gris base) +
// una barra lateral izquierda (span absoluto, para no pelear con el `border`
// base). Identifica de un vistazo de quién es la tarjeta. Sin asignar (gray) =
// sin tinte. Clases estáticas para que Tailwind no las purgue.
export const CARD_TINT = {
  amber: 'bg-gradient-to-br from-amber-100/50 dark:from-amber-500/10 to-transparent',
  violet: 'bg-gradient-to-br from-violet-100/50 dark:from-violet-500/10 to-transparent',
  sky: 'bg-gradient-to-br from-sky-100/50 dark:from-sky-500/10 to-transparent',
  emerald: 'bg-gradient-to-br from-emerald-100/50 dark:from-emerald-500/10 to-transparent',
  rose: 'bg-gradient-to-br from-rose-100/50 dark:from-rose-500/10 to-transparent',
  indigo: 'bg-gradient-to-br from-indigo-100/50 dark:from-indigo-500/10 to-transparent',
  teal: 'bg-gradient-to-br from-teal-100/50 dark:from-teal-500/10 to-transparent',
  gray: '',
};
export const CARD_STRIPE = {
  amber: 'bg-amber-400', violet: 'bg-violet-500', sky: 'bg-sky-500',
  emerald: 'bg-emerald-500', rose: 'bg-rose-500', indigo: 'bg-indigo-500',
  teal: 'bg-teal-500', gray: '',
};
