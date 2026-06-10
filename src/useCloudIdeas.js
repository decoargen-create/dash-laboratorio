// React hook cloud-first para la bandeja de ideas.
//
// USAGE:
//   const { ideas, loading, error, refresh, save, remove } = useCloudIdeas();
//
// - ideas: array de ideas (data shape de marketing_ideas.data + id + productoId)
// - loading: true durante el fetch inicial
// - error: string con el mensaje si algo falló
// - refresh(): re-fetch del cloud (Realtime ya lo hace solo)
// - save(idea): upsertea al cloud + actualiza state local optimista
// - remove(id): borra del cloud + actualiza state
//
// Auto-sync: se suscribe a postgres_changes en marketing_ideas filtrado por
// user_id. Cuando una idea cambia en otra PC, este hook la recibe y la mergea.
//
// Diferencia vs useCloudProductos: Realtime usa eventos granulares para
// INSERT/UPDATE/DELETE en lugar de re-fetch full. Más eficiente para listas
// grandes y evita el round-trip al server.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  fetchIdeas,
  saveIdea,
  deleteIdeaCloud,
  migrateBandejaIdeasFromProductos,
} from './cloudData.js';
import { supabase, getCurrentUser, onAuthChange } from './supabase.js';

function rowToIdea(row) {
  return {
    ...(row.data || {}),
    id: row.id,
    productoId: row.producto_id || (row.data?.productoId ?? null),
  };
}

export function useCloudIdeas() {
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setError(null);
    try {
      const data = await fetchIdeas();
      if (mountedRef.current) {
        setIdeas(data);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
    }
  }, []);

  // Mount: migración lazy + fetch inicial + Realtime + listener de auth.
  useEffect(() => {
    mountedRef.current = true;
    let channel = null;
    let unsubAuth = () => {};
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        setLoading(false);
        return;
      }
      // Migración: si hay bandejaIdeas dentro de productos, las pasamos a
      // marketing_ideas. Es idempotente — corre cada login pero solo hace
      // algo la primera vez tras el rollout.
      try { await migrateBandejaIdeasFromProductos(); } catch {}
      await refresh();
      // Realtime — granular en lugar de re-fetch full. Más eficiente para
      // bandejas con cientos de ideas.
      if (!supabase) return;
      channel = supabase
        .channel(`cloud-marketing_ideas-${user.id}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'marketing_ideas', filter: `user_id=eq.${user.id}` },
          (payload) => {
            if (!mountedRef.current) return;
            const nueva = rowToIdea(payload.new);
            setIdeas(prev => {
              if (prev.some(i => String(i.id) === String(nueva.id))) return prev;
              return [nueva, ...prev];
            });
          }
        )
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'marketing_ideas', filter: `user_id=eq.${user.id}` },
          (payload) => {
            if (!mountedRef.current) return;
            const actualizada = rowToIdea(payload.new);
            setIdeas(prev => prev.map(i =>
              String(i.id) === String(actualizada.id) ? actualizada : i
            ));
          }
        )
        .on('postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'marketing_ideas', filter: `user_id=eq.${user.id}` },
          (payload) => {
            if (!mountedRef.current) return;
            const id = payload.old?.id;
            if (!id) return;
            setIdeas(prev => prev.filter(i => String(i.id) !== String(id)));
          }
        )
        .subscribe();
    })();
    unsubAuth = onAuthChange(async ({ user }) => {
      if (!user) {
        setIdeas([]);
        setLoading(false);
      } else {
        setLoading(true);
        try { await migrateBandejaIdeasFromProductos(); } catch {}
        await refresh();
      }
    });
    return () => {
      mountedRef.current = false;
      if (channel) try { supabase.removeChannel(channel); } catch {}
      unsubAuth();
    };
  }, [refresh]);

  // Save: upsert + optimistic local update.
  const save = useCallback(async (idea) => {
    try {
      await saveIdea(idea);
      setIdeas(prev => {
        const idx = prev.findIndex(i => String(i.id) === String(idea.id));
        if (idx === -1) return [idea, ...prev];
        const next = [...prev];
        next[idx] = idea;
        return next;
      });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  // Remove: delete + optimistic local update.
  const remove = useCallback(async (id) => {
    try {
      await deleteIdeaCloud(id);
      setIdeas(prev => prev.filter(i => String(i.id) !== String(id)));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  return { ideas, loading, error, refresh, save, remove };
}
