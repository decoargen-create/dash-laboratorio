// Prender y pausar entidades de Meta — la parte que se puede razonar sin red.
//
// Este es el primer endpoint de AdsLab que ESCRIBE en la cuenta publicitaria.
// Todo lo demás lee. Por eso la validación vive acá, en un módulo puro y
// testeado, en vez de estar desparramada en el handler: lo que se le manda a
// Meta tiene que ser exactamente lo que se quiso mandar.
//
// Dos candados, los dos a propósito:
//
//   1. Solo ACTIVE y PAUSED. Meta acepta DELETED y ARCHIVED en el mismo campo
//      `status`, y un typo ahí no se deshace con otro click: borra la campaña
//      y su historial. Si algún día hace falta archivar, va a ser otro
//      endpoint con su propia confirmación, no un valor más de esta lista.
//
//   2. Tope de entidades por pedido. Una pausada masiva por accidente (un
//      filtro que devolvió media cuenta) apaga la facturación del día. Con
//      tope, el error más caro posible son 25 campañas.

export const ESTADOS = ['ACTIVE', 'PAUSED'];

// Los tres niveles del árbol de Meta. El valor es cómo se nombra en la UI en
// castellano — los mensajes de error los lee el dueño de la cuenta, no un dev.
export const NIVELES = {
  campaign: { singular: 'campaña', plural: 'campañas' },
  adset: { singular: 'conjunto', plural: 'conjuntos' },
  ad: { singular: 'anuncio', plural: 'anuncios' },
};

export const MAX_IDS = 25;

// Valida el cuerpo de un pedido de cambio de estado. Devuelve
// { ok: true, level, ids, status } o { ok: false, error } con un mensaje que
// se le puede mostrar tal cual al usuario.
export function validarPedido(body = {}) {
  const level = String(body.level || '').trim();
  if (!NIVELES[level]) {
    return { ok: false, error: `Nivel inválido: "${level}". Esperaba campaign, adset o ad.` };
  }

  const status = String(body.status || '').trim().toUpperCase();
  if (!ESTADOS.includes(status)) {
    return { ok: false, error: `Estado inválido: "${body.status}". Solo se puede prender (ACTIVE) o pausar (PAUSED).` };
  }

  // Acepta un id suelto o una lista: la ronda pausa de a una, el botón masivo
  // manda varias.
  const crudos = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
  const ids = [];
  for (const raw of crudos) {
    const id = String(raw ?? '').trim();
    // Los ids de Meta son numéricos. Filtrar acá evita mandarle a Graph un
    // path armado con texto arbitrario.
    if (!/^\d{5,}$/.test(id)) return { ok: false, error: `Id inválido: "${raw}".` };
    if (!ids.includes(id)) ids.push(id);
  }

  if (ids.length === 0) return { ok: false, error: 'No mandaste ninguna entidad para cambiar.' };
  if (ids.length > MAX_IDS) {
    return { ok: false, error: `Demasiadas de una vez (${ids.length}). El máximo por pedido es ${MAX_IDS}.` };
  }

  return { ok: true, level, ids, status };
}

// Meta devuelve el id de cuenta a veces con prefijo act_ y a veces sin él.
// Comparar en crudo daría "no es tuya" para una cuenta que sí lo es.
export function mismaCuenta(a, b) {
  const limpio = (v) => String(v ?? '').trim().replace(/^act_/, '');
  const x = limpio(a), y = limpio(b);
  return x !== '' && x === y;
}

