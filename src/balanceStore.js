// Store de saldos cargados en Anthropic y OpenAI.
//
// Por qué local: ni Anthropic ni OpenAI exponen el balance restante vía API
// pública (requeriría admin keys + endpoints internos). Solución pragmática:
// el user ingresa el saldo que cargó + cuándo lo cargó → calculamos restante
// = saldo - sum(costs desde ese timestamp).
//
// Cada provider guarda: { saldo: USD, setAt: ISO }.
// El widget en el header pide actualización cuando el user recarga crédito.

import { spendSince } from './costsStore.js';

const KEY = 'viora-balances-v1';
const listeners = new Set();

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeAll(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  listeners.forEach(fn => { try { fn(data); } catch {} });
}

// Devuelve { saldo, setAt } o null si nunca se setearon.
export function getBalance(provider) {
  const all = readAll();
  return all[provider] || null;
}

// Setea el saldo cargado y resetea el timestamp a "ahora".
export function setBalance(provider, saldo) {
  const all = readAll();
  all[provider] = {
    saldo: Math.max(0, Number(saldo) || 0),
    setAt: new Date().toISOString(),
  };
  writeAll(all);
}

// Calcula saldo restante: saldoInicial - gastado desde setAt.
export function getRemaining(provider) {
  const b = getBalance(provider);
  if (!b) return null;
  const spent = spendSince(provider, b.setAt);
  return Math.max(0, b.saldo - spent);
}

// Suscripción para que el widget re-renderice cuando cambia el saldo o se
// loguea un costo nuevo.
export function subscribeBalance(fn) {
  listeners.add(fn);
  const onCost = () => { try { fn(readAll()); } catch {} };
  if (typeof window !== 'undefined') {
    window.addEventListener('viora:cost-logged', onCost);
  }
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') {
      window.removeEventListener('viora:cost-logged', onCost);
    }
  };
}
