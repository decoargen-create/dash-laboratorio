// Helpers para localStorage seguros frente a Safari private mode + quota
// exceeded + storage disabled.
//
// POR QUÉ EXISTE:
// localStorage.setItem() en Safari private mode tira QuotaExceededError
// (porque la quota es 0). En el resto de navegadores también puede tirar
// QuotaExceededError cuando la quota total se llenó. Como los call-sites
// raramente envuelven en try/catch, una excepción acá crashea el render y
// el user ve pantalla en blanco.
//
// safeSetItem: try/catch silencioso + log al console.warn — sin romper el
// flow. Devuelve true/false según si pudo guardar.
//
// safeGetItem: try/catch para los casos en que el navegador bloquea LEER
// localStorage (cookies-blocked + storage-restricted setting).
//
// safeRemoveItem: idem para remove.
//
// USO:
//   import { safeSetItem } from './safeStorage.js';
//   safeSetItem('mi-key', JSON.stringify(data));
//
// No los usamos para CADA call (sería muy ruidoso) — solo en los call-sites
// críticos donde un crash en setItem rompe la app: writes de productos,
// brands, sesión, ideas, etc.

let _quotaWarnShown = false;

export function safeSetItem(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    // Log una sola vez por session — sin esto los console.warn spammean por
    // cada keystroke en formularios que persisten.
    if (!_quotaWarnShown) {
      _quotaWarnShown = true;
      console.warn(
        `[safeStorage] setItem("${key}") falló: ${err?.name || 'Error'} — ${err?.message || ''}. ` +
        `Si estás en Safari private mode, los datos no van a persistir. Considerá salir del modo privado o usar otro navegador.`
      );
    } else {
      console.warn(`[safeStorage] setItem("${key}") falló (silenciado): ${err?.name || 'Error'}`);
    }
    return false;
  }
}

export function safeGetItem(key) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    console.warn(`[safeStorage] getItem("${key}") falló: ${err?.name || 'Error'}`);
    return null;
  }
}

export function safeRemoveItem(key) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.warn(`[safeStorage] removeItem("${key}") falló: ${err?.name || 'Error'}`);
    return false;
  }
}