// Arma el resumen de una tanda: cuántas salieron, cuántas no y un mensaje
// listo para el toast. Se testea acá para que el mensaje no dependa de la UI.
export function resumirResultados(resultados = [], { level = 'campaign', status = 'PAUSED' } = {}) {
  const ok = resultados.filter(r => r.ok);
  const fallaron = resultados.filter(r => !r.ok);
  const nombre = NIVELES[level] || NIVELES.campaign;
  const verbo = status === 'ACTIVE' ? 'Prendí' : 'Pausé';
  const cosa = (n) => (n === 1 ? nombre.singular : nombre.plural);

  let mensaje;
  if (ok.length && !fallaron.length) {
    mensaje = `${verbo} ${ok.length} ${cosa(ok.length)}.`;
  } else if (ok.length && fallaron.length) {
    mensaje = `${verbo} ${ok.length} ${cosa(ok.length)}, ${fallaron.length} no se pudo: ${fallaron[0].error}`;
  } else {
    mensaje = `No se pudo: ${fallaron[0]?.error || 'error desconocido'}`;
  }

  return {
    total: resultados.length,
    ok: ok.length,
    fallaron: fallaron.length,
    // 'success' si salió todo, 'warning' si salió a medias, 'error' si nada.
    tono: fallaron.length === 0 ? 'success' : (ok.length ? 'warning' : 'error'),
    mensaje,
  };
}

// Lo contrario de lo que se acaba de hacer — para el "Deshacer" del toast.
export const inverso = (status) => (status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');

// El estado que hay que mostrar para una fila: lo que dijo Meta cuando se
// cargó el tablero, salvo que en esta sesión lo hayamos cambiado nosotros.
//
// Sin esto habría que recargar toda la cuenta después de cada click (varios
// segundos) para ver que el botón cambió de lado.
export function estadoVisible(item, cambios) {
  return cambios?.[item?.id] || item?.status || null;
}

// ── Entrega ─────────────────────────────────────────────────────────────
//
// Lo que el Administrador de anuncios muestra en la columna "Entrega". No es
// lo mismo que el interruptor: un anuncio puede estar prendido y NO entregar
// porque su campaña está apagada, porque está en revisión o porque lo
// rechazaron. Mostrar solo el interruptor haría creer que está corriendo algo
// que no gastó un peso en todo el día.
//
// Los textos son los de Meta en castellano, para que la fila diga lo mismo
// que dice el Ads Manager cuando se abre al lado.
export const ENTREGA = {
  ACTIVE: { label: 'Activa', tono: 'ok' },
  PAUSED: { label: 'Desactivada', tono: 'mute' },
  CAMPAIGN_PAUSED: { label: 'Campaña desactivada', tono: 'mute' },
  ADSET_PAUSED: { label: 'Conjunto desactivado', tono: 'mute' },
  IN_PROCESS: { label: 'En proceso', tono: 'warn' },
  PENDING_REVIEW: { label: 'En revisión', tono: 'warn' },
  PREAPPROVED: { label: 'Aprobado provisoriamente', tono: 'warn' },
  WITH_ISSUES: { label: 'Con problemas', tono: 'warn' },
  PENDING_BILLING_INFO: { label: 'Falta info de pago', tono: 'bad' },
  DISAPPROVED: { label: 'Rechazado', tono: 'bad' },
  ARCHIVED: { label: 'Archivada', tono: 'mute' },
  DELETED: { label: 'Eliminada', tono: 'mute' },
};

// Estados en los que la entrega la corta un PADRE, no la entidad misma.
// Prender el anuncio no lo hace entregar: sigue colgado de la campaña.
const PADRE_APAGADO = new Set(['CAMPAIGN_PAUSED', 'ADSET_PAUSED']);

// Qué mostrar en la columna Entrega de una fila, teniendo en cuenta lo que
// prendimos o pausamos en esta sesión (que Meta todavía no nos volvió a
// contar). Devuelve null si no sabemos nada: mejor una celda vacía que una
// etiqueta inventada.
export function entregaDe(item, cambios) {
  const efectivo = item?.effectiveStatus || item?.status || null;
  const local = cambios?.[item?.id];

  if (local) {
    // Prender algo cuyo padre sigue apagado no lo pone a entregar. Decir
    // "Activa" ahí sería mentira, y de las caras: te quedás esperando gasto
    // que no va a llegar.
    if (local === 'ACTIVE' && PADRE_APAGADO.has(efectivo)) return ENTREGA[efectivo];
    return ENTREGA[local];
  }
  return efectivo ? (ENTREGA[efectivo] || { label: efectivo, tono: 'mute' }) : null;
}
