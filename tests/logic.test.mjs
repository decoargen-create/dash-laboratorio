// Tests de la LÓGICA pura de Producción. Importan el CÓDIGO REAL que se shipea
// (src/produccionCalc.js + api/produccion/_naming.js), no una copia — así si
// alguien cambia un cálculo o la nomenclatura, estos tests lo agarran.
//
// Corré con:  node tests/logic.test.mjs   (o  npm test)
// No prueba UI ni red; prueba que los cálculos/nomenclatura den lo esperado.

import {
  PAGO_POR_PRODUCTO, VIDEOS_POR_PRODUCTO, DEFAULT_BONUS_TRAMOS,
  bonusObjetivo, pagoProductoDeCfg, bonusDeCfg,
  numerarDuplicados, resumenVideosPorProducto,
  columnaEfectiva, AUTO_ARCHIVE_MS,
} from '../src/produccionCalc.js';
import {
  clean, abreviarProducto, shortId, cardFolderName, finalFileName,
  nombreBase, nombrePublicado,
} from '../api/produccion/_naming.js';
import { parseFunnel, deriveFunnelRates, pickAction } from '../api/meta/_funnel.js';
import { repararTarjetas, carpetaDestinoDe } from '../api/produccion/_repair-core.js';

let pass = 0, fail = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n       esperado: ${e}\n       obtuve:   ${g}`); }
};

// ─────────── PAGO POR PERSONA ───────────
console.log('\nPAGO POR PERSONA:');
eq('sin config → default $42k', pagoProductoDeCfg(null), PAGO_POR_PRODUCTO);
eq('Poncio $40k', pagoProductoDeCfg({ pagoProducto: 40000 }), 40000);
eq('bono default con 5 completos = 36k', bonusDeCfg(null, 5), 36000);
eq('bono default con 2 = 0', bonusDeCfg(null, 2), 0);
eq('bonusObjetivo escalonado (3→24k, 4→30k, 5→36k)', [bonusObjetivo(3), bonusObjetivo(4), bonusObjetivo(5)], [24000, 30000, 36000]);
eq('Poncio SIN bono (tramos vacíos) = 0', bonusDeCfg({ pagoProducto: 40000, bonusTramos: [] }, 5), 0);
eq('Panchito bono tramos: 4 completos = 30k', bonusDeCfg({ pagoProducto: 42000, bonusTramos: DEFAULT_BONUS_TRAMOS }, 4), 30000);
eq('tramos propios: cada 2 → $10k, con 3 = 10k', bonusDeCfg({ bonusTramos: [{ min: 2, monto: 10000 }] }, 3), 10000);
// Ganado del mes: Poncio 3 completos (40k) sin bono vs Panchito 4 (42k) + 30k
eq('Poncio ganado (3 compl, sin bono)', 3 * pagoProductoDeCfg({ pagoProducto: 40000 }) + bonusDeCfg({ pagoProducto: 40000, bonusTramos: [] }, 3), 120000);
eq('Panchito ganado (4 compl + bono)', 4 * pagoProductoDeCfg({ pagoProducto: 42000 }) + bonusDeCfg({ pagoProducto: 42000, bonusTramos: DEFAULT_BONUS_TRAMOS }, 4), 198000);

// ─────────── NUMERAR DUPLICADOS ───────────
console.log('\nNUMERAR DUPLICADOS:');
const dupCards = [
  { id: 'a', productoNombre: 'Cepillo', persona: 'Fran', weekKey: '2026-08-17', createdAt: '2026-08-17T10:00' },
  { id: 'b', productoNombre: 'Cepillo', persona: 'Fran', weekKey: '2026-08-17', createdAt: '2026-08-17T11:00' },
  { id: 'c', productoNombre: 'Colageno', persona: 'Fran', weekKey: '2026-08-17', createdAt: '2026-08-17T10:00' },
];
eq('Fran con 2 Cepillo → #1 y #2', numerarDuplicados(dupCards), { a: 1, b: 2 });
eq('producto único NO se numera', numerarDuplicados([{ id: 'x', productoNombre: 'Solo', weekKey: '2026-08-17' }]), {});
// Mismo producto pero PERSONAS distintas → NO se numera (no son duplicados de una persona)
eq('Cepillo de Fran y de Wanda NO se numeran', numerarDuplicados([
  { id: 'a', productoNombre: 'Cepillo', persona: 'Fran', weekKey: '2026-08-17' },
  { id: 'b', productoNombre: 'Cepillo', persona: 'Wanda', weekKey: '2026-08-17' },
]), {});

// ─────────── RESUMEN VIDEOS POR PRODUCTO ───────────
console.log('\nVIDEOS + TARJETAS POR PRODUCTO:');
const vpCards = [
  { productoNombre: 'Cepillo Drenaje Linfatico', estado: 'porhacer', archivos: [{}] },   // 1 video, no entregada
  { productoNombre: 'Cepillo Drenaje Linfatico', estado: 'porhacer', archivos: [] },      // 0 video, no entregada
];
eq('2 tarjetas Cepillo: 1/18 videos, 0/2 entregadas', resumenVideosPorProducto(vpCards)[0], { producto: 'Cepillo Drenaje Linfatico', subidos: 1, target: 2 * VIDEOS_POR_PRODUCTO, tarjetas: 2, entregadas: 0, faltan: 2 * VIDEOS_POR_PRODUCTO - 1, pendientes: 2 });
// Entregadas = publicadas; pendientes = el resto (aprobado todavía "falta entregar")
const kit = [
  { productoNombre: 'Kit Inicial', estado: 'publicado', archivos: [] },
  { productoNombre: 'Kit Inicial', estado: 'aprobado', archivos: [] },
  { productoNombre: 'Kit Inicial', estado: 'porhacer', archivos: [] },
];
eq('Kit Inicial: 3 tarjetas, 1 entregada, 2 pendientes', (({ tarjetas, entregadas, pendientes }) => ({ tarjetas, entregadas, pendientes }))(resumenVideosPorProducto(kit)[0]), { tarjetas: 3, entregadas: 1, pendientes: 2 });
// Archivado también cuenta como entregada
eq('archivado cuenta como entregada', resumenVideosPorProducto([{ productoNombre: 'X', estado: 'archivado', archivos: [] }])[0].entregadas, 1);

// ─────────── AUTO-ARCHIVO (publicado +48h) ───────────
console.log('\nAUTO-ARCHIVO:');
const now = 1_000_000_000_000;
const pubHace = (ms) => ({ estado: 'publicado', historial: [{ tipo: 'estado', to: 'publicado', ts: new Date(now - ms).toISOString() }] });
eq('publicado hace 10h → sigue en publicado', columnaEfectiva(pubHace(10 * 3600e3), now), 'publicado');
eq('publicado hace 49h → archivado', columnaEfectiva(pubHace(49 * 3600e3), now), 'archivado');
eq('justo en 48h → todavía publicado (no supera)', columnaEfectiva(pubHace(AUTO_ARCHIVE_MS), now), 'publicado');
eq('estado archivado → archivado', columnaEfectiva({ estado: 'archivado' }, now), 'archivado');
eq('en revisión → revisión (no lo toca)', columnaEfectiva({ estado: 'revision' }, now), 'revision');

// ─────────── NOMENCLATURA DRIVE ───────────
console.log('\nNOMENCLATURA DRIVE:');
eq('abreviar "Cepillo Drenaje Linfatico" → CDL', abreviarProducto('Cepillo Drenaje Linfatico'), 'CDL');
eq('abreviar salta conectores "Crema de la Noche" → CN', abreviarProducto('Crema de la Noche'), 'CN');
eq('abreviar 1 palabra "Colageno" → Colageno', abreviarProducto('Colageno'), 'Colageno');
eq('shortId prodasig-…-vdagn → vdagn', shortId('prodasig-1787025026325-vdagn'), 'vdagn');
eq('cardFolder sin cardId (convención vieja)', cardFolderName('Cepillo Facial', 'Francisco', '2026-08-13'), 'Cepillo Facial [Francisco][13-8]');
eq('cardFolder sin persona → [Equipo]', cardFolderName('Colageno', '', '2026-08-05'), 'Colageno [Equipo][5-8]');
// UNA CARPETA POR TARJETA: dos tarjetas del mismo producto + misma persona +
// misma semana son entregas DISTINTAS (el tablero las numera #1/#2). Antes
// generaban el mismo nombre y Drive las fusionaba: 9 + 9 = 18 videos juntos.
eq('cardFolder con cardId lleva el token de la tarjeta',
  cardFolderName('Cepillo Facial', 'Francisco', '2026-08-13', 'prodasig-1787025026325-vdagn'),
  'Cepillo Facial [Francisco][13-8][vdagn]');
const carpetaA = cardFolderName('Cepillo Facial', 'Francisco', '2026-08-13', 'prodasig-1787025026325-vdagn');
const carpetaB = cardFolderName('Cepillo Facial', 'Francisco', '2026-08-13', 'prodasig-1787025099999-k2m7p');
eq('dos tarjetas iguales NO comparten carpeta', carpetaA !== carpetaB, true);
eq('la misma tarjeta siempre da la misma carpeta (estable entre probe y subida)',
  cardFolderName('Cepillo Facial', 'Francisco', '2026-08-13', 'prodasig-1787025026325-vdagn'), carpetaA);
// El sufijo PUBLICADO sigue siendo idempotente sobre el nombre nuevo.
eq('PUBLICADO sobre la carpeta con token', nombrePublicado(carpetaA, true), 'Cepillo Facial [Francisco][13-8][vdagn] PUBLICADO');
eq('despublicar vuelve al nombre exacto', nombrePublicado(nombrePublicado(carpetaA, true), false), carpetaA);
eq('clean saca caracteres inválidos', clean('Ana/Bea:1'), 'Ana Bea 1');
// finalFileName con reloj inyectado (17:05:30 UTC = 14:05:30 AR) → determinista
const fixed = new Date('2026-08-17T17:05:30Z');
eq('finalFileName "Fran - 2026-08-17 14.05.30 - CDL.mp4"', finalFileName('clip.MP4', 'Cepillo Drenaje Linfatico', 'Fran', fixed), 'Fran - 2026-08-17 14.05.30 - CDL.mp4');

// ─────────── RENOMBRE PUBLICADO (idempotente, sin guion) ───────────
console.log('\nRENOMBRE PUBLICADO:');
const cf = 'Cepillo Facial [Francisco][13-8]';
eq('agregar PUBLICADO', nombrePublicado(cf, true), `${cf} PUBLICADO`);
eq('sacar PUBLICADO', nombrePublicado(`${cf} PUBLICADO`, false), cf);
eq('re-publicar NO duplica sufijo', nombrePublicado(`${cf} PUBLICADO`, true), `${cf} PUBLICADO`);
eq('nombreBase saca convención vieja "— PUBLICADO"', nombreBase(`${cf} — PUBLICADO`), cf);


// ─────────── EMBUDO DE COMPRA (Meta insights) ───────────
console.log('\nEMBUDO DE COMPRA:');
// Fila cruda como la devuelve Meta en {account}/insights?level=campaign.
const filaMeta = {
  campaign_id: '123', campaign_name: 'Test', spend: '500', impressions: '100000',
  clicks: '2000', ctr: '2', cpc: '0.25', cpm: '5', reach: '80000', frequency: '1.25',
  inline_link_clicks: '1000',
  actions: [
    { action_type: 'link_click', value: '1000' },
    { action_type: 'landing_page_view', value: '800' },
    { action_type: 'add_to_cart', value: '200' },
    { action_type: 'offsite_conversion.fb_pixel_add_to_cart', value: '190' },
    { action_type: 'initiate_checkout', value: '50' },
    { action_type: 'purchase', value: '25' },
  ],
  action_values: [{ action_type: 'purchase', value: '2000' }],
};
const f = parseFunnel(filaMeta);
eq('pasos del embudo', [f.linkClicks, f.landingPageViews, f.addToCart, f.initiateCheckout, f.purchases], [1000, 800, 200, 50, 25]);
eq('add_to_cart NO suma el alias del pixel (se solapan)', f.addToCart, 200);
eq('revenue sale de action_values', f.revenue, 2000);
eq('ROAS = 2000/500', f.roas, 4);
eq('CPA = 500/25', f.cpa, 20);
eq('ticket promedio = 2000/25', f.aov, 80);
eq('CTR de enlace = 1000/100000', f.linkCtr, 1);
eq('% que carga la landing = 800/1000', f.lpvRate, 80);
eq('% carrito = 200/800', f.atcRate, 25);
eq('conversión global = 25/1000', f.conversionRate, 2.5);
eq('costo por click al enlace = 500/1000', f.costPerLinkClick, 0.5);
// Sin datos no explota ni divide por cero.
const vacio = parseFunnel({ spend: '0', impressions: '0' });
eq('cuenta sin actividad → ceros, no NaN', [vacio.roas, vacio.cpa, vacio.conversionRate, vacio.linkCtr], [0, 0, 0, 0]);
eq('parseFunnel(null) → null', parseFunnel(null), null);
// Alias: si no viene el genérico, cae al del pixel.
eq('cae al alias del pixel cuando falta el genérico',
  pickAction([{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '7' }], ['purchase', 'offsite_conversion.fb_pixel_purchase']), 7);
// Los totales de la cuenta se recalculan sobre las SUMAS (no promedian ratios):
// dos campañas, una gasta 100 y trae 1 compra, otra gasta 900 y trae 29.
const totales = deriveFunnelRates({ spend: 1000, impressions: 200000, linkClicks: 2000, landingPageViews: 1500, addToCart: 300, initiateCheckout: 90, purchases: 30, revenue: 5000 });
eq('CPA de la cuenta = 1000/30', Number(totales.cpa.toFixed(2)), 33.33);
eq('ROAS de la cuenta = 5000/1000', totales.roas, 5);
eq('conversión de la cuenta = 30/2000', totales.conversionRate, 1.5);


// ─────────── REPARAR CARPETAS DE DRIVE ───────────
console.log('\nREPARAR CARPETAS:');
// Drive falso: un árbol de carpetas en memoria + archivos con sus padres.
// Reproduce el escenario real: dos tarjetas del mismo producto/persona/semana
// cuyos 18 videos terminaron todos en la MISMA carpeta compartida.
function driveFake() {
  const carpetas = new Map(); // id → { parent, name }
  const archivos = new Map(); // id → { name, parents, trashed }
  let seq = 0;
  const nuevaCarpeta = (parent, name) => {
    const id = `f${++seq}`;
    carpetas.set(id, { parent, name });
    return id;
  };
  const buscar = (parent, name) => {
    for (const [id, f] of carpetas) if (f.parent === parent && f.name === name) return id;
    return null;
  };
  return {
    rootId: 'root',
    llamadas: { move: 0, create: 0 },
    carpetas, archivos, nuevaCarpeta,
    async findFolder(parent, name) { return buscar(parent, name); },
    async ensureFolder(parent, name) {
      const hit = buscar(parent, name);
      if (hit) return hit;
      this.llamadas.create++;
      return nuevaCarpeta(parent, name);
    },
    async fileInfo(id) {
      const f = archivos.get(id);
      if (!f) throw new Error('no existe');
      return { id, name: f.name, parents: f.parents, trashed: !!f.trashed };
    },
    async moveFile(id, fromParents, toParent) {
      this.llamadas.move++;
      const f = archivos.get(id);
      f.parents = [toParent, ...(fromParents || []).filter(p => p !== toParent)]
        .filter((p, i, arr) => arr.indexOf(p) === i && p === toParent);
    },
  };
}

// Escenario: carpeta compartida con los videos de DOS tarjetas.
const d = driveFake();
const fProd = d.nuevaCarpeta('root', 'Cepillo Facial');
const fPers = d.nuevaCarpeta(fProd, 'Panchito');
const fCompartida = d.nuevaCarpeta(fPers, 'Cepillo Facial [Panchito][22-8]'); // nombre viejo
const tarjetaA = { id: 'prodasig-1-aaaaa', productoNombre: 'Cepillo Facial', persona: 'Panchito', weekKey: '2026-08-22', driveIds: [] };
const tarjetaB = { id: 'prodasig-2-bbbbb', productoNombre: 'Cepillo Facial', persona: 'Panchito', weekKey: '2026-08-22', driveIds: [] };
for (let i = 1; i <= 9; i++) {
  d.archivos.set(`a${i}`, { name: `A${i}.mp4`, parents: [fCompartida] });
  tarjetaA.driveIds.push(`a${i}`);
  d.archivos.set(`b${i}`, { name: `B${i}.mp4`, parents: [fCompartida] });
  tarjetaB.driveIds.push(`b${i}`);
}

// 1) dryRun no toca NADA.
const previo = await repararTarjetas([tarjetaA, tarjetaB], { drive: d, dryRun: true });
eq('dryRun cuenta los 18 videos a mover', previo.totales.mover, 18);
eq('dryRun no mueve ningún archivo', d.llamadas.move, 0);
eq('dryRun no crea carpetas', d.llamadas.create, 0);
eq('dryRun no reporta movidos', previo.totales.movidos, 0);

// 2) La reparación de verdad: cada tarjeta a su carpeta.
const hecho = await repararTarjetas([tarjetaA, tarjetaB], { drive: d, dryRun: false });
eq('movió los 18', hecho.totales.movidos, 18);
eq('sin errores', hecho.totales.errores, 0);
const destinoA = hecho.cards[0].folderId, destinoB = hecho.cards[1].folderId;
eq('cada tarjeta quedó en SU carpeta', destinoA !== destinoB, true);
eq('los 9 de la tarjeta A están en la carpeta A',
  tarjetaA.driveIds.every(id => d.archivos.get(id).parents.join() === destinoA), true);
eq('los 9 de la tarjeta B están en la carpeta B',
  tarjetaB.driveIds.every(id => d.archivos.get(id).parents.join() === destinoB), true);
eq('la carpeta compartida ya no es padre de nadie',
  [...d.archivos.values()].some(f => f.parents.includes(fCompartida)), false);
eq('las carpetas nuevas cuelgan de <Producto>/<Persona>', d.carpetas.get(destinoA).parent, fPers);

// 3) Idempotencia: correrlo de nuevo no mueve nada.
const antes = d.llamadas.move;
const otraVez = await repararTarjetas([tarjetaA, tarjetaB], { drive: d, dryRun: false });
eq('segunda corrida: nada para mover', otraVez.totales.mover, 0);
eq('segunda corrida: los 18 ya están ok', otraVez.totales.yaOk, 18);
eq('segunda corrida: cero llamadas de movimiento', d.llamadas.move - antes, 0);

// 4) Un archivo borrado de Drive no frena al resto.
d.archivos.get('a3').trashed = true;
d.archivos.get('a5').parents = [fCompartida]; // volvió a la carpeta vieja
const conBasura = await repararTarjetas([tarjetaA], { drive: d, dryRun: false });
eq('saltea el de la papelera y mueve el resto', conBasura.totales.movidos, 1);
eq('reporta el archivo en papelera', conBasura.cards[0].errores.length, 1);

// 5) Una tarjeta publicada apunta a la carpeta con el sufijo.
eq('la carpeta destino de una publicada lleva PUBLICADO',
  carpetaDestinoDe({ ...tarjetaA, published: true }),
  'Cepillo Facial [Panchito][22-8][aaaaa] PUBLICADO');

// ─────────── RESUMEN ───────────
console.log(`\n${'─'.repeat(40)}\nRESULTADO: ${pass} ✅   ${fail} ❌\n`);
process.exit(fail === 0 ? 0 : 1);
