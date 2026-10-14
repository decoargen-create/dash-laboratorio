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

// Cada receta trae los números con los que el equipo la arma siempre. Son
// defaults, no candados: se pisan escribiendo encima. El presupuesto va por
// moneda porque 120.000 en pesos y 120 en dólares son la misma plata en la
// cabeza de quien lanza, pero números muy distintos.
const ESTRUCTURAS = [
  {
    id: 'cbo_deep', titulo: 'CBO · Deep Pocket', emoji: '💰',
    desc: 'La más simple: ponés un presupuesto para toda la campaña y Meta decide dónde gastarlo. La receta de testeo de siempre. Recomendada si estás empezando.',
    puja: null,
    conjuntos: 8,
    presupuesto: { ARS: 120000, USD: 120 },
  },
  {
    id: 'cbo_costcap', titulo: 'CBO · Cost Cap', emoji: '🎯',
    desc: 'Le decís a Meta cuánto querés pagar como máximo por cada venta y compra a ese precio o mejor. Gasta más lento, pero más barato.',
    puja: 'Costo por compra objetivo',
    conjuntos: 1,
    presupuesto: { ARS: 60000, USD: 60 },
    // La puja arranca con el CPA real de la cuenta — ver cpaSugerido.
    pujaDesdeCpa: true,
  },
  {
    id: 'abo_costcap', titulo: 'ABO · Cost Cap', emoji: '🎯',
    desc: 'Presupuesto POR CONJUNTO + costo por compra objetivo: control fino conjunto a conjunto, comprando a tu precio o mejor.',
    puja: 'Costo por compra objetivo',
    conjuntos: 1,
    pujaDesdeCpa: true,
  },
  {
    id: 'abo_bidcap', titulo: 'ABO · Bid Cap', emoji: '🧢',
    desc: 'Para expertos: tope duro por subasta y presupuesto separado por conjunto. Control total, crece más lento.',
    puja: 'Tope de puja',
    conjuntos: 1,
  },
];

// El default de presupuesto solo se ofrece en las monedas que el equipo usa.
// Para cualquier otra se deja vacío: inventar un número en una moneda que no
// conocemos es peor que pedirlo.
const presupuestoDefault = (receta, currency) =>
  receta?.presupuesto?.[String(currency || 'ARS').toUpperCase()] ?? null;

