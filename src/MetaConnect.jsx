// Conexión con Meta — UI compartida (botón de header + modal + form de token).
//
// Antes esto vivía adentro de CampanasTracker: para conectar una cuenta había
// que navegar a Meta Ads → Campañas y recién ahí aparecía el form. Ahora el
// botón "Conectar cuenta" vive en el header de AdsLab y está disponible desde
// cualquier sección; CampanasTracker reusa las mismas piezas.
//
// Dos caminos de conexión (los dos terminan en una fila de meta_connections):
//   1. OAuth ("Conectar con Facebook") — un click, sin tokens a mano. Requiere
//      META_APP_ID/META_APP_SECRET en el server (ver /api/meta/oauth-config).
//   2. Access Token pegado — funciona siempre, sirve para system user tokens
//      (no expiran) y para cuentas de terceros compartidas.
//
// El token nunca toca el browser: el backend lo cifra y lo guarda.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, Check, Loader2, AlertCircle, ExternalLink, KeyRound, X, HelpCircle,
  Clock, ShieldCheck, Plug, ChevronDown, Trash2,
} from 'lucide-react';
import { supabase } from './supabase.js';

const TOKEN_HELP_URL = 'https://developers.facebook.com/tools/explorer/';
const SYS_USERS_URL = 'https://business.facebook.com/settings/system-users';

// Con Supabase configurado usamos conexiones persistidas en DB (multi-cuenta).
export const DB_MODE = !!supabase;

// Evento global: lo dispara cualquiera que agregue/borre una conexión para que
// el resto de la UI (header, Campañas, Arranque) se refresque sin recargar.
export const META_CONN_EVENT = 'adslab:meta-connections';
// Evento para abrir el modal desde otra sección (ej. la card de Arranque).
export const META_CONNECT_OPEN_EVENT = 'adslab:meta-connect-open';

export function notifyMetaConnectionsChanged() {
  try { window.dispatchEvent(new CustomEvent(META_CONN_EVENT)); } catch {}
}

export function openMetaConnect() {
  try { window.dispatchEvent(new CustomEvent(META_CONNECT_OPEN_EVENT)); } catch {}
}

