// Sección Automatización IG — feature independiente.
//
// Permite crear N automatizaciones. Cada una tiene:
//   - nombre (identificador humano)
//   - ad account (a cuál vinculamos)
//   - campaña (sobre cuál trabajamos)
//   - ad set base (el que se duplica)
//   - URL pública de IG (ej. https://www.instagram.com/miusername/)
//     → el backend la resuelve a igUserId + pageId buscando entre las
//     IG Business vinculadas a las Pages del user del Business Manager.
//   - threshold de likes (para pausar viejos), pinnedPosts, webhookUrl (opcionales)
//
// Storage: localStorage clave `viora-auto-ig-automations-v1`.
// Shape:
//   [{ id, name, adAccountId, adAccountName, campaignId, campaignName,
//      baseAdsetId, baseAdsetName, igUrl, igUsername, igUserId, pageId,
//      threshold, pinnedPosts, webhookUrl, createdAt, state, lastRun }]
//
// Parte 1 (este commit): CRUD + form + verificador de IG URL.
// Parte 2 (próximo): botones Previsualizar/Ejecutar conectados al backend.
// Parte 3: cron diario sobre múltiples automatizaciones.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Instagram, Plus, Pencil, Trash2, Check, X, Loader2, AlertTriangle,
  ChevronLeft, Link2, RefreshCw, ExternalLink, Search, ChevronDown,
} from 'lucide-react';

const STORAGE_KEY = 'viora-auto-ig-automations-v1';

