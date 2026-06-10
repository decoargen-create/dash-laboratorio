// Hook cloud-first para la inspiración global (cross-producto).
//
// USAGE:
//   const { brands, loading, save, remove, refresh } = useCloudInspiracionGlobal();
//
// Realtime: cualquier cambio de marketing_inspiracion_global del user dispara
// re-fetch (debounced 500ms). Cross-device sync gratis.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  fetchInspiracionGlobal,
  saveInspiracionGlobal,
  deleteInspiracionGlobal,
  subscribeTable,
} from './cloudData.js';
import { getCurrentUser, onAuthChange } from './supabase.js';

export function useCloudInspiracionGlobal() {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setError(null);
    try {
      const data = await fetchInspiracionGlobal();
      if (mountedRef.current) {
        setBrands(data);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
    }
  }, []);

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
      let debTimer = null;
      unsubRealtime = subscribeTable('marketing_inspiracion_global', () => {
        if (debTimer) clearTimeout(debTimer);
        debTimer = setTimeout(() => refresh(), 500);
      });
    })();
    unsubAuth = onAuthChange(async ({ user }) => {
      if (!user) {
        setBrands([]);
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

  const save = useCallback(async (brand) => {
    try {
      await saveInspiracionGlobal(brand);
      setBrands(prev => {
        const idx = prev.findIndex(b => String(b.id) === String(brand.id));
        if (idx === -1) return [brand, ...prev];
        const next = [...prev];
        next[idx] = brand;
        return next;
      });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  const remove = useCallback(async (id) => {
    try {
      await deleteInspiracionGlobal(id);
      setBrands(prev => prev.filter(b => String(b.id) !== String(id)));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  return { brands, loading, error, refresh, save, remove };
}
