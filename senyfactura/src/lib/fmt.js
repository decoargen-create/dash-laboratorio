export const money = (n) =>
  '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const CBTE = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' }

export function fechaAfip(s) {
  if (!s || s.length !== 8) return s || ''
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`
}

export const REGIMEN_LABEL = { RI: 'Responsable Inscripto', MONO: 'Monotributo' }
