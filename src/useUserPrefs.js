// Hook que mantiene la APARIENCIA (color de acento, fuente, tamaño)
// sincronizada con la nube vía user_prefs. Pasivo: recibe el state + setters
// que ya viven en App.jsx y se encarga del pull/push.
//
// Flujo:
//   - Al login: pullea las prefs del cloud y, si existen, las APLICA (la nube
//     es la fuente de verdad). Si el cloud está vacío, SIEMBRA con lo que tenga
//     este dispositivo (así la primera PC popula el cloud y las demás heredan).
//   - Ante cambios de apariencia (después del pull inicial): push debounced.

import { useEffect, useRef } from 'react';
import { onAuthChange, getCurrentUser } from './supabase.js';
import { pullUserPrefs, pushUserPrefs } from './userPrefs.js';

export function useUserPrefs({ accentColor, setAccentColor, textSize, setTextSize, uiFont, setUiFont }) {
  // appliedRef: ¿ya corrió el pull inicial? Hasta entonces NO pusheamos, para
  // no subir los defaults antes de conocer lo que hay en el cloud.
  const appliedRef = useRef(false);
  const userRef = useRef(null);
  const debounceRef = useRef(null);

  // Pull + apply al login (y en cada cambio de auth: token refresh, re-login).
  useEffect(() => {
    let mounted = true;

    const applyFromCloud = async () => {
      const u = await getCurrentUser();
      userRef.current = u;
      if (!u) { appliedRef.current = false; return; }
      const prefs = await pullUserPrefs();
      const ap = prefs?.appearance;
      if (mounted && ap) {
        // Cloud manda — aplicamos lo que haya, campo por campo.
        if (ap.accentColor) setAccentColor(ap.accentColor);
        if (ap.textSize) setTextSize(ap.textSize);
        if (ap.uiFont) setUiFont(ap.uiFont);
      } else if (mounted && u) {
        // Cloud vacío → sembramos con lo de este dispositivo para que las
        // otras PCs hereden esta apariencia.
        pushUserPrefs({ appearance: { accentColor, textSize, uiFont } });
      }
      appliedRef.current = true;
    };

    applyFromCloud();
    const unsub = onAuthChange(async ({ user }) => {
      userRef.current = user;
      if (user) { appliedRef.current = false; await applyFromCloud(); }
    });
    return () => { mounted = false; unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push debounced ante cambios de apariencia, una vez hecho el pull inicial.
  useEffect(() => {
    if (!appliedRef.current || !userRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushUserPrefs({ appearance: { accentColor, textSize, uiFont } });
    }, 1200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [accentColor, textSize, uiFont]);
}