// Mismo tope que el server (ver MAX_ADS_CREADOS en api/meta/[action].js): se
// avisa acá para no mandar una tirada que el backend va a rebotar igual.
const MAX_ADS_CREADOS = 120;

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
  const [conjuntos, setConjuntos] = useState(8);
  // Deep Pocket = conjuntos IDÉNTICOS: cada uno lleva todos los anuncios.
  const [duplicarAds, setDuplicarAds] = useState(true);
  const [cpaCuenta, setCpaCuenta] = useState(null);
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
    const tag = estructura === 'cbo_deep' ? '[CBO Deep Poket]'
      : estructura === 'cbo_costcap' ? '[CBO Costcap]'
      : estructura === 'abo_costcap' ? '[ABO Costcap]' : '[ABO Bidcap]';
    setNombre(`${prod} ${hoy.getDate()}/${hoy.getMonth() + 1} ${tag}`);
  }, [productosVisibles, estructura]); // eslint-disable-line

  // Cambiar de receta trae SUS números: es lo que hace que sea una receta y no
  // un formulario vacío. Pisa lo que haya escrito a propósito — elegir otra
  // receta es justamente pedir otra configuración.
  useEffect(() => {
    if (!receta) return;
    setConjuntos(receta.conjuntos ?? 1);
    const def = presupuestoDefault(receta, currency);
    setPresupuesto(def != null ? String(def) : '');
    setPuja(receta.pujaDesdeCpa && cpaCuenta ? String(Math.round(cpaCuenta)) : '');
  }, [estructura, currency]); // eslint-disable-line

  // CPA real de la cuenta (últimos 30 días) para proponerlo como costo
  // objetivo del Cost Cap. Es un punto de partida con base, no una adivinanza:
  // pedir "a cuánto querés comprar" sin decir a cuánto estás comprando hoy es
  // pedirle al usuario que haga la cuenta que la plataforma ya tiene hecha.
  useEffect(() => {
    if (!accountId) return;
    let muerto = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ account_id: accountId, date_preset: 'last_30d' });
        if (connId && connId !== '__cookie__') qs.set('connection_id', connId);
        const r = await fetch(`/api/meta/funnel-insights?${qs}`, { headers: await authHeaders(false) });
        const d = await r.json().catch(() => ({}));
        const cpa = Number(d?.totals?.cpa);
        if (!muerto && Number.isFinite(cpa) && cpa > 0) setCpaCuenta(cpa);
      } catch { /* sin CPA se pide a mano, no es un error */ }
    })();
    return () => { muerto = true; };
  }, [accountId, connId]);

  // Cuando el CPA llega tarde, completa la puja si todavía está vacía.
  useEffect(() => {
    if (receta?.pujaDesdeCpa && cpaCuenta && !puja) setPuja(String(Math.round(cpaCuenta)));
  }, [cpaCuenta, estructura]); // eslint-disable-line

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

  // Lo que REALMENTE se va a crear en Meta. Con conjuntos duplicados, 5 post
  // ids en 8 conjuntos no son 5 anuncios: son 40.
  const totalAds = duplicarAds ? adsOk.length * conjuntos : adsOk.length;
  const pasado = totalAds > MAX_ADS_CREADOS;

  const listo = accountId && nombre.trim() && num(presupuesto) > 0 && adsOk.length > 0 && pixelId
    && !pasado && (receta.puja == null || num(puja) > 0);

  const publicar = async () => {
    if (!listo || busy) return;
    const presupuestoTxt = `$${num(presupuesto).toLocaleString('es-AR')}${estructura.startsWith('abo') ? ' por conjunto' : ''} / día`;
    const ok = await confirmDialog({
      title: `🚀 Crear "${nombre}" en Meta`,
      message: [
        `${receta.emoji} ${receta.titulo} · ${conjuntos} conjunto${conjuntos === 1 ? '' : 's'}`,
        duplicarAds && conjuntos > 1
          ? `${adsOk.length} anuncio${adsOk.length === 1 ? '' : 's'} en CADA conjunto → ${totalAds} anuncios en total`
          : `${adsOk.length} anuncio${adsOk.length === 1 ? '' : 's'} repartido${adsOk.length === 1 ? '' : 's'} entre los conjuntos`,
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
          conjuntos, duplicarAds, pageId, pixelId, pais, edadMin, edadMax,
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
            <Campo label={estructura.startsWith('abo') ? `Presupuesto diario POR CONJUNTO (${currency || 'ARS'})` : `Presupuesto diario (${currency || 'ARS'})`}>
              <input className={inputCls} value={presupuesto} onChange={e => setPresupuesto(e.target.value)} placeholder="150.000" inputMode="decimal" />
            </Campo>
            {receta.puja ? (
              <Campo label={`${receta.puja} (${currency || 'ARS'})`}
                hint={receta.pujaDesdeCpa
                  ? (cpaCuenta
                      ? `Tu CPA real de los últimos 30 días: ${Math.round(cpaCuenta).toLocaleString('es-AR')}`
                      : 'Va a nivel conjunto. Sin compras en 30 días no puedo sugerirte un CPA.')
                  : undefined}>
                <input className={inputCls} value={puja} onChange={e => setPuja(e.target.value)} placeholder="28.000" inputMode="decimal" />
              </Campo>
            ) : (
              <Campo label="Puja"><span className="px-2.5 py-1.5 text-xs text-gray-400">Sin tope (deep pocket)</span></Campo>
            )}
          </div>
        </div>
        {pasado && (
          <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">
            Son {totalAds} anuncios ({adsOk.length} × {conjuntos} conjuntos) y el máximo por tirada es {MAX_ADS_CREADOS}.
            Bajá los conjuntos o los anuncios.
          </p>
        )}
        {conjuntos > 1 && (
          <label className="flex items-start gap-2 text-[11px] text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-[#1877F2]" checked={duplicarAds}
              onChange={e => setDuplicarAds(e.target.checked)} />
            <span>
              <b>Los mismos anuncios en cada conjunto</b> — {conjuntos} conjuntos idénticos compitiendo
              ({adsOk.length || 'N'} × {conjuntos} = <b>{(adsOk.length || 0) * conjuntos || 'N'}</b> anuncios).
              {' '}Destildado, los anuncios se <b>reparten</b> entre los conjuntos.
            </span>
          </label>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Campo label="Conjuntos">
            <select className={inputCls} value={conjuntos} onChange={e => setConjuntos(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20].map(n => <option key={n} value={n}>{n}</option>)}
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
          Anuncios — uno por línea: «Nombre | número de publicación»
        </p>
        <p className="text-[10.5px] text-gray-400 mb-1.5">
          El número de publicación es el ID del posteo de Facebook/Instagram que querés usar como anuncio.
          Lo encontrás en Meta Business Suite → la publicación → ⋯ → Copiar ID. Acepta «pageId_postId» o el número solo.
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
