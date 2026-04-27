// Dispatcher único para /api/automations/* (CRUD de automations).
//
// Sigue el patrón del repo (cf. api/meta/[action].js) — un solo serverless
// function, con el `action` resolviendo al handler correspondiente. Sirve
// para mantener bajo el count de functions del plan Hobby de Vercel.
//
// Rutas:
//   GET  /api/automations/list           → automations del user actual
//   GET  /api/automations/get?id=X       → una sola
//   POST /api/automations/create         → body con campos
//   POST /api/automations/update         → body { id, ...fields }
//   POST /api/automations/delete         → body { id }
//   POST /api/automations/toggle         → body { id, enabled }
//
// Auth: Authorization: Bearer <session>  (la session que el front guarda
// en localStorage de api/auth.js).
// Cada user solo ve/edita las suyas. Role 'admin' puede ver todas con
// query param ?all=1 en /list.

import { validateSession, readBody } from '../../lib/auth/session.js';
import {
  getAutomation,
  listAutomationsByUser,
  listEnabledAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
} from '../../lib/automations/store.js';
import { validateForCreate, validateForUpdate } from '../../lib/automations/validate.js';

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function unauthorized(res, reason) {
  return respondJSON(res, 401, { error: 'Unauthorized', reason });
}

function methodNotAllowed(res) {
  return respondJSON(res, 405, { error: 'Method not allowed' });
}

/**
 * Chequea ownership: el user solo puede tocar sus automations, salvo admin.
 */
function ensureOwnership(automation, user) {
  if (!automation) return { ok: false, status: 404, body: { error: 'automation no existe' } };
  if (user.role === 'admin') return { ok: true };
  if (automation.userId === user.id) return { ok: true };
  return { ok: false, status: 403, body: { error: 'no es tuya' } };
}

// ---------------- list ----------------
async function handleList(req, res, user) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  // Admin con ?all=1 ve TODAS las enabled del sistema (útil para diagnóstico).
  // Sin ?all=1 (o non-admin), ve solo las suyas.
  const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
  const all = url.searchParams.get('all') === '1';
  if (all && user.role === 'admin') {
    const list = await listEnabledAutomations();
    return respondJSON(res, 200, { automations: list, total: list.length, scope: 'all-enabled' });
  }

  const list = await listAutomationsByUser(user.id);
  return respondJSON(res, 200, { automations: list, total: list.length, scope: 'mine' });
}

// ---------------- get ----------------
async function handleGet(req, res, user) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
  const id = url.searchParams.get('id');
  if (!id) return respondJSON(res, 400, { error: 'falta id' });

  const automation = await getAutomation(id);
  const own = ensureOwnership(automation, user);
  if (!own.ok) return respondJSON(res, own.status, own.body);

  return respondJSON(res, 200, { automation });
}

// ---------------- create ----------------
async function handleCreate(req, res, user, body) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const v = validateForCreate(body);
  if (!v.ok) return respondJSON(res, 400, { error: 'validation', errors: v.errors });

  try {
    const automation = await createAutomation(user.id, v.data);
    return respondJSON(res, 200, { ok: true, automation });
  } catch (err) {
    if (err.code === 'limit-reached') {
      return respondJSON(res, 409, { error: err.message, code: err.code });
    }
    console.error('[automations/create] error:', err);
    return respondJSON(res, 500, { error: err.message || 'error creando automation' });
  }
}

// ---------------- update ----------------
async function handleUpdate(req, res, user, body) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!body?.id) return respondJSON(res, 400, { error: 'falta id' });

  const current = await getAutomation(body.id);
  const own = ensureOwnership(current, user);
  if (!own.ok) return respondJSON(res, own.status, own.body);

  const { id: _ignore, session: _s, ...patch } = body;
  const v = validateForUpdate(patch);
  if (!v.ok) return respondJSON(res, 400, { error: 'validation', errors: v.errors });

  try {
    const updated = await updateAutomation(body.id, v.data);
    return respondJSON(res, 200, { ok: true, automation: updated });
  } catch (err) {
    if (err.code === 'not-found') return respondJSON(res, 404, { error: err.message });
    console.error('[automations/update] error:', err);
    return respondJSON(res, 500, { error: err.message || 'error actualizando' });
  }
}

// ---------------- delete ----------------
async function handleDelete(req, res, user, body) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!body?.id) return respondJSON(res, 400, { error: 'falta id' });

  const current = await getAutomation(body.id);
  const own = ensureOwnership(current, user);
  if (!own.ok) return respondJSON(res, own.status, own.body);

  const deleted = await deleteAutomation(body.id);
  return respondJSON(res, 200, { ok: deleted });
}

// ---------------- toggle ----------------
async function handleToggle(req, res, user, body) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!body?.id) return respondJSON(res, 400, { error: 'falta id' });
  if (typeof body.enabled !== 'boolean') return respondJSON(res, 400, { error: 'enabled debe ser boolean' });

  const current = await getAutomation(body.id);
  const own = ensureOwnership(current, user);
  if (!own.ok) return respondJSON(res, own.status, own.body);

  try {
    const updated = await updateAutomation(body.id, { enabled: body.enabled });
    return respondJSON(res, 200, { ok: true, automation: updated });
  } catch (err) {
    return respondJSON(res, 500, { error: err.message || 'error en toggle' });
  }
}

// ---------------- dispatcher ----------------
const actions = {
  list: { handler: handleList, needsBody: false },
  get: { handler: handleGet, needsBody: false },
  create: { handler: handleCreate, needsBody: true },
  update: { handler: handleUpdate, needsBody: true },
  delete: { handler: handleDelete, needsBody: true },
  toggle: { handler: handleToggle, needsBody: true },
};

export default async function handler(req, res) {
  const action = req.query?.action;
  const def = actions[action];
  if (!def) return respondJSON(res, 404, { error: `unknown action: ${action}` });

  const body = def.needsBody ? await readBody(req) : null;
  const sessionRes = validateSession(req, body);
  if (!sessionRes.ok) return unauthorized(res, sessionRes.reason);

  return def.handler(req, res, sessionRes.user, body);
}
