// Cliente Supabase para el frontend — usa la anon key + JWT del user para
// que las queries respeten RLS (Row Level Security): cada user solo ve sus
// propias filas.
//
// Importante: persistSession en localStorage para que el usuario quede
// logueado entre refreshes. autoRefreshToken para que la sesión no
// expire mientras está abierta la app.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY no están seteadas. ' +
    'El sync con Supabase NO va a funcionar. Seteá las env vars en Vercel.'
  );
}

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // soporta magic links / OAuth callback
        storageKey: 'adslab-supabase-auth-v1',
      },
    })
  : null;

// Helper: ¿hay un user logueado? Cualquier write a Marketing requiere esto.
export async function getCurrentUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Helper para subscribirse a cambios de auth (login/logout/refresh).
export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    cb({ event, session, user: session?.user || null });
  });
  return () => data.subscription.unsubscribe();
}
