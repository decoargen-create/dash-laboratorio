// Producción — lógica + UI de SUBIDA de creativos, compartida entre el tablero
// del admin (ProduccionSection) y el tablero del creator (CreatorWorkspace).
//
// Flujo de subida (idéntico para admin y creator):
//   1. Pide una "drive-session" al server (/api/produccion/drive-session), que
//      arma la carpeta correcta en Drive y devuelve una URL de subida directa.
//   2. El browser hace PUT del video directo a Drive (no pasa por Vercel).
//   3. Si Drive no está configurado, cae al bucket de Supabase (AdsLab).
//   4. Registra el archivo en la tarjeta (addArchivos) y, si estaba en
//      "Por hacer", la manda sola a "En revisión".
//
// Los writes al store (addArchivos/updateAssignment) ya son role-aware: para un
// creator van por la RPC produccion_creator_update; para un admin, directo.

import React, { useEffect, useRef, useState } from 'react';
import { Film, X, UploadCloud, Loader2, AlertTriangle, ExternalLink, Check, CheckCircle2 } from 'lucide-react';
import { supabase, getCurrentUser } from './supabase.js';
import { sparksAt, motionOk, confettiAt, stampAprobado } from './produccionFx.js';
import { playBulkDoneChime } from './sounds.js';
import { addArchivos, removeArchivo, replaceArchivo, clearCorregidoVideo, setAprobadoVideo, updateAssignment, setCorreccionVideo, refreshProduccion, VIDEOS_POR_PRODUCTO } from './produccionStore.js';

const BUCKET = 'creativos';

// Logo real de Google Drive (tricolor) — elegido por el user: un ícono que se
// sobreentiende solo, en lugar del "DRIVE" en texto.
export function DriveLogo({ size = 14 }) {
  return (
    <svg width={size} height={Math.round(size * 0.9)} viewBox="0 0 87.3 78" aria-hidden="true">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
      <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  );
}

// Aceptamos cualquier formato de video razonable. Lista amplia de extensiones
// + el chequeo de MIME 'video/*' (aceptaVideo abajo) cubren prácticamente todo
// lo que exportan celus, cámaras y editores. La lista y el `accept` del input
// se derivan de acá para no desincronizarse.
const VIDEO_EXTS = [
  'mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'f4v',
  'mpg', 'mpeg', 'm2v', 'mpe', 'm1v', 'mts', 'm2ts', 'ts', '3gp', '3g2',
  'ogv', 'ogg', 'mxf', 'vob', 'dv', 'hevc', 'h264', 'h265', 'asf', 'divx',
  'avchd', 'insv', 'mod', 'tod', 'rm', 'rmvb',
];
export const VIDEO_EXT = new RegExp(`\\.(${VIDEO_EXTS.join('|')})$`, 'i');
export const VIDEO_ACCEPT = ['video/*', ...VIDEO_EXTS.map(e => `.${e}`)].join(',');

// ¿Es un video? Vale si el navegador lo marca como video/* O si la extensión
// está en la lista amplia (para formatos que el SO no clasifica por MIME).
export const aceptaVideo = (f) => (f?.type || '').startsWith('video/') || VIDEO_EXT.test(f?.name || '');

export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function getAuthToken() {
  try { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ''; }
  catch { return ''; }
}

// Sondeo al server (sin efectos): ¿Drive conectado? + link a la carpeta raíz.
// Devuelve { configured, rootLink } o null si no se pudo consultar.
export async function probeDrive(productoNombre, persona, weekKey, cardId, folderId) {
  try {
    const token = await getAuthToken();
    const r = await fetch('/api/produccion/drive-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        probe: true,
        ...(productoNombre ? { productoNombre } : {}),
        ...(persona ? { persona } : {}),
        ...(weekKey ? { weekKey } : {}),
        ...(cardId ? { cardId } : {}),
        ...(folderId ? { folderId } : {}),
      }),
    });
    return await r.json().catch(() => null);
  } catch { return null; }
}

// PLAN B: subir a Drive VÍA NUESTRO SERVER en chunks (< 4MB c/u). Se usa
// cuando el PUT directo browser→Google falla (CORS u otro bloqueo): el server
// reenvía cada chunk a la sesión de Google con Content-Range, y ahí CORS no
// existe. También destraba los videos grandes (AdsLab corta en ~50MB).
async function uploadViaRelay(file, sess, token, onBytes) {
  const CHUNK = 15 * 256 * 1024; // 3.75MB — múltiplo de 256KiB (requisito de Google)
  const total = file.size;
  for (let start = 0; start < total; start += CHUNK) {
    const end = Math.min(start + CHUNK, total) - 1;
    const r = await fetch('/api/produccion/drive-chunk', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/octet-stream',
        'x-session-uri': sess.sessionUri,
        'x-content-range': `bytes ${start}-${end}/${total}`,
        'x-upload-content-type': sess.contentType || file.type || 'video/mp4',
      },
      body: file.slice(start, end + 1),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `relay HTTP ${r.status}`);
    // El chunk quedó arriba: reportamos bytes acumulados para la barra de progreso.
    onBytes?.(Math.min(end + 1, total), total);
    if (d.done) return d.file || {};
    if (d.status !== 308) throw new Error(d.error || `Google respondió ${d.status}`);
  }
  throw new Error('la sesión terminó sin confirmar el archivo');
}

