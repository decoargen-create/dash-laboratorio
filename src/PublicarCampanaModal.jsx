// "Ads Uploader" propio — publica los videos de una tarjeta de Producción
// como una campaña nueva en Meta, clonando la configuración (targeting,
// pixel, página, identidad IG, CTA) de un ad existente elegido como template.
//
// Flujo ideal (el del equipo): cada PRODUCTO tiene asignada su cuenta y su
// ad base (preset). Con preset, publicar es: abrir → poner presupuesto →
// Publicar. El preset se guarda solo al publicar OK (o con el botón
// "Guardar preset del producto") y vive en localStorage por producto.
//
// Server en api/meta/[action].js:
//   upload-ad-videos (advideos por file_url) → videos-status (ready +
//   thumbnail) → create-campaign-structure (campaña PAUSED → conjuntos →
//   creatives → ads → activación final en una sola escritura).

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Rocket, X, Loader2, Check, AlertTriangle, ChevronRight, ExternalLink, Film, Save, Pencil, Image as ImageIcon, ArrowLeft,
} from 'lucide-react';
import { useMetaConnections, useMetaAdAccounts, authHeaders, openMetaConnect } from './MetaConnect.jsx';
import { linkMeta } from './testeosCore.js';

const LS_ACCOUNT = 'adslab-testeos-account';
// Clave por NOMBRE de producto (normalizado): es lo único que comparten la
// tarjeta de Producción (catálogo del lab) y el producto de Marketing — así
// el preset se puede preestablecer desde el Setup del producto y la tarjeta
// lo encuentra igual. Fallback por id si no hay nombre.
const presetKey = (a) => {
  const nom = (a.productoNombre || '').trim().toLowerCase();
  return `adslab-publicar-preset-v1-${nom ? `nom:${nom}` : `id:${a.productoId}`}`;
};

export function leerPresetPublicar(productoNombre) {
  try { return JSON.parse(localStorage.getItem(presetKey({ productoNombre })) || 'null'); } catch { return null; }
}
function leerPreset(a) {
  try { return JSON.parse(localStorage.getItem(presetKey(a)) || 'null'); } catch { return null; }
}
function guardarPreset(a, preset) {
  try { localStorage.setItem(presetKey(a), JSON.stringify({ ...preset, ts: Date.now() })); } catch {}
}

