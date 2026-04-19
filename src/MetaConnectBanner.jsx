// Banner compacto de conexión con Meta para la plataforma Marketing.
// Vive arriba de todas las secciones de Marketing (Documentación, Competencia,
// Gastos). Si estás conectado, muestra pill verde discreto. Si no, muestra
// CTA prominente con copy que explica por qué conectarse (leer ads propios +
// cruzar con competencia).
//
// Props:
//   returnTo: path al que volver después del OAuth (ej: /acceso?section=mk-competencia)

import React, { useState, useEffect, useCallback } from 'react';
import { Zap, Check, Loader2, ChevronRight } from 'lucide-react';

export default function MetaConnectBanner({ returnTo = '/acceso' }) {
  const [state, setState] = useState({ loading: true, connected: false, user: null });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/meta/me');
      const d = await r.json();
      setState({ loading: false, connected: !!d.connected, user: d.user || null });
    } catch {
      setState({ loading: false, connected: false, user: null });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleConnect = () => {
    window.location.href = `/api/meta/connect?returnTo=${encodeURIComponent(returnTo)}`;
  };

  if (state.loading) {
    return (
      <div className="mb-4 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-gray-400" />
        <span className="text-[11px] text-gray-500 dark:text-gray-400">Verificando conexión con Meta…</span>
      </div>
    );
  }

  if (state.connected) {
    return (
      <div className="mb-4 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <Check size={12} className="text-emerald-600 dark:text-emerald-400" />
        <p className="text-[11px] text-emerald-800 dark:text-emerald-200">
          <span className="font-semibold">Meta conectado</span>
          {state.user?.name && <> como <span className="font-semibold">{state.user.name}</span></>}
          {' · '}
          <span className="text-emerald-700 dark:text-emerald-300">Podemos leer tus campañas activas y cruzarlas con la competencia.</span>
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 px-4 py-3 bg-gradient-to-br from-blue-50 to-white dark:from-blue-900/20 dark:to-gray-800/60 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-3">
      <div className="shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-[#0668E1] to-[#1877F2] flex items-center justify-center text-white shadow-sm">
        <Zap size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Conectá tu cuenta publicitaria de Meta</p>
        <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
          Para leer tus creativos activos (CTR, ROAS, fatigue) y cruzarlos con los ganadores de la competencia. De ahí salen hipótesis mucho más afiladas.
        </p>
      </div>
      <button
        onClick={handleConnect}
        className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-md hover:from-[#0556BE] hover:to-[#1668D8] transition shadow-sm"
      >
        <Zap size={12} /> Conectar <ChevronRight size={12} />
      </button>
    </div>
  );
}