async function uploadOne(file, ctx, onBytes) {
  const { token, weekKey, productoNombre, persona, cardId, folderId } = ctx;
  const pedirSesion = async () => {
    const r = await fetch('/api/produccion/drive-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ productoNombre, persona, weekKey, cardId, folderId, filename: file.name, mimeType: file.type || 'video/mp4', size: file.size, ...(ctx.force ? { force: true } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  let sess = null;
  for (let intento = 1; intento <= 2; intento++) {
    try {
      sess = await pedirSesion();
    } catch (e) {
      // Preservamos el motivo (antes se descartaba y el toast decía solo
      // "no configurado", sin poder diagnosticar).
      sess = { configured: false, error: e?.message || 'no se pudo abrir la subida' };
    }
    // Drive falló transitoriamente (OAuth): reintentamos UNA vez antes de
    // resignarnos a AdsLab — queremos que TODO termine en Drive.
    if (sess?.configured === false && sess?.reason === 'drive-oauth-transitorio' && intento < 2) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    break;
  }

  const armarArchivo = (meta) => {
    const link = meta.webViewLink || (meta.id ? `https://drive.google.com/file/d/${meta.id}/view` : sess.folderLink) || null;
    return {
      name: sess.finalName || file.name, driveId: meta.id || null, link,
      folderLink: sess.folderLink || null, folderId: sess.folderId || null,
      destino: 'drive', sizeMB: +(file.size / 1024 / 1024).toFixed(1), ts: uid(),
      // Ya había otro con este nombre pero otro peso → es una versión nueva.
      ...(sess.sameNameOtherSize ? { sameNameOtherSize: true } : {}),
    };
  };

  // El server detectó que ESE MISMO video (mismo nombre y mismo peso) ya está
  // en la carpeta: no lo subimos de nuevo. Devolvemos el que ya existe marcado
  // como `yaEstaba` — quien llama decide si lo registra en la tarjeta (cuando
  // la tarjeta no lo tenía anotado) o lo saltea.
  if (sess?.duplicate && sess.existing?.id) {
    return {
      name: sess.existing.name || file.name,
      driveId: sess.existing.id,
      link: sess.existing.link || null,
      folderLink: sess.folderLink || null,
      folderId: sess.folderId || null,
      destino: 'drive',
      sizeMB: +(file.size / 1024 / 1024).toFixed(1),
      ts: uid(),
      yaEstaba: true,
    };
  }

  // Guardamos el MOTIVO de cada intento fallido para el toast (diagnóstico).
  let driveReason = null;
  if (sess.configured && sess.sessionUri) {
    // Fast-path: PUT directo browser→Google, SOLO si la sesión quedó atada al
    // origin (corsBound !== false). Si no, vamos derecho al relay.
    if (sess.corsBound !== false) {
      try {
        const put = await fetch(sess.sessionUri, { method: 'PUT', headers: { 'Content-Type': sess.contentType || file.type || 'video/mp4' }, body: file });
        if (put.ok) return armarArchivo(await put.json().catch(() => ({})));
        driveReason = `directo HTTP ${put.status}`;
        try { const t = await put.text(); if (t) driveReason += `: ${t.slice(0, 120)}`; } catch { /* sin cuerpo */ }
      } catch (err) {
        driveReason = `directo: ${err?.message || 'bloqueado por el navegador (CORS)'}`;
      }
    }

    // Camino robusto: relay por NUESTRO server en chunks — inmune a CORS.
    try {
      return armarArchivo(await uploadViaRelay(file, sess, token, onBytes));
    } catch (e2) {
      driveReason = `${driveReason ? driveReason + ' | ' : ''}relay: ${e2?.message || e2}`;
      console.warn('[produccion] Drive falló:', driveReason, '— cayendo a AdsLab');
    }
  } else if (sess && sess.configured === false) {
    driveReason = sess.reason === 'drive-oauth-transitorio'
      ? `Drive conectado pero Google no respondió ahora${sess.error ? `: ${sess.error}` : ''}`
      : `no configurado${sess.reason ? ` (${sess.reason})` : ''}${sess.error ? `: ${sess.error}` : ''}`;
  }

  // POLÍTICA "Drive o nada": el equipo necesita los videos SÍ o SÍ en Google
  // Drive. Si no se pudo subir a Drive (ni con los reintentos), NO guardamos en
  // AdsLab — tiramos error claro y el video NO se registra. El user reintenta o
  // reconecta Drive. (Los videos viejos que YA están en AdsLab se rescatan con el
  // botón "Mover a Drive".)
  if (sess?.reason === 'drive-no-conectado') {
    throw new Error('Google Drive no está conectado — el video NO se subió. Conectalo en Ajustes → Conectar Drive y reintentá.');
  }
  if (sess?.reason === 'drive-oauth-transitorio') {
    throw new Error('Google no respondió en este momento — el video NO se subió. Probá de nuevo en un minuto.');
  }
  throw new Error(`No se pudo subir a Google Drive — el video NO se guardó. Reintentá${driveReason ? ` (detalle: ${driveReason})` : ''}.`);
}

// Un video que YA estaba en Drive se anota en la tarjeta solo si esta no lo
// tenía registrado (mismo driveId o mismo nombre). Devuelve true si lo agregó.
// Sin esto, reintentar una subida ya hecha sumaba una fila repetida a la
// tarjeta aunque en Drive hubiera un solo archivo.
function registrarSiFalta(a, archivo) {
  const yaRegistrado = (a.archivos || []).some(f =>
    (archivo.driveId && f.driveId === archivo.driveId) || f.name === archivo.name);
  if (yaRegistrado) return false;
  addArchivos(a.id, [archivo]);
  return true;
}

// Toasts de la deduplicación: qué se salteó y qué entró como versión nueva.
function avisarDuplicados({ yaEstaban, versionNueva, addToast }) {
  if (yaEstaban > 0) {
    addToast?.({
      type: 'info',
      message: `${yaEstaban} video${yaEstaban > 1 ? 's ya estaban' : ' ya estaba'} en la carpeta — no ${yaEstaban > 1 ? 'los' : 'lo'} volví a subir.`,
    });
  }
  if (versionNueva > 0) {
    addToast?.({
      type: 'warning',
      message: `${versionNueva} video${versionNueva > 1 ? 's tienen' : ' tiene'} el mismo nombre que otro de la carpeta pero distinto peso — ${versionNueva > 1 ? 'se subieron' : 'se subió'} como versión nueva.`,
    });
  }
}

// Sube una tanda de videos a una tarjeta y, si estaba en "Por hacer", la manda
// sola a "En revisión" (así el equipo sube y de una queda para revisar).
export async function subirParaTarjeta(a, fileList, { onProgress, addToast } = {}) {
  const files = Array.from(fileList || []).filter(aceptaVideo);
  if (files.length === 0) { addToast?.({ type: 'warning', message: 'Elegí un archivo de video.' }); return { ok: 0 }; }
  const user = await getCurrentUser();
  if (!user) { addToast?.({ type: 'error', message: 'Iniciá sesión de nuevo.' }); return { ok: 0 }; }
  const token = await getAuthToken();
  const ctx = {
    user, token, weekKey: a.weekKey, productoNombre: a.productoNombre, persona: a.persona || 'Equipo',
    cardId: a.id,
    folderId: (a.archivos || []).find(f => f.folderId)?.folderId || null,
  };
  const eraPorHacer = a.estado === 'porhacer';
  const yaTenia = a.archivos?.length || 0;
  const objetivo = a.videosTotal || VIDEOS_POR_PRODUCTO;
  let ok = 0, dest = 'drive', driveWarn = null, yaEstaban = 0, versionNueva = 0;
  // Progreso GLOBAL por bytes (barra + % + ETA + velocidad). Todas las subidas a
  // Drive van por el relay en chunks → reportan bytes reales; el fallback a
  // AdsLab no reporta chunks, así que ahí la barra salta al terminar el archivo.
  const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0);
  const t0 = Date.now();
  let sentBefore = 0; // bytes de archivos ya terminados
  const emit = (i, sentThisFile) => {
    const sentAll = sentBefore + sentThisFile;
    const elapsed = (Date.now() - t0) / 1000;
    const bps = elapsed > 0.4 ? sentAll / elapsed : 0;      // velocidad promedio
    const pct = totalBytes > 0 ? Math.min(1, sentAll / totalBytes) : 0;
    const eta = bps > 0 ? Math.max(0, (totalBytes - sentAll) / bps) : null;
    onProgress?.({ i, total: files.length, name: files[i].name, pct, bps, eta });
  };
  for (let i = 0; i < files.length; i++) {
    emit(i, 0);
    try {
      const archivo = await uploadOne(files[i], ctx, (sent) => emit(i, sent));
      if (archivo.yaEstaba) {
        // El video ya estaba en la carpeta: no se volvió a subir. Solo lo
        // anotamos si la tarjeta no lo tenía registrado (p. ej. se subió desde
        // otra sesión), así el contador de la tarjeta refleja lo que hay.
        yaEstaban++;
        if (registrarSiFalta(a, archivo)) ok++;
      } else {
        addArchivos(a.id, [archivo]); ok++; dest = archivo.destino;
        if (archivo.sameNameOtherSize) versionNueva++;
      }
      if (!driveWarn && archivo.driveError) driveWarn = archivo.driveError;
    }
    catch (err) { addToast?.({ type: 'error', message: `"${files[i].name}": ${err.message}` }); }
    sentBefore += (files[i].size || 0);
  }
  // Regla: recién pasa a "En revisión" cuando se completan los N videos (no con el
  // primero). Antes se movía con ok>0, lo que la mandaba a revisión incompleta.
  const completo = eraPorHacer && (yaTenia + ok) >= objetivo;
  if (completo) updateAssignment(a.id, { estado: 'revision' });
  if (ok > 0) addToast?.({ type: 'success', message: `${ok} video${ok > 1 ? 's' : ''} → ${dest === 'drive' ? 'Google Drive' : 'AdsLab'}${completo ? ' · pasó a En revisión' : ''}` });
  avisarDuplicados({ yaEstaban, versionNueva, addToast });
  if (driveWarn) addToast?.({ type: 'warning', message: `⚠ Drive falló (${driveWarn}) — se guardó en AdsLab. Pasale este texto a Claude.` });
  return { ok, yaEstaban };
}

// Reemplaza UN video de la tarjeta por su versión corregida:
//   1. Sube el archivo nuevo con force (el dedupe de drive-session no aplica:
//      reemplazar ES subir algo que puede llamarse/pesar igual que lo que hay).
//   2. Pisa la fila del viejo EN SU LUGAR (conserva el número de video) — el
//      archivo nuevo entra sin `correccion`, o sea que salda el pedido.
//   3. Manda el viejo a la papelera de Drive (best effort — si falla, el
//      reemplazo en la tarjeta ya está hecho y solo queda un huérfano en la
//      carpeta) o lo borra de AdsLab si era del fallback.
//   4. Si la tarjeta estaba en "Por hacer" y no quedan correcciones
//      pendientes, vuelve sola a "En revisión".
export async function reemplazarVideo(a, viejo, file, { addToast } = {}) {
  if (!aceptaVideo(file)) { addToast?.({ type: 'warning', message: 'Elegí un archivo de video.' }); return { ok: false }; }
  const user = await getCurrentUser();
  if (!user) { addToast?.({ type: 'error', message: 'Iniciá sesión de nuevo.' }); return { ok: false }; }
  const token = await getAuthToken();
  const ctx = {
    user, token, weekKey: a.weekKey, productoNombre: a.productoNombre, persona: a.persona || 'Equipo',
    cardId: a.id,
    folderId: (a.archivos || []).find(f => f.folderId)?.folderId || viejo.folderId || null,
    force: true,
  };
  const archivo = await uploadOne(file, ctx); // tira si falla — el caller muestra el error
  // Marca verde "Corregido" para quien revisa: guarda qué se pedía y cuándo se
  // reemplazó. El store le estampa quién (conoce el actor). Se muestra mientras
  // la tarjeta está en Por hacer / En revisión; al aprobar desaparece sola.
  archivo.corregido = {
    nota: viejo.correccion?.texto || null,
    de: viejo.name || null,
    ts: new Date().toISOString(),
  };
  replaceArchivo(a.id, viejo.ts, archivo);

  // El viejo, afuera: papelera de Drive (recuperable 30 días) o storage AdsLab.
  if (viejo.driveId) {
    fetch('/api/produccion/drive-trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ fileId: viejo.driveId }),
    }).catch(() => {});
  } else if (viejo.storagePath) {
    supabase.storage.from(BUCKET).remove([viejo.storagePath]).catch(() => {});
  }

  // ¿Quedan correcciones en OTROS videos? (el del viejo quedó saldado)
  const restantes = (a.archivos || []).filter(f => f.ts !== viejo.ts && f.correccion?.texto).length;
  const paso = a.estado === 'porhacer' && restantes === 0;
  if (paso) updateAssignment(a.id, { estado: 'revision' });
  return { ok: true, paso, restantes, destino: archivo.destino, driveError: archivo.driveError || null, nuevoTs: archivo.ts };
}

