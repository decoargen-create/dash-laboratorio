// Cliente para /api/marketing/boards — colecciones cross-producto de ads
// favoritos del user.

import { supabase } from './supabase.js';

async function authHeader() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
  } catch {
    return {};
  }
}

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
  const r = await fetch(`/api/marketing/boards${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export async function listBoards() {
  const { boards } = await call('GET', '');
  return boards || [];
}

export async function listBoardItems(boardId) {
  const { items } = await call('GET', `?id=${encodeURIComponent(boardId)}&items`);
  return items || [];
}

export async function createBoard({ nombre, descripcion, color, icon }) {
  const { board } = await call('POST', '', { nombre, descripcion, color, icon });
  return board;
}

export async function updateBoard(boardId, patch) {
  const { board } = await call('PATCH', `?id=${encodeURIComponent(boardId)}`, patch);
  return board;
}

export async function deleteBoard(boardId) {
  return call('DELETE', `?id=${encodeURIComponent(boardId)}`);
}

export async function addItemsToBoard(boardId, items) {
  return call('POST', `?id=${encodeURIComponent(boardId)}&items`, { items });
}

export async function removeItemFromBoard(boardId, adId) {
  return call('DELETE', `?id=${encodeURIComponent(boardId)}&adId=${encodeURIComponent(adId)}`);
}
