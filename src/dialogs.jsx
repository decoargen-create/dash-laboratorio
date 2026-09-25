// API imperativa de diálogos + toasts, para reemplazar los popups crudos del
// navegador (window.confirm / window.prompt / window.alert) que se ven feos
// ("adslab.vercel.app dice…") y rompen la estética de la app.
//
// Uso (devuelven promesas, así el call-site casi no cambia):
//   if (await confirmDialog({ title: '¿Borrar?', tone: 'danger' })) { ... }
//   const nombre = await promptDialog({ title: 'Nuevo nombre', defaultValue: x });
//   if (nombre == null) return;               // canceló
//   await alertDialog({ title: 'Listo', message: '...' });  // un solo botón
//   toast({ type: 'success', message: '...' });             // no bloqueante
//
// Requiere <DialogHost/> montado una vez en el árbol (ya está en App.jsx).

import React, { useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';

// Cola de diálogos pendientes + un único suscriptor (el host montado).
let _idSeq = 0;
let _listener = null;
let _queue = [];

function emit() { if (_listener) _listener([..._queue]); }

function enqueue(opts) {
  return new Promise((resolve) => {
    _queue.push({ id: ++_idSeq, opts, resolve });
    emit();
  });
}

function settle(id, value) {
  const item = _queue.find(q => q.id === id);
  if (!item) return;
  _queue = _queue.filter(q => q.id !== id);
  emit();
  item.resolve(value);
}

// Confirmación → Promise<boolean> (true = confirmó, false = canceló/cerró).
export function confirmDialog({ title, message, confirmLabel, cancelLabel, tone = 'brand' } = {}) {
  return enqueue({ kind: 'confirm', title, message, confirmLabel, cancelLabel, tone });
}

// Entrada de texto → Promise<string|null> (null = canceló, igual que prompt()).
export function promptDialog({ title, message, defaultValue = '', placeholder, inputLabel, multiline = false, confirmLabel, tone = 'brand' } = {}) {
  return enqueue({ kind: 'prompt', title, message, defaultValue, placeholder, inputLabel, multiline, confirmLabel, tone });
}

// Aviso de un solo botón → Promise<void>. Para mensajes que conviene que el
// usuario lea sí o sí (ej. resumen de una descarga con fallos).
export function alertDialog({ title, message, confirmLabel = 'Entendido', tone = 'brand' } = {}) {
  return enqueue({ kind: 'alert', title, message, confirmLabel, tone });
}

// Toast global (no bloqueante). Para componentes que no reciben addToast por
// prop — el puente en App.jsx escucha 'viora:toast'.
export function toast(detail) {
  try { window.dispatchEvent(new CustomEvent('viora:toast', { detail })); } catch {}
}

// Host: renderiza el diálogo del frente de la cola. Montar UNA vez por rama de
// render (son mutuamente excluyentes, así que nunca hay dos activos a la vez).
export function DialogHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    _listener = setItems;
    setItems([..._queue]);
    return () => { _listener = null; };
  }, []);

  const cur = items[0];
  if (!cur) return null;
  const { id, opts } = cur;
  const isPrompt = opts.kind === 'prompt';
  const isAlert = opts.kind === 'alert';

  return (
    <ConfirmDialog
      open
      title={opts.title}
      message={opts.message}
      tone={opts.tone}
      confirmLabel={opts.confirmLabel || (isAlert ? 'Entendido' : 'Confirmar')}
      cancelLabel={opts.cancelLabel || 'Cancelar'}
      hideCancel={isAlert}
      withInput={isPrompt}
      inputLabel={opts.inputLabel}
      defaultValue={opts.defaultValue}
      placeholder={opts.placeholder}
      multiline={opts.multiline}
      onConfirm={(val) => settle(id, isPrompt ? (val ?? '') : true)}
      onClose={() => settle(id, isPrompt ? null : false)}
    />
  );
}
