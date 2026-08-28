// Entorno de prueba de Testeos — datos de ejemplo, deterministas.
//
// Sirve para dos cosas a la vez:
//   1. Los tests corren contra estos datos (así se prueba el código real).
//   2. La UI puede mostrarse en "modo demo" sin cuenta de Meta conectada, para
//      revisar el tablero y discutir la forma antes de enchufar datos reales.
//
// Los nombres de campaña son los REALES de la cuenta (sacados de una captura
// del Ads Manager), no inventados: es lo único que hace creíble la prueba de
// la clasificación por nomenclatura.
//
// Nada de Math.random ni de new Date() acá adentro: los números son fijos para
// que un test que pasa hoy pase mañana.

// Fecha de referencia del set de ejemplo (miércoles 26/8/2026).
export const HOY_DEMO = new Date('2026-08-26T15:00:00Z'); // 12:00 en Argentina

// Insights de una campaña/anuncio, en el shape normalizado que devuelve el
// backend: montos en la moneda de la cuenta (acá ARS).
function ins({ spend, impressions, reach, clicks, purchases, revenue, addToCart, initiateCheckout }) {
  const o = {
    spend, impressions, reach, clicks, purchases, revenue,
    addToCart, initiateCheckout,
  };
  o.roas = spend > 0 ? revenue / spend : 0;
  o.cpa = purchases > 0 ? spend / purchases : 0;
  o.frequency = reach > 0 ? impressions / reach : 0;
  return o;
}

// ── Campañas (acumulado de su vida) ─────────────────────────────────────
export const CAMPANAS_DEMO = [
  // Semana del 17/8 — la última cerrada. 3 testeos, 1 ganador.
  {
    id: '120247978049140543', name: 'Cepillo 22/8 [CBO Videos]', effectiveStatus: 'ACTIVE',
    dailyBudget: 60000,
    insights: ins({ spend: 88000, impressions: 412000, reach: 305000, clicks: 5100, purchases: 12, revenue: 227700, addToCart: 96, initiateCheckout: 41 }),
  },
  {
    id: '120247978049140544', name: 'Cepillo 20/8 [CBO Estaticos]', effectiveStatus: 'PAUSED',
    dailyBudget: 35000,
    insights: ins({ spend: 61000, impressions: 288000, reach: 210000, clicks: 2900, purchases: 3, revenue: 58000, addToCart: 44, initiateCheckout: 12 }),
  },
  {
    id: '120247978049140545', name: 'Crema 19/8 [CBO Video UGC]', effectiveStatus: 'PAUSED',
    dailyBudget: 30000,
    // Cortada a las horas: no tuvo chance. NO debe contar como perdedora.
    insights: ins({ spend: 2400, impressions: 640, reach: 600, clicks: 12, purchases: 0, revenue: 0, addToCart: 1, initiateCheckout: 0 }),
  },

  // Semana del 3/8 — 2 testeos, 1 ganador.
  {
    id: '120248240474140543', name: 'Cepillo 3/8 [CBO Estaticos ADSLAB]', effectiveStatus: 'ACTIVE',
    dailyBudget: 35000,
    insights: ins({ spend: 54400, impressions: 301000, reach: 244000, clicks: 3800, purchases: 18, revenue: 308300, addToCart: 121, initiateCheckout: 66 }),
  },
  {
    id: '120248240474140544', name: 'Crema 6/8 [CBO Videos]', effectiveStatus: 'PAUSED',
    dailyBudget: 40000,
    insights: ins({ spend: 77000, impressions: 356000, reach: 262000, clicks: 3100, purchases: 5, revenue: 96000, addToCart: 52, initiateCheckout: 18 }),
  },

  // Semana del 27/7 — 1 testeo perdedor.
  {
    id: '120248173812940543', name: 'TIVA 31/7 [CBO Videos Flor]', effectiveStatus: 'PAUSED',
    dailyBudget: 101000,
    insights: ins({ spend: 123300, impressions: 502000, reach: 366000, clicks: 4200, purchases: 4, revenue: 52700, addToCart: 61, initiateCheckout: 20 }),
  },

  // Semana del 20/7 — 1 testeo ganador.
  {
    id: '120247951737710543', name: 'Crema 23/7 [CBO Video UGC 2]', effectiveStatus: 'ACTIVE',
    dailyBudget: 45000,
    insights: ins({ spend: 70700, impressions: 333000, reach: 251000, clicks: 4400, purchases: 21, revenue: 198000, addToCart: 133, initiateCheckout: 74 }),
  },

  // ── Las que NO son testeo: escala y otras. No entran en la eficiencia. ──
  {
    id: '120248079718460543', name: 'Cepillo 27/7 [ABO BIDCAP 25 a 35]', effectiveStatus: 'ACTIVE',
    dailyBudget: null,
    insights: ins({ spend: 1200000, impressions: 5100000, reach: 2400000, clicks: 41000, purchases: 260, revenue: 2100000, addToCart: 1900, initiateCheckout: 820 }),
  },
  {
    id: '120248294014390543', name: 'Cepillo 5/8 [ABO Costcap 15 a 24]', effectiveStatus: 'ACTIVE',
    dailyBudget: null,
    insights: ins({ spend: 819600, impressions: 3600000, reach: 1700000, clicks: 28000, purchases: 175, revenue: 1500000, addToCart: 1300, initiateCheckout: 590 }),
  },
  {
    id: '120235653821420543', name: 'Crema [ABO BIDCAP 29 A 39]', effectiveStatus: 'ACTIVE',
    dailyBudget: null,
    insights: ins({ spend: 253600, impressions: 1100000, reach: 640000, clicks: 8900, purchases: 52, revenue: 435600, addToCart: 410, initiateCheckout: 180 }),
  },
  {
    id: '120227386451670543', name: 'Nueva campaña de Interacción', effectiveStatus: 'ACTIVE',
    dailyBudget: null,
    insights: ins({ spend: 11400, impressions: 90000, reach: 71000, clicks: 1900, purchases: 0, revenue: 0, addToCart: 0, initiateCheckout: 0 }),
  },
];

