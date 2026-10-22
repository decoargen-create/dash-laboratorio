// Admin de PLATAFORMA — distinto del rol "admin" del tablero (que es el dueño
// de SU cuenta). El admin de plataforma es quien opera Kombialo como producto:
// ve los costos internos (saldos de OpenAI/Anthropic/Apify, Costos del header,
// Gastos del stack) que una cuenta registrada normal no tiene por qué ver, y a
// futuro es la cuenta que asiste a las que se van registrando.
//
// Sin Supabase (modo 100% local, sin login) no hay multi-cuenta: todo es admin,
// como siempre fue.

import { supabase } from './supabase.js';

const ADMIN_EMAILS = ['mrluks95@gmail.com'];

let _email = null;
const listeners = new Set();
function emit() { listeners.forEach(fn => { try { fn(); } catch {} }); }

if (supabase) {
  supabase.auth.getSession()
    .then(({ data }) => { _email = data?.session?.user?.email || null; emit(); })
    .catch(() => {});
  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.email || null;
    if (next !== _email) { _email = next; emit(); }
  });
}

export function esAdminPlataforma() {
  if (!supabase) return true; // modo local sin login: no hay otras cuentas
  return !!_email && ADMIN_EMAILS.includes(_email.trim().toLowerCase());
}

// Para que los componentes re-rendereen cuando cambia la sesión.
export function subscribeAdminPlataforma(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
