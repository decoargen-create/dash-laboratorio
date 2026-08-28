// Panel EQUIPO (admin) — crear/gestionar las cuentas de los creativos.
// Cada cuenta creada acá entra a la app con SU login y ve solo su tablero.
//
// Flujo pensado para un dueño no técnico: ponés nombre + email + una
// contraseña, se crea la cuenta, y se la pasás al chico. Después, en cada
// tarjeta, lo asignás desde "Asignar a (cuenta)".

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, UserPlus, Loader2, Trash2, KeyRound, Users, Mail, Copy, Check, Search, Wallet, Plus } from 'lucide-react';
import { listTeam, createMember, resetPassword, removeMember, setLider } from './produccionTeam.js';
import { personasEnTarjetas, assignCreator, allWeekKeys, listAssignments, getPagoConfig, setPagoConfig, DEFAULT_BONUS_TRAMOS } from './produccionStore.js';
import ConfirmDialog from './ConfirmDialog.jsx';

// Genera una contraseña simple pero decente para pasarle al chico.
function suggestPassword() {
  const words = ['creativo', 'video', 'lab', 'equipo', 'reel', 'clip'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w}${n}`;
}

// Editor de PAGO por persona: monto por producto (9 videos) + bono con tramos
// propios ("cada N completos → $X"), o sin bono. Se guarda por persona; si es
// una cuenta le pasamos su creatorId para que el editor pueda leer su config.
function PagoConfigEditor({ member, onClose, addToast }) {
  const persona = member.display_name || member.email;
  const inicial = getPagoConfig(persona);
  const [pago, setPago] = useState(inicial.pagoProducto);
  const [bonoOn, setBonoOn] = useState((inicial.bonusTramos || []).length > 0);
  const [tramos, setTramos] = useState(inicial.bonusTramos.length ? inicial.bonusTramos : DEFAULT_BONUS_TRAMOS.map(t => ({ ...t })));

  const setTramo = (i, campo, val) => setTramos(ts => ts.map((t, j) => j === i ? { ...t, [campo]: val === '' ? '' : Math.max(0, parseInt(val, 10) || 0) } : t));
  const addTramo = () => setTramos(ts => [...ts, { min: (ts[ts.length - 1]?.min || 2) + 1, monto: 0 }]);
  const delTramo = (i) => setTramos(ts => ts.filter((_, j) => j !== i));

  const save = () => {
    setPagoConfig(persona, {
      pagoProducto: parseInt(pago, 10) || 0,
      bonusTramos: bonoOn ? tramos.map(t => ({ min: parseInt(t.min, 10) || 1, monto: parseInt(t.monto, 10) || 0 })) : [],
      creatorId: member.id,
    });
    addToast?.({ type: 'success', message: `Pago de ${persona} guardado` });
    onClose();
  };

  return (
    <div className="mt-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-900/10 p-3 space-y-3">
      <div>
        <label className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 block mb-1">Pago por producto (9 videos)</label>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-gray-400">$</span>
          <input type="number" value={pago} onChange={e => setPago(e.target.value)} min="0" step="1000"
            className="flex-1 px-2.5 py-1.5 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <span className="text-[11px] text-gray-400">ARS c/producto aprobado</span>
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none mb-1.5">
          <input type="checkbox" checked={bonoOn} onChange={e => setBonoOn(e.target.checked)} className="accent-brand-600" />
          <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Bono por objetivo semanal</span>
        </label>
        {bonoOn ? (
          <div className="space-y-1.5">
            {tramos.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 text-sm">
                <span className="text-[11px] text-gray-400">cada</span>
                <input type="number" value={t.min} onChange={e => setTramo(i, 'min', e.target.value)} min="1"
                  className="w-14 px-2 py-1 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-center" />
                <span className="text-[11px] text-gray-400">completos → $</span>
                <input type="number" value={t.monto} onChange={e => setTramo(i, 'monto', e.target.value)} min="0" step="1000"
                  className="flex-1 px-2 py-1 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md" />
                <button onClick={() => delTramo(i)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
              </div>
            ))}
            <button onClick={addTramo} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 dark:text-brand-300 hover:underline"><Plus size={12} /> Agregar tramo</button>
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 italic">Sin bono — cobra solo el monto por producto.</p>
        )}
      </div>

      <div className="flex items-center gap-2 justify-end pt-1">
        <button onClick={onClose} className="px-2.5 py-1 text-xs font-semibold text-gray-500 hover:text-gray-700">Cancelar</button>
        <button onClick={save} className="px-3 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-md">Guardar pago</button>
      </div>
    </div>
  );
}

export default function TeamModal({ onClose, addToast }) {
  // Diálogos propios: { type: 'reset'|'remove', m, pass? }. Ref para que el
  // Esc del panel no se dispare mientras un diálogo está abierto.
  const [dlg, setDlg] = useState(null);
  const dlgRef = useRef(null);
  dlgRef.current = dlg;

  // Cierre PROTEGIDO: si hay datos tipeados en el alta, click-afuera y Esc NO
  // cierran (para no perder lo escrito). La ✕ siempre cierra. Usamos un ref para
  // que el handler de Esc lea siempre los valores actuales del form.
  const guardedCloseRef = useRef(() => {});

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !dlgRef.current) guardedCloseRef.current(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const [team, setTeam] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [payOpen, setPayOpen] = useState(null); // id del integrante con el editor de pago abierto

  // Form de alta
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => suggestPassword());
  const [lastCreated, setLastCreated] = useState(null); // { name, email, password }
  // Persona de texto que estamos convirtiendo en cuenta: al crear, se le
  // vinculan SUS tarjetas (aunque le cambies el nombre). { name, cards } | null.
  const [linkPersona, setLinkPersona] = useState(null);
  const emailRef = useRef(null);

  // Cierre protegido: no cerrar si hay algo escrito en el alta.
  guardedCloseRef.current = () => {
    if (name.trim() || email.trim()) return;
    onClose?.();
  };

  // Personas que ya venís usando como texto en las tarjetas (Fran, Wanda…).
  // Las que todavía NO tienen cuenta se ofrecen para crearlas con un click.
  const personas = useMemo(() => { try { return personasEnTarjetas(); } catch { return []; } }, []);
  const teamNames = new Set(team.map(m => (m.display_name || '').trim().toLowerCase()).filter(Boolean));
  const sinCuenta = personas.filter(p => !p.conCuenta && !teamNames.has(p.persona.toLowerCase()));

  // Precarga el nombre y recuerda de qué persona viene (para vincular sus
  // tarjetas al crear). Podés editar el nombre libremente después.
  const usarPersona = (p) => {
    setName(p.persona);
    setLinkPersona({ name: p.persona, cards: p.tarjetas });
    setLastCreated(null);
    setTimeout(() => emailRef.current?.focus(), 0);
  };

  const reload = () => {
    setLoading(true);
    listTeam().then(setTeam).catch(err => addToast?.({ type: 'error', message: err.message })).finally(() => setLoading(false));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onCreate = async (e) => {
    e.preventDefault();
    if (busy) return;
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { addToast?.({ type: 'warning', message: 'Email inválido' }); return; }
    if (password.length < 6) { addToast?.({ type: 'warning', message: 'La contraseña necesita 6+ caracteres' }); return; }
    setBusy(true);
    try {
      const member = await createMember(em, password, name.trim());
      const displayName = name.trim() || em.split('@')[0];
      // Si venís de una persona de texto (ej: "Fran"), le enganchamos SUS
      // tarjetas a la cuenta nueva. IMPORTANTE: NO pisamos el label `persona` —
      // solo seteamos creatorId. Los pagos se agrupan por `persona` y las carpetas
      // de Drive se derivan de `persona`, así que renombrar rompería pagos ya
      // registrados y partiría las carpetas. La cuenta puede tener un nombre más
      // completo (display_name); las tarjetas conservan su etiqueta original.
      let linked = 0;
      if (linkPersona && member?.id) {
        const target = linkPersona.name.trim().toLowerCase();
        for (const wk of allWeekKeys()) {
          for (const a of listAssignments(wk)) {
            if ((a.persona || '').trim().toLowerCase() === target) { assignCreator(a.id, { creatorId: member.id }); linked++; }
          }
        }
      }
      // Dejamos las credenciales A LA VISTA (el toast se va y se perderían).
      setLastCreated({ name: displayName, email: em, password });
      addToast?.({ type: 'success', message: `Cuenta creada para ${displayName}${linked > 0 ? ` · ${linked} tarjeta${linked !== 1 ? 's' : ''} vinculada${linked !== 1 ? 's' : ''}` : ''}.` });
      setName(''); setEmail(''); setPassword(suggestPassword()); setLinkPersona(null);
      reload();
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  // Abren los diálogos propios (nada de window.prompt/confirm del navegador).
  const onReset = (m) => setDlg({ type: 'reset', m, pass: suggestPassword() });
  const onRemove = (m) => setDlg({ type: 'remove', m });

  const copy = async (text, key) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={() => guardedCloseRef.current()}>
      <div className="w-full max-w-lg my-6 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white"><Users size={18} /></div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Equipo</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Cuentas de los creativos. Cada uno entra y ve solo su tablero.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Alta */}
          <form onSubmit={onCreate} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
              <UserPlus size={13} /> Crear cuenta nueva
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre (ej. Fran)"
                className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <input ref={emailRef} value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="email@ejemplo.com"
                className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex items-center gap-2">
              <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña"
                className="flex-1 px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <button type="button" onClick={() => copy(password, 'newpass')} title="Copiar contraseña"
                className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                {copied === 'newpass' ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
              </button>
            </div>
            {/* Aviso de vinculación: al crear, se le enganchan las tarjetas del
                nombre original (aunque hayas editado el nombre a mostrar). */}
            {linkPersona && (
              <div className="flex items-center gap-2 text-[11px] text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg px-2.5 py-1.5">
                <span className="flex-1">Se le vinculan las <b>{linkPersona.cards} tarjeta{linkPersona.cards !== 1 ? 's' : ''}</b> de «{linkPersona.name}» a esta cuenta.</span>
                <button type="button" onClick={() => setLinkPersona(null)} className="font-bold hover:underline shrink-0">quitar</button>
              </div>
            )}
            <button type="submit" disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-50">
              {busy ? <><Loader2 size={15} className="animate-spin" /> Creando…</> : <><UserPlus size={15} /> Crear cuenta</>}
            </button>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              La cuenta queda lista para entrar (sin email de confirmación). Pasale al chico el <b>email</b> y la <b>contraseña</b>.
            </p>
          </form>

          {/* Personas ya usadas en las tarjetas que todavía no tienen cuenta —
              un click precarga el nombre y te lleva al email para crearla. */}
          {sinCuenta.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-900/15 p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-amber-700 dark:text-amber-300 mb-1">
                <Users size={13} /> Personas sin cuenta ({sinCuenta.length})
              </div>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-300/70 mb-2.5">
                Ya las venís usando en las tarjetas. Tocá una para crearle la cuenta — le cargamos el nombre y vos ponés el email.
              </p>
              <div className="flex flex-wrap gap-2">
                {sinCuenta.map(p => (
                  <button key={p.persona} type="button" onClick={() => usarPersona(p)}
                    className="group inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-800 hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition"
                    title={`Crear la cuenta de ${p.persona} (${p.tarjetas} tarjeta${p.tarjetas !== 1 ? 's' : ''})`}>
                    <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center text-[10px] font-bold uppercase">
                      {p.persona.charAt(0)}
                    </span>
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{p.persona}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums">{p.tarjetas}</span>
                    <UserPlus size={12} className="text-brand-500 opacity-60 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Credenciales recién creadas — quedan a la vista hasta cerrarlas */}
          {lastCreated && (
            <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Check size={14} className="text-emerald-600" />
                <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Cuenta de {lastCreated.name} lista — pasale estos datos</span>
                <button onClick={() => setLastCreated(null)} className="ml-auto text-emerald-700/60 hover:text-emerald-800"><X size={15} /></button>
              </div>
              {[['Email', lastCreated.email, 'em'], ['Contraseña', lastCreated.password, 'pw']].map(([lbl, val, key]) => (
                <div key={key} className="flex items-center gap-2 mb-1.5 last:mb-0">
                  <span className="text-[11px] font-bold uppercase text-emerald-700/70 dark:text-emerald-400/70 w-20">{lbl}</span>
                  <code className="flex-1 text-sm font-mono text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-800 rounded px-2 py-1 border border-emerald-200 dark:border-emerald-800 truncate">{val}</code>
                  <button onClick={() => copy(val, key)} title="Copiar"
                    className="p-1.5 rounded-md text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/40">
                    {copied === key ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Lista */}
          <div>
            <div className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">
              En el equipo {team.length > 0 && `(${team.length})`}
            </div>
            {team.length > 3 && (
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o email…"
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
            )}
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 size={15} className="animate-spin" /> Cargando…</div>
            ) : team.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">Todavía no hay cuentas del equipo. Creá la primera arriba.</p>
            ) : (
              <div className="space-y-2">
                {team.filter(m => !q.trim() || `${m.display_name || ''} ${m.email || ''}`.toLowerCase().includes(q.trim().toLowerCase())).map(m => (
                  <div key={m.id}>
                    <div className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 flex items-center justify-center text-sm font-bold uppercase shrink-0">
                        {(m.display_name || m.email || '?').charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                          {m.display_name || m.email}
                          {team.some(x => x.lider_id === m.id) && (
                            <span className="ml-1.5 text-[9px] font-extrabold uppercase tracking-wide text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/30 border border-brand-300/50 dark:border-brand-700/50 rounded-full px-1.5 py-0.5 align-middle"
                              title={`Líder de: ${team.filter(x => x.lider_id === m.id).map(x => x.display_name || x.email).join(', ')}`}>
                              👑 líder
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 truncate inline-flex items-center gap-1"><Mail size={10} /> {m.email}</div>
                      </div>
                      {/* Organigrama: a quién responde. El líder ve las tarjetas
                          de su gente en su propio panel (solo lectura). */}
                      <label className="flex items-center gap-1 text-[10px] text-gray-400 shrink-0" title={`¿A quién responde ${m.display_name || m.email}? Su líder va a ver sus tarjetas en el panel propio.`}>
                        <span className="hidden sm:inline font-bold uppercase">Responde a</span>
                        <select
                          value={m.lider_id || ''}
                          onChange={async (e) => {
                            const liderId = e.target.value || null;
                            try {
                              await setLider(m.id, liderId);
                              const liderNombre = team.find(x => x.id === liderId);
                              addToast?.({ type: 'success', message: liderId
                                ? `${m.display_name || m.email} ahora responde a ${liderNombre?.display_name || liderNombre?.email}`
                                : `${m.display_name || m.email} ya no responde a nadie` });
                              reload();
                            } catch (err) { addToast?.({ type: 'error', message: err.message }); }
                          }}
                          className="max-w-[110px] text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500 text-gray-700 dark:text-gray-200">
                          <option value="">— nadie</option>
                          {team.filter(x => x.id !== m.id).map(x => (
                            <option key={x.id} value={x.id}>{x.display_name || x.email}</option>
                          ))}
                        </select>
                      </label>
                      <button onClick={() => setPayOpen(o => o === m.id ? null : m.id)} title="Configurar pago"
                        className={`p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 ${payOpen === m.id ? 'text-emerald-600' : 'text-gray-400 hover:text-emerald-600'}`}><Wallet size={15} /></button>
                      <button onClick={() => onReset(m)} title="Cambiar contraseña"
                        className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-800"><KeyRound size={15} /></button>
                      <button onClick={() => onRemove(m)} title="Sacar del equipo"
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Trash2 size={15} /></button>
                    </div>
                    {payOpen === m.id && <PagoConfigEditor member={m} onClose={() => setPayOpen(null)} addToast={addToast} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Diálogos propios de la plataforma */}
        <ConfirmDialog
          open={dlg?.type === 'remove'}
          title={`¿Sacar a ${dlg?.m?.display_name || dlg?.m?.email || ''} del equipo?`}
          message="Su cuenta se elimina y no va a poder entrar más. Las tarjetas que tenía quedan sin dueño (no se pierden)."
          confirmLabel="Sacar del equipo" tone="danger"
          onConfirm={async () => {
            const m = dlg.m; setDlg(null);
            try {
              await removeMember(m.id);
              addToast?.({ type: 'success', message: 'Cuenta eliminada del equipo.' });
              reload();
            } catch (err) { addToast?.({ type: 'error', message: err.message }); }
          }}
          onClose={() => setDlg(null)}
        />
        <ConfirmDialog
          open={dlg?.type === 'reset'}
          title={`Nueva contraseña para ${dlg?.m?.display_name || dlg?.m?.email || ''}`}
          message="Pasásela al chico después de cambiarla."
          withInput inputLabel="Contraseña (mínimo 6)"
          defaultValue={dlg?.pass || ''}
          confirmLabel="Cambiar contraseña" tone="brand"
          onConfirm={async (nueva) => {
            if (!nueva || nueva.length < 6) { addToast?.({ type: 'warning', message: 'Mínimo 6 caracteres' }); return; }
            const m = dlg.m; setDlg(null);
            try {
              await resetPassword(m.id, nueva);
              addToast?.({ type: 'success', message: `Contraseña actualizada. Nueva: ${nueva}` });
            } catch (err) { addToast?.({ type: 'error', message: err.message }); }
          }}
          onClose={() => setDlg(null)}
        />
      </div>
    </div>
  );
}
