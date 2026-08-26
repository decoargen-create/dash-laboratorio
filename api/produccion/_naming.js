// Nomenclatura PURA de Producción en Drive (sin red, sin estado). Vive acá para
// que las funciones serverless (drive-session, drive-rename) y los tests usen
// EXACTAMENTE el mismo código — así los tests prueban lo que se shipea y no una
// copia que puede quedar desincronizada.

export const TZ = 'America/Argentina/Buenos_Aires';

// Sufijo que marca una tarjeta publicada en el nombre de su carpeta, y el regex
// que lo detecta/saca (idempotente: acepta guion normal o em-dash).
export const SUFIJO_PUBLICADO = ' PUBLICADO';
// Detecta/saca el sufijo, con o sin guion (acepta convenciones viejas "— PUBLICADO").
export const RE_SUFIJO = /\s*(?:[—-]\s*)?PUBLICADO\s*$/i;

// Saca caracteres que rompen nombres de archivo/carpeta en Drive.
export function clean(s, fallback = '') {
  const t = String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || fallback;
}

// Abreviatura del producto para el nombre de archivo: iniciales de las palabras
// significativas (saltea conectores). La carpeta ya lleva el nombre completo, así
// que acá va corto y reconocible. Un producto de una sola palabra usa sus 1as
// letras. Ej: "Cepillo Drenaje Linfatico" → "CDL"; "Colageno" → "Colageno".
export function abreviarProducto(nombre) {
  const stop = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'por', 'a', 'en', 'the']);
  const words = clean(nombre, '').split(' ').filter(w => w && !stop.has(w.toLowerCase()));
  if (words.length === 0) return 'PROD';
  if (words.length === 1) return words[0].slice(0, 8);
  return words.slice(0, 4).map(w => w[0].toUpperCase()).join('');
}

// Token corto y estable a partir del id de la tarjeta, para que la carpeta de
// cada tarjeta sea única (dos tarjetas del mismo producto/persona/semana no
// pueden colisionar en el nombre).
export function shortId(cardId) {
  const s = String(cardId || '').replace(/[^a-zA-Z0-9]/g, '');
  return s.slice(-5) || 'x';
}

// Fecha de hoy (horario AR) → 'YYYY-MM-DD'. Acepta un `now` inyectable para que
// los tests sean deterministas; por defecto usa el reloj real.
export function hoyAR(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: TZ });
}

// Sello de subida en horario AR: 'YYYY-MM-DD HH.MM.SS' (fecha + hora con
// segundos, así dos videos del mismo minuto no colisionan en el nombre).
export function selloAR(now = new Date()) {
  const fecha = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const hora = now.toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${fecha} ${hora.replace(/:/g, '.')}`;
}

// Nomenclatura del archivo: "<Persona> - <fecha subida> - <Producto abreviado>".
// Autoexplicativo aunque el video se baje fuera de su carpeta (dice quién lo
// hizo, cuándo lo subió y de qué producto es). Ej:
// "Fran - 2026-08-17 14.05.30 - CDL.mp4".
export function finalFileName(filename, productoNombre, persona, now = new Date()) {
  const ext = (String(filename).split('.').pop() || 'mp4').toLowerCase().slice(0, 5);
  const per = clean(persona, 'Equipo');
  const abrev = abreviarProducto(productoNombre);
  return `${per} - ${selloAR(now)} - ${abrev}.${ext}`;
}

// Nombre de la carpeta de UNA tarjeta: "<Producto> [<Persona>][<d-m>][<id>]"
// (la convención del equipo — NO separada por semana). Es la que se renombra a
// "… PUBLICADO" cuando la tarjeta se publica. La fecha sale del weekKey (estable
// por tarjeta, así probe y subida coinciden y no se duplican carpetas); si no
// hay weekKey, usa la fecha de hoy.
//
// El token final es el shortId de la TARJETA y es lo que garantiza una carpeta
// por tarjeta. Sin él, dos tarjetas del mismo producto + misma persona + misma
// semana (que el tablero numera "#1 / #2" y son entregas distintas) generaban
// el MISMO nombre: driveEnsureFolder encontraba la carpeta existente y los 9
// videos de la segunda se apilaban sobre los 9 de la primera → 18 archivos en
// una sola carpeta, y publicar una renombraba la de las dos.
//
// Ej: "Cepillo Facial [Francisco][13-8][vdagn]".
//
// Sin cardId cae al nombre viejo (sin el token). Eso mantiene compatibles a las
// tarjetas que ya tienen carpeta creada con la convención anterior.
export function cardFolderName(productoNombre, persona, weekKey, cardId = null, now = new Date()) {
  const prod = clean(productoNombre, 'Producto');
  const per = clean(persona, 'Equipo');
  const fecha = (weekKey && /^\d{4}-\d{2}-\d{2}$/.test(weekKey)) ? weekKey : hoyAR(now);
  const [, m, d] = fecha.split('-');
  const base = `${prod} [${per}][${Number(d)}-${Number(m)}]`;
  return cardId ? `${base}[${shortId(cardId)}]` : base;
}

// Nombre base de una carpeta (sin el sufijo PUBLICADO). Idempotente.
export function nombreBase(nombre) {
  return String(nombre || '').replace(RE_SUFIJO, '').trimEnd();
}

// Aplica/saca el sufijo PUBLICADO sobre un nombre de carpeta, sin duplicarlo.
// published=true → "<base> PUBLICADO"; false → "<base>".
export function nombrePublicado(nombre, published) {
  const base = nombreBase(nombre);
  return published ? `${base}${SUFIJO_PUBLICADO}` : base;
}
