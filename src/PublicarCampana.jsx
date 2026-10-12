// 🚀 Publicar campaña — el lanzador de AdsLab (pestaña de Métricas).
//
// Armás acá lo que antes armabas a mano en el Ads Manager: elegís una de las
// tres recetas del equipo (CBO Deep Pocket / CBO Cost Cap / ABO Bid Cap),
// presupuesto y puja, la config básica (página, píxel, país, edades) y pegás
// los anuncios como "Nombre | post id" (uno por línea). AdsLab crea campaña +
// conjuntos + creativos + ads en Meta, PAUSADO por default para que revises.
//
// Post id: puede venir "pageId_postId" (como lo da Meta) o el id pelado — en
// ese caso se compone con la página elegida.

import React, { useState, useEffect, useMemo } from 'react';
import {
  Rocket, Loader2, AlertCircle, CheckCircle2, XCircle, ExternalLink,
} from 'lucide-react';
import { authHeaders } from './MetaConnect.jsx';
import { confirmDialog } from './dialogs.jsx';

const ESTRUCTURAS = [
  {
    id: 'cbo_deep', titulo: 'CBO · Deep Pocket', emoji: '💰',
    desc: 'Presupuesto en la campaña, sin tope de puja. Meta reparte libre entre conjuntos. La receta de testeo de siempre.',
    puja: null,
  },
  {
    id: 'cbo_costcap', titulo: 'CBO · Cost Cap', emoji: '🎯',
    desc: 'Presupuesto en la campaña + costo por compra OBJETIVO: Meta intenta comprar a ese CPA o mejor.',
    puja: 'Costo por compra objetivo',
  },
  {
    id: 'abo_bidcap', titulo: 'ABO · Bid Cap', emoji: '🧢',
    desc: 'Presupuesto POR CONJUNTO + tope de puja duro: Meta nunca puja por encima. Control total, escala más lenta.',
    puja: 'Tope de puja',
  },
];

const num = (s) => Number(String(s).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));

// "Aceite 12-10 C1 | 1234567890" → { name, postId }. También acepta coma,
// o el post id solo (el nombre sale del id).
function parseAds(texto) {
  const out = [];
  for (const lineaRaw of String(texto || '').split('\n')) {
    const linea = lineaRaw.trim();
    if (!linea) continue;
    let name = '', postId = '';
    if (linea.includes('|')) {
      const i = linea.lastIndexOf('|');
      name = linea.slice(0, i).trim();
      postId = linea.slice(i + 1).trim();
    } else {
      const m = /^(.*?)[\s,;]+([0-9_]{8,})$/.exec(linea);
      if (m) { name = m[1].trim(); postId = m[2]; }
      else if (/^[0-9_]{8,}$/.test(linea)) postId = linea;
      else { out.push({ name: linea, postId: '', invalida: true }); continue; }
    }
    postId = postId.replace(/[^\d_]/g, '');
    out.push({ name, postId, invalida: !/^[0-9_]{8,}$/.test(postId) });
  }
  return out;
}

