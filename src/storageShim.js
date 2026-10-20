// Red de seguridad para localStorage lleno (reportado 17/10 y 20/10: "no me
// trae ningún producto"). Con el storage al tope, el sync traía los productos
// del cloud pero el setItem fallaba y TODA la app los leía vacíos.
//
// Este shim envuelve setItem/getItem/removeItem de localStorage:
//   1. Si un setItem tira QuotaExceeded, libera lo descartable (cachés de
//      Meta, backups, chats del copiloto, imágenes cacheadas, el skeleton
//      cache y las claves viora-* viejas que ya tienen su copia adslab-*) y
//      reintenta.
//   2. Si aun así no entra, guarda el valor EN MEMORIA y getItem lo devuelve
//      desde ahí. La sesión funciona normal; el cloud sigue siendo la fuente
//      de verdad y en el próximo login se vuelve a traer.
// Se importa PRIMERO en main.jsx, antes que cualquier módulo de la app.

const DESCARTABLES = [
  'adslab-meta-cache-', 'backup-', 'adslab-marketing-copilot-',
  'adslab-creativo-img-cache', 'adslab-marketing-skeleton-cache',
  'adslab-marketing-creative-refresh-cache', 'adslab-marketing-execution-log',
  'adslab-marketing-cost-log',
];

function esQuota(e) {
  return e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014
    || /quota|exceeded/i.test(String(e.message || '')));
}

(function instalar() {
  if (typeof window === 'undefined' || typeof Storage === 'undefined') return;
  let ls;
  try { ls = window.localStorage; } catch { return; }
  if (!ls || ls.__adslabShim) return;

  const mem = new Map();
  const proto = Storage.prototype;
  const origSet = proto.setItem, origGet = proto.getItem, origRemove = proto.removeItem;

  const liberar = () => {
    let liberados = 0;
    try {
      for (let i = ls.length - 1; i >= 0; i--) {
        const k = ls.key(i);
        if (!k) continue;
        const legacyDuplicada = k.startsWith('viora-') && origGet.call(ls, `adslab-${k.slice(6)}`) != null;
        if (legacyDuplicada || DESCARTABLES.some(p => k.startsWith(p))) {
          origRemove.call(ls, k); liberados++;
        }
      }
    } catch { /* best-effort */ }
    return liberados;
  };

  proto.setItem = function (k, v) {
    if (this !== ls) return origSet.call(this, k, v);
    try {
      origSet.call(this, k, v);
      mem.delete(k);
    } catch (e) {
      if (!esQuota(e)) throw e;
      const n = liberar();
      try {
        origSet.call(this, k, v);
        mem.delete(k);
        console.warn(`[storage] lleno: liberé ${n} claves descartables y se guardó "${k}"`);
      } catch (e2) {
        if (!esQuota(e2)) throw e2;
        mem.set(k, String(v));
        console.warn(`[storage] lleno: "${k}" queda en memoria esta sesión (${String(v).length} bytes)`);
      }
    }
  };
  proto.getItem = function (k) {
    if (this === ls && mem.has(k)) return mem.get(k);
    return origGet.call(this, k);
  };
  proto.removeItem = function (k) {
    if (this === ls) mem.delete(k);
    return origRemove.call(this, k);
  };
  try { Object.defineProperty(ls, '__adslabShim', { value: true }); } catch {}
})();
