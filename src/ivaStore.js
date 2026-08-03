// Repositorio de períodos de Proyección de IVA, persistido en localStorage.
// Cada registro es un mes ('YYYY-MM') con los datos del Libro IVA Ventas /
// Compras, los saldos del período anterior, los parámetros y el escenario de
// proyección. CRUD + suscripción reactiva (mismo patrón que actasStore.js).
//
// Nota: se guarda en pesos ARS nativos. No pasa por moneyStore (ese maneja el
// balance operativo del negocio en USD/ARS; el IVA se liquida siempre en ARS).

import { emptyPeriodo, IVA_DEFAULTS } from './ivaCalc.js';

const KEY = 'adslab-iva-periodos-v1';
const subs = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) return arr;
  } catch {}
  return null;
}

function persist(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch {}
  subs.forEach((fn) => { try { fn(arr); } catch {} });
}

export function subscribeIva(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// -----------------------------------------------------------------------------
// Semilla: el período real que trajo el estudio (capturas del Libro IVA), para
// que el módulo abra con datos verificables en vez de vacío. Se puede editar o
// borrar. `saldoTecnicoAnterior` = 14.900.000 según indicó el estudio.
// -----------------------------------------------------------------------------
function seed() {
  const now = Date.now();
  const p = {
    ...emptyPeriodo('2026-07'),
    id: `iva_seed_${now}`,
    // Libro IVA Ventas
    ventasOpNeto: 140010547.03, ventasOpIva: 29402214.81,
    ventasNcNeto: 2243061.90, ventasNcIva: 471042.99,
    // Libro IVA Compras
    comprasOpNeto: 327509842.55, comprasOpIva: 68777066.95,
    comprasNcNeto: 974819.52, comprasNcIva: 204712.11,
    // Saldos período anterior (indicado por el estudio)
    saldoTecnicoAnterior: 14900000,
    saldoLibreDispAnterior: 0,
    alicuota: IVA_DEFAULTS.alicuota,
    beneficioRate: IVA_DEFAULTS.beneficioRate,
    targetRentabilidad: IVA_DEFAULTS.targetRentabilidad,
    margenRentabilidad: IVA_DEFAULTS.margenRentabilidad,
    // Escenario de las capturas: 200.000.000 total de ventas adicionales.
    ventasAdicionalesTotal: 200000000,
    nota: 'Período de ejemplo cargado desde el Libro IVA (editable).',
    createdAt: now,
    updatedAt: now,
  };
  return [p];
}

export function loadPeriodos() {
  const existing = read();
  if (existing) return existing;
  const seeded = seed();
  persist(seeded);
  return seeded;
}

// Inserta o actualiza (por id) un período. Devuelve el registro guardado.
export function savePeriodo(record) {
  const list = loadPeriodos();
  const now = Date.now();
  const id = record.id || `iva_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const full = {
    ...emptyPeriodo(),
    ...record,
    id,
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
  const idx = list.findIndex((r) => r.id === id);
  const next = list.slice();
  if (idx >= 0) next[idx] = full;
  else next.unshift(full);
  // Orden: período más reciente primero.
  next.sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)));
  persist(next);
  return full;
}

export function deletePeriodo(id) {
  persist(loadPeriodos().filter((r) => r.id !== id));
}

// Crea un período nuevo, arrastrando automáticamente los saldos generados del
// más reciente como "saldos del período anterior" (encadenado real).
export function crearPeriodo(periodo) {
  const list = loadPeriodos();
  const prev = list[0];
  const base = emptyPeriodo(periodo);
  if (prev) {
    // Heredamos parámetros y encadenamos saldos vía la liquidación del anterior.
    base.alicuota = prev.alicuota ?? base.alicuota;
    base.beneficioRate = prev.beneficioRate ?? base.beneficioRate;
    base.targetRentabilidad = prev.targetRentabilidad ?? base.targetRentabilidad;
    base.margenRentabilidad = prev.margenRentabilidad ?? base.margenRentabilidad;
  }
  return savePeriodo(base);
}
