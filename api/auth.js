// Endpoint de autenticación.
// Soporta DOS flujos de login:
//   - Usuario + contraseña (action 'login'): el método principal.
//     Los usuarios viven en la env var AUTH_USERS como JSON:
//       [{"u":"admin","n":"Admin","r":"admin","h":"<salt>$<hash>"}, ...]
//     El hash se genera con PBKDF2-SHA256 (100k iter). Para generar un hash
//     correr: `node scripts/hash-password.mjs <password>`.
//   - Magic link por email (actions 'send' + 'verify'): opcional. Activo
//     sólo si AUTH_SECRET está configurado y se desea.
//
// Los session tokens son JWT-like HS256 firmados con AUTH_SECRET, stateless.
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

// --- Password hashing (PBKDF2-SHA256) ---
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  try {
    const expected = crypto.pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), 100000, 32, 'sha256');
    const actual = Buffer.from(hashHex, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// --- Parsing de AUTH_USERS ---
// Formato: JSON array con { u: username, n?: nombre display, r: role, h: "saltHex$hashHex" }
function parseUsers(env) {
  if (!env) return [];
  try {
    const parsed = JSON.parse(env);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(u => u && typeof u.u === 'string' && typeof u.h === 'string')
      .map(u => ({
        u: u.u.toLowerCase().trim(),
        n: u.n || u.u,
        r: (u.r === 'admin' ? 'admin' : 'mentor'),
        h: u.h,
      }));
  } catch (err) {
    console.warn('[auth] AUTH_USERS inválido (debe ser JSON array):', err?.message);
    return [];
  }
}

// --- Email magic link helpers (legado, opcional) ---
function parseList(env) {
  return (env || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
function resolveRoleFromEmail(email) {
  const admins = parseList(process.env.AUTH_ADMIN_EMAILS);
  return admins.includes(email.toLowerCase()) ? 'admin' : 'mentor';
}
function resolveNameFromEmail(email) {
  const local = email.split('@')[0] || email;
  return local.split(/[._-]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || email;
}

// --- Body parsing ---
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

// Delay aleatorio (0-150ms) para login fallidos — mitiga timing attacks
// sobre la existencia o no de un usuario.
async function jitter() {
  await new Promise(r => setTimeout(r, 40 + Math.floor(Math.random() * 100)));
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

  // ============ LOGIN CON USUARIO + CONTRASEÑA ============
  if (action === 'login') {
    const username = (body.username || '').toString().trim().toLowerCase();
    const password = (body.password || '').toString();
    if (!username || !password) {
      return respondJSON(res, 400, { error: 'Faltan usuario o contraseña' });
    }
    const users = parseUsers(process.env.AUTH_USERS);
    if (users.length === 0) {
      // Distintos mensajes para diagnosticar mejor en producción.
      const raw = process.env.AUTH_USERS;
      let detail;
      if (raw == null || raw === '') {
        detail = 'AUTH_USERS no está configurada en las env vars (redeployá después de agregarla).';
      } else {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            detail = 'AUTH_USERS existe pero no es un array JSON. Debe empezar con [ y terminar con ].';
          } else if (parsed.length === 0) {
            detail = 'AUTH_USERS es un array vacío. Agregá al menos un usuario.';
          } else {
            detail = `AUTH_USERS existe con ${parsed.length} entradas pero ninguna válida. Cada usuario necesita los campos "u" (username) y "h" (hash) como strings.`;
          }
        } catch (err) {
          detail = `AUTH_USERS no es JSON válido: ${err.message}. Revisá que no tenga saltos de línea ni comillas extras.`;
        }
      }
      return respondJSON(res, 500, { error: detail });
    }
    const user = users.find(u => u.u === username);
    // Siempre hacer el verify (aunque no exista el user) para evitar timing attacks
    // que permitan enumerar qué usuarios existen.
    const stored = user?.h || '00$00';
    const ok = verifyPassword(password, stored);
    if (!user || !ok) {
      await jitter();
      return respondJSON(res, 401, { error: 'Usuario o contraseña inválidos' });
    }
    const session = signToken({
      username: user.u,
      role: user.r,
      name: user.n,
      purpose: 'session',
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
      iat: Math.floor(Date.now() / 1000),
    }, secret);
    return respondJSON(res, 200, {
      ok: true,
      session,
      user: { username: user.u, role: user.r, name: user.n },
    });
  }

  // ============ VALIDAR SESSION (usado al bootear) ============
  if (action === 'me') {
    const { session } = body || {};
    const payload = verifyToken(session, secret);
    if (!payload || payload.purpose !== 'session') {
      return respondJSON(res, 401, { error: 'Sesión inválida o expirada' });
    }
    // Doble check: además de validar la firma, para sessions de user+pass
    // verificamos que el username siga existiendo en AUTH_USERS. Así si el
    // admin borra un user, su sesión se invalida automáticamente sin tener
    // que rotar AUTH_SECRET (que reventaría a todos los usuarios activos).
    if (payload.username) {
      const users = parseUsers(process.env.AUTH_USERS);
      const stillExists = users.some(u => u.u === payload.username);
      if (!stillExists) {
        return respondJSON(res, 401, { error: 'Usuario ya no está habilitado' });
      }
    }
    // Para sessions de magic link (usan email y no username), chequeamos que
    // el email siga en AUTH_ALLOWED_EMAILS. Si la whitelist está vacía
    // (típico cuando se pasó 100% al sistema user+pass), la sesión vieja
    // se invalida para forzar re-login con el nuevo flujo.
    if (payload.email && !payload.username) {
      const allowed = parseList(process.env.AUTH_ALLOWED_EMAILS);
      if (allowed.length === 0 || !allowed.includes(payload.email.toLowerCase())) {
        return respondJSON(res, 401, { error: 'Email ya no está autorizado' });
      }
    }
    return respondJSON(res, 200, {
      ok: true,
      user: {
        username: payload.username || payload.email,
        email: payload.email,
        role: payload.role,
        name: payload.name || resolveNameFromEmail(payload.email || ''),
      },
    });
  }

  // ============ MAGIC LINK (legado opcional) ============
  if (action === 'send') {
    const emailRaw = (body.email || '').trim().toLowerCase();
    if (!emailRaw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw)) {
      return respondJSON(res, 400, { error: 'Email inválido' });
    }
    const allowed = parseList(process.env.AUTH_ALLOWED_EMAILS);
    if (allowed.length > 0 && !allowed.includes(emailRaw)) {
      console.warn('[auth] intento de login con email no autorizado:', emailRaw);
      return respondJSON(res, 200, { ok: true, emailSent: false, hidden: true });
    }

    const role = resolveRoleFromEmail(emailRaw);
    const token = signToken({
      email: emailRaw,
      role,
      purpose: 'magic_link',
      exp: Math.floor(Date.now() / 1000) + 900,
      iat: Math.floor(Date.now() / 1000),
    }, secret);

    const origin = (req.headers.origin || process.env.APP_URL || '').replace(/\/$/, '')
      || `http://${req.headers.host || 'localhost:5173'}`;
    const link = `${origin}/acceso?token=${encodeURIComponent(token)}`;

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
      ...(emailSent ? {} : { devLink: link }),
    });
  }

  if (action === 'verify') {
    const { token } = body || {};
    const payload = verifyToken(token, secret);
    if (!payload || !['magic_link', 'invite'].includes(payload.purpose)) {
      return respondJSON(res, 401, { error: 'Token inválido o expirado' });
    }
    const session = signToken({
      email: payload.email,
      username: payload.username,
      mentorId: payload.mentorId,
      role: payload.role,
      name: payload.name || resolveNameFromEmail(payload.email || ''),
      purpose: 'session',
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 días para invites
      iat: Math.floor(Date.now() / 1000),
    }, secret);
    return respondJSON(res, 200, {
      ok: true,
      session,
      user: {
        email: payload.email,
        username: payload.username,
        mentorId: payload.mentorId,
        role: payload.role,
        name: payload.name || resolveNameFromEmail(payload.email || ''),
      },
    });
  }

  // ============ GENERAR INVITE LINK PARA MENTOR ============
  if (action === 'create_invite') {
    const { mentorId, mentorName, pin } = body || {};
    if (mentorId == null || !mentorName) {
      return respondJSON(res, 400, { error: 'Faltan mentorId o mentorName' });
    }
    const username = mentorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const token = signToken({
      mentorId: Number(mentorId),
      username,
      name: mentorName,
      role: 'mentor',
      pin: pin || null,
      purpose: 'invite',
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365, // 1 año
      iat: Math.floor(Date.now() / 1000),
    }, secret);
    const origin = (req.headers.origin || process.env.APP_URL || '').replace(/\/$/, '')
      || `http://${req.headers.host || 'localhost:5173'}`;
    const link = `${origin}/acceso?token=${encodeURIComponent(token)}`;
    return respondJSON(res, 200, { ok: true, link, username });
  }
      ok: true,
      session,
      user: { email: payload.email, role: payload.role, name: resolveNameFromEmail(payload.email) },
    });
  }

  return respondJSON(res, 400, { error: 'Acción desconocida' });
}
