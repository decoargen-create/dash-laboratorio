// Cliente Supabase server-side para los endpoints de generación de
// creativos. Se usa service_role key (bypassea RLS — la auth la hacemos
// manualmente verificando el JWT del user que vino en Authorization).
//
// Por qué service_role en vez de pasar el token del user al client:
// el client de service_role tiene permisos para Storage upload y DB
// insert sin depender de RLS, lo que simplifica el manejo de errores.
// Verificamos auth.getUser(token) para confirmar la identidad antes de
// cualquier write.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
// Fallback entre dos nombres porque el resto del codebase usa
// SUPABASE_SERVICE_ROLE_KEY. Antes esta divergencia hacía que getUserIdFromAuth
// devolviera 401 silenciosamente aunque el token fuera válido.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// ¿Está configurado Supabase server-side? Lo usa /api/meta para decidir si
// guarda las conexiones en DB (multi-cuenta) o cae al modo cookie (single).
export function isSupabaseConfigured() {
  return !!getClient();
}

// Cliente service-role crudo (bypassa RLS). Úsalo SOLO en el server y después
// de verificar la identidad/rol del caller con getUserIdFromAuth + getUserRole.
export function getServiceClient() {
  return getClient();
}

// Rol del user en public.profiles ('admin' | 'creator' | 'user' | ...).
// null si no hay Supabase o el user no existe.
export async function getUserRole(userId) {
  const supabase = getClient();
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (error) return null;
    return data?.role || null;
  } catch {
    return null;
  }
}

// Lee Authorization: Bearer <token>, verifica con Supabase y devuelve el
// user.id. null si el token no es válido.
export async function getUserIdFromAuth(req) {
  const supabase = getClient();
  if (!supabase) return null;
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

// =========================================================================
// META_CONNECTIONS — cuentas publicitarias guardadas por el user
// =========================================================================
// El access_token se cifra en reposo con AES-256-GCM usando una clave
// derivada de AUTH_SECRET. Si AUTH_SECRET no está seteada, se guarda en claro
// (no ideal, pero la tabla ya es service_role-only y queda funcional).

function tokenKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(String(secret)).digest(); // 32 bytes
}