// Mueve a Google Drive los videos de una tarjeta que quedaron en AdsLab (por un
// hipo de Drive al subirse). Corre server-side (endpoint drive-migrate): el
// service role lee el bucket por-usuario y sube al Drive del dueño; solo borra la
// copia de AdsLab DESPUÉS de confirmar el archivo en Drive. Secuencial (una por
// vez) para no pisar la fila de la tarjeta. El server actualiza el registro; acá
// refrescamos al final.
export async function moverArchivosADrive(a, { onProgress, addToast } = {}) {
  const token = await getAuthToken();
  const pendientes = (a.archivos || []).filter(f => f && f.destino !== 'drive' && f.storagePath);
  if (pendientes.length === 0) { addToast?.({ type: 'info', message: 'No hay videos en AdsLab para mover.' }); return { ok: 0, fail: 0 }; }
  let ok = 0, fail = 0, firstErr = null;
  for (let i = 0; i < pendientes.length; i++) {
    const f = pendientes[i];
    onProgress?.({ i, total: pendientes.length, name: f.name });
    try {
      const r = await fetch('/api/produccion/drive-migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ cardId: a.id, storagePath: f.storagePath }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      ok++;
    } catch (e) {
      fail++; if (!firstErr) firstErr = e?.message || 'error';
      console.warn(`[produccion] mover a Drive "${f.name}" falló:`, e?.message || e);
    }
  }
  onProgress?.({ i: pendientes.length, total: pendientes.length, done: true });
  // El server ya actualizó la fila (adslab→drive) — traemos los cambios.
  try { await refreshProduccion(); } catch {}
  if (ok > 0) addToast?.({ type: fail ? 'warning' : 'success', message: `${ok} video${ok > 1 ? 's' : ''} movido${ok > 1 ? 's' : ''} a Google Drive${fail ? ` · ${fail} fallaron` : ''}` });
  if (fail > 0 && ok === 0) addToast?.({ type: 'error', message: `No pude mover a Drive: ${firstErr}` });
  return { ok, fail };
}

// Festejo de "Aprobar todos" (elegido por el user: cascada + confeti + sello
// + chime + toast con resumen). `el` es el contenedor donde estampar el sello
// (tiene que poder ser position:relative). La CASCADA la hace el caller
// aprobando de a uno con stagger; esto es el gran final.
export function festejarAprobado(a, el, addToast) {
  try {
    if (el) {
      el.style.position = el.style.position || 'relative';
      confettiAt(el);
      stampAprobado(el);
    } else {
      confettiAt(document.body);
    }
  } catch {}
  playBulkDoneChime();
  const subidos = a.archivos?.length || 0;
  const nCorr = (a.archivos || []).filter(f => f.corregido).length;
  const dias = a.createdAt ? Math.max(1, Math.round((Date.now() - Date.parse(a.createdAt)) / 86400000)) : null;
  addToast?.({
    type: 'success',
    message: `🎉 ${a.productoNombre || 'Producto'} aprobado — ${subidos} video${subidos !== 1 ? 's' : ''} de ${a.persona || 'Equipo'}`
      + (nCorr > 0 ? ` · ${nCorr} corrección${nCorr !== 1 ? 'es' : ''} resuelta${nCorr !== 1 ? 's' : ''}` : '')
      + (dias ? ` · ciclo: ${dias} día${dias !== 1 ? 's' : ''}` : ''),
  });
}

// Aprueba los videos pendientes DE A UNO con un pequeño stagger (la cascada
// que eligió el user) y al final cambia el estado y festeja. Devuelve una
// promesa que resuelve cuando terminó todo.
export function aprobarTodosConCascada(a, el, addToast) {
  const pendientes = (a.archivos || []).filter(f => !f.aprobado);
  const paso = motionOk() ? 150 : 0;
  return new Promise(resolve => {
    pendientes.forEach((f, i) => setTimeout(() => setAprobadoVideo(a.id, f.ts, true), i * paso));
    setTimeout(() => {
      updateAssignment(a.id, { estado: 'aprobado' });
      festejarAprobado(a, el, addToast);
      resolve();
    }, pendientes.length * paso + 60);
  });
}

// Anillo de progreso de aprobación — va en el header del detalle de la
// tarjeta (admin y creator). Verde cónico según aprobados/subidos.
export function AnilloAprobados({ a, size = 44 }) {
  const subidos = a.archivos?.length || 0;
  const aprob = Math.min((a.archivos || []).filter(f => f.aprobado).length || a.videosAprobados || 0, subidos);
  const pct = subidos > 0 ? Math.round((aprob / subidos) * 100) : 0;
  const inner = size - 10;
  return (
    <div className="rounded-full grid place-items-center shrink-0" title={`${aprob} de ${subidos} videos aprobados`}
      style={{ width: size, height: size, background: `conic-gradient(#34d399 ${pct}%, rgba(127,140,170,.25) 0)` }}>
      <div className="rounded-full bg-white dark:bg-gray-900 grid place-items-center font-extrabold tabular-nums text-gray-800 dark:text-gray-100"
        style={{ width: inner, height: inner, fontSize: 10.5 }}>
        {subidos > 0 ? `${aprob}/${subidos}` : '—'}
      </div>
    </div>
  );
}

// Sección de creativos dentro de una tarjeta: lista de archivos ya subidos +
// dropzone + cola de subida. `canDelete` controla si se puede quitar un archivo
// ya subido (el admin sí; un creator también puede borrar los suyos).
export function CreativosSection({ a, addToast, canDelete = true, readOnly = false, canReview = false }) {
  const [files, setFiles] = useState([]); // { file, id, status, destino?, msg? }
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [corrEdit, setCorrEdit] = useState(null); // ts del video cuya corrección se edita
  const [corrText, setCorrText] = useState('');
  const [migrando, setMigrando] = useState(null); // { i, total, name } | null
  const inputRef = useRef(null);
  // Flujo "Reemplazar" (correcciones): a qué video va el archivo que se elija
  // en el input oculto, y cuál se está reemplazando (spinner + deshabilitar).
  const [replaceTarget, setReplaceTarget] = useState(null); // { f, nVid }
  const [replacingTs, setReplacingTs] = useState(null);
  // Efecto transitorio sobre una fila: { ts, kind: 'ok' | 'corr' | 'swap' }.
  // Vive como state (no clases imperativas) porque el store re-renderiza la
  // fila al cambiar — una clase puesta a mano en el DOM viejo se perdería.
  const [fx, setFx] = useState(null);
  const fireFx = (ts, kind) => {
    setFx({ ts, kind });
    setTimeout(() => setFx(cur => (cur && cur.ts === ts ? null : cur)), 900);
  };
  // Chispas del ✓: salen del botón ya re-renderizado (post-commit).
  useEffect(() => {
    if (fx?.kind === 'ok' && motionOk()) {
      const btn = document.querySelector(`[data-okbtn="${fx.ts}"]`);
      sparksAt(btn);
    }
  }, [fx]);
  const replaceInputRef = useRef(null);

  const onReplaceFile = async (file) => {
    const target = replaceTarget;
    setReplaceTarget(null);
    if (!file || !target) return;
    setReplacingTs(target.f.ts);
    try {
      const r = await reemplazarVideo(a, target.f, file, { addToast });
      if (r?.ok) {
        if (r.nuevoTs) fireFx(r.nuevoTs, 'swap');
        addToast?.({
          type: 'success',
          message: `Video ${target.nVid} reemplazado ✓${r.paso ? ' · la tarjeta volvió a En revisión'
            : r.restantes > 0 ? ` · falta${r.restantes > 1 ? 'n' : ''} ${r.restantes} corrección${r.restantes > 1 ? 'es' : ''}` : ''}`,
        });
        if (r.driveError) addToast?.({ type: 'warning', message: `⚠ Drive falló (${r.driveError}) — el reemplazo quedó en AdsLab.` });
      }
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude reemplazar el Video ${target.nVid}: ${err.message}` });
    } finally {
      setReplacingTs(null);
    }
  };
  const folderLink = (a.archivos || []).find(f => f.folderLink)?.folderLink;
  // ¿Todos los archivos cayeron a AdsLab? (pueden ser de ANTES de conectar Drive)
  const soloAdslab = (a.archivos?.length > 0) && !folderLink && a.archivos.every(f => f.destino !== 'drive');
  // Videos que quedaron en AdsLab y se pueden mover a Drive.
  const adslabVideos = (a.archivos || []).filter(f => f && f.destino !== 'drive' && f.storagePath);
  const moverADrive = async () => {
    if (migrando || adslabVideos.length === 0) return;
    const n = adslabVideos.length;
    if (!window.confirm(`¿Mover ${n} video${n > 1 ? 's' : ''} de AdsLab a Google Drive? Se copian a la carpeta de la tarjeta y recién se sacan de AdsLab cuando se confirmó que quedaron en Drive.`)) return;
    setMigrando({ i: 0, total: n, name: '' });
    try {
      await moverArchivosADrive(a, { addToast, onProgress: (p) => setMigrando(p.done ? null : p) });
    } finally { setMigrando(null); }
  };

  // Sondeo real al server: ¿Drive está conectado HOY? Así el cartel no miente
  // cuando la tarjeta solo tiene videos viejos de AdsLab.
  // Sondeo con el producto: trae si Drive está conectado + el link a la
  // carpeta del producto (se asegura de que exista), para ofrecer "carpeta de
  // Drive" SIEMPRE que la conexión esté viva, tenga o no videos en Drive.
  const [drive, setDrive] = useState(null); // { configured, rootLink, prodLink, cardLink } | null
  useEffect(() => {
    let dead = false;
    probeDrive(a.productoNombre, a.persona, a.weekKey, a.id, (a.archivos || []).find(f => f.folderId)?.folderId || null).then(d => { if (!dead && d) setDrive(d); });
    return () => { dead = true; };
  }, [a.productoNombre, a.persona, a.weekKey]);
  // Prioridad: la carpeta EXACTA de la tarjeta (donde están/irán los videos).
  const driveFolder = folderLink || drive?.cardLink || drive?.prodLink || drive?.rootLink || null;

  // Ver un video guardado en AdsLab: el bucket es privado, así que generamos
  // un link firmado (1h) al momento del click.
  const verVideo = async (f) => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storagePath, 3600);
      if (error || !data?.signedUrl) throw new Error(error?.message || 'no se pudo firmar el link');
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (err) {
      addToast?.({ type: 'error', message: `No pude abrir "${f.name}": ${err.message}` });
    }
  };

  const addFiles = (list) => {
    const nuevos = Array.from(list || [])
      .filter(aceptaVideo)
      .map(f => ({ file: f, id: uid(), status: 'espera' }));
    if (nuevos.length === 0) { addToast?.({ type: 'warning', message: 'Arrastrá archivos de video.' }); return; }
    setFiles(prev => [...prev, ...nuevos]);
  };

  const subir = async () => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const user = await getCurrentUser();
      if (!user) { addToast?.({ type: 'error', message: 'Iniciá sesión de nuevo.' }); return; }
      const token = await getAuthToken();
      const ctx = {
        user, token, weekKey: a.weekKey, productoNombre: a.productoNombre, persona: a.persona || 'Equipo',
        cardId: a.id,
        folderId: (a.archivos || []).find(f => f.folderId)?.folderId || null,
      };
      const eraPorHacer = a.estado === 'porhacer';
      const yaTenia = a.archivos?.length || 0;
      const objetivo = a.videosTotal || VIDEOS_POR_PRODUCTO;
      let ok = 0, dest = 'drive', driveWarn = null, yaEstaban = 0, versionNueva = 0;
      for (const item of files) {
        if (item.status === 'ok') continue;
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'subiendo' } : f));
        try {
          const archivo = await uploadOne(item.file, ctx);
          if (archivo.yaEstaba) {
            yaEstaban++;
            if (registrarSiFalta(a, archivo)) ok++;
            setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'ok', destino: 'drive', msg: 'ya estaba' } : f));
            continue;
          }
          addArchivos(a.id, [archivo]);
          ok++; dest = archivo.destino;
          if (archivo.sameNameOtherSize) versionNueva++;
          if (!driveWarn && archivo.driveError) driveWarn = archivo.driveError;
          setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'ok', destino: archivo.destino } : f));
        } catch (err) {
          setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', msg: err.message } : f));
        }
      }
      // Regla: solo pasa a "En revisión" cuando están subidos los N videos.
      const completoAhora = (yaTenia + ok) >= objetivo;
      const paso = eraPorHacer && completoAhora;
      if (paso) updateAssignment(a.id, { estado: 'revision' });
      if (ok > 0) addToast?.({ type: 'success', message: `${ok} video${ok > 1 ? 's' : ''} → ${dest === 'drive' ? 'Google Drive' : 'AdsLab'}${paso ? ' · completo, pasó a En revisión ✓' : (eraPorHacer ? ` · ${yaTenia + ok}/${objetivo}` : '')}` });
      avisarDuplicados({ yaEstaban, versionNueva, addToast });
      if (driveWarn) addToast?.({ type: 'warning', message: `⚠ Drive falló (${driveWarn}) — se guardó en AdsLab. Pasale este texto a Claude.` });
      setFiles(prev => prev.filter(f => f.status !== 'ok'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <UploadCloud size={13} className="text-gray-400" />
        <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Creativos</span>
        {/* Link a la carpeta SIEMPRE que Drive esté conectado: la de esta tanda
            si ya hay videos en Drive, o la del producto si no. */}
        {driveFolder && drive?.configured !== false && (
          <a href={driveFolder} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-brand-500 hover:text-brand-600 inline-flex items-center gap-0.5 ml-1">
            ▶ carpeta de Drive <ExternalLink size={10} />
          </a>
        )}
        {adslabVideos.length > 0 && drive?.configured === true && (
          <button onClick={moverADrive} disabled={!!migrando}
            title="Sube estos videos (que quedaron en AdsLab) a la carpeta de Drive de la tarjeta y los saca de AdsLab — recién cuando se confirmó que quedaron en Drive."
            className="ml-1 inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 dark:text-brand-300 border border-brand-300 dark:border-brand-700 rounded-md px-1.5 py-0.5 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition disabled:opacity-60">
            {migrando
              ? <><Loader2 size={11} className="animate-spin" /> Moviendo {Math.min(migrando.i + 1, migrando.total)}/{migrando.total}…</>
              : <><UploadCloud size={11} /> Mover {adslabVideos.length} a Drive</>}
          </button>
        )}
        {soloAdslab && drive?.configured === false && (
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 ml-1 cursor-help"
            title="Google Drive no está conectado, así que los videos se guardan en AdsLab (podés verlos con el ícono de cada archivo). Para que vayan a una carpeta de Drive: configurar DRIVE_CREATIVOS_FOLDER_ID en Vercel.">
            ⚠ Drive no conectado — se guardan en AdsLab
          </span>
        )}
      </div>

      {/* Archivos ya subidos — numerados (Video 1, 2, 3…) con corrección por video */}
      {(a.archivos?.length > 0) && (
        <div className="space-y-1 mb-2">
          {a.archivos.map((f, idx) => {
            const corr = f.correccion?.texto ? f.correccion : null;
            const editing = corrEdit === f.ts;
            const nVid = idx + 1;
            // Marca verde "Corregido": el video es un reemplazo y nadie pidió
            // una corrección NUEVA sobre él (el ámbar le gana al verde). Solo
            // mientras la tarjeta sigue en el ciclo por hacer/revisión — al
            // aprobar, la marca ya cumplió su función y no se muestra más.
            const fixed = (!corr && f.corregido && (a.estado === 'porhacer' || a.estado === 'revision')) ? f.corregido : null;
            return (
            <div key={f.ts}>
              <div className={`flex items-center gap-2 text-xs rounded px-2.5 py-1.5 ${fx?.ts === f.ts && fx.kind === 'ok' ? 'fx-flash' : ''} ${fx?.ts === f.ts && fx.kind === 'corr' ? 'fx-pulse-amber' : ''} ${fx?.ts === f.ts && fx.kind === 'swap' ? 'fx-swapin' : ''} ${corr ? 'bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-300 dark:ring-amber-800/60' : fixed ? 'bg-emerald-50 dark:bg-emerald-900/20 ring-1 ring-emerald-300 dark:ring-emerald-800/60' : 'bg-gray-50 dark:bg-gray-800'}`}>
                <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-black tabular-nums" title={`Video ${nVid}`}>{nVid}</span>
                <Film size={12} className="text-emerald-500 flex-shrink-0" />
                <span className="truncate flex-1 text-gray-700 dark:text-gray-200" title={f.name}>{f.name}</span>
                {fixed && (
                  <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 border border-emerald-400/50 rounded-full px-2 py-0.5">
                    <Check size={10} /> Corregido
                  </span>
                )}
                {/* Botonera "Todo íconos" (elegida por el user en el playground):
                    4 celdas FIJAS → todas las filas quedan alineadas en columnas.
                    Celda sin acción = span vacío del mismo ancho, nunca se omite. */}
                <span className="shrink-0 grid grid-flow-col auto-cols-[26px] gap-1 items-center justify-items-center">
                  {/* 1 · Ver el video (logo Drive real, o link firmado AdsLab) */}
                  {f.link ? (
                    <a href={f.link} target="_blank" rel="noopener noreferrer" title="Ver en Drive"
                      className="w-[26px] h-[26px] rounded-lg inline-flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition">
                      <DriveLogo size={14} />
                    </a>
                  ) : f.storagePath ? (
                    <button onClick={() => verVideo(f)} title="Ver el video (AdsLab)"
                      className="w-[26px] h-[26px] rounded-lg inline-flex items-center justify-center text-brand-500 hover:bg-black/5 dark:hover:bg-white/10 transition">
                      <ExternalLink size={13} />
                    </button>
                  ) : <span />}
                  {/* 2 · ✓ aprobar — revisor togglea; el resto lo ve fijo */}
                  {canReview && !readOnly ? (
                    <button data-okbtn={f.ts}
                      onClick={() => {
                        const activar = !f.aprobado;
                        setAprobadoVideo(a.id, f.ts, activar);
                        if (activar) fireFx(f.ts, 'ok');
                      }}
                      title={f.aprobado ? `Video ${nVid} aprobado por ${f.aprobado.por || 'Equipo'} — click para quitar` : `Aprobar el Video ${nVid}`}
                      className={`relative w-[26px] h-[26px] rounded-lg inline-flex items-center justify-center transition ${fx?.ts === f.ts && fx.kind === 'ok' ? 'fx-pop' : ''} ${f.aprobado ? 'bg-emerald-500 text-white' : 'text-gray-300 dark:text-gray-600 hover:text-emerald-500 hover:bg-black/5 dark:hover:bg-white/10'}`}>
                      <Check size={14} strokeWidth={3} />
                    </button>
                  ) : f.aprobado ? (
                    <span title={`Video ${nVid} aprobado por ${f.aprobado.por || 'el equipo'}`}
                      className="w-[26px] h-[26px] rounded-lg inline-flex items-center justify-center bg-emerald-500 text-white">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  ) : <span />}
                  {/* 3 · ✎ corregir — revisor abre el editor; el resto lo ve fijo */}
                  {canReview && !readOnly ? (
                    <button onClick={() => { setCorrText(corr?.texto || ''); setCorrEdit(editing ? null : f.ts); }}
                      title={corr ? `Editar la corrección del Video ${nVid}` : `Pedir corrección del Video ${nVid}`}
                      className={`w-[26px] h-[26px] rounded-lg inline-flex items-center justify-center text-[13px] leading-none transition ${fx?.ts === f.ts && fx.kind === 'corr' ? 'fx-shake' : ''} ${corr ? 'bg-amber-400 text-amber-950' : 'text-gray-300 dark:text-gray-600 hover:text-amber-500 hover:bg-black/5 dark:hover:bg-white/10'}`}>
                      ✎
                    </button>
                  ) : corr ? (
                    <span title={`Corrección pedida en el Video ${nVid}`}
                      className="w-[26px] h-[26px] rounded-lg inline-flex items-center justify-center text-[13px] leading-none bg-amber-400 text-amber-950">✎</span>
                  ) : <span />}
                  {/* 4 · ✕ quitar */}
                  {canDelete && !readOnly ? (
                    <button onClick={() => removeArchivo(a.id, f.ts)} title={`Quitar el Video ${nVid} de la tarjeta`}
                      className="w-[26px] h-[26px] rounded-lg inline-flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/10 transition">
                      <X size={13} />
                    </button>
                  ) : <span />}
                </span>
              </div>

              {/* Corrección pedida — visible para todos (el editor la ve read-only) */}
              {corr && !editing && (
                <div className="ml-6 mt-0.5 mb-1 bg-amber-50 dark:bg-amber-900/20 border-l-2 border-amber-400 rounded-r px-2.5 py-1.5">
                  <div className="flex gap-1.5 items-start">
                    <AlertTriangle size={11} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-amber-800 dark:text-amber-200 min-w-0 flex-1">
                      <b>Corrección (Video {nVid}):</b> <span className="whitespace-pre-wrap break-words">{corr.texto}</span>
                      {corr.por && <span className="block text-[9.5px] text-amber-600/70 dark:text-amber-400/60 mt-0.5">pedido por {corr.por}</span>}
                    </div>
                  </div>
                  {/* Reemplazar: sube el corregido, pisa a este video en su lugar
                      (mismo número), el viejo va a la papelera de Drive, y si no
                      quedan correcciones la tarjeta vuelve sola a En revisión.
                      NO hace falta borrar con la ✕ antes — eso era lo que
                      generaba los "repetido"/"versión nueva" del dedupe. */}
                  {!readOnly && (
                    <button
                      onClick={() => { setReplaceTarget({ f, nVid }); replaceInputRef.current?.click(); }}
                      disabled={!!replacingTs}
                      className="mt-1.5 ml-4 inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-1 rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition">
                      {replacingTs === f.ts
                        ? <><Loader2 size={11} className="animate-spin" /> Reemplazando…</>
                        : <><UploadCloud size={11} /> Reemplazar por el corregido</>}
                    </button>
                  )}
                </div>
              )}

              {/* Caja espejo "Corregido" — la contracara verde del aviso ámbar:
                  qué se pedía, quién lo reemplazó y cuándo, link al nuevo y
                  "Visto" para que el revisor la archive antes de aprobar. */}
              {fixed && !editing && (
                <div className="ml-6 mt-0.5 mb-1 bg-emerald-50 dark:bg-emerald-900/20 border-l-2 border-emerald-500 rounded-r px-2.5 py-1.5">
                  <div className="text-[11px] text-emerald-800 dark:text-emerald-200 min-w-0">
                    <b className="inline-flex items-center gap-1"><Check size={11} /> Corregido (Video {nVid})</b>
                    {fixed.nota && <> — se pedía: <span className="italic text-emerald-700/80 dark:text-emerald-300/70 whitespace-pre-wrap break-words">"{fixed.nota}"</span></>}
                    <span className="block text-[9.5px] text-emerald-600/70 dark:text-emerald-400/60 mt-0.5">
                      reemplazado{fixed.por ? ` por ${fixed.por}` : ''}{fixed.ts ? ` · ${new Date(fixed.ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                    </span>
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    {f.link ? (
                      <a href={f.link} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10.5px] font-extrabold px-2.5 py-1 rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 transition">
                        ▶ Ver el nuevo
                      </a>
                    ) : f.storagePath ? (
                      <button onClick={() => verVideo(f)}
                        className="inline-flex items-center gap-1 text-[10.5px] font-extrabold px-2.5 py-1 rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 transition">
                        ▶ Ver el nuevo
                      </button>
                    ) : null}
                    {canReview && (
                      <button onClick={() => { clearCorregidoVideo(a.id, f.ts); addToast?.({ type: 'info', message: `Marca de corregido del Video ${nVid} archivada` }); }}
                        className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1 rounded-lg text-emerald-700 dark:text-emerald-300 border border-emerald-400/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition">
                        Visto ✓
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Editor inline (solo quien revisa) */}
              {editing && (
                <div className="ml-6 mt-0.5 mb-1 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-800 rounded-lg p-2">
                  <div className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300 mb-1">✎ Corrección para el Video {nVid}</div>
                  <textarea value={corrText} onChange={e => setCorrText(e.target.value)} autoFocus rows={2}
                    placeholder="Qué hay que cambiar de este video…"
                    className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-2 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-800 dark:text-gray-100 resize-y" />
                  <div className="flex gap-1.5 justify-end mt-1.5">
                    {corr && <button onClick={() => { setCorreccionVideo(a.id, f.ts, ''); setCorrEdit(null); addToast?.({ type: 'info', message: `Corrección del Video ${nVid} quitada` }); }}
                      className="text-[11px] font-bold px-2 py-1 rounded text-gray-500 hover:text-red-500">Quitar</button>}
                    <button onClick={() => setCorrEdit(null)} className="text-[11px] font-bold px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
                    <button onClick={() => { const t = corrText.trim(); if (!t) { setCorrEdit(null); return; } setCorreccionVideo(a.id, f.ts, t); setCorrEdit(null); fireFx(f.ts, 'corr'); addToast?.({ type: 'success', message: `Corrección pedida en el Video ${nVid}` }); }}
                      className="text-[11px] font-extrabold px-2.5 py-1 rounded text-white bg-amber-500 hover:bg-amber-600">Pedir corrección</button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Input oculto del flujo Reemplazar — vive FUERA del dropzone para que
          su .click() programático no burbujee al onClick del dropzone (que
          abriría el picker general encima del de reemplazo). */}
      {!readOnly && (
        <input ref={replaceInputRef} type="file" accept={VIDEO_ACCEPT} hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; onReplaceFile(file); }} />
      )}

      {/* Dropzone — solo si la tarjeta es editable (no en aprobado/publicado
          para el editor). En readOnly no se puede subir ni borrar. */}
      {!readOnly && (
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) addFiles(e.dataTransfer.files); }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition ${drag ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-300 dark:border-gray-700 hover:border-emerald-400'}`}>
        <UploadCloud size={20} className="mx-auto mb-1 text-gray-400" />
        <p className="text-xs text-gray-500 dark:text-gray-400">Arrastrá los videos o <span className="text-emerald-600 font-semibold">buscalos</span></p>
        <input ref={inputRef} type="file" accept={VIDEO_ACCEPT} multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      )}

      {/* Cola de subida */}
      {!readOnly && files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 rounded px-2.5 py-1.5">
              <span className="flex-shrink-0">
                {f.status === 'error' ? <AlertTriangle size={12} className="text-red-500" />
                  : f.status === 'subiendo' ? <Loader2 size={12} className="text-brand-500 animate-spin" />
                    : <Film size={12} className="text-gray-400" />}
              </span>
              <span className="truncate flex-1 text-gray-600 dark:text-gray-300">{f.file.name}</span>
              {f.status === 'error' && <span className="w-full text-[11px] text-red-500 break-words">{f.msg}</span>}
              {!busy && <button onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))} className="text-gray-300 hover:text-red-500"><X size={12} /></button>}
            </div>
          ))}
          <button onClick={subir} disabled={busy}
            className="w-full mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50">
            {busy ? <><Loader2 size={14} className="animate-spin" /> Subiendo…</> : <><UploadCloud size={14} /> Subir {files.length} video{files.length > 1 ? 's' : ''}</>}
          </button>
        </div>
      )}
    </div>
  );
}
