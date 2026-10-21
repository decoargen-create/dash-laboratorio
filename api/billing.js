// Suscripciones — esqueleto del sistema de pagos de Kombialo.
//
// Los PLANES y sus límites viven acá (fuente de verdad); la tabla
// public.suscripciones guarda el estado comercial de cada cuenta. Sin fila =
// 'trial'. El admin de plataforma asigna planes a mano (admin-set-plan) hasta
// que haya checkout automático (MercadoPago/Stripe), que escribirá lo mismo.
//
// Acciones (POST { action, ... }):
//   estado          → plan efectivo del caller + créditos restantes + catálogo
//                     de planes (para que el front no duplique límites).
//                     Si el período venció, lo rota solo (usados/extra a cero:
//                     los créditos NO acumulan, modelo AdCreative).
//   consumir        → { cantidad, motivo, ref } descuenta créditos (primero
//                     los incluidos, después los extra) y deja ledger.
//   admin-list      → todas las suscripciones con email (solo admin).
//   admin-set-plan  → { email, plan } asigna plan a una cuenta (solo admin).
//   admin-pack      → { email, packs } suma packs de 100 créditos (solo admin).

import { getUserIdFromAuth, getServiceClient, isSupabaseConfigured } from './marketing/_supabase-server.js';

// La misma lista del front (platformAdmin.js): quién opera Kombialo como producto.
const ADMIN_EMAILS = ['mrluks95@gmail.com'];

export const PLANES = {
  trial: { nombre: 'Prueba', precioUsd: 0, cuentas: 1, spendUsd: 5000, usuarios: 1, creditos: 15 },
  starter: { nombre: 'Starter', precioUsd: 49, cuentas: 1, spendUsd: 5000, usuarios: 1, creditos: 30 },
  pro: { nombre: 'Pro', precioUsd: 149, cuentas: 3, spendUsd: 30000, usuarios: 5, creditos: 150 },
  agencia: { nombre: 'Agencia', precioUsd: 399, cuentas: 10, spendUsd: 150000, usuarios: 99, creditos: 500 },
  fundador: { nombre: 'Fundador', precioUsd: 0, cuentas: 99, spendUsd: null, usuarios: 99, creditos: 999999 },
};
export const PACK = { precioUsd: 25, creditos: 100 };

function respondJSON(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

async function emailDe(supabase, userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    return (data?.user?.email || '').trim().toLowerCase();
  } catch { return ''; }
}

