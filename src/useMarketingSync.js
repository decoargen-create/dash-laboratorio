// Hook que mantiene Marketing sincronizado con Supabase.
//
// Flujo:
// 1. Al montar (login con Supabase OK): hace pullMarketingFromCloud() para
//    sobreescribir localStorage con lo del backend.
// 2. Después listen a cambios de localStorage marketing-* y pushea con
//    debounce de 2s.
// 3. Si el push falla: muestra toast de error. No hay fallback offline.
//
// Importante: este hook es PASIVO — no reescribe los componentes existentes.
// Los componentes siguen leyendo/escribiendo localStorage como antes. El
// hook se encarga de mantener sincronizado el lado server.

import { useEffect, useRef, useState } from 'react';
import {
  pullMarketingFromCloud,
  pushAllProductos,
  pushBrandsForProducto,
  pushPrefs,
  migrateLocalToCloud,
} from './marketingSync.js';
import { onAuthChange, getCurrentUser } from './supabase.js';
import { migrateIDBCreativosToCloud, countIDBCreativos } from './galeriaMigration.js';

const KEYS = {
  productos: 'viora-marketing-productos-v1',
  active: 'viora-marketing-active-product',
  genOpts: 'viora-marketing-gen-opts',
  brandsPrefix: 'viora-marketing-inspiracion-brands-',
};

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

export function useMarketingSync({ addToast } = {}) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'pulling' | 'pushing' | 'error' | 'ok'
  const [lastError, setLastError] = useState(null);
  const debounceTimers = useRef(new Map());

  // 1. Detect login → pull + soft migration.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const u = await getCurrentUser();
      if (mounted) setUser(u);
      if (u) {
        try {
          setStatus('pulling');
          const mig = await migrateLocalToCloud();
          if (mig?.migrated) addToast?.({ type: 'success', message: `Migrados ${mig.productos} productos al cloud` });
          await pullMarketingFromCloud();
          if (mounted) setStatus('ok');

          // Migración soft de creativos IDB → cloud, en background (no
          // bloquea el resto del sync). Solo corre la primera vez por user.
          (async () => {
            try {
              const count = await countIDBCreativos();
              if (count > 0) {
                addToast?.({ type: 'info', message: `Subiendo ${count} creativos locales al cloud — esto puede tardar un poco.` });
              }
              const migCreativos = await migrateIDBCreativosToCloud();
              if (migCreativos?.migrated > 0) {
                addToast?.({
                  type: 'success',
                  message: `${migCreativos.migrated} creativos subidos al cloud${migCreativos.failed ? ` (${migCreativos.failed} fallaron)` : ''}`,
                });
              }
            } catch (err) {
              console.warn('[migración creativos] error:', err.message);
            }
          })();
        } catch (err) {
          console.warn('[sync] pull error:', err.message);
          if (mounted) { setStatus('error'); setLastError(err.message); }
          addToast?.({ type: 'error', message: `Sync error: ${err.message}` });
        }
      }
    })();
    return onAuthChange(async ({ user: newUser }) => {
      setUser(newUser);
      if (newUser) {
        try {
          setStatus('pulling');
          await migrateLocalToCloud();
          await pullMarketingFromCloud();
          setStatus('ok');
          // Migración de creativos también acá (caso re-login en misma sesión).
          (async () => {
            try { await migrateIDBCreativosToCloud(); } catch {}
          })();
        } catch (err) {
          setStatus('error'); setLastError(err.message);
        }
      } else {
        setStatus('idle');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Listen a cambios de localStorage (mismo tab) — usamos un MutationObserver
  // alternativo via `viora:storage-changed` event que disparamos manualmente
  // en las funciones de save. Y también escuchamos 'storage' por si cambia en
  // otra tab. Push debounced 2s.
  useEffect(() => {
    if (!user) return;

    const queuePush = (key) => {
      const existing = debounceTimers.current.get(key);
      if (existing) clearTimeout(existing);
      const id = setTimeout(async () => {
        debounceTimers.current.delete(key);
        await doPush(key);
      }, 2000);
      debounceTimers.current.set(key, id);
    };

    const doPush = async (key) => {
      try {
        setStatus('pushing');
        if (key === KEYS.productos) {
          const arr = safeParse(localStorage.getItem(KEYS.productos)) || [];
          await pushAllProductos(arr);
        } else if (key === KEYS.active || key === KEYS.genOpts) {
          const active = localStorage.getItem(KEYS.active);
          const genOpts = safeParse(localStorage.getItem(KEYS.genOpts));
          await pushPrefs({ activeProductoId: active, genOpts });
        } else if (key.startsWith(KEYS.brandsPrefix)) {
          const productoId = key.slice(KEYS.brandsPrefix.length);
          const arr = safeParse(localStorage.getItem(key)) || [];
          await pushBrandsForProducto(productoId, arr);
        }
        setStatus('ok');
      } catch (err) {
        console.warn('[sync] push error:', err.message);
        setStatus('error'); setLastError(err.message);
        addToast?.({ type: 'error', message: `No pude guardar en el cloud: ${err.message}` });
      }
    };

    const onStorage = (e) => {
      if (!e.key) return;
      if (e.key === KEYS.productos || e.key === KEYS.active || e.key === KEYS.genOpts ||
          e.key.startsWith(KEYS.brandsPrefix)) {
        queuePush(e.key);
      }
    };
    window.addEventListener('storage', onStorage);

    // Event manual para misma-tab (storage event NO se dispara en la tab que
    // hizo el setItem). Disparamos esto desde marketingSync helpers (TODO en
    // un siguiente PR — por ahora, los componentes que escriben pueden
    // dispatchearlo a mano).
    const onLocal = (e) => {
      const key = e?.detail?.key;
      if (key) queuePush(key);
    };
    window.addEventListener('viora:marketing-storage-changed', onLocal);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('viora:marketing-storage-changed', onLocal);
      for (const id of debounceTimers.current.values()) clearTimeout(id);
      debounceTimers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return { user, status, lastError };
}

// Helper para que los stores existentes notifiquen cambios sin tener que
// importar el hook. Llamalo después de un localStorage.setItem.
export function notifyMarketingChange(key) {
  try {
    window.dispatchEvent(new CustomEvent('viora:marketing-storage-changed', { detail: { key } }));
  } catch {}
}
