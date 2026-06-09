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
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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
  return { storagePath: path, imageUrl: publicUrl };
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
