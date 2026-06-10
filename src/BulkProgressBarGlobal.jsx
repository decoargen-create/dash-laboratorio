// Wrapper que renderiza el BulkProgressBar al nivel de App suscribiéndose
// al bulkProgressStore (global + localStorage). Esto resuelve dos UX issues:
//   1. La barra YA NO se pierde al cambiar de sección (Inspiración → Bandeja
//      → Galería, etc.)
//   2. Sobrevive a un refresh — el estado se re-hidrata del localStorage al
//      cargar, así que si el user F5 mientras corre un bulk, vuelve a verlo.
//
// La barra en sí (BulkProgressBar) está exportada desde InspiracionSection.jsx
// donde se diseñó originalmente. Acá solo es plumbing.

import React, { useEffect, useState } from 'react';
import BulkProgressBar from './BulkProgressBar.jsx';
import { subscribeBulk, clearBulk } from './bulkProgressStore.js';

export default function BulkProgressBarGlobal() {
  const [state, setState] = useState(null);
  const [, setTick] = useState(0);
  useEffect(() => subscribeBulk(setState), []);
  // Re-render cada 500ms si está corriendo, para que ETA / elapsed se actualicen.
  useEffect(() => {
    if (!state || state.finishedAt) return;
    const t = setInterval(() => setTick(x => x + 1), 500);
    return () => clearInterval(t);
  }, [state]);
  if (!state) return null;
  return <BulkProgressBar state={state} onClose={clearBulk} />;
}
