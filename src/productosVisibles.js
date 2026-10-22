// Productos que no se muestran en la plataforma (pedido 22/10: "los de Vito
// sacalos todos"). NO se borran: siguen guardados con todo su historial y
// para volver a verlos alcanza con sacar el nombre de esta lista.
const RESPONSABLES_OCULTOS = ['vito'];

export function productoVisible(p) {
  const r = String(p?.responsable || '').trim().toLowerCase();
  return !RESPONSABLES_OCULTOS.includes(r);
}

export function soloVisibles(productos) {
  return (Array.isArray(productos) ? productos : []).filter(productoVisible);
}