// ── Anuncios de HOY (para la ronda de optimización) ─────────────────────
// Promedios de la cuenta que salen de este set:
//   costo por carrito   = 128.900 ÷ 63  ≈ 2.046
//   costo por checkout  = 128.900 ÷ 26  ≈ 4.958
export const ADS_HOY_DEMO = [
  {
    id: 'ad_1', name: 'Cepillo — UGC hook piso mojado', campaignId: '120247978049140543',
    campaignName: 'Cepillo 22/8 [CBO Videos]', effectiveStatus: 'ACTIVE', dailyBudget: 60000,
    insights: ins({ spend: 41000, impressions: 96000, reach: 78000, clicks: 1400, purchases: 6, revenue: 128000, addToCart: 28, initiateCheckout: 14 }),
  },
  {
    // Candidato claro: gastó, ROAS bajo, y sus costos por carrito/checkout
    // están muy por encima del promedio. Le queda mucho presupuesto → pausar.
    id: 'ad_2', name: 'Cepillo — estático precio', campaignId: '120247978049140544',
    campaignName: 'Cepillo 20/8 [CBO Estaticos]', effectiveStatus: 'ACTIVE', dailyBudget: 50000,
    insights: ins({ spend: 31000, impressions: 88000, reach: 70000, clicks: 700, purchases: 1, revenue: 21000, addToCart: 6, initiateCheckout: 2 }),
  },
  {
    // Mismo diagnóstico pero ya consumió el 96% del presupuesto: pausarlo no
    // ahorra nada → "dejalo correr".
    id: 'ad_3', name: 'Crema — testimonial largo', campaignId: '120248240474140544',
    campaignName: 'Crema 6/8 [CBO Videos]', effectiveStatus: 'ACTIVE', dailyBudget: 30000,
    insights: ins({ spend: 28900, impressions: 71000, reach: 58000, clicks: 520, purchases: 1, revenue: 19000, addToCart: 5, initiateCheckout: 1 }),
  },
  {
    // Recién arrancó: gastó poco. NO tiene que aparecer como candidato.
    id: 'ad_4', name: 'Crema — hook nuevo 26/8', campaignId: '120248240474140544',
    campaignName: 'Crema 6/8 [CBO Videos]', effectiveStatus: 'ACTIVE', dailyBudget: 30000,
    insights: ins({ spend: 4200, impressions: 9000, reach: 8600, clicks: 90, purchases: 0, revenue: 0, addToCart: 1, initiateCheckout: 0 }),
  },
  {
    // Anda bien: ROAS alto. Nunca candidato.
    id: 'ad_5', name: 'Cepillo — antes y después', campaignId: '120248240474140543',
    campaignName: 'Cepillo 3/8 [CBO Estaticos ADSLAB]', effectiveStatus: 'ACTIVE', dailyBudget: 35000,
    insights: ins({ spend: 23800, impressions: 61000, reach: 52000, clicks: 980, purchases: 9, revenue: 154000, addToCart: 23, initiateCheckout: 9 }),
  },
];

