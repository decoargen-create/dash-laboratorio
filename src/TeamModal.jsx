// Panel EQUIPO (admin) — crear/gestionar las cuentas de los creativos.
// Cada cuenta creada acá entra a la app con SU login y ve solo su tablero.
//
// Flujo pensado para un dueño no técnico: ponés nombre + email + una
// contraseña, se crea la cuenta, y se la pasás al chico. Después, en cada
// tarjeta, lo asignás desde "Asignar a (cuenta)".

import React, { useEffect, useState } from 'react';
import { X, UserPlus, Loader2, Trash2, KeyRound, Users, Mail, Copy, Check } from 'lucide-react';
import { listTeam, createMember, resetPassword, removeMember } from './produccionTeam.js';

// Genera una contraseña simple pero decente para pasarle al chico.
function suggestPassword() {
  const words = ['creativo', 'video', 'lab', 'equipo', 'reel', 'clip'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w}${n}`;
}

export default function TeamModal({ onClose, addToast }) {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  // Form de alta
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => suggestPassword());

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
      await createMember(em, password, name.trim());
      addToast?.({ type: 'success', message: `Cuenta creada para ${name.trim() || em}. Pasale el email y la contraseña.` });
      setName(''); setEmail(''); setPassword(suggestPassword());
      reload();
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const onReset = async (m) => {
    const nueva = window.prompt(`Nueva contraseña para ${m.display_name || m.email} (mínimo 6):`, suggestPassword());
    if (nueva == null) return;
    if (nueva.length < 6) { addToast?.({ type: 'warning', message: 'Mínimo 6 caracteres' }); return; }
    try {
      await resetPassword(m.id, nueva);
      addToast?.({ type: 'success', message: `Contraseña actualizada. Nueva: ${nueva}` });
    } catch (err) { addToast?.({ type: 'error', message: err.message }); }
  };

  const onRemove = async (m) => {
    if (!window.confirm(`¿Sacar a ${m.display_name || m.email} del equipo? Su cuenta se elimina. Las tarjetas que tenía quedan sin dueño (no se pierden).`)) return;
    try {
      await removeMember(m.id);
      addToast?.({ type: 'success', message: 'Cuenta eliminada del equipo.' });
      reload();
    } catch (err) { addToast?.({ type: 'error', message: err.message }); }
  };

  const copy = async (text, key) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg my-6 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white"><Users size={18} /></div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Equipo</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Cuentas de los creativos. Cada uno entra y ve solo su tablero.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Alta */}
          <form onSubmit={onCreate} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">
              <UserPlus size={13} /> Crear cuenta nueva
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre (ej. Fran)"
                className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="email@ejemplo.com"
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
            <button type="submit" disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition disabled:opacity-50">
              {busy ? <><Loader2 size={15} className="animate-spin" /> Creando…</> : <><UserPlus size={15} /> Crear cuenta</>}
            </button>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              La cuenta queda lista para entrar (sin email de confirmación). Pasale al chico el <b>email</b> y la <b>contraseña</b>.
            </p>
          </form>

          {/* Lista */}
          <div>
            <div className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">
              En el equipo {team.length > 0 && `(${team.length})`}
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 size={15} className="animate-spin" /> Cargando…</div>
            ) : team.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">Todavía no hay cuentas del equipo. Creá la primera arriba.</p>
            ) : (
              <div className="space-y-2">
                {team.map(m => (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 flex items-center justify-center text-sm font-bold uppercase shrink-0">
                      {(m.display_name || m.email || '?').charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{m.display_name || m.email}</div>
                      <div className="text-[11px] text-gray-400 truncate inline-flex items-center gap-1"><Mail size={10} /> {m.email}</div>
                    </div>
                    <button onClick={() => onReset(m)} title="Cambiar contraseña"
                      className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-800"><KeyRound size={15} /></button>
                    <button onClick={() => onRemove(m)} title="Sacar del equipo"
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
