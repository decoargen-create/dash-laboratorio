// "Ads Uploader" propio — publica los videos de una tarjeta de Producción
// como una campaña nueva en Meta, clonando la configuración (targeting,
// pixel, página, CTA) de un ad existente que el usuario elige como template.
//
// Flujo (orquestado acá, server en api/meta/[action].js):
//   1. Elegir cuenta + videos de la tarjeta (default: los aprobados).
//   2. Elegir el ad template: Campaña → Conjunto → Ad (igual que adsuploader).
//   3. Config: nombre (convención de testeo con fecha → entra solo a las
//      cohortes), presupuesto diario CBO, ads por conjunto, copy.
//   4. Publicar: sube videos (advideos por URL) → espera el procesamiento →
//      crea campaña + conjuntos + creatives + ads. ACTIVA directo.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Rocket, X, Loader2, Check, AlertTriangle, ChevronRight, ExternalLink, Film,
} from 'lucide-react';
import { useMetaConnections, useMetaAdAccounts, authHeaders } from './MetaConnect.jsx';
import { linkMeta } from './testeosCore.js';

const LS_ACCOUNT = 'adslab-testeos-account';

async function metaApi(path, { connId, method = 'GET', body } = {}) {
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

export default function PublicarCampanaModal({ a, onClose, addToast }) {
  const { connections } = useMetaConnections();
  const { accounts } = useMetaAdAccounts(connections);
  const [accountId, setAccountId] = useState(() => { try { return localStorage.getItem(LS_ACCOUNT) || ''; } catch { return ''; } });
  const account = useMemo(() => accounts.find(x => x.id === accountId) || accounts[0] || null, [accounts, accountId]);

  // ── Videos de la tarjeta ──
  const candidatos = useMemo(() => (a.archivos || []).filter(f => f && (f.driveId || f.storagePath)), [a]);
  const [sel, setSel] = useState(() => {
    const aprobados = (a.archivos || []).filter(f => f?.aprobado && (f.driveId || f.storagePath));
    const base = aprobados.length > 0 ? aprobados : (a.archivos || []).filter(f => f && (f.driveId || f.storagePath));
    return new Set(base.map(f => f.ts));
  });
  const toggleSel = (ts) => setSel(prev => { const n = new Set(prev); if (n.has(ts)) n.delete(ts); else n.add(ts); return n; });
  const elegidos = candidatos.filter(f => sel.has(f.ts));

  // ── Template: campaña → conjunto → ad ──
  const [campanas, setCampanas] = useState([]);
  const [adsets, setAdsets] = useState([]);
  const [campSel, setCampSel] = useState('');
  const [adsetSel, setAdsetSel] = useState('');
  const [adSel, setAdSel] = useState('');
  const [buscaCamp, setBuscaCamp] = useState('');
  const [template, setTemplate] = useState(null);
  const [cargandoTpl, setCargandoTpl] = useState(false);

  useEffect(() => {
    if (!account) return;
    let vivo = true;
    (async () => {
      try {
        const d = await metaApi(`campaigns?account_id=${encodeURIComponent(account.id)}`, { connId: account.connId });
        if (vivo) setCampanas(d.campaigns || []);
      } catch (e) { addToast?.({ type: 'error', message: `Campañas: ${e.message}` }); }
    })();
    return () => { vivo = false; };
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAdsets([]); setAdsetSel(''); setAdSel(''); setTemplate(null);
    if (!campSel || !account) return;
    let vivo = true;
    (async () => {
      try {
        const d = await metaApi(`campaign-adsets?campaign_id=${encodeURIComponent(campSel)}&with_ads=1`, { connId: account.connId });
        if (vivo) setAdsets(d.adsets || []);
      } catch (e) { addToast?.({ type: 'error', message: `Conjuntos: ${e.message}` }); }
    })();
    return () => { vivo = false; };
  }, [campSel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTemplate(null);
    if (!adSel || !account) return;
    let vivo = true;
    setCargandoTpl(true);
    (async () => {
      try {
        const d = await metaApi(`template-config?ad_id=${encodeURIComponent(adSel)}`, { connId: account.connId });
        if (vivo) {
          setTemplate(d);
          if (d.defaultMessage && !mensaje) setMensaje(d.defaultMessage);
        }
      } catch (e) { addToast?.({ type: 'error', message: `Template: ${e.message}` }); }
      finally { if (vivo) setCargandoTpl(false); }
    })();
    return () => { vivo = false; };
  }, [adSel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Config de la campaña nueva ──
  const hoy = new Date();
  const fechaCorta = `${hoy.getDate()}/${hoy.getMonth() + 1}`;
  const [nombre, setNombre] = useState(`${a.productoNombre || 'Producto'} ${fechaCorta} [CBO Testeo Videos]`);
  const [presupuesto, setPresupuesto] = useState('');
  const [adsPorSet, setAdsPorSet] = useState(3);
  const [mensaje, setMensaje] = useState('');
  const [titular, setTitular] = useState('');

  // ── Publicación ──
  const [fase, setFase] = useState(null); // null | 'subiendo' | 'procesando' | 'creando' | 'listo' | 'error'
  const [logs, setLogs] = useState([]);
  const [resultado, setResultado] = useState(null);
  const log = (l) => setLogs(prev => [...prev, l]);

  const listo = account && elegidos.length > 0 && template?.pageId && nombre.trim() && Number(presupuesto) > 0 && !fase;

  const publicar = useCallback(async () => {
    if (!listo) return;
    setFase('subiendo'); setLogs([]); setResultado(null);
    try {
      // 1. Subir videos a Meta (por URL — el server resuelve Drive/storage).
      log(`Subiendo ${elegidos.length} video${elegidos.length === 1 ? '' : 's'} a Meta…`);
      const up = await metaApi('upload-ad-videos', {
        connId: account.connId, method: 'POST',
        body: {
          account_id: account.id,
          videos: elegidos.map(f => ({ name: f.name, driveId: f.driveId || null, storagePath: f.storagePath || null })),
        },
      });
      const subidos = (up.resultados || []).filter(r => r.ok);
      for (const r of (up.resultados || [])) log(r.ok ? `  ✓ ${r.name}` : `  ✗ ${r.name}: ${r.error}`);
      if (subidos.length === 0) throw new Error('Ningún video se pudo subir a Meta.');

      // 2. Esperar el procesamiento (y el thumbnail que necesita el creative).
      setFase('procesando');
      log('Esperando que Meta procese los videos…');
      const ids = subidos.map(r => r.videoId);
      let estados = [];
      for (let i = 0; i < 45; i++) {
        await esperar(4000);
        const st = await metaApi(`videos-status?ids=${ids.join(',')}`, { connId: account.connId });
        estados = st.videos || [];
        const listos = estados.filter(v => v.ready).length;
        if (i % 3 === 0) log(`  ${listos}/${ids.length} listos…`);
        if (st.todosListos) break;
        if (estados.every(v => v.ready || v.status === 'error')) break;
      }
      const porId = new Map(estados.map(v => [v.id, v]));
      const adsListos = subidos
        .filter(r => porId.get(r.videoId)?.ready)
        .map(r => ({ name: r.name, videoId: r.videoId, picture: porId.get(r.videoId)?.picture || null }));
      if (adsListos.length === 0) throw new Error('Meta no terminó de procesar ningún video — probá de nuevo en unos minutos (ya quedaron subidos).');

      // 3. Crear campaña + conjuntos + creatives + ads.
      setFase('creando');
      log(`Creando campaña "${nombre.trim()}" con ${adsListos.length} ads…`);
      const cr = await metaApi('create-campaign-structure', {
        connId: account.connId, method: 'POST',
        body: {
          account_id: account.id,
          campaignName: nombre.trim(),
          dailyBudget: Number(presupuesto),
          adsPerSet: Number(adsPorSet) || 3,
          status: 'ACTIVE',
          template,
          message: mensaje,
          headline: titular,
          ads: adsListos,
        },
      });
      for (const l of (cr.log || [])) log(l);
      if (cr.error) throw new Error(cr.error);
      setResultado(cr);
      setFase('listo');
      const okAds = (cr.resultados || []).filter(r => r.ok).length;
      addToast?.({ type: 'success', message: `Campaña publicada ACTIVA: ${okAds} ad${okAds === 1 ? '' : 's'} 🚀` });
    } catch (e) {
      log(`✗ ${e.message}`);
      setFase('error');
      addToast?.({ type: 'error', message: `Publicación: ${e.message}` });
    }
  }, [listo, elegidos, account, nombre, presupuesto, adsPorSet, mensaje, titular, template]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !fase) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, fase]);

  const campFiltradas = campanas.filter(c => !buscaCamp.trim() || c.name.toLowerCase().includes(buscaCamp.toLowerCase()));
  const adsDelSet = adsets.find(s => s.id === adsetSel)?.ads || [];
  const nSets = Math.ceil(elegidos.length / (Number(adsPorSet) || 3));
  const input = 'w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={() => { if (!fase || fase === 'listo' || fase === 'error') onClose(); }}>
      <div className="w-full max-w-2xl my-6 flex flex-col max-h-[calc(100vh-5rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="shrink-0 flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <Rocket size={17} className="text-brand-500" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Publicar campaña en Meta</h3>
            <p className="text-[11px] text-gray-400 truncate">{a.productoNombre} · {elegidos.length} video{elegidos.length === 1 ? '' : 's'} seleccionado{elegidos.length === 1 ? '' : 's'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5 flex-1 min-h-0 overflow-y-auto">
          {/* Cuenta */}
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Cuenta publicitaria</span>
            <select value={account?.id || ''} onChange={e => setAccountId(e.target.value)} className={input} disabled={!!fase}>
              {accounts.map(ac => <option key={ac.id} value={ac.id}>{ac.name || ac.id}{ac.currency ? ` (${ac.currency})` : ''}</option>)}
            </select>
          </div>

          {/* Videos */}
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Videos de la tarjeta</span>
            {candidatos.length === 0 ? (
              <p className="text-sm text-gray-400">Esta tarjeta no tiene videos subidos.</p>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {candidatos.map(f => (
                  <label key={f.ts} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <input type="checkbox" checked={sel.has(f.ts)} onChange={() => toggleSel(f.ts)} disabled={!!fase}
                      className="accent-brand-500" />
                    <Film size={13} className="text-gray-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-xs text-gray-800 dark:text-gray-100" title={f.name}>{f.name}</span>
                    {f.aprobado && <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">APROBADO</span>}
                    <span className="text-[9px] text-gray-400 shrink-0">{f.driveId ? 'Drive' : 'AdsLab'}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Template */}
          <div>
            <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Copiar configuración de un ad existente</span>
            <p className="text-[11px] text-gray-400 mb-2">Se clonan targeting, optimización, pixel, página y CTA de este ad — elegí uno que esté funcionando bien.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <input value={buscaCamp} onChange={e => setBuscaCamp(e.target.value)} placeholder="Buscar campaña…" disabled={!!fase}
                  className={`${input} mb-1 text-xs`} />
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
                  <button key={s.id} onClick={() => { setAdsetSel(s.id); setAdSel(''); }} disabled={!!fase}
                    className={`w-full text-left px-2 py-1.5 text-[11px] truncate ${adsetSel === s.id ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-200 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                    title={s.name}>{s.name}</button>
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
            {cargandoTpl && <p className="text-[11px] text-gray-400 mt-1.5 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Leyendo configuración del ad…</p>}
            {template && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1.5 inline-flex items-center gap-1 flex-wrap">
                <Check size={12} /> Config lista: {template.campaign?.objective || 'objetivo'} · {template.adset?.optimizationGoal || 'optimización'} · página {template.pageId}{template.link ? ` · CTA ${template.ctaType} → ${template.link.slice(0, 40)}…` : ''}
              </p>
            )}
          </div>

          {/* Config campaña */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Nombre de la campaña</span>
              <input value={nombre} onChange={e => setNombre(e.target.value)} className={input} disabled={!!fase} />
              <p className="text-[10px] text-gray-400 mt-1">Con "CBO" + fecha entra sola a las cohortes de Testeos por semana.</p>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Presupuesto diario (CBO){account?.currency ? ` · ${account.currency}` : ''}</span>
              <input type="number" min="1" value={presupuesto} onChange={e => setPresupuesto(e.target.value)} className={input} disabled={!!fase} placeholder="ej: 60000" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Ads por conjunto</span>
              <input type="number" min="1" max="10" value={adsPorSet} onChange={e => setAdsPorSet(e.target.value)} className={input} disabled={!!fase} />
              <p className="text-[10px] text-gray-400 mt-1">{elegidos.length} videos → {nSets || 0} conjunto{nSets === 1 ? '' : 's'}</p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Texto principal del ad (común a todos)</span>
              <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={3} className={`${input} resize-y`} disabled={!!fase}
                placeholder="El copy que acompaña al video. Se precarga con el del ad template." />
            </div>
            <div className="sm:col-span-2">
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1.5">Titular (opcional)</span>
              <input value={titular} onChange={e => setTitular(e.target.value)} className={input} disabled={!!fase} />
            </div>
          </div>

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

        <div className="shrink-0 flex items-center gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <span className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1 flex-1 min-w-0">
            <AlertTriangle size={12} className="shrink-0" /> Se publica ACTIVA: arranca a gastar apenas Meta la apruebe.
          </span>
          {fase === 'listo' || fase === 'error' ? (
            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition">Cerrar</button>
          ) : (
            <button onClick={publicar} disabled={!listo}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-50">
              {fase ? <><Loader2 size={14} className="animate-spin" /> {fase === 'subiendo' ? 'Subiendo videos…' : fase === 'procesando' ? 'Procesando en Meta…' : 'Creando campaña…'}</>
                : <><Rocket size={14} /> Publicar {elegidos.length} ad{elegidos.length === 1 ? '' : 's'} <ChevronRight size={13} /></>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