export async function metaApi(path, { connId, method = 'GET', body } = {}) {
  let u = `/api/meta/${path}`;
  if (connId && connId !== '__cookie__') {
    u += `${u.includes('?') ? '&' : '?'}connection_id=${encodeURIComponent(connId)}`;
  }
  const r = await fetch(u, {
    method,
    headers: await authHeaders(!!body),
    ...(body ? { body: JSON.stringify({ ...body, connection_id: connId && connId !== '__cookie__' ? connId : undefined }) } : {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 207) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));
// Estático vs video, por extensión del archivo.
export const esImagen = (n) => /\.(jpe?g|png|webp|gif)$/i.test(String(n || ''));
// Errores de LECTURA de Meta que un buyer no tiene por qué descifrar.
const amigable = (m) => {
  const s = String(m || '');
  if (/request limit|#17\)|#80004/i.test(s)) return 'Meta está limitando las consultas — esperá un minuto y reintentá';
  if (/Unsupported get request|does not exist/i.test(s)) return 'Ese elemento ya no existe en Meta (¿lo borraron o archivaron?)';
  return s;
};
const sinExtension = (n) => String(n || '').replace(/\.[a-z0-9]{2,5}$/i, '');

// Patrones tipo adsuploader: {filename}, {index}, {index:01}, {date}.
function aplicarPatron(patron, { filename = '', index = 0, fecha = '' }) {
  return String(patron || '')
    .replaceAll('{filename}', filename)
    .replaceAll('{index:01}', String(index + 1).padStart(2, '0'))
    .replaceAll('{index}', String(index + 1))
    .replaceAll('{date}', fecha)
    .slice(0, 100);
}

// `soloPreset`: modo "configurar campaña base" desde el Setup del producto —
// sin videos ni publicación; solo elegir cuenta + ad template + defaults y
// guardarlos como preset del producto.
// `pantalla`: en vez de pop-up, se renderiza como PÁGINA (el módulo
// Publicador lo embebe a lo ancho, estilo adsuploader: media a la izquierda,
// configuración a la derecha).
export default function PublicarCampanaModal({ a, onClose, addToast, soloPreset = false, onPublished = null, pantalla = false }) {
  const preset = useMemo(() => leerPreset(a), [a]);
  const { connections, loading: connLoading, error: connError, reload: reloadConns } = useMetaConnections();
  const { accounts, loading: acctLoading, errors: acctErrors } = useMetaAdAccounts(connections);
  const [accountId, setAccountId] = useState(() => preset?.accountId || (() => { try { return localStorage.getItem(LS_ACCOUNT) || ''; } catch { return ''; } })());
  const account = useMemo(() => accounts.find(x => x.id === accountId) || accounts[0] || null, [accounts, accountId]);

  // ── Videos de la tarjeta ──
  const candidatos = useMemo(() => (a.archivos || []).filter(f => f && (f.driveId || f.storagePath)), [a]);
  const [sel, setSel] = useState(() => {
    const conArchivo = (a.archivos || []).filter(f => f && (f.driveId || f.storagePath));
    const base = conArchivo.filter(f => f.aprobado);
    return new Set((base.length > 0 ? base : conArchivo).map(f => f.ts));
  });
  const toggleSel = (ts) => setSel(prev => { const n = new Set(prev); if (n.has(ts)) n.delete(ts); else n.add(ts); return n; });
  const elegidos = candidatos.filter(f => sel.has(f.ts));

  // ── Template (preset directo, o picker campaña → conjunto → ad) ──
  const [usandoPreset, setUsandoPreset] = useState(!!preset?.adId);
  const [campanas, setCampanas] = useState([]);
  const [adsets, setAdsets] = useState([]);
  const [campSel, setCampSel] = useState('');
  const [adsetSel, setAdsetSel] = useState('');
  const [adSel, setAdSel] = useState(preset?.adId || '');
  const [buscaCamp, setBuscaCamp] = useState('');
  const [template, setTemplate] = useState(null);
  const [cargandoTpl, setCargandoTpl] = useState(false);
  const primeraCuenta = useRef(true);

  // Si la cuenta del preset ya no está en el listado (conexión borrada,
  // permiso perdido), el fallback a accounts[0] publicaría con el pixel de
  // OTRA cuenta — se desarma el preset y se vuelve al picker.
  useEffect(() => {
    if (!usandoPreset || accounts.length === 0 || !preset?.accountId) return;
    if (!accounts.some(x => x.id === preset.accountId)) {
      setUsandoPreset(false); setAdSel(''); setTemplate(null);
      addToast?.({ type: 'warning', message: 'La cuenta del preset ya no está disponible — elegí el template de nuevo.' });
    }
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambiar de cuenta INVALIDA el template: el pixel/página de la cuenta A
  // no sirven en la B (la campaña se crearía rota). Se resetea todo.
  useEffect(() => {
    if (!account) return;
    if (primeraCuenta.current) { primeraCuenta.current = false; }
    else {
      setCampSel(''); setAdsetSel(''); setAdSel(''); setTemplate(null); setAdsets([]); setUsandoPreset(false);
    }
    let vivo = true;
    (async () => {
      try {
        const d = await metaApi(`campaigns?account_id=${encodeURIComponent(account.id)}`, { connId: account.connId });
        if (vivo) setCampanas(d.campaigns || []);
      } catch (e) { if (vivo) addToast?.({ type: 'error', message: `Campañas: ${amigable(e.message)}` }); }
    })();
    return () => { vivo = false; };
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAdsets([]); setAdsetSel('');
    // Elegir OTRA campaña invalida el ad template anterior: sin esto se podía
    // publicar con el targeting/pixel de un ad que ya no estaba a la vista.
    if (campSel) { setAdSel(''); setTemplate(null); }
    if (!campSel || !account) return;
    let vivo = true;
    (async () => {
      try {
        const d = await metaApi(`campaign-adsets?campaign_id=${encodeURIComponent(campSel)}&with_ads=1`, { connId: account.connId });
        if (vivo) setAdsets(d.adsets || []);
      } catch (e) { if (vivo) addToast?.({ type: 'error', message: `Conjuntos: ${amigable(e.message)}` }); }
    })();
    return () => { vivo = false; };
  }, [campSel]); // eslint-disable-line react-hooks/exhaustive-deps

  // template-config por adSel — funciona igual venga del picker o del preset.
  useEffect(() => {
    setTemplate(null);
    if (!adSel || !account) { setCargandoTpl(false); return; }
    let vivo = true;
    setCargandoTpl(true);
    (async () => {
      try {
        const d = await metaApi(`template-config?ad_id=${encodeURIComponent(adSel)}`, { connId: account.connId });
        if (vivo) {
          setTemplate(d);
          setMensaje(prev => prev || preset?.mensaje || d.defaultMessage || '');
        }
      } catch (e) {
        if (vivo) addToast?.({ type: 'error', message: `Template: ${amigable(e.message)}` });
        // Preset/elección rota → volver al picker LIMPIO: sin resetear adSel,
        // re-elegir el mismo ad no disparaba el effect y quedaba muerto.
        if (vivo) { setUsandoPreset(false); setAdSel(''); }
      } finally { if (vivo) setCargandoTpl(false); }
    })();
    return () => { vivo = false; };
  }, [adSel, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Config de la campaña nueva ──
  // La fecha del nombre es EL DÍA SIGUIENTE (regla del equipo: la campaña se
  // arma hoy para que corra mañana).
  // Congelada al montar y en huso AR: calcularla por render descoordinaba el
  // nombre de campaña y el {date} de los conjuntos si la medianoche caía en
  // el medio, y el reloj del navegador podía no ser el de Argentina.
  const [fechaCorta] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric' }));
  const [nombre, setNombre] = useState(`${a.productoNombre || 'Producto'} ${fechaCorta} [CBO Testeo Videos]`);
  const [presupuesto, setPresupuesto] = useState(preset?.budget ? String(preset.budget) : '');
  const [adsPorSet, setAdsPorSet] = useState(preset?.adsPerSet || 3);
  const [mensaje, setMensaje] = useState(preset?.mensaje || '');
  const [titular, setTitular] = useState(preset?.titular || '');
  const [adsetPattern, setAdsetPattern] = useState(preset?.adsetPattern || 'Ad Set {index:01}');
  const [adPattern, setAdPattern] = useState(preset?.adPattern || '{filename}');
  const [enPausa, setEnPausa] = useState(false);
  const [verPreview, setVerPreview] = useState(false);

  // ── Publicación ──
  const [fase, setFase] = useState(null); // null | 'subiendo' | 'procesando' | 'creando' | 'listo' | 'error'
  const [logs, setLogs] = useState([]);
  const [resultado, setResultado] = useState(null);
  const log = (l) => setLogs(prev => [...prev, l]);

  const nSets = Math.ceil(elegidos.length / (Number(adsPorSet) || 3)) || 0;
  const nombresAds = useMemo(() => elegidos.map((f, i) =>
    aplicarPatron(adPattern, { filename: sinExtension(f.name), index: i, fecha: fechaCorta }) || sinExtension(f.name)
  ), [elegidos, adPattern, fechaCorta]);
  const nombresSets = useMemo(() => Array.from({ length: nSets }, (_, i) =>
    aplicarPatron(adsetPattern, { filename: '', index: i, fecha: fechaCorta }) || `Ad Set ${i + 1}`
  ), [nSets, adsetPattern, fechaCorta]);

  const listo = account && elegidos.length > 0 && template?.pageId && nombre.trim() && Number(presupuesto) > 0 && !fase;

  const guardarPresetActual = useCallback((silencioso = false) => {
    if (!account || !adSel) return;
    guardarPreset(a, {
      accountId: account.id,
      adId: adSel,
      adLabel: template?.adName || adSel,
      budget: Number(presupuesto) || null,
      adsPerSet: Number(adsPorSet) || 3,
      mensaje,
      titular,
      adsetPattern,
      adPattern,
    });
    if (!silencioso) addToast?.({ type: 'success', message: `Preset de ${a.productoNombre || 'este producto'} guardado ✓ — la próxima ya viene todo precargado.` });
  }, [a, account, adSel, template, presupuesto, adsPorSet, mensaje, titular, adsetPattern, adPattern, addToast]);

  const publicar = useCallback(async () => {
    if (!listo) return;
    if (elegidos.length > 30) {
      addToast?.({ type: 'warning', message: 'Máximo 30 videos por publicación — destildá algunos.' });
      return;
    }
    setFase('subiendo'); setLogs([]); setResultado(null);
    try {
      // Mixto: los VIDEOS se suben a Meta (act/advideos) y se espera el
      // procesamiento; los ESTÁTICOS solo necesitan una URL firmada (van como
      // link_data.picture en el creative). El índice es la posición en
      // `elegidos`, para que los nombres {index}/{filename} queden alineados.
      const vids = elegidos.filter(f => !esImagen(f.name));
      const imgs = elegidos.filter(f => esImagen(f.name));

      let subidos = [];
      if (vids.length > 0) {
        log(`Subiendo ${vids.length} video${vids.length === 1 ? '' : 's'} a Meta…`);
        const up = await metaApi('upload-ad-videos', {
          connId: account.connId, method: 'POST',
          body: {
            account_id: account.id,
            videos: vids.map(f => ({ name: f.name, index: elegidos.indexOf(f), driveId: f.driveId || null, storagePath: f.storagePath || null })),
          },
        });
        subidos = (up.resultados || []).filter(r => r.ok);
        for (const r of (up.resultados || [])) log(r.ok ? `  ✓ ${r.name}` : `  ✗ ${r.name}: ${r.error}`);
      }

      let adsImagen = [];
      if (imgs.length > 0) {
        log(`Preparando ${imgs.length} estático${imgs.length === 1 ? '' : 's'}…`);
        const sm = await metaApi('sign-media', {
          connId: account.connId, method: 'POST',
          body: { items: imgs.map(f => ({ index: elegidos.indexOf(f), storagePath: f.storagePath || null, driveId: f.driveId || null })) },
        });
        for (const it of (sm.items || [])) {
          const f = elegidos[it.index];
          if (it.ok) adsImagen.push({ name: nombresAds[it.index] || sinExtension(f?.name), imageUrl: it.url });
          log(it.ok ? `  ✓ ${f?.name}` : `  ✗ ${f?.name}: ${it.error}`);
        }
      }

      if (subidos.length === 0 && adsImagen.length === 0) throw new Error('Ningún creativo se pudo preparar.');

      // 2. Esperar procesamiento + thumbnail (el creative lo necesita).
      let adsListos = [];
      if (subidos.length > 0) {
      setFase('procesando');
      log('Esperando que Meta procese los videos (video + thumbnail)…');
      const ids = subidos.map(r => r.videoId);
      let estados = [];
      // Errores transitorios (rate limit de Meta, un 500 suelto) NO cortan el
      // polling: los videos ya están subidos y procesándose igual. Solo
      // abandonamos tras varios errores seguidos.
      let erroresSeguidos = 0;
      for (let i = 0; i < 45; i++) {
        await esperar(4000);
        let st;
        try {
          st = await metaApi(`videos-status?ids=${ids.join(',')}`, { connId: account.connId });
          erroresSeguidos = 0;
        } catch (e) {
          erroresSeguidos++;
          log(`  ⚠ chequeo falló (${e.message}) — reintento…`);
          if (erroresSeguidos >= 6) throw new Error(`Meta no responde el estado de los videos (${amigable(e.message)}). Reintentá en unos minutos (ojo: el reintento vuelve a subirlos).`);
          continue;
        }
        estados = st.videos || [];
        const listos = estados.filter(v => v.ready).length;
        if (i % 3 === 0) log(`  ${listos}/${ids.length} listos…`);
        if (st.todosListos) break;
        if (estados.every(v => v.ready || v.status === 'error')) break;
      }
      const porId = new Map(estados.map(v => [v.id, v]));
      // El server devuelve `index` (la posición que le mandamos): es la única
      // clave segura — mapear por nombre rompía con duplicados o >90 chars.
      adsListos = subidos
        .filter(r => porId.get(r.videoId)?.ready)
        .map(r => {
          const i = Number.isInteger(r.index) ? r.index : 0;
          return { name: nombresAds[i] || sinExtension(r.name), videoId: r.videoId, picture: porId.get(r.videoId)?.picture || null };
        });
      if (adsListos.length === 0 && adsImagen.length === 0) throw new Error('Meta no terminó de procesar ningún video — reintentá en unos minutos (ojo: el reintento vuelve a subirlos).');
      }
      adsListos = [...adsListos, ...adsImagen];

      // 3. Crear la estructura (el server la crea PAUSADA y la activa al final).
      setFase('creando');
      log(`Creando campaña "${nombre.trim()}" con ${adsListos.length} ads…`);
      const cr = await metaApi('create-campaign-structure', {
        connId: account.connId, method: 'POST',
        body: {
          account_id: account.id,
          currency: account.currency || '',
          producto: a.productoNombre || '',
          campaignName: nombre.trim(),
          dailyBudget: Number(presupuesto),
          adsPerSet: Number(adsPorSet) || 3,
          adsetNamePattern: adsetPattern,
          fecha: fechaCorta,
          status: enPausa ? 'PAUSED' : 'ACTIVE',
          template,
          message: mensaje,
          headline: titular,
          ads: adsListos,
        },
      });
      for (const l of (cr.log || [])) log(l);
      if (cr.error) throw new Error(cr.error);
      const okAds = (cr.resultados || []).filter(r => r.ok).length;
      // 0 ads OK = el server ya hizo rollback (estado DELETED): esto es un
      // ERROR, no un "creada en pausa" con link a una campaña que no existe.
      if (okAds === 0 || cr.estado === 'DELETED') {
        throw new Error('Ningún anuncio se pudo crear — la campaña se deshizo sola. Mirá el detalle por video acá arriba.');
      }
      setResultado(cr);
      setFase('listo');
      guardarPresetActual(true); // publicación OK = el preset del producto se actualiza solo
      try { onPublished?.(cr); } catch {}
      if (cr.activacionError) {
        addToast?.({ type: 'warning', message: `Campaña creada con ${okAds}/${adsListos.length} ads pero NO se pudo activar (${cr.activacionError}) — quedó PAUSADA: activala desde Meta.` });
      } else {
        addToast?.({
          type: okAds === adsListos.length ? 'success' : 'warning',
          message: cr.estado === 'ACTIVE'
            ? `Campaña publicada ACTIVA: ${okAds}/${adsListos.length} ads 🚀`
            : `Campaña creada EN PAUSA: ${okAds}/${adsListos.length} ads — revisala en Meta`,
        });
      }
    } catch (e) {
      log(`✗ ${e.message}`);
      setFase('error');
      addToast?.({ type: 'error', message: `Publicación: ${e.message}` });
    }
  }, [listo, elegidos, account, nombre, presupuesto, adsPorSet, mensaje, titular, template, adsetPattern, nombresAds, enPausa, guardarPresetActual]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !fase) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, fase]);

  const campFiltradas = campanas.filter(c => !buscaCamp.trim() || c.name.toLowerCase().includes(buscaCamp.toLowerCase()));
  const adsDelSet = adsets.find(s => s.id === adsetSel)?.ads || [];
  const input = 'w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  const puedeCerrar = !fase || fase === 'listo' || fase === 'error';
  return (
    <div className={pantalla
      ? 'w-full'
      : 'fixed inset-0 z-[60] flex items-start justify-center p-4 overflow-y-auto bg-black/60 backdrop-blur-sm'}
      onClick={pantalla ? undefined : () => { if (puedeCerrar) onClose(); }}>
      <div className={pantalla
        ? 'w-full flex flex-col bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden'
        : 'w-full max-w-2xl my-6 flex flex-col max-h-[calc(100vh-5rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden'}
        onClick={pantalla ? undefined : e => e.stopPropagation()}>
        <div className="shrink-0 flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          {pantalla && (
            <button onClick={() => { if (puedeCerrar) onClose(); }} disabled={!puedeCerrar}
              className="inline-flex items-center gap-1 text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-40 mr-1">
              <ArrowLeft size={14} /> Cola
            </button>
          )}
          <Rocket size={17} className="text-brand-500" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{soloPreset ? 'Campaña base del producto' : 'Publicar campaña en Meta'}</h3>
            <p className="text-[11px] text-gray-400 truncate">{a.productoNombre}{soloPreset ? ' · cuenta + ad template + defaults del publicador' : ` · ${elegidos.length} creativo${elegidos.length === 1 ? '' : 's'} seleccionado${elegidos.length === 1 ? '' : 's'}`}</p>
          </div>
          {/* En plena publicación la X no cierra: un cierre a mitad de camino
              dejaba el job corriendo invisible y el buyer, al no ver
              confirmación, publicaba de nuevo → campaña duplicada. */}
          {!pantalla && (puedeCerrar ? (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          ) : (
            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">publicando…</span>
          ))}
          {pantalla && !puedeCerrar && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">publicando…</span>}
        </div>

        <div className={pantalla
          ? 'p-6 grid grid-cols-1 lg:grid-cols-5 gap-x-8 gap-y-5 flex-1 min-h-0 overflow-y-auto items-start'
          : 'p-5 space-y-5 flex-1 min-h-0 overflow-y-auto'}>
        {/* Columna izquierda (en pantalla): los creativos */}
        <div className={pantalla ? 'lg:col-span-2 space-y-5' : 'space-y-5'}>
          {/* Creativos (videos + estáticos) */}
          {!soloPreset && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Creativos</span>
              <span className="text-[10px] text-gray-400">
                {elegidos.filter(f => !esImagen(f.name)).length} video{elegidos.filter(f => !esImagen(f.name)).length === 1 ? '' : 's'} · {elegidos.filter(f => esImagen(f.name)).length} estático{elegidos.filter(f => esImagen(f.name)).length === 1 ? '' : 's'} elegidos
              </span>
            </div>
            {candidatos.length === 0 ? (
              <p className="text-sm text-gray-400">No hay videos ni estáticos subidos.</p>
            ) : (
              <div className={`space-y-1 overflow-y-auto pr-1 ${pantalla ? 'max-h-[34rem]' : 'max-h-44'}`}>
                {candidatos.map(f => (
                  <label key={f.ts} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <input type="checkbox" checked={sel.has(f.ts)} onChange={() => toggleSel(f.ts)} disabled={!!fase} className="accent-brand-500" />
                    {esImagen(f.name)
                      ? <ImageIcon size={13} className="text-sky-500 shrink-0" />
                      : <Film size={13} className="text-gray-400 shrink-0" />}
                    <span className="flex-1 min-w-0 truncate text-xs text-gray-800 dark:text-gray-100" title={f.name}>{f.name}</span>
                    {f._origen && <span className="text-[9px] text-gray-400 shrink-0 max-w-[110px] truncate" title={f._origen}>{f._origen}</span>}
                    {f.aprobado && <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">APROBADO</span>}
                    <span className="text-[9px] text-gray-400 shrink-0">{f.driveId ? 'Drive' : 'AdsLab'}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          )}
        </div>

        {/* Columna derecha (en pantalla): configuración */}
        <div className={pantalla ? 'lg:col-span-3 space-y-5' : 'space-y-5'}>
          {/* Preset del producto */}
          {usandoPreset && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2.5">
              <Check size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0 text-xs text-emerald-800 dark:text-emerald-200">
                <b>Preset de {a.productoNombre || 'este producto'}</b> — template: <span className="font-medium">{template?.adName || preset?.adLabel || preset?.adId}</span>
                {cargandoTpl && <Loader2 size={11} className="inline animate-spin ml-1.5" />}
              </div>
              <button onClick={() => { setUsandoPreset(false); setAdSel(''); setTemplate(null); }}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:underline">
                <Pencil size={11} /> Cambiar
              </button>
            </div>
          )}

          {/* Cuenta */}
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Cuenta publicitaria</span>
            {(connLoading || acctLoading) && accounts.length === 0 ? (
              <p className="text-sm text-gray-400 inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Cargando tus cuentas de Meta…</p>
            ) : accounts.length === 0 ? (
              <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200 space-y-1.5">
                <p className="font-bold inline-flex items-center gap-1"><AlertTriangle size={13} /> No encuentro tus cuentas publicitarias.</p>
                {(connError || (acctErrors || []).length > 0) && (
                  <p className="text-[11px] break-words">{connError || (acctErrors || []).join(' · ')}</p>
                )}
                <div className="flex gap-2 pt-0.5">
                  <button onClick={() => reloadConns?.()} className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-amber-400 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition">Reintentar</button>
                  <button onClick={() => { onClose(); openMetaConnect(); }} className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-amber-400 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition">Conectar Meta</button>
                </div>
              </div>
            ) : (
              <select value={account?.id || ''} onChange={e => setAccountId(e.target.value)} className={input} disabled={!!fase}>
                {accounts.map(ac => <option key={ac.id} value={ac.id}>{ac.name || ac.id}{ac.currency ? ` (${ac.currency})` : ''}</option>)}
              </select>
            )}
          </div>

          {/* Template picker (solo sin preset activo) */}
          {!usandoPreset && (
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Copiar configuración de un ad existente</span>
              <p className="text-[11px] text-gray-400 mb-2">Se clonan targeting, optimización, pixel, página, Instagram y CTA de este ad — elegí uno que esté funcionando bien.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <input value={buscaCamp} onChange={e => setBuscaCamp(e.target.value)} placeholder="Buscar campaña…" disabled={!!fase} className={`${input} mb-1 text-xs`} />
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-36 overflow-y-auto">
                    {campFiltradas.slice(0, 50).map(c => (
                      <button key={c.id} onClick={() => setCampSel(c.id)} disabled={!!fase}
                        className={`w-full text-left px-2 py-1.5 text-[11px] truncate ${campSel === c.id ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-200 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                        title={c.name}>{c.name}</button>
                    ))}
                    {campFiltradas.length === 0 && <p className="px-2 py-2 text-[11px] text-gray-400">Sin campañas</p>}
                  </div>
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[10.5rem] overflow-y-auto self-end">
                  {adsets.map(s => (
                    <button key={s.id} onClick={() => setAdsetSel(s.id)} disabled={!!fase}
                      className={`w-full text-left px-2 py-1.5 text-[11px] truncate ${adsetSel === s.id ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-200 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                      title={s.name}>{s.name}{Array.isArray(s.ads) ? ` (${s.ads.length})` : ''}</button>
                  ))}
                  {campSel && adsets.length === 0 && <p className="px-2 py-2 text-[11px] text-gray-400">Cargando conjuntos…</p>}
                  {!campSel && <p className="px-2 py-2 text-[11px] text-gray-400">← Elegí una campaña</p>}
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[10.5rem] overflow-y-auto self-end">
                  {adsDelSet.map(ad => (
                    <button key={ad.id} onClick={() => setAdSel(ad.id)} disabled={!!fase}
                      className={`w-full text-left px-2 py-1.5 text-[11px] truncate flex items-center gap-1 ${adSel === ad.id ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-200 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                      title={ad.name}>{adSel === ad.id && <Check size={11} className="shrink-0" />}<span className="truncate">{ad.name}</span></button>
                  ))}
                  {adsetSel && adsDelSet.length === 0 && <p className="px-2 py-2 text-[11px] text-gray-400">Sin ads en este conjunto</p>}
                  {!adsetSel && <p className="px-2 py-2 text-[11px] text-gray-400">← Elegí un conjunto</p>}
                </div>
              </div>
            </div>
          )}

          {cargandoTpl && !usandoPreset && <p className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Leyendo configuración del ad…</p>}
          {template && !template.pageId && (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
              <AlertTriangle size={12} /> Este ad no tiene página de Facebook asociada — no sirve de template, elegí otro.
            </p>
          )}
          {template && template.pageId && (
            <div className="flex items-start gap-2 flex-wrap">
              <p className="flex-1 min-w-0 text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 flex-wrap">
                <Check size={12} /> Config lista: {template.adName ? `"${String(template.adName).slice(0, 32)}" · ` : ''}{template.campaign?.objective || 'objetivo'} · {template.adset?.optimizationGoal || 'optimización'} · página {template.pageId}{template.link ? ` · CTA ${template.ctaType} → ${String(template.link).slice(0, 36)}…` : ''}
              </p>
              <button onClick={() => guardarPresetActual(false)} disabled={!!fase}
                title="Asigna esta cuenta + este ad base al producto: la próxima publicación viene todo precargado"
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                <Save size={11} /> Guardar preset del producto
              </button>
            </div>
          )}

          {/* Config campaña */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Nombre de la campaña</span>
              <input value={nombre} onChange={e => setNombre(e.target.value)} className={input} disabled={!!fase} />
              <p className="text-[10px] text-gray-400 mt-1">Fecha predeterminada: mañana ({fechaCorta}). Con "CBO" + fecha entra sola a las cohortes de Testeos.</p>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Presupuesto diario (CBO){account?.currency ? ` · ${account.currency}` : ''}</span>
              <input type="number" min="1" value={presupuesto} onChange={e => setPresupuesto(e.target.value)} className={input} disabled={!!fase} placeholder="ej: 60000" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Ads por conjunto</span>
              <input type="number" min="1" max="10" value={adsPorSet} onChange={e => { const v = e.target.value; setAdsPorSet(v === '' ? '' : Math.max(1, Math.min(10, Math.round(Number(v) || 1)))); }} className={input} disabled={!!fase} />
              <p className="text-[10px] text-gray-400 mt-1">{elegidos.length} creativos → {nSets} conjunto{nSets === 1 ? '' : 's'}</p>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Patrón nombre de conjunto</span>
              <input value={adsetPattern} onChange={e => setAdsetPattern(e.target.value)} className={`${input} font-mono text-xs`} disabled={!!fase} />
              <p className="text-[10px] text-gray-400 mt-1">{'{index}'} · {'{index:01}'} · {'{date}'}</p>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Patrón nombre de ad</span>
              <input value={adPattern} onChange={e => setAdPattern(e.target.value)} className={`${input} font-mono text-xs`} disabled={!!fase} />
              <p className="text-[10px] text-gray-400 mt-1">{'{filename}'} · {'{index}'} · {'{index:01}'} · {'{date}'}</p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Texto principal del ad (común a todos)</span>
              <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={3} className={`${input} resize-y`} disabled={!!fase}
                placeholder="Se precarga con el copy del ad template (o del preset del producto)." />
            </div>
            <div className="sm:col-span-2">
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Titular (opcional)</span>
              <input value={titular} onChange={e => setTitular(e.target.value)} className={input} disabled={!!fase} />
            </div>
          </div>

          {/* Preview de la estructura */}
          {!soloPreset && elegidos.length > 0 && (
            <div>
              <button onClick={() => setVerPreview(v => !v)} className="text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 inline-flex items-center gap-1">
                <ChevronRight size={12} className={`transition-transform ${verPreview ? 'rotate-90' : ''}`} />
                Preview: {elegidos.length} ads en {nSets} conjunto{nSets === 1 ? '' : 's'} — qué se va a crear
              </button>
              {verPreview && (
                <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead><tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-400 text-[9px] uppercase tracking-wider">
                      <th className="text-left font-bold px-2.5 py-1.5">Campaña</th>
                      <th className="text-left font-bold px-2 py-1.5">Conjunto</th>
                      <th className="text-left font-bold px-2 py-1.5">Ad</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                      {elegidos.map((f, i) => (
                        <tr key={f.ts}>
                          <td className="px-2.5 py-1 text-gray-400 truncate max-w-[160px]">{i === 0 ? nombre : ''}</td>
                          <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{nombresSets[Math.floor(i / (Number(adsPorSet) || 3))]}</td>
                          <td className="px-2 py-1 text-gray-800 dark:text-gray-100 truncate max-w-[220px]" title={nombresAds[i]}>{nombresAds[i]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Log de publicación */}
          {logs.length > 0 && (
            <pre className="text-[11px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 whitespace-pre-wrap max-h-44 overflow-y-auto font-mono">{logs.join('\n')}</pre>
          )}
          {fase === 'listo' && resultado?.campaignId && (
            <a href={linkMeta({ accountId: account?.id, nivel: 'campaigns', ids: [resultado.campaignId] })} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 dark:text-brand-300 hover:underline">
              Ver la campaña en Meta <ExternalLink size={13} />
            </a>
          )}
        </div>
        </div>

        <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          {soloPreset ? (
            <>
              <span className="flex-1 min-w-0 text-[11px] text-gray-400">Se guarda como preset del producto: al publicar desde una tarjeta ya viene todo precargado.</span>
              <button onClick={() => { guardarPresetActual(false); onClose(); }} disabled={!account || !adSel}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-50">
                <Save size={14} /> Guardar campaña base
              </button>
            </>
          ) : (<>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer shrink-0">
            <input type="checkbox" checked={enPausa} onChange={e => setEnPausa(e.target.checked)} disabled={!!fase} className="accent-brand-500" />
            Publicar en pausa
          </label>
          <span className="flex-1 min-w-0 text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
            <AlertTriangle size={12} className="shrink-0" />
            {enPausa ? 'Se crea pausada: la revisás en Meta y la activás vos.' : 'Se publica ACTIVA: arranca a gastar apenas Meta la apruebe.'}
          </span>
          {fase === 'listo' || fase === 'error' ? (
            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">Cerrar</button>
          ) : (
            <button onClick={publicar} disabled={!listo}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-50">
              {fase ? <><Loader2 size={14} className="animate-spin" /> {fase === 'subiendo' ? 'Subiendo creativos…' : fase === 'procesando' ? 'Procesando en Meta…' : 'Creando campaña…'}</>
                : <><Rocket size={14} /> Publicar {elegidos.length} ad{elegidos.length === 1 ? '' : 's'} <ChevronRight size={13} /></>}
            </button>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}
