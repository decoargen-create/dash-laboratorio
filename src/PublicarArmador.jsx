// =========================================================================
// ARMADOR DE PUBLICACIÓN — pantalla completa, estilo "Meta uploader"
//
// Pedido del user: el popup estaba "todo muy amontonado"; acá se arma la
// publicación en una pantalla grande y distribuida:
//   · IZQUIERDA: todos los creativos del producto — videos de TODAS las
//     tarjetas (elegís video por video) + ESTÁTICOS de la galería — para
//     mezclar lo que quieras ("3 videos de una tarjeta, 4 imágenes...").
//   · DERECHA (sticky): el armado — cuántas campañas, cómo se reparte,
//     nombre, presupuesto y el botón de publicar.
//
// La config (cuenta, ad modelo, textos, presupuesto) sale del PRESET DEL
// PRODUCTO: se define una vez (al cargar el producto o acá mismo con
// "Configurar campaña base") e impacta en todos lados.
//
// Motor: el mismo del modal — upload-ad-videos → videos-status →
// upload-ad-images (nuevo) → create-campaign-structure — corrido una vez
// POR CAMPAÑA, en serie, con log en vivo.
// =========================================================================
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Rocket, ArrowLeft, Loader2, Check, AlertTriangle, ExternalLink, Film,
  Image as ImageIcon, Settings2, Trophy, ChevronRight, ChevronDown, Maximize2, X, Play,
} from 'lucide-react';
import { supabase } from './supabase.js';
import PublicarCampanaModal, {
  leerPresetPublicar, metaApi, esperar, amigable, sinExtension, aplicarPatron,
} from './PublicarCampanaModal.jsx';
import { useMetaConnections, useMetaAdAccounts } from './MetaConnect.jsx';
import { getReferencialesByProductoCloud } from './galeriaReferencialesCloud.js';
import { linkMeta } from './testeosCore.js';
import { weekLabel } from './produccionStore.js';

const normNombre = (s) => String(s || '').trim().toLowerCase();

// Producto de Marketing que corresponde a esta cola (matcheo por nombre, el
// mismo criterio del preset). Necesario para traer sus estáticos.
function productoIdDeNombre(nombre) {
  try {
    const productos = JSON.parse(localStorage.getItem('adslab-marketing-productos-v1') || '[]');
    const n = normNombre(nombre);
    const hit = productos.find(p => normNombre(p.nombre || p.name) === n);
    return hit ? String(hit.id) : null;
  } catch { return null; }
}

// Reparte una lista en N lotes round-robin (mantiene mezclados videos e
// imágenes y deja los lotes parejos: 20 en 3 → 7/7/6).
function repartir(items, n) {
  const lotes = Array.from({ length: n }, () => []);
  items.forEach((it, i) => lotes[i % n].push(it));
  return lotes.filter(l => l.length > 0);
}

