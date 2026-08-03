// =============================================================================
// MOTOR DE CÁLCULO — Proyección de IVA (Argentina · ARCA ex-AFIP)
// -----------------------------------------------------------------------------
// Funciones PURAS (sin side-effects, sin localStorage) para determinar la
// posición mensual de IVA a partir de los datos del Libro IVA Ventas y del
// Libro IVA Compras, y para PROYECTAR cuánto hace falta facturar de más para
// llegar a un objetivo.
//
// Conceptos (todos los montos en PESOS ARS, nativos — el IVA argentino se
// liquida siempre en pesos, independientemente del toggle USD/ARS del panel):
//
//   Débito Fiscal (DF)  = IVA de las VENTAS  (op. de ventas − notas de crédito)
//   Crédito Fiscal (CF) = IVA de las COMPRAS (op. de compras − notas de crédito)
//   Posición IVA        = DF − CF
//       · > 0  → IVA a pagar (impuesto determinado del período)
//       · < 0  → saldo TÉCNICO a favor (art. 24 Ley IVA): se arrastra al
//                período siguiente y sólo se puede usar contra DF futuro.
//
//   Saldo técnico a favor (anterior):   sólo compensa IVA (débitos) futuros.
//   Saldo de libre disponibilidad:      surge de retenciones/percepciones/pagos
//                                        a cuenta; se puede usar contra otros
//                                        impuestos o pedir su devolución.
//   Beneficio fiscal:                   según indicación del estudio contable,
//                                        30% de (DF − CF) SÓLO cuando DF > CF.
//                                        Configurable (beneficioRate).
//
// La lógica de aplicación (restar primero saldo técnico, luego libre
// disponibilidad, y contemplar el beneficio) sigue las reglas que pasó el
// estudio Carletta.
// =============================================================================

export const IVA_DEFAULTS = {
  alicuota: 0.21,          // alícuota general de IVA (21%)
  beneficioRate: 0.30,     // 30% s/ (DF − CF) cuando DF > CF
  targetRentabilidad: 20000000, // objetivo de rentabilidad mensual (ARS)
  margenRentabilidad: 0.20,     // margen supuesto p/ derivar facturación necesaria
};

