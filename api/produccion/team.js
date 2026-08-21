// Producción — gestión del EQUIPO (creators) desde la app. Solo admin.
//
// El login del equipo se apoya en Supabase Auth. Cada "chico" es una cuenta
// con profiles.role = 'creator'. Este endpoint deja que el admin arme el
// roster sin salir de la app (sin ir al panel de Supabase):
//   - action 'list'          → lista el equipo (creators).
//   - action 'create'        → crea la cuenta (email + contraseña) y la marca
//                              como creator. La contraseña se la pasás vos al
//                              chico; queda confirmada (sin email de verif.).
//   - action 'reset-password'→ cambia la contraseña de un creator.
//   - action 'remove'        → saca al chico del equipo (borra la cuenta). Las
//                              tarjetas que tenía asignadas quedan sin dueño
//                              (creator_id → null por el FK on delete set null),
//                              no se pierden.
//
// Seguridad: se verifica que el caller tenga sesión (getUserIdFromAuth) y que
// sea admin (getUserRole). Todas las escrituras usan el cliente service-role.

import { getUserIdFromAuth, getUserRole, getServiceClient } from '../marketing/_supabase-server.js';

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Busca un usuario de Auth por email (no hay getByEmail en el admin API, así que
// paginamos listUsers). Devuelve el user o null. Cap de páginas por las dudas.
async function findAuthUserByEmail(supabase, email) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users || [];
    const hit = users.find(u => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) break; // era la última página
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  // "Admin" a los fines de Producción = cualquiera que NO sea editor (creator).
  // Misma regla que ya usan el tablero de admin del cliente y el endpoint de
  // Drive: hay UNA cuenta dueña (la tuya) que gestiona todo, y los editores son
  // solo editores. Así el dueño puede tener role 'user'/null y aún así manejar
  // el equipo, sin tener que marcar nada en la base.
  const role = await getUserRole(userId);
  if (role === 'creator') {
    return respondJSON(res, 403, { error: 'Un editor no puede gestionar el equipo.' });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return respondJSON(res, 500, { error: 'Supabase server no está configurado (falta SUPABASE_SERVICE_ROLE_KEY).' });
  }

  const body = readBody(req);
  const action = body.action;

  // ---- Asegurar que el dueño sea admin en la base ----
  // La RLS de Producción exige profiles.role='admin' para escribir. La cuenta
  // dueña suele quedar en 'user' (default del signup), así que sus asignaciones
  // se rechazan en silencio y no llegan a los editores. Acá la promovemos, pero
  // SOLO si todavía no hay ningún admin (bootstrap del primer dueño) — así un
  // signup cualquiera no puede autopromoverse si ya existe un admin.
  if (action === 'ensure-admin') {
    if (role === 'admin') return respondJSON(res, 200, { ok: true, role: 'admin', promoted: false });
    const { count, error: cErr } = await supabase
      .from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
    if (cErr) return respondJSON(res, 500, { error: cErr.message });
    if ((count || 0) > 0) return respondJSON(res, 200, { ok: true, role: role || 'user', promoted: false });
    const { error } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', userId);
    if (error) return respondJSON(res, 500, { error: error.message });
    return respondJSON(res, 200, { ok: true, role: 'admin', promoted: true });
  }

  // NOTA: acá NO exigimos role='admin'. En esta base el dueño puede tener role
  // 'user'/null (la RLS de Producción va por owner_id, no por admin) y NO siempre
  // es el admin global (ya hay otro), así que exigir admin lo dejaría afuera de la
  // gestión de su propio equipo. El único gate es "no ser editor" (arriba). El
  // scope-por-dueño real requiere agregar owner_id al roster (pendiente).

  // ---- Listar el equipo ----
  if (action === 'list') {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,display_name,role,created_at')
      .eq('role', 'creator')
      .order('created_at', { ascending: true });
    if (error) return respondJSON(res, 500, { error: error.message });
    return respondJSON(res, 200, { ok: true, team: data || [] });
  }

  // ---- Crear la cuenta de un chico ----
  if (action === 'create') {
    const email = (body.email || '').toString().trim().toLowerCase();
    const password = (body.password || '').toString();
    const displayName = (body.displayName || body.name || '').toString().trim();

    if (!EMAIL_RE.test(email)) return respondJSON(res, 400, { error: 'Email inválido.' });
    if (password.length < 6) return respondJSON(res, 400, { error: 'La contraseña tiene que tener al menos 6 caracteres.' });

    const name = displayName || email.split('@')[0];

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // sin email de verificación: entra directo con la clave
      user_metadata: { display_name: name },
    });

    // Si el email YA existe en Auth (típico: un intento previo que creó la cuenta
    // pero quedó sin profile de editor → no aparece en el equipo), en vez de
    // frenar con "ya existe", la ADOPTAMOS: le ponemos el nombre + la contraseña
    // que pusiste y la marcamos como editor. Así queda usable y aparece en el
    // equipo, sin que tengas que borrarla a mano en Supabase. No tocamos admins.
    let userId = created?.user?.id || null;
    let adopted = false;
    if (createErr) {
      if (!/already|registered|exists/i.test(createErr.message || '')) {
        return respondJSON(res, 400, { error: createErr.message });
      }
      const existing = await findAuthUserByEmail(supabase, email);
      if (!existing) {
        return respondJSON(res, 400, { error: 'Ese email ya existe pero no lo pude ubicar. Borralo en Supabase → Authentication → Users y reintentá.' });
      }
      // Solo adoptamos cuentas SIN rol (huérfanas, sin profile) o que ya son
      // editores. Nunca adoptamos admins/dueños/otros roles: adoptar resetea la
      // contraseña y baja a 'creator', así que un email tipeado de más no debe
      // poder secuestrar/lockear una cuenta ajena.
      const existingRole = await getUserRole(existing.id);
      if (existingRole && existingRole !== 'creator') {
        return respondJSON(res, 400, { error: `Ese email ya pertenece a otra cuenta (${existingRole}) y no se puede convertir en editor. Usá otro email.` });
      }
      const { error: updErr } = await supabase.auth.admin.updateUserById(existing.id, {
        password, email_confirm: true, user_metadata: { display_name: name },
      });
      if (updErr) return respondJSON(res, 500, { error: `No se pudo actualizar la cuenta existente: ${updErr.message}` });
      userId = existing.id;
      adopted = true;
    }

    if (!userId) return respondJSON(res, 500, { error: 'No se pudo crear la cuenta.' });

    // El trigger handle_new_user ya creó el profile con role default 'user'.
    // Lo forzamos a 'creator' (upsert por si el trigger todavía no corrió).
    const { error: upErr } = await supabase
      .from('profiles')
      .upsert({ id: userId, email, display_name: name, role: 'creator' }, { onConflict: 'id' });
    if (upErr) return respondJSON(res, 500, { error: `Cuenta lista pero falló marcarla como editor: ${upErr.message}` });

    return respondJSON(res, 200, {
      ok: true,
      adopted,
      member: { id: userId, email, display_name: name, role: 'creator' },
    });
  }

  // ---- Resetear la contraseña de un chico ----
  if (action === 'reset-password') {
    const targetId = (body.id || '').toString();
    const password = (body.password || '').toString();
    if (!targetId) return respondJSON(res, 400, { error: 'Falta el id del creator.' });
    if (password.length < 6) return respondJSON(res, 400, { error: 'La contraseña tiene que tener al menos 6 caracteres.' });

    // Solo permitimos resetear a alguien que sea creator (no a otros admins/users).
    const targetRole = await getUserRole(targetId);
    if (targetRole !== 'creator') return respondJSON(res, 403, { error: 'Ese usuario no es del equipo.' });

    const { error } = await supabase.auth.admin.updateUserById(targetId, { password });
    if (error) return respondJSON(res, 500, { error: error.message });
    return respondJSON(res, 200, { ok: true });
  }

  // ---- Sacar a un chico del equipo (borra la cuenta) ----
  if (action === 'remove') {
    const targetId = (body.id || '').toString();
    if (!targetId) return respondJSON(res, 400, { error: 'Falta el id del creator.' });

    // Nunca borrar a un admin/otro rol por este camino: solo creators.
    const targetRole = await getUserRole(targetId);
    if (targetRole !== 'creator') return respondJSON(res, 403, { error: 'Ese usuario no es del equipo.' });

    const { error } = await supabase.auth.admin.deleteUser(targetId);
    if (error) return respondJSON(res, 500, { error: error.message });
    return respondJSON(res, 200, { ok: true });
  }

  return respondJSON(res, 400, { error: `Acción desconocida: ${action}` });
}