// Headers con el JWT de Supabase (para que el backend identifique al dueño de
// las conexiones). En modo cookie no hace falta, pero mandarlo no molesta.
export async function authHeaders(json = false) {
  let token = '';
  try {
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token || '';
    }
  } catch {}
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Lista de conexiones del user (DB) o la conexión única de cookie (legacy).
export async function fetchMetaConnections() {
  if (DB_MODE) {
    const r = await fetch('/api/meta/connections', { headers: await authHeaders(false) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return (d.connections || []).map(c => ({
      id: c.id, label: c.label, metaUserName: c.meta_user_name,
    }));
  }
  const r = await fetch('/api/meta/me');
  const d = await r.json().catch(() => ({}));
  if (!d.connected) return [];
  return [{ id: '__cookie__', label: d.user?.name || 'Cuenta Meta', metaUserName: d.user?.name }];
}

export async function connectMetaToken({ accessToken, label }) {
  const r = await fetch('/api/meta/connect-token', {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ accessToken, label }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo conectar.');
  notifyMetaConnectionsChanged();
  return d;
}

export async function deleteMetaConnection(connId) {
  if (connId === '__cookie__') {
    await fetch('/api/meta/disconnect', { method: 'POST' });
  } else {
    const r = await fetch(`/api/meta/connections?connection_id=${encodeURIComponent(connId)}`, {
      method: 'DELETE', headers: await authHeaders(false),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${r.status}`);
    }
  }
  notifyMetaConnectionsChanged();
}

// Hook: conexiones + reload automático cuando otra parte de la app conecta o
// borra una (via META_CONN_EVENT).
export function useMetaConnections() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const conns = await fetchMetaConnections();
      setConnections(conns);
      setError(null);
      return conns;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const onChange = () => reload();
    window.addEventListener(META_CONN_EVENT, onChange);
    return () => window.removeEventListener(META_CONN_EVENT, onChange);
  }, [reload]);

  return { connections, loading, error, reload };
}

// ========================================================================
// Botón "Conectar con Facebook" (OAuth) — el flujo estilo Ads Uploader.
// Solo aparece si la app de Meta está configurada en el server
// (META_APP_ID + META_APP_SECRET). Cada user de AdsLab que lo usa conecta
// SU Meta: el callback guarda la conexión a su nombre en meta_connections.
// Mientras la app no pase App Review, solo cuentas con rol en la app pueden
// usarlo; post-review, cualquier colega/cliente.
// ========================================================================
export function OAuthConnectButton() {
  const [configured, setConfigured] = useState(null); // null = cargando
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/meta/oauth-config')
      .then(r => r.json())
      .then(d => { if (!cancelled) setConfigured(!!d.configured); })
      .catch(() => { if (!cancelled) setConfigured(false); });
    return () => { cancelled = true; };
  }, []);

  const start = async () => {
    setStarting(true); setError(null);
    try {
      const resp = await fetch('/api/meta/connect-url', {
        method: 'POST',
        headers: await authHeaders(true),
        // Volvemos a la MISMA pantalla desde la que se disparó el OAuth
        // (antes era '/' fijo y el callback te escupía en la landing pública).
        body: JSON.stringify({ returnTo: window.location.pathname + window.location.search }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.url) throw new Error(data.error || `HTTP ${resp.status}`);
      window.location.href = data.url; // → consent screen de Meta
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  };

  if (configured === false || configured === null) return null; // sin app → solo token

  return (
    <div className="mb-4">
      <button
        type="button" onClick={start} disabled={starting}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-[#1877F2] rounded-lg hover:bg-[#0f6ae0] shadow-sm transition disabled:opacity-50"
      >
        {starting ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
        Conectar con Facebook
      </button>
      {error && (
        <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="flex items-center gap-3 mt-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-[10px] text-gray-400 uppercase tracking-wider">o pegá un token</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  );
}

// ========================================================================
// Form de conexión por token
// ========================================================================
export function ConnectTokenForm({ onConnect, onCancel, canCancel }) {
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [guide, setGuide] = useState('quick'); // 'quick' | 'permanent'

  const submit = async (e) => {
    e?.preventDefault();
    const t = token.trim();
    if (!t) { setError('Pegá un access token.'); return; }
    setBusy(true); setError(null);
    try {
      await onConnect({ accessToken: t, label: label.trim() });
      setToken(''); setLabel('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-[#E7F3FF] to-white dark:from-brand-900/20 dark:to-gray-800/60 border border-[#1877F2]/20 dark:border-brand-800 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0668E1] to-[#1877F2] flex items-center justify-center text-white shadow-sm shrink-0">
          <KeyRound size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Conectar cuenta publicitaria</h3>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Pegá un Access Token de Meta. Sirve para tu cuenta o la de cualquier persona que te dé acceso.
          </p>
        </div>
        {canCancel && (
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition shrink-0" aria-label="Cancelar">
            <X size={16} />
          </button>
        )}
      </div>

      <OAuthConnectButton />

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wider">
            Etiqueta <span className="font-normal normal-case text-gray-400">(para reconocerla — ej. "Cliente X")</span>
          </label>
          <input
            type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="Cuenta de…"
            className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wider">
            Access Token
          </label>
          <textarea
            value={token} onChange={e => setToken(e.target.value)}
            placeholder="EAAB..." rows={3} spellCheck={false}
            className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none break-all"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
            <AlertCircle size={15} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-300 break-words">{error}</p>
          </div>
        )}

        <button
          type="submit" disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-lg hover:from-[#0556BE] hover:to-[#1668D8] shadow-sm transition disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
          Conectar
        </button>
      </form>

      {/* Guía paso a paso para conseguir el token */}
      <div className="mt-5 bg-white/80 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <HelpCircle size={16} className="text-brand-600 dark:text-brand-400 shrink-0" />
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">¿Cómo consigo el token? Te guío</p>
        </div>

        {/* Tabs de método */}
        <div className="flex gap-1 px-4 pt-3">
          <button
            type="button" onClick={() => setGuide('quick')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-t-lg border-b-2 transition ${
              guide === 'quick'
                ? 'text-brand-600 dark:text-brand-400 border-brand-500'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <Clock size={13} /> Rápido (para probar)
          </button>
          <button
            type="button" onClick={() => setGuide('permanent')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-t-lg border-b-2 transition ${
              guide === 'permanent'
                ? 'text-brand-600 dark:text-brand-400 border-brand-500'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <ShieldCheck size={13} /> Permanente (recomendado)
          </button>
        </div>

        <div className="p-4 pt-3">
          {guide === 'quick' ? (
            <>
              <a
                href={TOKEN_HELP_URL} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 mb-3 text-xs font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-lg hover:from-[#0556BE] hover:to-[#1668D8] transition shadow-sm"
              >
                Abrir Graph API Explorer <ExternalLink size={12} />
              </a>
              <ol className="space-y-2.5">
                <GuideStep n={1}>En la ventana que se abre, a la derecha buscá <strong>“Permissions”</strong> (Permisos) y agregá <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">ads_read</code> y <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">ads_management</code>.</GuideStep>
                <GuideStep n={2}>Click en el botón azul <strong>“Generate Access Token”</strong>. Te va a pedir iniciar sesión en Facebook y aprobar.</GuideStep>
                <GuideStep n={3}>Se genera un texto largo que arranca con <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">EAAB…</code>. Copialo entero.</GuideStep>
                <GuideStep n={4}>Volvé acá, pegalo en <strong>“Access Token”</strong> y tocá <strong>Conectar</strong>. ✅</GuideStep>
              </ol>
              <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5">
                <Clock size={13} className="shrink-0 mt-0.5" />
                <span>Este token dura ~1 a 2 horas — perfecto para probar ya. Cuando se venza, generás otro igual, o pasás al método <strong>Permanente</strong>.</span>
              </div>
            </>
          ) : (
            <>
              <a
                href={SYS_USERS_URL} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 mb-3 text-xs font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-lg hover:from-[#0556BE] hover:to-[#1668D8] transition shadow-sm"
              >
                Abrir Configuración del negocio <ExternalLink size={12} />
              </a>
              <ol className="space-y-2.5">
                <GuideStep n={1}>En <strong>Usuarios → Usuarios del sistema</strong>, creá uno (botón <strong>“Agregar”</strong>) o usá uno existente.</GuideStep>
                <GuideStep n={2}>Asignale la <strong>cuenta publicitaria</strong> a trackear (en “Agregar activos” → Cuentas publicitarias → acceso total). Para la cuenta de otra persona, primero pedile que te la comparta con tu Business Manager.</GuideStep>
                <GuideStep n={3}>Click en <strong>“Generar nuevo token”</strong>, elegí tu app, y marcá los permisos <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">ads_read</code> y <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">ads_management</code>.</GuideStep>
                <GuideStep n={4}>Copiá el token y pegalo acá. <strong>Este no expira</strong> y ve todas las cuentas compartidas. ✅</GuideStep>
              </ol>
            </>
          )}
        </div>

        <p className="px-4 pb-3 text-[11px] text-gray-500 dark:text-gray-500">
          🔒 El token se guarda {DB_MODE ? 'cifrado en el servidor (tabla protegida)' : 'en una cookie HttpOnly del servidor'} — nunca queda accesible desde el navegador.
        </p>
      </div>
    </div>
  );
}

// Paso numerado de la guía.
function GuideStep({ n, children }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="shrink-0 w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-[11px] font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{children}</span>
    </li>
  );
}

// ========================================================================
// Modal de conexión — lista de cuentas conectadas + alta de una nueva.
// ========================================================================
export function MetaConnectModal({ open, onClose, connections, loading, onConnected, addToast }) {
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState('');

  // Sin conexiones, el modal abre directo en el form (no tiene sentido mostrar
  // una lista vacía y obligar a un click extra).
  useEffect(() => {
    if (open) setShowForm(connections.length === 0);
  }, [open, connections.length]);

  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleConnect = async ({ accessToken, label }) => {
    const d = await connectMetaToken({ accessToken, label });
    addToast?.({ type: 'success', message: `Conectado a Meta como ${d.user?.name || d.user?.id}` });
    setShowForm(false);
    onConnected?.(d);
  };

  const handleDelete = async (conn) => {
    if (!window.confirm(`¿Eliminar la conexión "${conn.label}"? Vas a tener que volver a conectarla para usarla.`)) return;
    setDeleting(conn.id);
    try {
      await deleteMetaConnection(conn.id);
      addToast?.({ type: 'info', message: 'Conexión eliminada.' });
    } catch (err) {
      addToast?.({ type: 'error', message: err.message });
    } finally {
      setDeleting('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center p-4 md:p-8 overflow-y-auto bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label="Conectar cuenta publicitaria"
    >
      <div
        className="w-full max-w-2xl my-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0668E1] to-[#1877F2] flex items-center justify-center text-white shrink-0">
            <Plug size={17} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Cuentas publicitarias</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Conectá tu Meta para trackear campañas, ads y métricas dentro de AdsLab.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition" aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Cargando conexiones…
            </div>
          ) : (
            <>
              {connections.length > 0 && (
                <ul className="space-y-2">
                  {connections.map(c => (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                        <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">{c.label}</p>
                        {c.metaUserName && (
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">Meta: {c.metaUserName}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(c)} disabled={deleting === c.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50"
                        title="Eliminar conexión"
                      >
                        {deleting === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {showForm ? (
                <ConnectTokenForm
                  onConnect={handleConnect}
                  onCancel={() => setShowForm(false)}
                  canCancel={connections.length > 0}
                />
              ) : (
                <button
                  onClick={() => setShowForm(true)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-lg hover:from-[#0556BE] hover:to-[#1668D8] shadow-sm transition"
                >
                  <Zap size={15} /> Conectar otra cuenta
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ========================================================================
// Botón del header — estado de conexión + acceso al modal desde cualquier
// sección de AdsLab. Sin conexiones muestra el CTA azul de Meta; con
// conexiones queda como chip discreto con la cuenta activa.
// ========================================================================
export function MetaConnectButton({ addToast }) {
  const { connections, loading, reload } = useMetaConnections();
  const [open, setOpen] = useState(false);

  // Otra sección puede pedir abrir el modal (ej. la card de cuenta en Productos).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(META_CONNECT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(META_CONNECT_OPEN_EVENT, onOpen);
  }, []);

  // Vuelta del OAuth: /api/meta/callback redirige con ?meta=connected|error.
  // Avisamos, limpiamos el query param y refrescamos la lista.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('meta')) return;
    const status = params.get('meta');
    const reason = params.get('reason');
    if (status === 'connected') addToast?.({ type: 'success', message: 'Cuenta de Meta conectada.' });
    else if (status === 'error') addToast?.({ type: 'error', message: `No se pudo conectar con Meta: ${reason || 'error desconocido'}` });
    params.delete('meta'); params.delete('reason');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    reload().then(() => notifyMetaConnectionsChanged());
  }, [addToast, reload]);

  const connected = connections.length > 0;
  const label = connected
    ? (connections.length > 1 ? `${connections.length} cuentas` : connections[0].label)
    : 'Conectar cuenta';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={connected ? 'Cuentas publicitarias conectadas' : 'Conectá tu cuenta publicitaria de Meta'}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border transition max-w-[190px] ${
          connected
            ? 'bg-emerald-50 dark:bg-emerald-900/25 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
            : 'bg-[#1877F2] border-[#1877F2] text-white hover:bg-[#0f6ae0] shadow-sm'
        }`}
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : connected ? <Check size={13} /> : <Plug size={13} />}
        <span className="truncate">{label}</span>
        {connected && <ChevronDown size={12} className="opacity-60 shrink-0" />}
      </button>

      <MetaConnectModal
        open={open}
        onClose={() => setOpen(false)}
        connections={connections}
        loading={loading}
        addToast={addToast}
      />
    </>
  );
}
