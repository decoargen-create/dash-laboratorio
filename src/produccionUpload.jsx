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
import { Film, X, UploadCloud, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase, getCurrentUser } from './supabase.js';
import { addArchivos, removeArchivo, updateAssignment } from './produccionStore.js';

const BUCKET = 'creativos';

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

async function uploadToSupabase(file, user, ext) {
  const path = `${user.id}/produccion/pv-${uid()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'video/mp4', upsert: true,
  });
  if (error) throw new Error(`Subida falló: ${error.message}`);
  return { name: file.name, storagePath: path, destino: 'adslab', sizeMB: +(file.size / 1024 / 1024).toFixed(1), ts: uid() };
}

async function uploadOne(file, ctx) {
  const { user, token, weekKey, productoNombre, persona } = ctx;
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  let sess = null;
  try {
    const r = await fetch('/api/produccion/drive-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ productoNombre, persona, weekKey, filename: file.name, mimeType: file.type || 'video/mp4', size: file.size }),
    });
    sess = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(sess.error || `HTTP ${r.status}`);
  } catch { sess = { configured: false }; }

  if (sess.configured && sess.sessionUri) {
    try {
      const put = await fetch(sess.sessionUri, { method: 'PUT', headers: { 'Content-Type': sess.contentType || file.type || 'video/mp4' }, body: file });
      if (put.ok) {
        const meta = await put.json().catch(() => ({}));
        const link = meta.webViewLink || (meta.id ? `https://drive.google.com/file/d/${meta.id}/view` : sess.folderLink) || null;
        return { name: sess.finalName || file.name, driveId: meta.id || null, link, folderLink: sess.folderLink || null, destino: 'drive', sizeMB: +(file.size / 1024 / 1024).toFixed(1), ts: uid() };
      }
      console.warn('[produccion] PUT a Drive respondió', put.status, '— cayendo a AdsLab');
    } catch (err) {
      // Típicamente CORS: la sesión no quedó atada al origin del browser.
      console.warn('[produccion] PUT a Drive falló:', err?.message || err, '— cayendo a AdsLab');
    }
  }
  return await uploadToSupabase(file, user, ext);
}

// Sube una tanda de videos a una tarjeta y, si estaba en "Por hacer", la manda
// sola a "En revisión" (así el equipo sube y de una queda para revisar).
export async function subirParaTarjeta(a, fileList, { onProgress, addToast } = {}) {
  const files = Array.from(fileList || []).filter(aceptaVideo);
  if (files.length === 0) { addToast?.({ type: 'warning', message: 'Elegí un archivo de video.' }); return { ok: 0 }; }
  const user = await getCurrentUser();
  if (!user) { addToast?.({ type: 'error', message: 'Iniciá sesión de nuevo.' }); return { ok: 0 }; }
  const token = await getAuthToken();
  const ctx = { user, token, weekKey: a.weekKey, productoNombre: a.productoNombre, persona: a.persona || 'Equipo' };
  const eraPorHacer = a.estado === 'porhacer';
  let ok = 0, dest = null;
  for (let i = 0; i < files.length; i++) {
    onProgress?.({ i, total: files.length, name: files[i].name });
    try { const archivo = await uploadOne(files[i], ctx); addArchivos(a.id, [archivo]); ok++; dest = archivo.destino; }
    catch (err) { addToast?.({ type: 'error', message: `"${files[i].name}": ${err.message}` }); }
  }
  if (ok > 0 && eraPorHacer) updateAssignment(a.id, { estado: 'revision' });
  if (ok > 0) addToast?.({ type: 'success', message: `${ok} video${ok > 1 ? 's' : ''} → ${dest === 'drive' ? 'Google Drive' : 'AdsLab'}${eraPorHacer ? ' · pasó a En revisión' : ''}` });
  return { ok };
}