function encryptToken(plain) {
  const key = tokenKey();
  if (!key) return plain; // sin clave → plano
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Prefijo de versión para distinguir de tokens en claro legacy.
  return 'v1:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptToken(stored) {
  if (!stored) return null;
  if (!String(stored).startsWith('v1:')) return stored; // claro legacy
  const key = tokenKey();
  if (!key) return null;
  try {
    const raw = Buffer.from(String(stored).slice(3), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// =========================================================================
// GOOGLE OAUTH — refresh_token del dueño del lab para subir a SU Drive.
// Tabla public.google_oauth (service-role only). El refresh_token se cifra.
// Es lab-wide: guardamos el del/los admin(s); las subidas (admin o creator)
// usan el más reciente. El token NUNCA sale del server.
// =========================================================================
export async function saveGoogleOAuth(userId, refreshToken, email) {
  const supabase = getClient();
  if (!supabase || !userId || !refreshToken) return false;
  const { error } = await supabase.from('google_oauth').upsert({
    id: userId,
    email: email || null,
    refresh_token: encryptToken(refreshToken),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) { console.warn('[oauth] save:', error.message); return false; }
  return true;
}

// Devuelve { refreshToken, email } de la conexión más reciente, o null.
export async function getGoogleOAuth() {
  const supabase = getClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('google_oauth')
      .select('refresh_token,email,updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const rt = decryptToken(data.refresh_token);
    if (!rt) return null;
    return { refreshToken: rt, email: data.email || null };
  } catch (e) {
    // Tabla inexistente (migración sin aplicar) → tratamos como "no conectado".
    return null;
  }
}

export async function deleteGoogleOAuth(userId) {
  const supabase = getClient();
  if (!supabase) return false;
  try {
    const q = supabase.from('google_oauth').delete();
    const { error } = userId ? await q.eq('id', userId) : await q.neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) { console.warn('[oauth] delete:', error.message); return false; }
    return true;
  } catch { return false; }
}

// Lista las conexiones del user SIN el access_token (nunca se expone).
export async function listMetaConnections(userId) {
  const supabase = getClient();
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('meta_connections')
    .select('id,label,meta_user_id,meta_user_name,created_at,updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

// Inserta una conexión nueva. Devuelve la fila SIN el token.
export async function insertMetaConnection(userId, { label, metaUserId, metaUserName, accessToken }) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase no configurado');
  const id = crypto.randomUUID();
  const row = {
    id,
    user_id: userId,
    label: (label && String(label).trim()) || metaUserName || 'Cuenta Meta',
    meta_user_id: metaUserId || null,
    meta_user_name: metaUserName || null,
    access_token: encryptToken(accessToken),
  };
  const { data, error } = await supabase
    .from('meta_connections')
    .insert(row)
    .select('id,label,meta_user_id,meta_user_name,created_at,updated_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Devuelve el access_token (descifrado) de una conexión del user. Server-only.
export async function getMetaConnectionToken(userId, connectionId) {
  const supabase = getClient();
  if (!supabase || !userId || !connectionId) return null;
  const { data, error } = await supabase
    .from('meta_connections')
    .select('access_token')
    .eq('user_id', userId)
    .eq('id', connectionId)
    .maybeSingle();
  if (error || !data) return null;
  return decryptToken(data.access_token);
}

// Última conexión de Meta guardada (la más nueva de cualquier usuario) con su
// token descifrado. Server-only: la usan el cron y los procesos automáticos
// (auto-winners) que corren sin cookie ni sesión de browser.
export async function getLatestMetaToken() {
  const supabase = getClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('meta_connections')
      .select('access_token, user_id, meta_user_name, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const token = decryptToken(data.access_token);
    return token ? { token, userId: data.user_id, name: data.meta_user_name } : null;
  } catch { return null; }
}

// ¿De qué dueño es miembro este user (cuenta POR ÁREA, migración 0042)?
// Devuelve el uuid del dueño si la membresía existe y tiene el área pedida
// (area null = cualquier membresía); null si no es miembro.
export async function getMiembroOwner(userId, area = null) {
  const supabase = getClient();
  if (!supabase || !userId) return null;
  try {
    const { data } = await supabase
      .from('cuenta_miembros')
      .select('owner_id, areas')
      .eq('member_id', userId)
      .maybeSingle();
    if (!data?.owner_id) return null;
    if (area && !(data.areas || []).includes(area)) return null;
    return data.owner_id;
  } catch { return null; }
}

// Conexión de Meta más nueva DE UN DUEÑO puntual (token descifrado). La usan
// los procesos server-side por inquilino (cron de auto-winners): el token de
// "cualquier usuario" servía con un solo dueño, pero con varias cuentas cada
// corrida tiene que usar el token del dueño de SUS tarjetas.
export async function getMetaTokenForUser(userId) {
  const supabase = getClient();
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('meta_connections')
      .select('access_token, user_id, meta_user_name')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const token = decryptToken(data.access_token);
    return token ? { token, userId: data.user_id, name: data.meta_user_name } : null;
  } catch { return null; }
}

export async function deleteMetaConnection(userId, connectionId) {
  const supabase = getClient();
  if (!supabase || !userId || !connectionId) return false;
  const { error } = await supabase
    .from('meta_connections')
    .delete()
    .eq('user_id', userId)
    .eq('id', connectionId);
  if (error) throw new Error(error.message);
  return true;
}

// Sube un base64 al bucket `creativos` con path `<userId>/<refId>.png` y
// devuelve la public URL.
export async function uploadCreativoToBucket(userId, refId, base64, mimeType = 'image/png') {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase no configurado');
  const buf = Buffer.from(base64, 'base64');
  const path = `${userId}/${refId}.png`;
  const { error } = await supabase.storage.from('creativos').upload(path, buf, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from('creativos').getPublicUrl(path);
  // Miniatura JPEG liviana para la grilla (best-effort): sin esto la galería
  // bajaba el PNG original (~1,5 MB) por cada cuadradito.
  const thumbPath = await subirThumbCreativo(supabase, path, buf);
  return { storagePath: path, imageUrl: publicUrl, thumbPath };
}

// Copia PERMANENTE de la imagen de un ad de la competencia. Las URLs del CDN
// de Meta vencen a los pocos días: sin copia propia, los ads scrapeados se
// veían en negro en cualquier otra PC o después de unas semanas. Se baja
// mientras la URL todavía sirve, se achica a JPEG 640px y se guarda en
// creativos/<uid>/ads/<adId>.jpg (bucket público → URL que no vence).
// Devuelve la URL pública o null (nunca rompe el scrape).
export async function guardarImagenAd(supabase, userId, adId, url) {
  if (!supabase || !userId || !adId || !url) return null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500) return null;
    const { default: sharp } = await import('sharp');
    const jpg = await sharp(buf).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 74, mozjpeg: true }).toBuffer();
    const safeId = String(adId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const path = `${userId}/ads/${safeId}.jpg`;
    const { error } = await supabase.storage.from('creativos').upload(path, jpg, { contentType: 'image/jpeg', upsert: true });
    if (error) return null;
    return supabase.storage.from('creativos').getPublicUrl(path).data?.publicUrl || null;
  } catch {
    return null;
  }
}

// Genera y sube la miniatura (…/<id>_thumb.jpg, 480px, ~40 KB) de un
// creativo. Devuelve el thumbPath o null si algo falla (nunca rompe el save).
export async function subirThumbCreativo(supabase, storagePath, buf) {
  try {
    const { default: sharp } = await import('sharp');
    const thumb = await sharp(buf).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    const tPath = String(storagePath).replace(/\.[a-z0-9]+$/i, '') + '_thumb.jpg';
    const { error } = await supabase.storage.from('creativos').upload(tPath, thumb, { contentType: 'image/jpeg', upsert: true });
    return error ? null : tPath;
  } catch (e) {
    console.warn('[thumb] no se pudo generar:', e.message);
    return null;
  }
}

// Genera signed URLs (1h por default) para una lista de storage paths del
// bucket `creativos`. El bucket es PRIVADO → la public URL guardada en la fila
// no funciona como <img src>. El frontend (`galeriaReferencialesCloud`) ya
// firma cuando lee con `createSignedUrls`, pero las respuestas inmediatas
// de `crear-creativo-referencial` / `crear-imagen-desde-idea` devuelven la
// public URL directo en `cloudCreativos[].imageUrl` → el render falla hasta
// que el user refresca y la query vuelve a pasar por la firma. Acá firmamos
// en el server para que la URL devuelta sea usable de una.
//
// Devuelve un Map<storagePath, signedUrl>. Si Storage falla, devuelve Map
// vacío y los callers caen al public URL como antes.
export async function createSignedUrlsForCreativos(storagePaths, expiresInSeconds = 3600) {
  const supabase = getClient();
  if (!supabase || !Array.isArray(storagePaths) || storagePaths.length === 0) {
    return new Map();
  }
  try {
    const { data, error } = await supabase.storage
      .from('creativos')
      .createSignedUrls(storagePaths, expiresInSeconds);
    if (error || !Array.isArray(data)) {
      console.warn('[createSignedUrlsForCreativos] error:', error?.message || 'no data');
      return new Map();
    }
    return new Map(data.map(s => [s.path, s.signedUrl]).filter(([p, u]) => p && u));
  } catch (err) {
    console.warn('[createSignedUrlsForCreativos] exception:', err.message);
    return new Map();
  }
}

// Inserta una fila en marketing_creativos. Devuelve el row insertado.
export async function insertCreativoRow(row) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase no configurado');
  const { data, error } = await supabase
    .from('marketing_creativos')
    .upsert(row, { onConflict: 'user_id,id' })
    .select()
    .single();
  if (error) throw new Error(`Insert marketing_creativos: ${error.message}`);
  return data;
}

// Lee los docs ya completados de un producto — útil para que el pipeline
// pueda reanudar si Vercel mató una invocación previa. Devuelve un objeto
// {research, avatar, offerBrief, beliefs, resumenEjecutivo} con lo que ya
// está guardado (puede tener undefined para los que faltan).
export async function readProductoDocs(userId, productoId) {
  const supabase = getClient();
  if (!supabase || !userId || !productoId) return {};
  try {
    const { data: row } = await supabase
      .from('marketing_productos')
      .select('data')
      .eq('user_id', userId)
      .eq('id', String(productoId))
      .maybeSingle();
    const docs = { ...(row?.data?.docs || {}) };
    // Fallback: el cliente legacy puede haber guardado resumenEjecutivo en
    // root en vez de docs.* — para que la reanudación lo detecte, mergeamos.
    if (!docs.resumenEjecutivo && row?.data?.resumenEjecutivo) {
      docs.resumenEjecutivo = row.data.resumenEjecutivo;
    }
    return docs;
  } catch (err) {
    console.warn(`[readProductoDocs] error: ${err.message}`);
    return {};
  }
}

// Hace patch a producto.data.docs[key] = content. Lee el row, mergea, escribe.
// Útil para que el pipeline server-side persista cada paso a medida que
// los termina — así si el usuario cierra la pestaña, los docs no se pierden
// (en el próximo pull aparecen). Si el producto no existe (todavía no se
// pusheó del cliente), no-op silencioso.
export async function patchProductoDocs(userId, productoId, partialDocs) {
  const supabase = getClient();
  if (!supabase || !userId || !productoId) return null;
  // Leer el row actual (necesitamos el data completo para mergear)
  const { data: row, error: errRead } = await supabase
    .from('marketing_productos')
    .select('data')
    .eq('user_id', userId)
    .eq('id', String(productoId))
    .maybeSingle();
  if (errRead) {
    console.warn(`[patchProductoDocs] read failed: ${errRead.message}`);
    return null;
  }
  if (!row) {
    // Producto no existe server-side todavía — es probable que el frontend
    // aún no haya pushed. No fallamos; el frontend va a sincronizar después.
    console.info(`[patchProductoDocs] producto ${productoId} no existe en cloud — skip`);
    return null;
  }
  const merged = {
    ...(row.data || {}),
    docs: { ...(row.data?.docs || {}), ...partialDocs },
    updated_at: new Date().toISOString(),
  };
  const { error: errWrite } = await supabase
    .from('marketing_productos')
    .update({ data: merged })
    .eq('user_id', userId)
    .eq('id', String(productoId));
  if (errWrite) {
    console.warn(`[patchProductoDocs] write failed: ${errWrite.message}`);
    return null;
  }
  return merged;
}
