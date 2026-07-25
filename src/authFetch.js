// Helper para adjuntar el token de Supabase a los fetch de endpoints que ahora
// requieren auth (endpoints de IA pagos: generate-ideas, copilot, deep-analyze,
// generate-copy, suggest-competitors, score-hooks, transcribe-ad, ocr-ad,
// adapt-inspiracion).
//
// Toda la app está detrás del login de Supabase (App.jsx gatea con
// SupabaseAuthScreen), así que siempre hay sesión disponible. Si por algún
// motivo no la hubiera, no se manda el header y el backend responde 401 — que
// es el comportamiento correcto (antes estos endpoints eran públicos y
// cualquiera con la URL podía quemar el presupuesto de OpenAI/Anthropic).

import { supabase } from './supabase.js';

// Devuelve un objeto de headers con Content-Type + Authorization (si hay sesión).
export async function authHeaders(base = { 'Content-Type': 'application/json' }) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return token ? { ...base, Authorization: `Bearer ${token}` } : { ...base };
  } catch {
    return { ...base };
  }
}