// Redondeo contable a 2 decimales evitando el ruido binario de floats.
export function round2(n) {
  const x = Number(n);
  if (!isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

const num = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

// Estructura vacía de un período. `periodo` es 'YYYY-MM'.
export function emptyPeriodo(periodo = '') {
  return {
    id: '',
    periodo,
    // ---- Libro IVA Ventas ----
    ventasOpNeto: 0, ventasOpIva: 0,   // Operaciones de ventas
    ventasNcNeto: 0, ventasNcIva: 0,   // Notas de crédito de ventas (restan DF)
    exportaciones: 0,                  // Operaciones de exportación (no generan DF)
    ajustesDf: 0,                      // Ajustes al débito fiscal (+/−)
    // ---- Libro IVA Compras ----
    comprasOpNeto: 0, comprasOpIva: 0, // Operaciones de compras
    comprasNcNeto: 0, comprasNcIva: 0, // Notas de crédito de compras (restan CF)
    ajustesCf: 0,                      // Ajustes al crédito fiscal (+/−)
    // ---- Saldos del período anterior ----
    saldoTecnicoAnterior: 0,
    saldoLibreDispAnterior: 0,
    // ---- Parámetros ----
    alicuota: IVA_DEFAULTS.alicuota,
    beneficioRate: IVA_DEFAULTS.beneficioRate,
    targetRentabilidad: IVA_DEFAULTS.targetRentabilidad,
    margenRentabilidad: IVA_DEFAULTS.margenRentabilidad,
    // ---- Proyección (simulador de ventas adicionales, total con IVA) ----
    ventasAdicionalesTotal: 0,
    // ---- Meta ----
    nota: '',
    createdAt: 0,
    updatedAt: 0,
  };
}

// Suma de netos gravados de ventas y compras (para ratios/margen informativos).
export function netoVentas(p) {
  return round2(num(p.ventasOpNeto) - num(p.ventasNcNeto));
}
export function netoCompras(p) {
  return round2(num(p.comprasOpNeto) - num(p.comprasNcNeto));
}

// -----------------------------------------------------------------------------
// Núcleo: liquidación de la posición de IVA de un período.
// Devuelve TODOS los valores intermedios para que la UI arme la "cascada".
// -----------------------------------------------------------------------------
export function liquidar(p) {
  const df = round2(num(p.ventasOpIva) - num(p.ventasNcIva) + num(p.ajustesDf));
  const cf = round2(num(p.comprasOpIva) - num(p.comprasNcIva) + num(p.ajustesCf));
  const posicion = round2(df - cf); // >0 a pagar · <0 saldo técnico a favor

  const beneficioRate = num(p.beneficioRate) || 0;
  // El beneficio SÓLO se computa cuando DF > CF (posición a pagar).
  const beneficio = posicion > 0 ? round2(posicion * beneficioRate) : 0;

  const saldoTecAnt = num(p.saldoTecnicoAnterior);
  const saldoLdAnt = num(p.saldoLibreDispAnterior);

  let usadoTecnico = 0;
  let usadoLibreDisp = 0;
  let aPagarAntesBeneficio = 0;
  let saldoTecnicoGenerado = saldoTecAnt;   // remanente que se arrastra
  let saldoLibreDispRemanente = saldoLdAnt;

  if (posicion > 0) {
    // Hay impuesto determinado. Se compensa primero con saldo técnico anterior,
    // luego con saldo de libre disponibilidad.
    usadoTecnico = Math.min(posicion, saldoTecAnt);
    const r1 = round2(posicion - usadoTecnico);
    usadoLibreDisp = Math.min(r1, saldoLdAnt);
    aPagarAntesBeneficio = round2(r1 - usadoLibreDisp);
    saldoTecnicoGenerado = round2(saldoTecAnt - usadoTecnico);
    saldoLibreDispRemanente = round2(saldoLdAnt - usadoLibreDisp);
  } else {
    // Posición a favor: no se paga y el saldo técnico a favor CRECE.
    // (−posicion) es el excedente de CF sobre DF del período.
    saldoTecnicoGenerado = round2(saldoTecAnt + (-posicion));
    saldoLibreDispRemanente = saldoLdAnt; // intacto, no hay impuesto que compensar
  }

  // El beneficio actúa como crédito/reintegro sobre lo que quedaría a pagar.
  const aPagarNeto = round2(Math.max(0, aPagarAntesBeneficio - beneficio));

  return {
    df,
    cf,
    posicion,
    esAPagar: posicion > 0,
    beneficio,
    beneficioRate,
    saldoTecnicoAnterior: round2(saldoTecAnt),
    saldoLibreDispAnterior: round2(saldoLdAnt),
    usadoTecnico: round2(usadoTecnico),
    usadoLibreDisp: round2(usadoLibreDisp),
    aPagarAntesBeneficio,
    aPagarNeto,
    saldoTecnicoGenerado,
    saldoLibreDispRemanente,
    netoVentas: netoVentas(p),
    netoCompras: netoCompras(p),
  };
}

// -----------------------------------------------------------------------------
// Descomposición neto / IVA / total de un monto de ventas.
// -----------------------------------------------------------------------------
export function desdeTotal(total, alicuota = IVA_DEFAULTS.alicuota) {
  const t = num(total);
  const a = num(alicuota) || IVA_DEFAULTS.alicuota;
  const neto = round2(t / (1 + a));
  return { neto, iva: round2(t - neto), total: round2(t) };
}
export function desdeNeto(neto, alicuota = IVA_DEFAULTS.alicuota) {
  const n = num(neto);
  const a = num(alicuota) || IVA_DEFAULTS.alicuota;
  const iva = round2(n * a);
  return { neto: round2(n), iva, total: round2(n + iva) };
}

// -----------------------------------------------------------------------------
// Simulador: agrega `ventasAdicionalesTotal` (total con IVA) al Libro Ventas y
// devuelve la liquidación base vs. la proyectada, más el desglose de las ventas.
// -----------------------------------------------------------------------------
export function proyectar(p, ventasAdicionalesTotal) {
  const alic = num(p.alicuota) || IVA_DEFAULTS.alicuota;
  const desg = desdeTotal(ventasAdicionalesTotal, alic);
  const base = liquidar(p);
  const clone = {
    ...p,
    ventasOpNeto: round2(num(p.ventasOpNeto) + desg.neto),
    ventasOpIva: round2(num(p.ventasOpIva) + desg.iva),
  };
  const proyectado = liquidar(clone);
  return {
    ventas: desg,          // { neto, iva, total }
    base,
    proyectado,
    // Cuánto falta todavía para NEUTRALIZAR el saldo a favor (llevar posición a 0).
    faltaParaNeutralizar: proyectado.posicion < 0 ? round2(-proyectado.posicion) : 0,
  };
}

// -----------------------------------------------------------------------------
// Objetivo inverso: ventas adicionales (neto / IVA / total) necesarias para que
// la POSICIÓN del período llegue a `targetPosicion` (default 0 = neutralizar).
//   posicion' = (DF + ivaAdic) − CF = targetPosicion
//   ivaAdic   = targetPosicion − posicionActual
// -----------------------------------------------------------------------------
export function ventasParaPosicion(p, targetPosicion = 0) {
  const alic = num(p.alicuota) || IVA_DEFAULTS.alicuota;
  const { posicion } = liquidar(p);
  const ivaAdic = round2(num(targetPosicion) - posicion);
  if (ivaAdic <= 0) {
    return { alcanzable: true, yaCumplido: true, neto: 0, iva: 0, total: 0 };
  }
  const neto = round2(ivaAdic / alic);
  return { alcanzable: true, yaCumplido: false, neto, iva: ivaAdic, total: round2(neto + ivaAdic) };
}

// -----------------------------------------------------------------------------
// Objetivo inverso: ventas adicionales para llegar a un BENEFICIO fiscal target.
//   beneficio = rate × posicion'  ⇒  posicion' = target / rate
//   (requiere rate > 0; la posición proyectada debe ser a pagar, DF>CF)
// -----------------------------------------------------------------------------
export function ventasParaBeneficio(p, targetBeneficio) {
  const rate = num(p.beneficioRate);
  if (rate <= 0) return { alcanzable: false, neto: 0, iva: 0, total: 0 };
  const targetPos = round2(num(targetBeneficio) / rate);
  return { ...ventasParaPosicion(p, targetPos), posicionObjetivo: targetPos };
}

// -----------------------------------------------------------------------------
// Rentabilidad: dado un objetivo de ganancia mensual y un margen supuesto,
// deriva la facturación NETA necesaria y su impacto en IVA.
//   facturacionNeta = objetivo / margen
// -----------------------------------------------------------------------------
export function facturacionParaRentabilidad(objetivo, margen, alicuota = IVA_DEFAULTS.alicuota) {
  const m = num(margen);
  if (m <= 0) return { neto: 0, iva: 0, total: 0, margen: 0 };
  const neto = round2(num(objetivo) / m);
  const desg = desdeNeto(neto, alicuota);
  return { ...desg, margen: m };
}

// -----------------------------------------------------------------------------
// Formateo de pesos ARS nativo (independiente del toggle de moneda del panel).
//   1234567.8 → "$1.234.567,80"   ·   sinDecimales → "$1.234.568"
// -----------------------------------------------------------------------------
export function fmtARS(n, { decimales = 2, signo = false } = {}) {
  const x = num(n);
  const s = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(Math.abs(x));
  const sign = x < 0 ? '−' : (signo && x > 0 ? '+' : '');
  return `${sign}$${s}`;
}

// Parseo tolerante de un número tipeado a la argentina ("1.234.567,89",
// "$ 29.402.214,81", "68772,5") o a la inglesa. Devuelve Number o 0.
export function parseARS(input) {
  if (typeof input === 'number') return isFinite(input) ? input : 0;
  let s = String(input == null ? '' : input).trim();
  if (!s) return 0;
  s = s.replace(/[^\d.,-]/g, ''); // saca "$", espacios, etc.
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // El último separador es el decimal; el otro es de miles.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.'); // formato es-AR
    } else {
      s = s.replace(/,/g, ''); // formato en-US
    }
  } else if (hasComma) {
    s = s.replace(',', '.'); // coma = decimal
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}
