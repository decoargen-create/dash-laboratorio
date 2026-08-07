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
  const apifyToken = env.APIFY_TOKEN || '';
  const openaiKey = env.OPENAI_API_KEY || '';

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
    APIFY_TOKEN: {
      configured: !!apifyToken,
      length: apifyToken.length,
      ok: apifyToken.startsWith('apify_api_'),
      hint: !apifyToken
        ? 'Faltante. Sacala de Apify → Settings → Integrations → Personal API Token.'
        : !apifyToken.startsWith('apify_api_')
        ? 'El prefijo esperado es "apify_api_" — ¿seguro es el token correcto?'
        : 'OK (Ad Library scraping habilitado)',
    },
    OPENAI_API_KEY: {
      configured: !!openaiKey,
      length: openaiKey.length,
      ok: openaiKey.startsWith('sk-'),
      hint: !openaiKey
        ? 'Faltante. Whisper (transcripción de videos ganadores) no va a andar.'
        : !openaiKey.startsWith('sk-')
        ? 'Debería empezar con "sk-" — ¿pegaste la correcta?'
        : 'OK (Whisper habilitado)',
    },
    // Google Drive (subida de creativos de Producción + actas). Mostramos el
    // client_email de la service account (no es secreto y hace falta saberlo
    // para compartirle la carpeta) pero NUNCA la private key.
    GOOGLE_DRIVE: (() => {
      const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
      let creds = null;
      if (raw) {
        try { creds = JSON.parse(raw); }
        catch { try { creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')); } catch { creds = null; } }
      }
      const clientEmail = creds?.client_email || null;
      const tieneKey = !!creds?.private_key;
      const carpetaCreativos = env.DRIVE_CREATIVOS_FOLDER_ID || '';
      const carpetaTranscripts = env.DRIVE_TRANSCRIPTS_FOLDER_ID || '';
      const credsOk = !!(clientEmail && tieneKey);
      const carpetaOk = !!(carpetaCreativos || carpetaTranscripts);
      const oauthOk = !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
      // Diagnóstico de FORMA de las credenciales, sin exponer valores. Sirve
      // para cazar el error "The provided client secret is invalid": casi
      // siempre es un espacio/enter al pegar, un valor cambiado (client_id en el
      // slot del secret o al revés) o un secret que no arranca con GOCSPX-.
      const rawId = env.GOOGLE_OAUTH_CLIENT_ID || '';
      const rawSecret = env.GOOGLE_OAUTH_CLIENT_SECRET || '';
      const idTrim = rawId.trim();
      const secretTrim = rawSecret.trim();
      const idLooksLikeId = idTrim.endsWith('.apps.googleusercontent.com');
      const secretLooksLikeSecret = secretTrim.startsWith('GOCSPX-');
      const idLooksLikeSecret = idTrim.startsWith('GOCSPX-');
      const secretLooksLikeId = secretTrim.endsWith('.apps.googleusercontent.com');
      // Cruce LIMPIO (ID↔SECRET intercambiados): el código lo corrige solo.
      const autoCorrected = idLooksLikeSecret && secretLooksLikeId;
      const swapped = secretLooksLikeId || idLooksLikeSecret;
      const idHasSpaces = rawId !== idTrim;
      const secretHasSpaces = rawSecret !== secretTrim;
      let oauthHint;
      if (!oauthOk) oauthHint = 'Falta GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (credencial OAuth de Google Cloud). Es lo que hace que los videos suban a TU Drive personal.';
      else if (autoCorrected) oauthHint = 'ℹ️ CLIENT_ID y CLIENT_SECRET están CAMBIADOS de lugar en Vercel, PERO la app lo corrige sola (auto-swap), así que Drive funciona. Para dejarlo prolijo, poné el "GOCSPX-" en GOOGLE_OAUTH_CLIENT_SECRET y el ".apps.googleusercontent.com" en GOOGLE_OAUTH_CLIENT_ID.';
      else if (!secretLooksLikeSecret) oauthHint = '❌ El valor cargado en GOOGLE_OAUTH_CLIENT_SECRET NO es un secret válido (no empieza con "GOCSPX-"' + (secretLooksLikeId ? '; parece ser otro client_id' : '') + '). No hay forma de arreglarlo por código: poné el secret REAL — Google Cloud → APIs y servicios → Credenciales → tu cliente OAuth → "Restablecer secreto" → copiá el "GOCSPX-…" y pegalo en GOOGLE_OAUTH_CLIENT_SECRET en Vercel → Redeploy.';
      else if (idHasSpaces || secretHasSpaces) oauthHint = '⚠️ Hay espacios o un enter al principio/fin del ' + (secretHasSpaces ? 'CLIENT_SECRET' : 'CLIENT_ID') + '. El código ya los recorta, pero conviene re-pegar el valor limpio en Vercel.';
      else if (!idLooksLikeId) oauthHint = '⚠️ El CLIENT_ID no termina en ".apps.googleusercontent.com" — no parece un client_id de OAuth válido.';
      else oauthHint = 'Forma OK. Si igual da "client secret is invalid", el secret no corresponde a este client_id: regeneralo en Google Cloud (mismo cliente) y re-pegá ambos en Vercel.';
      return {
        // Camino RECOMENDADO para Drive personal (@gmail): OAuth del usuario.
        oauth: {
          GOOGLE_OAUTH_CLIENT_ID: { configured: !!env.GOOGLE_OAUTH_CLIENT_ID, length: idTrim.length, endsWithGoogle: idLooksLikeId, hasSpaces: idHasSpaces },
          GOOGLE_OAUTH_CLIENT_SECRET: { configured: !!env.GOOGLE_OAUTH_CLIENT_SECRET, length: secretTrim.length, startsWithGOCSPX: secretLooksLikeSecret, looksLikeId: secretLooksLikeId, hasSpaces: secretHasSpaces },
          swapped,
          autoCorrected,
          ok: oauthOk,
          hint: oauthHint,
        },
        // Camino service account (solo sirve con Google Workspace / shared drive).
        service_account_configured: !!raw,
        service_account_valida: credsOk,
        client_email: clientEmail,
        DRIVE_CREATIVOS_FOLDER_ID: { configured: !!carpetaCreativos, length: carpetaCreativos.length },
        DRIVE_TRANSCRIPTS_FOLDER_ID: { configured: !!carpetaTranscripts, length: carpetaTranscripts.length },
        ok: oauthOk || (credsOk && carpetaOk),
        hint: 'Para Drive PERSONAL (@gmail) usá OAuth (arriba). La service account solo sube en Google Workspace / shared drives.',
      };
    })(),
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
  const mktOk = checks.APIFY_TOKEN.ok && checks.OPENAI_API_KEY.ok;

  // Summary prioriza lo que falta, de más crítico a menos.
  let summary;
  if (!criticalOk) summary = 'Hay env vars críticas faltantes (login no va a andar).';
  else if (!checks.ANTHROPIC_API_KEY.ok) summary = 'Login OK pero falta ANTHROPIC_API_KEY para IA.';
  else if (allOk && metaOk && mktOk) summary = 'Todo OK: login + IA + Meta OAuth + Marketing (Apify + Whisper).';
  else if (allOk && metaOk) summary = 'Login + IA + Meta OAuth OK. Falta APIFY_TOKEN y/o OPENAI_API_KEY para Marketing.';
  else if (allOk && mktOk) summary = 'Login + IA + Marketing OK. Meta OAuth no configurado.';
  else if (allOk) summary = 'Login + IA OK. Faltan integraciones Meta y/o Marketing.';
  else summary = 'Hay env vars faltantes o mal configuradas.';

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ summary, checks }, null, 2));
}
