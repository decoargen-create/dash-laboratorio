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
  Image as ImageIcon, Settings2, Trophy, ChevronRight,
} from 'lucide-react';
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

export default function PublicarArmador({ producto, tarjetas, onVolver, onPublicadas, addToast }) {
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
    // Default: los videos APROBADOS de las tarjetas aprobadas.
    const s = new Set();
    for (const t of tarjetas) {
      if (t.estado !== 'aprobado') continue;
      for (const f of videosDe(t)) if (f.aprobado) s.add(`v:${t.id}:${f.ts}`);
    }
    return s;
  });
  const toggle = (k) => setSel(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const [estaticos, setEstaticos] = useState(null); // null = cargando
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
        if (sel.has(k)) out.push({ key: k, tipo: 'video', name: f.name, driveId: f.driveId || null, storagePath: f.storagePath || null, cardId: t.id });
      }
    }
    for (const e of (estaticos || [])) {
      const k = `i:${e.id}`;
      if (sel.has(k)) {
        const nombre = sinExtension(e.sourceHeadline || '') || `${producto} estatico ${String(e.id).slice(0, 6)}`;
        out.push({ key: k, tipo: 'imagen', name: nombre.slice(0, 90), storagePath: e.storagePath || null, url: e.imageUrl || null });
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
  // Receta: dónde vive el presupuesto (CBO campaña / ABO conjunto) y la puja.
  const RECETAS = [
    { id: 'cbo_deep', label: '💰 CBO Deep Pocket', tag: '[CBO Testeo Videos]', desc: 'La de testeo de siempre: presupuesto en la campaña, Meta reparte libre. Recomendada.' },
    { id: 'cbo_costcap', label: '🎯 CBO Cost Cap', tag: '[CBO Costcap]', desc: 'Presupuesto en la campaña + costo por compra OBJETIVO: Meta compra a ese precio o mejor.' },
    { id: 'abo_costcap', label: '🎯 ABO Cost Cap', tag: '[ABO Costcap]', desc: 'Presupuesto POR CONJUNTO + costo por compra objetivo.' },
    { id: 'abo_bidcap', label: '🧢 ABO Bid Cap', tag: '[ABO Bidcap]', desc: 'Presupuesto POR CONJUNTO + tope de puja duro: control total, crece más lento.' },
  ];
  const [receta, setReceta] = useState('cbo_deep');
  const [puja, setPuja] = useState('');
  const esCbo = receta.startsWith('cbo');
  const nombreDefault = (r) => `${producto} ${fechaCorta} ${RECETAS.find(x => x.id === r)?.tag || ''}`.trim();
  const [nombreBase, setNombreBase] = useState(() => nombreDefault('cbo_deep'));
  // Cambiar de receta actualiza el tag del nombre SOLO si no lo tocaste a mano.
  const cambiarReceta = (r) => {
    setNombreBase(prev => (prev === nombreDefault(receta) ? nombreDefault(r) : prev));
    setReceta(r);
  };
  const [presupuesto, setPresupuesto] = useState(preset?.budget ? String(preset.budget) : '');
  useEffect(() => { if (preset?.budget && !presupuesto) setPresupuesto(String(preset.budget)); }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adsPorSet, setAdsPorSet] = useState(preset?.adsPerSet || 3);
  const [enPausa, setEnPausa] = useState(true);
  // Textos del anuncio: a la vista y editables (antes salían del preset sin
  // que los vieras). Se precargan con el preset o el copy del ad modelo.
  const [mensaje, setMensaje] = useState(preset?.mensaje || '');
  const [titular, setTitular] = useState(preset?.titular || '');
  useEffect(() => {
    if (template && !mensaje) setMensaje(preset?.mensaje || template.defaultMessage || '');
  }, [template]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Math.max(1, Math.min(6, Number(nCampanas) || 1));
  const lotes = useMemo(() => repartir(elegidos, n), [elegidos, n]);
  const nombreCampana = (i) => (lotes.length > 1 ? `${nombreBase.trim()} · C${i + 1}` : nombreBase.trim());

  // ── Publicación (en serie, campaña por campaña) ──
  const [fase, setFase] = useState(null); // null | 'publicando' | 'listo' | 'error'
  const [logs, setLogs] = useState([]);
  const [resultados, setResultados] = useState([]); // [{nombre, campaignId, okAds, total, estado}]
  const log = (l) => setLogs(prev => [...prev, l]);

  const listo = account && template?.pageId && elegidos.length > 0 && Number(presupuesto) > 0 && nombreBase.trim()
    && (receta === 'cbo_deep' || Number(puja) > 0) && !fase;
  const loteMax = Math.max(0, ...lotes.map(l => l.length));

  const publicar = useCallback(async () => {
    if (!listo) return;
    if (loteMax > 30) {
      addToast?.({ type: 'warning', message: 'Máximo 30 creativos por campaña — repartí en más campañas o destildá algunos.' });
      return;
    }
    setFase('publicando'); setLogs([]); setResultados([]);
    const hechos = [];
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
          log(`  Subiendo ${vids.length} video${vids.length === 1 ? '' : 's'} a Meta…`);
          const up = await metaApi('upload-ad-videos', {
            connId: account.connId, method: 'POST',
            body: { account_id: account.id, videos: vids.map((f, i) => ({ name: f.name, index: i, driveId: f.driveId, storagePath: f.storagePath })) },
          });
          const subidos = (up.resultados || []).filter(r => r.ok);
          for (const r of (up.resultados || [])) if (!r.ok) log(`  ✗ ${r.name}: ${r.error}`);
          if (subidos.length > 0) {
            log('  Esperando que Meta procese los videos…');
            const ids = subidos.map(r => r.videoId);
            let estados = []; let erroresSeguidos = 0;
            for (let i = 0; i < 45; i++) {
              await esperar(4000);
              try {
                const st = await metaApi(`videos-status?ids=${ids.join(',')}`, { connId: account.connId });
                estados = st.videos || []; erroresSeguidos = 0;
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
            }
          }
        }

        // 2. Imágenes → adimages (hash).
        if (imgs.length > 0) {
          log(`  Subiendo ${imgs.length} imagen${imgs.length === 1 ? '' : 'es'} a Meta…`);
          const up = await metaApi('upload-ad-images', {
            connId: account.connId, method: 'POST',
            body: { account_id: account.id, imagenes: imgs.map((f, i) => ({ name: f.name, index: i, storagePath: f.storagePath, url: f.storagePath ? null : f.url })) },
          });
          for (const r of (up.resultados || [])) {
            if (!r.ok) { log(`  ✗ ${r.name}: ${r.error}`); continue; }
            const nombreAd = aplicarPatron(adPattern, { filename: r.name, index: adsListos.length, fecha: fechaCorta }) || r.name;
            adsListos.push({ name: nombreAd, imageHash: r.imageHash });
          }
        }

        if (adsListos.length === 0) throw new Error('Ningún creativo del lote quedó listo para publicar.');

        // 3. Estructura: campaña → conjuntos → ads.
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
            estructura: receta,
            puja: receta === 'cbo_deep' ? null : Number(puja),
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
      } catch (e) {
        huboError = true;
        log(`  ✗ Campaña ${c + 1}: ${e.message}`);
      }
    }

    setResultados(hechos);
    if (hechos.length > 0) {
      setFase(huboError ? 'error' : 'listo');
      const cardIds = [...new Set(hechos.flatMap(h => h.cardIds))];
      try { onPublicadas?.(cardIds); } catch {}
      addToast?.({
        type: huboError ? 'warning' : 'success',
        message: `${hechos.length}/${lotes.length} campaña${lotes.length === 1 ? '' : 's'} creada${hechos.length === 1 ? '' : 's'}${enPausa ? ' en pausa' : ''} 🚀`,
      });
    } else {
      setFase('error');
      addToast?.({ type: 'error', message: 'No se pudo crear ninguna campaña — mirá el detalle en el log.' });
    }
  }, [listo, lotes, loteMax, account, template, preset, producto, presupuesto, adsPorSet, enPausa, nombreBase, fechaCorta, receta, puja, mensaje, titular, addToast, onPublicadas]); // eslint-disable-line react-hooks/exhaustive-deps

  const input = 'w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  // Selección por grupo (tarjeta entera / todos los estáticos).
  const toggleTarjeta = (t) => {
    const keys = videosDe(t).map(f => `v:${t.id}:${f.ts}`);
    const todas = keys.every(k => sel.has(k));
    setSel(prev => { const nn = new Set(prev); for (const k of keys) { if (todas) nn.delete(k); else nn.add(k); } return nn; });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onVolver} disabled={fase === 'publicando'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-40">
          <ArrowLeft size={14} /> Volver
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2 truncate">
            <Rocket size={19} className="text-brand-600 shrink-0" /> Armar publicación — {producto}
          </h1>
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

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        {/* ── IZQUIERDA: creativos ── */}
        <div className="lg:col-span-2 space-y-5 min-w-0">
          {/* Videos por tarjeta */}
          <section>
            <h2 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-1.5 flex-wrap">
              <Film size={14} className="text-brand-500" /> Videos de Producción
              <span className="text-[11px] font-semibold text-gray-400">tildá video por video, de la tarjeta que quieras</span>
              <span className="ml-auto inline-flex gap-2 text-[11px] font-bold">
                <button onClick={() => setSel(prev => { const nn = new Set(prev); for (const t of tarjetas) for (const f of videosDe(t)) nn.add(`v:${t.id}:${f.ts}`); return nn; })}
                  disabled={fase === 'publicando'} className="text-brand-600 dark:text-brand-400 hover:underline">Todos</button>
                <button onClick={() => setSel(prev => { const nn = new Set(prev); for (const k of prev) if (k.startsWith('v:')) nn.delete(k); return nn; })}
                  disabled={fase === 'publicando'} className="text-gray-400 hover:underline">Ninguno</button>
              </span>
            </h2>
            {tarjetas.length === 0 ? (
              <p className="text-sm text-gray-400">Este producto no tiene tarjetas con videos.</p>
            ) : (
              <div className="space-y-3">
                {tarjetas.map(t => {
                  const vids = videosDe(t);
                  if (vids.length === 0) return null;
                  const keys = vids.map(f => `v:${t.id}:${f.ts}`);
                  const nSel = keys.filter(k => sel.has(k)).length;
                  return (
                    <div key={t.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
                      <label className="flex items-center gap-2.5 px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/60 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                        <input type="checkbox" checked={nSel === keys.length} ref={el => { if (el) el.indeterminate = nSel > 0 && nSel < keys.length; }}
                          onChange={() => toggleTarjeta(t)} disabled={fase === 'publicando'} className="w-4 h-4 accent-brand-600" />
                        <span className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">
                          {t.persona || 'Sin editor'} · {weekLabel(t.weekKey) || t.weekKey || ''}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${t.estado === 'aprobado' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-violet-500/10 text-violet-600 dark:text-violet-400'}`}>
                          {t.estado === 'aprobado' ? 'APROBADA' : 'PUBLICADA'}
                        </span>
                        <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{nSel}/{vids.length}</span>
                      </label>
                      <div className="grid sm:grid-cols-2 gap-x-2">
                        {vids.map(f => {
                          const k = `v:${t.id}:${f.ts}`;
                          return (
                            <label key={k} className="flex items-center gap-2 px-3.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer min-w-0">
                              <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} disabled={fase === 'publicando'} className="accent-brand-500" />
                              <Film size={12} className="text-gray-400 shrink-0" />
                              <span className="flex-1 min-w-0 truncate text-xs text-gray-700 dark:text-gray-200" title={f.name}>{f.name}</span>
                              {f.aprobado && <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">✓</span>}
                            </label>
                          );
                        })}
                      </div>
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
                <span className="ml-auto inline-flex gap-2 text-[11px] font-bold">
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
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
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
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Log de publicación */}
          {logs.length > 0 && (
            <pre className="text-[11px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 whitespace-pre-wrap max-h-72 overflow-y-auto font-mono">{logs.join('\n')}</pre>
          )}
          {resultados.length > 0 && (
            <div className="space-y-1.5">
              {resultados.map(r => (
                <a key={r.campaignId} href={linkMeta({ accountId: account?.id, nivel: 'campaigns', ids: [r.campaignId] })} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm font-semibold text-brand-600 dark:text-brand-300 hover:underline">
                  <Check size={14} className="text-emerald-500" /> {r.nombre} — {r.okAds}/{r.total} ads ({r.estado === 'ACTIVE' ? 'activa' : 'en pausa'}) <ExternalLink size={12} />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* ── DERECHA: armado (sticky) ── */}
        <div className="lg:sticky lg:top-4 space-y-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Selección</p>
            <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
              {elegidos.length} <span className="text-sm font-bold text-gray-400">creativo{elegidos.length === 1 ? '' : 's'}</span>
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{nVideos} video{nVideos === 1 ? '' : 's'} · {nImagenes} imagen{nImagenes === 1 ? '' : 'es'}</p>
          </div>

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
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5"
              title="Define dónde vive el presupuesto (CBO = en la campaña, ABO = en cada conjunto) y la estrategia de puja.">Receta</span>
            <div className="grid grid-cols-2 gap-1.5">
              {RECETAS.map(r => (
                <button key={r.id} onClick={() => cambiarReceta(r.id)} disabled={fase === 'publicando'} title={r.desc}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border text-left transition ${receta === r.id
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-brand-400'}`}>
                  {r.label}
                </button>
              ))}
            </div>
            {receta !== 'cbo_deep' && (
              <div className="mt-2">
                <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1"
                  title={receta === 'abo_bidcap' ? 'Meta nunca puja por encima de este valor en la subasta.' : 'Meta intenta comprar cada venta a este costo o mejor.'}>
                  {receta === 'abo_bidcap' ? 'Tope de puja' : 'Costo por compra objetivo'}{account?.currency ? ` · ${account.currency}` : ''}
                </span>
                <input type="number" min="1" value={puja} onChange={e => setPuja(e.target.value)} className={input} disabled={fase === 'publicando'} placeholder="ej: 9000" />
              </div>
            )}
          </div>

          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Nombre base de campaña</span>
            <input value={nombreBase} onChange={e => setNombreBase(e.target.value)} className={input} disabled={fase === 'publicando'} />
            {lotes.length > 1 && <p className="text-[10px] text-gray-400 mt-1">Se numeran solas: «{nombreCampana(0)}», «{nombreCampana(1)}»…</p>}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5"
                title={esCbo ? 'Presupuesto diario de CADA campaña (CBO: Meta lo reparte entre los conjuntos)' : 'Presupuesto diario de CADA CONJUNTO (ABO: cada conjunto gasta esto)'}>
                {esCbo ? 'Presupuesto c/u' : 'Presupuesto por conjunto'}{account?.currency ? ` · ${account.currency}` : ''}</span>
              <input type="number" min="1" value={presupuesto} onChange={e => setPresupuesto(e.target.value)} className={input} disabled={fase === 'publicando'} placeholder="ej: 60000" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5"
                title="Cuántos anuncios entran en cada conjunto de la campaña">Ads por conjunto</span>
              <input type="number" min="1" max="10" value={adsPorSet} onChange={e => setAdsPorSet(e.target.value === '' ? '' : Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))))} className={input} disabled={fase === 'publicando'} />
            </div>
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

          {fase === 'listo' || fase === 'error' ? (
            <button onClick={onVolver} className="w-full py-2.5 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">Volver a la cola</button>
          ) : (
            <button onClick={publicar} disabled={!listo}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-50">
              {fase === 'publicando'
                ? <><Loader2 size={14} className="animate-spin" /> Publicando…</>
                : <><Rocket size={14} /> Publicar {lotes.length} campaña{lotes.length === 1 ? '' : 's'} · {elegidos.length} creativo{elegidos.length === 1 ? '' : 's'} <ChevronRight size={13} /></>}
            </button>
          )}
        </div>
      </div>

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
