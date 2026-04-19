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
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  const metaAppId = env.META_APP_ID || '';
  const metaAppSecret = env.META_APP_SECRET || '';

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
      configured: !!anthropicKey,
      length: anthropicKey.length,
      ok: anthropicKey.startsWith('sk-ant-'),
      hint: !anthropicKey
        ? 'Faltante. Chatbot, agentes y pipelines de Marketing no van a andar.'
        : !anthropicKey.startsWith('sk-ant-')
        ? 'No empieza con sk-ant-, ¿está bien pegada?'
        : 'OK (chatbot + agentes + marketing habilitados)',
    },
    META_APP_ID: {
      configured: !!metaAppId,
      length: metaAppId.length,
      ok: /^\d+$/.test(metaAppId),
      hint: !metaAppId
        ? 'Faltante. Sacala de developers.facebook.com → tu app → Config Básica.'
        : !/^\d+$/.test(metaAppId)
        ? 'Debería ser sólo dígitos.'
        : `OK — ${metaAppId.length} dígitos`,
    },
    META_APP_SECRET: {
      configured: !!metaAppSecret,
      length: metaAppSecret.length,
      ok: metaAppSecret.length >= 20,
      hint: !metaAppSecret
        ? 'Faltante. Sacala de Meta → Config Básica → App Secret (click Mostrar).'
        : metaAppSecret.length < 20
        ? 'Muy corta, normalmente son 32+ caracteres.'
        : 'OK',
    },
    deployment: {
      timestamp: new Date().toISOString(),
      vercel: !!env.VERCEL,
      region: env.VERCEL_REGION || 'local',
      env: env.VERCEL_ENV || 'local',
    },
  };

  const criticalOk = checks.AUTH_SECRET.ok && checks.AUTH_USERS.ok;
  const allOk = criticalOk && checks.ANTHROPIC_API_KEY.ok;
  const metaOk = checks.META_APP_ID.ok && checks.META_APP_SECRET.ok;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    summary: allOk
      ? (metaOk ? 'Todo OK, incluyendo Meta OAuth.' : 'OK para login + IA. Meta OAuth no configurado.')
      : criticalOk
      ? 'Login OK pero falta ANTHROPIC_API_KEY para IA.'
      : 'Hay env vars críticas faltantes o mal configuradas.',
    checks,
  }, null, 2));
}
