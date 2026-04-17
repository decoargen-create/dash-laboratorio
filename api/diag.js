// Endpoint de diagnóstico público. NO revela valores de env vars sensibles,
// sólo si están configuradas y si parsean. Sirve para diagnosticar problemas
// de deploy sin tener que abrir la consola de Vercel.
//
// Uso: GET https://<tu-url>/api/diag
// Devuelve un JSON con el estado de cada variable y un summary general.

function parseUsers(env) {
  if (!env) return null;
  try {
    const parsed = JSON.parse(env);
    if (!Array.isArray(parsed)) return { error: 'no es array' };
    return {
      count: parsed.length,
      validCount: parsed.filter(u => u && typeof u.u === 'string' && typeof u.h === 'string').length,
      usernames: parsed.map(u => u.u || '(sin u)').filter(Boolean),
    };
  } catch (err) {
    return { error: 'JSON inválido: ' + err.message };
  }
}

export default function handler(req, res) {
  const env = process.env;

  const authSecretLen = (env.AUTH_SECRET || '').length;
  const usersInfo = parseUsers(env.AUTH_USERS);

  const checks = {
    AUTH_SECRET: {
      configured: !!env.AUTH_SECRET,
      length: authSecretLen,
      ok: authSecretLen >= 16,
      hint: authSecretLen === 0
        ? 'Faltante. Generala con `openssl rand -hex 32` y pegala como env var.'
        : authSecretLen < 16
        ? 'Muy corta, mínimo 16 chars recomendados.'
        : 'OK',
    },
    AUTH_USERS: {
      configured: !!env.AUTH_USERS,
      raw_length: (env.AUTH_USERS || '').length,
      parsed: usersInfo,
      ok: usersInfo && !usersInfo.error && usersInfo.validCount > 0,
      hint: !env.AUTH_USERS
        ? 'Faltante. Pegá el JSON con tus usuarios. Después hacé Redeploy.'
        : usersInfo?.error
        ? `Inválido: ${usersInfo.error}`
        : usersInfo?.validCount === 0
        ? 'JSON OK pero sin usuarios válidos. Cada uno necesita "u" y "h".'
        : `OK — ${usersInfo.validCount} usuario(s): ${usersInfo.usernames.join(', ')}`,
    },
    ANTHROPIC_API_KEY: {
      configured: !!env.ANTHROPIC_API_KEY,
      ok: !!env.ANTHROPIC_API_KEY,
      hint: env.ANTHROPIC_API_KEY ? 'OK (chatbot habilitado)' : 'Faltante (el chatbot no va a andar, pero el login sí).',
    },
    AUTH_USERS_FIRST_BYTES: env.AUTH_USERS
      ? env.AUTH_USERS.slice(0, 2)
      : null,
    deployment: {
      timestamp: new Date().toISOString(),
      vercel: !!env.VERCEL,
      region: env.VERCEL_REGION || 'local',
      env: env.VERCEL_ENV || 'local',
    },
  };

  const allOk = checks.AUTH_SECRET.ok && checks.AUTH_USERS.ok;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    summary: allOk ? 'Todo OK, podés loguearte.' : 'Hay env vars faltantes o mal configuradas.',
    checks,
  }, null, 2));
}
