// Lógica de la reparación de carpetas, separada del I/O.
//
// Recibe un adaptador `drive` con las 4 operaciones que necesita, así el
// endpoint le pasa el Drive real y los tests le pasan uno falso. Sin esto la
// única forma de probar "¿mueve lo que tiene que mover y deja quieto lo que ya
// está bien?" sería contra el Drive de verdad.
//
// drive = {
//   rootId,
//   ensureFolder(parentId, name) → id          (crea si no existe)
//   findFolder(parentId, name)   → id | null   (NO crea)
//   fileInfo(fileId)             → { id, name, parents, trashed }
//   moveFile(fileId, fromParents, toParent)
// }

import { clean, cardFolderName, nombrePublicado } from './_naming.js';

// Archivos en paralelo dentro de una tarjeta. 5 baja el tiempo de pared sin
// pasarse de la cuota por usuario de la API de Drive.
export const CONCURRENCIA = 5;

// map con concurrencia limitada, preservando el orden del resultado.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Nombre de la carpeta destino de una tarjeta (con el sufijo PUBLICADO si
// corresponde, para que quede igual que si hubiera nacido bien de entrada).
export function carpetaDestinoDe(card) {
  return nombrePublicado(
    cardFolderName(card.productoNombre, card.persona, card.weekKey, card.id),
    !!card.published,
  );
}

// Repara UNA tarjeta. En dryRun no crea ni mueve nada: solo cuenta.
export async function repararTarjeta(card, { drive, dryRun }) {
  const driveIds = (card.driveIds || []).filter(Boolean);
  const entry = { id: card.id, folderId: null, folderLink: null, mover: 0, yaOk: 0, movidos: 0, errores: [] };
  if (driveIds.length === 0) return entry;

  const destinoNombre = carpetaDestinoDe(card);

  try {
    // Ruta <raíz>/<Producto>/<Persona>/<carpeta de la tarjeta>.
    let destino;
    if (dryRun) {
      const prod = await drive.findFolder(drive.rootId, clean(card.productoNombre, 'Producto'));
      const per = prod ? await drive.findFolder(prod, clean(card.persona, 'Equipo')) : null;
      destino = per ? await drive.findFolder(per, destinoNombre) : null;
    } else {
      const prod = await drive.ensureFolder(drive.rootId, clean(card.productoNombre, 'Producto'));
      const per = await drive.ensureFolder(prod, clean(card.persona, 'Equipo'));
      destino = await drive.ensureFolder(per, destinoNombre);
    }
    entry.folderId = destino;
    entry.folderLink = destino ? `https://drive.google.com/drive/folders/${destino}` : null;

    const resultados = await mapLimit(driveIds, CONCURRENCIA, async (fileId) => {
      try {
        const info = await drive.fileInfo(fileId);
        if (info.trashed) return { error: `${info.name || fileId}: está en la papelera` };
        const parents = info.parents || [];
        // Ya está donde tiene que estar y en ningún otro lado.
        if (destino && parents.includes(destino) && parents.length === 1) return { yaOk: true };
        if (dryRun) return { mover: true };
        await drive.moveFile(fileId, parents, destino);
        return { mover: true, movido: true };
      } catch (e) {
        return { error: `${fileId}: ${e.message}` };
      }
    });
    for (const r of resultados) {
      if (r.error) entry.errores.push(r.error);
      if (r.yaOk) entry.yaOk++;
      if (r.mover) entry.mover++;
      if (r.movido) entry.movidos++;
    }
  } catch (e) {
    entry.errores.push(`carpeta: ${e.message}`);
  }
  return entry;
}

// Repara una tanda de tarjetas (secuencial: cada tarjeta ya paraleliza sus
// archivos) y devuelve el detalle + los totales.
export async function repararTarjetas(cards, { drive, dryRun }) {
  const out = [];
  for (const card of cards) out.push(await repararTarjeta(card, { drive, dryRun }));

  const totales = out.reduce((t, c) => ({
    tarjetas: t.tarjetas + 1,
    mover: t.mover + c.mover,
    yaOk: t.yaOk + c.yaOk,
    movidos: t.movidos + c.movidos,
    errores: t.errores + c.errores.length,
  }), { tarjetas: 0, mover: 0, yaOk: 0, movidos: 0, errores: 0 });

  return { cards: out, totales };
}
