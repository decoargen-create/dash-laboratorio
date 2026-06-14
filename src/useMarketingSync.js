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
import { supabase, onAuthChange, getCurrentUser } from './supabase.js';
import { migrateIDBCreativosToCloud } from './galeriaMigration.js';
import { fetchIdeas } from './cloudData.js';
import { setSyncStatus } from './syncStatusStore.js';

const KEYS = {
  productos: 'adslab-marketing-productos-v1',
  active: 'adslab-marketing-active-product',
  genOpts: 'adslab-marketing-gen-opts',
  brandsPrefix: 'adslab-marketing-inspiracion-brands-',
};

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

export function useMarketingSync({ addToast } = {}) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'pulling' | 'pushing' | 'error' | 'ok'
  const [lastError, setLastError] = useState(null);

  // Espejamos status/lastError al store global para que el SyncStatusBadge
  // del header (y cualquier otro consumidor) lo muestre sin prop-drilling.
  useEffect(() => {
    setSyncStatus({ status, lastError });
  }, [status, lastError]);
  const debounceTimers = useRef(new Map());
  // Counter de retries por key para deferred pushes (cuando pull aún no
  // completó). Sin esto, una pull que nunca termina causa loop infinito.
  const deferRetryRef = useRef(new Map());
  // Guard: solo permitimos PUSH después de que termine el primer pull.
  // Sin esto, el render inicial dispara saveJSON([]) → push de localStorage
  // vacío → pushAllProductos([]) → ANTES borraba todo el cloud.
  const pullCompletedRef = useRef(false);
  // Mutex: en StrictMode dev (o si un onAuthChange dispara mientras la IIFE
  // de mount aún está corriendo) podríamos lanzar 2 pulls concurrentes que
  // pisan localStorage entre sí. Este ref bloquea pulls superpuestos.
  const pullingRef = useRef(false);
  // Set de keys con push pendiente (debounced o en curso). El runPull
  // verifica esto: si hay pushes en flight, defer el pull hasta que
  // terminen. Sin esto, race scenario:
  //   1) user scrapea → localStorage actualizado, push queued 2s
  //   2) token refresh dispara onAuthChange → runPull arranca antes del push
  //   3) runPull lee cloud (datos viejos) y pisa localStorage → scrape perdido
  const pendingPushKeysRef = useRef(new Set());
  // Cuando un pull se difiere por pushes pendientes, lo marcamos para
  // ejecutar después del último push.
  const deferredPullRef = useRef(false);
  const mountedRefShared = useRef({ current: true });

  // Helper: corre migrate + pull con mutex + deferral si hay pushes pendientes.
  const runPull = async (mountedRef) => {
    if (pullingRef.current) {
      console.info('[sync] pull ya en curso — skip duplicado');
      return;
    }
    if (pendingPushKeysRef.current.size > 0) {
      // Hay scrape/edit pendiente de pushear → si pulleamos ahora pisamos
      // el state local con la versión cloud (que aún no tiene los cambios
      // locales). Diferimos: cuando el último push termine, dispara este
      // pull. Garantiza orden: push primero, después pull.
      console.info(`[sync] pull deferred — pushes pendientes: ${[...pendingPushKeysRef.current].join(', ')}`);
      deferredPullRef.current = true;
      mountedRefShared.current = mountedRef || mountedRefShared.current;
      return;
    }
    pullingRef.current = true;
    try {
      setStatus('pulling');
      const mig = await migrateLocalToCloud();
      if (mig?.migrated) addToast?.({ type: 'success', message: `Migrados ${mig.productos} productos al cloud` });
      await pullMarketingFromCloud();
      pullCompletedRef.current = true;
      if (mountedRef?.current !== false) setStatus('ok');

      // Migración soft de creativos IDB → cloud, en background (no
      // bloquea el resto del sync). Solo corre la primera vez por user.
      (async () => {
        try {
          // El toast lo dispara onStart, que migrateIDBCreativosToCloud solo
          // llama si REALMENTE va a subir (no si ya migró). Antes el aviso
          // salía en cada pull aunque no subiera nada.
          const migCreativos = await migrateIDBCreativosToCloud({
            onStart: (count) => addToast?.({ type: 'info', message: `Subiendo ${count} creativos locales al cloud — esto puede tardar un poco.` }),
          });
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
      if (mountedRef?.current !== false) { setStatus('error'); setLastError(err.message); }
      addToast?.({ type: 'error', message: `Sync error: ${err.message}` });
    } finally {
      pullingRef.current = false;
    }
  };

  // 1. Detect login → pull + soft migration.
  useEffect(() => {
    // Compartimos este mountedRef con el otro useEffect via mountedRefShared
    // para que un push completado pueda disparar el pull diferido con
    // el estado de mount correcto.
    const mountedRef = { current: true };
    mountedRefShared.current = mountedRef;
    (async () => {
      const u = await getCurrentUser();
      if (mountedRef.current) setUser(u);
      if (u) await runPull(mountedRef);
    })();
    const unsubscribe = onAuthChange(async ({ user: newUser }) => {
      setUser(newUser);
      if (newUser) await runPull(mountedRef);
      else setStatus('idle');
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1c. SYNC MANUAL — el user puede forzar un pull desde el badge del header
  // (caso típico: "entré desde otra PC y no veo los cambios todavía"). Reusa
  // runPull, que ya tiene mutex + deferral si hay pushes pendientes.
  useEffect(() => {
    const onForce = () => runPull(mountedRefShared.current);
    window.addEventListener('viora:force-sync', onForce);
    return () => window.removeEventListener('viora:force-sync', onForce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1b. REALTIME — suscribimos a cambios en las tablas del cloud para que
  // otra PC del mismo user vea las modificaciones en vivo (sin F5).
  // Cuando llega un cambio remoto, hacemos pull para que el smart-merge
  // aplique los datos al localStorage local. Los componentes ya tienen
  // listeners de viora:marketing-pulled y se re-renderean solos.
  //
  // Filtramos por user_id en cada channel para no recibir cambios de
  // otros users (RLS también protege, esto es para minimizar ancho de banda).
  useEffect(() => {
    if (!supabase || !user) return;
    const uid = user.id;
    // Debounce de los pulls — múltiples cambios seguidos (típico de un
    // batch de scrapes) deberían disparar UN pull, no N.
    let pullTimer = null;
    const schedulePull = () => {
      if (pullTimer) clearTimeout(pullTimer);
      // EDITING GUARD: si hay un push pendiente o el user acaba de hacer un
      // cambio local (último write < 5s), demoramos el pull. Sin esto, un
      // realtime event puede pisar lo que el user está tipeando.
      const lastLocalWrite = Number(window.__viora_last_local_write || 0);
      const sinceLastWrite = Date.now() - lastLocalWrite;
      const editingNow = sinceLastWrite < 5000;
      const delay = editingNow ? 5000 - sinceLastWrite + 1000 : 1500;
      pullTimer = setTimeout(() => {
        // Re-check al disparar — si el user siguió tipeando, re-postergamos.
        const lastLocalNow = Number(window.__viora_last_local_write || 0);
        if (Date.now() - lastLocalNow < 3000) {
          console.info('[realtime] pull postergado — user sigue tipeando');
          schedulePull();
          return;
        }
        console.info('[realtime] cambio remoto detectado — re-pulling cloud');
        runPull(mountedRefShared.current);
      }, delay);
    };
    // Refresh de ideas: lee marketing_ideas, las redistribuye en
    // producto.bandejaIdeas (localStorage), y dispatcha viora:marketing-pulled
    // para que los componentes que lean del legacy storage se actualicen.
    let ideasTimer = null;
    const scheduleIdeasRefresh = () => {
      if (ideasTimer) clearTimeout(ideasTimer);
      ideasTimer = setTimeout(async () => {
        try {
          const ideas = await fetchIdeas();
          // Re-particionar por productoId.
          const byProducto = new Map();
          for (const i of ideas) {
            const pid = i.productoId ? String(i.productoId) : null;
            if (!pid) continue;
            const list = byProducto.get(pid) || [];
            list.push(i);
            byProducto.set(pid, list);
          }
          // Mergear en localStorage producto.bandejaIdeas.
          const raw = localStorage.getItem(KEYS.productos);
          if (raw) {
            const productos = safeParse(raw) || [];
            const updated = productos.map(p => ({
              ...p,
              bandejaIdeas: byProducto.get(String(p.id)) || [],
            }));
            localStorage.setItem(KEYS.productos, JSON.stringify(updated));
            window.dispatchEvent(new Event('viora:marketing-pulled'));
            console.info(`[realtime] ideas refrescadas: ${ideas.length} ideas en ${byProducto.size} productos`);
          }
        } catch (err) {
          console.warn('[realtime] refresh ideas falló:', err.message);
        }
      }, 800);
    };
    const channel = supabase
      .channel(`marketing-realtime-${uid}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'marketing_productos', filter: `user_id=eq.${uid}` },
        () => schedulePull()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'marketing_brands', filter: `user_id=eq.${uid}` },
        () => schedulePull()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'marketing_creativos', filter: `user_id=eq.${uid}` },
        () => {
          // Para creativos no hace falta full pull (no van a localStorage).
          // Dispatchamos para que la galería refresque desde el cloud.
          try { window.dispatchEvent(new CustomEvent('viora:referencial-saved', { detail: { cloud: true } })); } catch {}
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'marketing_ideas', filter: `user_id=eq.${uid}` },
        () => {
          // Cuando una idea cambia en otra PC, refetcheamos todas las ideas
          // del cloud y las redistribuimos en producto.bandejaIdeas para que
          // los componentes que aún leen de localStorage (Bandeja, Arranque)
          // las vean. Debounced 800ms para batch updates.
          scheduleIdeasRefresh();
        }
      )
      .subscribe();
    console.info('[realtime] suscripto a cambios de marketing_* para user', uid.slice(0, 8));
    return () => {
      if (pullTimer) clearTimeout(pullTimer);
      if (ideasTimer) clearTimeout(ideasTimer);
      try { supabase.removeChannel(channel); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 2. Listen a cambios de localStorage (mismo tab) — usamos un MutationObserver
  // alternativo via `viora:storage-changed` event que disparamos manualmente
  // en las funciones de save. Y también escuchamos 'storage' por si cambia en
  // otra tab. Push debounced 2s.
  useEffect(() => {
    if (!user) return;

    const queuePush = (key) => {
      // Marcar push pendiente — bloquea pulls hasta que termine. Sin esto,
      // un pull lanzado por token-refresh entre scrape y push pisaba el
      // localStorage local con la versión cloud vieja.
      pendingPushKeysRef.current.add(key);
      const existing = debounceTimers.current.get(key);
      if (existing) clearTimeout(existing);
      const id = setTimeout(async () => {
        debounceTimers.current.delete(key);
        await doPush(key);
      }, 2000);
      debounceTimers.current.set(key, id);
    };

    // Wrapper que reintenta el push hasta 3 veces (1s/2s/4s). Antes un push
    // que fallaba (red, token expirado momentáneamente) era game over y solo
    // dejaba un toast. Ahora el wrapper retry rescata la mayoría de los
    // errores transitorios.
    const pushWithRetry = async (label, fn, retries = 3) => {
      let lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          await fn();
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < retries) {
            const delay = Math.min(8000, 1000 * Math.pow(2, attempt));
            console.warn(`[sync] push ${label} falló (intento ${attempt + 1}/${retries + 1}): ${err.message}. Retry en ${delay}ms.`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      throw lastErr;
    };

    const doPush = async (key) => {
      // CROSS-TAB DATA-LOSS GUARD: si tab A hace logout, los removeItem
      // disparan 'storage' event en tab B (otro tab del mismo browser, sesión
      // aún válida). Tab B intentaría pushear el localStorage vacío al cloud
      // → BORRA EL CLOUD ENTERO. Sin esto, un logout en una tab podía
      // limpiar la cuenta entera. Verificamos sesión activa antes de pushear.
      try {
        if (supabase) {
          // TIMEOUT 5s: si Supabase cuelga, no queremos bloquear el push para
          // siempre. Race contra timeout y treat como "tal vez hay sesión".
          const sessionResult = await Promise.race([
            supabase.auth.getSession(),
            new Promise(resolve => setTimeout(() => resolve({ data: { session: '__timeout__' } }), 5000)),
          ]);
          const session = sessionResult?.data?.session;
          // null explícito (session expired) → drop. timeout placeholder → seguir.
          if (session === null) {
            console.warn(`[sync] push de ${key} dropeado — no hay sesión activa`);
            return;
          }
        }
      } catch {}
      // Guard: si el primer pull aún no terminó, el localStorage puede no
      // reflejar lo que hay en el cloud. Pushear ahora puede borrar datos
      // (race condition que afectó al user el 2026-06-08).
      // Antes: skipeábamos silenciosamente → edits hechos durante el pull
      // se perdían. Ahora: re-encolamos el push para después del pull, con
      // máx 30 intentos (~15s de espera) por si el pull nunca termina —
      // evita loop infinito.
      if (!pullCompletedRef.current) {
        const retryAttempts = (deferRetryRef.current.get(key) || 0) + 1;
        if (retryAttempts > 30) {
          console.warn(`[sync] push de ${key} dropeado — pull no terminó tras 30 reintentos`);
          deferRetryRef.current.delete(key);
          return;
        }
        deferRetryRef.current.set(key, retryAttempts);
        console.warn(`[sync] push de ${key} diferido (${retryAttempts}/30) — pull aún no completó`);
        setTimeout(() => queuePush(key), 500);
        return;
      }
      // Push se va a ejecutar — reseteamos el counter de deferred retries
      // para esta key. Si más tarde otro pull se está corriendo y push
      // necesita diferirse de nuevo, vuelve a empezar de 0.
      deferRetryRef.current.delete(key);
      try {
        setStatus('pushing');
        if (key === KEYS.productos) {
          const arr = safeParse(localStorage.getItem(KEYS.productos)) || [];
          await pushWithRetry('productos', () => pushAllProductos(arr));
        } else if (key === KEYS.active || key === KEYS.genOpts) {
          const active = localStorage.getItem(KEYS.active);
          const genOpts = safeParse(localStorage.getItem(KEYS.genOpts));
          await pushWithRetry('prefs', () => pushPrefs({ activeProductoId: active, genOpts }));
        } else if (key.startsWith(KEYS.brandsPrefix)) {
          const productoId = key.slice(KEYS.brandsPrefix.length);
          const arr = safeParse(localStorage.getItem(key)) || [];
          await pushWithRetry(`brands/${productoId}`, () => pushBrandsForProducto(productoId, arr));
        }
        setStatus('ok');
      } catch (err) {
        console.warn('[sync] push error (tras retries):', err.message);
        setStatus('error'); setLastError(err.message);
        addToast?.({ type: 'error', message: `No pude guardar en el cloud (3 intentos): ${err.message}. Tus cambios quedan en local — recargá para reintentar.` });
      } finally {
        // Liberamos el lock del pull deferido sin importar éxito/error.
        // Si error, los datos quedan en local de todos modos; un pull
        // posterior los pisaría con cloud-viejo igual, así que mejor dejar
        // que el pull diferido corra y sincronice cloud → local.
        pendingPushKeysRef.current.delete(key);
        if (pendingPushKeysRef.current.size === 0 && deferredPullRef.current) {
          deferredPullRef.current = false;
          console.info('[sync] disparando pull diferido — pushes completados');
          runPull(mountedRefShared.current);
        }
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
      // Marcamos timestamp del último write local — el schedulePull lo lee
      // para no pisar al user mientras tipea. Sin esto, un realtime event
      // entrante puede pisar lo que está typing.
      try { window.__viora_last_local_write = Date.now(); } catch {}
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
