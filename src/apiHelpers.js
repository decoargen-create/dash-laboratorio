// Helpers para llamadas a las APIs internas. Centralizamos parsing y
// detección de errores conocidos así no se duplican entre componentes.

export function stringifyApiError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    if (err.message) return String(err.message);
    if (err.error) return stringifyApiError(err.error);
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

// Parsea la respuesta defendiéndose de:
// - HTML/texto en vez de JSON (504 Vercel timeout, errores de gateway)
// - Errores conocidos de OpenAI/Anthropic con mensajes legibles
// - Status codes inesperados
export async function parseJsonOrThrow(resp, contexto = 'API') {
  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    if (resp.status === 504 || /timeout/i.test(raw) || /An error occurred with your deployment/i.test(raw)) {
      throw new Error(`${contexto} timeout — la operación tardó más que el límite del servidor. Reintentá con menos ads seleccionados o quality medium.`);
    }
    if (resp.status >= 500) {
      throw new Error(`${contexto} error ${resp.status} — el servidor devolvió HTML/texto en vez de JSON. Probá de nuevo en unos segundos.`);
    }
    throw new Error(`${contexto} respuesta inválida (HTTP ${resp.status}): ${raw.slice(0, 120)}`);
  }
  const errStr = stringifyApiError(data?.error).toLowerCase();
  if (errStr.includes('safety system') || errStr.includes('content policy') || errStr.includes('rejected by the safety')) {
    throw new Error(`OpenAI rechazó por su safety filter — probá con OTRO ad de referencia. Triggers comunes: contenido íntimo explícito, claims médicos fuertes, palabras gatillo. El producto/marca no es el problema, es el ad ref.`);
  }
  if (errStr.includes('rate limit') || errStr.includes('too many requests')) {
    throw new Error(`OpenAI rate limit — reintentá en 20-30s con menos ads en paralelo.`);
  }
  return data;
}
