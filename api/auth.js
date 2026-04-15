// Endpoint de autenticación por magic link.
// Flujo:
//   1. POST { action: 'send', email } → genera un token firmado (HMAC-SHA256)
//      con TTL corto (15 min), lo manda por email vía Resend (si hay API key)
//      y responde { ok, emailSent, devLink? } para que el front muestre un
//      mensaje "revisá tu email" o, en dev/setup, el link directo.
//   2. POST { action: 'verify', token } → valida el token del magic link y
//      emite un session token (TTL 7 días) que el front guarda en localStorage.
//   3. POST { action: 'me', session } → valida un session token y devuelve
//      { email, role, name }. Usado al bootear el app para saber si ya hay
//      sesión activa.
//
// Diseño stateless: no hay DB. Los tokens se firman con AUTH_SECRET.
// Acceso controlado con AUTH_ALLOWED_EMAILS (whitelist CSV). Rol admin
// se determina por AUTH_ADMIN_EMAILS (CSV); el resto es 'mentor'.
import crypto from 'node:crypto';

// --- Helpers JWT-like (header.payload.sig en base64url, HS256) ---
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}
function signToken(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}
function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(p).toString('utf-8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- Lectura de config ---
function parseList(env) {
  return (env || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
function resolveRole(email) {
  const admins = parseList(process.env.AUTH_ADMIN_EMAILS);
  return admins.includes(email.toLowerCase()) ? 'admin' : 'mentor';
}
function resolveName(email) {
  // Heurística simple: parte antes del @ capitalizada, separando por . o _
  const local = email.split('@')[0] || email;
  return local.split(/[._-]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || email;
}

// --- Body parsing (dev middleware y Vercel) ---
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respondJSON(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return respondJSON(res, 405, { error: 'Method not allowed' });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return respondJSON(res, 500, {
      error: 'AUTH_SECRET no está configurada. Generá una random (ej. `openssl rand -hex 32`) y pegala en las env vars.',
    });
  }

  const body = await readBody(req);
  const { action } = body || {};

  // ============ ENVIAR MAGIC LINK ============
  if (action === 'send') {
    const emailRaw = (body.email || '').trim().toLowerCase();
    if (!emailRaw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw)) {
      return respondJSON(res, 400, { error: 'Email inválido' });
    }
    // Whitelist. Si no se configuró, se permite cualquier email (útil para setup inicial).
    const allowed = parseList(process.env.AUTH_ALLOWED_EMAILS);
    if (allowed.length > 0 && !allowed.includes(emailRaw)) {
      // Silent success para no filtrar qué emails están en la whitelist, pero logueamos.
      console.warn('[auth] intento de login con email no autorizado:', emailRaw);
      return respondJSON(res, 200, { ok: true, emailSent: false, hidden: true });
    }

    const role = resolveRole(emailRaw);
    const token = signToken({
      email: emailRaw,
      role,
      purpose: 'magic_link',
      exp: Math.floor(Date.now() / 1000) + 900, // 15 minutos
      iat: Math.floor(Date.now() / 1000),
    }, secret);

    // Armamos el link de callback. Preferimos el Origin del request (válido
    // tanto en dev http://localhost:5173 como en prod https://app.example.com).
    const origin = (req.headers.origin || process.env.APP_URL || '').replace(/\/$/, '')
      || `http://${req.headers.host || 'localhost:5173'}`;
    const link = `${origin}/acceso?token=${encodeURIComponent(token)}`;

    // Intentamos enviar por Resend si hay key. Si no, devolvemos el link para
    // que el front lo muestre (modo dev/setup — nunca en producción real).
    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.AUTH_FROM || 'Laboratorio Viora <onboarding@resend.dev>';
    let emailSent = false;
    if (resendKey) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: emailRaw,
            subject: 'Tu acceso al Laboratorio Viora',
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222">
                <h2 style="color:#4a0f22;margin:0 0 12px">Laboratorio Viora</h2>
                <p>Hola,</p>
                <p>Hacé click en el botón para ingresar al panel:</p>
                <p style="text-align:center;margin:24px 0">
                  <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#9f1239,#e11d48);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Ingresar al panel</a>
                </p>
                <p style="font-size:13px;color:#666">Si el botón no funciona, copiá este link: <br/><span style="word-break:break-all">${link}</span></p>
                <p style="font-size:13px;color:#666">Este link expira en 15 minutos.</p>
                <p style="font-size:13px;color:#666">Si no pediste este acceso, ignorá este mail.</p>
              </div>`,
          }),
        });
        emailSent = resp.ok;
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          console.warn('[auth] Resend respondió error:', resp.status, txt);
        }
      } catch (err) {
        console.warn('[auth] falló envío de email:', err?.message || err);
      }
    }

    return respondJSON(res, 200, {
      ok: true,
      emailSent,
      // Si no hay Resend key configurada, devolvemos el link para que el front
      // lo pueda mostrar en modo setup. Si Resend está configurado pero falló,
      // también lo devolvemos para no bloquear.
      ...(emailSent ? {} : { devLink: link }),
    });
  }

  // ============ VERIFICAR MAGIC LINK ============
  if (action === 'verify') {
    const { token } = body || {};
    const payload = verifyToken(token, secret);
    if (!payload || payload.purpose !== 'magic_link') {
      return respondJSON(res, 401, { error: 'Token inválido o expirado' });
    }
    const session = signToken({
      email: payload.email,
      role: payload.role,
      name: resolveName(payload.email),
      purpose: 'session',
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 días
      iat: Math.floor(Date.now() / 1000),
    }, secret);
    return respondJSON(res, 200, {
      ok: true,
      session,
      user: { email: payload.email, role: payload.role, name: resolveName(payload.email) },
    });
  }

  // ============ VALIDAR SESSION (usado al bootear) ============
  if (action === 'me') {
    const { session } = body || {};
    const payload = verifyToken(session, secret);
    if (!payload || payload.purpose !== 'session') {
      return respondJSON(res, 401, { error: 'Sesión inválida o expirada' });
    }
    return respondJSON(res, 200, {
      ok: true,
      user: { email: payload.email, role: payload.role, name: payload.name || resolveName(payload.email) },
    });
  }

  return respondJSON(res, 400, { error: 'Acción desconocida' });
}
