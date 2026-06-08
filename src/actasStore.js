// Repositorio de actas de consultoría, persistido en localStorage y agrupado
// por cliente. Cada acta guarda la transcripción original + el resultado de la
// IA, así se puede reabrir, re-descargar o borrar más tarde.

const KEY = 'adslab-actas-v1';

export function clientKeyOf(client) {
  const c = (client || '').trim();
  return c ? c.toLowerCase() : '__sin-cliente__';
}

export function loadActas() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch {}
}

// Inserta o actualiza (por id) un acta. Devuelve el registro guardado.
export function saveActa(record) {
  const actas = loadActas();
  const now = Date.now();
  const id = record.id || `a_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const full = {
    id,
    client: (record.client || '').trim(),
    clientKey: clientKeyOf(record.client),
    date: record.date || '',
    transcript: record.transcript || '',
    result: record.result || null,
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
  const idx = actas.findIndex(a => a.id === id);
  if (idx >= 0) actas[idx] = full;
  else actas.unshift(full);
  persist(actas);
  return full;
}

export function deleteActa(id) {
  persist(loadActas().filter(a => a.id !== id));
}

// Agrupa las actas por cliente, ordenadas: clientes con actividad más reciente
// primero; dentro de cada cliente, la más nueva arriba.
export function groupByClient(actas) {
  const map = new Map();
  for (const a of actas) {
    const key = a.clientKey || clientKeyOf(a.client);
    if (!map.has(key)) {
      map.set(key, { clientKey: key, client: a.client || 'Sin cliente', items: [] });
    }
    map.get(key).items.push(a);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.items.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
    g.lastUpdated = g.items[0]?.updatedAt || 0;
  }
  groups.sort((a, b) => b.lastUpdated - a.lastUpdated);
  return groups;
}
