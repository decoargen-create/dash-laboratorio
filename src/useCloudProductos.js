// React hook cloud-first para la lista de productos del user.
//
// USAGE:
//   const { productos, loading, error, refresh, save, remove } = useCloudProductos();
//
// - productos: array de productos (data shape de marketing_productos.data)
// - loading: true durante el fetch inicial
// - error: string con el mensaje si algo falló
// - refresh(): re-fetcha del cloud (poco usado — Realtime lo hace solo)
// - save(producto): upsertea al cloud + actualiza state local sin esperar
//   Realtime (más responsivo)
// - remove(id): borra del cloud + actualiza state
//
// Auto-sync: se suscribe a postgres_changes en marketing_productos filtrado
// por user_id. Cuando otra tab/PC modifica, este hook actualiza su state
// automático. NO necesita pasar por localStorage.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  fetchProductos,
  saveProducto,
  deleteProductoCloud,
  subscribeTable,
} from './cloudData.js';
import { onAuthChange, getCurrentUser } from './supabase.js';

export function useCloudProductos() {
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setError(null);
    try {
      const data = await fetchProductos();
      if (mountedRef.current) {
        setProductos(data);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
    }
  }, []);

  // Mount: fetch inicial + suscribir a Realtime + listener de auth.
  useEffect(() => {
    mountedRef.current = true;
    let unsubRealtime = () => {};
    let unsubAuth = () => {};
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        setLoading(false);
        return;
      }
      await refresh();
      // Suscripción Realtime — cualquier cambio en marketing_productos
      // del user dispara un re-fetch (debounced 500ms).
      let debTimer = null;
      const onRemoteChange = () => {
        if (debTimer) clearTimeout(debTimer);
        debTimer = setTimeout(() => refresh(), 500);
      };
      unsubRealtime = subscribeTable('marketing_productos', onRemoteChange);
    })();
    // Cambio de user (login/logout) → re-fetch
    unsubAuth = onAuthChange(async ({ user }) => {
      if (!user) {
        setProductos([]);
        setLoading(false);
      } else {
        setLoading(true);
        await refresh();
      }
    });
    return () => {
      mountedRef.current = false;
      unsubRealtime();
      unsubAuth();
    };
  }, [refresh]);

  // Save: upsert al cloud + optimistic update local (Realtime confirma
  // después, pero el UI no espera).
  const save = useCallback(async (producto) => {
    try {
      await saveProducto(producto);
      setProductos(prev => {
        const idx = prev.findIndex(p => String(p.id) === String(producto.id));
        if (idx === -1) return [producto, ...prev];
        const next = [...prev];
        next[idx] = producto;
        return next;
      });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  // Remove: borra del cloud + actualiza state.
  const remove = useCallback(async (id) => {
    try {
      await deleteProductoCloud(id);
      setProductos(prev => prev.filter(p => String(p.id) !== String(id)));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  return { productos, loading, error, refresh, save, remove };
}
