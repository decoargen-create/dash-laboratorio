// Fechas comerciales para el modo "evento" de generación de creativos.
// La clave viaja al backend (crear-creativo-referencial), que reangula la
// estrategia + el visual hacia la ocasión: eventos de REGALO (Día de la
// Madre, Navidad…) posicionan el producto como regalo para esa persona
// manteniendo sus pain points reales; eventos de OFERTA (BlackFriday,
// CyberMonday…) van a urgencia + descuento usando SOLO las ofertas reales.
// Compartido por Inspiración (ads evergreen de referencia) y la Galería
// (iterar/regenerar sobre creativos ya generados).
export const EVENTOS_FECHA = [
  { key: '',             label: 'Sin evento (evergreen)' },
  { key: 'dia_madre',    label: '💐 Día de la Madre' },
  { key: 'dia_padre',    label: '👔 Día del Padre' },
  { key: 'dia_nino',     label: '🧸 Día del Niño' },
  { key: 'san_valentin', label: '❤️ San Valentín' },
  { key: 'hot_sale',     label: '🔥 Hot Sale' },
  { key: 'cyber_monday', label: '💻 CyberMonday' },
  { key: 'black_friday', label: '🖤 BlackFriday' },
  { key: 'navidad',      label: '🎄 Navidad' },
  { key: 'ano_nuevo',    label: '🎆 Año Nuevo' },
  { key: 'reyes',        label: '👑 Reyes' },
];

// Etiquetas de TIPO de tanda para las tarjetas de Producción (además de las
// fechas comerciales de arriba): dicen de DÓNDE sale la consigna. No viajan
// al generador de creativos — son organización del tablero nada más.
export const ETIQUETAS_TANDA = [
  { key: 'instagram', label: '📸 Instagram' },  // sale de referencias de IG que cargó el admin
  { key: 'winners',   label: '⭐ Winners' },     // tanda para replicar los winners actuales
  { key: 'ugc',       label: '🎥 UGC' },
  { key: 'diversificacion', label: '🧪 Diversificación' },
  { key: 'evergreen', label: '🌿 Evergreen' },
];

export function eventoLabel(key) {
  return EVENTOS_FECHA.find(e => e.key === key)?.label || key || '';
}
