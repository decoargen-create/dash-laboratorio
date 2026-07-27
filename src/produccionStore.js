// Store de PRODUCCIÓN del equipo creativo (Fase 1 — capa de control, local).
//
// Reemplaza los dos Excels: la planilla master de control + el detalle por
// persona. Guarda ASIGNACIONES semanales (producto × persona), cada una con su
// ESTADO (asignado → subido → en revisión → aprobado → publicado) y calcula el
// pago del equipo. Se integra con los productos que YA existen (productoId de
// marketing_productos), no crea un catálogo aparte.
//
// El control (asignaciones/estados/pago) es local (mismo patrón que
// costsStore/moneyStore). Los videos se suben directo a Google Drive desde
// "Subir creativos" (con fallback al bucket de AdsLab). El login del equipo
// es Fase 2.

const KEY = 'adslab-produccion-v1';
const listeners = new Set();

export const ESTADOS = ['asignado', 'subido', 'revision', 'aprobado', 'publicado'];
export const ESTADO_LABELS = {
  asignado: 'Asignado', subido: 'Subido', revision: 'En revisión',
  aprobado: 'Aprobado', publicado: 'Publicado',
};
export const VIDEOS_POR_PRODUCTO = 9;
export const PAGO_POR_PRODUCTO = 42000; // ARS por producto completo y aprobado.

// Bonus por objetivo semanal (productos COMPLETADOS en la semana).
export function bonusObjetivo(completados) {
  if (completados >= 5) return 36000;
  if (completados === 4) return 30000;
  if (completados === 3) return 24000;
  return 0;
}

// Un producto cuenta como "completado" (para pago/objetivo) cuando está
// aprobado o publicado — NO cuando solo se subió.
const COMPLETO = new Set(['aprobado', 'publicado']);
export function esCompleto(estado) { return COMPLETO.has(estado); }