// Sección de creativos dentro de una tarjeta: lista de archivos ya subidos +
// dropzone + cola de subida. `canDelete` controla si se puede quitar un archivo
// ya subido (el admin sí; un creator también puede borrar los suyos).
export function CreativosSection({ a, addToast, canDelete = true }) {
  const [files, setFiles] = useState([]); // { file, id, status, destino?, msg? }
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const folderLink = (a.archivos || []).find(f => f.folderLink)?.folderLink;
  // ¿Todos los archivos cayeron a AdsLab? (pueden ser de ANTES de conectar Drive)
  const soloAdslab = (a.archivos?.length > 0) && !folderLink && a.archivos.every(f => f.destino !== 'drive');

  // Sondeo real al server: ¿Drive está conectado HOY? Así el cartel no miente
  // cuando la tarjeta solo tiene videos viejos de AdsLab.
  const [driveOk, setDriveOk] = useState(null); // null = todavía no sabemos
  useEffect(() => {
    if (!soloAdslab) return; // solo hace falta para decidir el cartel
    let dead = false;
    (async () => {
      try {
        const token = await getAuthToken();
        const r = await fetch('/api/produccion/drive-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ probe: true }),
        });
        const d = await r.json().catch(() => ({}));
        if (!dead) setDriveOk(!!d.configured);
      } catch { /* dejamos null: no afirmamos nada */ }
    })();
    return () => { dead = true; };
  }, [soloAdslab]);

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
    const user = await getCurrentUser();
    if (!user) { setBusy(false); addToast?.({ type: 'error', message: 'Iniciá sesión de nuevo.' }); return; }
    const token = await getAuthToken();
    const ctx = { user, token, weekKey: a.weekKey, productoNombre: a.productoNombre, persona: a.persona || 'Equipo' };
    const eraPorHacer = a.estado === 'porhacer';
    let ok = 0, dest = null;
    for (const item of files) {
      if (item.status === 'ok') continue;
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'subiendo' } : f));
      try {
        const archivo = await uploadOne(item.file, ctx);
        addArchivos(a.id, [archivo]);
        ok++; dest = archivo.destino;
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'ok', destino: archivo.destino } : f));
      } catch (err) {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', msg: err.message } : f));
      }
    }
    if (ok > 0 && eraPorHacer) updateAssignment(a.id, { estado: 'revision' });
    setBusy(false);
    if (ok > 0) addToast?.({ type: 'success', message: `${ok} video${ok > 1 ? 's' : ''} → ${dest === 'drive' ? 'Google Drive' : 'AdsLab'}${eraPorHacer ? ' · pasó a En revisión' : ''}` });
    setFiles(prev => prev.filter(f => f.status !== 'ok'));
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <UploadCloud size={13} className="text-gray-400" />
        <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Creativos</span>
        {folderLink && (
          <a href={folderLink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-brand-500 hover:text-brand-600 inline-flex items-center gap-0.5 ml-1">
            carpeta de Drive <ExternalLink size={10} />
          </a>
        )}
        {soloAdslab && driveOk === true && (
          <span className="text-[11px] font-semibold text-gray-400 ml-1 cursor-help"
            title="Estos videos se subieron antes de conectar Drive y quedaron en AdsLab (se ven con el ícono de cada archivo). Los videos NUEVOS van a la carpeta de Drive.">
            ℹ estos son de antes (AdsLab) — los nuevos van a Drive ✓
          </span>
        )}
        {soloAdslab && driveOk === false && (
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 ml-1 cursor-help"
            title="Google Drive no está conectado, así que los videos se guardan en AdsLab (podés verlos con el ícono de cada archivo). Para que vayan a una carpeta de Drive: configurar DRIVE_CREATIVOS_FOLDER_ID en Vercel.">
            ⚠ Drive no conectado — se guardan en AdsLab
          </span>
        )}
      </div>

      {/* Archivos ya subidos */}
      {(a.archivos?.length > 0) && (
        <div className="space-y-1 mb-2">
          {a.archivos.map(f => (
            <div key={f.ts} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 rounded px-2.5 py-1.5">
              <Film size={12} className="text-emerald-500 flex-shrink-0" />
              <span className="truncate flex-1 text-gray-700 dark:text-gray-200" title={f.name}>{f.name}</span>
              <span className="text-[10px] uppercase font-bold text-gray-400">{f.destino === 'drive' ? 'Drive' : 'AdsLab'}</span>
              {f.link && <a href={f.link} target="_blank" rel="noopener noreferrer" title="Ver en Drive" className="text-brand-500 hover:text-brand-600"><ExternalLink size={11} /></a>}
              {!f.link && f.storagePath && (
                <button onClick={() => verVideo(f)} title="Ver el video (AdsLab)" className="text-brand-500 hover:text-brand-600"><ExternalLink size={11} /></button>
              )}
              {canDelete && <button onClick={() => removeArchivo(a.id, f.ts)} className="text-gray-300 hover:text-red-500"><X size={12} /></button>}
            </div>
          ))}
        </div>
      )}

      {/* Dropzone */}
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

      {/* Cola de subida */}
      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 rounded px-2.5 py-1.5">
              <span className="flex-shrink-0">
                {f.status === 'error' ? <AlertTriangle size={12} className="text-red-500" />
                  : f.status === 'subiendo' ? <Loader2 size={12} className="text-brand-500 animate-spin" />
                    : <Film size={12} className="text-gray-400" />}
              </span>
              <span className="truncate flex-1 text-gray-600 dark:text-gray-300">{f.file.name}</span>
              {f.status === 'error' && <span className="text-[11px] text-red-500 truncate max-w-[110px]" title={f.msg}>{f.msg}</span>}
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
