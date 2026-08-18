// Lógica PURA de Producción (sin estado, sin nube, sin DOM). Vive acá para que
// tanto la app como los tests la importen — así los tests prueban el código real
// y no una copia que puede quedar desincronizada.

export const PAGO_POR_PRODUCTO = 42000;   // ARS por producto completo y aprobado
export const VIDEOS_POR_PRODUCTO = 9;     // objetivo de videos por tarjeta
export const DEFAULT_BONUS_TRAMOS = [{ min: 3, monto: 24000 }, { min: 4, monto: 30000 }, { min: 5, monto: 36000 }];

// Bonus por objetivo semanal por defecto (productos COMPLETADOS en la semana).
export function bonusObjetivo(completados) {
  if (completados >= 5) return 36000;
  if (completados === 4) return 30000;
  if (completados === 3) return 24000;
  return 0;
}

// Monto por producto de una config de persona (o el default si no tiene).
export function pagoProductoDeCfg(cfg) {
  return Number.isFinite(cfg?.pagoProducto) ? cfg.pagoProducto : PAGO_POR_PRODUCTO;
}

// Bonus de una persona según sus completados de la semana. Sin config → default
// global; con config → el tramo más alto que alcanzó (0 si no tiene tramos).
export function bonusDeCfg(cfg, completados) {
  if (!cfg) return bonusObjetivo(completados);
  const tramos = Array.isArray(cfg.bonusTramos) ? cfg.bonusTramos : [];
  let monto = 0;
  for (const t of tramos) { if (completados >= (t.min || 0)) monto = Math.max(monto, t.monto || 0); }
  return monto;
}

// Numera los duplicados del mismo producto en la misma semana → { id: n } (solo
// si hay 2+). Diferencia "Cepillo #1 / #2 / #3" asignados a la misma persona.
export function numerarDuplicados(cards) {
  const groups = {};
  for (const a of (cards || [])) {
    const k = `${a.weekKey}|${(a.productoNombre || '').trim().toLowerCase()}`;
    (groups[k] = groups[k] || []).push(a);
  }
  const out = {};
  for (const k in groups) {
    const arr = groups[k].slice().sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')));
    if (arr.length > 1) arr.forEach((a, i) => { out[a.id] = i + 1; });
  }
  return out;
}

// Resumen por producto: VIDEOS (subidos vs. objetivo de 9 por tarjeta) y TARJETAS
// (cuántas entregadas —publicadas— vs. cuántas faltan entregar). Devuelve
// [{ producto, subidos, target, faltan, tarjetas, entregadas, pendientes }]
// ordenado por tarjetas pendientes desc (lo que más falta, primero).
export function resumenVideosPorProducto(cards) {
  const by = {};
  for (const a of (cards || [])) {
    const nombre = (a.productoNombre || '').trim() || 'Sin nombre';
    const k = nombre.toLowerCase();
    if (!by[k]) by[k] = { producto: nombre, subidos: 0, target: 0, tarjetas: 0, entregadas: 0 };
    by[k].subidos += (a.archivos?.length || 0);
    by[k].target += VIDEOS_POR_PRODUCTO;
    by[k].tarjetas++;
    if (a.estado === 'publicado') by[k].entregadas++;   // entregada = publicada
  }
  return Object.values(by)
    .map(x => ({ ...x, faltan: Math.max(0, x.target - x.subidos), pendientes: x.tarjetas - x.entregadas }))
    .sort((x, y) => y.pendientes - x.pendientes || y.faltan - x.faltan || x.producto.localeCompare(y.producto, 'es'));
}
