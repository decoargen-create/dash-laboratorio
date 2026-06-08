// Store global de ejecuciones — operaciones largas que el usuario disparó
// y que están corriendo en background. El ExecutionsTray los muestra como
// cards con barra de progreso, elapsed y stage.
//
// Cualquier endpoint que tarda más de ~5s debería instrumentarse con esto
// para que el user sepa que algo está corriendo y cuánto le falta.
//
// API:
//   const id = startExecution({ label, sublabel, kind, estimatedMs })
//   updateExecution(id, { stage, progress })   // opcional — progress 0-100
//   finishExecution(id, { ok, message })       // ok=true/false
//   subscribeExecutions(fn) → unsubscribe
//   getExecutions() → array
//
// El progreso es estimado con curva asintótica si el caller no pasa progress
// real (porque la mayoría de los endpoints no streamean). Curva: 92% asintota
// a τ=estimatedMs/2.

const executions = new Map();
const listeners = new Set();
let seq = 0;

function emit() {
  const snapshot = Array.from(executions.values());
  listeners.forEach(fn => {
    try { fn(snapshot); } catch {}
  });
}

export function startExecution({ label, sublabel, kind, estimatedMs, estimatedCost }) {
  const id = `exec_${Date.now()}_${++seq}`;
  executions.set(id, {
    id,
    label: label || 'Ejecutando…',
    sublabel: sublabel || '',
    kind: kind || 'generic',
    startedAt: Date.now(),
    estimatedMs: estimatedMs || 30000,
    estimatedCost: estimatedCost || 0,  // USD, opcional — para mostrar pre-cálculo
    cost: 0,                            // USD acumulado real (se setea en finish)
    stage: '',
    progress: null, // null → estimar; número 0-100 → usar literal
    status: 'running',
    finishedAt: null,
    message: '',
  });
  emit();
  return id;
}

export function updateExecution(id, patch) {
  const exec = executions.get(id);
  if (!exec) return;
  Object.assign(exec, patch);
  emit();
}

export function finishExecution(id, { ok = true, message = '', cost = 0 } = {}) {
  const exec = executions.get(id);
  if (!exec) return;
  exec.status = ok ? 'done' : 'error';
  exec.finishedAt = Date.now();
  exec.message = message;
  exec.cost = Number(cost) || 0;
  emit();

  // Persiste en activityLog para que el user lo pueda revisar después.
  // Import dinámico para evitar dependencia circular si algún día activityLog
  // necesita algo del executionsStore.
  import('./activityLogStore.js').then(mod => {
    try {
      mod.logActivity({
        id: exec.id,
        label: exec.label,
        sublabel: exec.sublabel,
        kind: exec.kind,
        status: exec.status,
        message: exec.message,
        cost: exec.cost,
        durationMs: (exec.finishedAt || Date.now()) - exec.startedAt,
        finishedAt: new Date(exec.finishedAt).toISOString(),
      });
    } catch {}
  }).catch(() => {});

  // Auto-dismiss después de 3s si OK, 12s si error (le da tiempo al user
  // a leer el mensaje). El user igual puede cerrarlo manual desde el tray.
  setTimeout(() => {
    if (executions.get(id)?.status === (ok ? 'done' : 'error')) {
      executions.delete(id);
      emit();
    }
  }, ok ? 3000 : 12000);
}

export function dismissExecution(id) {
  if (executions.delete(id)) emit();
}

export function subscribeExecutions(fn) {
  listeners.add(fn);
  try { fn(Array.from(executions.values())); } catch {}
  return () => listeners.delete(fn);
}

export function getExecutions() {
  return Array.from(executions.values());
}

// Helper: curva asintótica de progreso para ops sin streaming.
// elapsed/estimated → percent.
export function estimateProgress(exec) {
  if (!exec) return 0;
  if (exec.status === 'done') return 100;
  if (exec.status === 'error') return exec.progress ?? 0;
  if (typeof exec.progress === 'number') return Math.min(100, Math.max(0, exec.progress));
  const elapsed = Date.now() - exec.startedAt;
  const tau = Math.max(5000, (exec.estimatedMs || 30000) / 2);
  // Asintota hacia 92%, jumpea a 100 al finishExecution.
  return 92 * (1 - Math.exp(-elapsed / tau));
}
