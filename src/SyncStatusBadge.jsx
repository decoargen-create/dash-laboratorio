// Indicador visible del estado de sincronización con la nube. Lee del
// syncStatusStore (que alimenta useMarketingSync). Da feedback claro de
// "guardando / guardado / error" — antes el sync era invisible y el user no
// se enteraba si un cambio no había llegado al cloud (causa de las PCs
// desincronizadas).

import React, { useEffect, useState } from 'react';
import { Loader2, Check, CloudOff } from 'lucide-react';
import { subscribeSyncStatus } from './syncStatusStore.js';

export default function SyncStatusBadge() {
  const [state, setState] = useState({ status: 'idle', lastError: null });
  // Mostramos "Guardado ✓" un ratito tras un push OK, después se desvanece.
  const [showOk, setShowOk] = useState(false);

  useEffect(() => subscribeSyncStatus(s => {
    setState(s);
    if (s.status === 'ok') {
      setShowOk(true);
      const t = setTimeout(() => setShowOk(false), 2500);
      return () => clearTimeout(t);
    }
  }), []);

  const { status, lastError } = state;

  if (status === 'pulling' || status === 'pushing') {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
        <Loader2 size={12} className="animate-spin" />
        {status === 'pulling' ? 'Sincronizando…' : 'Guardando…'}
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-300 cursor-help"
        title={`No se pudo guardar en la nube: ${lastError || 'error desconocido'}. Tus cambios quedaron en local — recargá para reintentar.`}
      >
        <CloudOff size={12} />
        Sin guardar
      </span>
    );
  }

  if (showOk) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 transition-opacity">
        <Check size={12} />
        Guardado
      </span>
    );
  }

  // idle / ok-ya-desvanecido → no mostramos nada (evita ruido visual).
  return null;
}
