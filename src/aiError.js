// Traduce errores CRUDOS de las APIs de IA (Anthropic / OpenAI) a mensajes
// claros y accionables para el usuario, en vez de volcar el JSON de la API.
export function friendlyAIError(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'motivo desconocido';
  if (s.includes('credit balance is too low') || s.includes('purchase credits') || s.includes('plans & billing') || (s.includes('credit') && s.includes('too low'))) {
    return 'sin saldo en la API de Anthropic — cargá crédito en console.anthropic.com (Settings → Billing)';
  }
  if (s.includes('rate limit') || s.includes('429') || s.includes('overloaded')) {
    return 'la API de IA está saturada en este momento — reintentá en un rato';
  }
  if ((s.includes('api key') && (s.includes('invalid') || s.includes('incorrect'))) || s.includes('authentication_error') || s.includes('401')) {
    return 'la API key de IA no es válida — hay que revisar la config';
  }
  if (s.includes('timeout') || s.includes('timed out') || s.includes('aborted')) {
    return 'la IA tardó demasiado — reintentá';
  }
  // Fallback: una línea, recortada (nunca el JSON gigante).
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, 140);
}
