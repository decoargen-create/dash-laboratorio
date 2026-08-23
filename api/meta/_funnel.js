// Matemática del embudo de compra — módulo puro (sin red ni env) para que
// los tests puedan importarlo tal cual se shipea. Lo consume
// /api/meta/funnel-insights (ver [action].js).

// Busca un action_type en el array `actions` de Meta probando varios alias
// en orden de preferencia. Meta reporta el mismo evento con más de un
// nombre (el genérico `add_to_cart` agrega web + app + onsite; el
// `offsite_conversion.fb_pixel_add_to_cart` es solo pixel web). Tomamos el
// PRIMERO que exista — nunca los sumamos, porque se solapan.
export function pickAction(list, types) {
  for (const t of types) {
    const hit = (list || []).find(a => a.action_type === t);
    if (hit) return Number(hit.value || 0);
  }
  return 0;
}

export const ACTION_ALIASES = {
  linkClicks: ['link_click'],
  landingPageViews: ['landing_page_view', 'offsite_conversion.fb_pixel_view_content'],
  addToCart: ['add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart', 'onsite_web_add_to_cart'],
  initiateCheckout: ['initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout', 'onsite_web_initiate_checkout'],
  purchases: ['purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'],
};

// Ratios y costos derivados del embudo. Separado de parseFunnel porque los
// totales de la cuenta los recalculan sobre las sumas, no sobre promedios.
export function deriveFunnelRates(f) {
  const pct = (num, den) => (den > 0 ? (num / den) * 100 : 0);
  const cost = (spend, n) => (n > 0 ? spend / n : 0);
  return {
    // Ratios de paso a paso — "de los que llegaron acá, cuántos siguieron".
    linkCtr: pct(f.linkClicks, f.impressions),
    lpvRate: pct(f.landingPageViews, f.linkClicks),
    atcRate: pct(f.addToCart, f.landingPageViews),
    checkoutRate: pct(f.initiateCheckout, f.addToCart),
    purchaseRate: pct(f.purchases, f.initiateCheckout),
    // Conversión global: de cada 100 que clickearon el anuncio, cuántos compraron.
    conversionRate: pct(f.purchases, f.linkClicks),
    // Costos por paso.
    costPerLinkClick: cost(f.spend, f.linkClicks),
    costPerLpv: cost(f.spend, f.landingPageViews),
    costPerAtc: cost(f.spend, f.addToCart),
    costPerCheckout: cost(f.spend, f.initiateCheckout),
    cpa: cost(f.spend, f.purchases),
    // Plata.
    roas: f.spend > 0 ? f.revenue / f.spend : 0,
    aov: f.purchases > 0 ? f.revenue / f.purchases : 0,
  };
}

// Convierte una fila cruda de /insights en el objeto de embudo que consume
// la UI. `inline_link_clicks` es el conteo de clicks al enlace que Meta
// expone como field propio; si viniera vacío caemos al action `link_click`.
export function parseFunnel(row) {
  if (!row) return null;
  const actions = row.actions || [];
  const values = row.action_values || [];

  const linkClicks = Number(row.inline_link_clicks || 0) ||
    pickAction(actions, ACTION_ALIASES.linkClicks);

  const base = {
    spend: Number(row.spend || 0),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    reach: Number(row.reach || 0),
    frequency: Number(row.frequency || 0),
    cpm: Number(row.cpm || 0),
    cpc: Number(row.cpc || 0),
    ctr: Number(row.ctr || 0),
    linkClicks,
    landingPageViews: pickAction(actions, ACTION_ALIASES.landingPageViews),
    addToCart: pickAction(actions, ACTION_ALIASES.addToCart),
    initiateCheckout: pickAction(actions, ACTION_ALIASES.initiateCheckout),
    purchases: pickAction(actions, ACTION_ALIASES.purchases),
    revenue: pickAction(values, ACTION_ALIASES.purchases),
  };

  return { ...base, ...deriveFunnelRates(base) };
}