function loadAutomations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveAutomations(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

const EMPTY_FORM = {
  name: '',
  adAccountId: '', adAccountName: '',
  campaignId: '', campaignName: '',
  baseAdsetId: '', baseAdsetName: '',
  igUrl: '', igUsername: '', igUserId: '', pageId: '',
  threshold: 50, pinnedPosts: 0, webhookUrl: '',
};

export default function AutoIGSection({ addToast }) {
  const [automations, setAutomations] = useState(() => loadAutomations());
  const [view, setView] = useState('list'); // 'list' | 'form'
  const [editingId, setEditingId] = useState(null);
  const [metaConnected, setMetaConnected] = useState(null);

  useEffect(() => { saveAutomations(automations); }, [automations]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/meta/me');
        const d = await r.json();
        if (alive) setMetaConnected(!!d.connected);
      } catch {
        if (alive) setMetaConnected(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const handleNew = () => { setEditingId(null); setView('form'); };
  const handleEdit = (id) => { setEditingId(id); setView('form'); };
  const handleDelete = (id) => {
    const a = automations.find(x => x.id === id);
    if (!a) return;
    if (!confirm(`¿Eliminar la automatización "${a.name}"?`)) return;
    setAutomations(prev => prev.filter(x => x.id !== id));
    addToast?.('Automatización eliminada', 'info');
  };
  const handleSave = (formData) => {
    if (editingId) {
      setAutomations(prev => prev.map(x => x.id === editingId ? { ...x, ...formData } : x));
      addToast?.('Automatización actualizada', 'success');
    } else {
      const newOne = { ...formData, id: `auto_${Date.now()}`, createdAt: new Date().toISOString(), state: { lastPostId: null, activeAdsets: [] }, lastRun: null };
      setAutomations(prev => [newOne, ...prev]);
      addToast?.('Automatización creada', 'success');
    }
    setView('list');
    setEditingId(null);
  };

  const editing = editingId ? automations.find(x => x.id === editingId) : null;

  if (metaConnected === false) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/40 p-6">
          <div className="flex gap-3">
            <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0" size={22} />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-100">Meta no está conectado</p>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                Conectate con Meta desde el banner de arriba para poder crear automatizaciones.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'form') {
    return (
      <AutomationForm
        initial={editing || EMPTY_FORM}
        onCancel={() => { setView('list'); setEditingId(null); }}
        onSave={handleSave}
        addToast={addToast}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white shadow-sm">
          <Instagram size={20} />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Automatización IG</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Renovación diaria de creativos con el último post de un Instagram — por automatización.
          </p>
        </div>
        <button
          onClick={handleNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90"
        >
          <Plus size={16} />
          Nueva automatización
        </button>
      </div>

      {automations.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
          <Instagram size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sin automatizaciones</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
            Creá tu primera automatización apuntando a una cuenta publicitaria, campaña y URL de IG.
          </p>
          <button
            onClick={handleNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90"
          >
            <Plus size={16} />
            Crear la primera
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map(a => (
            <AutomationCard
              key={a.id}
              automation={a}
              onEdit={() => handleEdit(a.id)}
              onDelete={() => handleDelete(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// -------- Card de cada automatización --------

function AutomationCard({ automation, onEdit, onDelete }) {
  const a = automation;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white shrink-0">
        <Instagram size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{a.name}</p>
          {a.igUsername && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300">
              @{a.igUsername}
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {a.adAccountName || a.adAccountId} · {a.campaignName || a.campaignId} · ad set {a.baseAdsetName || a.baseAdsetId}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
          Umbral {a.threshold} likes · pinned {a.pinnedPosts}
          {a.lastRun ? ` · última corrida ${new Date(a.lastRun).toLocaleString('es-AR')}` : ' · nunca ejecutada'}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onEdit}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          title="Editar"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={onDelete}
          className="p-2 rounded-lg text-gray-500 hover:text-rose-600 dark:text-gray-400 dark:hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          title="Eliminar"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// -------- Form para crear/editar una automatización --------

function AutomationForm({ initial, onCancel, onSave, addToast }) {
  const [form, setForm] = useState(initial);
  const [adAccounts, setAdAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [adsets, setAdsets] = useState([]);
  const [loadingAccs, setLoadingAccs] = useState(false);
  const [loadingCmp, setLoadingCmp] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);
  const [errorAccs, setErrorAccs] = useState(null);
  const [errorCmp, setErrorCmp] = useState(null);
  const [errorAds, setErrorAds] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [igVerified, setIgVerified] = useState(!!initial.igUserId && !!initial.pageId);
  const [igError, setIgError] = useState(null);

  const patch = (delta) => setForm(f => ({ ...f, ...delta }));

  // Fetch con timeout — Meta puede tardar si hay muchas campañas. 25s es
  // suficiente para casos razonables; si pasa, mostramos error con retry.
  const fetchWithTimeout = async (url, ms = 25000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    } finally {
      clearTimeout(t);
    }
  };

  const loadAdAccounts = async () => {
    setLoadingAccs(true); setErrorAccs(null);
    try {
      const d = await fetchWithTimeout('/api/meta/ad-accounts');
      setAdAccounts(d.accounts || []);
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'La API de Meta tardó demasiado. Reintentá.'
        : err.message;
      setErrorAccs(msg);
      addToast?.(`No pude listar cuentas publicitarias: ${msg}`, 'error');
    } finally {
      setLoadingAccs(false);
    }
  };

  const loadCampaigns = async (accountId) => {
    setLoadingCmp(true); setErrorCmp(null);
    try {
      const d = await fetchWithTimeout(`/api/meta/campaigns?account_id=${encodeURIComponent(accountId)}`);
      setCampaigns(d.campaigns || []);
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'La API de Meta tardó demasiado. Reintentá.'
        : err.message;
      setErrorCmp(msg);
      addToast?.(`No pude listar campañas: ${msg}`, 'error');
    } finally {
      setLoadingCmp(false);
    }
  };

  const loadAdsets = async (campaignId) => {
    setLoadingAds(true); setErrorAds(null);
    try {
      const d = await fetchWithTimeout(`/api/meta/campaign-adsets?campaign_id=${encodeURIComponent(campaignId)}`);
      setAdsets(d.adsets || []);
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'La API de Meta tardó demasiado. Reintentá.'
        : err.message;
      setErrorAds(msg);
      addToast?.(`No pude listar ad sets: ${msg}`, 'error');
    } finally {
      setLoadingAds(false);
    }
  };

  useEffect(() => { loadAdAccounts(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!form.adAccountId) { setCampaigns([]); return; }
    loadCampaigns(form.adAccountId);
    /* eslint-disable-next-line */
  }, [form.adAccountId]);
  useEffect(() => {
    if (!form.campaignId) { setAdsets([]); return; }
    loadAdsets(form.campaignId);
    /* eslint-disable-next-line */
  }, [form.campaignId]);

  const verifyIgUrl = async () => {
    if (!form.igUrl) return;
    setVerifying(true);
    setIgError(null);
    setIgVerified(false);
    try {
      const r = await fetch(`/api/meta/resolve-ig-url?ig_url=${encodeURIComponent(form.igUrl)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'error');
      patch({
        igUsername: d.username,
        igUserId: d.igUserId,
        pageId: d.pageId,
      });
      setIgVerified(true);
      addToast?.(`Resuelto @${d.username} (Page: ${d.pageName})`, 'success');
    } catch (err) {
      setIgError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = () => {
    if (!form.name.trim()) { addToast?.('Falta el nombre', 'error'); return; }
    if (!form.adAccountId) { addToast?.('Falta la cuenta publicitaria', 'error'); return; }
    if (!form.campaignId) { addToast?.('Falta la campaña', 'error'); return; }
    if (!form.baseAdsetId) { addToast?.('Falta el ad set base', 'error'); return; }
    if (!igVerified || !form.igUserId || !form.pageId) {
      addToast?.('Verificá la URL de Instagram antes de guardar', 'error');
      return;
    }
    // Completar los nombres humanos que no siempre vienen del state.
    const acc = adAccounts.find(a => a.id === form.adAccountId);
    const cmp = campaigns.find(c => c.id === form.campaignId);
    const ads = adsets.find(a => a.id === form.baseAdsetId);
    onSave({
      ...form,
      adAccountName: acc?.name || form.adAccountName,
      campaignName: cmp?.name || form.campaignName,
      baseAdsetName: ads?.name || form.baseAdsetName,
      threshold: Number(form.threshold) || 50,
      pinnedPosts: Number(form.pinnedPosts) || 0,
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onCancel}
          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white shadow-sm">
          <Instagram size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {initial.id ? 'Editar automatización' : 'Nueva automatización'}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Definí dónde aplicar la renovación y cuál es el Instagram de referencia.
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-5">
        <Field label="Nombre">
          <input
            type="text"
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Ej. Renovación diaria Skinfinity"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
          />
        </Field>

        <Field label="Cuenta publicitaria">
          {loadingAccs ? (
            <Spinner />
          ) : errorAccs ? (
            <ErrorLine msg={errorAccs} onRetry={loadAdAccounts} />
          ) : (
            <SearchableSelect
              value={form.adAccountId}
              onChange={(val, option) => patch({ adAccountId: val, adAccountName: option?.label || '', campaignId: '', baseAdsetId: '' })}
              options={adAccounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
              placeholder="— Elegí una —"
              searchPlaceholder="Buscar por nombre o moneda…"
              emptyMessage="No hay cuentas que matcheen."
            />
          )}
        </Field>

        <Field label="Campaña">
          {!form.adAccountId ? (
            <div className="text-xs text-gray-400 italic">Primero elegí la cuenta.</div>
          ) : loadingCmp ? <Spinner /> : errorCmp ? (
            <ErrorLine msg={errorCmp} onRetry={() => loadCampaigns(form.adAccountId)} />
          ) : (
            <SearchableSelect
              value={form.campaignId}
              onChange={(val, option) => patch({ campaignId: val, campaignName: option?.label || '', baseAdsetId: '' })}
              options={campaigns.map(c => ({ value: c.id, label: `${c.name} · ${c.objective} · ${c.effectiveStatus}` }))}
              placeholder="— Elegí una —"
              searchPlaceholder="Buscar por nombre, objective o status…"
              emptyMessage="No hay campañas que matcheen."
            />
          )}
        </Field>

        <Field label="Ad set base (el que se va a duplicar)">
          {!form.campaignId ? (
            <div className="text-xs text-gray-400 italic">Primero elegí la campaña.</div>
          ) : loadingAds ? <Spinner /> : errorAds ? (
            <ErrorLine msg={errorAds} onRetry={() => loadAdsets(form.campaignId)} />
          ) : (
            <SearchableSelect
              value={form.baseAdsetId}
              onChange={(val, option) => patch({ baseAdsetId: val, baseAdsetName: option?.label || '' })}
              options={adsets.map(s => ({ value: s.id, label: `${s.name} · ${s.effectiveStatus}` }))}
              placeholder="— Elegí uno —"
              searchPlaceholder="Buscar por nombre o status…"
              emptyMessage="No hay ad sets que matcheen."
            />
          )}
        </Field>

        <Field label="URL de Instagram (perfil público)">
          <div className="flex gap-2">
            <input
              type="text"
              value={form.igUrl}
              onChange={(e) => { patch({ igUrl: e.target.value }); setIgVerified(false); setIgError(null); }}
              placeholder="https://www.instagram.com/miusername/"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
            <button
              onClick={verifyIgUrl}
              disabled={verifying || !form.igUrl}
              className="px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-1"
            >
              {verifying ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Verificar
            </button>
          </div>
          {igVerified && form.igUsername && (
            <div className="mt-2 text-xs flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Check size={12} /> Resuelto a <span className="font-mono">@{form.igUsername}</span> (Page ID {form.pageId})
            </div>
          )}
          {igError && (
            <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{igError}</div>
          )}
          <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
            La cuenta de IG tiene que estar convertida a Business y linkeada a una Page de tu Business Manager.
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Umbral de likes (para pausar viejos)">
            <input
              type="number" min="0"
              value={form.threshold}
              onChange={(e) => patch({ threshold: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
          </Field>
          <Field label="Posts fijados a saltear">
            <input
              type="number" min="0" max="10"
              value={form.pinnedPosts}
              onChange={(e) => patch({ pinnedPosts: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
          </Field>
        </div>

        <Field label="Webhook Discord (opcional)">
          <input
            type="text"
            value={form.webhookUrl}
            onChange={(e) => patch({ webhookUrl: e.target.value })}
            placeholder="https://discord.com/api/webhooks/..."
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/40 inline-flex items-center gap-2"
        >
          <X size={14} /> Cancelar
        </button>
        <button
          onClick={handleSubmit}
          className="px-4 py-2 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 inline-flex items-center gap-2"
        >
          <Check size={14} /> Guardar
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <Loader2 size={14} className="animate-spin" /> Cargando…
    </div>
  );
}

function ErrorLine({ msg, onRetry }) {
  return (
    <div className="flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <div>{msg}</div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20"
          >
            <RefreshCw size={11} /> Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

// Select buscable — input arriba para filtrar + lista desplegable clickeable.
// No trae una lib aparte; es una combobox artesanal.
function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, emptyMessage }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find(o => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Cerrar al clickear afuera.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (!containerRef.current?.contains(e.target)) {
        setOpen(false); setQuery('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  const pick = (opt) => {
    onChange(opt.value, opt);
    setOpen(false); setQuery('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-left flex items-center justify-between gap-2 ${
          selected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'
        }`}
      >
        <span className="truncate">{selected?.label || placeholder}</span>
        <ChevronDown size={14} className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder || 'Buscar…'}
                className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                {emptyMessage || 'Sin resultados.'}
              </div>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => pick(opt)}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                    opt.value === value ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-300' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {opt.value === value ? <Check size={12} className="shrink-0" /> : <span className="w-3 shrink-0" />}
                  <span className="truncate">{opt.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