const inputCls = 'w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1877F2] text-gray-900 dark:text-gray-100';
const Campo = ({ label, children, hint }) => (
  <label className="grid gap-1 min-w-0">
    <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-gray-400">{label}</span>
    {children}
    {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
  </label>
);

export default function PublicarCampana({ accountId, connId, currency, addToast, productosVisibles = [] }) {
  const [estructura, setEstructura] = useState('cbo_deep');
  const [nombre, setNombre] = useState('');
  const [presupuesto, setPresupuesto] = useState('');
  const [puja, setPuja] = useState('');
  const [conjuntos, setConjuntos] = useState(1);
  const [pais, setPais] = useState('AR');
  const [edadMin, setEdadMin] = useState(18);
  const [edadMax, setEdadMax] = useState(65);
  const [pageId, setPageId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [adsText, setAdsText] = useState('');
  const [activar, setActivar] = useState(false);
  const [prereqs, setPrereqs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState(null);

  const receta = ESTRUCTURAS.find(e => e.id === estructura);
  const ads = useMemo(() => parseAds(adsText), [adsText]);
  const adsOk = ads.filter(a => !a.invalida);

  // Nombre sugerido con la nomenclatura del equipo: "Producto d/m [receta]".
  useEffect(() => {
    if (nombre) return;
    const hoy = new Date();
    const prod = productosVisibles[0]?.nombre?.split(' ')[0] || 'Producto';
    const tag = estructura === 'cbo_deep' ? '[CBO Deep Poket]' : estructura === 'cbo_costcap' ? '[CBO Costcap]' : '[ABO Bidcap]';
    setNombre(`${prod} ${hoy.getDate()}/${hoy.getMonth() + 1} ${tag}`);
  }, [productosVisibles, estructura]); // eslint-disable-line

  // Páginas + píxeles de la cuenta (para promoted_object y los post ids pelados).
  useEffect(() => {
    if (!accountId) return;
    let muerto = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ account_id: accountId });
        if (connId && connId !== '__cookie__') qs.set('connection_id', connId);
        const r = await fetch(`/api/meta/launch-prereqs?${qs}`, { headers: await authHeaders(false) });
        const d = await r.json().catch(() => ({}));
        if (muerto) return;
        setPrereqs(d);
        if (!pixelId && d.pixels?.[0]) setPixelId(d.pixels[0].id);
        if (!pageId && d.pages?.[0]) setPageId(d.pages[0].id);
      } catch { if (!muerto) setPrereqs({ pixels: [], pages: [] }); }
    })();
    return () => { muerto = true; };
  }, [accountId, connId]); // eslint-disable-line

  const listo = accountId && nombre.trim() && num(presupuesto) > 0 && adsOk.length > 0 && pixelId
    && (receta.puja == null || num(puja) > 0);

  const publicar = async () => {
    if (!listo || busy) return;
    const presupuestoTxt = `$${num(presupuesto).toLocaleString('es-AR')}${estructura === 'abo_bidcap' ? ' por conjunto' : ''} / día`;
    const ok = await confirmDialog({
      title: `🚀 Crear "${nombre}" en Meta`,
      message: [
        `${receta.emoji} ${receta.titulo} · ${conjuntos} conjunto${conjuntos === 1 ? '' : 's'} · ${adsOk.length} anuncio${adsOk.length === 1 ? '' : 's'}`,
        `Presupuesto: ${presupuestoTxt}${receta.puja ? ` · ${receta.puja.toLowerCase()}: $${num(puja).toLocaleString('es-AR')}` : ''}`,
        `${pais} · ${edadMin}-${edadMax} años · Advantage+ audience y ubicaciones automáticas`,
        activar ? '⚠️ Se crea ACTIVA: empieza a gastar al toque.' : 'Se crea PAUSADA: la revisás en Meta y la encendés.',
      ].join('\n'),
      confirmLabel: 'Crear en Meta',
      tone: activar ? 'danger' : 'brand',
    });
    if (!ok) return;
    setBusy(true); setResultado(null);
    try {
      const r = await fetch('/api/meta/launch-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders(false)) },
        body: JSON.stringify({
          account_id: accountId,
          connection_id: connId && connId !== '__cookie__' ? connId : undefined,
          estructura, nombre: nombre.trim(),
          presupuesto: num(presupuesto), puja: receta.puja ? num(puja) : 0,
          conjuntos, pageId, pixelId, pais, edadMin, edadMax,
          ads: adsOk.map(a => ({ name: a.name, postId: a.postId })),
          activar,
        }),
      });
      const d = await r.json().catch(() => ({}));
      setResultado(d);
      if (d.campaignId && d.ok) addToast?.({ type: 'success', message: `🚀 "${nombre}" creada en Meta (${d.creados} ads, ${d.estado === 'ACTIVE' ? 'ACTIVA' : 'pausada'})` });
      else if (d.campaignId) addToast?.({ type: 'warning', message: 'Campaña creada con detalles — mirá el resumen.' });
      else addToast?.({ type: 'error', message: `No se creó: ${d.error || 'error desconocido'}` });
    } catch (e) {
      setResultado({ error: e.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* receta */}
      <div className="grid sm:grid-cols-3 gap-2.5">
        {ESTRUCTURAS.map(e => (
          <button key={e.id} onClick={() => setEstructura(e.id)}
            className={`text-left rounded-xl border p-3 transition ${
              estructura === e.id
                ? 'border-[#1877F2] bg-[#1877F2]/5 dark:bg-[#1877F2]/10 ring-1 ring-[#1877F2]'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}`}>
            <p className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{e.emoji} {e.titulo}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">{e.desc}</p>
          </button>
        ))}
      </div>

      {/* config */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5 grid gap-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo label="Nombre de la campaña" hint="Con la fecha y la receta en el nombre, Testeos por semana la agarra sola.">
            <input className={inputCls} value={nombre} onChange={e => setNombre(e.target.value)} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label={estructura === 'abo_bidcap' ? `Presupuesto diario POR CONJUNTO (${currency || 'ARS'})` : `Presupuesto diario (${currency || 'ARS'})`}>
              <input className={inputCls} value={presupuesto} onChange={e => setPresupuesto(e.target.value)} placeholder="150.000" inputMode="decimal" />
            </Campo>
            {receta.puja ? (
              <Campo label={`${receta.puja} (${currency || 'ARS'})`}>
                <input className={inputCls} value={puja} onChange={e => setPuja(e.target.value)} placeholder="28.000" inputMode="decimal" />
              </Campo>
            ) : (
              <Campo label="Puja"><span className="px-2.5 py-1.5 text-xs text-gray-400">Sin tope (deep pocket)</span></Campo>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Campo label="Conjuntos">
            <select className={inputCls} value={conjuntos} onChange={e => setConjuntos(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Campo>
          <Campo label="País">
            <input className={inputCls} value={pais} onChange={e => setPais(e.target.value.toUpperCase().slice(0, 2))} />
          </Campo>
          <Campo label="Edad mín.">
            <input className={inputCls} type="number" min={13} max={65} value={edadMin} onChange={e => setEdadMin(Number(e.target.value))} />
          </Campo>
          <Campo label="Edad máx.">
            <input className={inputCls} type="number" min={13} max={65} value={edadMax} onChange={e => setEdadMax(Number(e.target.value))} />
          </Campo>
          <Campo label="Píxel (evento Compra)">
            <select className={inputCls} value={pixelId} onChange={e => setPixelId(e.target.value)}>
              {!prereqs && <option>Cargando…</option>}
              {prereqs?.pixels?.length === 0 && <option value="">Sin píxeles en la cuenta</option>}
              {(prereqs?.pixels || []).map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
            </select>
          </Campo>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo label="Página (para post ids sin «_»)">
            <select className={inputCls} value={pageId} onChange={e => setPageId(e.target.value)}>
              {(prereqs?.pages || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              {prereqs?.pages?.length === 0 && <option value="">Sin páginas visibles</option>}
            </select>
          </Campo>
          <label className="flex items-end gap-2 pb-1 cursor-pointer">
            <input type="checkbox" checked={activar} onChange={e => setActivar(e.target.checked)} className="accent-[#1877F2]" />
            <span className="text-xs text-gray-700 dark:text-gray-200">
              Crear <b>ACTIVA</b> <span className="text-gray-400">(si no, queda pausada para revisar — recomendado)</span>
            </span>
          </label>
        </div>
      </div>

      {/* anuncios */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5">
        <p className="text-[9.5px] font-bold uppercase tracking-[.08em] text-gray-400 mb-1.5">
          Anuncios — uno por línea: «Nombre | post id» (acepta pageId_postId o el id pelado)
        </p>
        <textarea rows={6} className={`${inputCls} font-mono`} value={adsText} onChange={e => setAdsText(e.target.value)}
          placeholder={'Aceite 12-10 C1 Mecanismo | 122098765432101234\nAceite 12-10 C2 Testimonio | 17895695668004550\n122111222333444555'} />
        {ads.length > 0 && (
          <p className="text-[11px] mt-1.5 text-gray-500 dark:text-gray-400">
            {adsOk.length} válido{adsOk.length === 1 ? '' : 's'}
            {ads.length !== adsOk.length && <span className="text-red-500"> · {ads.length - adsOk.length} línea{ads.length - adsOk.length === 1 ? '' : 's'} sin post id válido</span>}
            {conjuntos > 1 && adsOk.length > 0 && <span> · se reparten {Math.ceil(adsOk.length / conjuntos)}≈ por conjunto</span>}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={publicar} disabled={!listo || busy}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-[#1877F2] hover:bg-[#0a5ae0] rounded-xl transition disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
          {busy ? 'Creando en Meta…' : 'Crear en Meta'}
        </button>
        {!listo && <span className="text-[11px] text-gray-400">Completá nombre, presupuesto{receta.puja ? ', puja' : ''}, píxel y al menos un anuncio.</span>}
      </div>

      {/* resultado */}
      {resultado && (
        <div className={`rounded-xl border p-3.5 ${resultado.campaignId
          ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15'
          : 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/15'}`}>
          {resultado.campaignId ? (
            <>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-600" /> Campaña creada ({resultado.estado === 'ACTIVE' ? 'ACTIVA' : 'pausada'})
                <a className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1877F2] hover:underline"
                  href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${String(accountId).replace('act_', '')}&selected_campaign_ids=${resultado.campaignId}`}
                  target="_blank" rel="noreferrer">abrir en Meta <ExternalLink size={10} /></a>
              </p>
              <div className="mt-2 space-y-1.5">
                {(resultado.adsets || []).map(s => (
                  <div key={s.id} className="text-[11.5px]">
                    <p className="font-semibold text-gray-800 dark:text-gray-200">▦ {s.name}</p>
                    {s.ads.map((ad, i) => (
                      <p key={i} className="pl-4 flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                        {ad.ok ? <CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> : <XCircle size={11} className="text-red-500 shrink-0" />}
                        {ad.name}{!ad.ok && <span className="text-red-500"> — {ad.error}</span>}
                      </p>
                    ))}
                  </div>
                ))}
                {(resultado.errores || []).map((e, i) => (
                  <p key={i} className="text-[11.5px] text-red-600 dark:text-red-400 flex items-center gap-1.5"><AlertCircle size={11} /> {e}</p>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle size={15} /> No se creó: {resultado.error}
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-gray-400 leading-relaxed max-w-[80ch]">
        Config fija de la receta: objetivo <b>Ventas</b>, optimización <b>compras del píxel</b>, Advantage+
        audience, ubicaciones automáticas. Los creativos salen de publicaciones existentes
        (object_story_id), así conservan los likes y comentarios del post.
      </p>
    </div>
  );
}
