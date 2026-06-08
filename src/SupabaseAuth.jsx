// Pantalla de login/signup con Supabase Auth (email + password).
// Se muestra cuando el user NO está logueado en Supabase. Multi-tenant:
// cualquiera puede signupearse, después invitás compartiendo el dashboard.
//
// Una vez logueado, dispatchea 'viora:supabase-auth' para que App.jsx pueda
// arrancar el sync de Marketing.

import React, { useState, useEffect } from 'react';
import { Mail, Lock, LogIn, UserPlus, AlertCircle, Loader2, KeyRound, Send } from 'lucide-react';
import { supabase, onAuthChange } from './supabase.js';

export default function SupabaseAuthScreen({ onLoggedIn }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Detectamos si venimos del link de reset (Supabase redirige con
  // type=recovery en el query string o hash). Si sí, mostramos el form
  // para setear nueva contraseña.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (hash.includes('type=recovery') || search.includes('type=recovery')) {
      setMode('reset');
    }
  }, []);

  // Si la sesión ya existe (refresh), saltamos directo.
  useEffect(() => {
    if (!supabase) return;
    if (mode === 'reset') return; // en reset NO queremos auto-redirect
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) onLoggedIn?.(session.user);
    })();
    return onAuthChange(({ user }) => {
      if (user) onLoggedIn?.(user);
    });
  }, [onLoggedIn]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!supabase) {
      setError('Supabase no está configurado. Avisale al admin para setear las env vars.');
      return;
    }
    // 'forgot' solo necesita email. 'reset' solo necesita password (la
    // sesión la pone Supabase via el magic link).
    if (mode === 'forgot') {
      if (!email) { setError('Ponele el email'); return; }
    } else if (mode === 'reset') {
      if (!password || password.length < 6) { setError('La contraseña tiene que tener al menos 6 caracteres'); return; }
    } else if (!email || !password) {
      setError('Email y contraseña son requeridos');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName || email.split('@')[0] } },
        });
        if (error) throw error;
        setSuccess('Cuenta creada. Revisá tu email si pide confirmación, o ya estás logueado.');
      } else if (mode === 'forgot') {
        // Email con el magic link de reset. El user clickea, Supabase lo
        // redirige a /acceso#type=recovery y nuestro useEffect cambia a
        // mode='reset' para que pueda ponerse contraseña nueva.
        const redirectTo = `${window.location.origin}/acceso`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setSuccess(`Te mandamos un email a ${email} con el link para resetear. Revisá la bandeja (y spam).`);
      } else if (mode === 'reset') {
        // Cambiar password (la sesión ya está válida via el link de email).
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setSuccess('Contraseña actualizada. Ya estás logueado.');
        // Limpiar el hash de recovery del URL.
        try { window.history.replaceState(null, '', '/acceso'); } catch {}
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err?.message || 'Error de auth');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-950 via-rose-900 to-purple-950 p-4">
      <div className="w-full max-w-sm bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold text-white mb-1">AdsLab</h1>
          <p className="text-xs text-white/60">
            {mode === 'login' && 'Entrá con tu cuenta'}
            {mode === 'signup' && 'Creá una cuenta nueva'}
            {mode === 'forgot' && 'Te mandamos un link para resetear'}
            {mode === 'reset' && 'Poné tu nueva contraseña'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Nombre (opcional)</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Cómo querés que te llame"
                className="mt-1 w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-md text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-pink-400"
              />
            </div>
          )}

          {/* Email — visible en login/signup/forgot. En reset NO (la sesión
              está validada via el link, solo falta cambiar password). */}
          {mode !== 'reset' && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Email</label>
              <div className="relative mt-1">
                <Mail size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className="w-full pl-8 pr-3 py-2 text-sm bg-white/5 border border-white/10 rounded-md text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-pink-400"
                  autoComplete="email"
                />
              </div>
            </div>
          )}

          {/* Contraseña — visible en login/signup/reset. En forgot NO. */}
          {mode !== 'forgot' && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-white/50 font-bold">
                {mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}
              </label>
              <div className="relative mt-1">
                <Lock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={(mode === 'signup' || mode === 'reset') ? 'Mínimo 6 caracteres' : 'Tu contraseña'}
                  minLength={6}
                  className="w-full pl-8 pr-3 py-2 text-sm bg-white/5 border border-white/10 rounded-md text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-pink-400"
                  autoComplete={(mode === 'signup' || mode === 'reset') ? 'new-password' : 'current-password'}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-500/10 border border-red-500/30 text-[11px] text-red-200">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-200">
              <span>{success}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-pink-500 to-rose-500 rounded-md hover:from-pink-600 hover:to-rose-600 transition disabled:opacity-60 shadow-lg shadow-pink-900/40"
          >
            {loading
              ? <Loader2 size={15} className="animate-spin" />
              : mode === 'login' ? <LogIn size={15} />
              : mode === 'signup' ? <UserPlus size={15} />
              : mode === 'forgot' ? <Send size={15} />
              : <KeyRound size={15} />}
            {loading
              ? 'Conectando…'
              : mode === 'login' ? 'Entrar'
              : mode === 'signup' ? 'Crear cuenta'
              : mode === 'forgot' ? 'Mandame el link'
              : 'Cambiar contraseña'}
          </button>
        </form>

        <div className="mt-4 text-center space-y-1">
          {/* Link entre login y signup */}
          {(mode === 'login' || mode === 'signup') && (
            <div>
              <button
                type="button"
                onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError(null); setSuccess(null); }}
                className="text-[11px] text-white/50 hover:text-white/80 transition"
              >
                {mode === 'login' ? '¿No tenés cuenta? Crear una' : '¿Ya tenés cuenta? Entrar'}
              </button>
            </div>
          )}
          {/* Link a forgot password — solo desde login */}
          {mode === 'login' && (
            <div>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(null); setSuccess(null); }}
                className="text-[11px] text-white/50 hover:text-white/80 transition"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}
          {/* Volver al login desde forgot/reset */}
          {(mode === 'forgot' || mode === 'reset') && (
            <div>
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null); setSuccess(null); }}
                className="text-[11px] text-white/50 hover:text-white/80 transition"
              >
                Volver al login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
