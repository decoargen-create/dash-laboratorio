// Prender y pausar desde el tablero.
//
// Es el único lugar del front que le pide a AdsLab que ESCRIBA en la cuenta
// publicitaria, así que concentra las tres cosas que hay que hacer bien:
// mandar el pedido, entender una respuesta a medias (Meta no da
// transacciones: pueden salir 3 de 5) y dejar armado el deshacer.

import { authHeaders } from './MetaConnect.jsx';
import { resumirResultados } from '../api/meta/_estado.js';

// Lo puro vive en _estado.js (compartido con el backend y testeado ahí); acá
// se re-exporta para que la UI importe todo de un solo lugar.
export { resumirResultados, inverso, estadoVisible } from '../api/meta/_estado.js';

// Cambia el estado de una o varias entidades. Devuelve siempre la misma
// forma — { ok, resultados, resumen } — pase lo que pase, así quien llama no
// tiene que distinguir un 200 de un 207 de un error de red.
export async function cambiarEstado({ accountId, connId, level, ids, status }) {
  const lista = Array.isArray(ids) ? ids : [ids];
  try {
    const r = await fetch('/api/meta/set-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders(false)) },
      body: JSON.stringify({
        account_id: accountId,
        connection_id: connId && connId !== '__cookie__' ? connId : undefined,
        level, ids: lista, status,
      }),
    });
    const d = await r.json().catch(() => ({}));

    // Error antes de tocar nada (validación, sesión, cuenta): no hay
    // resultados por entidad, así que los fabricamos para que el resumen y el
    // repintado de filas funcionen igual.
    if (!d.resultados) {
      const error = d.error || `Error ${r.status}`;
      const resultados = lista.map(id => ({ id, ok: false, error }));
      return { ok: false, resultados, resumen: resumirResultados(resultados, { level, status }) };
    }

    const resumen = resumirResultados(d.resultados, { level, status });
    return { ok: resumen.fallaron === 0, resultados: d.resultados, resumen };
  } catch (e) {
    const error = e?.message || 'No pude hablar con el servidor';
    const resultados = lista.map(id => ({ id, ok: false, error }));
    return { ok: false, resultados, resumen: resumirResultados(resultados, { level, status }) };
  }
}