// ── Anuncios de los últimos 7 días (para prospectadores) ────────────────
export const ADS_7D_DEMO = [
  {
    // Prospectador de manual: frecuencia 1.04, alcance grande, vende bien.
    id: 'ad_5', name: 'Cepillo — antes y después', campaignName: 'Cepillo 3/8 [CBO Estaticos ADSLAB]',
    effectiveStatus: 'ACTIVE',
    insights: ins({ spend: 154000, impressions: 421000, reach: 405000, clicks: 6100, purchases: 47, revenue: 690000, addToCart: 158, initiateCheckout: 71 }),
  },
  {
    // Vende bien pero está quemando la misma audiencia (frecuencia 2.6).
    id: 'ad_6', name: 'Cepillo — UGC piso mojado', campaignName: 'Cepillo 22/8 [CBO Videos]',
    effectiveStatus: 'ACTIVE',
    insights: ins({ spend: 210000, impressions: 690000, reach: 265000, clicks: 8200, purchases: 52, revenue: 610000, addToCart: 190, initiateCheckout: 88 }),
  },
  {
    // Frecuencia baja pero no vende: llega a gente nueva y no convierte.
    id: 'ad_7', name: 'Crema — hook precio', campaignName: 'Crema 6/8 [CBO Videos]',
    effectiveStatus: 'ACTIVE',
    insights: ins({ spend: 96000, impressions: 240000, reach: 233000, clicks: 2100, purchases: 3, revenue: 41000, addToCart: 29, initiateCheckout: 8 }),
  },
  {
    // Frecuencia baja y buen ROAS, pero alcance chico: todavía no probó nada.
    id: 'ad_8', name: 'Crema — UGC nuevo', campaignName: 'Crema 23/7 [CBO Video UGC 2]',
    effectiveStatus: 'ACTIVE',
    insights: ins({ spend: 8000, impressions: 900, reach: 880, clicks: 40, purchases: 2, revenue: 26000, addToCart: 4, initiateCheckout: 3 }),
  },
];

// Productos tal como ya están cargados en AdsLab.
export const PRODUCTOS_DEMO = [
  { id: 'p-cepillo', nombre: 'Cepillo Drenaje Linfatico' },
  { id: 'p-crema', nombre: 'Crema Facial' },
  { id: 'p-tiva', nombre: 'TIVA' },
  { id: 'p-kit', nombre: 'Kit Inicial' },
];

// Perfil de ejemplo de una tienda: margen por producto → ROAS de equilibrio
// distinto para cada uno. Es lo que hace que la misma herramienta sirva para
// otra tienda sin tocar código.
export const PERFIL_DEMO = {
  moneda: 'ARS',
  margenPct: 45,
  pisoGastoPausar: 25000,
  porProducto: {
    // El equipo anota el ROAS de equilibrio de cada producto a mano.
    'p-cepillo': { roasBreakeven: 1.9 },
    'p-crema': { roasBreakeven: 2.6 },
    // Este no tiene el breakeven anotado pero sí el margen: se deriva solo.
    'p-tiva': { margenPct: 38 },
  },
};

export const DEMO = {
  hoy: HOY_DEMO,
  campanas: CAMPANAS_DEMO,
  adsHoy: ADS_HOY_DEMO,
  ads7d: ADS_7D_DEMO,
  productos: PRODUCTOS_DEMO,
  perfil: PERFIL_DEMO,
};
