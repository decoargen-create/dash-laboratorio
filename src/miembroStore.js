// Membresía de la cuenta logueada — CUENTAS POR ÁREA.
//
// Un "miembro" es una cuenta creada por un dueño con acceso a ciertas áreas
// del tablero del dueño ("solamente producción", "solamente estáticos"...),
// igual que las cuentas de editores pero a nivel secciones. La fila vive en
// cuenta_miembros (migración 0042) y sus policies le abren las filas del
// dueño según el área.
//
// Los stores de datos usan ownerEfectivo(): para un miembro devuelve el uuid
// del DUEÑO, así los pulls filtran y los pushes escriben las filas del dueño
// (la RLS lo permite). Para una cuenta normal devuelve su propio id.

export const AREAS = [
  { key: 'metricas',  label: 'Métricas y Meta Ads',   desc: 'Testeos semanales, métricas, embudo y campañas' },
  { key: 'productos', label: 'Productos y estáticos',  desc: 'Workspace de productos: estáticos, inspiración, competencia' },
  { key: 'produccion', label: 'Producción',            desc: 'Tablero del área creativa: tarjetas, videos, winners' },
  { key: 'landings',  label: 'Landings',               desc: 'Páginas y su seguimiento' },
];

let _membresia = null; // { ownerId, areas: [] } | null

export function setMembresia(m) {
  _membresia = m && m.ownerId ? { ownerId: m.ownerId, areas: Array.isArray(m.areas) ? m.areas : [] } : null;
}
export function getMembresia() { return _membresia; }
export function esMiembro() { return !!_membresia; }

// uuid "dueño de los datos" para pulls/pushes: el dueño si soy miembro, yo si no.
export function ownerEfectivo(userId) { return _membresia?.ownerId || userId || null; }

// ¿La cuenta actual puede ver esta área? (una cuenta normal ve todo)
export function tieneArea(area) {
  return !_membresia || (_membresia.areas || []).includes(area);
}