export default function PublicarArmador({ producto, tarjetas, onVolver, onPublicadas, addToast, embedded = false }) {
  // Tarjetas DESGLOSABLES (pedido del user): cerradas muestran el resumen;
  // se abren para tildar videos sueltos.
  const [abiertas, setAbiertas] = useState(() => new Set());
  const toggleAbierta = (id) => setAbiertas(prev => { const nn = new Set(prev); if (nn.has(id)) nn.delete(id); else nn.add(id); return nn; });
  // ── Preset + cuenta ──
  const [presetTick, setPresetTick] = useState(0);
  const preset = useMemo(() => leerPresetPublicar(producto), [producto, presetTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const { connections } = useMetaConnections();
  const { accounts } = useMetaAdAccounts(connections);
  const account = useMemo(() => accounts.find(x => x.id === preset?.accountId) || null, [accounts, preset]);
  const [configurando, setConfigurando] = useState(false); // modal soloPreset

  // template del ad modelo (targeting/pixel/página/CTA que se clona)
  const [template, setTemplate] = useState(null);
  const [tplError, setTplError] = useState(null);
  useEffect(() => {
    setTemplate(null); setTplError(null);
    if (!account || !preset?.adId) return;
    let vivo = true;
    (async () => {
      try {
        const d = await metaApi(`template-config?ad_id=${encodeURIComponent(preset.adId)}`, { connId: account.connId });
        if (vivo) setTemplate(d);
      } catch (e) { if (vivo) setTplError(amigable(e.message)); }
    })();
    return () => { vivo = false; };
  }, [account?.id, preset?.adId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Creativos: videos por tarjeta + estáticos de la galería ──
  const videosDe = (a) => (a.archivos || []).filter(f => f && (f.driveId || f.storagePath));
  const [sel, setSel] = useState(() => {
    // Default: los videos APROBADOS (y todavía no publicados como anuncio)
    // de las tarjetas aprobadas.
    const s = new Set();
    for (const t of tarjetas) {
      if (t.estado !== 'aprobado') continue;
      for (const f of videosDe(t)) if (f.aprobado && !f.publicadoAd) s.add(`v:${t.id}:${f.ts}`);
    }
    return s;
  });
  const toggle = (k) => setSel(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Vista previa de VIDEO tipo Drive (pedido del user): los de Drive usan el
  // preview embebido (/file/<id>/preview); los subidos a AdsLab se firman y
  // se reproducen en un <video> directo.
  const [videoPrev, setVideoPrev] = useState(null); // { name, driveUrl? , fileUrl?, cargando }
  // Filtro de tarjetas (pedido del user): por defecto solo las APROBADAS (las
  // que están para publicar); "Todas" suma las ya publicadas para repescar.
  const [filtroTarjetas, setFiltroTarjetas] = useState('aprobadas'); // 'aprobadas' | 'todas'
  // Videos YA publicados como anuncio (publicadoAd): ocultos por defecto —
  // si de una tarjeta salieron 5 de 7, la próxima ves solo los 2 restantes.
  const [verPublicados, setVerPublicados] = useState(false);
  const videosVisiblesDe = (a) => videosDe(a).filter(f => verPublicados || !f.publicadoAd);
  const tarjetasVisibles = useMemo(() => (
    filtroTarjetas === 'aprobadas' ? tarjetas.filter(t => t.estado === 'aprobado') : tarjetas
  ), [tarjetas, filtroTarjetas]);
  const verVideo = useCallback(async (f) => {
    if (f.driveId) {
      setVideoPrev({ name: f.name, driveUrl: `https://drive.google.com/file/d/${encodeURIComponent(f.driveId)}/preview` });
      return;
    }
    if (f.storagePath && supabase) {
      setVideoPrev({ name: f.name, cargando: true });
      try {
        const { data, error } = await supabase.storage.from('creativos').createSignedUrl(f.storagePath, 3600);
        if (error || !data?.signedUrl) throw new Error(error?.message || 'sin URL');
        setVideoPrev(prev => (prev?.name === f.name ? { name: f.name, fileUrl: data.signedUrl } : prev));
      } catch (e) {
        setVideoPrev(null);
        addToast?.({ type: 'error', message: `No pude abrir el video: ${e.message}` });
      }
    }
  }, [addToast]);

  const [estaticos, setEstaticos] = useState(null); // null = cargando
  // Tamaño de las miniaturas con − / + (pedido del user): columnas libres,
  // de 10 por fila (chiquitas) hasta 3 por fila (lo más grande).
  const [cols, setCols] = useState(() => {
    try { const v = parseInt(localStorage.getItem('adslab-armador-estaticos-cols'), 10); return v >= 3 && v <= 10 ? v : 8; } catch { return 8; }
  });
  const cambiarCols = (delta) => setCols(prev => {
    const next = Math.max(3, Math.min(10, prev + delta));
    try { localStorage.setItem('adslab-armador-estaticos-cols', String(next)); } catch {}
    return next;
  });
  const [preview, setPreview] = useState(null); // estático abierto en grande
  const productoId = useMemo(() => productoIdDeNombre(producto), [producto]);
  useEffect(() => {
    let vivo = true;
    if (!productoId) { setEstaticos([]); return; }
    (async () => {
      try {
        const items = await getReferencialesByProductoCloud(productoId);
        if (vivo) setEstaticos(items || []);
      } catch { if (vivo) setEstaticos([]); }
    })();
    return () => { vivo = false; };
  }, [productoId]);

  // Ítems seleccionados, en orden estable (videos primero, por tarjeta).
  const elegidos = useMemo(() => {
    const out = [];
    for (const t of tarjetas) {
      for (const f of videosDe(t)) {
        const k = `v:${t.id}:${f.ts}`;
        if (sel.has(k)) out.push({ key: k, tipo: 'video', name: f.name, ts: f.ts, driveId: f.driveId || null, storagePath: f.storagePath || null, cardId: t.id });
      }
    }
    for (const e of (estaticos || [])) {
      const k = `i:${e.id}`;
      if (sel.has(k)) {
        const nombre = sinExtension(e.sourceHeadline || '').replace(/\{\{[^}]*\}\}/g, '').trim() || `${producto} estatico ${String(e.id).slice(0, 6)}`;
        out.push({ key: k, tipo: 'imagen', id: e.id, name: nombre.slice(0, 90), storagePath: e.storagePath || null, url: e.imageUrl || null });
      }
    }
    return out;
  }, [sel, tarjetas, estaticos, producto]);
  const nVideos = elegidos.filter(x => x.tipo === 'video').length;
  const nImagenes = elegidos.length - nVideos;

  // ── Armado de campañas ──
  const [fechaCorta] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric' }));
  const [nCampanas, setNCampanas] = useState(1);
  // El Armador publica TESTEOS (CBO simple, estilo Deep Pocket): las recetas
  // de ESCALADO (Cost Cap / Bid Cap, desde ads existentes por post id) viven
  // en la pestaña "Escalar" del Publicador — son otra cosa (pedido del user).
  const [nombreBase, setNombreBase] = useState(`${producto} ${fechaCorta} [CBO Testeo Videos]`);
  const [presupuesto, setPresupuesto] = useState(preset?.budget ? String(preset.budget) : '');
  useEffect(() => { if (preset?.budget && !presupuesto) setPresupuesto(String(preset.budget)); }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adsPorSet, setAdsPorSet] = useState(preset?.adsPerSet || 3);
  const [enPausa, setEnPausa] = useState(true);
  // Programación: fecha y hora (de Argentina) en que arrancan las campañas.
  // Vacío = arrancan cuando las actives. Meta las deja "Programadas".
  const [programada, setProgramada] = useState('');
  // Textos del anuncio: a la vista y editables (antes salían del preset sin
  // que los vieras). Se precargan con el preset o el copy del ad modelo.
  const [mensaje, setMensaje] = useState(preset?.mensaje || '');
  const [titular, setTitular] = useState(preset?.titular || '');
  useEffect(() => {
    if (template && !mensaje) setMensaje(preset?.mensaje || template.defaultMessage || '');
  }, [template]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Math.max(1, Math.min(6, Number(nCampanas) || 1));
  const lotes = useMemo(() => repartir(elegidos, n), [elegidos, n]);
  // Cada campaña puede llevar SU nombre (pedido del user): el input por
  // campaña pisa el default (base + · C1/C2…).
  const [nombresCampanas, setNombresCampanas] = useState({});
  const nombreCampana = (i) => {
    const custom = (nombresCampanas[i] || '').trim();
    if (custom) return custom;
    return lotes.length > 1 ? `${nombreBase.trim()} · C${i + 1}` : nombreBase.trim();
  };
  // Preview de la ESTRUCTURA: cómo queda cada campaña con sus conjuntos y
  // anuncios (el mismo reparto que arma el server: de a `adsPorSet`).
  const estructuraPreview = useMemo(() => {
    const perSet = Math.max(1, Number(adsPorSet) || 3);
    const adsetPattern = preset?.adsetPattern || 'Ad Set {index:01}';
    const adPattern = preset?.adPattern || '{filename}';
    return lotes.map((lote, c) => {
      const sets = [];
      for (let i = 0; i < lote.length; i += perSet) {
        const items = lote.slice(i, i + perSet).map((x, j) => ({
          tipo: x.tipo,
          nombre: aplicarPatron(adPattern, { filename: sinExtension(x.name), index: i + j, fecha: fechaCorta }) || sinExtension(x.name),
        }));
        sets.push({
          nombre: aplicarPatron(adsetPattern, { filename: '', index: sets.length, fecha: fechaCorta }) || `Ad Set ${sets.length + 1}`,
          items,
        });
      }
      return { nombre: nombreCampana(c), sets, total: lote.length };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotes, adsPorSet, preset, fechaCorta, nombreBase, nombresCampanas]);

  // ── Publicación (en serie, campaña por campaña) ──
  const [fase, setFase] = useState(null); // null | 'publicando' | 'listo' | 'error'
  const [logs, setLogs] = useState([]);
  // WIZARD EN 3 PASOS (idea del user): 1 elegir creativos → 2 armar campañas
  // (con la estructura en grande) → 3 publicando/resultado con progress bar.
  const [paso, setPaso] = useState(1);
  const [progreso, setProgreso] = useState({ pct: 0, etapa: '' });
  const [resumenFinal, setResumenFinal] = useState(null); // { campanas, totalCampanas, videos, estaticos }
  const [verLog, setVerLog] = useState(false);
  const logRef = React.useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs, verLog]);
  const [resultados, setResultados] = useState([]); // [{nombre, campaignId, okAds, total, estado}]
  const log = (l) => setLogs(prev => [...prev, l]);

  const listo = account && template?.pageId && elegidos.length > 0 && Number(presupuesto) > 0 && nombreBase.trim() && !fase;
  const loteMax = Math.max(0, ...lotes.map(l => l.length));

  const publicar = useCallback(async () => {
    if (!listo) return;
    if (loteMax > 30) {
      addToast?.({ type: 'warning', message: 'Máximo 30 creativos por campaña — repartí en más campañas o destildá algunos.' });
      return;
    }
    setFase('publicando'); setLogs([]); setResultados([]); setResumenFinal(null);
    setPaso(3); setProgreso({ pct: 2, etapa: 'Arrancando…' });
    // Notificación del navegador al terminar (si el user la permite).
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
    const totalC = lotes.length;
    const prog = (c, frac, etapa) => setProgreso({ pct: Math.min(99, Math.round(((c + frac) / totalC) * 100)), etapa });
    const hechos = [];
    let archivadosTotal = 0;
    const videosPublicados = []; // [{ cardId, ts }] — para marcar publicadoAd
    const adsetPattern = preset?.adsetPattern || 'Ad Set {index:01}';
    const adPattern = preset?.adPattern || '{filename}';
    let huboError = false;

    for (let c = 0; c < lotes.length; c++) {
      const lote = lotes[c];
      const nombre = nombreCampana(c);
      const vids = lote.filter(x => x.tipo === 'video');
      const imgs = lote.filter(x => x.tipo === 'imagen');
      log(`\n━━ Campaña ${c + 1}/${lotes.length}: "${nombre}" (${vids.length} video${vids.length === 1 ? '' : 's'} + ${imgs.length} imagen${imgs.length === 1 ? '' : 'es'})`);
      try {
        const adsListos = [];

        // 1. Videos → subir + esperar procesamiento.
        if (vids.length > 0) {
          prog(c, 0.08, `Campaña ${c + 1}/${totalC}: subiendo ${vids.length} video${vids.length === 1 ? '' : 's'} a Meta…`);
          log(`  Subiendo ${vids.length} video${vids.length === 1 ? '' : 's'} a Meta…`);
          const up = await metaApi('upload-ad-videos', {
            connId: account.connId, method: 'POST',
            body: { account_id: account.id, videos: vids.map((f, i) => ({ name: f.name, index: i, driveId: f.driveId, storagePath: f.storagePath })) },
          });
          const subidos = (up.resultados || []).filter(r => r.ok);
          for (const r of (up.resultados || [])) if (!r.ok) log(`  ✗ ${r.name}: ${r.error}`);
          var videosSubidosLote = []; // id de tarjeta + ts + nombre final del ad
          if (subidos.length > 0) {
            prog(c, 0.2, `Campaña ${c + 1}/${totalC}: Meta está procesando los videos…`);
            log('  Esperando que Meta procese los videos…');
            const ids = subidos.map(r => r.videoId);
            let estados = []; let erroresSeguidos = 0;
            for (let i = 0; i < 45; i++) {
              await esperar(4000);
              try {
                const st = await metaApi(`videos-status?ids=${ids.join(',')}`, { connId: account.connId });
                estados = st.videos || []; erroresSeguidos = 0;
                const listosN = estados.filter(v => v.ready).length;
                prog(c, 0.2 + 0.4 * (listosN / Math.max(1, ids.length)), `Campaña ${c + 1}/${totalC}: procesando videos (${listosN}/${ids.length} listos)…`);
                if (st.todosListos) break;
                if (estados.every(v => v.ready || v.status === 'error')) break;
              } catch (e) {
                erroresSeguidos++;
                if (erroresSeguidos >= 6) throw new Error(`Meta no responde el estado de los videos (${amigable(e.message)}).`);
              }
            }
            const porId = new Map(estados.map(v => [v.id, v]));
            for (const r of subidos) {
              if (!porId.get(r.videoId)?.ready) { log(`  ✗ ${r.name}: Meta no lo terminó de procesar`); continue; }
              const i = Number.isInteger(r.index) ? r.index : 0;
              const nombreAd = aplicarPatron(adPattern, { filename: sinExtension(vids[i]?.name || r.name), index: adsListos.length, fecha: fechaCorta }) || sinExtension(r.name);
              adsListos.push({ name: nombreAd, videoId: r.videoId, picture: porId.get(r.videoId)?.picture || null });
              if (vids[i]?.cardId && vids[i]?.ts) videosSubidosLote.push({ cardId: vids[i].cardId, ts: vids[i].ts, nombreAd });
            }
          }
        }

        // 2. Imágenes → adimages (hash). Guardamos id de galería ↔ nombre de
        // ad: las que efectivamente salgan como anuncio se ARCHIVAN solas (la
        // galería activa queda solo con lo no publicado — pedido del user).
        const imagenesSubidas = [];
        if (imgs.length > 0) {
          prog(c, 0.65, `Campaña ${c + 1}/${totalC}: subiendo ${imgs.length} imagen${imgs.length === 1 ? '' : 'es'}…`);
          log(`  Subiendo ${imgs.length} imagen${imgs.length === 1 ? '' : 'es'} a Meta…`);
          const up = await metaApi('upload-ad-images', {
            connId: account.connId, method: 'POST',
            body: { account_id: account.id, imagenes: imgs.map((f, i) => ({ name: f.name, index: i, storagePath: f.storagePath, url: f.storagePath ? null : f.url })) },
          });
          for (const r of (up.resultados || [])) {
            if (!r.ok) { log(`  ✗ ${r.name}: ${r.error}`); continue; }
            const nombreAd = aplicarPatron(adPattern, { filename: r.name, index: adsListos.length, fecha: fechaCorta }) || r.name;
            adsListos.push({ name: nombreAd, imageHash: r.imageHash });
            const idGaleria = Number.isInteger(r.index) ? imgs[r.index]?.id : null;
            if (idGaleria) imagenesSubidas.push({ id: idGaleria, nombreAd });
          }
        }

        if (adsListos.length === 0) throw new Error('Ningún creativo del lote quedó listo para publicar.');

        // 3. Estructura: campaña → conjuntos → ads.
        prog(c, 0.75, `Campaña ${c + 1}/${totalC}: creando campaña, conjuntos y anuncios…`);
        log(`  Creando campaña con ${adsListos.length} ads…`);
        const cr = await metaApi('create-campaign-structure', {
          connId: account.connId, method: 'POST',
          body: {
            account_id: account.id,
            currency: account.currency || '',
            producto,
            campaignName: nombre,
            dailyBudget: Number(presupuesto),
            adsPerSet: Number(adsPorSet) || 3,
            adsetNamePattern: adsetPattern,
            fecha: fechaCorta,
            status: enPausa ? 'PAUSED' : 'ACTIVE',
            startTime: programada ? `${programada}:00-03:00` : undefined,
            template,
            message: mensaje,
            headline: titular,
            ads: adsListos,
          },
        });
        for (const l of (cr.log || [])) log(`  ${l}`);
        if (cr.error) throw new Error(cr.error);
        const okAds = (cr.resultados || []).filter(r => r.ok).length;
        if (okAds === 0 || cr.estado === 'DELETED') throw new Error('Ningún anuncio se pudo crear — la campaña se deshizo sola.');
        hechos.push({ nombre, campaignId: cr.campaignId, okAds, total: adsListos.length, estado: cr.estado, cardIds: [...new Set(vids.map(v => v.cardId))] });
        log(`  ✓ Campaña ${c + 1} lista: ${okAds}/${adsListos.length} ads (${cr.estado === 'ACTIVE' ? 'ACTIVA' : 'EN PAUSA'})`);
        // Archivar los estáticos que salieron como anuncio: la galería activa
        // queda solo con lo pendiente de publicar.
        const okNombres = new Set((cr.resultados || []).filter(r => r.ok).map(r => r.name));
        // Videos cuyo ad se creó OK → se marcan publicadoAd al final.
        for (const v of (videosSubidosLote || [])) if (okNombres.has(v.nombreAd)) videosPublicados.push({ cardId: v.cardId, ts: v.ts });
        const aArchivar = imagenesSubidas.filter(x => okNombres.has(x.nombreAd)).map(x => x.id);
        if (aArchivar.length > 0 && supabase) {
          try {
            const { error: eArch } = await supabase.from('marketing_creativos')
              .update({ archivado: true, archivado_at: new Date().toISOString() })
              .in('id', aArchivar);
            if (eArch) throw new Error(eArch.message);
            archivadosTotal += aArchivar.length;
            log(`  🗄 ${aArchivar.length} estático${aArchivar.length === 1 ? '' : 's'} archivado${aArchivar.length === 1 ? '' : 's'} (ya publicado${aArchivar.length === 1 ? '' : 's'})`);
            const idsArch = new Set(aArchivar);
            setEstaticos(prev => (prev || []).filter(e => !idsArch.has(e.id)));
            setSel(prev => { const nn = new Set(prev); for (const id of aArchivar) nn.delete(`i:${id}`); return nn; });
          } catch (e) {
            log(`  ⚠ No pude archivar los estáticos publicados (${e.message}) — archivalos a mano en la galería`);
          }
        }
      } catch (e) {
        huboError = true;
        log(`  ✗ Campaña ${c + 1}: ${e.message}`);
      }
    }

    setResultados(hechos);
    if (videosPublicados.length > 0) {
      setSel(prev => { const nn = new Set(prev); for (const v of videosPublicados) nn.delete(`v:${v.cardId}:${v.ts}`); return nn; });
    }
    setResumenFinal({ campanas: hechos.length, totalCampanas: lotes.length, videos: videosPublicados.length, estaticos: archivadosTotal });
    setProgreso({ pct: 100, etapa: hechos.length > 0 ? 'Terminado' : 'Falló' });
    if (hechos.length > 0) {
      setFase(huboError ? 'error' : 'listo');
      try { onPublicadas?.(videosPublicados); } catch {}
      const msg = `${hechos.length}/${lotes.length} campaña${lotes.length === 1 ? '' : 's'} creada${hechos.length === 1 ? '' : 's'}${enPausa ? ' en pausa' : ''} 🚀`;
      addToast?.({ type: huboError ? 'warning' : 'success', message: msg });
      // Notificación del navegador: por si estás en otra pestaña esperando.
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('AdsLab · Publicación lista ✓', { body: msg }); } catch {}
    } else {
      setFase('error');
      addToast?.({ type: 'error', message: 'No se pudo crear ninguna campaña — mirá el detalle.' });
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('AdsLab · La publicación falló', { body: 'Mirá el detalle en el Publicador.' }); } catch {}
    }
  }, [listo, lotes, loteMax, account, template, preset, producto, presupuesto, adsPorSet, enPausa, nombreBase, fechaCorta, mensaje, titular, programada, nombresCampanas, addToast, onPublicadas]); // eslint-disable-line react-hooks/exhaustive-deps

  const input = 'w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  // Selección por grupo (tarjeta entera / todos los estáticos).
  const toggleTarjeta = (t) => {
    const keys = videosDe(t).map(f => `v:${t.id}:${f.ts}`);
    const todas = keys.every(k => sel.has(k));
    setSel(prev => { const nn = new Set(prev); for (const k of keys) { if (todas) nn.delete(k); else nn.add(k); } return nn; });
  };

  return (
    <div className={embedded ? 'space-y-5' : 'max-w-7xl mx-auto px-4 py-6 space-y-5'}>
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        {!embedded && (
          <button onClick={onVolver} disabled={fase === 'publicando'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-40">
            <ArrowLeft size={14} /> Volver
          </button>
        )}
        <div className="min-w-0 flex-1">
          {!embedded && (
            <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2 truncate">
              <Rocket size={19} className="text-brand-600 shrink-0" /> Armar publicación — {producto}
            </h1>
          )}
        </div>
        {/* Preset del producto: la config sale de acá e impacta en todos lados */}
        {preset?.adId && account ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1">
            <Check size={12} /> Campaña base: {preset.adLabel || preset.adId} · {account.name || account.id}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2.5 py-1">
            <AlertTriangle size={12} /> Falta la campaña base del producto
          </span>
        )}
        <button onClick={() => setConfigurando(true)} disabled={fase === 'publicando'}
          title="La campaña base define cuenta, público, píxel, página y textos. Se configura UNA vez por producto y queda para todas las publicaciones."
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-brand-400 transition disabled:opacity-40">
          <Settings2 size={13} /> {preset?.adId ? 'Cambiar campaña base' : 'Configurar campaña base'}
        </button>
      </div>

      {tplError && (
        <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertTriangle size={13} /> La campaña base no se pudo leer: {tplError} — configurala de nuevo.</p>
      )}


      {/* Stepper: 1 Creativos → 2 Campañas → 3 Resultado */}
      <div className="flex items-center gap-2 text-[11.5px] font-bold">
        {[[1, 'Creativos'], [2, 'Campañas'], [3, 'Publicación']].map(([num, label], i) => (
          <React.Fragment key={num}>
            {i > 0 && <span className="text-gray-300 dark:text-gray-600">—</span>}
            <button
              onClick={() => {
                if (fase === 'publicando' || num >= paso || num === 3) return;
                if (fase) { setFase(null); setLogs([]); setVerLog(false); setProgreso({ pct: 0, etapa: '' }); }
                setPaso(num);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition ${paso === num
                ? 'bg-brand-600 text-white border-brand-600'
                : num < paso ? 'text-brand-600 dark:text-brand-400 border-brand-400/50 hover:bg-brand-500/10 cursor-pointer'
                : 'text-gray-400 border-gray-300 dark:border-gray-600 cursor-default'}`}>
              <span className={`w-4 h-4 rounded-full grid place-items-center text-[10px] ${paso === num ? 'bg-white/25' : 'bg-gray-200 dark:bg-gray-700'}`}>{num < paso ? '✓' : num}</span>
              {label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* ══ PASO 1 · CREATIVOS (todo el ancho) ══ */}
      {paso === 1 && (
        <div className="space-y-5">
          {/* Videos por tarjeta */}
          <section>
            <h2 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-1.5 flex-wrap">
              <Film size={14} className="text-brand-500" /> Videos de Producción
              <span className="inline-flex gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                {[['aprobadas', 'Para publicar'], ['todas', 'Todas']].map(([k, l]) => (
                  <button key={k} onClick={() => setFiltroTarjetas(k)}
                    title={k === 'aprobadas' ? 'Solo las tarjetas APROBADAS: las que están listas para salir.' : 'Incluye también las ya publicadas, por si querés repescar un video.'}
                    className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold transition ${filtroTarjetas === k ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
                    {l}
                  </button>
                ))}
              </span>
              <label className="inline-flex items-center gap-1 text-[10.5px] text-gray-400 cursor-pointer select-none"
                title="Los videos que ya salieron como anuncio se ocultan — tildá para verlos (quedan marcados con 🚀).">
                <input type="checkbox" checked={verPublicados} onChange={e => setVerPublicados(e.target.checked)} className="accent-brand-500 scale-90" />
                ver ya publicados
              </label>
              <span className="ml-auto inline-flex gap-2 text-[11px] font-bold">
                <button onClick={() => setSel(prev => { const nn = new Set(prev); for (const t of tarjetasVisibles) for (const f of videosVisiblesDe(t)) nn.add(`v:${t.id}:${f.ts}`); return nn; })}
                  disabled={fase === 'publicando'} className="text-brand-600 dark:text-brand-400 hover:underline">Todos</button>
                <button onClick={() => setSel(prev => { const nn = new Set(prev); for (const k of prev) if (k.startsWith('v:')) nn.delete(k); return nn; })}
                  disabled={fase === 'publicando'} className="text-gray-400 hover:underline">Ninguno</button>
              </span>
            </h2>
            {tarjetasVisibles.length === 0 ? (
              <p className="text-sm text-gray-400">
                {filtroTarjetas === 'aprobadas'
                  ? 'No hay tarjetas aprobadas sin publicar — mirá en «Todas» si querés repescar una publicada.'
                  : 'Este producto no tiene tarjetas con videos.'}
              </p>
            ) : (
              <div className="space-y-3">
                {tarjetasVisibles.map(t => {
                  const vids = videosVisiblesDe(t);
                  const ocultos = videosDe(t).length - vids.length;
                  if (vids.length === 0 && ocultos === 0) return null;
                  const keys = vids.map(f => `v:${t.id}:${f.ts}`);
                  const nSel = keys.filter(k => sel.has(k)).length;
                  const abierta = abiertas.has(t.id);
                  return (
                    <div key={t.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
                      <div onClick={() => toggleAbierta(t.id)}
                        className={`flex items-center gap-2.5 px-3.5 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${abierta ? 'border-b border-gray-100 dark:border-gray-700/60' : ''}`}>
                        <input type="checkbox" checked={nSel === keys.length} ref={el => { if (el) el.indeterminate = nSel > 0 && nSel < keys.length; }}
                          onClick={e => e.stopPropagation()} onChange={() => toggleTarjeta(t)} disabled={fase === 'publicando'}
                          title="Tildar/destildar todos los videos de esta tarjeta"
                          className="w-4 h-4 accent-brand-600" />
                        {abierta ? <ChevronDown size={14} className="text-brand-500 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                        <span className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">
                          {t.persona || 'Sin editor'} · {weekLabel(t.weekKey) || t.weekKey || ''}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${t.estado === 'aprobado' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-violet-500/10 text-violet-600 dark:text-violet-400'}`}>
                          {t.estado === 'aprobado' ? 'APROBADA' : 'PUBLICADA'}
                        </span>
                        <span className="ml-auto text-[11px] text-gray-400 tabular-nums">
                          {nSel}/{vids.length} video{vids.length === 1 ? '' : 's'}
                          {ocultos > 0 && !verPublicados && <span className="text-gray-500"> · 🚀 {ocultos} ya publicado{ocultos === 1 ? '' : 's'}</span>}
                        </span>
                      </div>
                      {abierta && (
                        <div className="flex flex-col">
                          {vids.map(f => {
                            const k = `v:${t.id}:${f.ts}`;
                            return (
                              <label key={k} className="group/v flex items-center gap-2 px-3.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer min-w-0">
                                <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} disabled={fase === 'publicando'} className="accent-brand-500" />
                                <Film size={12} className="text-gray-400 shrink-0" />
                                <span className="flex-1 min-w-0 truncate text-xs text-gray-700 dark:text-gray-200" title={f.name}>{f.name}</span>
                                {f.publicadoAd && <span className="text-[9px] font-bold text-violet-500 shrink-0" title={`Ya salió como anuncio el ${new Date(f.publicadoAd).toLocaleDateString('es-AR')}`}>🚀</span>}
                                <button type="button" onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); verVideo(f); }}
                                  title="Ver el video"
                                  className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-brand-500 hover:bg-brand-500/10 opacity-0 group-hover/v:opacity-100 transition">
                                  <Play size={12} fill="currentColor" />
                                </button>
                                {f.aprobado && <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">✓</span>}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>


          {/* Estáticos */}
          <section>
            <h2 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-1.5 flex-wrap">
              <ImageIcon size={14} className="text-brand-500" /> Estáticos del producto
              <span className="text-[11px] font-semibold text-gray-400">las imágenes de tu galería, publicables como anuncios</span>
              {(estaticos || []).length > 0 && (
                <span className="ml-auto inline-flex items-center gap-2 text-[11px] font-bold">
                  <span className="inline-flex gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 mr-1" title="Tamaño de las miniaturas (máximo: 3 por fila)">
                    <button onClick={() => cambiarCols(1)} disabled={cols >= 10} title="Más chicas"
                      className="w-6 h-5 rounded-md text-[13px] font-bold leading-none text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-white dark:hover:bg-gray-700 transition disabled:opacity-30">−</button>
                    <button onClick={() => cambiarCols(-1)} disabled={cols <= 3} title="Más grandes"
                      className="w-6 h-5 rounded-md text-[13px] font-bold leading-none text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-white dark:hover:bg-gray-700 transition disabled:opacity-30">+</button>
                  </span>
                  <button onClick={() => setSel(prev => { const nn = new Set(prev); for (const e of (estaticos || [])) nn.add(`i:${e.id}`); return nn; })}
                    disabled={fase === 'publicando'} className="text-brand-600 dark:text-brand-400 hover:underline">Todos</button>
                  <button onClick={() => setSel(prev => { const nn = new Set(prev); for (const k of prev) if (k.startsWith('i:')) nn.delete(k); return nn; })}
                    disabled={fase === 'publicando'} className="text-gray-400 hover:underline">Ninguno</button>
                </span>
              )}
            </h2>
            {estaticos === null ? (
              <p className="text-sm text-gray-400 inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando la galería…</p>
            ) : !productoId ? (
              <p className="text-sm text-gray-400">No encontré «{producto}» entre tus productos de Marketing — los estáticos viven ahí.</p>
            ) : estaticos.length === 0 ? (
              <p className="text-sm text-gray-400">Este producto todavía no tiene estáticos en la galería.</p>
            ) : (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {estaticos.map(e => {
                  const k = `i:${e.id}`;
                  const on = sel.has(k);
                  return (
                    <button key={e.id} onClick={() => toggle(k)} disabled={fase === 'publicando'}
                      title={e.sourceHeadline || 'Estático'}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition group ${on ? 'border-brand-500 ring-2 ring-brand-500/40' : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'}`}>
                      {e.imageUrl
                        ? <img src={e.imageUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        : <span className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800"><ImageIcon size={18} className="text-gray-400" /></span>}
                      <span className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-md flex items-center justify-center text-white text-[11px] font-bold transition ${on ? 'bg-brand-600' : 'bg-black/40 opacity-0 group-hover:opacity-100'}`}>
                        {on ? '✓' : '+'}
                      </span>
                      {e.winner && <Trophy size={12} className="absolute top-1.5 right-1.5 text-amber-400 drop-shadow" />}
                      <span role="button" tabIndex={-1} title="Ver en grande"
                        onClick={(ev) => { ev.stopPropagation(); setPreview(e); }}
                        className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-md bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/70 transition">
                        <Maximize2 size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>


          {/* Barra de avance al paso 2: pegada abajo, siempre a mano */}
          <div className="sticky bottom-3 z-30">
            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-4 py-3 shadow-xl">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                {elegidos.length} creativo{elegidos.length === 1 ? '' : 's'}
                <span className="font-normal text-gray-400"> · {nVideos} video{nVideos === 1 ? '' : 's'} · {nImagenes} imagen{nImagenes === 1 ? '' : 'es'}</span>
              </p>
              <button onClick={() => setPaso(2)} disabled={elegidos.length === 0}
                className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-40">
                Siguiente: armar campañas <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ PASO 2 · CAMPAÑAS (config + estructura en grande) ══ */}
      {paso === 2 && (
        <div className="grid lg:grid-cols-5 gap-5 items-start">
          {/* Config (izquierda) */}
          <div className="lg:col-span-2 space-y-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
              {elegidos.length} creativo{elegidos.length === 1 ? '' : 's'} · {nVideos} 🎥 · {nImagenes} 🖼
              <button onClick={() => setPaso(1)} className="ml-2 normal-case font-bold text-brand-600 dark:text-brand-400 hover:underline">cambiar</button>
            </p>
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5"
              title="Los creativos elegidos se reparten parejo entre las campañas (mezclando videos e imágenes).">¿En cuántas campañas?</span>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5, 6].map(x => (
                <button key={x} onClick={() => setNCampanas(x)} disabled={fase === 'publicando'}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-bold border transition ${n === x
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-brand-400'}`}>{x}</button>
              ))}
            </div>
            {elegidos.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-1.5">
                Reparto: {lotes.map(l => l.length).join(' + ')} creativos{loteMax > 30 ? ' — ⚠ máx. 30 por campaña' : ''}
              </p>
            )}
          </div>

          <div>
            {/* Con UNA campaña: un solo nombre. Con VARIAS: un input editable
                por campaña, ya precargado (sin campo "base" que confunda). */}
            {lotes.length <= 1 ? (
              <>
                <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Nombre de la campaña</span>
                <input value={nombreBase} onChange={e => setNombreBase(e.target.value)} className={input} disabled={fase === 'publicando'} />
              </>
            ) : (
              <>
                <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Nombre de cada campaña</span>
                <div className="space-y-1.5">
                  {lotes.map((_, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-gray-400 w-7 shrink-0">C{i + 1}</span>
                      <input value={nombresCampanas[i] ?? `${nombreBase.trim()} · C${i + 1}`}
                        onChange={e => setNombresCampanas(prev => ({ ...prev, [i]: e.target.value }))}
                        className={`${input} text-xs`} disabled={fase === 'publicando'} />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Editá el que quieras — cada campaña sale con SU nombre.</p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5"
                title="Presupuesto diario de CADA campaña (CBO: Meta lo reparte entre los conjuntos)">Presupuesto c/u{account?.currency ? ` · ${account.currency}` : ''}</span>
              <input type="number" min="1" value={presupuesto} onChange={e => setPresupuesto(e.target.value)} className={input} disabled={fase === 'publicando'} placeholder="ej: 60000" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5"
                title="Cuántos anuncios entran en cada conjunto de la campaña">Ads por conjunto</span>
              <input type="number" min="1" max="10" value={adsPorSet} onChange={e => setAdsPorSet(e.target.value === '' ? '' : Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))))} className={input} disabled={fase === 'publicando'} />
            </div>
          </div>

          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5"
              title="Hora de Argentina. Meta deja las campañas «Programadas» y no gastan hasta esa fecha — para eso tienen que crearse ACTIVAS (destildá «Crear pausadas»).">
              Programada para (opcional)</span>
            <input type="datetime-local" value={programada} onChange={e => setProgramada(e.target.value)} className={input} disabled={fase === 'publicando'} />
            {programada && enPausa && (
              <p className="text-[10px] text-amber-500 mt-1">Ojo: pausada + programada no arranca sola — destildá «Crear pausadas» para que quede Programada de verdad.</p>
            )}
          </div>

          <details className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
            <summary className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 cursor-pointer select-none">
              Textos del anuncio {mensaje ? '· ✓' : '· del ad modelo'}
            </summary>
            <div className="mt-2 space-y-2">
              <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={3} className={`${input} resize-y`} disabled={fase === 'publicando'}
                placeholder="Texto principal (común a todos los ads). Se precarga con el del ad modelo." />
              <input value={titular} onChange={e => setTitular(e.target.value)} className={input} disabled={fase === 'publicando'} placeholder="Titular (opcional)" />
            </div>
          </details>

          <label className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={enPausa} onChange={e => setEnPausa(e.target.checked)} disabled={fase === 'publicando'} className="accent-brand-500" />
            Crear pausadas <span className="text-gray-400">(recomendado: las revisás en Meta antes de prenderlas)</span>
          </label>

          {!preset?.adId && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Configurá la <b>campaña base</b> del producto (botón de arriba): define cuenta, público, píxel y textos. Una vez y listo.
            </p>
          )}
          {preset?.adId && !account && accounts.length > 0 && (
            <p className="text-[11px] text-rose-500">La cuenta del preset ya no está disponible — reconfigurá la campaña base.</p>
          )}
          {nImagenes > 0 && template && !template.link && (
            <p className="text-[11px] text-rose-500">El ad modelo no tiene link de destino: las imágenes lo necesitan. Elegí otra campaña base.</p>
          )}


          </div>

          {/* Estructura EN GRANDE (derecha): sin cortes, nombres completos */}
          <div className="lg:col-span-3 space-y-3">
            <h2 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">📋 Así queda la estructura</h2>
            {elegidos.length === 0 ? (
              <p className="text-sm text-gray-400">No hay creativos elegidos — volvé al paso 1.</p>
            ) : (
              <div className="space-y-3">
                {estructuraPreview.map((c, i) => (
                  <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4">
                    <p className="text-sm font-extrabold text-gray-900 dark:text-gray-100 break-words">📦 {c.nombre}</p>
                    <p className="text-[11px] text-gray-400 mb-2">
                      {Number(presupuesto) > 0 ? `$${Number(presupuesto).toLocaleString('es-AR')}/día · ` : ''}
                      {c.sets.length} conjunto{c.sets.length === 1 ? '' : 's'} · {c.total} anuncio{c.total === 1 ? '' : 's'}
                      {programada ? ` · 🗓 programada ${new Date(`${programada}:00-03:00`).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} hs` : ''}
                      {enPausa ? ' · en pausa' : ' · ACTIVA'}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2.5">
                      {c.sets.map((st, j) => (
                        <div key={j} className="rounded-xl border border-gray-100 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-900/40 p-2.5">
                          <p className="text-[11.5px] font-bold text-gray-700 dark:text-gray-200 break-words">{st.nombre} <span className="text-gray-400 font-normal">· {st.items.length} ad{st.items.length === 1 ? '' : 's'}</span></p>
                          <div className="mt-1 space-y-0.5">
                            {st.items.map((it, k) => (
                              <p key={k} className="text-[11px] text-gray-500 dark:text-gray-400 break-words leading-snug">
                                {it.tipo === 'video' ? '🎥' : '🖼'} {it.nombre}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button onClick={() => setPaso(1)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                <ArrowLeft size={14} /> Creativos
              </button>
              <button onClick={publicar} disabled={!listo}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-50">
                <Rocket size={14} /> Publicar {lotes.length} campaña{lotes.length === 1 ? '' : 's'} · {elegidos.length} creativo{elegidos.length === 1 ? '' : 's'} <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ PASO 3 · PUBLICANDO / RESULTADO ══ */}
      {paso === 3 && (
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              {fase === 'publicando'
                ? <Loader2 size={20} className="animate-spin text-brand-500 shrink-0" />
                : fase === 'listo'
                  ? <span className="w-8 h-8 rounded-full bg-emerald-500 text-white grid place-items-center shrink-0"><Check size={18} /></span>
                  : <span className="w-8 h-8 rounded-full bg-rose-500 text-white grid place-items-center shrink-0"><AlertTriangle size={16} /></span>}
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                  {fase === 'publicando' ? `Publicando ${lotes.length} campaña${lotes.length === 1 ? '' : 's'}…`
                    : fase === 'listo' ? '¡Publicación terminada!'
                    : resultados.length > 0 ? 'Terminó con detalles' : 'La publicación falló'}
                </p>
                <p className="text-xs text-gray-400 truncate">{fase === 'publicando' ? progreso.etapa : resumenFinal ? `${resumenFinal.campanas}/${resumenFinal.totalCampanas} campañas · ${resumenFinal.videos} video${resumenFinal.videos === 1 ? '' : 's'} marcado${resumenFinal.videos === 1 ? '' : 's'} publicado${resumenFinal.videos === 1 ? '' : 's'} · ${resumenFinal.estaticos} estático${resumenFinal.estaticos === 1 ? '' : 's'} archivado${resumenFinal.estaticos === 1 ? '' : 's'}` : ''}</p>
              </div>
              {fase === 'publicando' && <span className="text-[10px] text-amber-500 font-semibold shrink-0">no cierres la pestaña</span>}
            </div>

            {/* Progress bar */}
            <div>
              <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${fase === 'error' ? 'bg-rose-500' : 'bg-gradient-to-r from-brand-500 to-violet-400'}`}
                  style={{ width: `${progreso.pct}%` }} />
              </div>
              <p className="text-right text-[10.5px] text-gray-400 mt-1 tabular-nums">{progreso.pct}%</p>
            </div>

            {/* Campañas creadas, con link directo */}
            {resultados.length > 0 && (
              <div className="space-y-1.5">
                {resultados.map(r => (
                  <a key={r.campaignId} href={linkMeta({ accountId: account?.id, nivel: 'campaigns', ids: [r.campaignId] })} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:border-emerald-500/60 transition">
                    <Check size={14} className="text-emerald-500 shrink-0" />
                    <span className="truncate flex-1">{r.nombre}</span>
                    <span className="text-[11px] text-gray-400 font-normal shrink-0">{r.okAds}/{r.total} ads · {r.estado === 'ACTIVE' ? 'activa' : 'en pausa'}</span>
                    <ExternalLink size={12} className="text-brand-500 shrink-0" />
                  </a>
                ))}
              </div>
            )}

            {/* Log paso a paso (colapsado por defecto) */}
            <div>
              <button onClick={() => setVerLog(v => !v)} className="text-[11px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                {verLog ? '▾ Ocultar detalle' : '▸ Ver el paso a paso completo'}
              </button>
              {(verLog || fase === 'publicando') && (
                <pre ref={logRef} className="mt-1.5 text-[10.5px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/60 rounded-lg p-2.5 border border-gray-100 dark:border-gray-700/60 whitespace-pre-wrap max-h-52 overflow-y-auto font-mono leading-relaxed">{logs.join('\n') || 'Arrancando…'}</pre>
              )}
            </div>

            {(fase === 'listo' || fase === 'error') && (
              <div className="flex items-center gap-2.5 pt-1">
                <button onClick={() => { setPaso(1); setFase(null); setLogs([]); setVerLog(false); setProgreso({ pct: 0, etapa: '' }); }}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">
                  Armar otra publicación
                </button>
                <button onClick={() => { const r = resultados[0]; if (r) window.open(linkMeta({ accountId: account?.id, nivel: 'campaigns', ids: resultados.map(x => x.campaignId) }), '_blank'); }}
                  disabled={resultados.length === 0}
                  className="px-3.5 py-2.5 text-sm font-bold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-brand-400 transition disabled:opacity-40">
                  Ver en Meta
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reproductor de video (tipo Drive) */}
      {videoPrev && (
        <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setVideoPrev(null)}>
          <div className="relative w-full max-w-md flex flex-col gap-2" onClick={ev => ev.stopPropagation()}>
            <div className="flex items-center gap-2 text-white">
              <Film size={14} className="shrink-0" />
              <span className="text-sm font-semibold truncate flex-1">{videoPrev.name}</span>
              <button onClick={() => setVideoPrev(null)} className="p-1.5 rounded-lg hover:bg-white/15 transition"><X size={16} /></button>
            </div>
            {videoPrev.cargando ? (
              <div className="aspect-[9/16] max-h-[70vh] rounded-xl bg-gray-900 flex items-center justify-center text-gray-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : videoPrev.driveUrl ? (
              <iframe src={videoPrev.driveUrl} title={videoPrev.name} allow="autoplay; fullscreen"
                className="w-full aspect-[9/16] max-h-[70vh] rounded-xl bg-black border-0" />
            ) : (
              <video src={videoPrev.fileUrl} controls autoPlay className="w-full max-h-[70vh] rounded-xl bg-black" />
            )}
          </div>
        </div>
      )}

      {/* Lightbox: un estático en grande, con tildar/destildar ahí mismo. */}
      {preview && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <div className="relative max-w-3xl max-h-[85vh] flex flex-col items-center gap-3" onClick={ev => ev.stopPropagation()}>
            <img src={preview.imageUrl} alt="" className="max-h-[72vh] max-w-full rounded-xl shadow-2xl object-contain" />
            <div className="flex items-center gap-2">
              <button onClick={() => { toggle(`i:${preview.id}`); }}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition ${sel.has(`i:${preview.id}`)
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-brand-600 text-white hover:bg-brand-700'}`}>
                {sel.has(`i:${preview.id}`) ? '✓ Seleccionado — sacar' : '+ Seleccionar para publicar'}
              </button>
              <button onClick={() => setPreview(null)}
                className="px-3 py-2 text-sm font-bold rounded-lg bg-white/10 text-white hover:bg-white/20 transition inline-flex items-center gap-1">
                <X size={14} /> Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configurar la campaña base (preset del producto) — reusa el modal en
          modo soloPreset; al cerrar, se relee el preset. */}
      {configurando && (
        <PublicarCampanaModal
          a={{ id: `preset-${producto}`, productoNombre: producto, archivos: [] }}
          soloPreset
          addToast={addToast}
          onClose={() => { setConfigurando(false); setPresetTick(t => t + 1); }}
        />
      )}
    </div>
  );
}
