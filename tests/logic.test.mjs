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
  clean, abreviarProducto, shortId, cardFolderName,
  nombreBase, nombrePublicado,
} from '../api/produccion/_naming.js';
import { parseFunnel, deriveFunnelRates, pickAction } from '../api/meta/_funnel.js';
import { validarPedido, mismaCuenta, resumirResultados, inverso, estadoVisible, entregaDe, MAX_IDS } from '../api/meta/_estado.js';
import { repararTarjetas, carpetaDestinoDe } from '../api/produccion/_repair-core.js';
import {
  CFG_DEFAULT, cfgPara, roasBreakeven, fechaDelNombre, lunesDe, tipoDeCampana,
  productoDeCampana, veredicto, cohortesSemanales, esProspectador,
  rondaDeOptimizacion, promediosDelDia, linkMeta, evaluarPausa, CONDICIONES_PAUSA,
  semanaMadura, fusionarConFotos, cohortesParaCongelar, fotoDeCohorte,
} from '../src/testeosCore.js';
import { DEMO } from '../src/testeosDemo.js';

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
  { id: 'c', productoNombre: 'Colageno', persona: 'Fran', weekKey: '2026-08-17', createdAt: '2026-08-17T12:00' },
];
// Ahora numera TODAS las tarjetas de una persona en la semana (sin importar el
// producto), por orden de creación → Fran 1, 2, 3.
eq('Fran con 3 tarjetas → 1,2,3 por persona', numerarDuplicados(dupCards), { a: 1, b: 2, c: 3 });
eq('una sola tarjeta de la persona NO se numera', numerarDuplicados([{ id: 'x', productoNombre: 'Solo', persona: 'Fran', weekKey: '2026-08-17' }]), {});
eq('sin persona NO se numera', numerarDuplicados([{ id: 'x', productoNombre: 'Solo', weekKey: '2026-08-17' }]), {});
// PERSONAS distintas, 1 tarjeta cada una → NO se numera (cada una es única)
eq('Fran y Wanda con 1 c/u NO se numeran', numerarDuplicados([
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


// ─────────── TESTEOS: nomenclatura ───────────
console.log('\nTESTEOS · NOMENCLATURA:');
const HOY = DEMO.hoy;
eq('fecha "Cepillo 22/8 [CBO Videos]"', fechaDelNombre('Cepillo 22/8 [CBO Videos]', HOY), '2026-08-22');
eq('fecha "Cepillo 27/7 [ABO BIDCAP 25 a 35]" (ignora el rango de edad)', fechaDelNombre('Cepillo 27/7 [ABO BIDCAP 25 a 35]', HOY), '2026-07-27');
eq('fecha "Cepillo 5/8 [ABO Costcap 15 a 24]"', fechaDelNombre('Cepillo 5/8 [ABO Costcap 15 a 24]', HOY), '2026-08-05');
eq('fecha con año "Crema 15.8.26"', fechaDelNombre('Crema 15.8.26', HOY), '2026-08-15');
eq('sin fecha → null', fechaDelNombre('Crema [ABO BIDCAP 29 A 39]', HOY), null);
eq('31/2 no existe → null', fechaDelNombre('Cepillo 31/2', HOY), null);
// Un "28/12" mirado en enero es de diciembre PASADO, no del que viene.
eq('sin año, no salta al futuro', fechaDelNombre('Cepillo 28/12', new Date('2027-01-10T12:00:00Z')), '2026-12-28');
eq('semana lunes-domingo: 22/8 (sábado) → lunes 17/8', lunesDe('2026-08-22'), '2026-08-17');
eq('lunes se queda en su lunes', lunesDe('2026-08-24'), '2026-08-24');
eq('domingo cae en el lunes anterior', lunesDe('2026-08-23'), '2026-08-17');

console.log('\nTESTEOS · CLASIFICACIÓN:');
const tipo = (n) => tipoDeCampana(n, CFG_DEFAULT, HOY).tipo;
eq('CBO + fecha → testeo', tipo('Cepillo 22/8 [CBO Videos]'), 'testeo');
eq('ABO BIDCAP → excluida (escala)', tipo('Cepillo 27/7 [ABO BIDCAP 25 a 35]'), 'excluida');
eq('ABO Costcap → excluida', tipo('Cepillo 5/8 [ABO Costcap 15 a 24]'), 'excluida');
eq('CBO sin fecha → sin-fecha (no ensucia ninguna semana)', tipo('Cepillo [CBO Videos]'), 'sin-fecha');
eq('nombre suelto → otra', tipo('Nueva campaña de Interacción'), 'otra');
eq('producto Cepillo detectado', productoDeCampana('Cepillo 22/8 [CBO Videos]', DEMO.productos)?.id, 'p-cepillo');
eq('producto Crema detectado', productoDeCampana('Crema 23/7 [CBO Video UGC 2]', DEMO.productos)?.id, 'p-crema');
eq('sin producto reconocible → null', productoDeCampana('Nueva campaña de Interacción', DEMO.productos), null);
// ALIAS: el nombre del producto puede no aparecer nunca en la campaña.
const cfgAlias = { porProducto: { 'p-aceite': { alias: ['aceit', 'oil'] } } };
const prods = [...DEMO.productos, { id: 'p-aceite', nombre: 'Aceite Corporal Relajante' }];
eq('alias "aceit" asigna la campaña al producto',
  productoDeCampana('ACEIT 12/8 [CBO Videos]', prods, cfgAlias)?.id, 'p-aceite');
eq('el alias deja registrado que matcheó por alias',
  productoDeCampana('ACEIT 12/8 [CBO Videos]', prods, cfgAlias)?.via, 'alias');
eq('un alias le gana a la coincidencia por palabras',
  productoDeCampana('Cepillo con aceit 12/8', prods, cfgAlias)?.id, 'p-aceite');
eq('sin alias cargado sigue matcheando por el nombre',
  productoDeCampana('Aceite Corporal 12/8', prods, {})?.id, 'p-aceite');

console.log('\nTESTEOS · ROAS DE EQUILIBRIO:');
eq('margen 40% → breakeven 2.5', roasBreakeven(40), 2.5);
eq('margen 52% → breakeven ≈1.92', +roasBreakeven(52).toFixed(2), 1.92);
eq('margen inválido → null', roasBreakeven(0), null);
// El equipo anota el breakeven a mano por producto: ese manda sobre todo.
const cfgCepillo = cfgPara(DEMO.perfil, 'p-cepillo');
eq('usa el breakeven anotado del cepillo', cfgCepillo.roasMaxPausar, 1.9);
eq('ganador exige colchón sobre el breakeven', cfgCepillo.minRoasGanador, 2.28);
const cfgCrema = cfgPara(DEMO.perfil, 'p-crema');
eq('otro producto, otro breakeven anotado', cfgCrema.roasMaxPausar, 2.6);
// Si no lo anotaron pero cargaron el margen, se deriva.
const cfgTiva = cfgPara(DEMO.perfil, 'p-tiva');
eq('sin breakeven anotado lo deriva del margen (38% → 2,63)', cfgTiva.roasMaxPausar, 2.63);
// Sin nada cargado para ese producto, cae al default de la tienda.
eq('producto sin perfil propio usa el de la tienda', cfgPara(DEMO.perfil, 'p-kit').roasMaxPausar, 2.22);

console.log('\nTESTEOS · VEREDICTO Y EFICIENCIA:');
const v = (o) => veredicto(o, CFG_DEFAULT).estado;
eq('4 compras y ROAS 1.5 → ganador', v({ impressions: 50000, spend: 100, purchases: 4, roas: 1.5 }), 'ganador');
eq('ROAS alto pero 1 sola compra → perdedor', v({ impressions: 50000, spend: 100, purchases: 1, roas: 8 }), 'perdedor');
eq('muchas compras con ROAS malo → perdedor', v({ impressions: 50000, spend: 100, purchases: 20, roas: 0.9 }), 'perdedor');
eq('640 impresiones → sin datos (no fracasó, no tuvo chance)', v({ impressions: 640, spend: 2400, purchases: 0, roas: 0 }), 'sin-datos');

const coh = cohortesSemanales(DEMO.campanas, { cfg: CFG_DEFAULT, productos: DEMO.productos, hoy: HOY });
eq('las de escala quedan afuera de las cohortes', coh.filas.every(f => f.items.every(i => i.tipo === 'testeo')), true);
eq('no cuenta las ABO como testeos', coh.filas.reduce((s, f) => s + f.lanzadas, 0), 7);
const semana17 = coh.filas.find(f => f.semana === '2026-08-17');
eq('semana del 17/8 agrupa sus 3 campañas', semana17.lanzadas, 3);
eq('semana del 17/8: 1 ganadora', semana17.ganadoras, 1);
eq('semana del 17/8: 1 perdedora', semana17.perdedoras, 1);
eq('semana del 17/8: 1 sin datos', semana17.sinDatos, 1);
// LA CUENTA CLAVE: 1 de 2 con veredicto = 50%, no 1 de 3 = 33%.
eq('eficiencia = ganadoras ÷ las que tuvieron chance', Math.round(semana17.eficiencia), 50);
eq('la cohorte sigue viva: cuenta las activas de hoy', semana17.activas, 1);
eq('cohortes ordenadas de la más nueva a la más vieja', coh.filas[0].semana, '2026-08-17');
// Filtro por producto.
const cohCepillo = cohortesSemanales(DEMO.campanas, { cfg: CFG_DEFAULT, productos: DEMO.productos, productoId: 'p-cepillo', hoy: HOY });
eq('filtrando por producto solo quedan sus testeos',
  cohCepillo.filas.every(f => f.items.every(i => i.producto?.id === 'p-cepillo')), true);

console.log('\nTESTEOS · PROSPECTADORES:');
const prosp = DEMO.ads7d.filter(a => esProspectador(a.insights, CFG_DEFAULT).es).map(a => a.id);
eq('detecta al de frecuencia baja que vende', prosp.includes('ad_5'), true);
eq('descarta al que quema audiencia (frecuencia 2,6)', prosp.includes('ad_6'), false);
eq('descarta al que llega a gente nueva pero no vende', prosp.includes('ad_7'), false);
eq('descarta al de alcance chico', prosp.includes('ad_8'), false);
eq('solo uno califica', prosp.length, 1);

console.log('\nTESTEOS · RONDA DE OPTIMIZACIÓN (qué pausar):');
const cfgPausa = { ...CFG_DEFAULT, pisoGastoPausar: 25000, roasMaxPausar: 1.5, sobrePromedioPct: 25 };
const prom = promediosDelDia(DEMO.adsHoy);
eq('promedio de la cuenta: costo por carrito sobre las SUMAS', Math.round(prom.costoPorATC), 2046);
const ronda = rondaDeOptimizacion(DEMO.adsHoy, { cfg: cfgPausa, ahora: HOY });
const ids = ronda.candidatos.map(c => c.id);
eq('marca el que gasta y no convierte', ids.includes('ad_2'), true);
eq('NO marca al que recién arrancó (gastó poco)', ids.includes('ad_4'), false);
eq('NO marca al que anda bien', ids.includes('ad_5'), false);
eq('separa "pausar ahora" de "ya se gastó, dejalo correr"',
  [ronda.aPausar.map(c => c.id), ronda.dejarCorrer.map(c => c.id)], [['ad_2'], ['ad_3']]);
eq('plata en riesgo = presupuesto − gastado', ronda.aPausar[0].pausa.restante, 19000);
eq('el ahorro potencial suma solo los que conviene pausar', ronda.ahorroPotencial, 19000);
// PRESUPUESTO COMPARTIDO (CBO): el presupuesto es de la campaña, no del
// anuncio. Restarle a 50.000 solo lo que gastó ESTE anuncio daría 19.000 de
// "ahorro" cuando en realidad la campaña ya lleva gastados 45.000 entre todos.
const compartido = evaluarPausa(
  { dailyBudget: 50000, parentSpend: 45000, nivelPresupuesto: 'campaña',
    insights: { spend: 31000, roas: 0.6, addToCart: 6, initiateCheckout: 2, impressions: 88000 } },
  { costoPorATC: 2046, costoPorCheckout: 4958 }, cfgPausa);
eq('presupuesto compartido: se detecta', compartido.compartido, true);
eq('consumo se mide sobre el gasto de todo lo que comparte el presupuesto', Math.round(compartido.consumidoPct), 90);
// Quedan 5.000 y este anuncio se lleva el 69% del gasto → ~3.444, no 19.000.
eq('plata en riesgo prorrateada, no inflada', Math.round(compartido.restante), 3444);
// Y lo más importante: en CBO pausar NO ahorra, redirige.
eq('presupuesto compartido → el efecto es redirigir, no ahorrar', compartido.efecto, 'redirige');
eq('presupuesto propio → sí es ahorro', ronda.aPausar[0].pausa.efecto, 'ahorro');
eq('los totales van separados: no se suma como ahorro lo que solo se redirige',
  [ronda.ahorroPotencial, ronda.plataRedirigible], [19000, 0]);
eq('a las 12 del mediodía ya no es temprano', ronda.temprano, false);
const temprano = rondaDeOptimizacion(DEMO.adsHoy, { cfg: cfgPausa, ahora: new Date('2026-08-26T12:00:00Z') });
eq('a las 9 AM avisa que el día no maduró', temprano.temprano, true);

console.log('\nTESTEOS · LINK A META:');
const link = linkMeta({ accountId: 'act_123', nivel: 'campaigns', ids: ['1', '2'], desde: '2026-08-17', hasta: '2026-08-23' });
eq('abre el Ads Manager con las campañas seleccionadas', link.includes('selected_campaign_ids=1%2C2'), true);
eq('lleva la cuenta sin el prefijo act_', link.includes('act=123'), true);
eq('lleva el rango de fechas', link.includes('date=2026-08-17_2026-08-23'), true);
eq('a nivel anuncio usa el parámetro de anuncios',
  linkMeta({ accountId: '123', nivel: 'ads', ids: ['9'] }).includes('selected_ad_ids=9'), true);


console.log('\nTESTEOS · FOTOS SEMANALES:');
// La semana del 17/8 termina el domingo 23/8. Con 7 días de atribución,
// recién madura el 30/8.
const cfgFoto = { ...CFG_DEFAULT, diasAtribucion: 7 };
eq('el 26/8 la semana del 17/8 TODAVÍA no maduró', semanaMadura('2026-08-17', { hoy: new Date('2026-08-26T12:00:00Z'), cfg: cfgFoto }), false);
eq('el 30/8 ya maduró', semanaMadura('2026-08-17', { hoy: new Date('2026-08-30T12:00:00Z'), cfg: cfgFoto }), true);
eq('la semana en curso nunca está madura', semanaMadura('2026-08-24', { hoy: new Date('2026-08-26T12:00:00Z'), cfg: cfgFoto }), false);
eq('semanas viejas están maduras', semanaMadura('2026-07-20', { hoy: HOY, cfg: cfgFoto }), true);

const cohHoy = cohortesSemanales(DEMO.campanas, { cfg: CFG_DEFAULT, productos: DEMO.productos, hoy: HOY });
// Sin fotos guardadas: las viejas (20/7, 27/7, 3/8) hay que congelarlas; la
// del 17/8 no, porque todavía está sumando compras.
const aCongelar = cohortesParaCongelar(cohHoy.filas, { hoy: HOY, cfg: cfgFoto, snapshots: {} }).map(f => f.semana).sort();
eq('congela solo las semanas maduras', aCongelar, ['2026-07-20', '2026-08-03', '2026-07-27'].sort());
eq('no congela la semana que sigue sumando compras', aCongelar.includes('2026-08-17'), false);

// Con una foto guardada, ese número manda sobre lo que diga Meta hoy.
const snaps = { '2026-08-03': { datos: { ...fotoDeCohorte(cohHoy.filas.find(f => f.semana === '2026-08-03')), eficiencia: 50, ganadoras: 1 }, cerrada_at: '2026-08-17T10:00:00Z' } };
const fusion = fusionarConFotos(cohHoy.filas, snaps);
const cerrada = fusion.find(f => f.semana === '2026-08-03');
eq('la semana con foto queda marcada como cerrada', cerrada.cerrada, true);
eq('la foto manda sobre el cálculo en vivo', cerrada.eficiencia, 50);
eq('igual conserva las campañas para poder abrirlas en Meta', cerrada.items.length > 0, true);
eq('las semanas sin foto siguen en vivo', fusion.find(f => f.semana === '2026-08-17').cerrada, false);
// Una foto ya guardada no se vuelve a congelar.
eq('no re-congela lo que ya tiene foto',
  cohortesParaCongelar(cohHoy.filas, { hoy: HOY, cfg: cfgFoto, snapshots: snaps }).map(f => f.semana).includes('2026-08-03'), false);

// ─────────── PRENDER / PAUSAR EN META (la única escritura) ───────────
console.log('\nPRENDER / PAUSAR:');
eq('pedido válido normaliza el estado a mayúsculas',
  validarPedido({ level: 'campaign', ids: ['120210000000001'], status: 'paused' }),
  { ok: true, level: 'campaign', ids: ['120210000000001'], status: 'PAUSED' });
eq('acepta un id suelto además de la lista',
  validarPedido({ level: 'ad', id: '120210000000002', status: 'ACTIVE' }).ids, ['120210000000002']);
eq('deduplica ids repetidos',
  validarPedido({ level: 'ad', ids: ['123456', '123456'], status: 'ACTIVE' }).ids, ['123456']);
// El candado que importa: DELETED y ARCHIVED son valores válidos del mismo
// campo en Meta y NO se pueden deshacer con otro click.
eq('rechaza DELETED', validarPedido({ level: 'campaign', ids: ['123456'], status: 'DELETED' }).ok, false);
eq('rechaza ARCHIVED', validarPedido({ level: 'campaign', ids: ['123456'], status: 'ARCHIVED' }).ok, false);
eq('rechaza un nivel inventado', validarPedido({ level: 'cuenta', ids: ['123456'], status: 'PAUSED' }).ok, false);
eq('rechaza un id que no es numérico', validarPedido({ level: 'ad', ids: ['act_123/insights'], status: 'PAUSED' }).ok, false);
eq('rechaza la lista vacía', validarPedido({ level: 'ad', ids: [], status: 'PAUSED' }).ok, false);
// Tope: una pausada masiva por accidente apaga la facturación del día.
eq(`rechaza más de ${MAX_IDS} de una vez`,
  validarPedido({ level: 'ad', ids: Array.from({ length: MAX_IDS + 1 }, (_, i) => String(1000000 + i)), status: 'PAUSED' }).ok, false);
eq(`acepta exactamente ${MAX_IDS}`,
  validarPedido({ level: 'ad', ids: Array.from({ length: MAX_IDS }, (_, i) => String(1000000 + i)), status: 'PAUSED' }).ok, true);

// Meta devuelve el id de cuenta con y sin act_ según el endpoint.
eq('act_123 y 123 son la misma cuenta', mismaCuenta('123456789', 'act_123456789'), true);
eq('cuentas distintas no pasan', mismaCuenta('act_111', 'act_222'), false);
eq('cuenta vacía nunca coincide', mismaCuenta('', ''), false);

// Meta no da transacciones: una tanda puede salir a medias y el mensaje lo dice.
eq('todo bien → success',
  resumirResultados([{ id: '1', ok: true }, { id: '2', ok: true }], { level: 'campaign', status: 'PAUSED' }),
  { total: 2, ok: 2, fallaron: 0, tono: 'success', mensaje: 'Pausé 2 campañas.' });
eq('una sola va en singular',
  resumirResultados([{ id: '1', ok: true }], { level: 'campaign', status: 'ACTIVE' }).mensaje, 'Prendí 1 campaña.');
eq('a medias → warning y dice cuántas fallaron',
  resumirResultados([{ id: '1', ok: true }, { id: '2', ok: false, error: 'sin permiso' }], { level: 'ad', status: 'PAUSED' }),
  { total: 2, ok: 1, fallaron: 1, tono: 'warning', mensaje: 'Pausé 1 anuncio, 1 no se pudo: sin permiso' });
eq('nada salió → error',
  resumirResultados([{ id: '1', ok: false, error: 'token vencido' }], { level: 'campaign', status: 'PAUSED' }).tono, 'error');

// El botón se dibuja con lo que dijo Meta, salvo que lo hayamos cambiado acá.
eq('sin cambios locales manda lo que trajo Meta', estadoVisible({ id: 'a', status: 'ACTIVE' }, {}), 'ACTIVE');
eq('el cambio local pisa lo que trajo Meta', estadoVisible({ id: 'a', status: 'ACTIVE' }, { a: 'PAUSED' }), 'PAUSED');
eq('sin estado conocido no hay botón', estadoVisible({ id: 'a' }, {}), null);
eq('deshacer un pausado lo prende', inverso('PAUSED'), 'ACTIVE');
eq('deshacer un prendido lo pausa', inverso('ACTIVE'), 'PAUSED');

// La columna Entrega no es el interruptor: dice si Meta lo está entregando.
eq('activa entrega', entregaDe({ id: 'a', effectiveStatus: 'ACTIVE' }, {}).label, 'Activa');
eq('en revisión no entrega todavía', entregaDe({ id: 'a', effectiveStatus: 'PENDING_REVIEW' }, {}).tono, 'warn');
eq('rechazado se marca en rojo', entregaDe({ id: 'a', effectiveStatus: 'DISAPPROVED' }, {}).tono, 'bad');
eq('sin nada que mostrar, celda vacía', entregaDe({ id: 'a' }, {}), null);
eq('un estado que no conocemos se muestra tal cual en vez de inventar',
  entregaDe({ id: 'a', effectiveStatus: 'ALGO_NUEVO' }, {}), { label: 'ALGO_NUEVO', tono: 'mute' });
// Lo que acabamos de hacer manda sobre lo que Meta contó hace un rato.
eq('recién pausado ya dice Desactivada',
  entregaDe({ id: 'a', effectiveStatus: 'ACTIVE' }, { a: 'PAUSED' }).label, 'Desactivada');
// Pero prender un anuncio colgado de una campaña apagada NO lo pone a entregar:
// decir "Activa" ahí te deja esperando un gasto que no va a llegar.
eq('prender algo cuyo padre sigue apagado no dice Activa',
  entregaDe({ id: 'a', effectiveStatus: 'CAMPAIGN_PAUSED' }, { a: 'ACTIVE' }).label, 'Campaña desactivada');
eq('conjunto apagado, igual',
  entregaDe({ id: 'a', effectiveStatus: 'ADSET_PAUSED' }, { a: 'ACTIVE' }).label, 'Conjunto desactivado');


// ─────────── CRITERIOS CONFIGURABLES DE LA RONDA ───────────
console.log('\nCRITERIOS DE LA RONDA:');
const candidatoBase = {
  id: 'x', name: 'Aceite 22/8 [CBO]', dailyBudget: 100000, nivelPresupuesto: 'campaña',
  insights: { spend: 40000, revenue: 20000, roas: 0.5, purchases: 3, addToCart: 2, initiateCheckout: 1, impressions: 5000 },
};
const promCaros = { costoPorATC: 1000, costoPorCheckout: 1000 };
const cfgBase = { ...CFG_DEFAULT, pisoGastoPausar: 25000, roasMaxPausar: 1.5, sobrePromedioPct: 25 };

eq('con las cuatro condiciones de siempre, es candidato',
  evaluarPausa(candidatoBase, promCaros, cfgBase).candidato, true);

// Tope de compras: no pausar algo que ya está vendiendo.
eq('con tope de 2 compras, 3 compras lo salva',
  evaluarPausa(candidatoBase, promCaros, { ...cfgBase, condicionesPausar: ['piso', 'roas', 'atc', 'checkout', 'compras'], maxComprasPausar: 2 }).candidato, false);
eq('con tope de 5 compras, 3 compras no lo salva',
  evaluarPausa(candidatoBase, promCaros, { ...cfgBase, condicionesPausar: ['piso', 'roas', 'atc', 'checkout', 'compras'], maxComprasPausar: 5 }).candidato, true);
eq('sin tope, la condición de compras nunca bloquea',
  evaluarPausa(candidatoBase, promCaros, { ...cfgBase, condicionesPausar: ['piso', 'roas', 'atc', 'checkout', 'compras'] }).candidato, true);

// Apagar una condición: si el pixel no manda pago iniciado, esa condición da
// siempre en rojo y marcaría todo. Apagada, deja de decidir.
const sinCheckout = { ...candidatoBase, insights: { ...candidatoBase.insights, initiateCheckout: 0 } };
eq('con checkout encendido, el evento faltante lo marca',
  evaluarPausa(sinCheckout, promCaros, cfgBase).candidato, true);
eq('apagando checkout, deja de contar',
  evaluarPausa(sinCheckout, promCaros, { ...cfgBase, condicionesPausar: ['piso', 'roas', 'checkout'].filter(k => k !== 'checkout') }).candidato, true);
eq('la condición apagada se sigue MOSTRANDO para poder ver el número',
  evaluarPausa(candidatoBase, promCaros, { ...cfgBase, condicionesPausar: ['piso', 'roas'] }).condiciones.length,
  CONDICIONES_PAUSA.length);
eq('pero marcada como que no cuenta',
  evaluarPausa(candidatoBase, promCaros, { ...cfgBase, condicionesPausar: ['piso', 'roas'] }).condiciones.find(c => c.clave === 'atc').cuenta, false);
// Una lista vacía no puede significar "todo es candidato".
eq('sin ninguna condición encendida se vuelve a las de siempre',
  evaluarPausa({ ...candidatoBase, insights: { ...candidatoBase.insights, spend: 10 } }, promCaros, { ...cfgBase, condicionesPausar: [] }).candidato, false);

// El ROAS de corte de CADA producto, no uno global. Con breakeven 0.3 para el
// aceite, un ROAS de 0.5 ya no es para pausar; con el corte general de 1.5 sí.
const cfgPorProducto = { ...cfgBase, porProducto: { aceite: { roasBreakeven: 0.3 } } };
const prodsRonda = [{ id: 'aceite', nombre: 'Aceite', alias: ['aceite'] }];
const conResolver = rondaDeOptimizacion([candidatoBase], {
  cfg: cfgBase, ahora: HOY,
  cfgDeItem: (i) => { const p = productoDeCampana(i.name, prodsRonda, cfgPorProducto); return p ? cfgPara(cfgPorProducto, p.id) : null; },
});
eq('cada fila se juzga con el breakeven de su producto',
  conResolver.candidatos.length, 0);
eq('y deja registro de con qué reglas se la juzgó',
  conResolver.evaluados[0].cfgUsada.roasMaxPausar, 0.3);
// Sin resolver, se comporta igual que antes: un solo corte para todos.
// Ojo: la ronda saca el promedio de la cuenta de los ítems que recibe, así que
// con UNA sola fila nada puede estar "por encima del promedio" — es ella misma.
// Va acompañada de una barata que baje el promedio.
const barata = {
  id: 'y', name: 'Crema 22/8 [CBO]', dailyBudget: 100000, nivelPresupuesto: 'campaña',
  insights: { spend: 30000, revenue: 90000, roas: 3, purchases: 20, addToCart: 300, initiateCheckout: 200, impressions: 9000 },
};
eq('sin resolver por producto, sigue el corte general',
  rondaDeOptimizacion([candidatoBase, barata], { cfg: cfgBase, ahora: HOY }).candidatos.map(c => c.id), ['x']);
eq('con el breakeven del aceite en 0.3, esa misma fila deja de ser candidata',
  rondaDeOptimizacion([candidatoBase, barata], {
    cfg: cfgBase, ahora: HOY,
    cfgDeItem: (i) => { const pr = productoDeCampana(i.name, prodsRonda, cfgPorProducto); return pr ? cfgPara(cfgPorProducto, pr.id) : null; },
  }).candidatos.length, 0);


// ─────────── FACTURACIÓN ───────────
console.log('\nFACTURACIÓN:');
{
  const {
    mesKey, inicioVentana, listaMeses, comprobantesEnVentana,
    reporteMensual, reportePorCliente, topeRestante, resumenParaMail,
  } = await import('../src/facturacionCalc.js');

  eq('mesKey de una fecha', mesKey('2026-08-15'), '2026-08');
  eq('mesKey tolera basura', [mesKey(null), mesKey('nope')], ['', '']);
  // "Comprobantes emitidos de acá once meses para atrás": la ventana de 11
  // meses incluye el mes actual, o sea que arranca 10 meses antes.
  eq('ventana de 11 meses desde sep-2026', inicioVentana(new Date('2026-09-03T00:00:00'), 11), '2025-11');
  eq('ventana de 1 mes = el mes actual', inicioVentana(new Date('2026-09-03T00:00:00'), 1), '2026-09');
  eq('ventana que cruza enero', inicioVentana(new Date('2026-02-10T00:00:00'), 3), '2025-12');
  eq('listaMeses cruza el año', listaMeses('2025-11', '2026-01'), ['2025-11', '2025-12', '2026-01']);
  eq('listaMeses invertida = vacía', listaMeses('2026-03', '2026-01'), []);

  const ventas = [
    { id: 1, fecha: '2026-08-10', clienteId: 1, montoTotal: 500000, estado: 'despachado' },
    { id: 2, fecha: '2026-08-20', clienteId: 1, montoTotal: 500000, estado: 'abonado' },
    { id: 3, fecha: '2026-09-01', clienteId: 2, montoTotal: 300000, estado: 'consulta-recibida' },
    { id: 4, fecha: '2025-01-05', clienteId: 1, montoTotal: 100000, estado: 'despachado' },
    { id: 5, fecha: '', clienteId: 3, montoTotal: 999999, estado: 'despachado' },
  ];
  const clientes = [{ id: 1, nombre: 'Lucas Motas' }, { id: 2, nombre: 'Pirulitas' }];

  eq('ventana filtra viejas y sin fecha',
    comprobantesEnVentana(ventas, { desdeKey: '2025-11', hastaKey: '2026-09' }).map(o => o.id), [1, 2, 3]);
  eq('soloFacturables saca consultas',
    comprobantesEnVentana(ventas, { desdeKey: '2025-11', hastaKey: '2026-09', soloFacturables: true }).map(o => o.id), [1, 2]);
  eq('sin piso entra el histórico completo (menos sin fecha)',
    comprobantesEnVentana(ventas, { hastaKey: '2026-09' }).map(o => o.id), [1, 2, 3, 4]);

  const enVentana = comprobantesEnVentana(ventas, { desdeKey: '2026-07', hastaKey: '2026-09' });
  eq('mensual rellena meses sin movimiento',
    reporteMensual(enVentana, { desdeKey: '2026-07', hastaKey: '2026-09' }),
    [
      { mes: '2026-07', total: 0, cantidad: 0 },
      { mes: '2026-08', total: 1000000, cantidad: 2 },
      { mes: '2026-09', total: 300000, cantidad: 1 },
    ]);

  const porCliente = reportePorCliente(enVentana, clientes);
  eq('por cliente ordena por total y trae última fecha',
    porCliente.map(r => [r.nombre, r.total, r.cantidad, r.ultimaFecha]),
    [['Lucas Motas', 1000000, 2, '2026-08-20'], ['Pirulitas', 300000, 1, '2026-09-01']]);

  // Tope estilo "lo topeo a 113": con 6 ya facturados quedan 107 disponibles.
  eq('tope con disponible', topeRestante(6000000, 113000000),
    { tope: 113000000, restante: 107000000, pctUsado: 5, excedido: false });
  eq('tope excedido', topeRestante(120, 100).excedido, true);
  eq('sin tope → sin alerta', topeRestante(999, 0), { tope: null, restante: null, pctUsado: null, excedido: false });

  const mail = resumenParaMail({
    titulo: 'Reporte',
    porCliente,
    conceptos: { 2: 'Servicios' },
    totalGeneral: 1300000,
    cantidadGeneral: 3,
  });
  eq('mail: concepto default Comercial', mail.includes('Con Lucas Motas — Comercial: $1.000.000 (2 comprobantes)'), true);
  eq('mail: concepto custom y singular', mail.includes('Con Pirulitas — Servicios: $300.000 (1 comprobante)'), true);
  eq('mail: total general arriba', mail.includes('Total facturado: $1.300.000 (3 comprobantes)'), true);
}

// ─────────── RESUMEN ───────────
console.log(`\n${'─'.repeat(40)}\nRESULTADO: ${pass} ✅   ${fail} ❌\n`);
process.exit(fail === 0 ? 0 : 1);