// Igual que team.js: no hay getByEmail en el admin API → paginamos.
async function findAuthUserByEmail(supabase, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users || [];
    const hit = users.find(u => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

// Fila efectiva del user: sin fila → trial virtual; período vencido → rota
// (los créditos no acumulan). Devuelve la fila ya fresca.
async function filaEfectiva(supabase, userId) {
  const { data: fila } = await supabase.from('suscripciones').select('*').eq('user_id', userId).maybeSingle();
  if (!fila) {
    return { user_id: userId, plan: 'trial', estado: 'activa', periodo_inicio: new Date().toISOString(), periodo_fin: null, creditos_usados: 0, creditos_extra: 0, virtual: true };
  }
  if (fila.estado === 'activa' && fila.periodo_fin && new Date(fila.periodo_fin) < new Date()) {
    const inicio = new Date();
    const fin = new Date(inicio); fin.setMonth(fin.getMonth() + 1);
    const patch = { periodo_inicio: inicio.toISOString(), periodo_fin: fin.toISOString(), creditos_usados: 0, creditos_extra: 0, updated_at: inicio.toISOString() };
    await supabase.from('suscripciones').update(patch).eq('user_id', userId);
    await supabase.from('creditos_eventos').insert({ user_id: userId, delta: PLANES[fila.plan]?.creditos || 0, motivo: 'renovacion', ref: fila.plan });
    return { ...fila, ...patch };
  }
  return fila;
}

function armarEstado(fila, esAdmin) {
  const plan = esAdmin ? 'fundador' : (fila.plan || 'trial');
  const lim = PLANES[plan] || PLANES.trial;
  const usados = fila.creditos_usados || 0;
  const extra = fila.creditos_extra || 0;
  const restantes = Math.max(0, lim.creditos - usados) + extra;
  return {
    plan, limites: lim, estado: fila.estado || 'activa',
    periodoInicio: fila.periodo_inicio || null, periodoFin: fila.periodo_fin || null,
    creditos: { incluidos: lim.creditos, usados, extra, restantes },
    esAdminPlataforma: esAdmin,
    planes: PLANES, pack: PACK,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });
  if (!isSupabaseConfigured()) return respondJSON(res, 501, { error: 'Supabase no configurado.' });

  const userId = await getUserIdFromAuth(req);
  if (!userId) return respondJSON(res, 401, { error: 'No autorizado — iniciá sesión de nuevo.' });

  const supabase = getServiceClient();
  const body = readBody(req);
  const action = body.action || req.query?.action;
  const callerEmail = await emailDe(supabase, userId);
  const esAdmin = ADMIN_EMAILS.includes(callerEmail);

  try {
    if (action === 'estado') {
      const fila = await filaEfectiva(supabase, userId);
      return respondJSON(res, 200, armarEstado(fila, esAdmin));
    }

    if (action === 'consumir') {
      const cantidad = Math.max(1, Math.round(Number(body.cantidad) || 1));
      const motivo = String(body.motivo || 'estatico').slice(0, 40);
      const ref = body.ref ? String(body.ref).slice(0, 200) : null;
      if (esAdmin) return respondJSON(res, 200, { ok: true, restantes: 999999, fundador: true });

      const fila = await filaEfectiva(supabase, userId);
      const lim = PLANES[fila.plan] || PLANES.trial;
      const restantes = Math.max(0, lim.creditos - (fila.creditos_usados || 0)) + (fila.creditos_extra || 0);
      if (restantes < cantidad) {
        return respondJSON(res, 402, { error: `Te quedan ${restantes} crédito${restantes === 1 ? '' : 's'} y esto necesita ${cantidad}. Sumá un pack de ${PACK.creditos} (US$${PACK.precioUsd}) o subí de plan.`, restantes });
      }
      // Primero los incluidos; lo que no alcance sale de los extra.
      const libresIncluidos = Math.max(0, lim.creditos - (fila.creditos_usados || 0));
      const deIncluidos = Math.min(cantidad, libresIncluidos);
      const deExtra = cantidad - deIncluidos;
      const patch = {
        creditos_usados: (fila.creditos_usados || 0) + deIncluidos,
        creditos_extra: (fila.creditos_extra || 0) - deExtra,
        updated_at: new Date().toISOString(),
      };
      if (fila.virtual) {
        await supabase.from('suscripciones').insert({ user_id: userId, plan: 'trial', ...patch });
      } else {
        await supabase.from('suscripciones').update(patch).eq('user_id', userId);
      }
      await supabase.from('creditos_eventos').insert({ user_id: userId, delta: -cantidad, motivo, ref });
      return respondJSON(res, 200, { ok: true, restantes: restantes - cantidad });
    }

    // ── Solo admin de plataforma ──
    if (!esAdmin) return respondJSON(res, 403, { error: 'Solo el admin de plataforma.' });

    if (action === 'admin-list') {
      const { data: filas, error } = await supabase.from('suscripciones').select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      const out = [];
      for (const f of filas || []) {
        const { data } = await supabase.auth.admin.getUserById(f.user_id);
        out.push({ ...f, email: data?.user?.email || f.user_id });
      }
      return respondJSON(res, 200, { suscripciones: out, planes: PLANES });
    }

    if (action === 'admin-set-plan') {
      const plan = String(body.plan || '');
      if (!PLANES[plan]) return respondJSON(res, 400, { error: `Plan inválido: ${plan}` });
      const user = await findAuthUserByEmail(supabase, body.email);
      if (!user) return respondJSON(res, 404, { error: `No hay ninguna cuenta con el email ${body.email}.` });
      const inicio = new Date();
      const fin = new Date(inicio); fin.setMonth(fin.getMonth() + 1);
      const fila = {
        user_id: user.id, plan, estado: 'activa',
        periodo_inicio: inicio.toISOString(), periodo_fin: fin.toISOString(),
        creditos_usados: 0, creditos_extra: 0,
        provider: 'manual', provider_ref: null,
        notas: body.notas ? String(body.notas).slice(0, 500) : null,
        updated_at: inicio.toISOString(),
      };
      const { error } = await supabase.from('suscripciones').upsert(fila, { onConflict: 'user_id' });
      if (error) throw error;
      await supabase.from('creditos_eventos').insert({ user_id: user.id, delta: PLANES[plan].creditos, motivo: 'renovacion', ref: `admin:${plan}` });
      return respondJSON(res, 200, { ok: true, email: user.email, plan });
    }

    if (action === 'admin-pack') {
      const packs = Math.max(1, Math.round(Number(body.packs) || 1));
      const user = await findAuthUserByEmail(supabase, body.email);
      if (!user) return respondJSON(res, 404, { error: `No hay ninguna cuenta con el email ${body.email}.` });
      const fila = await filaEfectiva(supabase, user.id);
      const creditos = packs * PACK.creditos;
      const patch = { creditos_extra: (fila.creditos_extra || 0) + creditos, updated_at: new Date().toISOString() };
      if (fila.virtual) {
        await supabase.from('suscripciones').insert({ user_id: user.id, plan: 'trial', ...patch });
      } else {
        await supabase.from('suscripciones').update(patch).eq('user_id', user.id);
      }
      await supabase.from('creditos_eventos').insert({ user_id: user.id, delta: creditos, motivo: 'pack', ref: `admin:${packs}x${PACK.creditos}` });
      return respondJSON(res, 200, { ok: true, email: user.email, creditosAgregados: creditos });
    }

    return respondJSON(res, 400, { error: `Acción desconocida: ${action}` });
  } catch (e) {
    return respondJSON(res, 500, { error: e.message || 'Error inesperado' });
  }
}
