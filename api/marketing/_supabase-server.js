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
    return row?.data?.docs || {};
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
