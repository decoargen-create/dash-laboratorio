// Cliente del endpoint /api/produccion/team — gestión del equipo (creators)
// desde la app. Solo funciona para un admin (el server lo verifica). Adjunta el
// token de Supabase para que el server sepa quién llama.

import { supabase } from './supabase.js';

async function authHeaders() {
  const base = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const t = session?.access_token;
    return t ? { ...base, Authorization: `Bearer ${t}` } : base;
  } catch { return base; }
}

async function call(action, payload = {}) {
  const headers = await authHeaders();
  const r = await fetch('/api/produccion/team', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export const listTeam = () => call('list').then(d => d.team || []);
// Bootstrap del dueño como admin (para que la RLS de Producción le acepte las
// escrituras). Idempotente; el server solo promueve si no hay admin todavía.
export const ensureAppAdmin = () => call('ensure-admin');
export const createMember = (email, password, displayName) =>
  call('create', { email, password, displayName }).then(d => d.member);
export const resetPassword = (id, password) => call('reset-password', { id, password });
export const removeMember = (id) => call('remove', { id });
// Organigrama: quién responde a quién. liderId null = sin líder.
export const setLider = (id, liderId) => call('set-lider', { id, liderId });

// ── Cuentas POR ÁREA (miembros) ──────────────────────────────────────────────
// Cuentas que el dueño crea para su equipo con acceso a secciones enteras del
// tablero ("solamente producción", "solamente estáticos"...). profiles.role =
// 'miembro' + fila en cuenta_miembros con las áreas habilitadas.
export const listAreaMembers = () => call('list-members').then(d => d.members || []);
export const createAreaMember = (email, password, displayName, areas) =>
  call('create-member', { email, password, displayName, areas }).then(d => d.member);
export const setAreaMemberAreas = (id, areas) => call('set-member-areas', { id, areas });
export const resetAreaMemberPassword = (id, password) => call('reset-password-member', { id, password });
export const removeAreaMember = (id) => call('remove-member', { id });