function read() {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function write(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch {}
  listeners.forEach(fn => { try { fn(); } catch {} });
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('viora:produccion-changed')); } catch {}
  }
}
function genId() { return `prodasig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

export function subscribeProduccion(fn) {
  listeners.add(fn);
  const on = () => { try { fn(); } catch {} };
  if (typeof window !== 'undefined') window.addEventListener('viora:produccion-changed', on);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('viora:produccion-changed', on);
  };
}

// Lunes (horario AR) de la semana de una fecha → 'YYYY-MM-DD'. Es la clave de
// semana con la que se agrupan las asignaciones.
export function weekKeyOf(date = new Date()) {
  const s = date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 dom .. 6 sab
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); // al lunes
  return dt.toISOString().slice(0, 10);
}

// Etiqueta legible de una semana: "Sem. del 28/7".
export function weekLabel(weekKey) {
  if (!weekKey) return '';
  const [, m, d] = weekKey.split('-');
  return `Sem. del ${Number(d)}/${Number(m)}`;
}

export function listAssignments(weekKey) {
  return read().filter(a => a.weekKey === weekKey);
}
export function allWeekKeys() {
  return [...new Set(read().map(a => a.weekKey))].sort().reverse();
}

export function addAssignment({ weekKey, productoId, productoNombre, persona, tipo = 'renovado' }) {
  const per = (persona || '').trim();
  // persona es opcional: sin persona el producto queda "por distribuir"
  // (Fran todavía no lo repartió a ningún agente).
  if (!weekKey) return null;
  const arr = read();
  const nueva = {
    id: genId(),
    weekKey,
    productoId: productoId != null ? String(productoId) : null,
    productoNombre: productoNombre || '',
    persona: per,
    tipo: tipo === 'testeo' ? 'testeo' : 'renovado',
    estado: 'asignado',
    videosTotal: VIDEOS_POR_PRODUCTO,
    videosAprobados: 0,
    nota: '',
    pagado: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  arr.push(nueva);
  write(arr);
  return nueva;
}

// Paso 1 — el admin le pasa a Fran los productos de la semana (cuáles y
// cuántos). Quedan SIN persona ("por distribuir"). Evita duplicar un producto
// que ya está en la semana.
export function addProductoSemana({ weekKey, productoId, productoNombre, tipo = 'renovado' }) {
  if (!weekKey) return null;
  const pid = productoId != null ? String(productoId) : null;
  const arr = read();
  const dup = arr.find(a => a.weekKey === weekKey &&
    (pid != null ? String(a.productoId) === pid : (a.productoNombre || '') === (productoNombre || '')));
  if (dup) return dup; // ya está en la semana
  return addAssignment({ weekKey, productoId, productoNombre, persona: '', tipo });
}

// Paso 2 — Fran reparte: le pone (o le cambia) el agente a un producto.
export function assignPersona(id, persona) {
  updateAssignment(id, { persona: (persona || '').trim() });
}

export function updateAssignment(id, patch) {
  const arr = read();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  arr[i] = { ...arr[i], ...patch, updatedAt: new Date().toISOString() };
  write(arr);
}
export function removeAssignment(id) {
  write(read().filter(a => a.id !== id));
}

// Busca la asignación (semana × producto × persona); si no existe, la crea.
// Es lo que usa "Subir creativos": el equipo elige producto y sube, sin tener
// que armar la asignación a mano. `key` de producto: id si hay, si no el nombre.
export function findOrCreateAssignment({ weekKey, productoId, productoNombre, persona, tipo = 'renovado' }) {
  const per = (persona || '').trim();
  if (!weekKey || !per) return null;
  const pid = productoId != null ? String(productoId) : null;
  const arr = read();
  const found = arr.find(a =>
    a.weekKey === weekKey &&
    a.persona === per &&
    (pid != null
      ? String(a.productoId) === pid
      : (a.productoNombre || '') === (productoNombre || '')));
  if (found) return found;
  return addAssignment({ weekKey, productoId, productoNombre, persona: per, tipo });
}

// Registra archivos subidos en una asignación. Cada archivo:
// { name, driveId?, link?, destino:'drive'|'adslab', storagePath?, sizeMB?, ts }.
// Al subir el primer archivo, si estaba 'asignado' pasa a 'subido'.
export function addArchivos(id, archivos) {
  if (!Array.isArray(archivos) || archivos.length === 0) return;
  const arr = read();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  const prev = arr[i].archivos || [];
  const nextArchivos = [...prev, ...archivos];
  const patch = { archivos: nextArchivos };
  // Primer material subido → mover de 'asignado' a 'subido'.
  if (arr[i].estado === 'asignado') patch.estado = 'subido';
  arr[i] = { ...arr[i], ...patch, updatedAt: new Date().toISOString() };
  write(arr);
  return arr[i];
}

export function removeArchivo(id, ts) {
  const arr = read();
  const i = arr.findIndex(a => a.id === id);
  if (i === -1) return;
  arr[i] = { ...arr[i], archivos: (arr[i].archivos || []).filter(f => f.ts !== ts), updatedAt: new Date().toISOString() };
  write(arr);
}

// Resumen de pago por persona para una semana. Montos en ARS (así paga el user).
export function paymentSummary(weekKey) {
  const asigs = listAssignments(weekKey);
  const byPersona = {};
  for (const a of asigs) {
    const p = a.persona;
    if (!p) continue; // "por distribuir" no cuenta para el pago todavía
    if (!byPersona[p]) byPersona[p] = { persona: p, asignados: 0, completados: 0, pagados: 0 };
    byPersona[p].asignados++;
    if (esCompleto(a.estado)) byPersona[p].completados++;
    if (a.pagado) byPersona[p].pagados++;
  }
  return Object.values(byPersona).map(x => {
    const montoProductos = x.completados * PAGO_POR_PRODUCTO;
    const bonus = bonusObjetivo(x.completados);
    return { ...x, montoProductos, bonus, totalArs: montoProductos + bonus };
  }).sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
}

// =========================================================================
// PAGOS + RESUMEN MENSUAL (para el dashboard de Área creativa)
// =========================================================================
// El pago se salda por (semana × persona) — es la unidad natural porque el
// bonus por objetivo es semanal. Guardamos el estado "pagado" aparte de las
// asignaciones así no ensucia el tablero operativo.

const PAGOS_KEY = 'adslab-produccion-pagos-v1';
const pagoKey = (weekKey, persona) => `${weekKey}|${persona}`;

function readPagos() {
  try { const r = localStorage.getItem(PAGOS_KEY); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function writePagos(obj) {
  try { localStorage.setItem(PAGOS_KEY, JSON.stringify(obj)); } catch {}
  listeners.forEach(fn => { try { fn(); } catch {} });
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('viora:produccion-changed')); } catch {}
  }
}

export function isWeekPaid(weekKey, persona) {
  return !!readPagos()[pagoKey(weekKey, persona)]?.paid;
}
export function setWeekPaid(weekKey, persona, paid = true) {
  const p = readPagos();
  const k = pagoKey(weekKey, persona);
  if (paid) p[k] = { paid: true, paidAt: new Date().toISOString() };
  else delete p[k];
  writePagos(p);
}

// Mes (horario AR) → 'YYYY-MM'. Una semana pertenece al mes de su lunes.
export function monthKeyOf(date = new Date()) {
  const s = date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  return s.slice(0, 7);
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function monthLabel(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}
export function allMonthKeys() {
  const set = new Set(read().map(a => (a.weekKey || '').slice(0, 7)).filter(Boolean));
  return [...set].sort().reverse();
}
export function weeksInMonth(monthKey) {
  return [...new Set(read().filter(a => (a.weekKey || '').slice(0, 7) === monthKey).map(a => a.weekKey))].sort();
}

// Resumen del mes por persona: total a pagar, pagado, pendiente, y el detalle
// semana por semana (con su estado de pago). Solo incluye a quien tiene algo
// para cobrar (productos completos/aprobados).
export function monthlySummary(monthKey) {
  const weeks = weeksInMonth(monthKey);
  const byPersona = {};
  for (const wk of weeks) {
    for (const r of paymentSummary(wk)) {
      if (r.totalArs <= 0) continue; // sin nada aprobado esa semana
      if (!byPersona[r.persona]) {
        byPersona[r.persona] = { persona: r.persona, completados: 0, montoProductos: 0, bonus: 0, total: 0, pagado: 0, pendiente: 0, semanas: [] };
      }
      const p = byPersona[r.persona];
      const paid = isWeekPaid(wk, r.persona);
      p.completados += r.completados;
      p.montoProductos += r.montoProductos;
      p.bonus += r.bonus;
      p.total += r.totalArs;
      if (paid) p.pagado += r.totalArs; else p.pendiente += r.totalArs;
      p.semanas.push({ weekKey: wk, completados: r.completados, montoProductos: r.montoProductos, bonus: r.bonus, total: r.totalArs, paid });
    }
  }
  const personas = Object.values(byPersona)
    .map(p => ({ ...p, semanas: p.semanas.sort((a, b) => a.weekKey.localeCompare(b.weekKey)) }))
    .sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
  const totals = personas.reduce((t, p) => ({
    total: t.total + p.total, pagado: t.pagado + p.pagado, pendiente: t.pendiente + p.pendiente,
    completados: t.completados + p.completados,
  }), { total: 0, pagado: 0, pendiente: 0, completados: 0 });
  return { personas, totals, weeks };
}
