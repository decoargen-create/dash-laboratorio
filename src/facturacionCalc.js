// Lógica pura de la sección Facturación (Viora → Finanzas).
// Sin React ni DOM: recibe sales/clients y devuelve datos listos para
// renderizar o exportar. Testeada en tests/logic.test.mjs con el código
// real que se shipea, igual que produccionCalc.js.

// Clave de mes de una fecha 'YYYY-MM-DD' → 'YYYY-MM'. Tolerante a null.
export function mesKey(fecha) {
  const s = String(fecha || '');
  return /^\d{4}-\d{2}/.test(s) ? s.substring(0, 7) : '';
}

// Primer mes de una ventana de `meses` meses calendario que termina en
// `hoy` (incluye el mes actual). Ej: hoy=2025-09-03, meses=11 → '2024-11'.
// "Comprobantes emitidos de acá once meses para atrás".
export function inicioVentana(hoy, meses) {
  const d = hoy instanceof Date ? hoy : new Date(`${hoy}T00:00:00`);
  const total = d.getFullYear() * 12 + d.getMonth() - (Math.max(1, meses) - 1);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Lista de claves de mes entre dos claves inclusive: ['2024-11', ..., '2025-09'].
export function listaMeses(desdeKey, hastaKey) {
  if (!desdeKey || !hastaKey || desdeKey > hastaKey) return [];
  const out = [];
  let [y, m] = desdeKey.split('-').map(Number);
  const [hy, hm] = hastaKey.split('-').map(Number);
  while (y < hy || (y === hy && m <= hm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Estados donde la orden ya representa plata comprometida/facturada.
// Consultas y cotizaciones no cuentan cuando el filtro está activo.
export const ESTADOS_FACTURABLES = ['abonado', 'en-produccion', 'listo-enviar', 'despachado'];

// Filtra comprobantes por ventana de meses (claves 'YYYY-MM') y,
// opcionalmente, solo estados facturables. desdeKey null = sin piso.
export function comprobantesEnVentana(sales, { desdeKey = null, hastaKey = null, soloFacturables = false } = {}) {
  return (sales || []).filter(o => {
    const k = mesKey(o?.fecha);
    if (!k) return false;
    if (desdeKey && k < desdeKey) return false;
    if (hastaKey && k > hastaKey) return false;
    if (soloFacturables && !ESTADOS_FACTURABLES.includes(o?.estado)) return false;
    return true;
  });
}

// Serie mensual { mes, total, cantidad } ordenada. Si se pasa la ventana,
// rellena los meses sin movimiento con 0 para que el chart no "saltee".
export function reporteMensual(sales, { desdeKey = null, hastaKey = null } = {}) {
  const acc = {};
  (sales || []).forEach(o => {
    const k = mesKey(o?.fecha);
    if (!k) return;
    if (!acc[k]) acc[k] = { total: 0, cantidad: 0 };
    acc[k].total += Number(o?.montoTotal) || 0;
    acc[k].cantidad += 1;
  });
  const keys = (desdeKey && hastaKey)
    ? listaMeses(desdeKey, hastaKey)
    : Object.keys(acc).sort();
  return keys.map(k => ({ mes: k, total: acc[k]?.total || 0, cantidad: acc[k]?.cantidad || 0 }));
}

// Histórico por cliente: total, cantidad de comprobantes y última fecha,
// ordenado por total desc. Clientes sin nombre caen como "Cliente #id".
export function reportePorCliente(sales, clients) {
  const byId = {};
  (sales || []).forEach(o => {
    const id = o?.clienteId;
    if (id == null) return;
    if (!byId[id]) byId[id] = { clienteId: id, total: 0, cantidad: 0, ultimaFecha: '' };
    byId[id].total += Number(o?.montoTotal) || 0;
    byId[id].cantidad += 1;
    if ((o?.fecha || '') > byId[id].ultimaFecha) byId[id].ultimaFecha = o.fecha;
  });
  return Object.values(byId)
    .map(row => {
      const cliente = (clients || []).find(c => c?.id === row.clienteId);
      return { ...row, nombre: cliente?.nombre || `Cliente #${row.clienteId}` };
    })
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
}

// Disponible contra un tope de facturación por cliente. tope null/0 = sin
// tope configurado (restante null, sin alerta).
export function topeRestante(totalHistorico, tope) {
  const t = Number(tope) || 0;
  if (t <= 0) return { tope: null, restante: null, pctUsado: null, excedido: false };
  const total = Number(totalHistorico) || 0;
  const restante = t - total;
  return {
    tope: t,
    restante,
    pctUsado: Math.min(999, Math.round((total / t) * 100)),
    excedido: restante < 0,
  };
}

const fmtAR = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

// Texto plano listo para pegar en un mail: total global + una línea por
// cliente con su concepto ("Con Fulana — Comercial: $X (N comprobantes)").
// conceptos: { [clienteId]: 'Comercial' | ... }.
export function resumenParaMail({ titulo, porCliente, conceptos = {}, totalGeneral, cantidadGeneral }) {
  const lineas = [];
  if (titulo) lineas.push(titulo, '');
  lineas.push(`Total facturado: ${fmtAR(totalGeneral)} (${cantidadGeneral || 0} comprobantes)`);
  lineas.push('');
  (porCliente || []).forEach(row => {
    const concepto = String(conceptos[row.clienteId] || 'Comercial').trim() || 'Comercial';
    lineas.push(`Con ${row.nombre} — ${concepto}: ${fmtAR(row.total)} (${row.cantidad} ${row.cantidad === 1 ? 'comprobante' : 'comprobantes'})`);
  });
  return lineas.join('\n');
}
